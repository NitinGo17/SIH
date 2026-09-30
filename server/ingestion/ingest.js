// Ingestion pipeline (docs/architecture.md §6):
//   manifest JSON -> sources upsert -> kb_documents (content_hash dedupe)
//   -> chunk (~600-800 tokens, headings kept) -> embed -> kb_chunks
//
// Usage: node ingestion/ingest.js ingestion/seed/led-lighting.json
// Every row must carry authority/title/url. A row with `"verified": true`
// has been reviewed against its official source; rows without it are
// INGESTED but stay `verified = false` until team review — only verified
// rows back 'confirmed' (ADR-0002 source-validation gate).
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { embed, aiConfig } from '../ai/provider.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function chunkText(text, targetWords = 320, overlapWords = 40) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < words.length; i += targetWords - overlapWords) {
    chunks.push(words.slice(i, i + targetWords).join(' '));
    if (i + targetWords >= words.length) break;
  }
  return chunks.length ? chunks : [String(text)];
}

export async function ingest(db, manifest) {
  let ingested = 0;
  for (const doc of manifest.documents) {
    const contentHash = createHash('sha256').update(doc.text).digest('hex');

    const { rows: sr } = await db.query(
      `INSERT INTO sources (authority, document_title, section, url, published_at, last_verified)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING RETURNING id`,
      [doc.authority, doc.title, doc.section ?? null, doc.url, doc.published_at ?? null, doc.last_verified]
    );
    let sourceId = sr[0]?.id;
    if (!sourceId) {
      const { rows } = await db.query(`SELECT id FROM sources WHERE url = $1 AND document_title = $2`, [doc.url, doc.title]);
      sourceId = rows[0].id;
    }

    // A re-ingested source with corrected text supersedes its old documents:
    // drop superseded kb_documents (chunks cascade) so stale chunks are
    // never retrieved alongside the corrected text.
    await db.query(
      `DELETE FROM kb_documents WHERE source_id = $1 AND content_hash <> $2`,
      [sourceId, contentHash]
    );

    const { rows: dr } = await db.query(
      `INSERT INTO kb_documents (source_id, content_hash) VALUES ($1, $2)
       ON CONFLICT (source_id, content_hash) DO NOTHING RETURNING id`,
      [sourceId, contentHash]
    );
    if (dr.length === 0) continue; // unchanged document — skip

    // curated standard row — `verified` flows from the manifest after team
    // review of the source; unreviewed rows stay false and never back 'confirmed'
    if (doc.standard) {
      await db.query(
        `INSERT INTO standards (is_number, title, description, latest_source, verified)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (is_number) DO UPDATE SET latest_source = $4, verified = $5`,
        [doc.standard, doc.title, doc.description ?? null, sourceId, doc.verified === true]
      );
    }

    const chunks = chunkText(doc.text);
    for (let i = 0; i < chunks.length; i++) {
      const vector = await embed(chunks[i]);
      await db.query(
        `INSERT INTO kb_chunks (document_id, chunk_index, text, embedding) VALUES ($1, $2, $3, $4)`,
        [dr[0].id, i, chunks[i], `[${vector.map((v) => Number(v.toFixed(6))).join(',')}]`]
      );
    }
    ingested += 1;
  }
  return ingested;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const manifestPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, 'seed', 'led-lighting.json');
  const db = (await import('pg')).default;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (see docker-compose.yml)');
    process.exit(1);
  }
  const client = new db.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const n = await ingest(client, manifest);
    console.log(`ingested ${n} document(s) from ${path.basename(manifestPath)} (provider: ${aiConfig().provider})`);
    console.log('rows without `"verified": true` remain verified=false until team review flips them');
  } finally {
    await client.end();
  }
}
