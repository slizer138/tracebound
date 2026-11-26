---
name: tracebound-traceability
description: Use Tracebound's MCP tools to check whether verification tests in a Jira project still prove the current text of requirements and risk controls (suspect links), get release readiness and trace gaps, see the word diff and ripple of a change, and create re-verification tasks. Use after editing code, docs or tickets tied to a Jira requirement key, or when preparing release or design-review evidence.
---

# Tracebound traceability skill

Tracebound is a Jira Cloud app (Atlassian Forge). Requirements, risks, risk controls and verification
tests are Jira issues joined by issue links. Tracebound supports evidence for design-control
traceability (IEC 62304, ISO 14971, ISO 26262 style). It does not certify anything.

## Connect

1. A Jira site admin installs Tracebound and turns on external MCP access for it:
   admin.atlassian.com > Apps > Sites > (your site) > Connected apps > Tracebound. Access is off by default.
2. In your MCP client, add a remote MCP server with the URL
   `https://mcp.atlassian.com/forge/73791daf-0148-415e-9e39-e59d268e171e`, which ends in Tracebound's app id.
   The published app id is in the submission's testing instructions and in the repository README;
   for a copy you deploy yourself it is the UUID in `app.id` of your `manifest.yml` (the part after
   `ari:cloud:ecosystem::app/`).
3. Complete the OAuth 2.1 consent in the client. Calls run with your own Jira permissions.

No API keys or secrets belong in this file or in prompts.

## Tools

| Tool | Writes? | Inputs | Returns |
|---|---|---|---|
| `tb-get-readiness` | no | `projectKey` (required), `release` (optional fixVersion name) | readiness %, ready/total, KPIs, items not ready |
| `tb-list-suspects` | no | `projectKey` (required) | suspect test links with word diffs; controls whose requirement changed |
| `tb-get-trace-gaps` | no | `projectKey` (required), `release` (optional) | items without tests, suspect, upstream changed, not run, unmitigated risks, orphan tests |
| `tb-get-change-impact` | no | `issueKey` (required) | for a requirement, control, test or risk: what changed (word diff), affected tests, derived controls, risks |
| `tb-create-reverification-task` | yes, creates one Jira task | `testKey`, `itemKey` (required), `note` (optional) | the new task key, or the existing open task (no duplicate) |

Every result is JSON text: `{"summary": "...", "data": {...}}`, or `{"error": {"code", "message", "hint"}}`.

## Recipes

- After editing code or docs tied to a requirement key (for example a commit message or file that mentions
  `PUMP-7`), call `tb-get-change-impact` with that key. Report each suspect test and the before/after text.
  Do not create tasks unless the user asks.
- Release check: call `tb-get-readiness` with the project key and release name, then `tb-get-trace-gaps`
  for the same release. Report the headline number and the gaps by kind.
- Re-verification: call `tb-list-suspects`, show the user the list of (test, item) pairs, ask for
  confirmation, then call `tb-create-reverification-task` once per confirmed pair.

## Rules

- Never compute readiness or suspect states yourself; always use the tools.
- Say "supports evidence for design-control traceability". Never say a project meets a standard,
  or is certified or audit-ready, because of Tracebound.
- Do not invent numbers, customers or testimonials.
- Ask for the project key if you do not have it.
- Before any call to `tb-create-reverification-task`, list the tasks and get the user's confirmation.

## How suspect is decided (short)

A test "passed" when it last entered a Done-category status. If the summary, description or a configured
field of the linked requirement or control changed at or after that moment (ignoring formatting,
whitespace and net reverts; case changes count), the link is SUSPECT. A clearance with a recorded reason
applies only to that exact change.
