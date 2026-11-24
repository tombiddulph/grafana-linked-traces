import React, { KeyboardEvent, PointerEvent, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, useStyles2 } from '@grafana/ui';

export type ZoomRange = readonly [number, number];
export const fullRange: ZoomRange = [0, 1];
const ticks = [0, 0.25, 0.5, 0.75, 1];
const clamp = (value: number) => Math.max(0, Math.min(1, value));

type Props = {
  segments: Array<{ start: number; end: number; color?: string }>;
  formatTick: (fraction: number) => string;
  range: ZoomRange;
  onZoom: (range: ZoomRange) => void;
};

export function TraceOverview({ segments, formatTick, range, onZoom }: Props) {
  const styles = useStyles2(getStyles);
  const [draft, setDraft] = useState<ZoomRange>();
  const origin = useRef<number | undefined>(undefined);
  const selection = draft ?? range;
  const zoomed = range[0] > 0 || range[1] < 1;
  const position = (event: PointerEvent<HTMLDivElement>) => {
    const { left, width } = event.currentTarget.getBoundingClientRect();
    return clamp((event.clientX - left) / width);
  };

  function begin(event: PointerEvent<HTMLDivElement>) {
    if (event.button === 0) {
      const at = position(event);
      origin.current = at;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraft([at, at]);
    }
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (origin.current !== undefined) {
      const at = position(event);
      setDraft([Math.min(at, origin.current), Math.max(at, origin.current)]);
    }
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    if (origin.current !== undefined) {
      const at = position(event);
      if (Math.abs(at - origin.current) >= 0.01) {
        onZoom([Math.min(at, origin.current), Math.max(at, origin.current)]);
      }
      origin.current = undefined;
      setDraft(undefined);
    }
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      onZoom(fullRange);
    } else if (event.key === '+' || event.key === '=') {
      const inset = (range[1] - range[0]) / 4;
      if (inset > 0.005) {
        onZoom([range[0] + inset, range[1] - inset]);
      }
    } else if (event.key === '-') {
      const outset = (range[1] - range[0]) / 2;
      onZoom([clamp(range[0] - outset), clamp(range[1] + outset)]);
    } else {
      return;
    }
    event.preventDefault();
  }

  return (
    <details className={styles.section} open>
      <summary>Overview</summary>
      <div className={styles.axis} aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} style={{ left: `${tick * 100}%` }}>
            {formatTick(tick)}
          </span>
        ))}
      </div>
      <div
        className={styles.overview}
        role="group"
        aria-label="Trace minimap"
        title="Drag to zoom. Use + and − to adjust the zoom or Escape to reset."
        tabIndex={0}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={() => {
          origin.current = undefined;
          setDraft(undefined);
        }}
        onKeyDown={keyDown}
      >
        <div className={styles.plot} aria-hidden="true">
          {ticks.map((tick) => (
            <i key={tick} style={{ left: `${tick * 100}%` }} />
          ))}
          {segments.map(({ start, end, color }, index) => (
            <span
              key={index}
              style={{
                left: `${start * 100}%`,
                width: `${(end - start) * 100}%`,
                top: `${(index * 100) / segments.length}%`,
                height: `${Math.min(10, 95 / segments.length)}%`,
                backgroundColor: color,
              }}
            />
          ))}
          {(zoomed || draft) && (
            <div
              className={styles.selection}
              style={{ left: `${selection[0] * 100}%`, width: `${(selection[1] - selection[0]) * 100}%` }}
            />
          )}
        </div>
      </div>
      {zoomed && (
        <div className={styles.reset}>
          <Button size="sm" variant="secondary" onClick={() => onZoom(fullRange)}>
            Reset selection
          </Button>
        </div>
      )}
    </details>
  );
}

function getStyles({ colors, typography }: GrafanaTheme2) {
  const border = `1px solid ${colors.border.weak}`;
  return {
    section: css({
      padding: '0 12px 12px',
      '& summary': {
        cursor: 'pointer',
        fontSize: typography.bodySmall.fontSize,
        fontWeight: typography.fontWeightMedium,
      },
    }),
    axis: css({
      position: 'relative',
      height: 20,
      color: colors.text.secondary,
      fontSize: '10px',
      '& > span': { position: 'absolute', top: '50%', transform: 'translateY(-50%)', whiteSpace: 'nowrap' },
      '& > span:last-child': { transform: 'translate(-100%, -50%)' },
    }),
    overview: css({
      position: 'relative',
      height: 60,
      background: colors.background.canvas,
      border,
      cursor: 'crosshair',
      touchAction: 'none',
    }),
    plot: css({
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      overflow: 'hidden',
      '& > span': { position: 'absolute', minWidth: 1, opacity: 0.8 },
      '& > i': { position: 'absolute', top: 0, bottom: 0, borderLeft: border },
    }),
    selection: css({
      position: 'absolute',
      top: 0,
      bottom: 0,
      border: `1px solid ${colors.primary.border}`,
      boxShadow: '0 0 0 100vmax rgba(0,0,0,0.4)',
    }),
    reset: css({ display: 'flex', justifyContent: 'end', marginTop: 4 }),
  };
}
