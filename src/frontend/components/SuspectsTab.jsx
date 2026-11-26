import React from 'react';
import { DynamicTable, Text, Link, Lozenge, Button } from '@forge/react';
import { suspectRows } from '../lib/matrix.js';
import { LINK_STATES, UPSTREAM_STATES, stateOf } from '../lib/states.js';
import { fieldLabel } from '../lib/diff.js';
import { formatDateTime, issuePath } from '../lib/format.js';

const head = {
  cells: [
    { key: 'item', content: 'Changed item' },
    { key: 'down', content: 'Affected test or control' },
    { key: 'kind', content: 'Kind' },
    { key: 'state', content: 'State' },
    { key: 'what', content: 'What changed' },
    { key: 'when', content: 'Changed at' },
    { key: 'act', content: '' },
  ],
};

/** Everything that needs a decision, in one flat list, with the same actions as the matrix. */
export const SuspectsTab = ({ trace, onOpen, locale }) => {
  const rows = suspectRows(trace).map((r) => {
    const s = stateOf(r.kind === 'link' ? LINK_STATES : UPSTREAM_STATES, r.state);
    const what = r.reason === 'CREATED_AFTER' ? 'Created after the pass' : (r.fields.map(fieldLabel).join(', ') || 'Change without text');
    return {
      key: `${r.kind}:${r.downKey}:${r.upKey}`,
      cells: [
        { key: 'item', content: <Text><Link href={issuePath(r.upKey)}>{r.upKey}</Link></Text> },
        { key: 'down', content: <Text><Link href={issuePath(r.downKey)}>{r.downKey}</Link></Text> },
        { key: 'kind', content: <Text size="small">{r.kind === 'link' ? 'Verification' : 'Upstream (control derives from requirement)'}</Text> },
        { key: 'state', content: <Lozenge appearance={s.appearance}>{s.label}</Lozenge> },
        { key: 'what', content: <Text size="small">{what}{r.clearedReason ? `. Cleared: ${r.clearedReason}` : ''}</Text> },
        { key: 'when', content: <Text size="small">{formatDateTime(r.changedAt, { locale })}</Text> },
        { key: 'act', content: <Button spacing="compact" onClick={() => onOpen({ kind: r.kind, downKey: r.downKey, upKey: r.upKey })}>Review</Button> },
      ],
    };
  });
  return (
    <DynamicTable
      caption="Suspect links and upstream changes"
      head={head}
      rows={rows}
      rowsPerPage={25}
      emptyView="Nothing is suspect: every passed test was run after the last substantive change of what it verifies."
    />
  );
};
