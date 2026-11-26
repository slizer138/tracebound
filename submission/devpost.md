# Devpost submission text: Tracebound

Category: **Apps for Specialized Industries**
Bonus prize: **Best app with Atlassian MCP** (fallback if the MCP part cannot be shown on a site:
**Best Agents**, which the same `rovo:agent` and `rovo:action` modules qualify for)

Tracebound app id (UUID, used in the MCP endpoint): `73791daf-0148-415e-9e39-e59d268e171e`, already filled in below, in
`docs/judge-guide.md` section 7, `docs/mcp.md` and `skills/tracebound/SKILL.md`.
Links for the Devpost form:
- Video (public YouTube, 2:57): https://youtu.be/s9O59D-licI
- Code repository (public): https://github.com/slizer138/tracebound
- Install link (Forge share link, production): the URL in `submission/install-link.txt`. It was generated once, so never regenerate it.
- Privacy policy: https://github.com/slizer138/tracebound/blob/main/PRIVACY.md

---

## Tagline

Change one requirement, and Jira shows you which tests no longer prove it.

## Inspiration

Teams that build medical-device, automotive and other safety-related software often track their
work in Jira. Their design-control process expects a chain from each requirement, through the risk
controls derived from it, to the tests that verify it. And when a requirement changes, the tests that
verified the old text have to be looked at again.

In Jira, an issue link cannot tell you that. Someone tightens an acceptance criterion after the test
passed, the link stays green, and the gap is found weeks later when a quality engineer rebuilds the
trace matrix by hand in a spreadsheet before a release or an audit. Dedicated requirements tools call
this a *suspect link*. We wanted that idea inside Jira, computed from data Jira already has.

## What it does

Tracebound is a Jira app for traceability between requirements, risks, risk controls and verification
tests. These stay ordinary Jira issues, marked by a label and joined by ordinary issue links.

- **Suspect links.** When a requirement or risk control is substantively edited *after* a linked test
  last entered a Done status, the link turns SUSPECT. "Substantive" ignores whitespace, quote styles,
  formatting marks and edits that were reverted; it counts real wording, number and case changes.
  A change Jira records without readable text is counted as a change, never assumed harmless.
- **Release readiness.** The share of requirements and risk controls whose tests all passed after
  their last substantive change, filterable by release (fixVersion), with counters for missing
  tests, suspect links, upstream changes, untested items, unmitigated risks and orphan tests.
- **What exactly changed.** Clicking an amber test opens a word diff ("25" struck, "20" bold), who
  changed it and when, and the ripple: the requirement, its risk controls and the risks they mitigate.
- **Two ways to resolve it.** *Create re-verification task* creates a linked Jira task (with a
  duplicate guard). *Clear as not substantive* needs a written reason, and the clearance only
  applies to that exact change: edit the text again and the flag returns.
- **Upstream changes.** When a requirement changes, the risk controls derived from it are flagged for
  review (one hop), separately from test verification.
- **Audit log and baselines.** Every clearance, task, setting change, baseline and sample-data run is
  appended to a hash-chained log with a *Verify chain* button. A baseline freezes the matrix for a
  release with a SHA-256 hash that can be re-verified later.
- **Issue panel.** "Trace health" on any requirement, control, risk or test shows its state.
- **Setup and health screen.** Checks storage, Jira access as the app and as the user, change-history
  access, permissions and whether the app may create issues, and says what to click next.
- **Sample data in one click.** 30 fictional insulin-pump issues, loaded in a background job with live
  progress, working with standard workflows (a Done status reachable in up to three transitions),
  removable in one click.
- **Rovo and MCP.** An agent, five actions and an MCP server expose the same deterministic checks to
  Rovo and to external agents. The core app works fully without Rovo.

Tracebound supports evidence for design-control traceability (IEC 62304, ISO 14971, ISO 26262 style).
It makes no claim that using it satisfies any standard.

## How we built it

- **Forge modules:** `jira:projectPage` (Traceability), `jira:issueContext` (Trace health),
  `jira:adminPage` (setup, plus the Get started page), a `consumer` on an `@forge/events` queue
  for the sample-data job, five `action` modules, a `rovo:agent` and a `rovo:mcp` module.
- **UI Kit** (`@forge/react`) throughout: DynamicTable, Lozenge, ProgressBar, Modal, Tabs,
  SectionMessage, and Text with strike and strong for the diff.
- **A pure rules engine** (`src/engine/`) with no Forge imports, no I/O and no clock reads. It reads the
  Jira search results and changelogs, normalises text, diffs words and applies the suspect rule.
  The same engine serves the UI, the Rovo actions and the MCP tools.
- **Storage:** Forge key-value storage only. Audit records are written with "fail if exists", so two
  writers can never both take the same sequence number, and each record carries the previous record's
  hash.
- **Sample-data seeder:** a pure plan plus an idempotent, resumable queue job. It picks issue types and
  transitions by status category, so it works on company- and team-managed projects with standard
  workflows (a Done status reachable in up to three transitions, without transition screens),
  and it adopts its own issues after a crash instead of creating duplicates.
- **Minimal scopes:** `read:jira-work`, `write:jira-work`, `storage:app`. No egress, no LLM calls.
- **Tests:** `node:test` suites cover the engine edge cases (same-millisecond edits, reopen and
  re-pass, Done-to-Done transitions, formatting-only edits, reverts, items created after a pass, index
  lag), every resolver against a stateful fake Jira, the seeder under odd workflows and errors, and the
  three screens rendered with react-test-renderer and clicked through against the real resolvers.
  A unit test fixes the demo numbers: 92% before the edit, 75% after it.

## How it meets the technology requirement

Tracebound is built entirely on Atlassian Forge: a Forge manifest with Jira UI modules, resolvers, an
async-events consumer, Forge storage, and Rovo `action`, `rovo:agent` and `rovo:mcp` modules. It
integrates with Jira (issues, links, change history, statuses, transitions, permissions) and,
optionally, with Rovo. It runs only on Forge, makes no external calls, and installs from a Forge
share link.

## Bonus write-up: Best app with Atlassian MCP

Tracebound's `rovo:mcp` module exposes five tools through the Atlassian MCP server:
`tb-get-readiness`, `tb-list-suspects`, `tb-get-trace-gaps`, `tb-get-change-impact` (read-only) and
`tb-create-reverification-task` (creates one task). They call the same engine as the Jira UI, so an
external agent gets exactly the numbers a person sees on the Traceability page, with the user's own
Jira permissions.

The repository ships an open skill, `skills/tracebound/SKILL.md`, that any third-party agent can load.
It explains how to connect, what each tool does, and a recipe for developers: *after editing code or
documents tied to a requirement key, call `tb-get-change-impact` and report the suspect tests*. That
puts traceability where the change happens, in the coding agent, instead of at audit time. The skill
also carries the rules: never compute readiness locally, always confirm before creating tasks, and
never claim that a project meets a standard.

Inside Jira, the same actions power the **Tracebound Audit Prep** Rovo agent, which lists suspect
verifications and asks for confirmation before it creates re-verification tasks.

Admins turn on external MCP access per site (admin.atlassian.com > Apps > Sites > Connected apps);
it is off by default.

## Challenges we ran into

- Deciding what "changed" means for rich-text descriptions, so that a re-save or a bold word does not
  raise a false alarm while a single digit does.
- Ordering: a test pass and a requirement edit can land in the same second. The rule treats a tie as
  "changed after", and the seeder waits after its last pass so the demo never depends on luck.
- Making sample data work across standard workflows without asking for admin scopes: issue types and
  transitions are chosen by category at run time.
- Keeping the audit chain consistent without a database lock.

## Accomplishments we're proud of

- The demo numbers are fixed by a unit test, not by a hard-coded path, given the site lets the sample
  tests reach Done: the same rules compute any project's matrix.
- A clearance is bound to the exact change it clears.
- Every view has a loading, empty and error state that says what to do next.

## What we learned

The hard part of traceability is not drawing the matrix; it is deciding, defensibly and
explainably, when a piece of evidence stops counting.

## What's next

- Attaching a baseline report to a Jira issue as release evidence.
- Comparing two baselines.
- Searchable suspect flags in JQL.
- Optional links to test-management tools as the source of pass results.

## Built with

Atlassian Forge, Jira Cloud, UI Kit (`@forge/react`), Forge resolvers, `@forge/events` async queue,
Forge key-value storage, Rovo actions, Rovo agent, Rovo MCP, JavaScript, Node.js `node:test`.

## Testing instructions for judges

1. Install with the share link (Jira only; you need to be a site admin).
2. Create or open a Jira Software project; click **Traceability** in the project sidebar. If Jira
   shows an **Allow access** screen (each user grants the app access to read Jira as them once),
   click it.
3. Click **Load sample data**; wait about a minute for **92%**.
4. Open **[REQ-7] Bolus dose limit**, change "25 units" to "20 units" in the description, save.
5. Back on Traceability click **Refresh**: **75%**, three SUSPECT tests, CTRL-2 UPSTREAM CHANGED.
6. Click a SUSPECT test: word diff; try **Create re-verification task** and **Clear as not
   substantive**; then **Audit log** > **Verify chain**, and **Baselines** > **Freeze** > **Verify**.
7. **Remove sample data** in the green banner cleans up.

If anything does not work: Jira settings > Apps > **Tracebound setup**, type the project key, click
**Check**: every check says what to do next. The full guide with expected results is
`docs/judge-guide.md` in the repository. Rovo is not needed for any of these steps. Problems can be
reported as issues on the public repository (link above).

Optional, for the MCP bonus (needs Rovo on the site):

1. A site admin turns on external access: admin.atlassian.com > Apps > Sites > (your site) >
   Connected apps > Tracebound.
2. In an MCP client that supports remote servers with OAuth (for example MCP Inspector), add
   `https://mcp.atlassian.com/forge/73791daf-0148-415e-9e39-e59d268e171e` (Tracebound's app id: `73791daf-0148-415e-9e39-e59d268e171e`).
3. Complete the OAuth consent, list the tools (five `tb-` tools) and call `tb-get-change-impact`
   with the key of [REQ-7].
