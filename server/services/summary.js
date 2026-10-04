// Journey summary (docs/implementation-order.md Phase 7 gate: "summary matches
// persisted data"). Every value is read from the database — nothing is
// invented (README core rule #1 / ADR-0002). The only generated copy is
// process-level and source-free by design; no standard numbers, fees,
// deadlines or certification claims are ever produced here.

export class SummaryNotFoundError extends Error {
  constructor() {
    super('journey not found');
    this.code = 'NOT_FOUND';
  }
}

/**
 * Build the final compliance summary for a completed/ongoing journey,
 * owner-scoped. Shape matches server/templates/summary.eta.
 * @param {import('pg').Pool} db
 * @param {string} userId
 * @param {string} journeyId
 */
export async function getJourneySummary(db, userId, journeyId) {
  const { rows: jr } = await db.query(
    `SELECT j.id, j.status, j.progress_pct,
            p.name AS product_name, p.category AS product_category
     FROM journeys j JOIN products p ON p.id = j.product_id
     WHERE j.id = $1 AND j.user_id = $2`,
    [journeyId, userId]
  );
  if (jr.length === 0) throw new SummaryNotFoundError();
  const j = jr[0];

  const [standards, tests, docs, outstanding, sources] = await Promise.all([
    // standards / requirements discovered for this journey (never re-derived here)
    db.query(
      `SELECT title, confidence FROM journey_requirements
       WHERE journey_id = $1 AND type = 'standard' ORDER BY created_at`,
      [journeyId]
    ),
    // required tests and their persisted status
    db.query(
      `SELECT t.name, jt.status FROM journey_tests jt
       JOIN tests t ON t.id = jt.test_id
       WHERE jt.journey_id = $1 ORDER BY t.name`,
      [journeyId]
    ),
    // distinct documents the checklist asks for (task.documents jsonb)
    db.query(
      `SELECT DISTINCT jsonb_array_elements_text(t.documents) AS document
       FROM tasks t JOIN checklists c ON c.id = t.checklist_id
       WHERE c.journey_id = $1 AND jsonb_typeof(t.documents) = 'array'`,
      [journeyId]
    ),
    // tasks not yet completed
    db.query(
      `SELECT t.title FROM tasks t JOIN checklists c ON c.id = t.checklist_id
       WHERE c.journey_id = $1 AND t.state <> 'completed' ORDER BY t.position`,
      [journeyId]
    ),
    // every source that backs a task on this journey (traceability)
    db.query(
      `SELECT DISTINCT s.authority, s.document_title, s.section, s.url, s.last_verified
       FROM task_sources ts
       JOIN tasks t ON t.id = ts.task_id
       JOIN checklists c ON c.id = t.checklist_id
       JOIN sources s ON s.id = ts.source_id
       WHERE c.journey_id = $1
       ORDER BY s.authority, s.document_title`,
      [journeyId]
    ),
  ]);

  const completed = j.status === 'completed';
  return {
    journeyId,
    product: { name: j.product_name, category: j.product_category },
    standards: standards.rows.map((r) => ({ title: r.title, confidence: r.confidence })),
    tests: tests.rows.map((r) => ({ name: r.name, status: r.status })),
    documents: docs.rows.map((r) => r.document),
    outstanding: outstanding.rows.map((r) => ({ title: r.title })),
    certification: {
      status: completed
        ? 'All checklist tasks are complete.'
        : 'In progress — some tasks are still outstanding.',
      note: 'ManakAI provides guidance, not official BIS approval. Confirm certification requirements with BIS.',
    },
    sourcesCount: sources.rows.length,
    sources: sources.rows.map((r) => ({
      authority: r.authority,
      documentTitle: r.document_title,
      section: r.section,
      url: r.url,
      lastVerified: r.last_verified,
    })),
  };
}
