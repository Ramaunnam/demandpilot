import React, { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { spottedText } from '@/engine/insights'
import {
  Newspaper, LineChart, UserRound, Factory, Truck, Scale, Search, ArrowRight,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Head, Tile, Tiles, Panel, Chip, Status, Drawer, LVRow, Dot, Empty } from '@/ui/kit'
import { Chart, Lines, EventChart, useC } from '@/ui/charts'
import { fmtDateShort, fmtDate, fmtSigned, fmtNum, fmtPct, fmtCover } from '@/lib/format'
import { weekDate } from '@/data/generate'
import type { MarketSignal, SignalSourceType, RegionName, Grade } from '@/data/types'

const ICON: Record<SignalSourceType, React.ElementType> = {
  'Industry news': Newspaper, 'Commodity index': LineChart, 'Customer intimation': UserRound,
  'Supplier notice': Factory, 'Logistics update': Truck, 'Policy update': Scale,
}
const KINDS = ['Demand', 'Supply', 'Price', 'Logistics'] as const
const REGIONS: RegionName[] = ['North', 'South', 'East', 'West']
const GRADES: Grade[] = ['304', '316L', '430', '201']
const SEVERITIES = ['High', 'Medium', 'Low'] as const

/** Six months, matching the subtitle and the timeline window. */
const WINDOW_WEEKS = 26

export default function Signals() {
  const C = useC()
  const { ds, result, settings } = useStore()
  const r = result!
  const [sp, setSp] = useSearchParams()

  const [kind, setKind] = useState<string>(sp.get('k') ?? 'All')
  const [region, setRegion] = useState<string>(sp.get('rg') ?? 'All')
  const [grade, setGrade] = useState<string>(sp.get('g') ?? 'All')
  const [sev, setSev] = useState<string>('All')
  const [q, setQ] = useState('')

  const openId = sp.get('s')
  const open = openId ? ds.signals.find(s => s.id === openId) ?? null : null
  const select = (id: string | null) =>
    setSp(p => { id ? p.set('s', id) : p.delete('s'); return p }, { replace: true })

  const inWindow = useMemo(
    () => ds.signals.filter(s => s.week >= r.todayWeek - WINDOW_WEEKS),
    [ds.signals, r.todayWeek])

  const list = useMemo(() => inWindow.filter(s =>
    (kind === 'All' || s.kind === kind) &&
    (region === 'All' || s.regions.includes(region as RegionName)) &&
    (grade === 'All' || s.grades.includes(grade as Grade)) &&
    (sev === 'All' || s.severity === sev) &&
    (!q.trim() || `${s.title} ${s.explanation} ${s.sourceType}`.toLowerCase().includes(q.toLowerCase()))
  ), [inWindow, kind, region, grade, sev, q])

  const filtered = kind !== 'All' || region !== 'All' || grade !== 'All' || sev !== 'All' || !!q.trim()

  /**
   * The six months as a graph.
   *
   * Binned by fortnight: columns are how many signals arrived and of what kind,
   * the line over the top is their net effect on the forecast. A dot per event
   * showed each one but no shape — you could not see that demand signals
   * cluster in the autumn, or when the net effect turns positive.
   */
  const bins = useMemo(() => {
    const first = r.todayWeek - WINDOW_WEEKS
    const out: (Record<string, number> & { label: string; net: number; from: number; to: number })[] = []
    for (let w = first; w <= r.todayWeek; w += 2) {
      const inBin = list.filter(s => s.week >= w && s.week < w + 2)
      const row: any = {
        label: fmtDateShort(weekDate(ds, w)), from: w, to: w + 2,
        net: +inBin.reduce((t, s) => t + s.effectPct * s.confidence, 0).toFixed(1),
      }
      for (const k of KINDS) row[k] = inBin.filter(s => s.kind === k).length
      out.push(row)
    }
    return out
  }, [list, ds, r.todayWeek])

  const kindColors = [
    { k: 'Demand', name: 'Demand', color: C.info },
    { k: 'Supply', name: 'Supply', color: C.warning },
    { k: 'Price', name: 'Price', color: C.ai },
    { k: 'Logistics', name: 'Logistics', color: C.success },
  ]

  /** The alloy index, shown only where it is the subject: a price signal. */
  const priceIndex = useMemo(() => ds.commodity
    .slice(Math.max(0, r.todayWeek - 52), r.todayWeek + 1)
    .filter((_, i) => i % 2 === 0)
    .map(c => ({
      label: fmtDateShort(weekDate(ds, c.week)),
      nickel: c.nickel, moly: c.moly, chrome: c.ferrochrome,
    })), [ds, r.todayWeek])

  // ---- what the open signal connects to ---------------------------------
  const detail = useMemo(() => {
    if (!open) return null

    // Products it touches: this grade, in this region. Capped, with a link that
    // reproduces the same filter on the Forecast screen.
    const skus = ds.skus.filter(s => open.grades.length === 0 || open.grades.includes(s.grade))
    const materials = open.materialIds
      .map(id => r.materials.find(m => m.materialId === id))
      .filter((m): m is NonNullable<typeof m> => !!m)

    // Did anything actually come of it? A recommendation on one of its
    // materials is the signal having reached a decision.
    const recs = r.recommendations.filter(x => open.materialIds.includes(x.materialId))
    const anomalies = r.anomalies.filter(a => a.linkedSignalId === open.id)

    const forecastLink = `/forecast?${new URLSearchParams({
      ...(open.grades.length ? { g: open.grades[0] } : {}),
      ...(open.regions.length ? { rg: open.regions[0] } : {}),
    })}`

    return { skus, materials, recs, anomalies, forecastLink }
  }, [open, ds.skus, r.materials, r.recommendations, r.anomalies])

  const chipRow = (
    label: string, value: string, set: (v: string) => void, options: readonly string[], counts?: (v: string) => number,
  ) => (
    <div className="flex flex-wrap items-center gap-1">
      <span className="eyebrow mr-0.5">{label}</span>
      <button onClick={() => set('All')} className={`chip ${value === 'All' ? 'chip-primary' : 'chip-neutral'}`}>All</button>
      {options.map(o => {
        const n = counts?.(o)
        if (counts && n === 0) return null
        return (
          <button key={o} onClick={() => set(o)} className={`chip ${value === o ? 'chip-primary' : 'chip-neutral'}`}>
            {o}{n !== undefined ? ` ${n}` : ''}
          </button>
        )
      })}
    </div>
  )

  return (
    <>
      <Head title="Signals" blurb={`${inWindow.length} outside events tracked over six months`}
        chips={<Chip tone="warning"><Dot tone="warning" />{inWindow.filter(s => !s.read).length} new</Chip>} />

      <Tiles cols={5}>
        <Tile k="Demand" v={fmtNum(inWindow.filter(s => s.kind === 'Demand').length)} tone="info" onClick={() => setKind('Demand')} />
        <Tile k="Supply" v={fmtNum(inWindow.filter(s => s.kind === 'Supply').length)} onClick={() => setKind('Supply')} />
        <Tile k="Price" v={fmtNum(inWindow.filter(s => s.kind === 'Price').length)} onClick={() => setKind('Price')} />
        <Tile k="High severity" v={fmtNum(inWindow.filter(s => s.severity === 'High').length)} tone="warning" onClick={() => setSev('High')} />
        <Tile k="Signal → order" v={`${r.kpis.signalToActionDays}`} unit="days" to="/proof" tone="success" sub="was 38" />
      </Tiles>

      <div className="mt-3">
        <Chart title="Signals timeline — last 6 months" h={250}
          right={<Chip tone="neutral">{list.length} shown</Chip>}
          note="Columns are how many signals arrived each fortnight, by type. The purple line is their net effect on the forecast, weighted by confidence.">
          <EventChart data={bins} kinds={kindColors} />
        </Chart>
      </div>

      {/* Filters sit directly above the cards they filter. */}
      <Panel className="mt-3" pad={false}>
        <div className="p-2.5 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-52">
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <input className="input pl-6 h-7 text-sm" placeholder="Search signals" value={q}
                onChange={e => setQ(e.target.value)} />
            </div>
            {chipRow('Type', kind, setKind, KINDS, k => inWindow.filter(s => s.kind === k).length)}
            <div className="flex-1" />
            {filtered && (
              <button className="btn btn-ghost btn-xs"
                onClick={() => { setKind('All'); setRegion('All'); setGrade('All'); setSev('All'); setQ('') }}>
                Clear all
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {chipRow('Region', region, setRegion, REGIONS, g => inWindow.filter(s => s.regions.includes(g as RegionName)).length)}
            {chipRow('Grade', grade, setGrade, GRADES, g => inWindow.filter(s => s.grades.includes(g as Grade)).length)}
            {chipRow('Severity', sev, setSev, SEVERITIES)}
          </div>
        </div>
      </Panel>

      {list.length === 0 ? (
        <Panel className="mt-2"><Empty title="No signal matches" hint="Clear a filter to see more." /></Panel>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 mt-2">
          {list.map(s => {
            const Icon = ICON[s.sourceType]
            return (
              <button key={s.id} onClick={() => select(s.id)}
                className={`card pad text-left hover:border-primary/40 hover:shadow-md transition-all ${
                  s.severity === 'High' ? 'border-warning/30' : ''}`}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Icon className="w-3.5 h-3.5 text-muted shrink-0" />
                  <Status v={s.severity} />
                  <Chip tone="neutral">{s.kind}</Chip>
                  {!s.read && <Chip tone="primary">new</Chip>}
                  <span className="num text-2xs text-muted ml-auto">{fmtDateShort(weekDate(ds, s.week))}</span>
                </div>
                <h4 className="text-base font-semibold leading-snug line-clamp-2">{s.title}</h4>
                <div className="flex items-center gap-3 mt-2 pt-2 border-t border-line">
                  <div>
                    <div className={`num text-md font-bold ${s.effectPct > 0 ? 'text-success' : s.effectPct < 0 ? 'text-danger' : 'text-muted'}`}>
                      {s.effectPct === 0 ? 'no effect' : fmtSigned(s.effectPct)}
                    </div>
                    <div className="text-2xs text-muted">effect</div>
                  </div>
                  <div>
                    <div className="num text-md font-bold">{fmtPct(s.confidence * 100, 0)}</div>
                    <div className="text-2xs text-muted">confidence</div>
                  </div>
                  {/* Tags are written with the headline, so they agree with it. */}
                  <div className="flex flex-wrap gap-1 ml-auto justify-end">
                    {s.regions.slice(0, 2).map(x => <Chip key={x} tone="info">{x}</Chip>)}
                    {s.grades.slice(0, 2).map(x => <Chip key={x} tone="neutral">{x}</Chip>)}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <Drawer open={!!open} onClose={() => select(null)} title={open?.title ?? ''}
        sub={open ? `${open.sourceType} · ${fmtDate(weekDate(ds, open.week))}` : ''}
        chips={open && <><Status v={open.severity} /><Chip tone="neutral">{open.kind}</Chip></>}>
        {open && detail && (
          <>
            <Panel title="What happened">
              <p className="text-base leading-relaxed">{open.explanation}</p>
            </Panel>

            <LVRow cols={4} items={[
              { k: 'Date', v: fmtDate(weekDate(ds, open.week)) },
              { k: 'Source', v: open.sourceType },
              {
                k: 'Stated effect',
                v: open.effectPct === 0 ? 'None' : fmtSigned(open.effectPct),
                tone: open.effectPct > 0 ? 'success' : open.effectPct < 0 ? 'danger' : undefined,
              },
              { k: 'Confidence', v: fmtPct(open.confidence * 100, 0) },
            ]} />

            <Panel title="Effect on the forecast">
              <div className="flex items-baseline gap-2">
                <span className="num text-2xl font-bold">
                  {fmtSigned(open.effectPct * open.confidence * (settings.signalWeightPct / 100) * 0.45)}
                </span>
                <span className="text-base text-muted">applied to matching products</span>
              </div>
              <p className="text-2xs text-muted mt-1.5 pt-1.5 border-t border-line">
                Stated effect × confidence × the {settings.signalWeightPct}% signal weight set in Settings.
              </p>
            </Panel>

            {/* The alloy index belongs to price signals, and only to them. */}
            {open.kind === 'Price' && (
              <Chart title="Alloy price index — 12 months" h={170}
                note="Indexed to 100 at the start of the window.">
                <Lines data={priceIndex} x="label" lines={[
                  { k: 'moly', name: 'Molybdenum', color: C.warning },
                  { k: 'nickel', name: 'Nickel', color: C.info },
                  { k: 'chrome', name: 'Ferrochrome', color: C.forecast },
                ]} />
              </Chart>
            )}

            {(open.regions.length > 0 || open.grades.length > 0) && (
              <Panel title="Products affected"
                right={<Link to={detail.forecastLink} className="btn btn-ghost btn-xs">
                  Open in Forecast <ArrowRight className="w-3 h-3" />
                </Link>}>
                <div className="flex flex-wrap gap-1 mb-2">
                  {open.regions.map(x => <Chip key={x} tone="info">{x}</Chip>)}
                  {open.grades.map(x => <Chip key={x} tone="neutral">Grade {x}</Chip>)}
                </div>
                <p className="text-2xs text-muted">
                  {open.grades.length
                    ? `${detail.skus.length} products in ${open.grades.length === 1 ? `grade ${open.grades[0]}` : 'these grades'}`
                    : 'All grades'}
                  {open.regions.length ? `, ${open.regions.join(' and ')} region` : ', every region'}.
                </p>
              </Panel>
            )}

            {detail.materials.length > 0 && (
              <Panel title="Materials affected">
                <div className="space-y-1">
                  {detail.materials.map(m => (
                    <Link key={m.materialId} to={`/stock?m=${m.materialId}`}
                      className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 hover:border-primary/40 transition-colors">
                      <span className="font-mono text-sm font-semibold">{m.code}</span>
                      <span className="text-base flex-1 truncate">{m.name}</span>
                      <Status v={m.inv.status} />
                      <span className="num text-2xs text-muted">{fmtCover(m.inv.daysOfCover)}</span>
                      <ArrowRight className="w-3 h-3 text-muted/60 shrink-0" />
                    </Link>
                  ))}
                </div>
              </Panel>
            )}

            {/* Whether the signal actually went anywhere. */}
            <Panel title="What it led to"
              right={<Chip tone={detail.recs.length || detail.anomalies.length ? 'success' : 'neutral'}>
                {detail.recs.length + detail.anomalies.length || 'nothing yet'}
              </Chip>}>
              {detail.anomalies.length > 0 && (
                <div className="mb-2">
                  <div className="eyebrow mb-1">Demand moved</div>
                  <div className="space-y-1">
                    {detail.anomalies.slice(0, 4).map(a => (
                      <Link key={a.id} to="/anomalies"
                        className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 hover:border-primary/40 transition-colors">
                        <Status v={a.severity} />
                        <span className="font-mono text-sm">{a.skuCode}</span>
                        <Chip tone="info">{a.region}</Chip>
                        <span className={`num text-sm ml-auto font-semibold ${a.deltaPct > 0 ? 'text-success' : 'text-danger'}`}>
                          {fmtSigned(a.deltaPct)}
                        </span>
                        <span className="num text-2xs text-muted">spotted {spottedText(a.detectedAfterWeeks)}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {detail.recs.length > 0 ? (
                <>
                  <div className="eyebrow mb-1">Action raised</div>
                  <div className="space-y-1">
                    {detail.recs.map(x => (
                      <Link key={x.id} to={`/buy?r=${x.materialCode}`}
                        className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 hover:border-primary/40 transition-colors">
                        <Status v={x.type} />
                        <span className="font-mono text-sm font-semibold">{x.materialCode}</span>
                        <span className="text-base flex-1 truncate">{x.materialName}</span>
                        <ArrowRight className="w-3 h-3 text-muted/60 shrink-0" />
                      </Link>
                    ))}
                  </div>
                </>
              ) : detail.anomalies.length === 0 && (
                <p className="text-base text-muted">
                  Nothing has come of this one yet. It is carried in the forecast at the weight above,
                  but no material has moved far enough to need a decision.
                </p>
              )}
            </Panel>
          </>
        )}
      </Drawer>
    </>
  )
}
