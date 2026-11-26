import React, { useEffect, useState } from 'react';
import { Stack, Inline, Text, DynamicTable, LoadingButton, SectionMessage, Tooltip, User } from '@forge/react';
import { call } from '../api.js';
import { auditAction, auditSubject, auditDetail, chainVerdict } from '../lib/audit.js';
import { formatDateTime, shortHash } from '../lib/format.js';
import { ErrorBanner } from './ErrorBanner.jsx';
import { Loading } from './EmptyStates.jsx';

/** Append-only, hash-chained audit log, newest first, 25 per page. */
export const AuditTab = ({ locale }) => {
  const [records, setRecords] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [verdict, setVerdict] = useState(null);

  const load = async (beforeSeq) => {
    setError(null);
    setBusy(beforeSeq ? 'older' : 'load');
    const r = await call('audit.list', { beforeSeq: beforeSeq ?? undefined, limit: 25 });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setRecords((prev) => (beforeSeq ? [...(prev ?? []), ...r.data.records] : r.data.records));
    setNextBefore(r.data.nextBeforeSeq);
  };
  useEffect(() => {
    load();
  }, []);

  const verify = async () => {
    setBusy('verify');
    const r = await call('audit.verify');
    setBusy(null);
    if (r.ok) setVerdict(chainVerdict(r.data));
    else setError(r.error);
  };

  const rows = (records ?? []).map((rec) => ({
    key: String(rec.seq),
    cells: [
      { key: 'seq', content: <Text>#{rec.seq}</Text> },
      { key: 'at', content: <Text size="small">{formatDateTime(rec.at, { locale })}</Text> },
      { key: 'actor', content: rec.actor ? <User accountId={rec.actor} /> : <Text size="small">The app</Text> },
      { key: 'action', content: <Text>{auditAction(rec.type)}</Text> },
      { key: 'subject', content: <Text size="small">{auditSubject(rec)}</Text> },
      { key: 'detail', content: <Text size="small">{auditDetail(rec)}</Text> },
      { key: 'hash', content: <Tooltip content={`hash ${rec.hash}, previous ${rec.prevHash}`}><Text size="small">{shortHash(rec.hash)}</Text></Tooltip> },
    ],
  }));

  return (
    <Stack space="space.200">
      <Inline spread="space-between" alignBlock="center" shouldWrap>
        <Text>Every setting change, clearance, re-verification task, baseline and sample-data run is recorded here. Each record carries the hash of the one before it, so a changed or missing record is evident.</Text>
        <LoadingButton isLoading={busy === 'verify'} onClick={verify}>Verify chain</LoadingButton>
      </Inline>
      {verdict ? <SectionMessage appearance={verdict.appearance} title={verdict.title}><Text>{verdict.body}</Text></SectionMessage> : null}
      <ErrorBanner error={error} onRetry={() => load()} />
      {records === null && !error ? <Loading text="Reading the audit log..." /> : null}
      {records !== null ? (
        <DynamicTable
          caption="Audit log"
          head={{ cells: [{ key: 'seq', content: '#' }, { key: 'at', content: 'Time' }, { key: 'actor', content: 'Actor' }, { key: 'action', content: 'Action' }, { key: 'subject', content: 'Subject' }, { key: 'detail', content: 'Detail' }, { key: 'hash', content: 'Hash' }] }}
          rows={rows}
          emptyView="No audit records yet. They appear when settings are saved, sample data is loaded, a flag is cleared, a task is created or a baseline is frozen."
        />
      ) : null}
      {nextBefore ? <LoadingButton isLoading={busy === 'older'} onClick={() => load(nextBefore)}>Load older</LoadingButton> : null}
    </Stack>
  );
};
