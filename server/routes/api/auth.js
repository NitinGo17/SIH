// POST /api/auth/register | /api/auth/login | /api/auth/logout, GET /api/me
// Contracts: docs/api.md §1.
import { hashPassword, verifyPassword } from '../../lib/passwords.js';
import { sendError } from '../../lib/errors.js';
import * as authService from '../../services/auth.js';
import { SESSION_COOKIE, CSRF_COOKIE, sessionCookieOptions } from '../../plugins/auth.js';

/** Ensure an authenticated client immediately has a CSRF cookie to echo back. */
function setAuthCookies(reply, token, fastify) {
  reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions());
  reply.setCookie(CSRF_COOKIE, fastify.generateCsrfToken(), {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60,
  });
}

const registerSchema = {
  body: {
    type: 'object',
    required: ['name', 'email', 'password'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      email: { type: 'string', minLength: 3, maxLength: 254, pattern: '^[^@ ]+@[^@ ]+[.][^@ ]+$' },
      password: { type: 'string', minLength: 8, maxLength: 200 }, // min 8 chars, no composition theatre
    },
  },
};

const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', minLength: 3, maxLength: 254, pattern: '^[^@ ]+@[^@ ]+[.][^@ ]+$' },
      password: { type: 'string', minLength: 1, maxLength: 200 },
    },
  },
};

/**
 * Shared register logic for the JSON API and the HTML form fallback.
 * @returns {Promise<{status:number, body?:object, error?:{code:string,message:string}, setSession?:string}>}
 */
export async function doRegister(fastify, { name, email, password }) {
  const { EmailTakenError, createUser, createSession } = authService;
  const passwordHash = await hashPassword(password);
  try {
    const { id } = await createUser(fastify.db, { email, passwordHash, displayName: name });
    const token = await createSession(fastify.db, id);
    return { status: 201, body: { userId: id }, setSession: token };
  } catch (err) {
    if (err instanceof EmailTakenError) {
      return { status: 409, error: { code: 'EMAIL_TAKEN' } };
    }
    throw err;
  }
}

/**
 * Shared login logic. Rate limit: 10 failures / 15 min / IP.
 * @returns {Promise<{status:number, body?:object, error?:{code:string}, clearSession?:boolean, setSession?:string}>}
 */
export async function doLogin(fastify, { email, password }, ip) {
  const limiter = fastify.rateLimit.auth;
  if (limiter.blocked(ip)) {
    return { status: 429, error: { code: 'RATE_LIMITED' } };
  }

  const user = await authService.getUserByEmail(fastify.db, email);
  const ok = user ? await verifyPassword(user.password_hash, password) : false;
  if (!user || !ok) {
    limiter.fail(ip);
    return { status: 401, error: { code: 'INVALID_CREDENTIALS' } };
  }

  limiter.clear(ip);
  // Rotation on login: invalidate ALL of the user's sessions, issue a fresh token.
  await authService.deleteSessionsForUser(fastify.db, user.id).catch(() => {});
  const token = await authService.createSession(fastify.db, user.id);
  return {
    status: 200,
    body: { userId: user.id, profileComplete: user.profile_complete },
    setSession: token,
  };
}

/** @param {import('fastify').FastifyInstance} fastify */
export default async function authApi(fastify) {
  fastify.post('/api/auth/register', { schema: registerSchema, attachValidation: true }, async (req, reply) => {
    if (req.validationError) return sendError(reply, 'VALIDATION_ERROR');
    if (!fastify.dbEnabled) return sendError(reply, 'UNAVAILABLE');
    const result = await doRegister(fastify, req.body);
    if (result.error) return sendError(reply, result.error.code);
    setAuthCookies(reply, result.setSession, fastify);
    return reply.code(result.status).send(result.body);
  });

  fastify.post('/api/auth/login', { schema: loginSchema, attachValidation: true }, async (req, reply) => {
    if (req.validationError) return sendError(reply, 'VALIDATION_ERROR');
    if (!fastify.dbEnabled) return sendError(reply, 'UNAVAILABLE');
    const result = await doLogin(fastify, req.body, req.ip);
    if (result.error) return sendError(reply, result.error.code);
    setAuthCookies(reply, result.setSession, fastify);
    return reply.code(result.status).send(result.body);
  });

  fastify.post('/api/auth/logout', async (req, reply) => {
    if (fastify.dbEnabled && req.sessionToken) {
      await authService.deleteSession(fastify.db, req.sessionToken).catch(() => {});
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  fastify.get('/api/me', async (req, reply) => {
    if (!fastify.dbEnabled) return sendError(reply, 'UNAVAILABLE');
    if (!req.user) return sendError(reply, 'UNAUTHENTICATED');
    const counts = await authService.getUserCounts(fastify.db, req.user.id);
    return {
      userId: req.user.id,
      name: req.user.display_name,
      email: req.user.email,
      profileComplete: req.user.profile_complete,
      productCount: counts.product_count,
      activeJourneyCount: counts.active_journey_count,
    };
  });
}
