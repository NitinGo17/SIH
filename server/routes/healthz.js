// Liveness/readiness probe. Reports database state honestly:
// "up" | "down" | "disabled" (no DATABASE_URL configured).
export default async function healthz(fastify) {
  fastify.get('/healthz', async (_req, reply) => {
    const body = {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      db: 'disabled',
    };

    if (fastify.dbEnabled) {
      try {
        await fastify.db.query('SELECT 1');
        body.db = 'up';
      } catch {
        body.db = 'down';
        body.status = 'degraded';
        return reply.code(503).send(body);
      }
    }

    return body;
  });
}
