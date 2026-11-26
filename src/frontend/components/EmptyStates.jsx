import React from 'react';
import { EmptyState, Button, LoadingButton, Stack, Text, Spinner, Inline } from '@forge/react';

export const SAMPLE_NOTICE = 'Fictional sample data. Not clinical guidance.';

// EmptyState's documented description is a string and its documented action examples carry no
// onClick, so the buttons are rendered as ordinary children below it instead of as action props.

export const Loading = ({ text }) => (
  <Inline space="space.100" alignBlock="center">
    <Spinner size="medium" label="Loading" />
    <Text>{text ?? 'Reading issues and changelogs...'}</Text>
  </Inline>
);

const labelHelp = (labels) => `Put one label on each issue: ${labels.req} (requirement), ${labels.risk} (risk), ${labels.ctrl} (risk control), ${labels.test} (verification test). Then link each test to the requirement or control it verifies, and each control to its requirement and risk. Any link type works, including Relates.`;

/** NOT_CONFIGURED: Tracebound has no settings for this project and sees no labelled issues. */
export const NotConfigured = ({ onUseDefaults, onSeed, busy, labels }) => (
  <Stack space="space.200">
    <EmptyState
      header="Tracebound is not set up for this project"
      description="Tracebound shows which verification tests still prove the current text of your requirements and risk controls. It supports evidence for design-control traceability (IEC 62304, ISO 14971, ISO 26262 style). Quickest start: load the sample insulin-pump data (30 issues, about a minute)."
    />
    <Inline space="space.100" alignInline="center">
      <LoadingButton appearance="primary" isLoading={busy === 'seed'} isDisabled={!!busy} onClick={onSeed}>Load sample data</LoadingButton>
      <LoadingButton isLoading={busy === 'defaults'} isDisabled={!!busy} onClick={onUseDefaults}>Use default labels</LoadingButton>
    </Inline>
    <Text size="small" align="center">{SAMPLE_NOTICE}</Text>
    <Text size="small" align="center">To use your own issues instead: {labelHelp(labels)}</Text>
  </Stack>
);

/** NO_TRACE_ISSUES: settings exist but no issue carries a role. */
export const NoTraceIssues = ({ onSeed, onRefresh, busy, labels }) => (
  <Stack space="space.200">
    <EmptyState header="No issues with a Tracebound role yet" description={labelHelp(labels)} />
    <Inline space="space.100" alignInline="center">
      <LoadingButton appearance="primary" isLoading={busy === 'seed'} isDisabled={!!busy} onClick={onSeed}>Load sample data</LoadingButton>
      <Button onClick={onRefresh}>I added labels: refresh</Button>
    </Inline>
    <Text size="small" align="center">{SAMPLE_NOTICE}</Text>
  </Stack>
);
