import React, { useId, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Icon, IconButton, Input, Switch, useStyles2, useTheme2 } from '@grafana/ui';
import { formatAttribute, Span, Trace } from '../tempo';
import { SpanDetails } from './SpanDetails';
import { spanKey, spanTree } from './spanTree';
import { fullRange, TraceOverview, ZoomRange } from './TraceOverview';

const rowHeight = 32;
const laneHeight = 30;
const graphWidth = 1000;
const ticks = [0, 0.25, 0.5, 0.75, 1];
const palette = ['#6ab4c9', '#d6ab61', '#a78bdb', '#81b77c', '#dc9398', '#9a9dd6'];
const toMs = (ns: bigint) => Number(ns) / 1_000_000;

function formatTime(ms: number) {
  if (ms === 0) {
    return '0 ms';
  }
  if (ms < 1) {
    return `${Number((ms * 1000).toFixed(1))} µs`;
  }
  if (ms >= 60_000) {
    return `${Number((ms / 60_000).toFixed(2))} min`;
  }
  if (ms >= 1000) {
    return `${Number((ms / 1000).toFixed(2))} s`;
  }
  return `${Number(ms.toFixed(2))} ms`;
}

const isErrorSpan = ({ status }: Span) => status === 'STATUS_CODE_ERROR' || status === 2;

export type TraceControl = {
  status: 'closed' | 'loading' | 'open' | 'error';
  note?: string;
  onToggle: () => void;
};

type WaterfallProps = {
  traces: Trace[];
  rootTraceId: string;
  traceControl: (id: string) => TraceControl | undefined;
};

export function Waterfall({ traces, rootTraceId, traceControl }: WaterfallProps) {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);
  const arrowId = useId();
  const showAllId = useId();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedKey, setSelectedKey] = useState<string>();
  const [detailHeight, setDetailHeight] = useState(0);
  const [filterText, setFilterText] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [showAll, setShowAll] = useState(true);
  const [zoom, setZoom] = useState<ZoomRange>(fullRange);
  const spans = traces.flatMap((trace) => trace.spans);
  const start = spans.reduce((min, span) => (span.start < min ? span.start : min), spans[0].start);
  const end = spans.reduce((max, span) => (span.end > max ? span.end : max), start);
  const rootTrace = traces.find(({ id }) => id === rootTraceId) ?? traces[0];
  const rootSpan = rootTrace.spans.find(({ parentId }) => !parentId) ?? rootTrace.spans[0];
  const totalMs = toMs(end - start);
  const scale = Math.max(totalMs, 0.000001);
  const fullFraction = (time: bigint) => toMs(time - start) / scale;
  const zoomWidth = zoom[1] - zoom[0];
  const fraction = (time: bigint) => Math.min(1, Math.max(0, (fullFraction(time) - zoom[0]) / zoomWidth));
  const timeVisible = (time: bigint) => fullFraction(time) >= zoom[0] && fullFraction(time) <= zoom[1];
  const services = [...new Set([rootSpan.service, ...spans.map((span) => span.service)])];
  const serviceColors = new Map(services.map((service, index) => [service, palette[index % palette.length]]));
  const ordered = [...traces].sort((a, b) =>
    a.spans[0].start === b.spans[0].start ? a.id.localeCompare(b.id) : a.spans[0].start < b.spans[0].start ? -1 : 1
  );
  const all = new Map(
    ordered.flatMap((trace) => trace.spans.map((span) => [spanKey(trace.id, span.id), { trace, span }] as const))
  );
  const links = Array.from(all.entries()).flatMap(([sourceKey, { trace, span }]) =>
    span.links.flatMap((link, index) => {
      const targetKey = spanKey(link.traceId, link.spanId);
      return trace.id !== link.traceId && all.has(targetKey) ? [{ sourceKey, targetKey, index }] : [];
    })
  );
  const foldable = new Set(
    Array.from(all.values()).flatMap(({ trace, span }) => {
      const parent = span.parentId && spanKey(trace.id, span.parentId);
      return parent && all.has(parent) ? [parent] : [];
    })
  );
  const search = filterText.trim().toLowerCase();
  const filtering = Boolean(search || errorsOnly);
  const matching = new Set(
    Array.from(all.entries()).flatMap(([key, { span }]) => {
      const matchesText =
        !search ||
        [span.name, span.service, ...span.attributes.map(({ key, value }) => `${key}=${formatAttribute(value)}`)].some(
          (value) => value.toLowerCase().includes(search)
        );
      return matchesText && (!errorsOnly || isErrorSpan(span)) ? [key] : [];
    })
  );
  const positions = new Map<string, { span: Span; center: number }>();
  const lanes = [];
  let height = 0;
  for (const [index, trace] of ordered.entries()) {
    const rows = spanTree(trace, filtering && !showAll ? new Set() : collapsed).filter(
      ({ span }) => !filtering || showAll || matching.has(spanKey(trace.id, span.id))
    );
    const showHeading = index !== 0 || trace.id !== rootTraceId;
    height += showHeading ? laneHeight : 0;
    for (const { span } of rows) {
      const key = spanKey(trace.id, span.id);
      positions.set(key, { span, center: height + rowHeight / 2 });
      height += rowHeight + (selectedKey === key ? detailHeight : 0);
    }
    lanes.push({ trace, rows, showHeading, control: traceControl(trace.id) });
  }
  const color = (span: Span) => serviceColors.get(span.service);
  const barPosition = (span: Span) => ({
    left: `${fraction(span.start) * 100}%`,
    width: `${(fraction(span.end) - fraction(span.start)) * 100}%`,
  });

  function toggle(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <section aria-label="Linked trace waterfall" className={styles.frame}>
      <div className={styles.header}>
        <div className={styles.kicker}>Trace</div>
        <h2>
          {rootSpan.service}: {rootSpan.name}
        </h2>
        <div className={styles.summary}>
          <span>
            Trace ID <code title={rootTrace.id}>{rootTrace.id}</code>
          </span>
          <span>
            Start time <strong>{new Date(toMs(start)).toLocaleString()}</strong>
          </span>
          <span>
            Duration <strong>{formatTime(totalMs)}</strong>
          </span>
          <span>
            Services <strong>{services.length}</strong>
          </span>
          <span>
            Traces <strong>{traces.length}</strong>
          </span>
          {links.length > 0 && (
            <span>
              Cross-trace links <strong>{links.length}</strong>
            </span>
          )}
        </div>
      </div>
      <TraceOverview
        segments={spans.map((span) => ({
          start: fullFraction(span.start),
          end: fullFraction(span.end),
          color: color(span),
        }))}
        formatTick={(tick) => formatTime(totalMs * tick)}
        range={zoom}
        onZoom={setZoom}
      />
      <div className={styles.filters}>
        <label htmlFor={`${showAllId}-filter`}>Filters</label>
        <Input
          id={`${showAllId}-filter`}
          value={filterText}
          placeholder="Filter by attribute or text"
          onChange={(event) => setFilterText(event.currentTarget.value)}
          suffix={
            <IconButton
              name="times"
              aria-label="Clear span filter"
              disabled={!filterText}
              onClick={() => setFilterText('')}
            />
          }
        />
        <div className={styles.filterActions}>
          <Button
            size="sm"
            variant={errorsOnly ? 'primary' : 'secondary'}
            aria-pressed={errorsOnly}
            onClick={() => setErrorsOnly(!errorsOnly)}
          >
            Errors
          </Button>
          <span className={styles.spanCount}>
            {filtering ? `${matching.size} of ${spans.length}` : spans.length} {spans.length === 1 ? 'span' : 'spans'}
          </span>
          <label className={styles.showAll} htmlFor={showAllId}>
            <Switch id={showAllId} value={showAll} onChange={(event) => setShowAll(event.currentTarget.checked)} />
            Show all spans
          </label>
        </div>
      </div>
      <div className={styles.scroll}>
        <div className={styles.content}>
          <div className={cx(styles.split, styles.timelineHeader)}>
            <div className={styles.columnHeading}>
              <span>Service &amp; Operation</span>
              <div className={styles.columnActions}>
                <IconButton
                  name="angle-double-down"
                  aria-label="Expand all"
                  tooltip="Expand all spans"
                  disabled={!collapsed.size || (filtering && !showAll)}
                  onClick={() => setCollapsed(new Set())}
                />
                <IconButton
                  name="angle-double-up"
                  aria-label="Collapse all"
                  tooltip="Collapse all spans"
                  disabled={!foldable.size || (filtering && !showAll)}
                  onClick={() => setCollapsed(foldable)}
                />
              </div>
            </div>
            <div className={styles.axis}>
              {ticks.map((tick) => (
                <span key={tick} style={{ left: `${100 * tick}%` }}>
                  {formatTime(totalMs * (zoom[0] + tick * zoomWidth))}
                </span>
              ))}
            </div>
          </div>
          <div className={styles.rows}>
            <div className={styles.chartOverlay} aria-hidden="true">
              {ticks.map((tick) => (
                <i key={tick} style={{ left: `${tick * 100}%` }} />
              ))}
            </div>
            {lanes.map(({ trace, rows, control, showHeading }) => (
              <div key={trace.id} data-testid="trace-lane" data-trace-id={trace.id}>
                {showHeading && (
                  <div className={styles.laneHeading}>
                    {control ? (
                      <button
                        type="button"
                        className={styles.laneButton}
                        disabled={control.status === 'loading'}
                        aria-expanded={control.status === 'open'}
                        aria-label={
                          control.status === 'loading'
                            ? `Loading links for ${trace.spans[0].service}`
                            : `${control.status === 'open' ? 'Collapse' : 'Expand'} links for ${trace.spans[0].service}`
                        }
                        onClick={control.onToggle}
                      >
                        <Icon name={control.status === 'open' ? 'angle-down' : 'angle-right'} />
                        <strong>{trace.spans[0].service}</strong>
                        <code title={trace.id}>{trace.id}</code>
                        <span className={styles.branchAction} aria-live="polite">
                          {control.status === 'loading'
                            ? 'Loading links…'
                            : control.status === 'error'
                              ? 'Could not load links · Retry'
                              : (control.note ?? (control.status === 'open' ? 'Collapse links' : 'Show next links'))}
                        </span>
                      </button>
                    ) : (
                      <div className={styles.laneLabel}>
                        <Icon name="list-ul" />
                        <strong>{trace.spans[0].service}</strong>
                        <code title={trace.id}>{trace.id}</code>
                        {trace.id === rootTraceId && <span className={styles.branchAction}>Starting trace</span>}
                      </div>
                    )}
                  </div>
                )}
                {rows.map(({ span, depth, hasChildren }) => {
                  const key = spanKey(trace.id, span.id);
                  const isCollapsed = collapsed.has(key) && (!filtering || showAll);
                  const isSelected = selectedKey === key;
                  const parent = span.parentId ? all.get(spanKey(trace.id, span.parentId))?.span : undefined;
                  const showService = !parent || parent.service !== span.service;
                  const dimmed = filtering && !matching.has(key);
                  const duration = formatTime(toMs(span.end - span.start));
                  const toggleDetails = () => setSelectedKey(isSelected ? undefined : key);
                  const startX = fraction(span.start);
                  const endX = fraction(span.end);
                  const nearRight = endX > 0.9;
                  const labelBefore = nearRight && startX > 0.12;
                  const barVisible = fullFraction(span.end) >= zoom[0] && fullFraction(span.start) <= zoom[1];
                  return (
                    <React.Fragment key={key}>
                      <div className={cx(styles.split, styles.row, isSelected && styles.selected)}>
                        <div
                          className={styles.label}
                          style={{
                            paddingInlineStart: 2 + Math.min(depth, 16) * 16,
                            borderBottomColor: color(span),
                          }}
                        >
                          {hasChildren && (!filtering || showAll) ? (
                            <IconButton
                              name={isCollapsed ? 'angle-right' : 'angle-down'}
                              aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${span.name}`}
                              aria-expanded={!isCollapsed}
                              onClick={() => toggle(key)}
                            />
                          ) : (
                            <span className={styles.leaf} aria-hidden="true">
                              -
                            </span>
                          )}
                          <button
                            type="button"
                            className={cx(styles.spanButton, dimmed && styles.dimmed)}
                            aria-pressed={isSelected}
                            onClick={toggleDetails}
                            title={`${span.service}: ${span.name}`}
                          >
                            {showService && <strong>{span.service}</strong>}
                            <span className={styles.operation}>
                              {span.name} <span>({duration})</span>
                            </span>
                            {isErrorSpan(span) && (
                              <Icon name="exclamation-circle" aria-label="Error" className={styles.error} />
                            )}
                          </button>
                        </div>
                        <button
                          type="button"
                          className={cx(styles.track, dimmed && styles.dimmed)}
                          aria-label={`Inspect duration for ${span.name}`}
                          aria-pressed={isSelected}
                          onClick={toggleDetails}
                        >
                          {barVisible && (
                            <>
                              <span
                                className={styles.bar}
                                style={{ ...barPosition(span), backgroundColor: color(span) }}
                              />
                              <span
                                className={cx(
                                  styles.duration,
                                  nearRight && (labelBefore ? styles.durationLeft : styles.durationInside)
                                )}
                                style={{ left: `${(labelBefore ? startX : endX) * 100}%` }}
                              >
                                {duration}
                              </span>
                            </>
                          )}
                        </button>
                      </div>
                      {isSelected && (
                        <SpanDetails
                          trace={trace}
                          span={span}
                          color={color(span)}
                          duration={duration}
                          offset={formatTime(toMs(span.start - start))}
                          onClose={() => setSelectedKey(undefined)}
                          onHeight={setDetailHeight}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            ))}
            <svg
              aria-hidden="true"
              className={cx(styles.chartOverlay, styles.connections)}
              viewBox={`0 0 ${graphWidth} ${height}`}
              preserveAspectRatio="none"
            >
              <defs>
                <marker id={arrowId} markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
                  <path d="M 0 0 L 6 3 L 0 6 z" fill="currentColor" />
                </marker>
              </defs>
              {links.map(({ sourceKey, targetKey, index }) => {
                const source = positions.get(sourceKey);
                const target = positions.get(targetKey);
                if (!source || !target || !timeVisible(source.span.start) || !timeVisible(target.span.end)) {
                  return null;
                }
                const from = fraction(source.span.start) * graphWidth;
                const to = fraction(target.span.end) * graphWidth;
                const side = source.center > target.center ? 1 : -1;
                const y1 = source.center - side * 7;
                const y2 = target.center + side * 7;
                const aligned = Math.abs(from - to) < 2;
                return (
                  <g key={`${sourceKey}:${targetKey}:${index}`} data-testid="cross-trace-link" fill="none">
                    <path
                      d={`M ${from} ${y1} V ${y2}`}
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      vectorEffect="non-scaling-stroke"
                      markerEnd={aligned ? `url(#${arrowId})` : undefined}
                    />
                    {!aligned && (
                      <path
                        d={`M ${from} ${y2} H ${to}`}
                        stroke={theme.colors.text.secondary}
                        strokeOpacity={0.6}
                        strokeDasharray="2 4"
                        vectorEffect="non-scaling-stroke"
                        markerEnd={`url(#${arrowId})`}
                      />
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
          {filtering && !showAll && matching.size === 0 && <p className={styles.legend}>No spans match the filters.</p>}
        </div>
      </div>
      {links.length > 0 && <div className={styles.legend}>Dashed arrows point to the referenced span.</div>}
    </section>
  );
}

function getStyles(theme: GrafanaTheme2) {
  const { colors } = theme;
  const border = `1px solid ${colors.border.weak}`;
  const laneLabel = {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    height: '100%',
    gap: 8,
    paddingInline: 12,
    '& > code': { color: colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize },
  } as const;
  return {
    frame: css({ border, borderRadius: theme.shape.radius.default, background: colors.background.primary }),
    header: css({
      padding: '8px 12px',
      '& h2': {
        margin: '10px 0 4px',
        fontSize: theme.typography.h3.fontSize,
        fontWeight: theme.typography.fontWeightRegular,
      },
    }),
    kicker: css({ color: colors.text.secondary, fontWeight: theme.typography.fontWeightMedium }),
    summary: css({
      display: 'flex',
      flexWrap: 'wrap',
      gap: '4px 24px',
      color: colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      '& strong': { color: colors.text.primary, fontWeight: theme.typography.fontWeightMedium },
      '& code': { color: colors.text.primary, padding: 0, background: 'transparent', border: 0 },
    }),
    filters: css({
      padding: '4px 8px 6px',
      '& > label': {
        display: 'block',
        marginBottom: 5,
        fontSize: theme.typography.bodySmall.fontSize,
        fontWeight: theme.typography.fontWeightMedium,
      },
    }),
    filterActions: css({
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginTop: 8,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    spanCount: css({ marginInlineStart: 'auto' }),
    showAll: css({
      display: 'inline-flex',
      gap: 6,
      alignItems: 'center',
      background: colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      padding: '4px 8px',
      cursor: 'pointer',
    }),
    scroll: css({ overflowX: 'auto' }),
    content: css({ '--labels': '40%', minWidth: 610 }),
    split: css({ display: 'grid', gridTemplateColumns: 'var(--labels) minmax(0, 1fr)' }),
    columnHeading: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      padding: '0 8px',
      borderInlineEnd: border,
      fontSize: theme.typography.h4.fontSize,
      '& > span': { whiteSpace: 'nowrap' },
    }),
    columnActions: css({ display: 'flex', alignItems: 'center', gap: 2 }),
    timelineHeader: css({ background: colors.background.secondary, borderBottom: border }),
    axis: css({
      position: 'relative',
      height: 36,
      '& > span': {
        position: 'absolute',
        top: '50%',
        transform: 'translateY(-50%)',
        whiteSpace: 'nowrap',
        paddingInline: 4,
      },
      '& > span:not(:first-child, :last-child)::before': {
        position: 'absolute',
        content: '""',
        left: 0,
        top: -8,
        height: 36,
        borderLeft: border,
      },
      '& > span:last-child': { transform: 'translate(-100%, -50%)' },
    }),
    rows: css({ position: 'relative' }),
    chartOverlay: css({
      position: 'absolute',
      left: 'var(--labels)',
      top: 0,
      width: 'calc(100% - var(--labels))',
      height: '100%',
      pointerEvents: 'none',
      '& > i': { position: 'absolute', top: 0, height: '100%', borderLeft: border },
    }),
    connections: css({ color: colors.warning.text, zIndex: 2, overflow: 'visible' }),
    laneHeading: css({
      position: 'relative',
      height: laneHeight,
      background: colors.background.secondary,
      borderBlock: border,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    laneLabel: css(laneLabel),
    laneButton: css(laneLabel, {
      background: 'transparent',
      border: 0,
      color: colors.text.primary,
      textAlign: 'left',
      cursor: 'pointer',
      '&:disabled': { cursor: 'progress' },
      '&:hover:not(:disabled)': { background: colors.action.hover },
    }),
    branchAction: css({
      marginInlineStart: 'auto',
      color: colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    row: css({
      position: 'relative',
      height: rowHeight,
      '&:hover': { background: colors.action.hover },
    }),
    selected: css({ background: colors.action.selected }),
    label: css({
      display: 'flex',
      alignItems: 'center',
      minWidth: 0,
      paddingInlineEnd: 8,
      background: colors.background.secondary,
      borderInlineEnd: border,
      borderBottom: '1px solid',
      '& > button:first-child:not(:last-child)': { width: 17, height: 20, flex: '0 0 17px', padding: 0 },
    }),
    leaf: css({ flex: '0 0 17px', textAlign: 'center', color: colors.text.secondary }),
    dimmed: css({ opacity: 0.45 }),
    spanButton: css({
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      minWidth: 0,
      width: '100%',
      height: '100%',
      border: 0,
      background: 'transparent',
      padding: 0,
      color: colors.text.primary,
      textAlign: 'left',
      cursor: 'pointer',
      fontSize: theme.typography.bodySmall.fontSize,
      '& > strong': { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '45%' },
    }),
    operation: css({
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      color: colors.text.secondary,
    }),
    error: css({ color: colors.error.text, flexShrink: 0 }),
    track: css({
      position: 'relative',
      minWidth: 0,
      padding: 0,
      border: 0,
      color: colors.text.primary,
      background: 'transparent',
      textAlign: 'left',
      cursor: 'pointer',
      '&:hover > span:first-child, &[aria-pressed=true] > span:first-child': {
        outline: `1px solid ${colors.text.primary}`,
      },
    }),
    bar: css({
      position: 'absolute',
      minWidth: 3,
      top: '50%',
      transform: 'translateY(-50%)',
      border: 0,
      borderRadius: 3,
      height: 13,
    }),
    duration: css({
      position: 'absolute',
      paddingInlineStart: 6,
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      color: colors.text.primary,
      fontSize: theme.typography.bodySmall.fontSize,
    }),
    durationLeft: css({
      transform: 'translate(-100%, -50%)',
      paddingInline: '0 6px',
    }),
    durationInside: css({
      transform: 'translate(-100%, -50%)',
      paddingInline: 4,
      borderRadius: 2,
      background: colors.background.primary,
    }),
    legend: css({ padding: '6px 12px', color: colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize }),
  };
}
