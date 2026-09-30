// Phase 0+2 smoke tests: public pages render, app pages require a session,
// API 404s use the JSON envelope, security headers present.
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

const PUBLIC_PAGES = [
  ['/', 'From Product to'],
  ['/login', 'Log in'],
  ['/register', 'Create an account'],
  ['/offline', 'offline'],
];

for (const [url, snippet] of PUBLIC_PAGES) {
  test(`GET ${url} renders`, async () => {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 200, res.body);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.ok(res.body.includes(snippet), `expected "${snippet}" in body`);
  });
}

const APP_PAGES = [
  '/dashboard',
  '/profile',
  '/products',
  '/journey/start',
  '/journey/00000000-0000-0000-0000-000000000001/checklist',
  '/journey/00000000-0000-0000-0000-000000000001/task/00000000-0000-0000-0000-000000000002',
  '/journey/00000000-0000-0000-0000-000000000001/testing',
];

for (const url of APP_PAGES) {
  test(`GET ${url} redirects to /login when anonymous`, async () => {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/login');
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

test('security headers are present', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.ok(res.headers['content-security-policy']?.includes("default-src 'self'"));
});
