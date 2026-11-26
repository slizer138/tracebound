// Admin page "Tracebound setup" (and the "Get started" page from Manage apps, same resource):
// health checklist with a next step per check, sample data load/remove with live progress, and the
// list of configured projects.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Stack, Inline, Heading, Text, Textfield, Label, LoadingButton, Lozenge, SectionMessage,
  SectionMessageAction, DynamicTable, Link, Code, Box, useProductContext,
} from '@forge/react';
import { call } from './api.js';
import { HEALTH, stateOf } from './lib/states.js';
import { healthSummary } from './lib/health.js';
import { seedBanner, isSeedActive, runLabelOf } from './lib/view.js';
import { cleanProjectKey, issuePath, formatDateTime } from './lib/format.js';
import { useSeedRun } from './components/useSeedRun.js';
import { SeedPanel } from './components/SeedPanel.jsx';
import { ErrorBanner } from './components/ErrorBanner.jsx';
import { Loading, SAMPLE_NOTICE } from './components/EmptyStates.jsx';

const GET_STARTED_KEY = 'tb-get-started';

const GetStarted = () => (
  <Box padding="space.200" backgroundColor="color.background.neutral">
    <Stack space="space.100">
      <Heading size="medium" as="h2">Get started in three steps</Heading>
      <Text>1. Open a Jira project (a new, empty one is best), then click Traceability in the project sidebar. Or type its key below and click Check.</Text>
      <Text>2. Click Load sample data. About a minute later the matrix shows 92% readiness. {SAMPLE_NOTICE}</Text>
      <Text>3. Open the issue [REQ-7] Bolus dose limit, change &quot;25 units&quot; to &quot;20 units&quot; in its description and save. Back on Traceability, click Refresh: three tests turn SUSPECT and readiness drops to 75%. Click a SUSPECT test to see the word diff.</Text>
    </Stack>
  </Box>
);

const App = () => {
  const ctx = useProductContext();
  const locale = ctx?.locale;
  const isGetStarted = ctx?.moduleKey === GET_STARTED_KEY;
  const [keyInput, setKeyInput] = useState('');
  // The key field is uncontrolled (a value prop drops keystrokes in UI Kit); when the code sets
  // the key, bumping this remounts the field showing the new value.
  const [keyFieldVersion, setKeyFieldVersion] = useState(0);
  const [projectKey, setProjectKey] = useState(null);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [projects, setProjects] = useState(null);
  const [projectsError, setProjectsError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);

  const seed = useSeedRun(
    (run) => call('admin.seedStatus', { projectKey: run.projectKey, runId: run.runId }),
    () => {
      if (projectKey) runCheck(projectKey);
      loadProjects();
    },
  );

  const loadProjects = async () => {
    const r = await call('admin.listProjects');
    if (r.ok) {
      setProjects(r.data);
      setProjectsError(null);
    } else {
      setProjectsError(r.error);
    }
  };

  const runCheck = async (key) => {
    setChecking(true);
    setActionError(null);
    const r = await call('admin.health', key ? { projectKey: key } : {});
    if (r.ok) {
      setHealth(r.data);
      setHealthError(null);
    } else {
      // Never leave another project's results on screen next to this project's error.
      setHealth(null);
      setHealthError(r.error);
      if (key) seed.track(null);
    }
    if (key && r.ok) {
      const s = await call('admin.seedStatus', { projectKey: key });
      if (s.ok) seed.track(s.data.run);
      else seed.track(null);
    }
    setChecking(false);
  };

  useEffect(() => {
    runCheck(null);
    loadProjects();
  }, []);

  const keyValid = cleanProjectKey(keyInput);
  const check = (key) => {
    const k = cleanProjectKey(key);
    if (!k) return;
    if (k !== keyInput) setKeyFieldVersion((v) => v + 1);
    setKeyInput(k);
    setProjectKey(k);
    runCheck(k);
  };

  const startSeed = async () => {
    setBusy('seed');
    setActionError(null);
    const r = await call('admin.seedStart', { projectKey });
    setBusy(null);
    if (r.ok) seed.track(r.data);
    else setActionError(r.error);
  };

  const removeSeed = async () => {
    setBusy('remove');
    setActionError(null);
    const r = await call('admin.seedRemove', { projectKey, runId: seed.run?.runId });
    setBusy(null);
    if (r.ok) seed.track(r.data);
    else setActionError(r.error);
  };

  const summary = health ? healthSummary(health.checks) : null;
  const run = seed.run;
  const banner = seedBanner(run);
  const removeFailed = run?.status === 'failed' && run.error?.phase === 'remove';
  const canSeed = !!projectKey && !healthError && !isSeedActive(run) && (!run || run.status === 'removed' || (run.status === 'failed' && !removeFailed));

  const projectRows = (projects ?? []).map((p) => ({
    key: p.projectKey,
    cells: [
      { key: 'project', content: <Text><Link href={issuePath(p.projectKey)}>{p.projectKey}</Link></Text> },
      { key: 'mode', content: <Text size="small">{p.roleMode === 'issueTypes' ? 'Issue types' : 'Labels'}</Text> },
      { key: 'updated', content: <Text size="small">{formatDateTime(p.updatedAt, { locale })}</Text> },
      { key: 'sample', content: <Text size="small">{p.seed ? `${p.seed.status}${p.seed.actual !== null ? `, ${p.seed.actual}%` : ''}` : 'none'}</Text> },
      { key: 'act', content: <LoadingButton spacing="compact" isLoading={checking && projectKey === p.projectKey} onClick={() => check(p.projectKey)}>Check</LoadingButton> },
    ],
  }));

  return (
    <Stack space="space.300">
      <Stack space="space.100">
        <Heading size="large" as="h1">{isGetStarted ? 'Get started with Tracebound' : 'Tracebound setup'}</Heading>
        <Text>Tracebound marks a verification test SUSPECT when the requirement or risk control it verifies changed after the test last passed. It supports evidence for design-control traceability (IEC 62304, ISO 14971, ISO 26262 style). It makes no calls outside your Jira site and uses no AI model; Rovo is optional.</Text>
      </Stack>
      {isGetStarted ? <GetStarted /> : null}

      <Stack space="space.150">
        <Heading size="medium" as="h2">Health check</Heading>
        <Inline space="space.150" alignBlock="end" shouldWrap>
          <Stack space="space.050">
            <Label labelFor="tb-admin-project">Project key</Label>
            <Textfield key={keyFieldVersion} id="tb-admin-project" defaultValue={keyInput} placeholder="PUMP" isInvalid={keyInput.length > 0 && !keyValid} onChange={(e) => setKeyInput(e.target.value ?? '')} />
          </Stack>
          <LoadingButton appearance="primary" isLoading={checking} isDisabled={!keyValid} onClick={() => check(keyInput)}>Check</LoadingButton>
        </Inline>
        {!health && !healthError ? <Loading text="Running checks..." /> : null}
        <ErrorBanner error={healthError} onRetry={() => runCheck(projectKey)} title="The health check could not run" />
        {summary ? <SectionMessage appearance={summary.appearance} title={summary.title}><Text>{health.projectKey ? `Project ${health.projectKey}.` : 'Site checks only: type a project key and click Check for the project checks.'}</Text></SectionMessage> : null}
        {health ? (
          <Stack space="space.100">
            {health.checks.map((c) => {
              const s = stateOf(HEALTH, c.status);
              return (
                <Inline key={c.id} space="space.100" alignBlock="start">
                  <Lozenge appearance={s.appearance}>{s.label}</Lozenge>
                  <Stack space="space.025">
                    <Text weight="semibold">{c.label}</Text>
                    <Text size="small">{c.detail}</Text>
                    {c.nextStep ? <Text size="small">Next: {c.nextStep}</Text> : null}
                  </Stack>
                </Inline>
              );
            })}
            {health.sampleJql ? <Text size="small">Find sample issues in Jira search with <Code>{health.sampleJql}</Code></Text> : null}
          </Stack>
        ) : null}
      </Stack>

      {projectKey && !healthError ? (
        <Stack space="space.150">
          <Heading size="medium" as="h2">Sample data in {projectKey}</Heading>
          <Text>30 fictional insulin-pump issues (requirements, risks, risk controls, tests), linked with Relates and labelled tb-sample. {SAMPLE_NOTICE}</Text>
          <ErrorBanner error={actionError} title="That did not work" />
          {isSeedActive(run) ? <SeedPanel run={run} timedOut={seed.timedOut} pollError={seed.pollError} onResume={seed.resume} /> : null}
          {banner ? (
            <SectionMessage
              appearance={banner.appearance}
              title={banner.title}
              actions={banner.kind === 'SEED_FAILED' ? [<SectionMessageAction key="retry" onClick={startSeed}>Retry</SectionMessageAction>] : undefined}
            >
              <Stack space="space.050">
                <Text>{banner.kind === 'SEED_DONE' ? `Open ${projectKey} > Traceability to see the matrix.` : banner.body}</Text>
                {banner.hint ? <Text>Next step: {banner.hint}</Text> : null}
                {banner.warnings.map((w) => <Text key={w} size="small">{w}</Text>)}
              </Stack>
            </SectionMessage>
          ) : null}
          {run?.status === 'removed' ? <Text>The sample data ({runLabelOf(run)}) was removed. The audit log keeps its records.</Text> : null}
          <Inline space="space.100">
            {canSeed ? <LoadingButton appearance="primary" isLoading={busy === 'seed'} onClick={startSeed}>Load sample data</LoadingButton> : null}
            {run && (run.status === 'done' || removeFailed)
              ? <LoadingButton isLoading={busy === 'remove'} onClick={removeSeed}>Remove sample data</LoadingButton> : null}
          </Inline>
        </Stack>
      ) : null}

      <Stack space="space.150">
        <Heading size="medium" as="h2">Projects using Tracebound</Heading>
        <ErrorBanner error={projectsError} onRetry={loadProjects} />
        {projects === null && !projectsError ? <Loading text="Reading projects..." /> : null}
        {projects !== null ? (
          <DynamicTable
            caption="Configured projects"
            head={{ cells: [{ key: 'project', content: 'Project' }, { key: 'mode', content: 'Roles by' }, { key: 'updated', content: 'Settings saved' }, { key: 'sample', content: 'Sample data' }, { key: 'act', content: '' }] }}
            rows={projectRows}
            emptyView="No project is set up yet. Open a project, click Traceability, then Load sample data or Use default labels."
          />
        ) : null}
        <Text size="small">To open a project&apos;s matrix: click its key, then Traceability in the project sidebar.</Text>
      </Stack>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
