import type { Span, Trace } from '../tempo';
import { spanKey, spanTree } from './spanTree';

function span(id: string, parentId?: string): Span {
  return { id, parentId, name: id, service: 'demo', start: BigInt(0), end: BigInt(1), links: [], attributes: [] };
}

test('preserves parent hierarchy and hides descendants of collapsed spans', () => {
  const trace: Trace = {
    id: 'trace',
    spans: [span('child', 'parent'), span('orphan', 'missing'), span('parent'), span('grandchild', 'child')],
  };
  expect(spanTree(trace, new Set()).map(({ span, depth }) => [span.id, depth])).toEqual([
    ['orphan', 0],
    ['parent', 0],
    ['child', 1],
    ['grandchild', 2],
  ]);
  expect(spanTree(trace, new Set([spanKey(trace.id, 'parent')])).map(({ span }) => span.id)).toEqual([
    'orphan',
    'parent',
  ]);
});

test('terminates even with cyclic parent IDs', () => {
  const trace = { id: 'trace', spans: [span('a', 'b'), span('b', 'a')] };
  expect(spanTree(trace, new Set()).map(({ span }) => span.id)).toEqual(['a', 'b']);
});
