// Per-project configuration in KVS (cfg:proj:{projectKey}).
import { DEFAULT_CONFIG, normalizeConfig } from '../engine/index.js';
import { AppError, CODES } from './errors.js';
import { K } from './keys.js';
import { appendAudit } from './audit.js';

/**
 * @returns {Promise<{configured:boolean, config:object, errors:string[], updatedAt:string|null, updatedBy:string|null}>}
 */
export async function getConfig(store, projectKey) {
  const stored = await store.get(K.config(projectKey));
  if (!stored) {
    return { configured: false, config: normalizeConfig(DEFAULT_CONFIG).config, errors: [], updatedAt: null, updatedBy: null };
  }
  const { config, errors } = normalizeConfig(stored);
  return { configured: true, config, errors, updatedAt: stored.updatedAt ?? null, updatedBy: stored.updatedBy ?? null };
}

/**
 * Validates and saves a config, then appends CONFIG_SAVED to the audit chain.
 */
export async function saveConfig(store, projectKey, input, actor, nowIso) {
  const { config, errors } = normalizeConfig(input);
  if (errors.length) {
    throw new AppError(CODES.CONFIG_INVALID, `The settings were not saved: ${errors.join(' ')}`, { details: { errors } });
  }
  const value = { schema: 1, ...config, updatedAt: nowIso, updatedBy: actor ?? null };
  await store.set(K.config(projectKey), value);
  const rec = await appendAudit(store, projectKey, {
    type: 'CONFIG_SAVED', actor, subject: { projectKey }, data: { config },
  }, nowIso);
  return { configured: true, config, errors: [], updatedAt: nowIso, updatedBy: actor ?? null, auditSeq: rec.seq };
}
