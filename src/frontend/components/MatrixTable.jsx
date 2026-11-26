import React from 'react';
import { DynamicTable, Stack, Inline, Text, Link, Lozenge, Tooltip } from '@forge/react';
import { matrixRows } from '../lib/matrix.js';
import { ITEM_STATES, LINK_STATES, UPSTREAM_STATES, ROLES, stateOf } from '../lib/states.js';
import { issuePath } from '../lib/format.js';
import { Chip } from './Chip.jsx';

const head = {
  cells: [
    { key: 'item', content: 'Item', width: 34 },
    { key: 'state', content: 'Item state', width: 14 },
    { key: 'verification', content: 'Verification', width: 34 },
    { key: 'related', content: 'Controls / requirements / risks', width: 18 },
  ],
};

/**
 * The trace matrix: one row per requirement and risk control.
 * onOpen({kind, downKey, upKey}) opens the change modal for a suspect, cleared or upstream entry.
 */
export const MatrixTable = ({ trace, onOpen, onlyGaps }) => {
  const rows = matrixRows(trace).map((r) => {
    const st = stateOf(ITEM_STATES, r.state);
    return {
      key: r.key,
      cells: [
        {
          key: 'item',
          content: (
            <Stack space="space.050">
              <Inline space="space.075" alignBlock="center">
                <Lozenge>{ROLES[r.role]?.label ?? r.role}</Lozenge>
                <Text><Link href={issuePath(r.key)}>{r.key}</Link></Text>
              </Inline>
              <Text size="small">{r.summary}</Text>
            </Stack>
          ),
        },
        {
          key: 'state',
          content: <Tooltip content={st.help}><Lozenge appearance={st.appearance}>{st.label}</Lozenge></Tooltip>,
        },
        {
          key: 'verification',
          content: (
            <Stack space="space.050">
              {r.chips.length === 0 ? <Text size="small">No test linked</Text> : null}
              <Inline space="space.100" shouldWrap>
                {r.chips.map((c) => (
                  <Chip
                    key={c.testKey}
                    issueKey={c.testKey}
                    state={c.state}
                    states={LINK_STATES}
                    actionable={c.actionable}
                    onOpen={() => onOpen({ kind: 'link', downKey: c.testKey, upKey: r.key })}
                  />
                ))}
              </Inline>
              {r.upstream.filter((u) => u.state !== 'OK').map((u) => (
                <Inline key={u.reqKey} space="space.050" alignBlock="center">
                  <Text size="small">Upstream</Text>
                  <Chip
                    issueKey={u.reqKey}
                    state={u.state}
                    states={UPSTREAM_STATES}
                    actionable={u.actionable}
                    onOpen={() => onOpen({ kind: 'upstream', downKey: r.key, upKey: u.reqKey })}
                  />
                </Inline>
              ))}
            </Stack>
          ),
        },
        {
          key: 'related',
          content: r.related.length
            ? <Text size="small">{r.related.map((k, i) => <React.Fragment key={k}>{i ? ', ' : ''}<Link href={issuePath(k)}>{k}</Link></React.Fragment>)}</Text>
            : <Text size="small">-</Text>,
        },
      ],
    };
  });
  return (
    <DynamicTable
      caption="Trace matrix"
      head={head}
      rows={rows}
      rowsPerPage={25}
      emptyView={onlyGaps ? 'No gaps: every item in this view is ready.' : 'No requirements or risk controls in this view. Choose "All items" in the release filter.'}
    />
  );
};
