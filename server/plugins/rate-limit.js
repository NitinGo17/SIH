import fp from 'fastify-plugin';
// In-memory sliding-window rate limiter (docs/api.md: 10 auth attempts /
// 15 min / IP). Fine for the single-instance MVP deployment (docs/
// architecture.md §11); move to a shared store (e.g. Postgres) when we scale
// out horizontally — tracked for Sentinel in issue #4.
//
// Counts FAILED attempts; a successful login clears the bucket so honest
// users are never locked out by their own typos running out.

export const AUTH_WINDOW_MS = 15 * 60 * 1000;
export const AUTH_MAX_FAILURES = 10;

export function createRateLimiter({ windowMs = AUTH_WINDOW_MS, max = AUTH_MAX_FAILURES } = {}) {
  const buckets = new Map(); // key -> number[] of failure timestamps

  // opportunistic cleanup so the Map cannot grow unbounded
  function sweep(now) {
    if (buckets.size < 10_000) return;
    for (const [key, times] of buckets) {
      const live = times.filter((t) => now - t < windowMs);
      if (live.length === 0) buckets.delete(key);
      else buckets.set(key, live);
    }
  }

  return {
    /** Record a failure. */
    fail(key, now = Date.now()) {
      sweep(now);
      const times = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
      times.push(now);
      buckets.set(key, times);
    },
    /** Clear the bucket on success. */
    clear(key) {
      buckets.delete(key);
    },
    /** True when the key has hit the limit. */
    blocked(key, now = Date.now()) {
      const times = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
      return times.length >= max;
    },
    /** Milliseconds until the oldest failure expires (0 when unblocked). */
    retryAfterMs(key, now = Date.now()) {
      const times = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
      if (times.length < max) return 0;
      return windowMs - (now - times[0]);
    },
  };
}

/**
 * Fastify plugin: decorates fastify.rateLimit with the auth bucket.
 * @param {import('fastify').FastifyInstance} fastify
 */
async function rateLimitPlugin(fastify) {
  const authLimiter = createRateLimiter();
  fastify.decorate('rateLimit', {
    auth: authLimiter,
  });
}

// fastify-plugin: fastify.rateLimit must be visible to all routes
export default fp(rateLimitPlugin, { name: 'manakai-rate-limit' });
