# Scopes and permissions

Tracebound requests three scopes and nothing else. It makes no calls outside your Jira site
(there is no `permissions.external` entry, so the platform blocks any egress) and uses no LLM.

| Scope | Why |
|---|---|
| `read:jira-work` | Read issues (search/jql), change history (changelog/bulkfetch and the per-issue changelog), statuses, issue link types, transitions, create metadata, your project permissions (mypermissions) and projects. |
| `write:jira-work` | Sample data only creates issues (bulk), links and transitions and later deletes them; a re-verification task is created on request. |
| `storage:app` | Forge key-value storage for project settings, sample-data runs, clearances, the hash-chained audit log and baselines. |

Deliberately not requested:

- `read:jira-user`: Tracebound never calls `/myself`; your account id comes from the invocation context.
  User names are rendered by the UI Kit `User` component (to be confirmed on a site, see site check S10).
- `manage:jira-configuration`: no custom link types, no status search (it uses `GET /rest/api/3/status`).
- `manage:jira-project`: no projects, versions or issue types are created.
- Any egress: none.

## Who does what

- Views and Rovo actions read Jira **as you**, so you only see issues you can browse. A user who has
  not yet allowed the app to act as them gets Jira's **Allow access** screen: Tracebound rethrows the
  platform's consent error (`NEEDS_AUTHENTICATION_ERR`) instead of turning it into an error message.
- The Settings tab lists the project's issue types (create metadata read as you) for the
  role-by-issue-type selects.
- The admin page checks Browse projects before any check of a typed project key, and lists only the
  set-up projects you can browse.
- Writes made from the UI or the Rovo CREATE action (re-verification tasks) run **as you**.
- Sample data is created in a background queue job **as the app** (no user exists in a background job).
  Before it is queued, Tracebound checks that **you** have Browse projects, Create issues, Link issues,
  Transition issues and Edit issues in the project. Removing sample data requires Delete issues.
- The app must be able to create, link, transition and delete issues in the project for the seeder to
  work. The admin "Tracebound setup" page checks only **create** access (a createmeta read as the app);
  link, transition and delete problems show up as warnings or errors of the sample-data run itself.
  - Company-managed projects: Project settings > Permissions; the app acts through the project role
    `atlassian-addons-project-access`.
  - Team-managed projects have no permission scheme; access is set under Project settings > Access.
    How the app's access behaves there (for example in a Private project) is not yet verified on a
    site (site check S3).
- Saving settings requires Administer projects. Clearing a suspect flag and freezing a baseline require
  Edit issues.
