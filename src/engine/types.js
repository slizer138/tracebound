// Tracebound engine: shared JSDoc types and the engine version.
// This folder is PURE: no @forge imports, no I/O, no clock reads. Time is always an input.

/** Stamped into baselines and every TraceResult. */
export const ENGINE_VERSION = '1.0.0';

/** @typedef {'req'|'risk'|'ctrl'|'test'} RoleKey */
/** @typedef {'new'|'indeterminate'|'done'} StatusCat */

/**
 * @typedef {Object} Config
 * @property {'labels'|'issueTypes'} roleMode
 * @property {{req:string, risk:string, ctrl:string, test:string}} labels
 * @property {{req?:string, risk?:string, ctrl?:string, test?:string}} issueTypes
 * @property {string[]|null} linkTypeAllowlist  null means every link type counts
 * @property {string[]} substantiveFieldIds     for example ['summary','description']
 */

/**
 * Subset of a /rest/api/3/search/jql issue.
 * @typedef {Object} JiraIssue
 * @property {string} id
 * @property {string} key
 * @property {{summary:string, labels?:string[], issuetype?:{name:string},
 *   status:{id:string, name:string, statusCategory?:{key:StatusCat}},
 *   issuelinks?:Array<{id:string, type:{name:string, inward?:string, outward?:string},
 *     inwardIssue?:{id:string,key:string}, outwardIssue?:{id:string,key:string}}>,
 *   fixVersions?:Array<{name:string}>, created:string, statuscategorychangedate?:string,
 *   assignee?:{accountId:string}|null, description?:object|null}} fields
 */

/**
 * @typedef {Object} ChangeItem
 * @property {string} [fieldId]
 * @property {string} field
 * @property {string|null} from
 * @property {string|null} fromString
 * @property {string|null} to
 * @property {string|null} toString
 */

/**
 * @typedef {Object} ChangeHistory
 * @property {string} id
 * @property {string} created
 * @property {{accountId:string}} [author]
 * @property {ChangeItem[]} items
 */

/**
 * @typedef {Object} Snapshot
 * @property {JiraIssue[]} issues
 * @property {Object<string, ChangeHistory[]>} changelogs  keyed by issue id
 * @property {Object<string, StatusCat>} statusCatById
 * @property {string} projectKey
 */

/**
 * @typedef {Object} Clearance
 * @property {'link'|'upstream'} kind
 * @property {string} downKey   test (link) or control (upstream)
 * @property {string} upKey     requirement/control (link) or requirement (upstream)
 * @property {string} fingerprint
 * @property {string} reason
 * @property {string} at        ISO time
 * @property {string} by        accountId
 * @property {number} auditSeq
 */

/** @typedef {{op:'eq'|'del'|'ins', text:string}} DiffOp */

/**
 * @typedef {Object} FieldChange
 * @property {string} fieldId
 * @property {string} before
 * @property {string} after
 * @property {DiffOp[]} diff
 * @property {number} changedAt
 * @property {string|null} changedBy
 * @property {string[]} historyIds
 * @property {{rawTo:string|null, historyId:string}} [opaque]  only when Jira gave no text (fromString and toString null); enters the fingerprint
 */

/**
 * @typedef {Object} ChangeSet
 * @property {boolean} changed
 * @property {'TEXT_CHANGED'|'CREATED_AFTER'|'NONE'} reason
 * @property {FieldChange[]} fields
 * @property {number|null} latestAt
 */

/** @typedef {'VERIFIED'|'SUSPECT'|'CLEARED'|'NOT_RUN'} LinkState */
/** @typedef {'READY'|'MISSING_TESTS'|'SUSPECT'|'UPSTREAM_CHANGED'|'NOT_RUN'} ItemState */

/**
 * @typedef {Object} LinkResult
 * @property {string} testKey
 * @property {string} itemKey
 * @property {LinkState} state
 * @property {number|null} passedAt
 * @property {'changelog'|'statusCategoryChangeDate'|'created'|null} passSource
 * @property {ChangeSet|null} change
 * @property {string|null} fingerprint
 * @property {Clearance|null} clearance
 */

/**
 * @typedef {Object} UpstreamResult
 * @property {string} ctrlKey
 * @property {string} reqKey
 * @property {'OK'|'UPSTREAM_CHANGED'|'CLEARED'} state
 * @property {number} since
 * @property {ChangeSet|null} change
 * @property {string|null} fingerprint
 * @property {Clearance|null} clearance
 */

/**
 * @typedef {Object} ItemResult
 * @property {string} key
 * @property {'req'|'ctrl'} role
 * @property {string} summary
 * @property {string[]} fixVersions
 * @property {string[]} tests
 * @property {ItemState} state
 * @property {{missing:boolean, suspect:number, upstream:number, notRun:number}} flags
 */

/**
 * @typedef {Object} Readiness
 * @property {number} ready
 * @property {number} total
 * @property {number|null} pct
 */

export {};
