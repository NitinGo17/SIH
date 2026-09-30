// Integration test — requires a real Postgres with pgvector (CI runs it against
// a pgvector/pgvector:pg16 service). Skipped when DATABASE_URL is unset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { migrate, listMigrations } from '../db/migrate.js';

const hasDb = Boolean(process.env.DATABASE_URL);

test('migration files are numbered and ordered', async () => {
  const migrations = await listMigrations();
  assert.ok(migrations.length >= 1);
  assert.match(migrations[0].name, /^001_init$/);
});

test(
  'migrations apply cleanly and are idempotent',
  { skip: !hasDb ? 'DATABASE_URL not set' : false },
  async () => {
    // First run applies; second run is a no-op.
    await migrate(process.env.DATABASE_URL, { logger: { log: () => {} } });
    const count = await migrate(process.env.DATABASE_URL, { logger: { log: () => {} } });
    assert.equal(count, 0, 'second migrate run must apply nothing');

    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const tables = [
        'users', 'sessions', 'profiles', 'products', 'journeys', 'conversations',
        'messages', 'sources', 'standards', 'qcos', 'qco_products', 'laboratories',
        'tests', 'journey_requirements', 'journey_tests', 'checklists', 'tasks',
        'task_requirements', 'task_sources', 'evidence', 'kb_documents', 'kb_chunks',
      ];
      const { rows } = await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
      );
      const present = new Set(rows.map((r) => r.table_name));
      for (const t of tables) assert.ok(present.has(t), `missing table: ${t}`);

      const { rows: idx } = await client.query(
        `SELECT indexname FROM pg_indexes WHERE indexname = 'kb_chunks_vec_idx'`
      );
      assert.ok(idx.length === 1, 'pgvector HNSW index missing');
    } finally {
      await client.end();
    }
  }
);
