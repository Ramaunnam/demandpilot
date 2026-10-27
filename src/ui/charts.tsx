import React, { useId, type ReactNode } from 'react'
import {
  ResponsiveContainer, LineChart, Line, Area, BarChart, Bar, ComposedChart,
  ScatterChart, Scatter, ZAxis, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, Cell,
} from 'recharts'
import { usePalette, type Palette } from './colors'

export { usePalette as useC }
export type { Palette }

function axisProps(p: Palette) {
  return { stroke: p.axis, tick: { fontSize: 10, fill: p.axis }, tickLine: false, axisLine: { stroke: p.grid } }
}

function Tip({ active, payload, label, unit = '' }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="card shadow-lg px-2.5 py-1.5 text-sm">
      <div className="font-semibold mb-0.5">{label}</div>
      {payload.filter((x: any) => x.value != null).map((x: any) => (
        <div key={x.dataKey} className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: x.color ?? x.fill }} />
          <span className="text-muted">{x.name}</span>
          <span className="num font-semibold ml-auto pl-2">
            {/* A band arrives as [lower, upper]; without this it printed as "157.1208.6". */}
            {Array.isArray(x.value)
              ? `${Number(x.value[0]).toFixed(1)} – ${Number(x.value[1]).toFixed(1)}`
              : typeof x.value === 'number'
                ? x.value.toLocaleString('en-IN', { maximumFractionDigits: 1 })
                : x.value}{unit}
          </span>
        </div>
      ))}
    </div>
  )
}

const legendStyle = { fontSize: 10, paddingTop: 4 }

/** Chart wrapper: title, optional right slot, fixed height so the container can measure. */
export function Chart({ title, right, h = 200, children, note }: {
  title?: string; right?: ReactNode; h?: number; children: ReactNode; note?: string
}) {
  return (
    // min-w-0: inside a grid, the 560 px first-paint size below otherwise
    // stretches the column and pushes the page wider than a phone screen.
    <section className="card pad min-w-0">
      {(title || right) && (
        <header className="flex items-center justify-between gap-2 mb-1.5">
          {title && <h3 className="h2">{title}</h3>}
          {right && <div className="flex items-center gap-1.5 shrink-0">{right}</div>}
        </header>
      )}
      <div style={{ height: h, minHeight: h, width: '100%', minWidth: 0, overflow: 'hidden' }}>
        {/* initialDimension gives the first paint a real box. Without it the
            container renders once at 0x0, Recharts draws nothing, and the chart
            only appears after the ResizeObserver fires a frame later. */}
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 560, height: h }}>
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
      {note && <p className="text-2xs text-muted mt-1.5">{note}</p>}
    </section>
  )
}

/**
 * ResponsiveContainer measures its box and clones its child with `width` and
 * `height`. These wrappers sit between the two, so they have to pass those
 * props straight through — a Recharts chart with no dimensions renders nothing
 * at all, which is how you get a blank white panel.
 */
export interface Sized { width?: number; height?: number }

export interface FPoint {
  label: string
  actual?: number | null
  forecast?: number | null
  band?: [number, number] | null
  old?: number | null
}

export function Forecast({ data, fence, fenceLabel = 'fence', showOld, width, height }: {
  data: FPoint[]; fence?: string; fenceLabel?: string; showOld?: boolean
} & Sized) {
  const p = usePalette(), ax = axisProps(p)
  const gid = useId().replace(/:/g, '')
  return (
    <ComposedChart width={width} height={height} data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
      <defs>
        <linearGradient id={`band${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.primary} stopOpacity={0.22} />
          <stop offset="100%" stopColor={p.primary} stopOpacity={0.03} />
        </linearGradient>
      </defs>
      <CartesianGrid stroke={p.grid} strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey="label" {...ax} /><YAxis {...ax} width={34} />
      <Tooltip content={<Tip unit=" t" />} cursor={{ stroke: p.grid }} />
      <Legend wrapperStyle={legendStyle} iconType="plainline" iconSize={10} />
      <Area dataKey="band" name="80% range" stroke="none" fill={`url(#band${gid})`} isAnimationActive={false} legendType="none" />
      <Line dataKey="actual" name="Actual" stroke={p.actual} strokeWidth={1.8} dot={false} isAnimationActive={false} />
      <Line dataKey="forecast" name="Forecast" stroke={p.forecast} strokeWidth={2} dot={false} strokeDasharray="4 3" isAnimationActive={false} />
      {showOld && <Line dataKey="old" name="Old method" stroke={p.old} strokeWidth={1.4} dot={false} strokeDasharray="2 3" isAnimationActive={false} />}
      {fence && <ReferenceLine x={fence} stroke={p.warning} strokeDasharray="3 3"
        label={{ value: fenceLabel, position: 'top', fontSize: 9, fill: p.warning }} />}
    </ComposedChart>
  )
}

export function StockChart({ data, unit, width, height }: {
  data: { label: string; onHand: number; safety: number; reorder: number }[]; unit: string
} & Sized) {
  const p = usePalette(), ax = axisProps(p)
  return (
    <ComposedChart width={width} height={height} data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
      <CartesianGrid stroke={p.grid} strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey="label" {...ax} /><YAxis {...ax} width={38} />
      <Tooltip content={<Tip unit={` ${unit}`} />} cursor={{ stroke: p.grid }} />
      <Legend wrapperStyle={legendStyle} iconType="plainline" iconSize={10} />
      <Area dataKey="onHand" name="On hand" stroke={p.forecast} fill={p.forecast} fillOpacity={0.14} strokeWidth={2} isAnimationActive={false} />
      <Line dataKey="safety" name="Safety" stroke={p.warning} strokeWidth={1.4} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
      <Line dataKey="reorder" name="Reorder" stroke={p.danger} strokeWidth={1.4} strokeDasharray="2 3" dot={false} isAnimationActive={false} />
    </ComposedChart>
  )
}

export function Bars({ data, x, bars, unit = '', stacked, h, width, height }: {
  data: any[]; x: string; bars: { k: string; name: string; color?: string }[]
  unit?: string; stacked?: boolean; h?: boolean
} & Sized) {
  const p = usePalette(), ax = axisProps(p)
  return (
    <BarChart width={width} height={height} data={data} layout={h ? 'vertical' : 'horizontal'} margin={{ top: 4, right: 10, bottom: 0, left: h ? 4 : 0 }}>
      <CartesianGrid stroke={p.grid} strokeDasharray="2 4" vertical={!!h} horizontal={!h} />
      {/* interval={0} forces a label on every category. Recharts drops every
          other one by default when it thinks they will collide, which on a
          nine-bar chart silently hides half the material codes. */}
      {h ? <><XAxis type="number" {...ax} /><YAxis type="category" dataKey={x} {...ax} width={112} interval={0} /></>
         : <><XAxis dataKey={x} {...ax} interval="preserveStartEnd" /><YAxis {...ax} width={34} /></>}
      <Tooltip content={<Tip unit={unit} />} cursor={{ fill: p.grid, fillOpacity: 0.35 }} />
      {bars.length > 1 && <Legend wrapperStyle={legendStyle} iconType="square" iconSize={9} />}
      {bars.map((b, i) => (
        <Bar key={b.k} dataKey={b.k} name={b.name} fill={b.color ?? p.series[i % p.series.length]}
          radius={h ? [0, 3, 3, 0] : [3, 3, 0, 0]} stackId={stacked ? 'a' : undefined} isAnimationActive={false} />
      ))}
    </BarChart>
  )
}

export function Lines({ data, x, lines, unit = '', width, height }: {
  data: any[]; x: string; lines: { k: string; name: string; color?: string; dash?: boolean }[]; unit?: string
} & Sized) {
  const p = usePalette(), ax = axisProps(p)
  return (
    <LineChart width={width} height={height} data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
      <CartesianGrid stroke={p.grid} strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey={x} {...ax} /><YAxis {...ax} width={34} />
      <Tooltip content={<Tip unit={unit} />} cursor={{ stroke: p.grid }} />
      {lines.length > 1 && <Legend wrapperStyle={legendStyle} iconType="plainline" iconSize={10} />}
      {lines.map((l, i) => (
        <Line key={l.k} dataKey={l.k} name={l.name} stroke={l.color ?? p.series[i % p.series.length]}
          strokeWidth={1.8} dot={false} strokeDasharray={l.dash ? '4 3' : undefined} isAnimationActive={false} connectNulls />
      ))}
    </LineChart>
  )
}

/** Forecast split into base + trend + season + signal. */
export function Decomp({ data, width, height }: { data: { label: string; base: number; trend: number; season: number; signal: number }[] } & Sized) {
  const p = usePalette(), ax = axisProps(p)
  return (
    <BarChart width={width} height={height} data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
      <CartesianGrid stroke={p.grid} strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey="label" {...ax} /><YAxis {...ax} width={34} />
      <Tooltip content={<Tip unit=" t" />} cursor={{ fill: p.grid, fillOpacity: 0.35 }} />
      <Legend wrapperStyle={legendStyle} iconType="square" iconSize={9} />
      <Bar dataKey="base" name="Base" stackId="a" fill={p.primary} isAnimationActive={false} />
      <Bar dataKey="trend" name="Trend" stackId="a" fill={p.info} isAnimationActive={false} />
      <Bar dataKey="season" name="Season" stackId="a" fill={p.ai} isAnimationActive={false} />
      <Bar dataKey="signal" name="Signal" stackId="a" fill={p.warning} radius={[3, 3, 0, 0]} isAnimationActive={false} />
    </BarChart>
  )
}

export function CapacityChart({ data, maintenance = [], width, height }: {
  data: { label: string; planned: number; over: number; capacity: number }[]
  /** Weeks with a planned shutdown, marked on the axis so a dip has a reason. */
  maintenance?: { label: string; line: string; binds: boolean }[]
} & Sized) {
  const p = usePalette(), ax = axisProps(p)
  return (
    <ComposedChart width={width} height={height} data={data} margin={{ top: 14, right: 8, bottom: 0, left: 0 }}>
      <CartesianGrid stroke={p.grid} strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey="label" {...ax} /><YAxis {...ax} width={38} />
      <Tooltip content={<Tip unit=" t" />} cursor={{ fill: p.grid, fillOpacity: 0.35 }} />
      <Legend wrapperStyle={legendStyle} iconType="square" iconSize={9} />
      {/* A drop in the capacity line is a scheduled shutdown, not a glitch —
          so the week that causes it is named on the chart itself. */}
      {maintenance.map(m => (
        <ReferenceLine key={m.label} x={m.label}
          stroke={m.binds ? p.warning : p.grid} strokeDasharray="3 3"
          label={m.binds
            ? { value: '⚙ ' + m.line, position: 'top', fontSize: 9, fill: p.warning }
            : undefined} />
      ))}
      <Bar dataKey="planned" name="Planned" stackId="a" fill={p.primary} isAnimationActive={false} />
      <Bar dataKey="over" name="Over capacity" stackId="a" fill={p.danger} radius={[3, 3, 0, 0]} isAnimationActive={false} />
      <Line dataKey="capacity" name="Capacity" stroke={p.actual} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
    </ComposedChart>
  )
}

/**
 * Events on a date line.
 *
 * One dot per thing that happened: position by date, row by what kind of thing
 * it was, size by how much it mattered. A six-month run of signals reads as a
 * shape — clusters, quiet stretches, a run of supply trouble — which a list of
 * cards cannot show.
 */
export interface TimelinePoint {
  id: string
  x: number
  kind: string
  size: number
  title: string
  when: string
}

export function Timeline({ data, kinds, fmtX, onPoint, width, height }: {
  data: TimelinePoint[]
  kinds: { k: string; color: string }[]
  fmtX: (x: number) => string
  onPoint?: (id: string) => void
} & Sized) {
  const p = usePalette(), ax = axisProps(p)
  const xs = data.length ? data.map(d => d.x) : [0]
  const lo = Math.min(...xs), hi = Math.max(...xs)
  const pad = Math.max(1, Math.round((hi - lo) * 0.04))

  /**
   * Ticks every four weeks, generated rather than left to Recharts.
   *
   * A numeric axis over a short integer range picks one tick on its own, which
   * on a six-month timeline means a single date label and no sense of when
   * anything happened.
   */
  const ticks: number[] = []
  for (let w = lo; w <= hi; w += 4) ticks.push(w)
  if (ticks[ticks.length - 1] !== hi) ticks.push(hi)

  return (
    <ScatterChart width={width} height={height} margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
      <CartesianGrid stroke={p.grid} strokeDasharray="2 4" />
      {/* interval={0} because the ticks are chosen here, not by Recharts. Left
          to itself it drops labels it thinks would collide, which on a short
          numeric axis leaves a six-month timeline with a single date on it. */}
      <XAxis type="number" dataKey="x" {...ax} domain={[lo - pad, hi + pad]}
        ticks={ticks} interval={0} tickFormatter={fmtX} />
      <YAxis type="category" dataKey="kind" {...ax} width={76} interval={0}
        allowDuplicatedCategory={false} />
      <ZAxis type="number" dataKey="size" range={[70, 380]} />
      <Tooltip cursor={{ stroke: p.grid }} content={({ active, payload }: any) => {
        if (!active || !payload?.length) return null
        const d = payload[0].payload as TimelinePoint
        return (
          <div className="card shadow-lg px-2.5 py-1.5 text-sm max-w-xs">
            <div className="num text-2xs text-muted">{d.when} · {d.kind}</div>
            <div className="font-semibold leading-snug">{d.title}</div>
          </div>
        )
      }} />
      <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />
      {kinds.map(k => (
        <Scatter key={k.k} name={k.k} data={data.filter(d => d.kind === k.k)} fill={k.color}
          isAnimationActive={false}
          onClick={(e: any) => onPoint?.(e?.id ?? e?.payload?.id)}
          style={onPoint ? { cursor: 'pointer' } : undefined} />
      ))}
    </ScatterChart>
  )
}

/**
 * Events over time, as a graph rather than a scatter of dots.
 *
 * Stacked columns say how many events arrived in each fortnight and what kind
 * they were; the line over the top is their net effect on the forecast. A dot
 * plot showed every event individually but no trend — you could not see that
 * demand signals cluster in the autumn, or that the net effect turns positive.
 */
export function EventChart({ data, kinds, onBar, width, height }: {
  data: (Record<string, number> & { label: string; net: number })[]
  kinds: { k: string; name: string; color: string }[]
  onBar?: (label: string) => void
} & Sized) {
  const p = usePalette(), ax = axisProps(p)
  return (
    <ComposedChart width={width} height={height} data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
      onClick={(e: any) => onBar?.(e?.activeLabel)}>
      <CartesianGrid stroke={p.grid} strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey="label" {...ax} interval={0} />
      <YAxis {...ax} width={28} allowDecimals={false} />
      <YAxis yAxisId="eff" orientation="right" {...ax} width={38} tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}%`} />
      <Tooltip content={<Tip />} cursor={{ fill: p.grid, fillOpacity: 0.35 }} />
      <Legend wrapperStyle={legendStyle} iconType="square" iconSize={9} />
      <ReferenceLine yAxisId="eff" y={0} stroke={p.grid} />
      {kinds.map(k => (
        <Bar key={k.k} dataKey={k.k} name={k.name} stackId="a" fill={k.color}
          isAnimationActive={false} style={onBar ? { cursor: 'pointer' } : undefined} />
      ))}
      {/* Deliberately not one of the series colours: the line is a different
          kind of thing from the columns, and it shared purple with Price. */}
      <Line yAxisId="eff" dataKey="net" name="Net effect on forecast" stroke={p.actual}
        strokeWidth={2.4} dot={{ r: 2.5, fill: p.surface, strokeWidth: 1.6 }} isAnimationActive={false} />
    </ComposedChart>
  )
}

/** Share of a total, as a ring. Reads better than bars when the question is "of what". */
export function Donut({ data, fmt, width, height }: {
  data: { name: string; value: number }[]
  fmt?: (v: number) => string
} & Sized) {
  const p = usePalette()
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  return (
    <PieChart width={width} height={height} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
      <Tooltip content={({ active, payload }: any) => {
        if (!active || !payload?.length) return null
        const d = payload[0]
        return (
          <div className="card shadow-lg px-2.5 py-1.5 text-sm">
            <div className="font-semibold">{d.name}</div>
            <div className="num text-muted">
              {fmt ? fmt(d.value) : d.value} · {((d.value / total) * 100).toFixed(1)}%
            </div>
          </div>
        )
      }} />
      <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />
      <Pie data={data} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="80%"
        paddingAngle={1} isAnimationActive={false} stroke={p.surface} strokeWidth={1}>
        {data.map((_, i) => <Cell key={i} fill={p.series[i % p.series.length]} />)}
      </Pie>
    </PieChart>
  )
}

/** CSS heatmap — products × regions at a glance. Inline style, so variables are fine here. */
export function Heat({ rows, cols, get, onCell, fmt, corner = 'Product' }: {
  rows: string[]; cols: string[]; corner?: string
  get: (r: string, c: string) => number | null
  onCell?: (r: string, c: string) => void
  fmt?: (v: number) => string
}) {
  const all = rows.flatMap(r => cols.map(c => get(r, c))).filter((v): v is number => v !== null)
  const max = Math.max(...all.map(Math.abs), 1)
  const style = (v: number | null) => {
    if (v === null) return { background: 'rgb(var(--surface2))', color: 'rgb(var(--muted))' }
    const t = Math.min(1, Math.abs(v) / max)
    const c = v >= 0 ? 'var(--success)' : 'var(--danger)'
    return { background: `rgb(${c} / ${(0.12 + t * 0.68).toFixed(2)})`, color: t > 0.5 ? '#fff' : 'rgb(var(--fg))' }
  }
  return (
    <div className="overflow-auto">
      <table className="border-collapse">
        <thead>
          <tr>
            <th className="th sticky left-0 z-20">{corner}</th>
            {cols.map(c => <th key={c} className="th text-center min-w-[62px]">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r}>
              <td className="td sticky left-0 z-10 bg-surface font-mono text-2xs whitespace-nowrap border-r border-line">{r}</td>
              {cols.map(c => {
                const v = get(r, c)
                return (
                  <td key={c} className="p-0 border-b border-line/70">
                    <button className="w-full px-1 py-1.5 num text-2xs font-bold hover:ring-2 hover:ring-primary transition-all"
                      style={style(v)} onClick={() => onCell?.(r, c)}
                      title={v === null ? 'No sales' : `${r} · ${c}: ${fmt ? fmt(v) : v.toFixed(1)}`}>
                      {v === null ? '–' : fmt ? fmt(v) : v.toFixed(0)}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export { ReferenceLine, Cell }
