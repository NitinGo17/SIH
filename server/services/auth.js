// Auth data access (users, sessions, profiles). All functions take the pg
// pool (or a client inside a transaction). No ORM, typed row mappers only
// (docs/database.md §3).
import { hashToken, generateToken } from '../lib/tokens.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Update last_seen_at at most this often to avoid write amplification.
const LAST_SEEN_EVERY_MS = 60 * 1000;

const PUBLIC_USER = `
  SELECT u.id, u.email, u.display_name,
         COALESCE(p.is_complete, false) AS profile_complete,
         s.last_seen_at
  FROM users u
  LEFT JOIN profiles p ON p.user_id = u.id
`;

export class EmailTakenError extends Error {
  constructor() {
    super('email already registered');
    this.code = 'EMAIL_TAKEN';
  }
}

/** @returns {Promise<{id, email, passwordHash, displayName, profileComplete}>} */
export async function getUserByEmail(db, email) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.password_hash, u.display_name,
            COALESCE(p.is_complete, false) AS profile_complete
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.email = $1`,
    [email]
  );
  return rows[0] ?? null;
}

/** Create a user (and an empty profile row). Throws EmailTakenError on 23505. */
export async function createUser(db, { email, passwordHash, displayName }) {
  try {
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [email, passwordHash, displayName]
    );
    await db.query(`INSERT INTO profiles (user_id) VALUES ($1)`, [rows[0].id]);
    return { id: rows[0].id };
  } catch (err) {
    if (err.code === '23505') throw new EmailTakenError();
    throw err;
  }
}

/** Create a session; returns the opaque token (only its hash is stored). */
export async function createSession(db, userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
    [hashToken(token), userId, expiresAt]
  );
  return token;
}

/** Look up a session by token; refreshes last_seen_at (throttled). */
export async function getUserBySessionToken(db, token) {
  const tokenHash = hashToken(token);
  const { rows } = await db.query(
    `${PUBLIC_USER}
     JOIN sessions s ON s.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHash]
  );
  const user = rows[0] ?? null;
  if (user && Date.now() - new Date(user.last_seen_at ?? 0).getTime() > LAST_SEEN_EVERY_MS) {
    // fire and forget — never block the request on this
    db.query(`UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1`, [tokenHash]).catch(() => {});
  }
  return user;
}

export async function deleteSession(db, token) {
  await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
}

/** Session rotation on login: invalidate every existing session of the user. */
export async function deleteSessionsForUser(db, userId) {
  await db.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

/** Session counts for /api/me. */
export async function getUserCounts(db, userId) {
  const { rows } = await db.query(
    `SELECT
       (SELECT count(*) FROM products WHERE user_id = $1)::int AS product_count,
       (SELECT count(*) FROM journeys WHERE user_id = $1 AND status IN ('discovery','active'))::int AS active_journey_count`,
    [userId]
  );
  return rows[0] ?? { product_count: 0, active_journey_count: 0 };
}

// ---------- profile ----------

const BUSINESS_TYPES = new Set(['msme', 'startup', 'manufacturer', 'importer', 'entrepreneur', 'other']);
export const isBusinessType = (value) => BUSINESS_TYPES.has(value);

export function isProfileComplete({ businessName, businessType }) {
  return Boolean(businessName && businessType);
}

/** @returns {Promise<{businessName, businessType, industry, isComplete}>} */
export async function getProfile(db, userId) {
  const { rows } = await db.query(
    `SELECT business_name, business_type, industry, is_complete
     FROM profiles WHERE user_id = $1`,
    [userId]
  );
  const p = rows[0];
  if (!p) return { businessName: null, businessType: null, industry: null, isComplete: false };
  return {
    businessName: p.business_name,
    businessType: p.business_type,
    industry: p.industry,
    isComplete: p.is_complete,
  };
}

/** Partial update; only the provided fields change. Returns the updated profile. */
export async function updateProfile(db, userId, fields) {
  const current = await getProfile(db, userId);
  const next = {
    businessName: fields.businessName !== undefined ? fields.businessName : current.businessName,
    businessType: fields.businessType !== undefined ? fields.businessType : current.businessType,
    industry: fields.industry !== undefined ? fields.industry : current.industry,
  };
  if (next.businessType !== null && !isBusinessType(next.businessType)) {
    const err = new Error('invalid businessType');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const isComplete = isProfileComplete(next);
  await db.query(
    `UPDATE profiles
     SET business_name = $2, business_type = $3, industry = $4, is_complete = $5, updated_at = now()
     WHERE user_id = $1`,
    [userId, next.businessName, next.businessType, next.industry, isComplete]
  );
  return { ...next, isComplete };
}
