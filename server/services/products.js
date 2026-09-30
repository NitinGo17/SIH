// Products + journeys data access. EVERY query is scoped by user_id
// (route guard + service-level WHERE — docs/architecture.md §8).
export class NotFoundError extends Error {
  constructor() {
    super('product not found');
    this.code = 'NOT_FOUND';
  }
}

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.category, p.origin, p.compliance_stage,
         COALESCE(j.progress_pct, 0) AS journey_progress,
         j.id AS journey_id, j.status AS journey_status,
         j.current_task_id
  FROM products p
  LEFT JOIN LATERAL (
    SELECT * FROM journeys j
    WHERE j.product_id = p.id AND j.status IN ('discovery','active','completed')
    ORDER BY j.created_at DESC LIMIT 1
  ) j ON true
  WHERE p.user_id = $1
`;

const COMPLIANCE_STAGES = new Set(['exploring', 'product_development', 'testing', 'certification', 'already_certified']);
export const isComplianceStage = (v) => COMPLIANCE_STAGES.has(v);

function rowToProduct(r) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    origin: r.origin,
    complianceStage: r.compliance_stage,
    journeyProgress: r.journey_progress,
    journeyId: r.journey_id,
    currentStage: r.journey_status,
    currentTaskId: r.current_task_id,
  };
}

/** List the user's products with their latest active journey's progress. */
export async function listProducts(db, userId) {
  const { rows } = await db.query(`${PRODUCT_SELECT} ORDER BY p.created_at DESC`, [userId]);
  return rows.map(rowToProduct);
}

export async function getProduct(db, userId, productId) {
  const { rows } = await db.query(`${PRODUCT_SELECT} AND p.id = $2`, [userId, productId]);
  if (rows.length === 0) throw new NotFoundError();
  return rowToProduct(rows[0]);
}

export async function createProduct(db, userId, fields) {
  const { rows } = await db.query(
    `INSERT INTO products (user_id, name, category, origin, manufacturing_location, intended_use, compliance_stage)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [userId, fields.name, fields.category ?? null, fields.origin ?? null,
     fields.manufacturingLocation ?? null, fields.intendedUse ?? null, fields.complianceStage ?? null]
  );
  return getProduct(db, userId, rows[0].id);
}

export async function updateProduct(db, userId, productId, fields) {
  await getProduct(db, userId, productId); // 404 or 403-equivalent for other users' rows
  const sets = [];
  const values = [userId, productId];
  const map = {
    name: 'name', category: 'category', origin: 'origin',
    manufacturingLocation: 'manufacturing_location', intendedUse: 'intended_use',
    complianceStage: 'compliance_stage',
  };
  for (const [key, col] of Object.entries(map)) {
    if (fields[key] !== undefined) {
      values.push(fields[key]);
      sets.push(`${col} = $${values.length}`);
    }
  }
  if (sets.length) {
    await db.query(`UPDATE products SET ${sets.join(', ')}, updated_at = now() WHERE user_id = $1 AND id = $2`, values);
  }
  return getProduct(db, userId, productId);
}

export async function deleteProduct(db, userId, productId) {
  const result = await db.query(`DELETE FROM products WHERE user_id = $1 AND id = $2`, [userId, productId]);
  if (result.rowCount === 0) throw new NotFoundError();
}

// ---------- journeys ----------

export async function createJourney(db, userId, productId) {
  await getProduct(db, userId, productId);
  const { rows } = await db.query(
    `INSERT INTO journeys (product_id, user_id, status) VALUES ($2, $1, 'discovery') RETURNING id`,
    [userId, productId]
  );
  return { journeyId: rows[0].id, status: 'discovery' };
}

/** Journey scoped to its owner; joins product info. */
export async function getJourney(db, userId, journeyId) {
  const { rows } = await db.query(
    `SELECT j.id, j.status, j.progress_pct, j.current_task_id,
            p.id AS product_id, p.name AS product_name, p.category AS product_category
     FROM journeys j
     JOIN products p ON p.id = j.product_id
     WHERE j.id = $1 AND j.user_id = $2`,
    [journeyId, userId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id, status: r.status, progressPct: r.progress_pct, currentTaskId: r.current_task_id,
    product: { id: r.product_id, name: r.product_name, category: r.product_category },
  };
}

/** Recent activity for the dashboard: newest products + journeys. */
export async function recentActivity(db, userId, limit = 5) {
  const { rows } = await db.query(
    `SELECT text, when_at FROM (
       SELECT p.name || ' added to your products' AS text, p.created_at AS when_at
       FROM products p WHERE p.user_id = $1
       UNION ALL
       SELECT 'Journey started for ' || pr.name AS text, j.created_at AS when_at
       FROM journeys j JOIN products pr ON pr.id = j.product_id
       WHERE j.user_id = $1
     ) act ORDER BY when_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows.map((r) => ({ when: r.when_at.toISOString().slice(0, 10), text: r.text }));
}
