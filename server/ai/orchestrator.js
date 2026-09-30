// The AI orchestrator — the only place LLM calls happen (ADR-0002).
// Pipeline: context assembly -> retrieval -> LLM (strict JSON) ->
// schema validation -> SOURCE VALIDATION GATE -> persistence.
import { chatJson } from './provider.js';
import { retrieve } from './retrieval.js';

const TYPES = new Set(['standard', 'qco', 'test', 'document', 'certification']);
const CONFIDENCE = new Set(['confirmed', 'likely', 'unknown']);
const MANDATORY = new Set(['mandatory', 'voluntary', 'unknown']);

/** Context assembly: everything the model may know. Never re-asks profile data. */
export function buildContext({ profile, product, journeyState }) {
  const lines = ['CONTEXT (the only facts you may rely on):'];
  if (profile?.businessName) lines.push(`- Business: ${profile.businessName} (${profile.businessType ?? 'unknown type'})`);
  if (profile?.industry) lines.push(`- Industry: ${profile.industry}`);
  if (product?.name) lines.push(`- Product: ${product.name} (${product.category ?? 'category not set'}, origin: ${product.origin ?? 'unset'})`);
  if (product?.intendedUse) lines.push(`- Intended use: ${product.intendedUse}`);
  if (journeyState) lines.push(`- Journey: ${journeyState}`);
  return lines.join('\n');
}

const SYSTEM_RULES = `You are ManakAI, a BIS compliance guide for Indian businesses.
HARD RULES: (1) Use ONLY facts from RETRIEVED_CONTEXT. (2) Never invent standards, QCOs, labs,
fees, deadlines or legal requirements. (3) Every requirement must cite source_ids that exist in
RETRIEVED_CONTEXT. (4) Confidence is confirmed | likely | unknown; use unknown when unsure.
(5) If nothing in RETRIEVED_CONTEXT covers the question, say you cannot determine it.`;

/** Discovery turn: ask or produce the plan (docs/api.md §5). */
export async function discoveryTurn(db, { profile, product, history, newContent }) {
  const retrieved = await retrieve(db, `${product?.name ?? ''} ${product?.category ?? ''} ${newContent}`.trim());
  const messages = [
    { role: 'system', content: `${SYSTEM_RULES}\nTASK: discovery\n${buildContext({ profile, product, journeyState: `${history.length} previous turns` })}\nRETRIEVED_CONTEXT: ${JSON.stringify({ rows: retrieved, questionCount: history.filter((m) => m.role === 'assistant').length })}` },
    ...history.slice(-10).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    { role: 'user', content: newContent },
  ];
  const raw = await chatJson(messages, 'Reply as JSON: {"reply": string, "ask"?: {"type":"question","field":string}, "phase": "gathering"|"summarizing"|"done", "requirements"?: [...], "open_questions"?: string[]}');

  if (raw.phase === 'done' && Array.isArray(raw.requirements)) {
    const gated = validationGate(raw.requirements, retrieved);
    return { reply: raw.reply, ask: null, phase: 'done', requirements: gated, openQuestions: raw.open_questions ?? [] };
  }
  return { reply: raw.reply, ask: raw.ask ?? { type: 'question', field: 'intended_use' }, phase: raw.phase ?? 'gathering', requirements: [] };
}

/** Task-scoped assist (docs/api.md §8). */
export async function assistTurn(db, { task, history, newContent }) {
  const retrieved = await retrieve(db, `${task.title} ${newContent}`);
  const messages = [
    { role: 'system', content: `${SYSTEM_RULES}\nTASK: assist\nCurrent task: ${task.title} (${task.stage}). Do not re-ask answered questions.\nRETRIEVED_CONTEXT: ${JSON.stringify({ rows: retrieved })}` },
    ...history.slice(-10).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    { role: 'user', content: newContent },
  ];
  const raw = await chatJson(messages, 'Reply as JSON: {"reply": string, "citations": [{"sourceId": string, "title": string, "url": string}], "suggestedAction": {"type":"complete_task","label":"Mark as Completed"}}');

  // Gate citations: only ones backed by retrieved rows survive.
  const valid = new Map(retrieved.map((r) => [r.source_id, r]));
  const citations = (raw.citations ?? []).filter((c) => valid.has(c.sourceId));
  return {
    reply: raw.reply,
    citations,
    suggestedAction: raw.suggestedAction ?? { type: 'complete_task', label: 'Mark as Completed' },
  };
}

/**
 * THE SOURCE VALIDATION GATE (ADR-0002).
 * - requirements citing an unknown source_id are DROPPED (never shown);
 * - fees/deadlines are stripped unless present in the retrieved text;
 * - only verified rows may back 'confirmed' — everything else is at best 'likely'.
 */
export function validationGate(requirements, retrievedRows) {
  const bySource = new Map(retrievedRows.map((r) => [r.source_id, r]));
  const out = [];
  for (const r of Array.isArray(requirements) ? requirements : []) {
    if (!r || typeof r !== 'object') continue;
    if (!r.title || !TYPES.has(r.type)) continue;

    const citedIds = Array.isArray(r.source_ids) ? r.source_ids.filter((id) => bySource.has(id)) : [];
    if (citedIds.length === 0) {
      out.push({
        type: r.type, title: r.title, why_it_matters: r.why_it_matters ?? '',
        explanation: r.explanation ?? '', mandatory: MANDATORY.has(r.mandatory) ? r.mandatory : 'unknown',
        confidence: 'unknown', // no valid source -> unknown, never shown as fact
      });
      continue;
    }

    const sources = citedIds.map((id) => bySource.get(id));
    const verified = sources.every((s) => s.verified);
    const sourceText = sources.map((s) => s.text).join(' ').toLowerCase();
    const stripped = { ...r };
    // strip unverifiable fields
    if (stripped.fee !== undefined && !sourceText.includes('fee') && !sourceText.includes('₹')) delete stripped.fee;
    if (stripped.deadline !== undefined && !sourceText.includes('deadline') && !sourceText.includes('by ')) delete stripped.deadline;

    const confidence = CONFIDENCE.has(r.confidence) ? r.confidence : 'unknown';
    out.push({
      type: r.type, title: r.title, why_it_matters: r.why_it_matters ?? '',
      explanation: r.explanation ?? '', mandatory: MANDATORY.has(r.mandatory) ? r.mandatory : 'unknown',
      confidence: confidence === 'confirmed' && !verified ? 'likely' : confidence,
      source_ids: citedIds,
    });
  }
  return out;
}
