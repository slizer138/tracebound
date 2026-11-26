# Judge guide

A click-by-click walk-through with the result you should see at each step. It takes about five
minutes on a clean Jira Cloud site. You need to be a site admin to install the app.

Nothing here needs Rovo, an external account or any configuration beyond the steps below.

## 1. Install (1 minute)

1. Open the Tracebound install link, choose your site, and accept. The consent screen lists exactly
   three scopes: read Jira work, write Jira work, and app storage.
2. Optional check: Jira settings (cog) > Apps > **Tracebound setup**. Without a project key it runs the
   site checks: app storage, Jira read as the app, Jira read as you. All three should say **PASS**;
   the Rovo line and the "Project checks" line (it asks for a project key) say INFO.
   If Jira first shows an **Allow access** screen, click it: Tracebound reads Jira as you, and each
   user grants that once. If the page shows the message "Jira needs you to allow Tracebound to access
   Jira as you" instead, reload the page and accept the Allow access screen.
3. Optional, once you have created the project in section 2, step 1: type its key here and click
   **Check**. On a project
   without sample data, Site checks, **Your project permissions** and **App can create issues** say
   PASS; **Project settings**, **Trace issues** and **Change history** say WARN until sample data is
   loaded. Each warning names its next step.

## 2. Load the sample (about 1 minute)

1. Create a new, empty project (Jira now calls projects *spaces*: Spaces > Create space > Kanban or
   Scrum, any name; key for example `PUMP`. On a brand-new site Jira offers this on first visit). An existing project also works, but its sample issues then get other keys than
   the ones shown below (in an empty project [REQ-7] is `PUMP-7`); match them by their bracketed
   names, such as [REQ-7].
2. In the project sidebar click **Traceability**.
   - Expected: *"Tracebound is not set up for this project"* with **Load sample data** and
     **Use default labels**.
3. Click **Load sample data**.
   - Expected: a progress bar with the current phase (creating issues, linking, moving tests to Done,
     freezing the sample baseline) and a step count out of 63. You can leave the page; it runs as a
     background job.
4. When it finishes the page reloads by itself.
   - Expected: a green banner *"Sample data loaded (readiness 92% when loaded, expected 92%)"*, a large **92%**,
     and counters: Ready 11/12, Missing tests 1, Suspect links 0, Upstream changed 0, Unmitigated
     risks 1, Orphan tests 1.
   - The matrix lists 9 requirements and 3 risk controls. Every test is green **VERIFIED**, except that
     [REQ-9] Insulin on board has no test (MISSING TESTS) on purpose; [RSK-4] has no control and
     [TEST-20] verifies nothing, also on purpose.

If the banner is amber instead ("readiness X% when loaded, expected 92%"), it lists what the site did not allow
(for example a workflow without a reachable Done status). **Tracebound setup** > type the key >
**Check** names the missing permission or field.

## 3. The change (1 minute)

1. Open the issue **[REQ-7] Bolus dose limit**: click its key in the matrix.
2. Edit the description: change **25 units** to **20 units**. Save.
3. Optional: the **Trace health** panel on REQ-7 (right-hand column; it may sit behind the Apps
   button) shows *"Changed after verification: 3 tests suspect"* after you click its **Refresh**
   (2 after you clear one in step 4.3).
4. Go back to **Traceability** and click **Refresh**.
   - Expected: **75%**; Ready 9/12; Suspect links 3; Upstream changed 1.
   - REQ-7 is **SUSPECT** with three amber **SUSPECT** test buttons.
   - [CTRL-2] Hard dose cap in firmware is **UPSTREAM CHANGED**, but its own test stays VERIFIED: the
     control itself did not change, it needs review.

## 4. Look at the change and act on it (2 minutes)

1. Click the first amber test button in REQ-7's row.
   - Expected: a drawer titled *"&lt;test key&gt; is suspect against &lt;key of [REQ-7]&gt;"* (in an
     empty project: *"PUMP-n is suspect against PUMP-7"*), the description diff with **25**
     struck through and **20** in bold, who changed it and when, when the test last passed, and the
     ripple: REQ-7, its three tests, CTRL-2 (upstream changed) and the risk it mitigates.
2. Click **Create re-verification task**.
   - Expected: *"Created PUMP-n"* with a link. The task is linked to the test and describes the
     before and after text. The create button then disappears from the drawer; closing it, opening
     the same test again and clicking **Create re-verification task** returns the same task instead of
     a duplicate.
3. Open another amber test and click **Clear as not substantive**. Type a reason of at least 10
   characters (the confirm button stays disabled until then) and click **Confirm clearance**.
   - Expected: *"Cleared, audit record #n"*; the chip turns blue **CLEARED**; Suspect links goes
     down by one. Readiness stays at 75% until every test of REQ-7 is verified or cleared.
4. Optional, the re-run: open a suspect test issue, move it out of Done and back to Done (or any
   Done-category status), then **Refresh**. That link turns VERIFIED.
5. **Suspects** tab: every open and cleared item in one list, with **Review**.
6. **Audit log** tab: the settings, sample-data, task and clearance records. Click **Verify chain**:
   *"n records, chain intact"*.
7. **Baselines** tab: type `Release 2.1`, click **Freeze baseline**, then **Verify** on that row:
   **Hash matches**. **View** shows the frozen matrix and its SHA-256.

## 5. Formatting is not a change (optional, 30 seconds)

Open [REQ-1] Basal rate range, make one word bold in the description (no other change), save, and
Refresh Traceability. REQ-1 stays READY: formatting-only edits do not raise a suspect. This depends on
how Jira records rich-text changes; see site check S6 below. If Jira records the edit without any
text, Tracebound cannot tell formatting from content and marks the tests SUSPECT on purpose (it
never assumes a change it cannot read was harmless); clear them with a reason.

## 6. Clean up

On **Traceability** the green banner has **Remove sample data**. It deletes every issue labelled with
the run label (including re-verification tasks created on sample tests). The audit log keeps its
records and the sample baseline stays, marked *sample*. The same buttons are on **Tracebound setup**
after you check the project.

## 7. Rovo and MCP (only on a site with Rovo)

- Rovo chat > Agents > **Tracebound Audit Prep** > *"What is not ready for release in PUMP?"*
- External MCP: a site admin enables Tracebound in admin.atlassian.com > Apps > Sites > (site) >
  Connected apps. Then add `https://mcp.atlassian.com/forge/73791daf-0148-415e-9e39-e59d268e171e` as a remote MCP server in the
  client (Tracebound's app id is `73791daf-0148-415e-9e39-e59d268e171e`; it is also in the Devpost testing instructions),
  complete the OAuth consent, and call `tb-get-change-impact` with REQ-7's key. See [mcp.md](mcp.md).

---

## Before submission: checks on a real site

These were not possible while building (no Atlassian login). They are the release gate. Run them in
this order on a developer site, then repeat the whole guide above on a second clean site using the
share link.

| # | Check | Expected | If not |
|---|---|---|---|
| P1 | `node --version` | 24.22.1 or later (`@forge/cli` 16 refuses 24.18) | upgrade Node from nodejs.org |
| C2 | `npx forge register`, then `npx forge lint` | 0 errors; paste the output under "Recorded results" below | an inline prompt instead of `resource:` if lint rejects it |
| C3 | after register, copy the UUID from `app.id` in `manifest.yml` into the docs | done 2026-11-26: app id `73791daf-0148-415e-9e39-e59d268e171e` is in README.md, docs/judge-guide.md, docs/mcp.md, skills/tracebound/SKILL.md and submission/devpost.md | - |
| C4 | `npx forge deploy --non-interactive -e development` | bundles; the nested `package.json` files in `src/engine`, `src/backend`, `src/frontend/lib` are accepted | delete those three files (tests still pass, with a Node warning) |
| S1 | install on the dev site | consent lists only the three scopes | deploy without the Rovo modules if a site without Rovo rejects them |
| S2 | open **Traceability** as a second user who did not install the app | Jira's **Allow access** screen; after allowing, the page loads | if no Allow access screen appears, the page shows an error banner with code NEEDS_CONSENT ("Jira needs you to allow Tracebound...; reload the page") or another error banner (an endless loading spinner would be a bug); check `npx forge logs` for NEEDS_AUTHENTICATION_ERR and record what the host did |
| S3 | Tracebound setup > PUMP > Check, before loading sample data | Site checks, Your project permissions and App can create issues PASS; Project settings, Trace issues and Change history WARN until sample data is loaded | follow each next step |
| S4 | Load sample data | 63/63, 92%; record the time | read the warnings in the banner |
| S5 | Trace health panel on REQ-7 | shown without extra setup | document the extra click in this guide |
| S6 | bold-only edit of REQ-1, then open `/rest/api/3/issue/<key>/changelog`; also POST `/rest/api/3/changelog/bulkfetch` for REQ-1 and note the JSON type of `created` | description `fromString`/`toString` are plain text that normalises equal; `created` is a string or an epoch number (both are read) | add the markup to `src/engine/normalize.js` with a test. If both texts are null, the engine marks every such description edit as a change (conservative), so a bold-only edit raises a suspect: note it, and plan a fallback that compares the issue's current description text with the baseline text |
| S7 | REQ-7 25 to 20, Refresh; Tracebound setup > PUMP > Check | 75%, 3 SUSPECT, CTRL-2 UPSTREAM CHANGED; the Change history check says its change times are readable | check `npx forge logs`; a WARN "unknown format" on change times quotes the value to fix in `src/engine/time.js` |
| S8 | the drawer | struck and bold words visible; buttons and lozenges inside table cells | render the matrix as Stack/Inline rows |
| S9 | create task, clear, verify chain | as in section 4 | read the error banner's next step |
| S10 | the User component shows names without `read:jira-user` | names shown | add `read:jira-user` and say why in the README, or show "a user" |
| S11 | freeze and verify a baseline; clear two links (storage queries run with limit 20 and follow the cursor) | hash matches; both clearances listed | check `npx forge logs` for a STORAGE_ERROR on the query |
| S12 | Remove sample data | issues gone, audit kept | JQL bulk delete as the banner says |
| S13 | Rovo agent | answers from tb-get-trace-gaps; asks before creating tasks | submit the bonus as Best Agents |
| S14 | external MCP client | 5 tools listed; tb-get-change-impact returns the diff | write the bonus from the video and SKILL.md |
| S15 | production deploy, Distribution > Sharing, Jira only | one share link, generated once | never regenerate it after submission |
| S16 | this whole guide on a second clean site via the share link | every expected result above | fix before submitting |

### Recorded results

Fill in before submitting. Without an app id in `manifest.yml` the CLI's `forge lint` stops at
"Invalid app details in the manifest.yml file. Register your app by running forge register."

- `npx forge lint` (C2): 2026-11-25, with `app.id` set in `manifest.yml` and the CLI not logged in:
  "No issues found." (exit 0). The local linter's scope rules did not fire in an earlier experiment,
  so this does not prove the scopes are complete; run it again after `forge register` and record it.
- `npx forge deploy --non-interactive -e development` (C4): 2026-11-25, logged in and registered:
  lint "No issues found", "Deployed" (versions 2.0.0, 2.1.0 and later). The nested `package.json`
  files were accepted.

First real-site run, 2026-11-25, on a Jira Cloud site with Standard trials, as the site admin who
installed the app, in a new Kanban space (key KAN):

| # | Result |
|---|---|
| S1 | Installed with exactly read:jira-work, write:jira-work, storage:app. |
| S2 | Not run: only one user on the site. The installing admin saw no Allow access screen and the page loaded. |
| S4 | Pass. 63/63 steps in about 60 s; banner "readiness 92% when loaded, expected 92%"; Ready 11/12, Missing tests 1, Suspect 0, Upstream changed 0, Unmitigated risks 1, Orphan tests 1. |
| S6 | Pass. Jira's changelog gives the description as plain text; a bold word comes back as wiki markup (`*shall*`) and normalises equal, so [REQ-1] stayed READY. `created` in `/issue/{key}/changelog` is an ISO string. |
| S7 | Pass. After 25 to 20 units on [REQ-7] and Refresh: 75%, Ready 9/12, Suspect links 3, Upstream changed 1; [CTRL-2] UPSTREAM CHANGED with its own test VERIFIED. |
| S8 | Pass. Drawer shows 25 struck through and 20 in bold, the author with avatar, the time, and the ripple. Found: the test-key button looked like plain text and clicking the amber label did nothing; the key is now a bordered button with a tooltip. |
| S9 | Pass after a fix. Re-verification task created and linked ("Created KAN-31"). Clearing first failed: the reason box lost 89 of 91 typed characters because every UI Kit text input was controlled (value prop). All text inputs are now uncontrolled (defaultValue) with a regression test; after redeploying, the full reason was captured, "Cleared, audit record #6", and Verify chain said "6 records, chain intact". |
| S10 | Pass. Names and avatars render without read:jira-user. |
| S11 | Pass. "Release 2.1" frozen at 75% (audit record #7); Verify: "Hash matches". |
| S5, S12 to S16 | Not run yet. |
