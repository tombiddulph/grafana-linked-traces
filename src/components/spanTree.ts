import { Span, Trace } from '../tempo';

export const spanKey = (traceId: string, spanId: string) => `${traceId}:${spanId}`;

export function spanTree(trace: Trace, collapsed: ReadonlySet<string>) {
  const spans = new Map(trace.spans.map((span) => [span.id, span]));
  const groups = new Map<string | undefined, Span[]>();
  for (const span of spans.values()) {
    const parent = span.parentId && span.parentId !== span.id && spans.has(span.parentId) ? span.parentId : undefined;
    const children = groups.get(parent) ?? [];
    children.push(span);
    groups.set(parent, children);
  }
  const seen = new Set<string>();
  const rows: Array<{ span: Span; depth: number; hasChildren: boolean }> = [];
  const walk = (root: Span) => {
    const stack = [{ span: root, depth: 0, hidden: false }];
    while (stack.length) {
      const { span, depth, hidden } = stack.pop()!;
      if (seen.has(span.id)) {
        continue;
      }
      seen.add(span.id);
      const children = groups.get(span.id) ?? [];
      if (!hidden) {
        rows.push({ span, depth, hasChildren: children.length > 0 });
      }
      const hideChildren = hidden || collapsed.has(spanKey(trace.id, span.id));
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ span: children[i], depth: depth + 1, hidden: hideChildren });
      }
    }
  };
  for (const root of groups.get(undefined) ?? []) {
    walk(root);
  }
  // Still display spans from malformed parent cycles without looping.
  for (const span of spans.values()) {
    if (!seen.has(span.id)) {
      walk(span);
    }
  }
  return rows;
}
