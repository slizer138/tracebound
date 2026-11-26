import React, { useEffect, useState } from 'react';
import {
  Stack, Inline, Heading, Text, Textfield, Select, Label, LoadingButton, Button, DynamicTable, Lozenge,
  Tooltip, User, Code, SectionMessage, Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter, ModalTransition,
} from '@forge/react';
import { call } from '../api.js';
import { checkBaselineName, BASELINE_NAME_MAX } from '../lib/forms.js';
import { baselineVerdict } from '../lib/audit.js';
import { releaseOptions } from '../lib/matrix.js';
import { ITEM_STATES, LINK_STATES, UPSTREAM_STATES, stateOf } from '../lib/states.js';
import { formatDateTime, pctText, shortHash } from '../lib/format.js';
import { ErrorBanner } from './ErrorBanner.jsx';
import { Loading } from './EmptyStates.jsx';

const S = ({ map, state }) => {
  const s = stateOf(map, state);
  return <Lozenge appearance={s.appearance}>{s.label}</Lozenge>;
};

/** Read-only view of a frozen baseline, printable from the browser. */
const BaselineView = ({ id, onClose, locale }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = async () => {
    setError(null);
    const r = await call('baseline.get', { id });
    if (r.ok) setData(r.data);
    else setError(r.error);
  };
  useEffect(() => {
    load();
  }, [id]);
  const p = data?.payload;
  const rows = (p?.items ?? []).map((i) => ({
    key: i.key,
    cells: [
      { key: 'item', content: <Text>{i.key} {i.summary}</Text> },
      { key: 'state', content: <S map={ITEM_STATES} state={i.state} /> },
      {
        key: 'tests',
        content: (
          <Inline space="space.100" shouldWrap>
            {i.tests.map((t) => <Inline key={t.key} space="space.050"><Text size="small">{t.key}</Text><S map={LINK_STATES} state={t.state} /></Inline>)}
          </Inline>
        ),
      },
      { key: 'hash', content: <Text size="small">{shortHash(i.textHash)}</Text> },
    ],
  }));
  return (
    <Modal onClose={onClose} width="x-large">
      <ModalHeader>
        <ModalTitle>{p ? `Baseline: ${p.name}` : 'Baseline'}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        {!data && !error ? <Loading text="Reading the baseline..." /> : null}
        <ErrorBanner error={error} onRetry={load} />
        {p ? (
          <Stack space="space.200">
            <Text>Project {p.projectKey}{p.release ? `, release ${p.release}` : ''}. Readiness {pctText(p.readiness?.pct)} ({p.readiness?.ready}/{p.readiness?.total}).{p.sample ? ' Fictional sample data. Not clinical guidance.' : ''}</Text>
            <DynamicTable
              caption="Frozen trace matrix"
              head={{ cells: [{ key: 'item', content: 'Item' }, { key: 'state', content: 'State' }, { key: 'tests', content: 'Tests' }, { key: 'hash', content: 'Text hash' }] }}
              rows={rows}
              emptyView="This baseline has no items."
            />
            {(p.upstream ?? []).filter((u) => u.state !== 'OK').length ? (
              <Stack space="space.050">
                <Heading size="xsmall" as="h4">Upstream flags</Heading>
                {p.upstream.filter((u) => u.state !== 'OK').map((u) => (
                  <Inline key={`${u.ctrlKey}:${u.reqKey}`} space="space.100"><Text size="small">{u.ctrlKey} derives from {u.reqKey}</Text><S map={UPSTREAM_STATES} state={u.state} /></Inline>
                ))}
              </Stack>
            ) : null}
            <Stack space="space.050">
              <Text size="small">SHA-256 of the canonical JSON: <Code>{data.meta.hash}</Code></Text>
              <Text size="small">Engine {p.engineVersion}. Created {formatDateTime(p.createdAtIso, { locale })}. Audit record #{data.meta.auditSeq ?? '-'}.</Text>
              <Text size="small">Use your browser&apos;s print to save this report.</Text>
            </Stack>
          </Stack>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose}>Close</Button>
      </ModalFooter>
    </Modal>
  );
};

/** Freeze, list, verify and view hashed baselines of the trace matrix. */
export const BaselinesTab = ({ releases, locale, onFrozen }) => {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  // The name field is uncontrolled (see ImpactModal); bumping this key remounts it empty.
  const [nameKey, setNameKey] = useState(0);
  const [release, setRelease] = useState(releaseOptions(releases)[0]);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [verdicts, setVerdicts] = useState({});
  const [viewing, setViewing] = useState(null);

  const load = async () => {
    setError(null);
    const r = await call('baseline.list');
    if (r.ok) setItems(r.data);
    else setError(r.error);
  };
  useEffect(() => {
    load();
  }, []);

  const nameCheck = checkBaselineName(name);
  const freeze = async () => {
    if (!nameCheck.ok) return;
    setBusy('freeze');
    setNotice(null);
    setError(null);
    const r = await call('baseline.freeze', { name: name.trim(), release: release?.value || null });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setName('');
    setNameKey((k) => k + 1);
    setNotice(`Froze "${r.data.name}" at ${pctText(r.data.readinessPct)} readiness (audit record #${r.data.auditSeq}).`);
    await load();
    if (onFrozen) onFrozen();
  };

  const verify = async (id) => {
    setBusy(`verify:${id}`);
    const r = await call('baseline.verify', { id });
    setBusy(null);
    setVerdicts((v) => ({ ...v, [id]: r.ok ? baselineVerdict(r.data) : { ok: false, text: r.error.message } }));
  };

  const rows = (items ?? []).map((b) => ({
    key: b.id,
    cells: [
      { key: 'name', content: <Inline space="space.075" alignBlock="center"><Text>{b.name}</Text>{b.sample ? <Lozenge>sample</Lozenge> : null}{b.release ? <Lozenge appearance="new">{b.release}</Lozenge> : null}</Inline> },
      { key: 'created', content: <Text size="small">{formatDateTime(b.createdAt, { locale })}</Text> },
      { key: 'by', content: b.createdBy ? <User accountId={b.createdBy} /> : <Text size="small">The app</Text> },
      { key: 'ready', content: <Text>{pctText(b.readinessPct)}</Text> },
      { key: 'hash', content: <Tooltip content={b.hash}><Text size="small">{shortHash(b.hash)}</Text></Tooltip> },
      {
        key: 'actions',
        content: (
          <Inline space="space.075" alignBlock="center" shouldWrap>
            <LoadingButton spacing="compact" isLoading={busy === `verify:${b.id}`} onClick={() => verify(b.id)}>Verify</LoadingButton>
            <Button spacing="compact" onClick={() => setViewing(b.id)}>View</Button>
            {verdicts[b.id] ? <Lozenge appearance={verdicts[b.id].ok ? 'success' : 'removed'}>{verdicts[b.id].text}</Lozenge> : null}
          </Inline>
        ),
      },
    ],
  }));

  return (
    <Stack space="space.200">
      <Text>A baseline freezes the trace matrix for a release: each item&apos;s state, its tests&apos; states and a hash of its text. The whole snapshot is hashed (SHA-256) and the hash is recorded in the audit log, so later changes to the stored copy are evident.</Text>
      <Inline space="space.200" alignBlock="end" shouldWrap>
        <Stack space="space.050">
          <Label labelFor="tb-baseline-name">Baseline name</Label>
          <Textfield key={nameKey} id="tb-baseline-name" defaultValue="" maxLength={BASELINE_NAME_MAX} placeholder="Release 2.1" onChange={(e) => setName(e.target.value ?? '')} />
        </Stack>
        <Stack space="space.050">
          <Label labelFor="tb-baseline-release">Release (optional)</Label>
          <Select inputId="tb-baseline-release" options={releaseOptions(releases)} value={release} onChange={(o) => setRelease(o)} />
        </Stack>
        <LoadingButton appearance="primary" isLoading={busy === 'freeze'} isDisabled={!nameCheck.ok || !!busy} onClick={freeze}>Freeze baseline</LoadingButton>
      </Inline>
      {notice ? <SectionMessage appearance="success"><Text>{notice}</Text></SectionMessage> : null}
      <ErrorBanner error={error} onRetry={load} />
      {items === null && !error ? <Loading text="Reading baselines..." /> : null}
      {items !== null ? (
        <DynamicTable
          caption="Baselines"
          head={{ cells: [{ key: 'name', content: 'Name' }, { key: 'created', content: 'Created' }, { key: 'by', content: 'By' }, { key: 'ready', content: 'Readiness' }, { key: 'hash', content: 'Hash' }, { key: 'actions', content: '' }] }}
          rows={rows}
          rowsPerPage={25}
          emptyView="No baselines yet. Type a name above and click Freeze baseline."
        />
      ) : null}
      <ModalTransition>
        {viewing ? <BaselineView id={viewing} locale={locale} onClose={() => setViewing(null)} /> : null}
      </ModalTransition>
    </Stack>
  );
};
