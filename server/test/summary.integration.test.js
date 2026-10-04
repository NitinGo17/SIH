// Phase 7 summary gate — CI only (needs a real Postgres): the summary page
// must render the journey's persisted data, never placeholder or invented
// content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { migrate } from '../db/migrate.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const skip = !hasDb ? 'DATABASE_URL not set' : false;

test('journey summary renders persisted data (Phase 7)', { skip }, async (t) => {
  await migrate(process.env.DATABASE_URL, { logger: { log: () => {} } });
  const app = await buildApp({ databaseUrl: process.env.DATABASE_URL, logLevel: 'silent' });
  t.after(() => app.close());

  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name: 'Summary User', email: `summary-${Date.now()}@example.com`, password: 'password-123' },
  });
  assert.equal(reg.statusCode, 201, reg.body);
  const session = reg.cookies.find((c) => c.name === 'manakai_session').value;
  const csrf = reg.cookies.find((c) => c.name === 'manakai_csrf').value;
  const cookies = { manakai_session: session, manakai_csrf: csrf };

  // journey pages require a complete profile (first-login redirect)
  const profile = await app.inject({
    method: 'PUT', url: '/api/profile',
    headers: { 'x-csrf-token': csrf }, cookies,
    payload: { businessName: 'Acme Lighting', businessType: 'msme' },
  });
  assert.equal(profile.statusCode, 200, profile.body);

  const prod = await app.inject({
    method: 'POST', url: '/api/products',
    headers: { 'x-csrf-token': csrf }, cookies,
    payload: { name: 'LED Bulbs', category: 'Lighting' },
  });
  assert.equal(prod.statusCode, 201, prod.body);
  const productId = prod.json().id;

  const jn = await app.inject({
    method: 'POST', url: '/api/journeys',
    headers: { 'x-csrf-token': csrf }, cookies,
    payload: { productId },
  });
  assert.equal(jn.statusCode, 201, jn.body);
  const journeyId = jn.json().journeyId;

  const page = await app.inject({ method: 'GET', url: `/journey/${journeyId}/summary`, cookies });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Your compliance summary/);
  assert.match(page.body, /LED Bulbs/);
  // guidance, not approval — the disclaimer must survive into the summary
  assert.match(page.body, /guidance, not official BIS approval/);
});
