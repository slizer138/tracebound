import React, { useEffect, useState } from 'react';
import {
  Modal, ModalHeader, ModalTitle, ModalBody, ModalFooter, Stack, Inline, Heading, Text, Link, Lozenge,
  Button, LoadingButton, TextArea, Label, SectionMessage, User, Box,
} from '@forge/react';
import { call } from '../api.js';
import { LINK_STATES, UPSTREAM_STATES, ITEM_STATES, stateOf } from '../lib/states.js';
import {
  fieldLabel, changeReasonText, passSourceNote, fieldChangeView, isOpaqueField,
} from '../lib/diff.js';
import { checkReason, REASON_MAX } from '../lib/forms.js';
import { formatDateTime, issuePath, plural } from '../lib/format.js';
import { DiffText, DiffLegend } from './DiffText.jsx';
import { ErrorBanner } from './ErrorBanner.jsx';
import { Loading } from './EmptyStates.jsx';

const KeyLink = ({ k }) => <Link href={issuePath(k)}>{k}</Link>;

const StateLozenge = ({ map, state }) => {
  const s = stateOf(map, state);
  return <Lozenge appearance={s.appearance}>{s.label}</Lozenge>;
};

/** What changed: one block per substantive field. */
const Changes = ({ change, locale }) => {
  if (!change) return <Text>No substantive change is recorded for this pair.</Text>;
  return (
    <Stack space="space.200">
      <Text>{changeReasonText(change)}</Text>
      {(change.fields ?? []).map((f) => {
        const v = fieldChangeView(f);
        return (
          <Stack key={f.fieldId} space="space.075">
            <Heading size="xsmall" as="h4">{fieldLabel(f.fieldId)}</Heading>
            {v.opaque ? (
              <SectionMessage appearance="warning">
                <Stack space="space.050">
                  <Text>{v.note}</Text>
                  {v.currentText ? <Text>Text now: {v.currentText}</Text> : null}
                </Stack>
              </SectionMessage>
            ) : <DiffText ops={f.diff} />}
            <Inline space="space.100" alignBlock="center" shouldWrap>
              <Text size="small">{v.opaque ? 'Changed' : `${plural(v.stats.removed, 'word')} removed, ${v.stats.added} added. Changed`}</Text>
              {f.changedBy ? <User accountId={f.changedBy} /> : <Text size="small">by an unknown user</Text>}
              <Text size="small">at {formatDateTime(f.changedAt, { locale })}</Text>
            </Inline>
          </Stack>
        );
      })}
      {(change.fields ?? []).some((f) => !isOpaqueField(f)) ? <DiffLegend /> : null}
    </Stack>
  );
};

/** The ripple: every test of the changed item, its derived controls, their tests and risks. */
const Ripple = ({ impact }) => {
  if (!impact) return null;
  return (
    <Stack space="space.100">
      <Heading size="xsmall" as="h4">Ripple</Heading>
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Text><KeyLink k={impact.key} /> {impact.summary}</Text>
        <StateLozenge map={ITEM_STATES} state={impact.state} />
      </Inline>
      {impact.affectedLinks?.length ? (
        <Inline space="space.100" shouldWrap>
          <Text size="small">Tests:</Text>
          {impact.affectedLinks.map((l) => (
            <Inline key={l.testKey} space="space.050" alignBlock="center">
              <Text size="small"><KeyLink k={l.testKey} /></Text>
              <StateLozenge map={LINK_STATES} state={l.state} />
            </Inline>
          ))}
        </Inline>
      ) : null}
      {(impact.derivedControls ?? []).map((c) => (
        <Box key={c.ctrlKey} paddingInlineStart="space.300">
          <Stack space="space.050">
            <Inline space="space.100" alignBlock="center" shouldWrap>
              <Text size="small">Control <KeyLink k={c.ctrlKey} /> {c.summary}</Text>
              <StateLozenge map={UPSTREAM_STATES} state={c.state} />
            </Inline>
            <Inline space="space.100" shouldWrap>
              {(c.tests ?? []).map((l) => (
                <Inline key={l.testKey} space="space.050" alignBlock="center">
                  <Text size="small"><KeyLink k={l.testKey} /></Text>
                  <StateLozenge map={LINK_STATES} state={l.state} />
                </Inline>
              ))}
              {(c.risks ?? []).length ? <Text size="small">Mitigates {c.risks.join(', ')}</Text> : null}
            </Inline>
          </Stack>
        </Box>
      ))}
      {impact.role === 'req' && (impact.derivedControls ?? []).length === 0
        ? <Text size="small">No risk control derives from this requirement.</Text> : null}
    </Stack>
  );
};

/**
 * Suspect drawer: opened for a link (test verifies item) or an upstream flag (control derives from
 * requirement). Shows the word diff and offers "Create re-verification task" and
 * "Clear as not substantive" (reason required, written to the hash-chained audit log).
 */
export const ImpactModal = ({ target, onClose, onChanged, locale }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const [actionError, setActionError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const r = await call('link.getImpact', { downKey: target.downKey, upKey: target.upKey });
    if (r.ok) setData(r.data);
    else setError(r.error);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [target.downKey, target.upKey]);

  const kind = data?.entry?.kind ?? target.kind;
  const entry = data?.entry?.entry ?? null;
  const isLink = kind === 'link';
  const open = entry && (entry.state === 'SUSPECT' || entry.state === 'UPSTREAM_CHANGED');
  const reasonCheck = checkReason(reason);

  const createTask = async () => {
    setBusy('task');
    setActionError(null);
    const r = await call('link.createReverifyTask', { downKey: target.downKey, upKey: target.upKey });
    setBusy(null);
    if (!r.ok) {
      setActionError(r.error);
      return;
    }
    setResult({
      appearance: 'success',
      title: r.data.created ? `Created ${r.data.taskKey}` : `An open task already exists: ${r.data.taskKey}`,
      taskKey: r.data.taskKey,
      body: r.data.assigneeDropped ? 'Jira did not accept the test\'s assignee, so the task is unassigned.' : 'The task is linked to the test and recorded in the audit log.',
    });
    if (onChanged) onChanged();
  };

  const clear = async () => {
    if (!reasonCheck.ok || !entry) return;
    setBusy('clear');
    setActionError(null);
    const r = await call('link.clear', {
      downKey: target.downKey, upKey: target.upKey, kind, fingerprint: entry.fingerprint, reason,
    });
    setBusy(null);
    if (!r.ok) {
      setActionError(r.error);
      if (r.error.code === 'STALE') {
        await load();
        if (onChanged) onChanged();
      }
      return;
    }
    setClearing(false);
    setReason('');
    setResult({
      appearance: 'success',
      title: r.data.alreadyCleared ? 'This change was already cleared' : `Cleared, audit record #${r.data.auditSeq}`,
      body: 'The reason is in the audit log. If the text changes again, the flag comes back.',
    });
    await load();
    if (onChanged) onChanged();
  };

  const title = isLink
    ? `${target.downKey} is ${entry?.state === 'CLEARED' ? 'cleared' : 'suspect'} against ${target.upKey}`
    : `${target.downKey}: upstream ${target.upKey} changed`;

  return (
    <Modal onClose={onClose} width="x-large">
      <ModalHeader>
        <ModalTitle>{title}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        {loading && !data ? <Loading text="Reading the change history..." /> : null}
        <ErrorBanner error={error} onRetry={load} title="Could not load this change" />
        {entry ? (
          <Stack space="space.200">
            <Inline space="space.100" alignBlock="center" shouldWrap>
              <StateLozenge map={isLink ? LINK_STATES : UPSTREAM_STATES} state={entry.state} />
              {isLink ? (
                <Text>
                  <KeyLink k={target.downKey} /> last passed {formatDateTime(entry.passedAt, { locale })}; <KeyLink k={target.upKey} /> changed after that.
                </Text>
              ) : (
                <Text>
                  Control <KeyLink k={target.downKey} /> was last created or edited {formatDateTime(entry.since, { locale })}; requirement <KeyLink k={target.upKey} /> changed after that.
                </Text>
              )}
            </Inline>
            {isLink && passSourceNote(entry.passSource) ? <Text size="small">{passSourceNote(entry.passSource)}</Text> : null}
            {entry.state === 'CLEARED' && entry.clearance ? (
              <SectionMessage appearance="information" title={`Cleared as not substantive (audit record #${entry.clearance.auditSeq ?? '-'})`}>
                <Stack space="space.050">
                  <Text>Reason: {entry.clearance.reason}</Text>
                  <Inline space="space.100" alignBlock="center">
                    {entry.clearance.by ? <User accountId={entry.clearance.by} /> : null}
                    <Text size="small">{formatDateTime(entry.clearance.at, { locale })}</Text>
                  </Inline>
                </Stack>
              </SectionMessage>
            ) : null}
            <Changes change={entry.change} locale={locale} />
            <Ripple impact={data?.impact} />
            {result ? (
              <SectionMessage appearance={result.appearance} title={result.title}>
                <Stack space="space.050">
                  {result.taskKey ? <Text>Open <KeyLink k={result.taskKey} />.</Text> : null}
                  <Text>{result.body}</Text>
                </Stack>
              </SectionMessage>
            ) : null}
            <ErrorBanner error={actionError} title={actionError?.code === 'STALE' ? 'The change moved on' : 'The action did not complete'} />
            {clearing ? (
              <Stack space="space.075">
                <Label labelFor="tb-clear-reason">Why is this change not substantive for {isLink ? 'this test' : 'this control'}?</Label>
                {/* Uncontrolled on purpose: a value prop round-trips every keystroke through the
                    UI Kit bridge and drops characters while the user types. */}
                <TextArea
                  id="tb-clear-reason"
                  defaultValue=""
                  maxLength={REASON_MAX}
                  minimumRows={3}
                  isInvalid={reason.length > 0 && !reasonCheck.ok}
                  placeholder="For example: typo fix in the rationale; the limit and units are unchanged."
                  onChange={(e) => setReason(e.target.value ?? '')}
                />
                <Text size="small">{reasonCheck.message}</Text>
                <Inline space="space.100">
                  <LoadingButton appearance="warning" isLoading={busy === 'clear'} isDisabled={!reasonCheck.ok || !!busy} onClick={clear}>Confirm clearance</LoadingButton>
                  <Button appearance="subtle" onClick={() => setClearing(false)}>Cancel</Button>
                </Inline>
              </Stack>
            ) : null}
          </Stack>
        ) : null}
      </ModalBody>
      <ModalFooter>
        {open && !result?.taskKey ? (
          <LoadingButton appearance="primary" isLoading={busy === 'task'} isDisabled={!!busy} onClick={createTask}>Create re-verification task</LoadingButton>
        ) : null}
        {open && !clearing ? <Button isDisabled={!!busy} onClick={() => { setReason(''); setClearing(true); }}>Clear as not substantive</Button> : null}
        <Button appearance="subtle" onClick={onClose}>Close</Button>
      </ModalFooter>
    </Modal>
  );
};
