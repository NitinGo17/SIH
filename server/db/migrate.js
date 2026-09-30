// Migration runner: applies numbered SQL files from db/migrations in order,
// each inside a transaction, tracked in schema_migrations. No ORM (docs/database.md §3).
//
// Usage:
//   node db/migrate.js            # apply pending migrations
//   node db/migrate.js --status    # list applied/pending
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, 'migrations');

export async function listMigrations() {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  return files.map((file) => ({
    file,
    name: file.replace(/\.sql$/, ''),
  }));
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/** @param {pg.Pool|pg.Client} conn @param {string} databaseUrl */
export async function migrate(databaseUrl, { logger = console } = {}) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await ensureTable(client);
    const { rows: applied } = await client.query('SELECT name FROM schema_migrations');
    const appliedSet = new Set(applied.map((r) => r.name));

    const migrations = await listMigrations();
    let count = 0;
    for (const { name } of migrations) {
      if (appliedSet.has(name)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, `${name}.sql`), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        count += 1;
        logger.log(`applied ${name}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${name} failed: ${err.message}`);
      }
    }
    if (count === 0) logger.log('no pending migrations');
    return count;
  } finally {
    await client.end();
  }
}

// ---- CLI ----
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required to run migrations (see docker-compose.yml)');
    process.exit(1);
  }
  if (process.argv.includes('--status')) {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await ensureTable(client);
      const { rows } = await client.query('SELECT name FROM schema_migrations ORDER BY name');
      const applied = new Set(rows.map((r) => r.name));
      for (const { name } of await listMigrations()) {
        console.log(`${applied.has(name) ? 'applied ' : 'pending '} ${name}`);
      }
    } finally {
      await client.end();
    }
  } else {
    await migrate(databaseUrl);
  }
}
