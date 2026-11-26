# Tracebound

**Suspect-link traceability for Jira.** Change one requirement, and Jira shows you which tests no
longer prove it.

Tracebound is a Jira Cloud app built on Atlassian Forge. Requirements, risks, risk controls and
verification tests stay ordinary Jira issues joined by ordinary issue links. When a requirement or risk
control is substantively edited *after* a linked test last passed, that test no longer proves the
current text: Tracebound marks the link **SUSPECT**, lowers the release-readiness score, shows a word
diff of exactly what changed, and lets the team either create a re-verification task or clear the
change as not substantive with a recorded reason. It also freezes hashed baselines of the trace matrix
and keeps an append-only, hash-chained audit log.

Tracebound supports evidence for design-control traceability (IEC 62304, ISO 14971, ISO 26262 style).
It does not make you compliant with any standard, it does not replace your quality system, and its
sample data is fictional.

- No calls outside your Jira site (no egress), no AI model calls, no external accounts.
- Three scopes: `read:jira-work`, `write:jira-work`, `storage:app`.
- Works on Jira Software projects (company- or team-managed) with standard workflows. The sample data
  needs a Done status that each test can reach in up to three transitions, with no transition screen
  or required field in the way.
- Rovo is optional. On sites with Rovo there is an agent, five actions and an MCP server.

## Status: what has been verified

Be aware of what has and has not been run:

- **Verified offline** (`npm test`, 255 tests on 2026-11-25): the engine (suspect rule, readiness, diff, hashing),
  every resolver against a stateful fake Jira and fake storage, the queue-based sample-data seeder
  including crash resume and odd workflows, and the three UI screens rendered with
  `react-test-renderer` and clicked through against the real resolvers. These tests show the demo
  numbers: 92% after loading the sample, 75% after the REQ-7 edit with 3 suspect tests and 1
  upstream flag.
- **Not yet verified on a real Jira site.** No Atlassian login was available while this was built, so
  the app has not been registered, deployed or installed. How Jira draws the UI Kit components, the
  exact changelog text Jira records for rich-text descriptions, and Rovo/MCP behaviour are listed as
  open checks in [docs/judge-guide.md](docs/judge-guide.md#before-submission-checks-on-a-real-site).

## Quick start (about 2 minutes)

You need to be a Jira site admin to install an app.

1. **Install** Tracebound from its install link and accept the three scopes. Jira only.
2. **Create or open a project** (any Jira Software project; a new, empty Scrum or Kanban project is
   best). In the project sidebar, click **Traceability**.
3. You see *"Tracebound is not set up for this project"*. Click **Load sample data**.
   A progress bar runs for about a minute while 30 fictional insulin-pump issues are created, linked
   and their 13 tests moved to a Done status. Then the page shows **92%** release readiness.
4. Open the issue **[REQ-7] Bolus dose limit**. In its description change **"25 units"** to
   **"20 units"** and save.
5. Back on **Traceability**, click **Refresh**. Readiness drops to **75%**: the three tests of REQ-7
   turn **SUSPECT**, and risk control **[CTRL-2] Hard dose cap in firmware** is flagged
   **UPSTREAM CHANGED**.
6. In the **[REQ-7] Bolus dose limit** row, click any of the three amber test buttons. The buttons
   show Jira issue keys (for example PUMP-27), not sample names such as [TEST-14]. The drawer shows the word diff (25 struck through, 20 in bold), who changed it and when, and
   the ripple through CTRL-2 to the risk it mitigates.
7. Click **Create re-verification task** (a linked Jira task appears), or **Clear as not substantive**,
   type a reason of at least 10 characters and confirm. The **Audit log** tab shows the record; click
   **Verify chain**.

When you are done: the green banner on Traceability has **Remove sample data**. It deletes every sample
issue; the audit log keeps its records.

The full judge walk-through with expected results is in [docs/judge-guide.md](docs/judge-guide.md).

## Where everything is after install

| Where | What | How to open it |
|---|---|---|
| Project page **Traceability** | Readiness strip, trace matrix, suspects, baselines, audit log, settings | Open a project, then **Traceability** in the project sidebar |
| Issue panel **Trace health** | Verification status of the current requirement, control, risk or test | Open any issue; the panel is in the right-hand column (it may need one click on the Apps / Trace health button; see site check S5) |
| Admin page **Tracebound setup** | Health checks with a next step for each, sample data for a typed project key, list of set-up projects | Jira settings (cog) > Apps > **Tracebound setup** |
| **Get started** | The same page with a three-step introduction | Jira settings > Apps > Manage apps > Tracebound > **Get started** |

If anything looks wrong, open **Tracebound setup**, type the project key and click **Check**. Each
check says pass, warn or fail and what to do next (for example which project permission the app's
role is missing).

## Using your own issues

1. Put one label on each issue:
   - `trace-req`: requirement or design input
   - `trace-risk`: risk (hazard, hazardous situation)
   - `trace-ctrl`: risk control (mitigation)
   - `trace-test`: verification test
2. Link them with any issue link type (the built-in **Relates** is fine):
   - a test to the requirement or risk control it **verifies**;
   - a risk control to the requirement it **derives from**;
   - a risk control to the risk it **mitigates**.

   The meaning comes from the pair of roles, so the link type and its direction do not matter. Links
   to issues in other projects are ignored and counted.
3. Open **Traceability** and click **Use default labels** (or **Save the defaults** in the blue
   banner) so the settings are recorded.

A test counts as passed when its status is in the **Done** category (for example Done, Passed,
Closed). A test in any other status is NOT RUN.

Settings (project page > **Settings**, needs *Administer projects*):

- role by label (the default) or by issue type, with your own labels, or one issue type per role
  chosen from a list of the project's issue types (if that list cannot be read, you type the exact
  names and they are checked when you save);
- up to 4 extra substantive fields, such as an acceptance-criteria custom field (`customfield_NNNNN`);
- an optional list of link types to count (empty means all).

**Direction convention.** Links Tracebound creates itself (sample data, re-verification tasks) always
use outward issue = the downstream issue (test, control or task) and inward issue = the upstream issue
(requirement, control or risk). With "Relates" this makes no visible difference.

## How suspect is decided

- A test **passed** at the last time it entered a Done-category status, read from the issue's change
  history. A Done-to-Done transition (for example Passed to Closed) counts as a re-pass. Without any
  status history, Jira's status-category change date is used, then the creation date; the drawer says
  when that happened.
- A verification link is **SUSPECT** when the requirement or control it verifies changed
  substantively at or after that moment. An edit in the same millisecond as the pass counts as after
  it (the conservative choice).
- **Substantive** means the summary, the description, or a configured field differs after
  normalisation. Ignored: whitespace and non-breaking spaces, smart quotes and dashes, bold, italic and
  underline marks (Jira wiki `*x*`, `_x_`, `+x+`, `{*}x{*}`; Markdown `**x**`), heading and list
  markers, panel, quote, info, note, warning and tip macros, the difference between table header and
  cell pipes (`||` and `|`), and a change that was later reverted. Counted as changes: case ("shall" to
  "SHALL"), strike-through (`-x-`), superscript (`^x^`) and subscript (`~x~`) marks, Unicode
  superscript digits (text is normalised with NFC, not NFKC, so "10" followed by a superscript 5 is
  not "105"), a minus sign at the start of a line ("- 5 units" is not "5 units"), a changed link
  target (`[spec|target]`) and a swapped image (`!a.png!` to `!b.png!`). If Jira records a change
  without its text (including an entry whose values are all empty), it is treated as a change, and a
  clearance covers only that exact change (its raw value and history id). Only an entry whose raw
  values are present and identical is ignored.
- Change times are read whether Jira sends them as timestamps or as epoch numbers (seconds or
  milliseconds); **Tracebound setup > Check** warns if it ever meets a time it cannot read.
- A requirement or control **created after** the test last passed also makes the link suspect. Its
  later edits are still tracked, so a clearance of that link goes stale when the text changes again.
- **Upstream changed.** When a requirement changes after a risk control derived from it was last
  edited, the control is flagged UPSTREAM CHANGED (one hop only). The control's own tests are not
  touched. Editing the control to accept the new requirement clears the flag and, because the control
  changed, makes the control's own tests suspect. The control's reference point is when its current
  text came into being, compared net like the link rule: an edit that is later reverted (a typo that is
  fixed) does not count, so the flag stays until the control's text really changes or someone clears it.
- **Opaque changes.** When Jira records a change to a field without its text, the change drawer
  shows no word diff or word counts; it says the change is treated as a change and asks you to review
  the issue history.
- **Clearing** a suspect link or upstream flag needs a reason (10 to 500 characters) and the *Edit
  issues* permission. The clearance is bound to a fingerprint of that exact change: if the text changes
  again, the flag comes back.
- **Release readiness** = requirements and risk controls in state READY, divided by all of them,
  rounded to a whole percent, except that 100% is shown only when every item is READY (199 of 200 is
  99%, not 100%) and 0% only when none is (1 of 300 is 1%). Test coverage uses the same rule. An item is READY when it has at least one test and every linked test is
  VERIFIED or CLEARED, and (for a control) no upstream flag is open. Risks are not counted in
  readiness; unmitigated risks and orphan tests are shown as separate counters. With a release filter,
  a risk counts when its own fixVersion is that release or one of its controls is in the release, and
  an orphan test counts when its own fixVersion is that release.
- Everything is computed when you open or refresh a view, from Jira search results and change
  history. Nothing is cached between views except the status-category list (10 minutes). That list is
  read as the app, so it does not depend on who opened a page last, and it is refetched at once when a
  status id is missing from it.

Item states, in priority order: MISSING TESTS, SUSPECT, UPSTREAM CHANGED, NOT RUN, READY.
Link states: VERIFIED, SUSPECT, CLEARED, NOT RUN.

## Audit log and baselines

- Every settings change, clearance, re-verification task, baseline and sample-data run appends a
  record to the project's audit log. Each record stores the SHA-256 hash of its own content and the hash
  of the record before it. **Verify chain** re-reads the whole chain and reports the first record whose
  content, link or sequence no longer matches; the newest record is also checked against the
  stored head (sequence and hash), so rewriting only the last record is caught too. This makes later edits to stored records evident
  (tamper-evident); it cannot stop someone with direct access to the app's storage from rewriting
  the whole chain (not tamper-proof).
- A **baseline** freezes the trace matrix for a release: each item's state, its tests' states and a
  hash of its normalised text, plus readiness and counters. The canonical JSON is hashed; the hash
  goes into the audit log. **Verify** re-hashes the stored copy and checks it against both. **View**
  shows a read-only matrix you can print from the browser.

## Scopes and why each is needed

| Scope | Why |
|---|---|
| `read:jira-work` | Read issues (search), change history (bulk and per-issue changelog), statuses, issue link types, transitions, create metadata, your project permissions and projects. |
| `write:jira-work` | Sample data creates issues, links and transitions and later deletes them; a re-verification task is created when you ask for one. |
| `storage:app` | Forge key-value storage for project settings, sample-data runs, clearances, the hash-chained audit log and baselines. |

Not requested: `read:jira-user` (no `/myself` call; names are shown with the UI Kit User component),
`manage:jira-configuration` (no custom link types or statuses), `manage:jira-project` (no projects,
versions or issue types are created), and no external network access. Details, including which calls
run as you and which as the app, are in [docs/scopes.md](docs/scopes.md).

Who does what:

- Views and Rovo actions read Jira **as you**, so you only see issues you can browse. The first
  time each user opens Tracebound, Jira may show an **Allow access** screen for this; Tracebound
  passes Jira's request through so that screen can appear. If Jira does not show it, the view says
  "Jira needs you to allow Tracebound to access Jira as you" (code NEEDS_CONSENT) and asks you to
  reload the page; it never waits on an endless spinner.
- The admin page's project checks and its list of set-up projects only cover projects you can
  browse.
- Clearing and re-verification tasks run **as you** and need *Edit issues* (clearing) or *Create
  issues* and *Link issues* (task).
- Sample data runs in a background job **as the app**. Before it is queued, Tracebound checks that
  **you** have Browse projects, Create issues, Link issues, Transition issues and Edit issues.
  Removing it needs Delete issues.

## Data Tracebound stores

In Forge storage, per project: settings, sample-data run state, clearances (issue keys, reason,
your account id, time), audit records (issue keys, action, account id, time, hashes; a clearance
record also keeps the before and after text of the field it cleared, so the audit shows what was
judged not substantive) and baselines (issue keys, summaries, states, and hashes of the normalised
summary and description, not the descriptions themselves). Nothing leaves Atlassian's platform.

## Rovo agent and MCP (optional)

On a site with Rovo:

- **Agent "Tracebound Audit Prep"** (in Rovo chat). Ask *"What is not ready for release in PUMP?"*
  or *"What did the last change to PUMP-7 break in verification?"*. It always uses the tools below
  and never computes readiness itself. Before creating tasks it lists them and asks you to confirm.
- **Five actions**, also exposed as **MCP tools** through the `rovo:mcp` module (Preview):

  | Tool | Writes? | Inputs |
  |---|---|---|
  | `tb-get-readiness` | no | `projectKey`, optional `release` |
  | `tb-list-suspects` | no | `projectKey` |
  | `tb-get-trace-gaps` | no | `projectKey`, optional `release` |
  | `tb-get-change-impact` | no | `issueKey` |
  | `tb-create-reverification-task` | creates one Jira task | `testKey`, `itemKey`, optional `note` |

**Using the tools from an external agent (Claude Code, Cursor, MCP Inspector, ...):**

1. A site admin turns on external access, which is **off by default**: admin.atlassian.com > Apps >
   Sites > (your site) > Connected apps > Tracebound.
2. Add a remote MCP server in the client with the URL `https://mcp.atlassian.com/forge/73791daf-0148-415e-9e39-e59d268e171e`.
   Tracebound's published app id (`73791daf-0148-415e-9e39-e59d268e171e`, a UUID) is filled in here and in the submission's
   testing instructions after `forge register`; for your own deploy it is the UUID in `app.id` of
   `manifest.yml`.
3. Complete the OAuth consent in the client. Calls run with your own Jira permissions.

An open skill for third-party agents is in [skills/tracebound/SKILL.md](skills/tracebound/SKILL.md).
More detail, including the `app.rovo` metadata, is in [docs/mcp.md](docs/mcp.md).

## Limits

- One project per view; links to other projects are ignored.
- At most 500 trace issues per view (a warning says when the view is cut). Use the release filter.
- If Jira's bulk changelog endpoint is not available to the app (any 4xx answer other than 429, or an
  unexpected response), change history is read issue by issue for the first 150 issues only, with a
  warning. A rate limit (429) or a Jira server error (5xx) is shown as an error to retry, not
  bypassed; **Tracebound setup > Check** applies the same rule.
- Views update when you open them or click Refresh, not live.
- Up to 200 baselines per project; older ones are kept, never dropped.
- Sample data needs a project where the app can create a *Task* (or another standard issue type)
  without extra required fields, and a workflow with a Done-category status reachable in at most
  three transitions. If not, the banner shows exactly which steps failed and the readiness it got
  instead of 92%.

## What this does not do

- It does not make a product, a project or a process meet any standard, and it is not a validated
  tool for a regulated quality system. It supports the evidence you build; your QMS decides what counts.
- It does not run tests or read test results from test tools (Xray, Zephyr and others). A test is
  "passed" when its Jira issue is in a Done-category status; there is no FAILED state.
- It does not notice links added after a test passed, or edits to fields you did not mark as
  substantive (labels, assignee, priority and comments never count).
- It does not trace across projects, Confluence pages or code.
- It does not provide electronic signatures or 21 CFR Part 11 controls.
- It does not use AI to decide anything. Every state is computed by deterministic rules described
  above; the optional Rovo agent only calls those rules.
- The sample data (an insulin pump) is fictional. Not clinical guidance.

## Development

Node 24 (24.22.1 or later for the Forge CLI). `npm install`, then:

```
npm test               # all unit and render tests, offline (engine, backend, UI)
npm run lint           # ESLint over src and test
npm run forge:lint     # Forge manifest lint (needs Node 24.22.1+, a Forge login and app.id)
```

Layout:

- `src/engine/`: the pure rules (no Forge imports, no I/O, no clock).
- `src/backend/`: resolvers, Rovo actions, queue consumer, Jira client, storage.
- `src/frontend/`: UI Kit (`@forge/react`) screens; `src/frontend/lib/` holds their pure logic.
- `test/`: `node:test` suites. `test/frontend/render.test.js` renders the real screens with
  `react-test-renderer` against the real resolvers over a fake Jira.
- `prompts/`: the Rovo agent prompt. `skills/`: the open MCP skill. `submission/`: Devpost text and
  demo script.

To deploy your own copy: `npx forge register`, `npx forge deploy --non-interactive -e development`,
`npx forge install --non-interactive --site <site>.atlassian.net --product jira --environment development`.

## License

MIT
