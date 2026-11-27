# Tracebound privacy policy

Last updated: 27 November 2026

Tracebound is a Forge app for Jira. It runs entirely on Atlassian's Forge platform. It has no
servers of its own, makes no calls to anything outside your Atlassian site, uses no AI or language
model service, and sends no data to the developer.

## What it reads

With the permissions you grant at install (read Jira work, write Jira work, app storage), Tracebound
reads the issues, links, statuses and change history of the projects where you use it. It reads them
when you open its pages, panels or Rovo actions, as the user who is viewing them. A few background
reads run as the app itself: the list of Jira statuses (cached for 10 minutes), the checks on the
Tracebound setup page, and the optional sample-data job, which starts only after it has checked the
permissions of the user who asked for it.

## What it stores

Tracebound stores the following in Forge storage, which Atlassian hosts for your site. Nothing leaves
your site's Forge storage.

- Project settings you save (labels or issue types, link types, extra fields), with the account ID
  of the person who last saved them.
- The audit log: each settings change, clearance, re-verification task, baseline and sample-data
  run, with the time, the Atlassian account ID of the person who did it, and any reason they typed.
  A clearance record also keeps the before and after text of the field that changed (for example the
  old and new requirement description), so the log shows what was judged not substantive.
- Clearances: which test and requirement they apply to, the reason, the account ID of the person who
  cleared it, and a fingerprint of the change.
- Re-verification pointers: which task was created for which test and change, so a second click does
  not create a duplicate.
- Release baselines: a snapshot of the trace matrix (issue keys, summaries, states and a hash of each
  issue's text) and who froze it.
- Sample-data runs: the state of each run, the keys of the issues it created and the account ID of
  the person who started it.
- Short-lived technical keys: a cached list of Jira statuses (10 minutes) and a health-check key
  (1 minute).

Atlassian account IDs are stored for as long as the records exist, because the audit log is meant to
show who did what. Tracebound does not store names, email addresses or other profile details; Jira
shows names from the account ID when you view a record.

## What it writes to Jira

Only when you ask it to: sample data (clearly labelled issues and links, which "Remove sample data"
deletes) and re-verification tasks. A re-verification task is an ordinary Jira issue in your project:
its description contains the before and after text of the change, and it is assigned to the test's
assignee if the test has one.

## Deleting data

Uninstalling the app removes its Forge storage according to Atlassian's Forge data retention rules.
"Remove sample data" deletes the sample issues it created and the clearances tied to them; audit
records and the sample baseline are kept until uninstall so the log stays verifiable. Tracebound has
no feature to delete or anonymise individual audit records or baselines.

## Contact

Tracebound is provided by Data Tools for All.

Questions or requests: email datatoolsforall@gmail.com, or open an issue at
https://github.com/slizer138/tracebound/issues. Please send anything personal or confidential by
email rather than in a public issue.
