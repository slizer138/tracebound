# Tracebound setup and user guide

Tracebound is a Jira Cloud app built on Atlassian Forge. It shows which verification tests no longer
prove the current text of a requirement or risk control, because that text changed after the test
last passed. This page covers installing it, the first run, how the suspect rule works, sample data,
and removing it.

Support: see [SUPPORT.md](../SUPPORT.md). Privacy: see [PRIVACY.md](../PRIVACY.md). Terms: see
[TERMS.md](../TERMS.md).

## 1. Install

You need to be a Jira site admin to install an app.

1. Install Tracebound from its Atlassian Marketplace listing (Jira > Apps > Explore more apps, search
   for Tracebound), and allow the three permissions it asks for:
   - `read:jira-work`: read issues, links, statuses and change history;
   - `write:jira-work`: create sample data and re-verification tasks when you ask for them;
   - `storage:app`: keep settings, clearances, the audit log and baselines in Forge storage.
2. Tracebound works in Jira only. It has no external account, no API key and no settings outside
   Jira.

The first time each person opens a Tracebound page, Jira may show an **Allow access** screen. This
lets Tracebound read Jira as that person, so they only see issues they can already browse.

## 2. Where everything is

| Where | What |
|---|---|
| Project sidebar > **Traceability** | Readiness score, trace matrix, Suspects, Baselines, Audit log, Settings |
| Issue view, right column > **Trace health** | Verification state of the open requirement, control, risk or test (it may sit behind the Apps button) |
| Jira settings (cog) > Apps > **Tracebound setup** | Health checks, each with a next step; sample data for a typed project key; list of set-up projects |
| Jira settings > Apps > Manage apps > Tracebound > **Get started** | The same page with a short introduction |
| Rovo chat > agent **Tracebound Audit Prep** (sites with Rovo only, optional) | Asks the same checks in chat |

## 3. First run with your own issues

1. Give each trace issue one label:
   - `trace-req`: requirement or design input
   - `trace-risk`: risk
   - `trace-ctrl`: risk control (mitigation)
   - `trace-test`: verification test
2. Link them with any issue link type (the built-in **Relates** is fine):
   - a test to the requirement or risk control it verifies;
   - a risk control to the requirement it derives from;
   - a risk control to the risk it mitigates.

   The meaning comes from the pair of roles, so the link type and its direction do not matter. Links
   to issues in other projects are ignored and counted.
3. Open **Traceability** in the project and click **Use default labels** (or **Save the defaults**) so
   the settings are recorded.

Settings (Traceability > **Settings**, needs the *Administer projects* permission):

- role by label (the default) or by issue type;
- up to 4 extra fields that count as substantive, such as an acceptance-criteria custom field;
- an optional list of link types to count (empty means all).

If something looks wrong, open **Tracebound setup**, type the project key and click **Check**. Each
check says pass, warn or fail, and what to do next.

## 4. How the suspect rule works

- A test **passed** at the last time it entered a status in Jira's **Done** category (for example
  Done, Passed or Closed), read from the issue's change history. A test in any other status is
  **NOT RUN**. Tracebound does not read results from test tools.
- A verification link is **SUSPECT** when the requirement or risk control it verifies changed
  substantively at or after that moment.
- **Substantive** means the summary, the description, or a configured extra field differs after
  normalisation. Whitespace, smart quotes, bold, italic and underline marks, heading and list markers,
  and a change that was later reverted are ignored. Labels, assignee, priority, comments and new links
  never count.
- A risk control is **UPSTREAM CHANGED** when the requirement it derives from changed after the
  control was last edited (one hop).
- **Release readiness** is the share of requirements and risk controls that are READY: at least one
  test, every linked test VERIFIED or CLEARED, and (for a control) no open upstream flag. 100% is shown
  only when every item is ready.
- Item states, in priority order: MISSING TESTS, SUSPECT, UPSTREAM CHANGED, NOT RUN, READY. Link
  states: VERIFIED, SUSPECT, CLEARED, NOT RUN.
- Everything is computed when you open a view or click **Refresh**. There are no notifications.

Resolving a suspect link (click the amber test in the matrix):

- **Create re-verification task** creates a Jira task linked to the test, with the before and after
  text in its description. It needs *Create issues* and *Link issues*. A second click does not create
  a duplicate.
- **Clear as not substantive** needs a reason of 10 to 500 characters and *Edit issues*. The
  clearance applies to that exact change: if the text changes again, the flag comes back.

Both are recorded in the project's **Audit log**. Each record carries the SHA-256 hash of its content
and of the record before it, and **Verify chain** checks the whole chain. This makes later edits to
stored records evident; it cannot stop someone with direct access to the app's storage from rewriting
the whole chain.

**Baselines** freeze the trace matrix for a release with a SHA-256 hash. **Verify** re-hashes the
stored copy; **View** shows it read-only.

## 5. Limits

- One project per view; links to other projects are ignored.
- At most 500 trace issues per view (a warning says when the view is cut). Use the release filter.
- Up to 200 baselines per project.
- Tracebound shows what changed and which tests are affected. It does not make a product, project or
  process meet any standard, and it is not a validated tool. Your own quality process decides what
  counts as evidence.

## 6. Sample data (optional)

Sample data lets you see Tracebound working in about two minutes. Load it into a **new, empty
project**, not a project with real work, because it creates 30 issues in the project you choose.

1. Open the project's **Traceability** page and click **Load sample data** (or use **Tracebound
   setup** and type the project key). You need Browse projects, Create issues, Link issues, Transition
   issues and Edit issues in that project.
2. A progress bar runs for about a minute while 30 fictional issues (requirements, risks, controls and
   tests for a made-up device) are created, linked and their tests moved to a Done status. Every
   sample issue has the label `tb-sample`. Readiness shows **92%**.
3. Open the sample issue **[REQ-7] Bolus dose limit**, change "25 units" to "20 units" in its
   description and save. Back on **Traceability**, click **Refresh**: readiness drops to **75%**, three
   tests turn SUSPECT and one control is flagged UPSTREAM CHANGED.

The sample data is fictional and is not guidance of any kind.

**Removing sample data:** click **Remove sample data** on the green banner of the Traceability page,
or use **Tracebound setup**. It needs *Delete issues*. It deletes every sample issue and the
clearances tied to them. Audit records and the sample baseline are kept, so the audit chain stays
verifiable.

## 7. Uninstall

Jira settings (cog) > Apps > **Manage apps** > Tracebound > **Uninstall**.

- Jira issues are not touched by uninstalling: sample issues and re-verification tasks stay until you
  delete them. Remove sample data first if you loaded it.
- Tracebound's Forge storage (settings, clearances, audit log and baselines) is deleted by Atlassian
  under the Forge data retention rules. Export anything you want to keep first: a baseline's **View**
  can be printed from the browser.
