// AI endpoints (docs/api.md §5 + §8 + §10). All calls go through the orchestrator.
// Provider failure -> AI_UNAVAILABLE with the documented copy; the
// conversation turn is stored with status 'failed' so history stays honest.
import { sendError } from '../../lib/errors.js';
import { discoveryTurn, assistTurn } from '../../ai/orchestrator.js';
import { getProfile } from '../../services/auth.js';
import * as productsSvc from '../../services/products.js';
import * as checklistSvc from '../../services/checklist.js';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONVERSATION_STAGES = ['discovery', 'requirements', 'testing', 'documentation', 'certification'];

async function getOrCreateConversation(db, journeyId, stage) {
  const { rows } = await db.query(
    `INSERT INTO conversations (journey_id, stage) VALUES ($1, $2)
     ON CONFLICT (journey_id, stage) DO UPDATE SET stage = EXCLUDED.stage
     RETURNING id`,
    [journeyId, stage]
  );
  return rows[0].id;
}

/**
 * Run one discovery turn end-to-end and persist it: context assembly ->
 * orchestrator (retrieval + LLM + source-validation gate) -> messages ->
 * requirements. Shared by the POST turn (§5) and the SSE stream (§10) so the
 * two produce a byte-identical assistant turn.
 *
 * Returns `{ ok: true, result }` where `result` is exactly the POST response
 * body ({ messageId, reply, ask, phase }), or `{ ok: false, code }` with a
 * documented error code. On provider failure the turn is stored as 'failed'
 * so history stays honest.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {string} userId
 * @param {string} journeyId
 * @param {string} content
 */
async function runDiscoveryTurn(fastify, userId, journeyId, content) {
  const journey = await productsSvc.getJourney(fastify.db, userId, journeyId);
  if (!journey) return { ok: false, code: 'NOT_FOUND' };

  const conversationId = await getOrCreateConversation(fastify.db, journeyId, 'discovery');

  // history for context (never re-ask what was answered)
  const { rows: history } = await fastify.db.query(
    `SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at`, [conversationId]
  );

  const profile = await getProfile(fastify.db, userId);
  const product = await productsSvc.getProduct(fastify.db, userId, journey.product.id).catch(() => null);

  try {
    const turn = await discoveryTurn(fastify.db, {
      profile, product, history, newContent: content,
    });

    await fastify.db.query(
      `INSERT INTO messages (conversation_id, role, content, status) VALUES ($1, 'user', $2, 'ok')`,
      [conversationId, content]
    );
    const { rows: assistantRows } = await fastify.db.query(
      `INSERT INTO messages (conversation_id, role, content, status) VALUES ($1, 'assistant', $2, 'ok') RETURNING id`,
      [conversationId, turn.reply]
    );

    if (turn.phase === 'done' && turn.requirements.length > 0) {
      // persist the validated discovery result
      for (const r of turn.requirements) {
        await fastify.db.query(
          `INSERT INTO journey_requirements
             (journey_id, type, title, explanation, why_it_matters, mandatory, confidence, standard_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [journeyId, r.type, r.title, r.explanation, r.why_it_matters, r.mandatory,
           r.confidence, r.standard_id ?? null]
        );
      }
      await fastify.db.query(`UPDATE journeys SET updated_at = now() WHERE id = $1`, [journeyId]);
    }

    return {
      ok: true,
      result: {
        messageId: assistantRows[0].id,
        reply: turn.reply,
        ask: turn.ask,
        phase: turn.phase,
      },
    };
  } catch (err) {
    fastify.log.warn({ err }, 'AI provider failure');
    await fastify.db.query(
      `INSERT INTO messages (conversation_id, role, content, status) VALUES ($1, 'assistant', $2, 'failed')`,
      [conversationId, content]
    );
    return { ok: false, code: 'AI_UNAVAILABLE' };
  }
}

/**
 * Split a reply into small word-grouped chunks for incremental delivery.
 * Chunks are concatenation-lossless: joining them with '' reproduces the
 * original reply exactly (each chunk but the last carries its trailing space).
 */
function chunkText(text, wordsPerChunk = 4) {
  const words = String(text ?? '').split(' ');
  if (words.length === 0 || words[0] === '') return [''];
  const out = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    const last = i + wordsPerChunk >= words.length;
    out.push(words.slice(i, i + wordsPerChunk).join(' ') + (last ? '' : ' '));
  }
  return out;
}

export default async function aiApi(fastify) {
  fastify.addHook('preHandler', async (req, reply) => {
    if (!fastify.dbEnabled) return sendError(reply, 'UNAVAILABLE');
    if (!req.user) return sendError(reply, 'UNAUTHENTICATED');
  });

  // ---------- POST /api/journeys/:id/messages ----------
  fastify.post('/api/journeys/:id/messages', async (req, reply) => {
    if (!UUID_RE.test(req.params.id)) return sendError(reply, 'NOT_FOUND');
    const content = typeof req.body?.content === 'string' ? req.body.content.trim().slice(0, 4000) : '';
    if (!content) return sendError(reply, 'VALIDATION_ERROR', 'content is required.');

    const turn = await runDiscoveryTurn(fastify, req.user.id, req.params.id, content);
    if (!turn.ok) return sendError(reply, turn.code);
    return turn.result;
  });

  // ---------- GET /api/journeys/:id/messages/stream (SSE, docs/api.md §10) ----------
  // Incremental delivery of the same discovery turn POST /messages returns.
  // `token` events carry reply chunks (concatenate to the full reply); the
  // terminal `done` event carries the exact POST-response object
  // ({ messageId, reply, ask, phase }). The turn is persisted server-side
  // before any byte is streamed, so a dropped connection never loses the
  // assistant turn or the requirements it produced. Clients that lack
  // EventSource keep using the POST fallback.
  fastify.get('/api/journeys/:id/messages/stream', async (req, reply) => {
    if (!UUID_RE.test(req.params.id)) return sendError(reply, 'NOT_FOUND');
    const content = typeof req.query?.content === 'string' ? req.query.content.trim().slice(0, 4000) : '';
    if (!content) return sendError(reply, 'VALIDATION_ERROR', 'content is required.');

    const turn = await runDiscoveryTurn(fastify, req.user.id, req.params.id, content);
    if (!turn.ok) return sendError(reply, turn.code);

    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const write = (event, data) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    res.write('retry: 3000\n\n'); // reconnect backoff hint for EventSource
    for (const chunk of chunkText(turn.result.reply)) write('token', { text: chunk });
    write('done', turn.result);
    res.end();
    return reply;
  });

  // ---------- GET /api/journeys/:id/plan ----------
  fastify.get('/api/journeys/:id/plan', async (req, reply) => {
    if (!UUID_RE.test(req.params.id)) return sendError(reply, 'NOT_FOUND');
    const journey = await productsSvc.getJourney(fastify.db, req.user.id, req.params.id);
    if (!journey) return sendError(reply, 'NOT_FOUND');

    const { rows } = await fastify.db.query(
      `SELECT jr.type, jr.title, jr.mandatory, jr.confidence,
              COALESCE(
                (SELECT json_agg(json_build_object('sourceId', s.id, 'title', s.document_title, 'url', s.url))
                 FROM standards st JOIN sources s ON s.id = st.latest_source
                 WHERE st.is_number = jr.standard_id), '[]'::json) AS sources
       FROM journey_requirements jr WHERE jr.journey_id = $1`,
      [req.params.id]
    );
    return {
      ready: rows.length > 0,
      summary: {
        product: journey.product.name,
        industry: journey.product.category,
        requirements: rows.map((r) => ({
          type: r.type, title: r.title, mandatory: r.mandatory, confidence: r.confidence, sourceIds: r.sources.map((s) => s.sourceId),
        })),
        tests: [],
        certification: [],
      },
    };
  });

  // ---------- POST /api/tasks/:id/assist/messages ----------
  fastify.post('/api/tasks/:id/assist/messages', async (req, reply) => {
    if (!UUID_RE.test(req.params.id)) return sendError(reply, 'NOT_FOUND');
    const content = typeof req.body?.content === 'string' ? req.body.content.trim().slice(0, 4000) : '';
    if (!content) return sendError(reply, 'VALIDATION_ERROR', 'content is required.');

    const task = await checklistSvc.getTask(fastify.db, req.user.id, req.params.id).catch(() => null);
    if (!task) return sendError(reply, 'NOT_FOUND');

    const stage = CONVERSATION_STAGES.includes(task.stage) ? task.stage : 'requirements';
    const conversationId = await getOrCreateConversation(fastify.db, task.journeyId, stage);
    const { rows: history } = await fastify.db.query(
      `SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at`, [conversationId]
    );

    try {
      const turn = await assistTurn(fastify.db, { task, history, newContent: content });
      await fastify.db.query(
        `INSERT INTO messages (conversation_id, role, content, status) VALUES ($1, 'user', $2, 'ok')`,
        [conversationId, content]
      );
      const { rows: assistantRows } = await fastify.db.query(
        `INSERT INTO messages (conversation_id, role, content, status) VALUES ($1, 'assistant', $2, 'ok') RETURNING id`,
        [conversationId, turn.reply]
      );
      return { messageId: assistantRows[0].id, reply: turn.reply, citations: turn.citations, suggestedAction: turn.suggestedAction };
    } catch (err) {
      fastify.log.warn({ err }, 'AI provider failure (assist)');
      await fastify.db.query(
        `INSERT INTO messages (conversation_id, role, content, status) VALUES ($1, 'assistant', $2, 'failed')`,
        [conversationId, content]
      );
      return sendError(reply, 'AI_UNAVAILABLE');
    }
  });
}
