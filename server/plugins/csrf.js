// CSRF double-submit verification for JSON API writes (docs/architecture.md §8):
// the client must send X-CSRF-Token equal to the non-httpOnly manakai_csrf
// cookie set by plugins/auth.js. Applied to every /api/* non-GET/HEAD/OPTIONS
// route EXCEPT anonymous login/register (no CSRF cookie can exist before a
// session; login CSRF is mitigated by SameSite=Lax + rate limiting).
// Plain HTML form posts are covered by SameSite=Lax session cookies
// (cross-site form submissions do not carry the session cookie).
import { tokensMatch, generateCsrfToken } from '../lib/tokens.js';
import { sendError } from '../lib/errors.js';
import fp from 'fastify-plugin';
import { CSRF_COOKIE } from './auth.js';

const CSRF_EXEMPT = new Set(['/api/auth/login', '/api/auth/register']);

/** @param {import('fastify').FastifyInstance} fastify */
async function csrfPlugin(fastify) {
  fastify.decorate('generateCsrfToken', () => generateCsrfToken());

  fastify.addHook('preHandler', async (req, reply) => {
    const pathname = req.raw.url?.split('?')[0] ?? '';
    if (!pathname.startsWith('/api/')) return;
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    if (CSRF_EXEMPT.has(pathname)) return;

    const cookieToken = req.cookies[CSRF_COOKIE];
    const headerToken = req.headers['x-csrf-token'];
    if (!tokensMatch(String(headerToken ?? ''), cookieToken)) {
      return sendError(reply, 'CSRF_FAILED');
    }
  });
}

// fastify-plugin: the preHandler CSRF check must apply to ALL /api routes
export default fp(csrfPlugin, { name: 'manakai-csrf' });
