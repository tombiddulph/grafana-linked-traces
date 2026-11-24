import React, { SubmitEvent, useEffect, useState } from 'react';
import { getBackendSrv, getDataSourceSrv, PluginPage } from '@grafana/runtime';
import { Alert, Button, Combobox, Field, Input, LoadingPlaceholder } from '@grafana/ui';
import { useSearchParams } from 'react-router-dom';
import { firstValueFrom } from 'rxjs';
import { normaliseTraceId, openRecentTrace, TraceInvestigation } from '../../tempo';
import { TraceExplorer } from '../TraceExplorer';

const windows = [
  { value: 900, label: 'Last 15 minutes' },
  { value: 3600, label: 'Last hour' },
  { value: 21600, label: 'Last 6 hours' },
  { value: 86400, label: 'Last 24 hours' },
];

type SearchFormProps = {
  sourceOptions: Array<{ value: string; label: string }>;
  initialSource: string;
  initialTraceId: string;
  initialWindow: number;
  onSearch: (traceId: string, source: string, window: number) => void;
};

function SearchForm({ sourceOptions, initialSource, initialTraceId, initialWindow, onSearch }: SearchFormProps) {
  const [source, setSource] = useState(
    sourceOptions.some(({ value }) => value === initialSource) ? initialSource : null
  );
  const [lookback, setLookback] = useState(initialWindow);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (source) {
      const form = new FormData(event.currentTarget);
      onSearch(String(form.get('traceId')).trim().toLowerCase(), source, lookback);
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{ display: 'flex', gap: 12, alignItems: 'start', flexWrap: 'wrap', marginBottom: 16 }}
    >
      <Field label="Tempo data source" htmlFor="linked-traces-source" style={{ width: 'min(100%, 220px)' }}>
        <Combobox
          id="linked-traces-source"
          options={sourceOptions}
          value={source}
          onChange={({ value }) => setSource(value)}
          disabled={!sourceOptions.length}
          placeholder={sourceOptions.length ? 'Select a Tempo data source' : 'No Tempo data sources'}
        />
      </Field>
      <Field label="Trace ID" htmlFor="linked-traces-id" style={{ width: 'min(100%, 310px)' }}>
        <Input id="linked-traces-id" name="traceId" defaultValue={initialTraceId} required />
      </Field>
      <Field label="Incoming link search" htmlFor="linked-traces-window" style={{ width: 'min(100%, 220px)' }}>
        <Combobox
          id="linked-traces-window"
          options={windows}
          value={lookback}
          onChange={({ value }) => setLookback(value)}
        />
      </Field>
      <Button type="submit" disabled={!source} style={{ marginTop: 21 }}>
        Load traces
      </Button>
    </form>
  );
}

function App() {
  const [params, setParams] = useSearchParams();
  const sources = getDataSourceSrv()
    .getList()
    .filter((source) => source.type === 'tempo');
  const uid = params.get('ds') ?? sources[0]?.uid ?? '';
  const rawId = (params.get('traceId') ?? '').trim();
  const id = normaliseTraceId(rawId) ?? '';
  const requestedWindow = Number(params.get('window'));
  const windowSeconds = windows.find(({ value }) => value === requestedWindow)?.value ?? 3600;
  const [revision, setRevision] = useState(0);
  const key = `${uid}:${id}:${windowSeconds}:${revision}`;
  const [result, setResult] = useState<{ key: string; data?: TraceInvestigation; error?: string }>();
  const sourceExists = sources.some((source) => source.uid === uid);
  const validationError =
    rawId && !id
      ? 'Enter a hexadecimal trace ID of up to 32 characters.'
      : !sourceExists
        ? 'Select an available Tempo data source.'
        : '';

  useEffect(() => {
    if (!id || validationError) {
      return;
    }
    let current = true;
    const get = async <T,>(path: string): Promise<T> =>
      (
        await firstValueFrom(
          getBackendSrv().fetch<T>({
            url: `api/datasources/proxy/uid/${encodeURIComponent(uid)}/api/${path}`,
            showErrorAlert: false,
          })
        )
      ).data;

    openRecentTrace(get, id, windowSeconds).then(
      (data) => {
        if (current) {
          setResult({ key, data });
        }
      },
      (error) => {
        if (current) {
          const status = error?.status;
          setResult({
            key,
            error: status === 404 ? 'Trace not found in Tempo.' : error.message || `Tempo request failed (${status}).`,
          });
        }
      }
    );
    return () => {
      current = false;
    };
  }, [id, key, uid, validationError, windowSeconds]);

  function search(traceId: string, ds: string, lookback: number) {
    if (normaliseTraceId(traceId) === id && ds === uid && lookback === windowSeconds) {
      setRevision((last) => last + 1);
    }
    setParams({ traceId, ds, window: String(lookback) });
  }

  const visible = result?.key === key ? result : undefined;
  return (
    <PluginPage>
      <p>Start with the selected trace and its direct links. Click a linked trace to reveal the next hop.</p>
      <SearchForm
        key={`${uid}:${rawId}:${windowSeconds}`}
        sourceOptions={sources.map(({ uid, name }) => ({ value: uid, label: name }))}
        initialSource={uid}
        initialTraceId={id || rawId}
        initialWindow={windowSeconds}
        onSearch={search}
      />
      {validationError && <Alert title={validationError} severity="warning" />}
      {id && !validationError && !visible && <LoadingPlaceholder text="Finding linked traces…" />}
      {visible?.error && <Alert title={visible.error} severity="error" />}
      {visible?.data && <TraceExplorer key={key} investigation={visible.data} />}
    </PluginPage>
  );
}

export default App;
