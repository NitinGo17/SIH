// LLM provider abstraction. ADR-0002: this is the ONLY module that talks to
// an AI provider. The client NEVER calls AI endpoints directly.
//
// Two providers:
//   - 'mock'   (default when AI_API_KEY is unset): deterministic, grounded in
//               the retrieval rows it is handed — invents nothing. Demo/tests.
//   - 'openai' : any OpenAI-compatible /chat/completions endpoint (AI_BASE_URL).
import { createHash } from 'node:crypto';

export function aiConfig() {
  const provider = process.env.AI_PROVIDER || (process.env.AI_API_KEY ? 'openai' : 'mock');
  return {
    provider,
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    apiKey: process.env.AI_API_KEY || null,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 45_000,
  };
}

/**
 * Chat completion returning a JSON object.
 * @param {Array<{role:string, content:string}>} messages
 * @param {string} jsonHint - instruction that the reply MUST be JSON
 * @returns {Promise<object>} parsed JSON
 */
export async function chatJson(messages, jsonHint) {
  const cfg = aiConfig();
  if (cfg.provider === 'mock') {
    return mockChat(messages);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [...messages, { role: 'system', content: jsonHint }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    });
    if (!res.ok) throw new Error(`provider ${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? '{}';
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- mock provider ----------
// Deterministic: routes on the system prompt's task tag and assembles output
// strictly from the RETRIEVED_CONTEXT JSON blob embedded in the prompt. No
// facts outside that blob can appear — the validation gate double-checks.
export function mockChat(messages) {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const user = messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n');

  let ctx = {};
  const m = system.match(/RETRIEVED_CONTEXT: (\{[\s\S]*\})$/);
  if (m) {
    try { ctx = JSON.parse(m[1]); } catch { /* none */ }
  }

  if (system.includes('TASK: discovery')) {
    const rows = ctx.rows ?? [];
    const missing = [];
    for (const field of ['intendedUse', 'category']) {
      if (!user.toLowerCase().includes(field.toLowerCase())) missing.push(field);
    }
    if (missing.length && (ctx.questionCount ?? 0) < 2 && rows.length === 0) {
      return {
        reply: rows.length ? 'Thanks. Let me check the applicable requirements.' : 'A couple of quick questions before I check the requirements.',
        ask: { type: 'question', field: 'intended_use' },
        phase: 'gathering',
      };
    }
    return {
      reply: 'Here is what applies to your product, based only on the sources I could verify.',
      phase: 'done',
      requirements: rows.map((r) => ({
        type: 'standard',
        title: r.title,
        why_it_matters: `Covered by ${r.authority} documentation: ${r.title}.`,
        mandatory: 'unknown',
        confidence: r.verified ? 'likely' : 'unknown',
        source_ids: [r.source_id],
        explanation: r.text,
      })),
      open_questions: [],
    };
  }
  if (system.includes('TASK: assist')) {
    const rows = ctx.rows ?? [];
    const first = rows[0];
    return {
      reply: first
        ? `Based on ${first.authority} — ${first.title}: ${String(first.text).slice(0, 400)}`
        : 'I could not find sourced guidance for that question, so I cannot answer it reliably.',
      citations: rows.slice(0, 3).map((r) => ({ sourceId: r.source_id, title: r.title, url: r.url })),
      suggestedAction: { type: 'complete_task', label: 'Mark as Completed' },
    };
  }
  return { reply: 'ManakAI could not complete that request.' };
}

/** Deterministic 768-dim embedding for mock/demo mode (no provider call). */
export function mockEmbedding(text) {
  const vec = new Float32Array(768);
  const words = String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  for (const word of words) {
    const h = createHash('sha256').update(word).digest();
    vec[h[0] % 768] += 1 + (h[1] % 2);
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return Array.from(vec, (v) => v / norm);
}

/** Embedding for ingestion + retrieval (provider when configured, mock otherwise). */
export async function embed(text) {
  const cfg = aiConfig();
  if (cfg.provider === 'mock') return mockEmbedding(text);
  const res = await fetch(`${cfg.baseUrl}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: process.env.AI_EMBED_MODEL || 'text-embedding-3-small', input: String(text).slice(0, 8000) }),
  });
  if (!res.ok) throw new Error(`embedding provider ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding;
}
