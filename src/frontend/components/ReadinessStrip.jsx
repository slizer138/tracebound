import React from 'react';
import { Box, Stack, Inline, Heading, Text, ProgressBar, Lozenge, LoadingButton } from '@forge/react';
import { kpiLozenges } from '../lib/states.js';
import { pctText, pctValue, formatTime } from '../lib/format.js';

export const ReadinessStrip = ({ trace, release, computedAt, onRefresh, refreshing, locale }) => {
  const r = trace?.readiness ?? { ready: 0, total: 0, pct: null };
  return (
    <Box padding="space.200" backgroundColor="color.background.neutral">
      <Stack space="space.150">
        <Inline spread="space-between" alignBlock="center">
          <Inline space="space.200" alignBlock="center">
            <Heading size="xxlarge" as="h2">{pctText(r.pct)}</Heading>
            <Stack space="space.025">
              <Text weight="semibold">Release readiness {release ? `(release ${release})` : '(all items)'}</Text>
              <Text size="small">{r.ready} of {r.total} requirements and risk controls are verified against their current text.</Text>
            </Stack>
          </Inline>
          <LoadingButton isLoading={refreshing} onClick={onRefresh}>Refresh</LoadingButton>
        </Inline>
        <ProgressBar value={pctValue(r.pct)} appearance={r.pct === 100 ? 'success' : 'default'} ariaLabel="Release readiness" />
        <Inline space="space.100" shouldWrap>
          {kpiLozenges(trace?.kpis).map((k) => <Lozenge key={k.id} appearance={k.appearance}>{k.label}</Lozenge>)}
        </Inline>
        <Text size="small">Computed live from Jira at {formatTime(computedAt, { locale })}. Edits show up after Refresh.</Text>
      </Stack>
    </Box>
  );
};
