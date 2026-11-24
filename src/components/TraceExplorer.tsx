import React, { useRef, useState } from 'react';
import { Alert } from '@grafana/ui';
import { RelatedTraces, Trace, TraceInvestigation } from '../tempo';
import { TraceControl, Waterfall } from './Waterfall';

type Branch = { status: 'loading' | 'error' } | { status: 'ready'; expanded: boolean; data: RelatedTraces };

function visibleTraces(initial: Trace[], branches: ReadonlyMap<string, Branch>, skip?: string) {
  const known = new Map(initial.map((trace) => [trace.id, trace]));
  for (const id of known.keys()) {
    const branch = branches.get(id);
    if (id !== skip && branch?.status === 'ready' && branch.expanded) {
      for (const trace of branch.data.traces) {
        known.set(trace.id, trace);
      }
    }
  }
  return known;
}

export function TraceExplorer({ investigation }: { investigation: TraceInvestigation }) {
  const [branches, setBranches] = useState<Map<string, Branch>>(new Map());
  const inFlight = useRef(new Set<string>());
  const { initial } = investigation;
  const root = initial.traces[0].id;
  const visible = visibleTraces(initial.traces, branches);
  const warnings = new Set(initial.warnings);
  for (const id of visible.keys()) {
    const branch = branches.get(id);
    if (branch?.status === 'ready' && branch.expanded) {
      branch.data.warnings.forEach((warning) => warnings.add(warning));
    }
  }

  function update(id: string, branch: Branch) {
    setBranches((current) => new Map(current).set(id, branch));
  }

  async function toggle(id: string) {
    const branch = branches.get(id);
    if (branch?.status === 'ready') {
      update(id, { ...branch, expanded: !branch.expanded });
      return;
    }
    if (inFlight.current.has(id)) {
      return;
    }
    inFlight.current.add(id);
    update(id, { status: 'loading' });
    try {
      update(id, { status: 'ready', expanded: true, data: await investigation.loadNeighbors(id) });
    } catch {
      update(id, { status: 'error' });
    } finally {
      inFlight.current.delete(id);
    }
  }

  function control(id: string): TraceControl | undefined {
    if (id === root) {
      return undefined;
    }
    const branch = branches.get(id);
    if (branch?.status === 'ready') {
      const withoutBranch = branch.expanded ? visibleTraces(initial.traces, branches, id) : undefined;
      return {
        status: branch.expanded ? 'open' : 'closed',
        note:
          withoutBranch && branch.data.traces.every((trace) => withoutBranch.has(trace.id))
            ? 'No additional traces'
            : undefined,
        onToggle: () => void toggle(id),
      };
    }
    return { status: branch?.status ?? 'closed', onToggle: () => void toggle(id) };
  }

  return (
    <>
      {[...warnings].map((warning) => (
        <Alert key={warning} title={warning} severity="warning" />
      ))}
      {initial.traces.length === 1 && !initial.warnings.length && (
        <p>No linked traces found. Try a wider search window or reload if the traces were just written.</p>
      )}
      <Waterfall traces={[...visible.values()]} rootTraceId={root} traceControl={control} />
    </>
  );
}
