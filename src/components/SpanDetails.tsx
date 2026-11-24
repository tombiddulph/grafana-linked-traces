import React, { useLayoutEffect, useRef } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Icon, IconButton, useStyles2 } from '@grafana/ui';
import { formatAttribute, Span, Trace } from '../tempo';

type Props = {
  trace: Trace;
  span: Span;
  color?: string;
  duration: string;
  offset: string;
  onClose: () => void;
  onHeight: (height: number) => void;
};

export function SpanDetails({ trace, span, color, duration, offset, onClose, onHeight }: Props) {
  const styles = useStyles2(getStyles);
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const measure = () => onHeight(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onHeight]);

  return (
    <section ref={ref} className={styles.panel} aria-label="Span details">
      <div className={styles.heading}>
        <strong>{span.name}</strong>
        <IconButton name="times" aria-label="Close span details" onClick={onClose} />
      </div>
      <div className={styles.metadata}>
        <span>
          <i style={{ background: color }} /> Service: <strong>{span.service}</strong>
        </span>
        <span>
          <Icon name="hourglass" /> Duration: <strong>{duration}</strong>
        </span>
        <span>
          <Icon name="clock-nine" /> Start time: <strong>{offset}</strong>
        </span>
      </div>
      <details open>
        <summary>Span attributes</summary>
        {span.attributes.length > 0 ? (
          <dl>
            {span.attributes.map(({ key, value }, index) => (
              <React.Fragment key={`${key}:${index}`}>
                <dt>{key}</dt>
                <dd>{formatAttribute(value)}</dd>
              </React.Fragment>
            ))}
          </dl>
        ) : (
          <p>No span attributes</p>
        )}
      </details>
      <details open>
        <summary>Identifiers</summary>
        <dl>
          <dt>Trace ID</dt>
          <dd>
            <code>{trace.id}</code>
          </dd>
          <dt>Span ID</dt>
          <dd>
            <code>{span.id}</code>
          </dd>
        </dl>
      </details>
    </section>
  );
}

function getStyles({ colors, typography }: GrafanaTheme2) {
  const border = `1px solid ${colors.border.weak}`;
  return {
    panel: css({
      position: 'relative',
      zIndex: 3,
      padding: '8px 12px 8px 24px',
      borderBottom: border,
      background: colors.background.canvas,
      fontSize: typography.bodySmall.fontSize,
      '& details + details': { marginTop: 4 },
      '& summary': { cursor: 'pointer', fontWeight: typography.fontWeightMedium, paddingBlock: 4 },
      '& dl': {
        display: 'grid',
        gridTemplateColumns: 'max-content minmax(0, 1fr)',
        gap: '4px 12px',
        margin: '4px 0 8px 16px',
      },
      '& dt, & p': { color: colors.text.secondary },
      '& dd, & p': { margin: 0, overflowWrap: 'anywhere' },
      '& p': { paddingInlineStart: 16 },
    }),
    heading: css({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      fontSize: typography.body.fontSize,
    }),
    metadata: css({
      display: 'flex',
      flexWrap: 'wrap',
      gap: '4px 16px',
      marginBlock: '4px 6px',
      color: colors.text.secondary,
      '& > span': { display: 'inline-flex', alignItems: 'center', gap: 4 },
      '& i': { display: 'inline-block', width: 12, height: 4, borderRadius: 2 },
      '& strong': { color: colors.text.primary },
    }),
  };
}
