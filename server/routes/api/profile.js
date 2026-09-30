// GET/PUT /api/profile — docs/api.md §2.
import { sendError } from '../../lib/errors.js';
import * as authService from '../../services/auth.js';

const profileSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      businessName: { type: ['string', 'null'], maxLength: 200 },
      businessType: {
        type: ['string', 'null'],
        enum: [null, 'msme', 'startup', 'manufacturer', 'importer', 'entrepreneur', 'other'],
      },
      industry: { type: ['string', 'null'], maxLength: 200 },
    },
  },
};

/** @param {import('fastify').FastifyInstance} fastify */
export default async function profileApi(fastify) {
  fastify.get('/api/profile', async (req, reply) => {
    if (!fastify.dbEnabled) return sendError(reply, 'UNAVAILABLE');
    if (!req.user) return sendError(reply, 'UNAUTHENTICATED');
    return authService.getProfile(fastify.db, req.user.id);
  });

  fastify.put('/api/profile', { schema: profileSchema, attachValidation: true }, async (req, reply) => {
    if (!fastify.dbEnabled) return sendError(reply, 'UNAVAILABLE');
    if (!req.user) return sendError(reply, 'UNAUTHENTICATED');
    if (req.validationError) return sendError(reply, 'VALIDATION_ERROR');
    try {
      const profile = await authService.updateProfile(fastify.db, req.user.id, req.body);
      return profile;
    } catch (err) {
      if (err.code === 'VALIDATION_ERROR') return sendError(reply, 'VALIDATION_ERROR', 'businessType is invalid.');
      throw err;
    }
  });
}
