import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Printer, PackageCheck, Eye, Coins, ChevronRight } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Head, Panel, Chip, Tabs } from '@/ui/kit'
import { Chart, Lines, Bars, useC } from '@/ui/charts'
import { fmtINR, fmtNum, fmtPct } from '@/lib/format'
import { wkLabel } from '@/lib/view'
import { REPLAY_WEEKS, FORECAST_ERROR_SD } from '@/engine/replay'
import { STORY } from '@/data/generate'

export default function Proof() {
  const C = useC()
  const { result, ds, settings } = useStore()
  const r = result!
  const rep = r.replay
  const [tab, setTab] = useState('side')
  const [matId, setMatId] = useState(STORY.criticalMaterial)

  const b = rep.before.materials.find(m => m.materialId === matId)
  const a = rep.after.materials.find(m => m.materialId === matId)

  /**
   * The material that drives the stock difference, found rather than named, so
   * the explanation stays true if the data or the tuning moves.
   */
  const driver = useMemo(() => {
    let best = rep.before.materials[0]
    let bestGap = -Infinity
    for (const x of rep.before.materials) {
      const y = rep.after.materials.find(z => z.materialId === x.materialId)
      if (!y) continue
      const gap = y.avgStockValue - x.avgStockValue
      if (gap > bestGap) { bestGap = gap; best = x }
    }
    const raw = ds.materials.find(x => x.id === best.materialId)
    const mv = r.materials.find(x => x.materialId === best.materialId)
    return {
      name: raw?.name ?? best.name,
      lead: raw?.leadTimeDays ?? 0,
      oldCover: Math.round((raw?.staticMinLevel ?? 0) / Math.max(0.0001, mv?.dailyUsage ?? 1)),
      outWeeks: best.stockoutWeeks,
    }
  }, [rep, ds, r.materials])

  const ratio = rep.deltas.extraHoldingCostINR > 0
    ? Math.round(rep.deltas.productionProtectedINR / rep.deltas.extraHoldingCostINR)
    : 0

  const stock = useMemo(() => !b || !a ? [] : b.weeks.map((w, i) => ({
    label: wkLabel(ds, w.week), Old: +w.onHandEnd.toFixed(1),
    DemandPilot: +a.weeks[i].onHandEnd.toFixed(1), Use: +w.demand.toFixed(1),
  })), [b, a, ds])

  const outs = useMemo(() => {
    const top = [...rep.before.materials]
      .filter(m => m.stockoutWeeks > 0 || (rep.after.materials.find(x => x.materialId === m.materialId)?.stockoutWeeks ?? 0) > 0)
      .sort((x, y) => y.stockoutWeeks - x.stockoutWeeks).slice(0, 10)
    return top.map(m => ({
      label: m.code, Old: m.stockoutWeeks,
      DemandPilot: rep.after.materials.find(x => x.materialId === m.materialId)?.stockoutWeeks ?? 0,
    }))
  }, [rep])

  const outcomes = [
    {
      icon: PackageCheck, title: 'Stockouts', claim: `weeks a material ran short, over ${REPLAY_WEEKS} weeks`,
      old: `${rep.before.totalStockouts}`, now: `${rep.after.totalStockouts}`,
      detail: `${rep.before.materialsWithStockout} materials ran short the old way, ${rep.after.materialsWithStockout} here · ${fmtNum(rep.deltas.lineStopDaysAvoided)} line-stop days avoided, total across all lines`,
      good: true, tag: null as string | null,
    },
    {
      icon: Coins, title: 'Storage cost', claim: `to hold stock across the ${REPLAY_WEEKS} weeks`,
      old: fmtINR(rep.before.storageCostINR), now: fmtINR(rep.after.storageCostINR),
      detail: `DemandPilot costs ${fmtINR(Math.abs(rep.deltas.extraHoldingCostINR))} more to hold. That is the price of covering lead times the fixed minimum ignored — see the trade below.`,
      good: false, tag: 'trade-off',
    },
    {
      icon: Eye, title: 'End to end', claim: 'signal to approved order',
      old: `${rep.before.signalToOrderDays} days`, now: `${rep.after.signalToOrderDays} days`,
      detail: 'The old route waited for a three-month average to move',
      good: true, tag: null as string | null,
    },
  ]

  const table = [
    { k: 'Stockout weeks', a: rep.before.totalStockouts, b: rep.after.totalStockouts, f: (n: number) => fmtNum(n), down: true },
    { k: 'Materials short', a: rep.before.materialsWithStockout, b: rep.after.materialsWithStockout, f: (n: number) => fmtNum(n), down: true },
    { k: 'Line-stop days (all lines)', a: rep.before.lineStopDays, b: rep.after.lineStopDays, f: (n: number) => fmtNum(n), down: true },
    { k: 'Service level (by value)', a: rep.before.serviceLevelPct, b: rep.after.serviceLevelPct, f: (n: number) => fmtPct(n), down: false },
    { k: 'Production stopped', a: rep.before.productionStoppedINR, b: rep.after.productionStoppedINR, f: fmtINR, down: true },
    { k: 'Average stock', a: rep.before.avgInventoryValueINR, b: rep.after.avgInventoryValueINR, f: fmtINR, down: true },
    { k: 'Days of inventory', a: rep.before.daysOfInventory, b: rep.after.daysOfInventory, f: (n: number) => `${n.toFixed(0)}d`, down: true },
    { k: 'Storage cost', a: rep.before.storageCostINR, b: rep.after.storageCostINR, f: fmtINR, down: true },
    { k: 'Signal to order', a: rep.before.signalToOrderDays, b: rep.after.signalToOrderDays, f: (n: number) => `${n}d`, down: true },
  ]

  const problems = [
    ['C1', 'Shift noticed too late', 'Caught in days', '/anomalies'],
    ['C2', 'Experience forecasts broke', 'Three models, re-tested', '/forecast?tab=accuracy'],
    ['C3', 'Reorder went out late', 'Order-by date on every material', '/stock'],
    ['C4', 'Cannot see all products', 'Heatmap + exception queue', '/forecast'],
    ['C5', 'Too much and too little', 'Availability and excess scored together', '/stock'],
  ]

  return (
    <>
      <Head title="Proof" blurb={`The same ${REPLAY_WEEKS} weeks replayed two ways through one engine`}
        actions={<button className="btn btn-outline btn-sm" onClick={() => window.print()}><Printer className="w-3 h-3" /> Print</button>} />

      <div className="grid gap-2.5 lg:grid-cols-3">
        {outcomes.map(o => {
          const Icon = o.icon
          return (
            <div key={o.title} className={`card pad ${o.good ? 'border-success/35' : 'border-warning/35'}`}>
              <div className="flex items-center gap-2 mb-2.5">
                <div className={`w-7 h-7 rounded-lg grid place-items-center shrink-0 ${o.good ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-md font-bold leading-tight">{o.title}</span>
                    {o.tag && <Chip tone="warning">{o.tag}</Chip>}
                  </div>
                  <div className="text-2xs text-muted">{o.claim}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-surface2 border border-line p-2">
                  <div className="eyebrow">Old way</div>
                  <div className="num text-lg font-bold text-muted mt-0.5">{o.old}</div>
                </div>
                <div className={`rounded-lg p-2 border ${o.good ? 'bg-success-soft border-success/25' : 'bg-warning-soft border-warning/25'}`}>
                  <div className="eyebrow">DemandPilot</div>
                  <div className={`num text-lg font-bold mt-0.5 ${o.good ? 'text-success' : 'text-warning'}`}>{o.now}</div>
                </div>
              </div>
              <p className="text-2xs text-muted mt-2">{o.detail}</p>
            </div>
          )
        })}
      </div>

      <Panel className="mt-3 border-warning/30" title="The honest trade — DemandPilot does not win on stock">
        <p className="text-base leading-relaxed">
          DemandPilot carries <strong>more</strong> stock here, not less: {fmtINR(rep.after.avgInventoryValueINR)} on
          average against {fmtINR(rep.before.avgInventoryValueINR)}, costing {fmtINR(Math.abs(rep.deltas.extraHoldingCostINR))} more
          to hold over the {REPLAY_WEEKS} weeks. That gap is arithmetic rather than policy, so no amount of tuning
          removes it. {driver.name} alone accounts for most of it: a {driver.lead}-day lead time means cover below{' '}
          {driver.lead} days cannot be replaced before it runs out, and the old rule reorders at {driver.oldCover} days.
          The old way holds less stock by running out — on {driver.name.toLowerCase()} it sits at zero for{' '}
          {driver.outWeeks} of the {REPLAY_WEEKS} weeks.
        </p>
        <div className="grid sm:grid-cols-3 gap-2 mt-3">
          <div className="rounded-lg border border-danger/25 bg-danger-soft p-2.5">
            <div className="eyebrow">Extra cost of cover</div>
            <div className="num text-lg font-bold text-danger mt-0.5">{fmtINR(Math.abs(rep.deltas.extraHoldingCostINR))}</div>
            <p className="text-2xs text-muted mt-0.5">more holding cost over {REPLAY_WEEKS} weeks</p>
          </div>
          <div className="rounded-lg border border-success/25 bg-success-soft p-2.5">
            <div className="eyebrow">Production it protects</div>
            <div className="num text-lg font-bold text-success mt-0.5">{fmtINR(rep.deltas.productionProtectedINR)}</div>
            <p className="text-2xs text-muted mt-0.5">output the old way could not make</p>
          </div>
          <div className="rounded-lg border border-line bg-surface2 p-2.5">
            <div className="eyebrow">Return on the trade</div>
            <div className="num text-lg font-bold mt-0.5">{ratio}×</div>
            <p className="text-2xs text-muted mt-0.5">protected per rupee of holding cost</p>
          </div>
        </div>
        <p className="text-2xs text-muted mt-2.5 pt-2.5 border-t border-line">
          Separately, and not counted above, the live plan flags {fmtINR(r.kpis.excessValueINR)} of
          stock as genuinely surplus to the current demand plan — that is where inventory comes down,
          on the Stock screen rather than in this replay.
        </p>
      </Panel>

      <div className="flex justify-end mt-3 mb-2">
        <Tabs active={tab} onChange={setTab} tabs={[
          { id: 'side', label: 'Side by side' }, { id: 'week', label: 'Week by week' },
          { id: 'why', label: 'Why' },
        ]} />
      </div>

      {tab === 'side' && (
        <div className="grid gap-3 lg:grid-cols-5">
          <Panel className="lg:col-span-2" title="Everything measured" pad={false}>
            <div className="pad">
              <table className="w-full border-collapse">
                <thead><tr><th className="th">Measure</th><th className="th text-right">Old</th><th className="th text-right">Now</th></tr></thead>
                <tbody>
                  {table.map(row => {
                    const d = row.b - row.a, better = row.down ? d < 0 : d > 0
                    return (
                      <tr key={row.k}>
                        <td className="td">{row.k}</td>
                        <td className="td text-right num text-muted">{row.f(row.a)}</td>
                        <td className={`td text-right num font-semibold ${d === 0 ? '' : better ? 'text-success' : 'text-danger'}`}>{row.f(row.b)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
          <div className="lg:col-span-3">
            <Chart title="Stockout weeks by material" h={290}>
              <Bars data={outs} x="label" bars={[
                { k: 'Old', name: 'Old way', color: C.old }, { k: 'DemandPilot', name: 'DemandPilot', color: C.forecast },
              ]} />
            </Chart>
          </div>
        </div>
      )}

      {tab === 'week' && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <select className="input w-auto max-w-xs" value={matId} onChange={e => setMatId(e.target.value)}>
              {rep.before.materials.map(m => <option key={m.materialId} value={m.materialId}>{m.code} — {m.name}</option>)}
            </select>
            {b && a && <>
              <Chip tone={b.stockoutWeeks > 0 ? 'danger' : 'neutral'}>old: {b.stockoutWeeks} short</Chip>
              <Chip tone={a.stockoutWeeks > 0 ? 'danger' : 'success'}>now: {a.stockoutWeeks} short</Chip>
            </>}
          </div>
          {b && a && (
            <div className="grid gap-3 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <Chart title={`${b.code} — stock on hand`} h={260}>
                  <Lines data={stock} x="label" unit={` ${b.unit}`} lines={[
                    { k: 'Old', name: 'Old way', color: C.old },
                    { k: 'DemandPilot', name: 'DemandPilot', color: C.forecast },
                    { k: 'Use', name: 'Weekly use', color: C.warning, dash: true },
                  ]} />
                </Chart>
              </div>
              <Panel className="lg:col-span-2" title="Reorder level each week" pad={false}>
                <div className="overflow-auto pad" style={{ maxHeight: 260 }}>
                  <table className="w-full border-collapse text-2xs">
                    <thead><tr><th className="th">Wk</th><th className="th text-right">Use</th>
                      <th className="th text-right">Old level</th><th className="th text-right">New level</th><th className="th text-right">Left</th></tr></thead>
                    <tbody>
                      {b.weeks.map((w, i) => (
                        <tr key={w.week}>
                          <td className="td num">{wkLabel(ds, w.week)}</td>
                          <td className="td text-right num">{fmtNum(w.demand, 1)}</td>
                          <td className="td text-right num text-muted">{fmtNum(w.reorderLevel, 0)}</td>
                          <td className="td text-right num font-semibold">{fmtNum(a.weeks[i].reorderLevel, 0)}</td>
                          <td className={`td text-right num ${a.weeks[i].stockout ? 'text-danger font-bold' : ''}`}>
                            {a.weeks[i].stockout ? 'OUT' : fmtNum(a.weeks[i].onHandEnd, 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-2xs text-muted px-3.5 pb-3">The old level never changes. The new one moves every week.</p>
              </Panel>
            </div>
          )}
        </>
      )}

      {tab === 'why' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel title="The old way">
            <div className="space-y-2">
              {[['Forecast', '13-week average — a step change takes ~5 weeks to show'],
                ['Reorder level', 'Fixed minimum, never revisited'],
                ['Timing', 'Triggered below that minimum — too late on a 6-week lead'],
                ['Supplier', 'Always the usual one, whatever the date needs'],
                ['Upper bound', 'None. A fixed minimum has no view on holding too much']].map(([t, d], i) => (
                <div key={t} className="flex gap-2">
                  <span className="w-5 h-5 rounded bg-line text-muted grid place-items-center text-2xs font-bold num shrink-0">{i + 1}</span>
                  <div><div className="text-base font-semibold">{t}</div><p className="text-2xs text-muted">{d}</p></div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel className="border-primary/30" title="DemandPilot">
            <div className="space-y-2">
              {[['Forecast', `The model that back-tested best, carrying the step change — run here with its real ~${Math.round(FORECAST_ERROR_SD * 100)}% error, not perfect foresight`],
                ['Reorder level', 'Recalculated weekly from usage and lead-time risk'],
                ['Timing', 'Driven by the order-by date, while there is still time'],
                ['Supplier', 'Switches to a faster approved route and shows the cost'],
                ['Upper bound', `Will not order past the ${settings.excessCoverDays}-day excess target`]].map(([t, d], i) => (
                <div key={t} className="flex gap-2">
                  <span className="w-5 h-5 rounded bg-primary text-primary-fg grid place-items-center text-2xs font-bold num shrink-0">{i + 1}</span>
                  <div><div className="text-base font-semibold">{t}</div><p className="text-2xs text-muted">{d}</p></div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="lg:col-span-2" title="What both sides share">
            <p className="text-base leading-relaxed">
              Same opening stock, same deliveries already inbound, same demand, same supplier panel and the same
              order-up-to rule. Deliveries slip against each supplier's real on-time record, and a slip hits
              whichever method placed the order. Only the forecast, the reorder level, the supplier choice and the
              excess ceiling differ — which is what makes the gap between the two columns attributable to planning
              rather than to luck.
            </p>
          </Panel>

          <Panel className="lg:col-span-2" title="The five problems">
            <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-2">
              {problems.map(([id, p, s, to]) => (
                <Link key={id} to={to} className="rounded-lg border border-line bg-surface2 p-2.5 hover:border-primary/40 transition-colors">
                  <Chip tone="primary">{id}</Chip>
                  <div className="text-base font-semibold mt-1.5 leading-tight">{p}</div>
                  <p className="text-2xs text-muted mt-1">{s}</p>
                  <span className="text-2xs text-primary inline-flex items-center gap-0.5 mt-1">Open <ChevronRight className="w-2.5 h-2.5" /></span>
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </>
  )
}
