// Laboratory + test ingestion (docs/architecture.md §6, docs/database.md).
//
// Labs and tests are curated knowledge-base rows: every row MUST carry a
// traceable source (authority, document title, url, last-verified date). A row
// is stored with `verified = false` unless the manifest explicitly marks it
// `"verified": true` after team review against the official source — the
// ADR-0002 source-validation gate. Only verified lab rows back the UI.
//
// Usage: node ingestion/ingest-labs.js <manifest.json>
//        (manifest shape documented in ingestion/README.md)
//
// NOTHING here invents compliance data: a row without a complete `source`
// object is rejected, and the app only reads `laboratories.verified = true`.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const REQUIRED_SOURCE_FIELDS = ['authority', 'title', 'url', 'last_verified'];

/** Validate a row's source block; throws a precise message otherwise. */
function assertSource(kind, label, source) {
  if (!source || typeof source !== 'object') {
    throw new Error(`${kind} "${label}" is missing its "source" object`);
  }
  for (const field of REQUIRED_SOURCE_FIELDS) {
    if (typeof source[field] !== 'string' || source[field].trim() === '') {
      throw new Error(`${kind} "${label}" source.${field} is required`);
    }
  }
}

/** Upsert a source row, returning its id. Deduped by (url, document_title). */
async function upsertSource(db, source) {
  const { rows } = await db.query(
    `INSERT INTO sources (authority, document_title, section, url, published_at, last_verified)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING RETURNING id`,
    [source.authority, source.title, source.section ?? null, source.url,
      source.published_at ?? null, source.last_verified]
  );
  if (rows[0]) return rows[0].id;
  const { rows: existing } = await db.query(
    `SELECT id FROM sources WHERE url = $1 AND document_title = $2`,
    [source.url, source.title]
  );
  return existing[0].id;
}

async function ingestLaboratory(db, lab) {
  const label = lab.name ?? '(unnamed)';
  assertSource('laboratory', label, lab.source);
  if (typeof lab.name !== 'string' || lab.name.trim() === '') {
    throw new Error('laboratory row is missing "name"');
  }

  const sourceId = await upsertSource(db, lab.source);
  const verified = lab.verified === true;
  const capabilities = Array.isArray(lab.capabilities) ? lab.capabilities : [];

  const { rows: existing } = await db.query(
    `SELECT id FROM laboratories WHERE name = $1 AND source_id = $2`,
    [lab.name, sourceId]
  );
  if (existing[0]) {
    await db.query(
      `UPDATE laboratories
          SET city = $2, state = $3, capabilities = $4, website = $5,
              last_verified = $6, verified = $7
        WHERE id = $1`,
      [existing[0].id, lab.city ?? null, lab.state ?? null, capabilities,
        lab.website ?? null, lab.source.last_verified, verified]
    );
    return;
  }
  await db.query(
    `INSERT INTO laboratories
       (name, city, state, capabilities, website, source_id, last_verified, verified)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [lab.name, lab.city ?? null, lab.state ?? null, capabilities,
      lab.website ?? null, sourceId, lab.source.last_verified, verified]
  );
}

async function ingestTest(db, test) {
  const label = test.name ?? '(unnamed)';
  assertSource('test', label, test.source);
  if (typeof test.name !== 'string' || test.name.trim() === '') {
    throw new Error('test row is missing "name"');
  }
  if (typeof test.purpose !== 'string' || test.purpose.trim() === '') {
    throw new Error(`test "${label}" is missing "purpose"`);
  }

  const sourceId = await upsertSource(db, test.source);
  const { rows: existing } = await db.query(
    `SELECT id FROM tests WHERE name = $1 AND source_id = $2`,
    [test.name, sourceId]
  );
  if (existing[0]) {
    await db.query(
      `UPDATE tests SET purpose = $2, standard_id = $3 WHERE id = $1`,
      [existing[0].id, test.purpose, test.standard ?? null]
    );
    return;
  }
  await db.query(
    `INSERT INTO tests (name, purpose, standard_id, source_id) VALUES ($1, $2, $3, $4)`,
    [test.name, test.purpose, test.standard ?? null, sourceId]
  );
}

/**
 * Ingest laboratories + tests from a manifest.
 * @param {{query: Function}} db  pg pool or client
 * @param {{laboratories?: Array<object>, tests?: Array<object>}} manifest
 * @returns {Promise<{laboratories: number, tests: number}>}
 */
export async function ingestLabs(db, manifest) {
  const counts = { laboratories: 0, tests: 0 };
  for (const lab of manifest.laboratories ?? []) {
    await ingestLaboratory(db, lab);
    counts.laboratories += 1;
  }
  for (const test of manifest.tests ?? []) {
    await ingestTest(db, test);
    counts.tests += 1;
  }
  return counts;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const manifestPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (!manifestPath) {
    console.error('usage: node ingestion/ingest-labs.js <manifest.json> (see ingestion/README.md)');
    process.exit(1);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (see docker-compose.yml)');
    process.exit(1);
  }
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const counts = await ingestLabs(client, manifest);
    console.log(
      `ingested ${counts.laboratories} laboratory row(s) and ${counts.tests} test row(s) ` +
      `from ${path.basename(manifestPath)}`
    );
    console.log('rows stay verified=false unless the manifest set "verified": true after review');
  } finally {
    await client.end();
  }
}
