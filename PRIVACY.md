# Tracebound privacy policy

Last updated: 26 November 2026

Tracebound is a Forge app for Jira. It runs entirely on Atlassian's Forge platform. It has no
servers of its own, makes no calls to anything outside your Atlassian site, uses no AI or language
model service, and sends no data to the developer.

## What it reads

With the permissions you grant at install (read Jira work, write Jira work, app storage), Tracebound
reads the issues, links, statuses and change history of the projects where you use it. It reads them
when you open its pages, panels or Rovo actions, as the user who is viewing them.

## What it stores

Tracebound stores the following in Forge storage, which Atlassian hosts for your site. Nothing leaves
your site's Forge storage.

- Project settings you save (labels or issue types, link types, extra fields).
- The audit log: each settings change, clearance, re-verification task, baseline and sample-data
  run, with the time, the Atlassian account ID of the person who did it, and any reason they typed.
- Clearances: which test and requirement they apply to, the reason, the account ID of the person who
  cleared it, and a fingerprint of the change.
- Release baselines: a snapshot of the trace matrix (issue keys, summaries, states and a hash of each
  issue's text) and who froze it.

Atlassian account IDs are stored for as long as the records exist, because the audit log is meant to
show who did what. Tracebound does not store names, email addresses or other profile details; Jira
shows names from the account ID when you view a record.

## What it writes to Jira

Only when you ask it to: sample data (clearly labelled issues and links, which "Remove sample data"
deletes) and re-verification tasks.

## Deleting data

Uninstalling the app removes its Forge storage according to Atlassian's Forge data retention rules.
"Remove sample data" deletes the sample issues it created; audit records are kept until uninstall
so the log stays verifiable.

## Contact

Questions or requests: open an issue at https://github.com/slizer138/tracebound/issues.
