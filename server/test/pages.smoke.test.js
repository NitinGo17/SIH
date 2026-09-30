// Phase 0 smoke tests: every page renders through the real template pipeline,
// /healthz works, 404s use the JSON envelope on /api routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';

/** @type {import('fastify').FastifyInstance} */
let app;

test.before(async () => {
  app = await buildApp({ databaseUrl: null, logLevel: 'silent' });
});

test.after(async () => {
  await app.close();
});

const PAGES = [
  ['/', 'From Product to'],
  ['/login', 'Log in'],
  ['/register', 'Create an account'],
  ['/dashboard', 'Dashboard'],
  ['/profile', 'Profile'],
  ['/products', 'My products'],
  ['/journey/start', 'Start the Journey'],
  ['/journey/00000000-0000-0000-0000-000000000001/checklist', 'Checklist'],
  ['/journey/00000000-0000-0000-0000-000000000001/task/00000000-0000-0000-0000-000000000002', 'Task'],
  ['/journey/00000000-0000-0000-0000-000000000001/task/00000000-0000-0000-0000-000000000002/assist', 'Ask ManakAI'],
  ['/journey/00000000-0000-0000-0000-000000000001/testing', 'Testing'],
  ['/journey/00000000-0000-0000-0000-000000000001/summary', 'summary'],
  ['/journey/00000000-0000-0000-0000-000000000001/history', 'history'],
  ['/offline', 'offline'],
];

for (const [url, snippet] of PAGES) {
  test(`GET ${url} renders`, async () => {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 200, res.body);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.ok(res.body.includes(snippet), `expected "${snippet}" in body`);
    assert.ok(res.body.includes('ManakAI'));
  });
}

test('healthz reports db disabled without DATABASE_URL', async () => {
  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().db, 'disabled');
});

test('static assets are served', async () => {
  const res = await app.inject({ method: 'GET', url: '/css/base.css' });
  assert.equal(res.statusCode, 200);
});

test('unknown /api route returns the JSON error envelope', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/nope' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'NOT_FOUND');
});

test('non-UUID journey id is rejected with 404', async () => {
  const res = await app.inject({ method: 'GET', url: '/journey/not-a-uuid/checklist' });
  assert.equal(res.statusCode, 404);
});

test('security headers are present', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.ok(res.headers['content-security-policy']?.includes("default-src 'self'"));
});
