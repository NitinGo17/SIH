// Checklist + tasks. The state machine is enforced HERE (docs/api.md §7):
//   locked -> not_started   (server-side unlock only, on complete of the previous task)
//   not_started <-> in_progress
//   not_started/in_progress -> completed
//   completed -> in_progress (reopen)
// progress_pct = completed / total, recomputed on every transition.
export class TaskNotFoundError extends Error {
  constructor() { super('task not found'); this.code = 'NOT_FOUND'; }
}
export class InvalidTransitionError extends Error {
  constructor() { super('invalid state transition'); this.code = 'VALIDATION_ERROR'; }
}

const STAGE_ORDER = ['understand', 'requirements', 'testing', 'documentation', 'certification'];

// Generic, process-level starter steps (NO compliance claims — README core
// rule #1; standards-specific tasks appear only via validated AI discovery).
const STARTER_TASKS = [
  { stage: 'understand', title: 'Describe your product and how it is used', explanation: 'A clear product description is the basis for every compliance decision that follows.' },
  { stage: 'understand', title: 'Confirm how the product reaches the market', explanation: 'Manufactured in India vs imported changes which rules and checks apply.' },
  { stage: 'requirements', title: 'Identify applicable standards and QCOs', explanation: 'Find out which Indian Standards or Quality Control Orders cover the product.' },
  { stage: 'requirements', title: 'Verify each requirement with its official source', explanation: 'Every requirement must be traceable to an official source before you act on it.' },
  { stage: 'testing', title: 'Plan the required testing', explanation: 'Work out which tests apply and where they can be performed.' },
  { stage: 'documentation', title: 'Prepare your technical documentation', explanation: 'Product specifications, test reports and declarations typically need to be assembled.' },
  { stage: 'certification', title: 'Understand the certification or registration path', explanation: 'Licence, registration or self-declaration — the route depends on the product.' },
];

const VALID_TRANSITIONS = {
  locked: [],
  not_started: ['in_progress', 'completed'],
  in_progress: ['not_started', 'completed'],
  completed: ['in_progress'],
  requires_verification: ['completed', 'in_progress'],
};

/** Idempotent: a journey has at most one checklist; returns the existing one. */
export async function createChecklist(db, userId, journeyId) {
  const journey = await getJourneyScoped(db, userId, journeyId);
  if (!journey) return null;

  const existing = await db.query(`SELECT id FROM checklists WHERE journey_id = $1`, [journeyId]);
  if (existing.rows.length > 0) return { checklistId: existing.rows[0].id, created: false };

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: cl } = await client.query(
      `INSERT INTO checklists (journey_id) VALUES ($1) RETURNING id`, [journeyId]
    );
    const checklistId = cl[0].id;
    let position = 1;
    for (const t of STARTER_TASKS) {
      await client.query(
        `INSERT INTO tasks (checklist_id, position, title, explanation, stage, state)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [checklistId, position, t.title, t.explanation, t.stage, position === 1 ? 'not_started' : 'locked']
      );
      position += 1;
    }
    await client.query(`UPDATE journeys SET status = 'active', updated_at = now() WHERE id = $1`, [journeyId]);
    await client.query('COMMIT');
    return { checklistId, created: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getJourneyScoped(db, userId, journeyId) {
  const { rows } = await db.query(
    `SELECT j.id FROM journeys j WHERE j.id = $1 AND j.user_id = $2`, [journeyId, userId]
  );
  return rows[0] ?? null;
}

/** Checklist with tasks, for the checklist page + GET endpoint. */
export async function getChecklist(db, userId, journeyId) {
  const { rows: js } = await db.query(
    `SELECT j.id, j.progress_pct, p.name AS product_name, p.category AS product_category
     FROM journeys j JOIN products p ON p.id = j.product_id
     WHERE j.id = $1 AND j.user_id = $2`, [journeyId, userId]
  );
  if (js.length === 0) return null;
  const j = js[0];
  const { rows: tasks } = await db.query(
    `SELECT t.id, t.position, t.title, t.stage, t.state, t.completed_at
     FROM tasks t JOIN checklists c ON c.id = t.checklist_id
     WHERE c.journey_id = $1 ORDER BY t.position`, [journeyId]
  );
  return {
    journeyId,
    product: { name: j.product_name, category: j.product_category },
    progressPct: j.progress_pct,
    tasks: tasks.map((t) => ({
      id: t.id, position: t.position, title: t.title, stage: t.stage,
      state: t.state, completedAt: t.completed_at,
    })),
  };
}

/** Full task payload (docs/api.md §7 GET /api/tasks/:id), owner-scoped. */
export async function getTask(db, userId, taskId) {
  const { rows } = await db.query(
    `SELECT t.id, t.position, t.title, t.explanation, t.requirements, t.documents, t.stage, t.state, t.completed_at,
            c.journey_id, j.current_task_id,
            (SELECT json_agg(json_build_object(
              'authority', s.authority, 'documentTitle', s.document_title, 'section', s.section,
              'url', s.url, 'lastVerified', s.last_verified))
             FROM task_sources ts JOIN sources s ON s.id = ts.source_id WHERE ts.task_id = t.id) AS sources,
            (SELECT t2.id FROM tasks t2 JOIN checklists c2 ON c2.id = t2.checklist_id
             WHERE c2.journey_id = c.journey_id AND t2.position = t.position + 1) AS next_task_id
     FROM tasks t
     JOIN checklists c ON c.id = t.checklist_id
     JOIN journeys j ON j.id = c.journey_id
     WHERE t.id = $1 AND j.user_id = $2`,
    [taskId, userId]
  );
  if (rows.length === 0) throw new TaskNotFoundError();
  const r = rows[0];
  let nextTask = null;
  if (r.next_task_id) {
    const { rows: nr } = await db.query(`SELECT id, title FROM tasks WHERE id = $1`, [r.next_task_id]);
    nextTask = nr[0] ? { id: nr[0].id, title: nr[0].title } : null;
  }
  return {
    id: r.id, position: r.position, title: r.title, stage: r.stage, state: r.state,
    explanation: r.explanation, requirements: r.requirements, documents: r.documents,
    completedAt: r.completed_at, sources: r.sources ?? [],
    journeyId: r.journey_id, nextTask,
    isCurrentTask: r.current_task_id === r.id,
  };
}

async function recomputeProgress(db, journeyId) {
  const { rows } = await db.query(
    `UPDATE journeys j SET progress_pct = sub.pct, updated_at = now()
     FROM (
       SELECT c.journey_id,
         COALESCE(round(100.0 * count(*) FILTER (WHERE t.state = 'completed') / NULLIF(count(*), 0)), 0)::smallint AS pct
       FROM tasks t JOIN checklists c ON c.id = t.checklist_id
       GROUP BY c.journey_id
     ) sub
     WHERE j.id = sub.journey_id AND j.id = $1
     RETURNING j.progress_pct`,
    [journeyId]
  );
  return rows[0]?.progress_pct ?? 0;
}

/** POST /api/tasks/:id/status — validate + apply a transition. */
export async function setTaskState(db, userId, taskId, nextState) {
  const task = await getTask(db, userId, taskId);
  if (!VALID_TRANSITIONS[task.state]?.includes(nextState)) throw new InvalidTransitionError();
  await db.query(
    `UPDATE tasks SET state = $2, completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE NULL END WHERE id = $1`,
    [taskId, nextState]
  );
  const progressPct = await recomputeProgress(db, task.journeyId);
  return { ...(await getTask(db, userId, taskId)), journeyProgressPct: progressPct };
}

/** POST /api/tasks/:id/complete — complete, unlock next, update journey pointer. */
export async function completeTask(db, userId, taskId) {
  const task = await getTask(db, userId, taskId);
  if (task.state === 'locked') throw new InvalidTransitionError();
  await db.query(`UPDATE tasks SET state = 'completed', completed_at = now() WHERE id = $1`, [taskId]);
  if (task.nextTask) {
    await db.query(
      `UPDATE tasks SET state = 'not_started' WHERE id = $1 AND state = 'locked'`, [task.nextTask.id]
    );
    await db.query(`UPDATE journeys SET current_task_id = $2 WHERE id = $1`, [task.journeyId, task.nextTask.id]);
  } else {
    await db.query(`UPDATE journeys SET current_task_id = NULL WHERE id = $1`, [task.journeyId]);
  }
  const progressPct = await recomputeProgress(db, task.journeyId);
  if (progressPct === 100) {
    await db.query(`UPDATE journeys SET status = 'completed' WHERE id = $1`, [task.journeyId]);
  }
  return { task: await getTask(db, userId, taskId), nextTask: task.nextTask, journeyProgressPct: progressPct };
}

/** POST /api/tasks/:id/requirements — persist checkbox state. */
export async function setTaskRequirement(db, userId, taskId, label, done) {
  const task = await getTask(db, userId, taskId);
  const reqs = (task.requirements ?? []).map((r) => (r.label === label ? { ...r, done } : r));
  await db.query(`UPDATE tasks SET requirements = $2 WHERE id = $1`, [taskId, JSON.stringify(reqs)]);
  return getTask(db, userId, taskId);
}

export { STAGE_ORDER };
