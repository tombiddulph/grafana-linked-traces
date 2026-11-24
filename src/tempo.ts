export type SpanLink = { traceId: string; spanId: string };
export type Attribute = { key: string; value: AttributeValue };
type AttributeValue = {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number | string;
  bytesValue?: string;
  arrayValue?: { values?: AttributeValue[] };
  kvlistValue?: { values?: Attribute[] };
};
export type Span = {
  id: string;
  parentId?: string;
  name: string;
  service: string;
  start: bigint;
  end: bigint;
  links: SpanLink[];
  status?: string | number;
  attributes: Attribute[];
};
export type Trace = { id: string; spans: Span[] };
export type RelatedTraces = { traces: Trace[]; warnings: string[] };

type TempoSpan = {
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  links?: SpanLink[];
  status?: { code?: string | number };
  attributes?: Attribute[];
};
type TempoBatch = {
  resource?: { attributes?: Attribute[] };
  scopeSpans?: Array<{ spans?: TempoSpan[] }>;
};
type TempoTrace = { batches?: TempoBatch[]; resourceSpans?: TempoBatch[] };

function hexId(value: string, length: number): string {
  if (value.length === length && /^[0-9a-f]+$/i.test(value)) {
    return value.toLowerCase();
  }
  return Array.from(atob(value), (byte) => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

export function decodeTrace(id: string, body: TempoTrace): Trace {
  const spans = (body.batches ?? body.resourceSpans ?? []).flatMap((batch) => {
    const service = batch.resource?.attributes?.find(({ key }) => key === 'service.name')?.value.stringValue;
    return (batch.scopeSpans ?? []).flatMap(({ spans }) =>
      (spans ?? []).map((span) => ({
        id: hexId(span.spanId, 16),
        parentId: span.parentSpanId ? hexId(span.parentSpanId, 16) : undefined,
        name: span.name,
        service: service ?? 'Unknown service',
        start: BigInt(span.startTimeUnixNano),
        end: BigInt(span.endTimeUnixNano),
        status: span.status?.code,
        attributes: span.attributes ?? [],
        links: (span.links ?? []).map((link) => ({
          traceId: hexId(link.traceId, 32),
          spanId: hexId(link.spanId, 16),
        })),
      }))
    );
  });
  spans.sort((a, b) => (a.start === b.start ? 0 : a.start < b.start ? -1 : 1));
  return { id, spans };
}

export function formatAttribute(value: AttributeValue): string {
  const scalar = value.stringValue ?? value.boolValue ?? value.intValue ?? value.doubleValue ?? value.bytesValue;
  if (scalar !== undefined) {
    return String(scalar);
  }
  if (value.arrayValue) {
    return `[${(value.arrayValue.values ?? []).map(formatAttribute).join(', ')}]`;
  }
  if (value.kvlistValue) {
    return `{${(value.kvlistValue.values ?? []).map(({ key, value }) => `${key}: ${formatAttribute(value)}`).join(', ')}}`;
  }
  return '—';
}

type Get = <T>(path: string) => Promise<T>;
type TraceCache = Map<string, Promise<Trace>>;
export type TraceInvestigation = {
  initial: RelatedTraces;
  loadNeighbors: (traceId: string) => Promise<RelatedTraces>;
};
const limit = 20;

export function normaliseTraceId(id: string) {
  return /^[0-9a-f]{1,32}$/i.test(id) ? id.toLowerCase().padStart(32, '0') : undefined;
}

export function incomingLinkQuery(id: string) {
  const unpadded = id.replace(/^0+(?=.)/, '');
  // Some Tempo versions stringify link IDs without leading zeros.
  return unpadded === id ? `{ link:traceID = "${id}" }` : `{ link:traceID = "${id}" || link:traceID = "${unpadded}" }`;
}

export async function openRecentTrace(get: Get, id: string, windowSeconds: number): Promise<TraceInvestigation> {
  const now = Math.ceil(Date.now() / 1000);
  const cache: TraceCache = new Map();
  const loadNeighbors = (traceId: string) => loadRelated(get, traceId, now - windowSeconds, now, cache);
  return { initial: await loadNeighbors(id), loadNeighbors };
}

export async function loadRelated(
  get: Get,
  id: string,
  start: number,
  end: number,
  cache: TraceCache = new Map()
): Promise<RelatedTraces> {
  const load = async (traceId: string) => {
    const cached = cache.get(traceId);
    if (cached) {
      return cached;
    }
    const lookup = get<TempoTrace>(`traces/${traceId}`)
      .then((body) => {
        const trace = decodeTrace(traceId, body);
        if (!trace.spans.length) {
          throw new Error(`No spans returned for ${traceId}.`);
        }
        return trace;
      })
      .catch((error) => {
        cache.delete(traceId);
        throw error;
      });
    cache.set(traceId, lookup);
    return lookup;
  };
  const params = new URLSearchParams({
    q: incomingLinkQuery(id),
    start: String(start),
    end: String(end),
    limit: String(limit + 1),
  });
  const reverse: Promise<{ ids: string[]; warning?: string }> = get<{ traces?: Array<{ traceID: string }> }>(
    `search?${params}`
  ).then(
    (result) => ({ ids: (result.traces ?? []).flatMap(({ traceID }) => normaliseTraceId(traceID) ?? []) }),
    () => ({ ids: [], warning: 'Incoming links could not be searched. Only outgoing links are shown.' })
  );
  const [seed, { ids, warning }] = await Promise.all([load(id), reverse]);
  const outgoing = seed.spans.flatMap((span) => span.links.map((link) => link.traceId));
  const related = [...new Set([...outgoing, ...ids])].filter((other) => other !== id && /^[0-9a-f]{32}$/.test(other));
  const warnings = warning ? [warning] : [];
  if (related.length > limit) {
    warnings.push(`Only the first ${limit} direct links are shown for ${id}.`);
  }
  const results = await Promise.allSettled(related.slice(0, limit).map(load));
  const traces = [seed];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      traces.push(result.value);
    } else {
      warnings.push(`Could not load linked trace ${related[index]}.`);
    }
  });
  return { traces, warnings };
}
