// AI pipeline integration — CI only. Seeds the LED vertical, runs a full
// discovery conversation through the mock provider, and checks the
// source-validation gate end-to-end (ADR-0002 Phase-4 gate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { migrate } from '../db/migrate.js';
import { ingest } from '../ingestion/ingest.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hasDb = Boolean(process.env.DATABASE_URL);
const skip = !hasDb ? 'DATABASE_URL not set' : false;
const here = path.dirname(fileURLToPath(import.meta.url));

test(
  'seeded discovery: zero unsourced requirements, unknowns render as unknown',
  { skip },
  async (t) => {
    await migrate(process.env.DATABASE_URL, { logger: { log: () => {} } });
    const manifest = JSON.parse(await readFile(path.join(here, '../ingestion/seed/led-lighting.json'), 'utf8'));
    const pgMod = await import('pg');
    const seedClient = new pgMod.default.Client({ connectionString: process.env.DATABASE_URL });
    await seedClient.connect();
    const n = await ingest(seedClient, manifest);
    await seedClient.end();
    assert.ok(n >= 3, 'seed documents ingested');

    const app = await buildApp({ databaseUrl: process.env.DATABASE_URL, logLevel: 'silent' });
    t.after(() => app.close());

    const email = `ai-${Date.now()}@example.com`;
    const reg = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { name: 'AI Tester', email, password: 'password-123' },
    });
    assert.equal(reg.statusCode, 201, reg.body);
    const session = reg.cookies.find((c) => c.name === 'manakai_session').value;
    const csrf = reg.cookies.find((c) => c.name === 'manakai_csrf').value;
    const cookies = () => ({ manakai_session: session, manakai_csrf: csrf });
    const headers = () => ({ 'x-csrf-token': csrf });

    // profile (so the orchestrator never re-asks) + product + journey
    await app.inject({ method: 'PUT', url: '/api/profile', headers: headers(), cookies: cookies(), payload: { businessName: 'Bulb Works', businessType: 'manufacturer', industry: 'Electrical / Lighting' } });
    const product = await app.inject({ method: 'POST', url: '/api/products', headers: headers(), cookies: cookies(), payload: { name: 'LED bulbs', category: 'Lighting', origin: 'manufactured', intendedUse: 'Household lighting' } });
    const journey = await app.inject({ method: 'POST', url: '/api/journeys', headers: headers(), cookies: cookies(), payload: { productId: product.json().id } });

    // discovery message (mock provider: grounded, deterministic)
    const msg = await app.inject({
      method: 'POST', url: `/api/journeys/${journey.json().journeyId}/messages`,
      headers: headers(), cookies: cookies(), payload: { content: 'Household LED bulbs for general lighting' },
    });
    assert.equal(msg.statusCode, 200, msg.body);
    const turn = msg.json();
    assert.ok(turn.messageId);
    assert.equal(typeof turn.reply, 'string');

    // plan: whatever is there must be grounded
    const plan = await app.inject({ method: 'GET', url: `/api/journeys/${journey.json().journeyId}/plan`, cookies: cookies() });
    assert.equal(plan.statusCode, 200);
    if (plan.json().ready) {
      for (const r of plan.json().summary.requirements) {
        assert.ok(['confirmed', 'likely', 'unknown'].includes(r.confidence));
      }
    }

    // PHASE-4 GATE: the seed now carries team-reviewed, verified rows, so a
    // 'confirmed' requirement is legitimate — but it must remain traceable
    // to at least one cited source. Demotion of requirements backed only by
    // unverified rows is covered by the ai.unit.test.js gate tests.
    const check = await app.inject({ method: 'GET', url: `/api/journeys/${journey.json().journeyId}/plan`, cookies: cookies() });
    const allReqs = check.json().summary.requirements;
    for (const r of allReqs) {
      if (r.confidence === 'confirmed') {
        assert.ok(Array.isArray(r.sourceIds) && r.sourceIds.length > 0, 'confirmed requirements must cite sources');
      }
    }

    // checklist built from discovery requirements carries source traceability
    const cl = await app.inject({ method: 'POST', url: `/api/journeys/${journey.json().journeyId}/checklist`, headers: headers(), cookies: cookies() });
    assert.equal(cl.statusCode, 201, cl.body);
    const checklist = await app.inject({ method: 'GET', url: `/api/journeys/${journey.json().journeyId}/checklist`, cookies: cookies() });
    const tasks = checklist.json().tasks;
    assert.ok(tasks.length > 5, 'starter + requirements tasks');

    // a requirements-based task links task_requirements + task_sources
    const verifyTask = tasks.find((tk) => tk.title.startsWith('Verify:'));
    if (verifyTask) {
      const detail = await app.inject({ method: 'GET', url: `/api/tasks/${verifyTask.id}`, cookies: cookies() });
      assert.equal(detail.statusCode, 200);
      assert.ok(Array.isArray(detail.json().sources));
    }

    // task assist: grounded reply with citations (or honest can't-answer)
    const first = tasks.find((tk) => tk.state === 'not_started');
    const assist = await app.inject({
      method: 'POST', url: `/api/tasks/${first.id}/assist/messages`,
      headers: headers(), cookies: cookies(), payload: { content: 'What does the standard cover?' },
    });
    assert.equal(assist.statusCode, 200, assist.body);
    assert.ok(Array.isArray(assist.json().citations));
  }
);
