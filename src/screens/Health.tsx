import React, { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Radio, TrendingUp, Factory, Boxes, ShoppingCart, FileText } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Head, Tile, Tiles, Panel, Chip, Status, Dot, Bar } from '@/ui/kit'
import { Chart, Lines, Bars, useC } from '@/ui/charts'
import { fmtINR, fmtPct, fmtNum, fmtDue } from '@/lib/format'
import { selectExceptions, selectOpenOrders, selectDecidedRecIds, selectOpenRecommendationCount } from '@/engine/selectors'
import { wkLabel } from '@/lib/view'

/** The demand-signal-to-purchase-order chain, as a clickable rail. */
function Chain() {
  const { result, ds, approvals, rejected, dismissed } = useStore()
  const r = result!, k = r.kpis
  // Same selectors the destination pages use, so a count on the rail always
  // matches the count on the page it links to.
  const decided = selectDecidedRecIds(approvals, rejected)
  const openOrders = selectOpenOrders(ds, r, approvals).length
  const openRecs = selectOpenRecommendationCount(r, approvals, rejected)
  const exceptions = selectExceptions(r, dismissed, decided).length
  const steps = [
    { to: '/signals', icon: Radio, label: 'Signals', v: `${ds.signals.filter(s => !s.read).length}`, sub: 'new', tone: 'info' as const },
    { to: '/forecast', icon: TrendingUp, label: 'Forecast', v: fmtPct(k.forecastAccuracyPct, 1), sub: 'accurate', tone: k.forecastAccuracyPct >= 85 ? 'success' as const : 'warning' as const },
    { to: '/plan', icon: Factory, label: 'Plan', v: `${r.mrp.plannedOrders.length}`, sub: 'planned orders', tone: 'neutral' as const },
    { to: '/stock', icon: Boxes, label: 'Stock', v: `${k.materialsAtRisk}`, sub: 'at risk', tone: k.materialsAtRisk ? 'danger' as const : 'success' as const },
    { to: '/buy', icon: ShoppingCart, label: 'Buy', v: `${openRecs}`, sub: 'to approve', tone: openRecs ? 'warning' as const : 'success' as const },
    { to: '/orders', icon: FileText, label: 'Orders', v: `${openOrders}`, sub: 'open', tone: 'neutral' as const },
  ]
  return (
    <div className="flex items-stretch gap-1 overflow-x-auto no-scrollbar pb-0.5">
      {steps.map((s, i) => {
        const Icon = s.icon
        return (
          <React.Fragment key={s.label}>
            <Link to={s.to} className="card pad flex-1 min-w-[118px] hover:border-primary/40 hover:shadow-md transition-all group">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className="w-3 h-3 text-muted group-hover:text-primary transition-colors" />
                <span className="eyebrow">{s.label}</span>
              </div>
              <div className="num text-lg font-bold leading-none">{s.v}</div>
              <div className="flex items-center gap-1 mt-1">
                <Dot tone={s.tone} /><span className="text-2xs text-muted truncate">{s.sub}</span>
              </div>
            </Link>
            {i < steps.length - 1 && <div className="grid place-items-center shrink-0"><ChevronRight className="w-3 h-3 text-muted/40" /></div>}
          </React.Fragment>
        )
      })}
    </div>
  )
}

export default function Health() {
  const C = useC()
  const { result, ds, dismissed, approvals, rejected } = useStore()
  const nav = useNavigate()
  const r = result!, k = r.kpis
  const queue = useMemo(
    () => selectExceptions(r, dismissed, selectDecidedRecIds(approvals, rejected)),
    [r, dismissed, approvals, rejected])

  const regionTrend = useMemo(() => {
    const out: any[] = []
    for (let i = r.todayWeek - 10; i < r.todayWeek; i++) {
      const row: any = { label: wkLabel(ds, i) }
      for (const g of ds.regions) {
        let t = 0
        for (const d of ds.demand) if (d.region === g.id) t += d.weeks[i] ?? 0
        row[g.id] = Math.round(t)
      }
      out.push(row)
    }
    for (let i = 0; i < 6; i++) {
      const row: any = { label: wkLabel(ds, r.todayWeek + i) }
      for (const g of ds.regions) row[g.id] = Math.round(r.forecastByRegion[g.id][i])
      out.push(row)
    }
    return out
  }, [r, ds])

  const health = useMemo(() => {
    const b: Record<string, number> = { Healthy: 0, 'Reorder now': 0, 'Stockout risk': 0, Excess: 0 }
    for (const m of r.materials) b[m.inv.status]++
    return Object.entries(b).map(([label, n]) => ({ label, n }))
  }, [r])

  const top = queue.slice(0, 7)

  return (
    <>
      <Head
        title="Health"
        blurb={`${k.skusCovered} products · ${ds.materials.length} materials · ${k.regionsCovered} regions`}
        chips={<Chip tone={k.materialsAtRisk ? 'danger' : 'success'}>
          <Dot tone={k.materialsAtRisk ? 'danger' : 'success'} />{k.materialsAtRisk} at risk
        </Chip>}
      />

      <Tiles>
        <Tile k="Accuracy" v={fmtPct(k.forecastAccuracyPct, 1)} to="/forecast?tab=accuracy"
          delta={+(k.forecastAccuracyPct - k.spreadsheetAccuracyPct).toFixed(1)} deltaGood="up"
          sub={`vs ${fmtPct(k.spreadsheetAccuracyPct, 0)} old`} tone={k.forecastAccuracyPct >= 85 ? 'success' : 'warning'} />
        <Tile k="Anomalies" v={fmtNum(k.openAnomalies)} to="/anomalies"
          sub={`${k.highAnomalies} high`} tone={k.highAnomalies ? 'warning' : 'success'} />
        <Tile k="Stockout risk" v={fmtNum(k.stockoutRiskCount)} to="/stock"
          sub={`${k.reorderNowCount} at reorder`} tone={k.stockoutRiskCount ? 'danger' : 'success'} />
        <Tile k="Stock value" v={fmtINR(k.inventoryValueINR)} to="/simulate"
          sub={`${k.daysOfInventory.toFixed(0)} days`} />
        <Tile k="Excess" v={fmtINR(k.excessValueINR)} to="/stock"
          sub={`${k.excessCount} materials`} tone={k.excessCount ? 'warning' : 'success'} />
        <Tile k="Service" v={fmtPct(k.serviceLevelPct, 1)} to="/proof"
          sub="demand met" tone={k.serviceLevelPct >= 99 ? 'success' : 'warning'} />
      </Tiles>

      <div className="mt-3"><Chain /></div>

      <div className="grid gap-3 lg:grid-cols-3 mt-3">
        <div className="lg:col-span-2">
          <Chart title="Demand by region" h={210}
            right={<Chip tone="neutral">10 wk actual · 6 wk forecast</Chip>}>
            <Lines data={regionTrend} x="label" unit=" t"
              lines={ds.regions.map((g, i) => ({ k: g.id, name: g.name, color: C.series[i] }))} />
          </Chart>
        </div>
        <Chart title="Stock health" h={210}>
          <Bars data={health} x="label" bars={[{ k: 'n', name: 'Materials' }]} />
        </Chart>
      </div>

      <Panel className="mt-3" pad={false}>
        <div className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2">
          <h3 className="h2">Needs a decision</h3>
          <Link to="/exceptions" className="btn btn-ghost btn-xs">All {queue.length} <ChevronRight className="w-3 h-3" /></Link>
        </div>
        <div className="divide-y divide-line/70">
          {top.map(w => (
            <button key={w.id} onClick={() => nav(w.linkId)}
              className="w-full text-left px-3.5 py-2 hover:bg-primary-soft/40 transition-colors flex items-center gap-2.5">
              <Status v={w.severity} />
              <Chip tone="neutral">{w.queue}</Chip>
              <span className="text-base font-medium truncate flex-1 min-w-[160px]">{w.title}</span>
              <div className="hidden lg:block w-24"><Bar pct={w.confidence} tone={w.confidence >= 80 ? 'success' : 'warning'} /></div>
              <span className="num text-2xs text-muted w-14 text-right">
                {w.dueInDays <= 0
                  ? <span className="text-danger font-bold">{fmtDue(w.dueInDays)}</span>
                  : fmtDue(w.dueInDays)}
              </span>
              <ChevronRight className="w-3 h-3 text-muted/50 shrink-0" />
            </button>
          ))}
        </div>
      </Panel>
    </>
  )
}
