// Password hashing — argon2id (docs/architecture.md §8).
// Memory-hard defaults of @node-rs/argon2 (m=19456, t=2, p=1) are OWASP-aligned.
import { hash, verify } from '@node-rs/argon2';

/** @param {string} password @returns {Promise<string>} argon2id encoded hash */
export function hashPassword(password) {
  return hash(password);
}

/** @param {string} encodedHash @param {string} password @returns {Promise<boolean>} */
export function verifyPassword(encodedHash, password) {
  return verify(encodedHash, password);
}
