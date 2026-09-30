// /api/products (docs/api.md §3), /api/journeys (§4), checklist (§6),
// tasks (§7), tests & labs (§9). Every route: session + CSRF (writes).
import { sendError } from '../../lib/errors.js';
import * as products from '../../services/products.js';
import * as checklist from '../../services/checklist.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const productSchema = {
  body: {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 },
      category: { type: ['string', 'null'], maxLength: 200 },
      origin: { type: ['string', 'null'], enum: [null, 'manufactured', 'imported'] },
      manufacturingLocation: { type: ['string', 'null'], maxLength: 200 },
      intendedUse: { type: ['string', 'null'], maxLength: 500 },
      complianceStage: {
        type: ['string', 'null'],
        enum: [null, 'exploring', 'product_development', 'testing', 'certification', 'already_certified'],
      },
    },
  },
};

function requireAuth(fastify, req, reply) {
  if (!fastify.dbEnabled) { sendError(reply, 'UNAVAILABLE'); return false; }
  if (!req.user) { sendError(reply, 'UNAUTHENTICATED'); return false; }
  return true;
}

function validId(...ids) {
  return ids.every((id) => UUID_RE.test(id));
}

export default async function dataApi(fastify) {
  // ---------- products ----------
  fastify.get('/api/products', async (req, reply) => {
    if (!requireAuth(fastify, req, reply)) return;
    return products.listProducts(fastify.db, req.user.id);
  });

  fastify.post('/api/products', { schema: productSchema, attachValidation: true }, async (req, reply) => {
    if (req.validationError) return sendError(reply, 'VALIDATION_ERROR');
    if (!requireAuth(fastify, req, reply)) return;
    const product = await products.createProduct(fastify.db, req.user.id, req.body);
    return reply.code(201).send(product);
  });

  fastify.get('/api/products/:id', async (req, reply) => {
    if (!requireAuth(fastify, req, reply)) return;
    if (!validId(req.params.id)) return sendError(reply, 'NOT_FOUND');
    try {
      return await products.getProduct(fastify.db, req.user.id, req.params.id);
    } catch (e) {
      return sendError(reply, e.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNAVAILABLE');
    }
  });

  fastify.put('/api/products/:id', { schema: productSchema, attachValidation: true }, async (req, reply) => {
    if (req.validationError) return sendError(reply, 'VALIDATION_ERROR');
    if (!requireAuth(fastify, req, reply)) return;
    if (!validId(req.params.id)) return sendError(reply, 'NOT_FOUND');
    try {
      return await products.updateProduct(fastify.db, req.user.id, req.params.id, req.body);
    } catch (e) {
      return sendError(reply, e.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNAVAILABLE');
    }
  });

  fastify.delete('/api/products/:id', async (req, reply) => {
    if (!requireAuth(fastify, req, reply)) return;
    if (!validId(req.params.id)) return sendError(reply, 'NOT_FOUND');
    try {
      await products.deleteProduct(fastify.db, req.user.id, req.params.id);
      return reply.code(204).send();
    } catch (e) {
      return sendError(reply, e.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNAVAILABLE');
    }
  });

  // ---------- journeys ----------
  fastify.post('/api/journeys', async (req, reply) => {
    if (!requireAuth(fastify, req, reply)) return;
    const productId = req.body?.productId;
    if (!validId(productId)) return sendError(reply, 'VALIDATION_ERROR', 'productId must be a UUID.');
    try {
      const j = await products.createJourney(fastify.db, req.user.id, productId);
      return reply.code(201).send(j);
    } catch (e) {
      return sendError(reply, e.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNAVAILABLE');
    }
  });

  fastify.get('/api/journeys/:id', async (req, reply) => {
    if (!requireAuth(fastify, req, reply)) return;
    if (!validId(req.params.id)) return sendError(reply, 'NOT_FOUND');
    const j = await products.getJourney(fastify.db, req.user.id, req.params.id);
    if (!j) return sendError(reply, 'NOT_FOUND');
    return j;
  });

  // ---------- checklist ----------
  fastify.post('/api/journeys/:id/checklist', async (req, reply) => {
    if (!requireAuth(fastify, req, reply)) return;
    if (!validId(req.params.id)) return sendError(reply, 'NOT_FOUND');
    const result = await checklist.createChecklist(fastify.db, req.user.id, req.params.id);
    if (!result) return sendError(reply, 'NOT_FOUND');
    return reply.code(result.created ? 201 : 200).send(result);
  });

  fastify.get('/api/journeys/:id/checklist', async (req, reply) => {
    if (!requireAuth(fastify, req, reply)) return;
    if (!validId(req.params.id)) return sendError(reply, 'NOT_FOUND');
    const result = await checklist.getChecklist(fastify.db, req.user.id, req.params.id);
    if (!result) return sendError(reply, 'NOT_FOUND');
    return result;
  });

  // ---------- tasks ----------
  fastify.get('/api/tasks/:id', async (req, reply) => {
    if (!requireAuth(fastify, req, reply)) return;
    if (!validId(req.params.id)) return sendError(reply, 'NOT_FOUND');
    try {
      return await checklist.getTask(fastify.db, req.user.id, req.params.id);
    } catch {
      return sendError(reply, 'NOT_FOUND');
    }
  });

  fastify.post('/api/tasks/:id/status', async (req, reply) => {
    if (!requireAuth(fastify, req, reply)) return;
    if (!validId(req.params.id)) return sendError(reply, 'NOT_FOUND');
    const state = req.body?.state;
    if (!['not_started', 'in_progress', 'completed', 'requires_verification'].includes(state)) {
      return sendError(reply, 'VALIDATION_ERROR', 'state is invalid.');
    }
    try {
      return await checklist.setTaskState(fastify.db, req.user.id, req.params.id, state);
    } catch (e) {
      if (e.code === 'NOT_FOUND') return sendError(reply, 'NOT_FOUND');
      if (e.code === 'VALIDATION_ERROR') return sendError(reply, 'VALIDATION_ERROR', 'That state transition is not allowed.');
      throw e;
    }
  });

  fastify.post('/api/tasks/:id/complete', async (req, reply) => {
    if (!requireAuth(fastify, req, reply)) return;
    if (!validId(req.params.id)) return sendError(reply, 'NOT_FOUND');
    try {
      return await checklist.completeTask(fastify.db, req.user.id, req.params.id);
    } catch (e) {
      if (e.code === 'NOT_FOUND') return sendError(reply, 'NOT_FOUND');
      if (e.code === 'VALIDATION_ERROR') return sendError(reply, 'VALIDATION_ERROR', 'That task is locked.');
      throw e;
    }
  });

  fastify.post('/api/tasks/:id/requirements', async (req, reply) => {
    if (!requireAuth(fastify, req, reply)) return;
    if (!validId(req.params.id)) return sendError(reply, 'NOT_FOUND');
    const { label, done } = req.body ?? {};
    if (typeof label !== 'string' || label.length === 0 || typeof done !== 'boolean') {
      return sendError(reply, 'VALIDATION_ERROR', 'label (string) and done (boolean) are required.');
    }
    try {
      return await checklist.setTaskRequirement(fastify.db, req.user.id, req.params.id, label, done);
    } catch {
      return sendError(reply, 'NOT_FOUND');
    }
  });

  // ---------- testing & labs (§9) ----------
  fastify.get('/api/journeys/:id/tests', async (req, reply) => {
    if (!requireAuth(fastify, req, reply)) return;
    if (!validId(req.params.id)) return sendError(reply, 'NOT_FOUND');
    const { rows } = await fastify.db.query(
      `SELECT t.id, t.name, t.purpose, jt.status
       FROM journey_tests jt JOIN tests t ON t.id = jt.test_id
       WHERE jt.journey_id = (SELECT id FROM journeys WHERE id = $1 AND user_id = $2)`,
      [req.params.id, req.user.id]
    );
    return rows.map((r) => ({ testId: r.id, name: r.name, purpose: r.purpose, status: r.status }));
  });

  fastify.get('/api/labs', async (req, reply) => {
    if (!requireAuth(fastify, req, reply)) return;
    const { testId, capability } = req.query ?? {};
    // Only rows from the curated, official BIS list — never invented.
    const { rows } = await fastify.db.query(
      `SELECT name, city, state, capabilities, website, last_verified
       FROM laboratories
       WHERE ($1::uuid IS NULL OR $1::uuid IN (SELECT test_id FROM tests WHERE id = $1::uuid))
         AND ($2::text IS NULL OR $2::text = ANY(capabilities))
         AND verified = true
       ORDER BY name LIMIT 100`,
      [testId ?? null, capability ?? null]
    );
    return {
      disclaimer: 'Verify current recognition and availability with BIS.',
      labs: rows.map((r) => ({
        name: r.name, city: r.city, state: r.state, capabilities: r.capabilities,
        website: r.website, lastVerified: r.last_verified,
      })),
    };
  });
}
