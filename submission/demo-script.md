# Demo video script (target 4:30, hard limit under 5:00)

Recorded on a clean Jira Cloud developer site after the app is installed from its share link.
Every number spoken below must match the screen; record again rather than edit numbers in.
Screen at 1080p, browser zoom 100%. No music. No third-party logos beyond Jira's own UI.

Before recording:

- A new Scrum project `PUMP` with nothing in it.
- The app installed; Tracebound setup checked once for PUMP: Site checks, Your project permissions
  and App can create issues PASS; Project settings, Trace issues and Change history WARN until sample
  data is loaded (expected on an empty project).
- A second browser tab with the issue list ready.
- For the MCP part of the 4:05 beat: a static slide of the five MCP tools and the SKILL.md recipe.
  The repository has no tooling to obtain the OAuth 2.1 token a raw MCP call needs, so a live
  terminal call is not planned.

| Time | Screen | Voice-over (spoken text) |
|---|---|---|
| 0:00-0:20 | Title card: "Tracebound: suspect-link traceability for Jira". Then a Jira issue with a requirement and three linked tests, all links looking normal. | "If you build medical-device or automotive software, every requirement needs tests that prove it. Here's the problem: in Jira, when someone edits a requirement after its tests passed, the links still look fine. Nobody finds out until someone rebuilds the trace matrix by hand before the release." |
| 0:20-0:35 | PUMP project, sidebar, click **Traceability**. Empty state: "Tracebound is not set up for this project". | "Tracebound fixes that inside Jira. It's a Forge app: no external servers, no AI deciding anything, three permissions. Here's an empty project." |
| 0:35-1:00 | Click **Load sample data**. Progress bar moves through creating, linking, moving tests to Done. | "One click loads a fictional insulin pump: requirements, risks, risk controls and tests, as plain Jira issues with labels and normal links. It runs as a background job and works with standard workflows; it finds a path to a Done status by itself." |
| 1:00-1:25 | Finished: **92%**, counters, matrix of green VERIFIED tests. Hover REQ-9 (MISSING TESTS) and the unmitigated-risk counter. | "Ninety-two percent ready. Eleven of twelve requirements and controls are verified against their current text. One requirement has no test at all, and one risk has no control. Tracebound shows those gaps too." |
| 1:25-1:50 | Open **[REQ-7] Bolus dose limit**. Edit the description: 25 units to 20 units. Save. | "Now a normal day. Someone tightens the bolus limit from 25 units to 20. Just an edit in Jira; nobody touches the tests." |
| 1:50-2:15 | Back to Traceability, click **Refresh**. 92% changes to **75%**. Three amber SUSPECT chips on REQ-7, CTRL-2 UPSTREAM CHANGED. | "Refresh. Seventy-five percent. The three tests that verified the old limit are now suspect: they passed before the change, so they don't prove the new text. And the firmware dose cap, a risk control derived from that requirement, is flagged for review." |
| 2:15-2:45 | Click an amber chip. Drawer: "25" struck, "20" bold; changed by, when; test last passed; ripple to CTRL-2 and RSK-3. | "Click a suspect test and you see exactly what changed, word by word, who changed it, and when the test last passed. Below, the ripple: the requirement, its control, and the overdose risk that control mitigates." |
| 2:45-3:05 | Click **Create re-verification task**. "Created PUMP-n" (the next free key). Open it briefly: description with before and after text, linked to the test. | "One click creates a re-verification task, linked to the test, with the before and after text. Open the same chip again and ask again: you get the same task, not a duplicate." |
| 3:05-3:30 | Another chip: **Clear as not substantive**. Type a reason; confirm button enables after 10 characters. "Cleared, audit record #n". Chip turns blue CLEARED. | "If a change really doesn't affect a test, clear it, but only with a written reason. The clearance is tied to this exact change. Edit the text again and the flag comes back." |
| 3:30-3:50 | **Audit log** tab, click **Verify chain**: "n records, chain intact". **Baselines** tab: freeze "Release 2.1", **Verify**: Hash matches. | "Every clearance, task and setting change goes into a hash-chained audit log, so later tampering is evident. And a baseline freezes the matrix for a release, with a hash you can verify later." |
| 3:50-4:05 | Open REQ-7 issue: **Trace health** panel (click its Refresh), "Changed after verification: 2 tests suspect"; the chip cleared at 3:05 shows CLEARED. | "Inside the issue itself, the Trace health panel shows the same status." |
| 4:05-4:25 | Rovo chat with **Tracebound Audit Prep**: "What is not ready for release in PUMP?" Expected answer (not yet tried on a site): REQ-7 suspect, CTRL-2 upstream changed, REQ-9 without tests, RSK-4 unmitigated. Then the static slide of the MCP tool list and the SKILL.md recipe (no third-party client window, logo or product name on screen). If the Rovo agent does not work on the recording site, show only the slide and say so. | "The same checks are Rovo actions and MCP tools. Ask the Rovo agent what isn't ready, or call Tracebound from your coding agent after you change something tied to a requirement. It's the same rules, with your permissions." |
| 4:25-4:40 | Back on Traceability, close on the readiness strip. | "Tracebound supports evidence for design-control traceability, from data your team already keeps in Jira. When a requirement changes, you know right away which tests no longer prove it." |

The voice-over is about 420 words: roughly 3 minutes of speech at a calm pace, which leaves room for
the clicks and loading inside the 4:40 plan, under the 5-minute limit.

Never say or imply that Tracebound makes a product meet a standard (no "certified", no
"audit-ready"), and do not quote statistics or customers. The words "fictional sample data" must be
visible once on screen (the sample banner shows them).
