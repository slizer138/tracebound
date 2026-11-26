# Rovo agent and MCP tools

Tracebound works fully on a site without Rovo. On sites with Rovo it adds:

- an agent, **Tracebound Audit Prep** (`rovo:agent`), whose prompt is `prompts/audit-prep.txt`;
- five actions (`action` modules), four read-only (`actionVerb: GET`) and one that creates a
  re-verification task (`actionVerb: CREATE`);
- an MCP server (`rovo:mcp`, Preview) exposing the same five actions as tools. `app.rovo` metadata,
  which Atlassian requires for `rovo:mcp` apps from January 5, 2027, is NOT in `manifest.yml` yet,
  because the current manifest validator rejects it (see below).

| Action / tool key | Verb | Function key |
|---|---|---|
| tb-get-readiness | GET | fn-readiness |
| tb-list-suspects | GET | fn-suspects |
| tb-get-trace-gaps | GET | fn-gaps |
| tb-get-change-impact | GET | fn-impact |
| tb-create-reverification-task | CREATE | fn-reverify |

Agents triggered by automation rules do not invoke CREATE actions (platform rule).

## app.rovo metadata (not in manifest.yml yet)

The rovo:mcp reference says that from January 5, 2027, apps with a `rovo:mcp` module must also define
`app.rovo`, or future deployments may be blocked. On 2026-11-25 the newest published manifest validator
(`@forge/manifest` 13.9.1, bundled with `@forge/cli` 16.0.0) rejects it with
`app should NOT have additional property 'rovo'`, so it is left out to keep `forge lint` and
`forge deploy` working. Add this block under `app:` as soon as `forge lint` accepts it, and in any case
before January 5, 2027 (`test/backend/manifest.test.js` checks the limits: tag at most 8 characters,
description at most 100, keywords at most 50 combined):

```yaml
  rovo:
    tag: tracebnd
    description: "Suspect-link traceability: readiness, trace gaps, change impact and re-verification tasks for Jira"
    keywords:
      - traceability
      - suspect-links
      - verification
```

If no CLI accepts it by then, the fallback is to remove the `rovo:mcp` module (the agent and actions
keep working) and keep the MCP story for the write-up only.

### Dated plan (judging runs until 2027-02-03, so this rule falls inside it)

1. Before every production deploy, and at the latest on 2027-01-04, run
   `npm view @forge/manifest version` and `npm view @forge/cli version`. If either is newer than
   13.9.1 / 16.0.0, update the devDependency, add the block above under `app:`, and run `npx forge lint`.
   (Checked 2026-11-25: 13.9.1 and 16.0.0 are the latest; the 13.9.1 schema's `AppSchema` lists
   description, id, runtime, compatibility, access, licensing, features, connect, storage, package
   and sets additionalProperties false.)
2. Make the final production deploy before 2027-01-05 (ideally before the 2026-12-22 submission),
   so no deploy inside the judging window depends on this rule.
3. If a critical fix must ship after 2027-01-05 and the validator still rejects `app.rovo`, deploy
   without the `rovo:mcp` module. The agent and the five actions keep working; the bonus write-up
   then rests on the action/agent path, the video and `skills/tracebound/SKILL.md`.

## External MCP clients

External exposure is off by default. A site admin turns it on per installation in
admin.atlassian.com > Apps > Sites > (site) > Connected apps > Tracebound. The endpoint is
`https://mcp.atlassian.com/forge/73791daf-0148-415e-9e39-e59d268e171e` (the UUID in `app.id` of `manifest.yml`,
filled in here after `forge register`); the client completes an OAuth 2.1 consent and calls run
with the user's own Jira permissions. See `skills/tracebound/SKILL.md` for an open skill that any agent
can load.

## Not verified yet

None of this has been run on a site (no Atlassian login was available when it was written). Site checks
S13 and S14 in the build contract cover the agent, the actions and an external MCP client.
