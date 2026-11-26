import React, { useEffect, useState } from 'react';
import { Stack, Inline, Text, Textfield, Select, Label, LoadingButton, SectionMessage } from '@forge/react';
import { call } from '../api.js';
import { configToForm, formToConfig, typeOptions } from '../lib/forms.js';
import { ROLES } from '../lib/states.js';
import { ErrorBanner } from './ErrorBanner.jsx';
import { Loading } from './EmptyStates.jsx';

const MODE_OPTIONS = [
  { label: 'Labels (trace-req, trace-risk, trace-ctrl, trace-test)', value: 'labels' },
  { label: 'Issue types (one type per role)', value: 'issueTypes' },
];

const Field = ({ id, label, value, onChange, placeholder, isDisabled }) => (
  <Stack space="space.050">
    <Label labelFor={id}>{label}</Label>
    {/* Uncontrolled: a value prop drops keystrokes in UI Kit. The parent remounts the field
        (key includes formVersion) whenever it loads or saves the form. */}
    <Textfield id={id} defaultValue={value ?? ''} placeholder={placeholder} isDisabled={isDisabled} onChange={(e) => onChange(e.target.value ?? '')} />
  </Stack>
);

/** One issue type per role, chosen from the project's issue types. */
const TypeSelect = ({ id, label, value, names, onChange, isDisabled }) => {
  const options = typeOptions(names, value);
  return (
    <Stack space="space.050">
      <Label labelFor={id}>{label}</Label>
      <Select
        inputId={id}
        isClearable
        isDisabled={isDisabled}
        options={options}
        placeholder="Choose an issue type"
        value={options.find((o) => o.value.toLowerCase() === String(value ?? '').trim().toLowerCase()) ?? null}
        onChange={(o) => onChange(o?.value ?? '')}
      />
    </Stack>
  );
};

/** Per-project settings. Saving needs Administer projects; the backend re-validates. */
export const SettingsTab = ({ onSaved }) => {
  const [form, setForm] = useState(null);
  const [formVersion, setFormVersion] = useState(0);
  const [canAdmin, setCanAdmin] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState(null);
  const [problems, setProblems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  // Issue-type names for the Selects: null until loaded; [] when they could not be read, in
  // which case the role fields fall back to text fields (the backend still validates names).
  const [typeNames, setTypeNames] = useState(null);
  const [typeNote, setTypeNote] = useState(null);

  const roleMode = form?.roleMode;
  useEffect(() => {
    if (roleMode !== 'issueTypes' || typeNames !== null) return;
    let live = true;
    call('project.issueTypes').then((r) => {
      if (!live) return;
      setTypeNames(r.ok ? r.data.names : []);
      if (!r.ok) setTypeNote(`The issue types of this project could not be read (${r.error.message}). Type the exact names instead.`);
      else if (!r.data.names.length) setTypeNote('You cannot create any issue type in this project, so the list is empty. Type the exact names instead.');
    });
    return () => {
      live = false;
    };
  }, [roleMode, typeNames]);

  const load = async () => {
    setError(null);
    const r = await call('project.getConfig');
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setForm(configToForm(r.data.config));
    setFormVersion((v) => v + 1);
    setCanAdmin(!!r.data.canAdmin);
    setConfigured(!!r.data.configured);
  };
  useEffect(() => {
    load();
  }, []);

  if (!form) return error ? <ErrorBanner error={error} onRetry={load} /> : <Loading text="Reading settings..." />;

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    const { config, errors } = formToConfig(form);
    setProblems(errors);
    setSaved(null);
    if (errors.length) return;
    setBusy(true);
    const r = await call('project.saveConfig', { config });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    setConfigured(true);
    setForm(configToForm(r.data.config));
    setFormVersion((v) => v + 1);
    setSaved(`Saved (audit record #${r.data.auditSeq}).`);
    if (onSaved) onSaved();
  };

  const byLabels = form.roleMode === 'labels';
  return (
    <Stack space="space.200">
      {!configured ? <SectionMessage appearance="information"><Text>No settings are saved for this project yet; the defaults below are in use.</Text></SectionMessage> : null}
      {!canAdmin ? (
        <SectionMessage appearance="warning" title="Read only">
          <Text>Saving settings needs the Administer projects permission in this project. Ask a project admin to change these settings.</Text>
        </SectionMessage>
      ) : null}
      <Stack space="space.050">
        <Label labelFor="tb-role-mode">How Tracebound finds the role of an issue</Label>
        <Select
          inputId="tb-role-mode"
          isDisabled={!canAdmin}
          options={MODE_OPTIONS}
          value={MODE_OPTIONS.find((o) => o.value === form.roleMode)}
          onChange={(o) => set('roleMode')(o?.value ?? 'labels')}
        />
      </Stack>
      <Inline space="space.200" shouldWrap>
        {Object.keys(ROLES).map((r) => {
          if (byLabels) {
            return <Field key={`${r}-l-${formVersion}`} id={`tb-label-${r}`} label={`${ROLES[r].name} label`} value={form[`label_${r}`]} onChange={set(`label_${r}`)} isDisabled={!canAdmin} />;
          }
          if (typeNames && typeNames.length) {
            return <TypeSelect key={r} id={`tb-type-${r}`} label={`${ROLES[r].name} issue type`} value={form[`type_${r}`]} names={typeNames} onChange={set(`type_${r}`)} isDisabled={!canAdmin} />;
          }
          return <Field key={`${r}-t-${formVersion}`} id={`tb-type-${r}`} label={`${ROLES[r].name} issue type`} value={form[`type_${r}`]} placeholder={typeNames === null ? 'Reading issue types...' : 'Exact issue type name'} onChange={set(`type_${r}`)} isDisabled={!canAdmin} />;
        })}
      </Inline>
      {!byLabels && typeNote ? <SectionMessage appearance="warning"><Text>{typeNote}</Text></SectionMessage> : null}
      <Field
        key={`fields-${formVersion}`}
        id="tb-fields"
        label="Extra substantive fields (custom field ids, comma-separated, at most 4)"
        value={form.fieldIds}
        placeholder="customfield_10100"
        onChange={set('fieldIds')}
        isDisabled={!canAdmin}
      />
      <Text size="small">Summary and description are always substantive. Add a field such as acceptance criteria if its edits should also make tests suspect.</Text>
      <Field
        key={`allowlist-${formVersion}`}
        id="tb-allowlist"
        label="Only count these link types (comma-separated; empty means every link type)"
        value={form.allowlist}
        placeholder="Relates, Tests"
        onChange={set('allowlist')}
        isDisabled={!canAdmin}
      />
      {problems.length ? (
        <SectionMessage appearance="error" title="Not saved">
          <Stack space="space.050">{problems.map((p) => <Text key={p}>{p}</Text>)}</Stack>
        </SectionMessage>
      ) : null}
      <ErrorBanner error={error} title="Not saved" />
      {saved ? <SectionMessage appearance="success"><Text>{saved}</Text></SectionMessage> : null}
      <Inline>
        <LoadingButton appearance="primary" isLoading={busy} isDisabled={!canAdmin} onClick={save}>Save settings</LoadingButton>
      </Inline>
    </Stack>
  );
};
