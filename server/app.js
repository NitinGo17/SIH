// Application assembly. Build the Fastify instance with plugins and routes so
// tests and the static exporter can inject requests without opening a port.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import dbPlugin from './plugins/db.js';
import healthz from './routes/healthz.js';
import pageRoutes from './routes/pages.js';

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

  await app.register(dbPlugin, { databaseUrl: opts.databaseUrl ?? process.env.DATABASE_URL ?? null });

  await app.register(fastifyStatic, {
    root: path.join(here, 'public'),
    prefix: '/',
    // long-cache fingerprinted assets later; for now no-cache is simplest and safe
    maxAge: '1h',
  });

  await app.register(healthz);
  await app.register(pageRoutes);

  // Security headers (docs/architecture.md §8). CSP allows only our own assets;
  // eta escapes all content, so no inline scripts are needed.
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
