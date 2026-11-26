// Issue context panel "Trace health": the verification status of one requirement, control, risk or test.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Stack, Inline, Text, Lozenge, Button, LoadingButton, SectionMessage, EmptyState, ModalTransition,
  Link, useProductContext,
} from '@forge/react';
import { call } from './api.js';
import { panelModel } from './lib/panel.js';
import { ITEM_STATES, LINK_STATES, UPSTREAM_STATES, ROLES, stateOf, isActionable } from './lib/states.js';
import { formatDateTime, formatTime, issuePath } from './lib/format.js';
import { ImpactModal } from './components/ImpactModal.jsx';
import { ErrorBanner } from './components/ErrorBanner.jsx';
import { Loading } from './components/EmptyStates.jsx';

const mapFor = (kind) => (kind === 'upstream' ? UPSTREAM_STATES : kind === 'control' ? ITEM_STATES : LINK_STATES);

const App = () => {
  const ctx = useProductContext();
  const locale = ctx?.locale;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState(null);

  const load = async () => {
    setLoading(true);
    const r = await call('issue.getPanel');
    setLoading(false);
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else {
      setError(r.error);
    }
  };
  useEffect(() => {
    load();
  }, []);

  if (!data && !error) return <Loading text="Checking verification status..." />;
  if (!data) return <ErrorBanner error={error} onRetry={load} title="Tracebound could not read this issue" />;

  const fmt = (ms) => formatDateTime(ms, { locale });
  const model = panelModel(data, fmt);
  const projectKey = data.projectKey;

  if (model.kind === 'none') {
    const l = data.labels ?? {};
    return (
      <Stack space="space.100">
        <EmptyState
          width="narrow"
          header="No Tracebound role"
          description={`This issue has no Tracebound role. Add label ${l.req ?? 'trace-req'}, ${l.ctrl ?? 'trace-ctrl'}, ${l.test ?? 'trace-test'} or ${l.risk ?? 'trace-risk'}, link it, then click Refresh.`}
        />
        <Inline space="space.100" alignBlock="center">
          <LoadingButton spacing="compact" isLoading={loading} onClick={load}>Refresh</LoadingButton>
          <Text size="small">Overview: open <Link href={issuePath(projectKey)}>{projectKey}</Link>, then Traceability.</Text>
        </Inline>
      </Stack>
    );
  }

  const itemState = data.itemState ? stateOf(ITEM_STATES, data.itemState) : null;
  return (
    <Stack space="space.150">
      {error ? <ErrorBanner error={error} onRetry={load} title="Refresh failed; showing the last result" /> : null}
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Lozenge>{ROLES[data.role]?.name ?? data.role}</Lozenge>
        {itemState ? <Lozenge appearance={itemState.appearance}>{itemState.label}</Lozenge> : null}
      </Inline>
      {model.message ? (
        <SectionMessage appearance={model.message.appearance} title={model.message.title}>
          <Text>{model.message.body}</Text>
        </SectionMessage>
      ) : null}
      <Stack space="space.075">
        {model.lines.map((line) => {
          const s = stateOf(mapFor(line.kind), line.state);
          const actionable = (line.kind === 'link' || line.kind === 'upstream') && isActionable(line.state);
          return (
            <Inline key={`${line.kind}:${line.key}`} space="space.075" alignBlock="center" shouldWrap>
              {actionable
                ? <Button appearance="subtle" spacing="compact" onClick={() => setTarget({ kind: line.kind, downKey: line.downKey, upKey: line.upKey })}>{line.key}</Button>
                : <Text><Link href={issuePath(line.key)}>{line.key}</Link></Text>}
              <Lozenge appearance={s.appearance}>{s.label}</Lozenge>
              {line.text !== line.key ? <Text size="small">{line.text}</Text> : null}
            </Inline>
          );
        })}
      </Stack>
      <Inline space="space.100" alignBlock="center">
        <LoadingButton spacing="compact" isLoading={loading} onClick={load}>Refresh</LoadingButton>
        <Text size="small">Checked at {formatTime(data.computedAt, { locale })}</Text>
      </Inline>
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
