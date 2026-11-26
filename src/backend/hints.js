// Next-step hints shared by errors.js, jiraOps.js and health.js (kept here, with no imports,
// so none of them import each other in a cycle).

/**
 * Next step when the app identity lacks access to a project; the steps differ by project type.
 * @param {string} projectKey
 */
export function appAccessStep(projectKey) {
  return `Company-managed project: in ${projectKey}, Project settings > Permissions, give the project role atlassian-addons-project-access Create, Edit, Link, Transition and Delete issues. Team-managed project: Project settings > Access; if access is Private, try Open or Limited, then check again (this path is not yet verified on a site).`;
}
