import React from 'react';
import { Text, Inline } from '@forge/react';
import { diffSegments } from '../lib/diff.js';

/** Word diff: deleted words struck through (red), inserted words bold (green), equal words plain. */
export const DiffText = ({ ops }) => {
  const segments = diffSegments(ops);
  if (segments.length === 0) return <Text>(empty)</Text>;
  return (
    <Text>
      {segments.map((s, i) => (
        <React.Fragment key={i}>
          {s.lead ? ' ' : ''}
          {s.op === 'eq' ? s.text : null}
          {s.op === 'del' ? <Text as="strike" color="color.text.danger">{s.text}</Text> : null}
          {s.op === 'ins' ? <Text as="strong" color="color.text.success">{s.text}</Text> : null}
        </React.Fragment>
      ))}
    </Text>
  );
};

export const DiffLegend = () => (
  <Inline space="space.200">
    <Text size="small">Legend:</Text>
    <Text size="small" as="strike" color="color.text.danger">removed</Text>
    <Text size="small" as="strong" color="color.text.success">added</Text>
    <Text size="small">unchanged</Text>
  </Inline>
);
