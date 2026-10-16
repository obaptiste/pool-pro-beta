import React, { useEffect, useId, useRef, useState } from 'react';
import { ControllerLogWindow } from '../types';
import { CONTROLLER_METRICS, ControllerMetric, metricRange, windowGrade } from '../lib/controllerLog';

// Shared horizontal layout so a band chart and the dose strip under it line up.
const PAD_LEFT = 36;
const PAD_RIGHT = 6;
const COMPACT_PAD = 1;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceTicks(lo: number, hi: number, target = 4): number[] {
  const steps = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200];
  const step = steps.find((s) => (hi - lo) / s <= target) ?? 500;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const startOfNextDay = (t: number) => { const d = new Date(t); d.setHours(24, 0, 0, 0); return d.getTime(); };

interface Shared {
  windows: ControllerLogWindow[];
  t0: number;
  t1: number;
  compact?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}

function xScale(width: number, t0: number, t1: number, compact?: boolean) {
  const L = compact ? COMPACT_PAD : PAD_LEFT;
  const R = compact ? COMPACT_PAD : PAD_RIGHT;
  const pw = Math.max(1, width - L - R);
  return { L, pw, sx: (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * pw };
}

function nearestId(windows: ControllerLogWindow[], t: number): string | null {
  let best: ControllerLogWindow | null = null;
  let bestDist = Infinity;
  for (const w of windows) {
    const mid = (w.start.getTime() + w.end.getTime()) / 2;
    const d = Math.abs(mid - t);
    if (d < bestDist) { best = w; bestDist = d; }
  }
  return best?.id ?? null;
}

/** Pointer handling shared by both charts: tap or drag picks the nearest window. */
function pickHandlers(svg: React.RefObject<SVGSVGElement | null>, width: number, { windows, t0, t1, compact, onSelect }: Shared) {
  if (!onSelect) return {};
  const pick = (e: React.PointerEvent) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const { L, pw } = xScale(width, t0, t1, compact);
    const t = t0 + ((e.clientX - box.left - L) / pw) * (t1 - t0);
    const id = nearestId(windows, t);
    if (id) onSelect(id);
  };
  return {
    onPointerDown: (e: React.PointerEvent) => { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); pick(e); },
    onPointerMove: (e: React.PointerEvent) => { if (e.buttons || e.pointerType === 'mouse') pick(e); },
  };
}

interface BandProps extends Shared {
  metric: ControllerMetric;
  height: number;
  gaps?: { from: Date; to: Date }[];
  /** Day labels along the top and times along the bottom. */
  axes?: boolean;
  /** Colour bars by the shared pH/ORP tiers. Off for the home card, which is history, not status. */
  graded?: boolean;
}

/**
 * One bar per controller window, spanning the lowest to highest value it
 * logged. Bands behind show the app's target and watch ranges; missing time
 * and windows with no value for this metric are hatched, never bridged.
 */
export function ControllerBandChart({ metric, height, gaps = [], axes = true, graded = true, ...shared }: BandProps) {
  const { windows, t0, t1, compact, selectedId } = shared;
  const [wrap, width] = useWidth<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const hatch = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const handlers = pickHandlers(svg, width, shared);
  const m = CONTROLLER_METRICS[metric];

  const ranges = windows.map((w) => metricRange(w, metric));
  const values = ranges.flatMap((r) => r ?? []);
  const good = m.zones.find((z) => z[0] === 'good');
  let lo = Math.min(...values, good ? good[1] : Infinity);
  let hi = Math.max(...values, good ? good[2] : -Infinity);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  const padY = (hi - lo || 1) * 0.08;
  lo -= padY; hi += padY;

  const T = axes && !compact ? 16 : 2;
  const B = axes && !compact ? 18 : 2;
  const ph = Math.max(1, height - T - B);
  const { L, pw, sx } = xScale(width, t0, t1, compact);
  const sy = (v: number) => T + (1 - (v - lo) / (hi - lo)) * ph;
  const clampY = (v: number) => Math.max(T, Math.min(T + ph, sy(v)));

  const midnights: number[] = [];
  for (let t = startOfNextDay(t0); t < t1; t += 86_400_000) midnights.push(t);
  const span = t1 - t0;
  const hourStep = span <= 3 * 86_400_000 ? 6 : 0;

  return (
    <div ref={wrap} className="w-full" style={{ height }}>
      {width > 0 && (
        <svg
          ref={svg}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className={`block select-none ${shared.onSelect ? 'cursor-crosshair touch-pan-y' : ''}`}
          role="img"
          aria-label={`${m.label} lowest to highest per controller window`}
          {...handlers}
        >
          <defs>
            <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" className="stroke-border-dim" strokeWidth="2" />
            </pattern>
          </defs>
          {m.zones.map(([kind, a, b]) => (
            <rect key={`${kind}${a}`} x={L} width={pw} y={clampY(b)} height={Math.max(0, clampY(a) - clampY(b))}
              className={kind === 'good' ? 'fill-success/10' : 'fill-warning/10'} />
          ))}
          {!compact && niceTicks(lo, hi).map((v) => (
            <g key={v}>
              <line x1={L} x2={L + pw} y1={sy(v)} y2={sy(v)} className="stroke-border-dim" strokeWidth="1" />
              <text x={L - 6} y={sy(v) + 3} textAnchor="end" className="fill-ink-dim font-mono text-[9px]">{v}</text>
            </g>
          ))}
          {m.lines.map((v) => (
            <line key={v} x1={L} x2={L + pw} y1={sy(v)} y2={sy(v)} className="stroke-warning" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />
          ))}
          {midnights.map((t) => (
            <g key={t}>
              <line x1={sx(t)} x2={sx(t)} y1={T} y2={T + ph} className="stroke-ink-dim" strokeWidth="1" strokeDasharray="2 4" />
              {axes && !compact && (
                <text x={sx(t) + 3} y={10} className="fill-ink-muted font-mono text-[9px] font-bold uppercase">
                  {new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                </text>
              )}
            </g>
          ))}
          {axes && !compact && hourStep > 0 && (() => {
            const ticks: number[] = [];
            const first = new Date(t0); first.setMinutes(0, 0, 0);
            for (let t = first.getTime(); t <= t1; t += 3_600_000) {
              if (t >= t0 && new Date(t).getHours() % hourStep === 0) ticks.push(t);
            }
            return ticks.map((t) => (
              <text key={t} x={sx(t)} y={height - 4} textAnchor="middle" className="fill-ink-dim font-mono text-[9px]">
                {pad2(new Date(t).getHours())}:00
              </text>
            ));
          })()}
          {gaps.map((g) => (
            <rect key={g.from.getTime()} x={sx(g.from.getTime())} width={Math.max(0, sx(g.to.getTime()) - sx(g.from.getTime()))}
              y={T} height={ph} fill={`url(#${hatch})`} />
          ))}
          {windows.map((w, i) => {
            const x = sx(w.start.getTime());
            const full = Math.max(1, sx(w.end.getTime()) - x);
            const bw = full > 3 ? full - 1 : full;
            const r = ranges[i];
            if (!r) return <rect key={w.id} x={x} width={bw} y={T} height={ph} fill={`url(#${hatch})`} />;
            let y1 = clampY(r[1]);
            let y2 = clampY(r[0]);
            if (y2 - y1 < 3) { const c = (y1 + y2) / 2; y1 = c - 1.5; y2 = c + 1.5; }
            const grade = graded ? windowGrade(w, metric) : null;
            const tone = w.id === selectedId ? 'fill-white'
              : grade?.level === 'warning' ? 'fill-critical-text'
              : grade?.level === 'watch' ? 'fill-warning-text'
              : 'fill-accent';
            return <rect key={w.id} x={x} width={bw} y={y1} height={y2 - y1} rx={Math.min(2, bw / 2)} className={tone} />;
          })}
          {selectedId && (() => {
            const w = windows.find((x) => x.id === selectedId);
            if (!w) return null;
            const cx = sx((w.start.getTime() + w.end.getTime()) / 2);
            return <line x1={cx} x2={cx} y1={T} y2={T + ph} className="stroke-ink" strokeWidth="1" opacity="0.4" pointerEvents="none" />;
          })()}
        </svg>
      )}
    </div>
  );
}

/** Acid/base and chlorine pump volumes per window (the export's per-window max), on the same time axis. */
export function ControllerDoseStrip({ height, ...shared }: Shared & { height: number }) {
  const { windows, t0, t1, compact, selectedId } = shared;
  const [wrap, width] = useWidth<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const handlers = pickHandlers(svg, width, shared);
  const { L, pw, sx } = xScale(width, t0, t1, compact);
  const max = Math.max(50, ...windows.map((w) => Math.max(w.acidBaseMaxMl ?? 0, w.chlorineMaxMl ?? 0)));
  const T = 2;
  const ph = height - T - 1;

  return (
    <div ref={wrap} className="w-full" style={{ height }}>
      {width > 0 && (
        <svg ref={svg} width={width} height={height} viewBox={`0 0 ${width} ${height}`}
          className={`block select-none ${shared.onSelect ? 'cursor-crosshair touch-pan-y' : ''}`}
          role="img" aria-label="Acid and chlorine pump doses per window" {...handlers}>
          <line x1={L} x2={L + pw} y1={T + ph} y2={T + ph} className="stroke-border-dim" strokeWidth="1" />
          {!compact && <text x={L - 6} y={T + 8} textAnchor="end" className="fill-ink-dim font-mono text-[9px]">{Math.round(max)}</text>}
          {windows.map((w) => {
            const acid = w.acidBaseMaxMl ?? 0;
            const cl = w.chlorineMaxMl ?? 0;
            if (acid <= 0 && cl <= 0) return null;
            const x = sx(w.start.getTime());
            const full = Math.max(2, sx(w.end.getTime()) - x - 1);
            const both = acid > 0 && cl > 0;
            const bw = both ? Math.max(1, full / 2 - 0.5) : full;
            const h = (v: number) => Math.max(2, (v / max) * ph);
            const dim = selectedId && w.id !== selectedId ? 0.55 : 1;
            return (
              <g key={w.id} opacity={dim}>
                {acid > 0 && <rect x={x} width={bw} y={T + ph - h(acid)} height={h(acid)} rx={1} className="fill-[#3987e5]" />}
                {cl > 0 && <rect x={both ? x + bw + 1 : x} width={bw} y={T + ph - h(cl)} height={h(cl)} rx={1} className="fill-[#d95926]" />}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** Legend swatches for the dose strip, shared by the log view and the home card. */
export function DoseLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ink-muted">
      <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#3987e5]" />Acid/base</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#d95926]" />Chlorine</span>
    </div>
  );
}
