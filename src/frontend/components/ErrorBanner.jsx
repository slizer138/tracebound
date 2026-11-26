import React from 'react';
import { SectionMessage, SectionMessageAction, Stack, Text, Code } from '@forge/react';

/** Error with code, message and the next step, plus an optional Retry action. */
export const ErrorBanner = ({ error, onRetry, title }) => {
  if (!error) return null;
  return (
    <SectionMessage
      appearance="error"
      title={title ?? 'Something went wrong'}
      actions={onRetry ? [<SectionMessageAction key="retry" onClick={onRetry}>Retry</SectionMessageAction>] : undefined}
    >
      <Stack space="space.100">
        <Text>{error.message ?? 'Unknown error.'}</Text>
        {error.hint ? <Text>Next step: {error.hint}</Text> : null}
        {error.code ? <Text size="small">Error code: <Code>{error.code}</Code></Text> : null}
      </Stack>
    </SectionMessage>
  );
};
