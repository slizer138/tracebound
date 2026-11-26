// Project page "Traceability": readiness strip, trace matrix, suspects, baselines, audit log, settings.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Stack, Inline, Text, Select, Toggle, Label, Tabs, TabList, Tab, TabPanel, SectionMessage,
  SectionMessageAction, ModalTransition, Link, Box, useProductContext,
} from '@forge/react';
import { call } from './api.js';
import { VIEW, projectViewState, seedBanner } from './lib/view.js';
import { releaseOptions, otherGaps, suspectRows } from './lib/matrix.js';
import { issuePath } from './lib/format.js';
import { useSeedRun } from './components/useSeedRun.js';
import { ReadinessStrip } from './components/ReadinessStrip.jsx';
import { MatrixTable } from './components/MatrixTable.jsx';
import { SuspectsTab } from './components/SuspectsTab.jsx';
import { BaselinesTab } from './components/BaselinesTab.jsx';
import { AuditTab } from './components/AuditTab.jsx';
import { SettingsTab } from './components/SettingsTab.jsx';
import { ImpactModal } from './components/ImpactModal.jsx';
import { SeedPanel } from './components/SeedPanel.jsx';
import { ErrorBanner } from './components/ErrorBanner.jsx';
import { Loading, NotConfigured, NoTraceIssues, SAMPLE_NOTICE } from './components/EmptyStates.jsx';

const DEFAULT_LABELS = { req: 'trace-req', risk: 'trace-risk', ctrl: 'trace-ctrl', test: 'trace-test' };

const KeyList = ({ keys }) => (
  <Text>{keys.map((k, i) => <React.Fragment key={k}>{i ? ', ' : ''}<Link href={issuePath(k)}>{k}</Link></React.Fragment>)}</Text>
);

const App = () => {
  const ctx = useProductContext();
  const locale = ctx?.locale;
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [release, setRelease] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [tab, setTab] = useState(0);
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  // Polls seed.status while sample data loads or is removed; reloads the view when it finishes.
  const seed = useSeedRun((run) => call('seed.status', { runId: run.runId }), () => load());

  const load = async () => {
    setRefreshing(true);
    const r = await call('project.getView', { release: release || null, onlyGaps });
    setRefreshing(false);
    if (r.ok) {
      setView(r.data);
      setError(null);
      seed.track(r.data.seed);
    } else {
      setError(r.error);
    }
  };

  useEffect(() => {
    load();
  }, [release, onlyGaps]);

  const startSeed = async () => {
    setBusy('seed');
    setActionError(null);
    const r = await call('seed.start');
    setBusy(null);
    if (r.ok) seed.track(r.data);
    else setActionError(r.error);
  };

  const removeSeed = async (runId) => {
    setBusy('remove');
    setActionError(null);
    const r = await call('seed.remove', { runId });
    setBusy(null);
    if (r.ok) seed.track(r.data);
    else setActionError(r.error);
  };

  const useDefaults = async () => {
    setBusy('defaults');
    setActionError(null);
    const r = await call('project.useDefaults');
    setBusy(null);
    if (r.ok) await load();
    else setActionError(r.error);
  };

  const state = projectViewState({ view, error, seedRun: seed.run });
  const labels = view?.config?.labels ?? DEFAULT_LABELS;

  if (state === VIEW.LOADING) return <Loading />;
  if (state === VIEW.ERROR) {
    // A bad configuration (for example a misspelled issue type in role mode "issue types")
    // makes the view unreadable; the Settings form is shown under the error so it can be fixed.
    if (error?.code === 'CONFIG_INVALID') {
      return (
        <Stack space="space.200">
          <ErrorBanner error={error} onRetry={load} title="Tracebound could not read this project" />
          <SettingsTab onSaved={load} />
        </Stack>
      );
    }
    return <ErrorBanner error={error} onRetry={load} title="Tracebound could not read this project" />;
  }

  const run = seed.run ?? view.seed;
  const banner = seedBanner(run, view.trace?.readiness?.pct ?? null);
  const trace = view.trace;
  const gaps = otherGaps(trace);
  const suspectCount = suspectRows(trace).filter((r) => r.state !== 'CLEARED').length;

  let body;
  if (state === VIEW.SEEDING) {
    body = <SeedPanel run={run} timedOut={seed.timedOut} pollError={seed.pollError} onResume={seed.resume} />;
  } else if (state === VIEW.NOT_CONFIGURED) {
    body = <NotConfigured labels={labels} busy={busy} onSeed={startSeed} onUseDefaults={useDefaults} />;
  } else if (state === VIEW.NO_TRACE_ISSUES) {
    body = <NoTraceIssues labels={labels} busy={busy} onSeed={startSeed} onRefresh={load} />;
  } else {
    body = (
      <Stack space="space.200">
        <ReadinessStrip trace={trace} release={view.trace.release} computedAt={view.info.computedAt} onRefresh={load} refreshing={refreshing} locale={locale} />
        <Tabs id="tb-project-tabs" selected={tab} onChange={(i) => setTab(i)} shouldUnmountTabPanelOnChange>
          <TabList>
            <Tab>Matrix</Tab>
            <Tab>{`Suspects (${suspectCount})`}</Tab>
            <Tab>Baselines</Tab>
            <Tab>Audit log</Tab>
            <Tab>Settings</Tab>
          </TabList>
          <TabPanel>
            <Stack space="space.200">
              <Inline space="space.300" alignBlock="end" shouldWrap>
                <Stack space="space.050">
                  <Label labelFor="tb-release">Release (fixVersion)</Label>
                  <Select
                    inputId="tb-release"
                    options={releaseOptions(view.releases)}
                    value={releaseOptions(view.releases).find((o) => o.value === release)}
                    onChange={(o) => setRelease(o?.value ?? '')}
                  />
                </Stack>
                <Inline space="space.050" alignBlock="center">
                  <Toggle id="tb-only-gaps" isChecked={onlyGaps} onChange={() => setOnlyGaps((v) => !v)} />
                  <Label labelFor="tb-only-gaps">Only gaps</Label>
                </Inline>
              </Inline>
              <MatrixTable trace={trace} onlyGaps={onlyGaps} onOpen={setTarget} />
              {gaps.unmitigatedRisks.length ? (
                <Stack space="space.050">
                  <Text weight="semibold">Unmitigated risks (no risk control linked)</Text>
                  <KeyList keys={gaps.unmitigatedRisks.map((r) => r.key)} />
                </Stack>
              ) : null}
              {gaps.orphanTests.length ? (
                <Stack space="space.050">
                  <Text weight="semibold">Orphan tests (verify nothing)</Text>
                  <KeyList keys={gaps.orphanTests} />
                </Stack>
              ) : null}
            </Stack>
          </TabPanel>
          <TabPanel>
            {tab === 1 ? <SuspectsTab trace={trace} onOpen={setTarget} locale={locale} /> : <Box />}
          </TabPanel>
          <TabPanel>
            {tab === 2 ? <BaselinesTab releases={view.releases} locale={locale} /> : <Box />}
          </TabPanel>
          <TabPanel>
            {tab === 3 ? <AuditTab locale={locale} /> : <Box />}
          </TabPanel>
          <TabPanel>
            {tab === 4 ? <SettingsTab onSaved={load} /> : <Box />}
          </TabPanel>
        </Tabs>
      </Stack>
    );
  }

  return (
    <Stack space="space.200">
      <Text size="small">Tracebound supports evidence for design-control traceability (IEC 62304, ISO 14971, ISO 26262 style): it shows which verification tests still prove the current text of each requirement and risk control.</Text>
      {error ? <ErrorBanner error={error} onRetry={load} title="Refresh failed; showing the last result" /> : null}
      <ErrorBanner error={actionError} title="That did not work" />
      {banner && state !== VIEW.SEEDING ? (
        <SectionMessage
          appearance={banner.appearance}
          title={banner.title}
          actions={banner.kind === 'SEED_DONE'
            ? [<SectionMessageAction key="remove" onClick={() => removeSeed(run.runId)}>{busy === 'remove' ? 'Removing...' : 'Remove sample data'}</SectionMessageAction>]
            : [<SectionMessageAction key="retry" onClick={banner.kind === 'REMOVE_FAILED' ? () => removeSeed(run.runId) : startSeed}>Retry</SectionMessageAction>]}
        >
          <Stack space="space.050">
            <Text>{banner.body}</Text>
            {banner.hint ? <Text>Next step: {banner.hint}</Text> : null}
            {banner.warnings.map((w) => <Text key={w} size="small">{w}</Text>)}
            {banner.kind === 'SEED_DONE' ? <Text size="small">{SAMPLE_NOTICE}</Text> : null}
          </Stack>
        </SectionMessage>
      ) : null}
      {state === VIEW.READY && !view.configured ? (
        <SectionMessage appearance="information" title="Using the default labels" actions={[<SectionMessageAction key="defaults" onClick={useDefaults}>Save the defaults</SectionMessageAction>]}>
          <Text>No settings are saved for this project yet, so trace-req, trace-risk, trace-ctrl and trace-test are assumed.</Text>
        </SectionMessage>
      ) : null}
      {(view.configErrors ?? []).length ? (
        <SectionMessage appearance="warning" title="Saved settings have problems; defaults are used where invalid">
          <Stack space="space.050">{view.configErrors.map((e) => <Text key={e}>{e}</Text>)}</Stack>
        </SectionMessage>
      ) : null}
      {view.info?.truncated ? (
        <SectionMessage appearance="warning" title="Showing the first 500 trace issues">
          <Text>Tracebound reads at most 500 trace issues per view. Use the release filter to narrow the view.</Text>
        </SectionMessage>
      ) : null}
      {(view.info?.warnings ?? []).filter((w) => !/^Showing the first/.test(w)).map((w) => (
        <SectionMessage key={w} appearance="warning"><Text>{w}</Text></SectionMessage>
      ))}
      {(trace?.warnings ?? []).length ? (
        <SectionMessage appearance="information" title="Data notes">
          <Stack space="space.050">{trace.warnings.map((w) => <Text key={w} size="small">{w}</Text>)}</Stack>
        </SectionMessage>
      ) : null}
      {body}
      <ModalTransition>
        {target ? <ImpactModal target={target} locale={locale} onClose={() => setTarget(null)} onChanged={load} /> : null}
      </ModalTransition>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
