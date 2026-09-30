// Phase 3/5/6/7 integration tests — CI only (needs a real Postgres).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { migrate } from '../db/migrate.js';
import { generateToken } from '../lib/tokens.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const skip = !hasDb ? 'DATABASE_URL not set' : false;

async function registerUser(app, email) {
  const reg = await app.inject({
    method: 'POST', url: '/api/auth/register',
    payload: { name: 'Data User', email, password: 'password-123' },
  });
  assert.equal(reg.statusCode, 201, reg.body);
  return {
    cookies: () => ({
      manakai_session: reg.cookies.find((c) => c.name === 'manakai_session').value,
      manakai_csrf: reg.cookies.find((c) => c.name === 'manakai_csrf').value,
    }),
  };
}

test(
  'products + checklist: CRUD, cross-user isolation, state machine, completion',
  { skip },
  async (t) => {
    await migrate(process.env.DATABASE_URL, { logger: { log: () => {} } });
    const app = await buildApp({ databaseUrl: process.env.DATABASE_URL, logLevel: 'silent' });
    t.after(() => app.close());

    const alice = await registerUser(app, `alice-${Date.now()}@example.com`);
    const bob = await registerUser(app, `bob-${Date.now()}@example.com`);

    // create product (JSON API, CSRF)
    const created = await app.inject({
      method: 'POST', url: '/api/products',
      headers: { 'x-csrf-token': alice.cookies().manakai_csrf },
      cookies: alice.cookies(),
      payload: { name: 'LED Bulbs', category: 'Lighting', origin: 'manufactured', intendedUse: 'Household lighting' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const product = created.json();

    // list
    const list = await app.inject({ method: 'GET', url: '/api/products', cookies: alice.cookies() });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().length, 1);

    // CROSS-USER ISOLATION (Phase 3 gate): bob cannot see or mutate alice's product
    const bobGet = await app.inject({ method: 'GET', url: `/api/products/${product.id}`, cookies: bob.cookies() });
    assert.equal(bobGet.statusCode, 404);
    const bobDel = await app.inject({
      method: 'DELETE', url: `/api/products/${product.id}`,
      headers: { 'x-csrf-token': bob.cookies().manakai_csrf }, cookies: bob.cookies(),
    });
    assert.equal(bobDel.statusCode, 404);
    const bobPut = await app.inject({
      method: 'PUT', url: `/api/products/${product.id}`,
      headers: { 'x-csrf-token': bob.cookies().manakai_csrf }, cookies: bob.cookies(),
      payload: { name: 'Stolen' },
    });
    assert.equal(bobPut.statusCode, 404);

    // journey
    const journey = await app.inject({
      method: 'POST', url: '/api/journeys',
      headers: { 'x-csrf-token': alice.cookies().manakai_csrf }, cookies: alice.cookies(),
      payload: { productId: product.id },
    });
    assert.equal(journey.statusCode, 201, journey.body);
    const journeyId = journey.json().journeyId;

    // cross-user journey access
    const bobJourney = await app.inject({ method: 'GET', url: `/api/journeys/${journeyId}`, cookies: bob.cookies() });
    assert.equal(bobJourney.statusCode, 404);

    // checklist: idempotent creation
    const cl1 = await app.inject({
      method: 'POST', url: `/api/journeys/${journeyId}/checklist`,
      headers: { 'x-csrf-token': alice.cookies().manakai_csrf }, cookies: alice.cookies(),
    });
    assert.equal(cl1.statusCode, 201, cl1.body);
    const cl2 = await app.inject({
      method: 'POST', url: `/api/journeys/${journeyId}/checklist`,
      headers: { 'x-csrf-token': alice.cookies().manakai_csrf }, cookies: alice.cookies(),
    });
    assert.equal(cl2.statusCode, 200); // already exists
    assert.equal(cl2.json().created, false);

    const checklist = await app.inject({ method: 'GET', url: `/api/journeys/${journeyId}/checklist`, cookies: alice.cookies() });
    const tasks = checklist.json().tasks;
    assert.ok(tasks.length >= 5);
    assert.equal(tasks[0].state, 'not_started');
    assert.equal(tasks[1].state, 'locked');

    // state machine: locked -> completed is rejected
    const bad = await app.inject({
      method: 'POST', url: `/api/tasks/${tasks[1].id}/status`,
      headers: { 'x-csrf-token': alice.cookies().manakai_csrf }, cookies: alice.cookies(),
      payload: { state: 'completed' },
    });
    assert.equal(bad.statusCode, 400);

    // bob cannot touch alice's tasks
    const bobTask = await app.inject({
      method: 'POST', url: `/api/tasks/${tasks[0].id}/status`,
      headers: { 'x-csrf-token': bob.cookies().manakai_csrf }, cookies: bob.cookies(),
      payload: { state: 'in_progress' },
    });
    assert.equal(bobTask.statusCode, 404);

    // in_progress -> back -> complete
    const ip = await app.inject({
      method: 'POST', url: `/api/tasks/${tasks[0].id}/status`,
      headers: { 'x-csrf-token': alice.cookies().manakai_csrf }, cookies: alice.cookies(),
      payload: { state: 'in_progress' },
    });
    assert.equal(ip.statusCode, 200, ip.body);
    assert.equal(ip.json().state, 'in_progress');

    // complete via the completion endpoint: unlocks next task
    const done = await app.inject({
      method: 'POST', url: `/api/tasks/${tasks[0].id}/complete`,
      headers: { 'x-csrf-token': alice.cookies().manakai_csrf }, cookies: alice.cookies(),
    });
    assert.equal(done.statusCode, 200, done.body);
    assert.equal(done.json().task.state, 'completed');
    assert.ok(done.json().nextTask, 'next task returned');
    assert.ok(done.json().journeyProgressPct > 0);

    const after = await app.inject({ method: 'GET', url: `/api/journeys/${journeyId}/checklist`, cookies: alice.cookies() });
    assert.equal(after.json().tasks[1].state, 'not_started'); // unlocked
    assert.equal(after.json().progressPct, done.json().journeyProgressPct);

    // task detail carries source list (empty until AI seeds sources) + cross-user 404
    const detail = await app.inject({ method: 'GET', url: `/api/tasks/${tasks[0].id}`, cookies: alice.cookies() });
    assert.equal(detail.statusCode, 200);
    assert.ok(Array.isArray(detail.json().sources));
    const bobDetail = await app.inject({ method: 'GET', url: `/api/tasks/${tasks[0].id}`, cookies: bob.cookies() });
    assert.equal(bobDetail.statusCode, 404);

    // products list now shows journey progress
    const listAfter = await app.inject({ method: 'GET', url: '/api/products', cookies: alice.cookies() });
    assert.equal(listAfter.json()[0].journeyProgress, done.json().journeyProgressPct);

    // tests & labs endpoints respond with the documented shape
    const tests = await app.inject({ method: 'GET', url: `/api/journeys/${journeyId}/tests`, cookies: alice.cookies() });
    assert.equal(tests.statusCode, 200);
    assert.deepEqual(tests.json(), []);
    const labs = await app.inject({ method: 'GET', url: '/api/labs', cookies: alice.cookies() });
    assert.equal(labs.statusCode, 200);
    assert.equal(labs.json().disclaimer, 'Verify current recognition and availability with BIS.');
  }
);

test('task requirement checkbox persists', { skip }, async (t) => {
  const app = await buildApp({ databaseUrl: process.env.DATABASE_URL, logLevel: 'silent' });
  t.after(() => app.close());
  const u = await registerUser(app, `req-${Date.now()}@example.com`);
  const p = await app.inject({
    method: 'POST', url: '/api/products',
    headers: { 'x-csrf-token': u.cookies().manakai_csrf }, cookies: u.cookies(),
    payload: { name: 'Steel Bottle' },
  });
  const j = await app.inject({
    method: 'POST', url: '/api/journeys',
    headers: { 'x-csrf-token': u.cookies().manakai_csrf }, cookies: u.cookies(),
    payload: { productId: p.json().id },
  });
  await app.inject({
    method: 'POST', url: `/api/journeys/${j.json().journeyId}/checklist`,
    headers: { 'x-csrf-token': u.cookies().manakai_csrf }, cookies: u.cookies(),
  });
  const cl = await app.inject({ method: 'GET', url: `/api/journeys/${j.json().journeyId}/checklist`, cookies: u.cookies() });
  const taskId = cl.json().tasks[0].id;
  const upd = await app.inject({
    method: 'POST', url: `/api/tasks/${taskId}/requirements`,
    headers: { 'x-csrf-token': u.cookies().manakai_csrf }, cookies: u.cookies(),
    payload: { label: 'Note down the model number', done: true },
  });
  assert.equal(upd.statusCode, 200, upd.body);
  assert.deepEqual(upd.json().requirements, [{ label: 'Note down the model number', done: true }]);
});
