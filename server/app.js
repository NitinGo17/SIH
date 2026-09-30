// Application assembly. Build the Fastify instance with plugins and routes so
// tests and the static exporter can run without opening a port.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import cookiePlugin from '@fastify/cookie';
import formBodyPlugin from '@fastify/formbody';
import dbPlugin from './plugins/db.js';
import authPlugin from './plugins/auth.js';
import csrfPlugin from './plugins/csrf.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import healthz from './routes/healthz.js';
import pageRoutes from './routes/pages.js';
import pageAuthRoutes from './routes/page-auth.js';
import dataApi from './routes/api/data.js';
import pageDataRoutes from './routes/page-data.js';
import authApi from './routes/api/auth.js';
import profileApi from './routes/api/profile.js';
import { sendError } from './lib/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {object} [opts]
 * @param {string|null} [opts.databaseUrl] null = run without a database
 * @param {string} [opts.logLevel]
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function buildApp(opts = {}) {
  const app = fastify({
    logger: { level: opts.logLevel ?? (process.env.LOG_LEVEL || 'info') },
    trustProxy: true,
  });

  await app.register(dbPlugin, {
    // explicit null means "no database" — do NOT fall back to the environment
    // (unit tests rely on this; CI runs them with DATABASE_URL set)
    databaseUrl: opts.databaseUrl !== undefined ? opts.databaseUrl : (process.env.DATABASE_URL ?? null),
  });

  await app.register(fastifyStatic, {
    root: path.join(here, 'public'),
    prefix: '/',
    maxAge: '1h',
  });

  await app.register(cookiePlugin);
  await app.register(formBodyPlugin); // no-JS form fallbacks (templates POST as urlencoded)
  await app.register(rateLimitPlugin);
  await app.register(authPlugin); // resolves req.user from the session cookie
  await app.register(csrfPlugin); // double-submit for /api/* writes

  await app.register(healthz);
  await app.register(authApi);
  await app.register(profileApi);
  await app.register(dataApi);
  await app.register(pageRoutes);
  await app.register(pageAuthRoutes);
  await app.register(pageDataRoutes);

  // Schema validation failures and unexpected errors -> consistent envelope on
  // /api/* (docs/api.md), plain message elsewhere.
  app.setErrorHandler((err, req, reply) => {
    if (err.validation) {
      if (req.raw.url?.startsWith('/api/')) return sendError(reply, 'VALIDATION_ERROR');
      return reply.code(400).send('Invalid input.');
    }
    if (err.statusCode >= 500 || !err.statusCode) {
      req.log.error({ err }, 'unhandled error');
    }
    if (req.raw.url?.startsWith('/api/')) {
      return sendError(reply, 'UNAVAILABLE', 'Something went wrong. Please try again.');
    }
    return reply.code(err.statusCode ?? 500).send('Something went wrong. Please try again.');
  });

  // Security headers (docs/architecture.md §8).
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'"
    );
    if (process.env.NODE_ENV === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  app.setNotFoundHandler(async (req, reply) => {
    if (req.raw.url?.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } });
    }
    return reply.code(404).send('Not found');
  });

  return app;
}
