// Opaque session tokens: 256-bit random values. Only the sha256 hash is
// stored (docs/database.md sessions.token_hash) — a leaked database does not
// yield usable tokens.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const B64URL = /^[A-Za-z0-9_-]{43}$/; // 32 bytes -> 43 base64url chars

/** @returns {string} new opaque 256-bit session token (base64url) */
export function generateToken() {
  return randomBytes(32).toString('base64url');
}

/** @param {string} token @returns {string} sha256 hex digest for storage */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison for CSRF double-submit checks. */
export function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !B64URL.test(a) || !B64URL.test(b)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** CSRF tokens share the token format (opaque, unguessable). */
export const generateCsrfToken = generateToken;
