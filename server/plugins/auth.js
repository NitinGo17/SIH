// Session cookie auth. Resolves the user on every request from the opaque
// session token cookie (httpOnly, SameSite=Lax). Decorates `request.user`
// (null when anonymous). Also ensures a CSRF token cookie exists for
// authenticated sessions (double-submit, see plugins/csrf.js).
export const SESSION_COOKIE = 'manakai_session';
export const CSRF_COOKIE = 'manakai_csrf';

import fp from 'fastify-plugin';
import * as authService from '../services/auth.js';

/** @param {import('fastify').FastifyInstance} fastify */
async function authPlugin(fastify) {
  fastify.decorateRequest('user', null);
  fastify.decorateRequest('sessionToken', null);

  fastify.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token || !fastify.dbEnabled) return;
    try {
      const user = await authService.getUserBySessionToken(fastify.db, token);
      if (user) {
        req.user = user;
        req.sessionToken = token;
      }
    } catch (err) {
      // a broken session must never 500 the whole page
      req.log.warn({ err }, 'session lookup failed');
    }
  });

  // Make sure an authenticated client always has a CSRF cookie to echo back.
  fastify.addHook('onSend', async (req, reply, payload) => {
    if (req.user && !req.cookies[CSRF_COOKIE]) {
      reply.setCookie(CSRF_COOKIE, fastify.generateCsrfToken(), {
        path: '/',
        sameSite: 'lax',
        httpOnly: false, // must be readable by fetch() to be echoed in a header
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60,
      });
    }
    return payload;
  });
}

/** Cookie options for the session token itself. */
export function sessionCookieOptions() {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax', // blocks cross-site POST/cookies; CSRF for JSON APIs is handled by double-submit
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60,
  };
}

// fastify-plugin: the onRequest session hook must apply to ALL routes
export default fp(authPlugin, { name: 'manakai-auth' });
