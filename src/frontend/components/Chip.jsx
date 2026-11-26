import React from 'react';
import { Inline, Button, Lozenge, Tooltip, Text, Link } from '@forge/react';
import { stateOf } from '../lib/states.js';
import { issuePath } from '../lib/format.js';

/**
 * One test (or upstream requirement) and its state. Actionable states are a bordered button that
 * opens the change (on the first real-site run the old subtle button looked like plain text, so
 * the obvious click target was missed); the others link to the issue.
 */
export const Chip = ({ issueKey, state, states, actionable, onOpen }) => {
  const s = stateOf(states, state);
  return (
    <Inline space="space.050" alignBlock="center">
      {actionable
        ? (
          <Tooltip content="Open what changed">
            <Button appearance="default" spacing="compact" onClick={onOpen}>{issueKey}</Button>
          </Tooltip>
        )
        : <Text><Link href={issuePath(issueKey)}>{issueKey}</Link></Text>}
      <Tooltip content={actionable ? `${s.help || s.label} Click ${issueKey} to see what changed.` : (s.help || s.label)}>
        <Lozenge appearance={s.appearance}>{s.label}</Lozenge>
      </Tooltip>
    </Inline>
  );
};
