import { decodeTrace, incomingLinkQuery, loadRelated, normaliseTraceId } from './tempo';

const producer = '1'.repeat(32);
const worker = '2'.repeat(32);
const producerSpan = 'a'.repeat(16);
const workerSpan = 'b'.repeat(16);
const body = (spanId: string, links: Array<{ traceId: string; spanId: string }> = []) => ({
  batches: [
    {
      scopeSpans: [{ spans: [{ spanId, name: 'test', startTimeUnixNano: '100', endTimeUnixNano: '200', links }] }],
    },
  ],
});

describe('one-hop span link traversal', () => {
  test('supports fixed-width and unpadded Tempo trace IDs', () => {
    const id = '00a1'.padEnd(32, 'f');
    const short = id.slice(2);
    expect(normaliseTraceId(short.toUpperCase())).toBe(id);
    expect(incomingLinkQuery(id)).toBe(`{ link:traceID = "${id}" || link:traceID = "${short}" }`);
  });
  test.each([producer, worker])('discovers both traces from %s', async (entry) => {
    const get = jest.fn(async (path: string) => {
      if (path.startsWith('search?')) {
        const params = new URLSearchParams(path.split('?')[1]);
        expect(params.get('q')).toBe(`{ link:traceID = "${entry}" }`);
        expect(params.get('start')).toBe('10');
        expect(params.get('end')).toBe('20');
        return { traces: entry === producer ? [{ traceID: worker }, { traceID: worker }] : [] };
      }
      return path.endsWith(worker)
        ? body(workerSpan, [{ traceId: producer, spanId: producerSpan }])
        : body(producerSpan);
    });
    const result = await loadRelated(get as Parameters<typeof loadRelated>[0], entry, 10, 20);
    expect(result.traces.map(({ id }) => id).sort()).toEqual([producer, worker]);
    expect(result.warnings).toEqual([]);
    expect(get).toHaveBeenCalledTimes(3);
  });

  test('normalizes base64 link IDs and preserves nanosecond timestamps', () => {
    const trace = decodeTrace(
      worker,
      body(workerSpan, [
        {
          traceId: Buffer.from(producer, 'hex').toString('base64'),
          spanId: Buffer.from(producerSpan, 'hex').toString('base64'),
        },
      ])
    );
    expect(trace.spans[0].links).toEqual([{ traceId: producer, spanId: producerSpan }]);
    expect(trace.spans[0].end - trace.spans[0].start).toBe(BigInt(100));
  });
});
