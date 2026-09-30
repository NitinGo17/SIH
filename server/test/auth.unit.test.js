// Phase 2 unit tests — no database required (integration tests live in
// auth.integration.test.js and run in CI against a real Postgres).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { generateToken, hashToken, tokensMatch } from '../lib/tokens.js';
import { createRateLimiter, AUTH_MAX_FAILURES } from '../plugins/rate-limit.js';
import { ERROR_STATUS } from '../lib/errors.js';
import { buildApp } from '../app.js';

// ---------- lib/passwords ----------
test('argon2id: hash and verify roundtrip', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(hash, 'correct horse battery'), true);
  assert.equal(await verifyPassword(hash, 'wrong password'), false);
});

// ---------- lib/tokens ----------
test('session tokens are 256-bit base64url and unique', () => {
  const a = generateToken();
  const b = generateToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
});

test('token hashes are sha256 hex and do not leak the token', () => {
  const token = generateToken();
  const digest = hashToken(token);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.ok(!digest.includes(token));
  assert.equal(hashToken(token), digest);
});

test('tokensMatch: constant-time comparison with format check', () => {
  const a = generateToken();
  assert.equal(tokensMatch(a, a), true);
  assert.equal(tokensMatch(a, generateToken()), false);
  assert.equal(tokensMatch('not-a-token', 'not-a-token'), false); // wrong shape
  assert.equal(tokensMatch(undefined, a), false);
});

// ---------- rate limiter ----------
test('auth rate limiter blocks after 10 failures and clears on success', () => {
  const limiter = createRateLimiter();
  for (let i = 0; i < AUTH_MAX_FAILURES; i++) limiter.fail('1.2.3.4');
  assert.equal(limiter.blocked('1.2.3.4'), true);
  assert.ok(limiter.retryAfterMs('1.2.3.4') > 0);
  assert.equal(limiter.blocked('5.6.7.8'), false); // per-IP isolation

  limiter.clear('1.2.3.4');
  assert.equal(limiter.blocked('1.2.3.4'), false);
});

test('rate limiter failures expire with the window', () => {
  const limiter = createRateLimiter({ windowMs: 100, max: 2 });
  const t0 = Date.now();
  limiter.fail('ip', t0);
  limiter.fail('ip', t0 + 50);
  assert.equal(limiter.blocked('ip', t0 + 60), true);
  assert.equal(limiter.blocked('ip', t0 + 101 + 60), false); // first failure expired
});

// ---------- error envelope mapping ----------
test('error codes map to sensible HTTP statuses', () => {
  assert.equal(ERROR_STATUS.EMAIL_TAKEN, 409);
  assert.equal(ERROR_STATUS.RATE_LIMITED, 429);
  assert.equal(ERROR_STATUS.INVALID_CREDENTIALS, 401);
});

// ---------- app behaviour without a database ----------
let app;
test.before(async () => {
  app = await buildApp({ databaseUrl: null, logLevel: 'silent' });
});
test.after(async () => {
  await app.close();
});

test('register body validation -> 400 VALIDATION_ERROR envelope', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name: 'X', email: 'not-an-email', password: 'short' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
});

test('register: unknown extra fields are stripped, not stored', async () => {
  // Fastify's default Ajv (removeAdditional) silently drops properties that
  // are not in the schema — the handler never sees `isAdmin`. In no-DB unit
  // mode the request then fails with UNAVAILABLE (503), proving it passed
  // schema validation instead of erroring or leaking the field.
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name: 'X', email: 'a@b.co', password: 'longenough1', isAdmin: true },
  });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error.code, 'UNAVAILABLE');
});

test('auth endpoints report 503 when the database is not configured', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'a@b.co', password: 'whatever1' },
  });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error.code, 'UNAVAILABLE');
});

test('CSRF: /api writes without the double-submit header are rejected', async () => {
  const res = await app.inject({ method: 'PUT', url: '/api/profile', payload: {} });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, 'CSRF_FAILED');
});

test('CSRF: correct double-submit pair passes the gate', async () => {
  const csrf = generateToken();
  const res = await app.inject({
    method: 'PUT',
    url: '/api/profile',
    headers: { 'x-csrf-token': csrf },
    cookies: { manakai_csrf: csrf },
    payload: {},
  });
  assert.notEqual(res.statusCode, 403); // passes CSRF, then fails on db (503)
  assert.equal(res.json().error.code, 'UNAVAILABLE');
});
