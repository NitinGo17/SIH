// No-JS form fallbacks for the data pages (products, checklist, task
// completion). JSON endpoints live in routes/api/data.js.
import { sendError } from '../lib/errors.js';
import * as productsSvc from '../services/products.js';
import * as checklistSvc from '../services/checklist.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISCLAIMER_STAGES = ['discovery', 'requirements', 'testing', 'documentation', 'certification'];

function formStr(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** @param {import('fastify').FastifyInstance} fastify */
export default async function pageDataRoutes(fastify) {
  fastify.post('/products', async (req, reply) => {
    if (!fastify.dbEnabled) return sendError(reply, 'UNAVAILABLE');
    if (!req.user) return reply.redirect('/login');
    const name = formStr(req.body?.name, 200);
    if (!name) return reply.redirect('/products');
    const origin = ['manufactured', 'imported'].includes(req.body?.origin) ? req.body.origin : null;
    await productsSvc.createProduct(fastify.db, req.user.id, {
      name,
      category: formStr(req.body?.category, 200) || null,
      origin,
      intendedUse: formStr(req.body?.intendedUse, 500) || null,
    });
    return reply.redirect('/products', 303);
  });

  fastify.post('/products/:id/delete', async (req, reply) => {
    if (!fastify.dbEnabled) return sendError(reply, 'UNAVAILABLE');
    if (!req.user) return reply.redirect('/login');
    if (UUID_RE.test(req.params.id)) {
      await productsSvc.deleteProduct(fastify.db, req.user.id, req.params.id).catch(() => {});
    }
    return reply.redirect('/products', 303);
  });

  fastify.post('/journey/start', async (req, reply) => {
    if (!fastify.dbEnabled) return sendError(reply, 'UNAVAILABLE');
    if (!req.user) return reply.redirect('/login');
    // Phase 4 (AI discovery) is not wired yet: store the first answer against a
    // fresh journey's discovery conversation, then show the honest
    // AI-unavailable state — never a fake consultation.
    const content = formStr(req.body?.content, 4000);
    if (content) {
      const { rows: jl } = await fastify.db.query(
        `SELECT j.id FROM journeys j WHERE j.user_id = $1 AND j.status = 'discovery'
         ORDER BY j.created_at DESC LIMIT 1`, [req.user.id]);
      let journeyId = jl[0]?.id;
      if (!journeyId) {
        const { rows: pl } = await fastify.db.query(
          `SELECT id FROM products WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [req.user.id]);
        if (pl[0]) {
          journeyId = (await productsSvc.createJourney(fastify.db, req.user.id, pl[0].id)).journeyId;
        }
      }
      if (journeyId) {
        const { rows: cl } = await fastify.db.query(
          `INSERT INTO conversations (journey_id, stage) VALUES ($1, 'discovery')
           ON CONFLICT (journey_id, stage) DO UPDATE SET stage = 'discovery' RETURNING id`, [journeyId]);
        await fastify.db.query(
          `INSERT INTO messages (conversation_id, role, content, status) VALUES ($1, 'user', $2, 'ok')`,
          [cl[0].id, content]);
      }
    }
    return reply.redirect('/journey/start?error=AI_UNAVAILABLE', 303);
  });

  fastify.post('/journey/:id/checklist', async (req, reply) => {
    if (!fastify.dbEnabled) return sendError(reply, 'UNAVAILABLE');
    if (!req.user) return reply.redirect('/login');
    if (UUID_RE.test(req.params.id)) {
      await checklistSvc.createChecklist(fastify.db, req.user.id, req.params.id).catch(() => {});
    }
    return reply.redirect(`/journey/${req.params.id}/checklist`, 303);
  });

  fastify.post('/journey/:id/task/:taskId/complete', async (req, reply) => {
    if (!fastify.dbEnabled) return sendError(reply, 'UNAVAILABLE');
    if (!req.user) return reply.redirect('/login');
    if (UUID_RE.test(req.params.taskId)) {
      await checklistSvc.completeTask(fastify.db, req.user.id, req.params.taskId).catch(() => {});
    }
    return reply.redirect(`/journey/${req.params.id}/task/${req.params.taskId}`, 303);
  });

  fastify.post('/journey/:id/task/:taskId/assist', async (req, reply) => {
    if (!fastify.dbEnabled) return sendError(reply, 'UNAVAILABLE');
    if (!req.user) return reply.redirect('/login');
    const content = formStr(req.body?.content, 4000);
    if (content && UUID_RE.test(req.params.taskId)) {
      const task = await checklistSvc.getTask(fastify.db, req.user.id, req.params.taskId).catch(() => null);
      if (task) {
        const stage = DISCLAIMER_STAGES.includes(task.stage) ? task.stage : 'requirements';
        const { rows: cl } = await fastify.db.query(
          `INSERT INTO conversations (journey_id, stage) VALUES ($1, $2)
           ON CONFLICT (journey_id, stage) DO UPDATE SET stage = EXCLUDED.stage RETURNING id`,
          [req.params.id, stage]);
        await fastify.db.query(
          `INSERT INTO messages (conversation_id, role, content, status) VALUES ($1, 'user', $2, 'failed')`,
          [cl[0].id, content]); // failed: no AI answer yet — history stays honest
      }
    }
    return reply.redirect(`/journey/${req.params.id}/task/${req.params.taskId}/assist`, 303);
  });

  fastify.post('/journey/:id/retry', async (req, reply) =>
    reply.redirect(`/journey/${req.params.id}/checklist`, 303));
}
