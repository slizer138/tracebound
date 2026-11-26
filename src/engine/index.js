// Public surface of the pure engine.
export { ENGINE_VERSION } from './types.js';
export { parseJiraTime, tryParseJiraTime, toJiraTime, epochToMs } from './time.js';
export { normalizeText, tokenizeWords, compareKey } from './normalize.js';
export { adfToText, textToAdf } from './adf.js';
export { diffWords } from './diff.js';
export { DEFAULT_CONFIG, ROLE_PRIORITY, MAX_CUSTOM_FIELDS, normalizeConfig, resolveRole } from './roles.js';
export { buildGraph, compareKeys, projectOfKey } from './graph.js';
export {
  TEXT_NOT_AVAILABLE, sortHistories, issueCreatedMs, currentStatusId, currentStatusCat,
  lastPassedAt, substantiveChangeSince, latestSubstantiveEditMs, fingerprint,
} from './changes.js';
export { computeTrace } from './trace.js';
export { readiness, pctOf } from './readiness.js';
export { impactOf, mergeChanges, findTraceEntry } from './impact.js';
export { canonicalJson } from './canonical.js';
export { sha256Hex, GENESIS_HASH } from './hash.js';
export { AUDIT_TYPES, makeAuditRecord, verifyChain } from './chain.js';
export {
  itemTextHash, buildBaseline, splitChunks, joinChunks, verifyBaselineJson, compareBaselines, utf8Length,
} from './baseline.js';
export { SAMPLE_PLAN, SAMPLE_NOTICE, validatePlan, planSeed, parseSeedRef } from './seedPlan.js';
export { simulateSeedSnapshot, applyEdit, applyPass, applyReopen } from './simulate.js';
