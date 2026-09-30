// Postgres connection pool. When DATABASE_URL is unset the app still boots
// (pages render, /healthz reports db:"disabled") so template-only development
// and static export work without a database. All data endpoints must check
// `fastify.db` and return 503 when disabled — enforced in routes/api.
import fp from 'fastify-plugin';
import pg from 'pg';

/** @param {import('fastify').FastifyInstance} fastify @param {object} opts */
async function dbPlugin(fastify, opts) {
  if (!opts.databaseUrl) {
    fastify.log.warn('DATABASE_URL not set — running WITHOUT a database. Data endpoints will be unavailable.');
    fastify.decorate('db', null);
    fastify.decorate('dbEnabled', false);
    return;
  }

  const pool = new pg.Pool({
    connectionString: opts.databaseUrl,
    max: opts.poolMax ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // Fail fast on a broken pool rather than serving broken pages.
  pool.on('error', (err) => fastify.log.error({ err }, 'unexpected pg pool error'));

  fastify.decorate('db', pool);
  fastify.decorate('dbEnabled', true);

  fastify.addHook('onClose', async () => {
    await pool.end();
  });
}

// fastify-plugin: apply at the ROOT context so every route sees fastify.db / dbEnabled
export default fp(dbPlugin, { name: 'manakai-db' });
