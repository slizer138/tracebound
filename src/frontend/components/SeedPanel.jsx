import React from 'react';
import { Stack, Heading, Text, ProgressBar, SectionMessage, SectionMessageAction } from '@forge/react';
import { seedProgress, runLabelOf } from '../lib/view.js';
import { SAMPLE_NOTICE } from './EmptyStates.jsx';

/** Live progress of a sample-data run (load or remove). There is no cancel: the job is resumable. */
export const SeedPanel = ({ run, timedOut, pollError, onResume }) => {
  const p = seedProgress(run);
  const removing = run?.status === 'removing';
  return (
    <Stack space="space.150">
      <Heading size="medium" as="h3">{removing ? 'Removing sample data' : 'Loading sample data'}</Heading>
      <ProgressBar value={p.value} isIndeterminate={p.isIndeterminate} ariaLabel="Sample data progress" />
      <Text>{p.phaseText}{p.label ? ` (${p.label} steps)` : ''}</Text>
      <Text size="small">This runs as a background job; you can leave this page. Issues are labelled {runLabelOf(run) ?? 'tb-sample'}. {SAMPLE_NOTICE}</Text>
      {timedOut ? (
        <SectionMessage appearance="warning" title="Still running" actions={[<SectionMessageAction key="resume" onClick={onResume}>Keep checking</SectionMessageAction>]}>
          <Text>The job has run for 10 minutes. It may still finish: refresh this page later.</Text>
        </SectionMessage>
      ) : null}
      {pollError ? <Text size="small">Could not read progress ({pollError.message}). Trying again.</Text> : null}
    </Stack>
  );
};
