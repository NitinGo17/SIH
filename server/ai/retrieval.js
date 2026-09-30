// Retrieval: pgvector cosine similarity + keyword fallback over kb_chunks,
// always returning source metadata (ADR-0002: retrieved chunks are the only
// permitted factual grounding).
import { embed } from './provider.js';

/**
 * @param {import('pg').Pool} db
 * @param {string} query
 * @param {{limit?: number, minScore?: number}} opts
 * @returns {Promise<Array<{source_id, chunk_id, authority, title, section, url,
 *   verified, published_at, text, score}>>}
 */
export async function retrieve(db, query, opts = {}) {
  const limit = opts.limit ?? 6;
  const minScore = opts.minScore ?? 0.05;
  const vec = await embed(query);
  const vecLiteral = `[${vec.map((v) => Number(v.toFixed(6))).join(',')}]`;

  const { rows } = await db.query(
    `SELECT c.id AS chunk_id, s.id AS source_id, s.authority, s.document_title AS title,
            s.section, s.url, s.last_verified, s.published_at,
            st.verified, c.text,
            1 - (c.embedding <=> $1::vector) AS score
     FROM kb_chunks c
     JOIN kb_documents d ON d.id = c.document_id
     JOIN sources s ON s.id = d.source_id
     LEFT JOIN standards st ON st.latest_source = s.id
     WHERE s.id IN (
       SELECT s2.id FROM sources s2  -- keyword safety net
       WHERE s2.document_title ILIKE '%' || $2 || '%'
          OR EXISTS (SELECT 1 FROM kb_chunks c2 JOIN kb_documents d2 ON d2.id = c2.document_id
                     WHERE d2.source_id = s2.id AND c2.text ILIKE '%' || $2 || '%')
     ) OR c.id IN (
       SELECT id FROM kb_chunks ORDER BY embedding <=> $1::vector LIMIT $3
     )
     ORDER BY c.embedding <=> $1::vector
     LIMIT $3`,
    [vecLiteral, queryWords(query), limit]
  );

  return rows
    .filter((r) => Number(r.score) >= minScore)
    .map((r) => ({
      source_id: r.source_id,
      chunk_id: r.chunk_id,
      authority: r.authority,
      title: r.title,
      section: r.section,
      url: r.url,
      last_verified: r.last_verified,
      verified: Boolean(r.verified),
      published_at: r.published_at,
      text: r.text,
      score: Number(r.score),
    }));
}

function queryWords(query) {
  return String(query).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).slice(0, 3).join(' ');
}
