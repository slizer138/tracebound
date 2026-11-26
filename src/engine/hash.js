// The only engine module that imports outside the folder (node:crypto, available in the Forge Node runtime).
import { createHash } from 'node:crypto';

/** prevHash of the first audit record. */
export const GENESIS_HASH = '0'.repeat(64);

/**
 * @param {string} s
 * @returns {string} 64 lowercase hex chars
 */
export function sha256Hex(s) {
  return createHash('sha256').update(String(s), 'utf8').digest('hex');
}
