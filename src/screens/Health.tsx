/**
 * Health — the landing screen, and the only one that has to answer "what do I
 * do today" before anything is clicked.
 *
 * It used to be six tiles, two charts and a list: every number true, but none
 * of them saying anything. The lead panel now states the position in a sentence
 * and names the one item to start with, and the tabs carry the three questions
 * that follow from it — what is coming, where the money is, and whether any of
 * this beats the old way.
 *
 * Nothing here computes its own figures. `weekBrief`, `stockLadder`,
 * `cashPosition` and `scorecard` all derive from the same `PlanningResult` and
 * the same exception list the sidebar badge reads, which is why the rail, the
 * tiles and the destination screens cannot disagree.
 */
import React, { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ChevronRight, Radio, TrendingUp, Factory, Boxes, ShoppingCart, FileText,
  ArrowRight, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Head, Tile, Tiles, Panel, Chip, Status, Dot, Bar, Fact, Tabs, Empty } from '@/ui/kit'
import { Chart, Lines, Bars, useC } from '@/ui/charts'
import { fmtINR, fmtINRShort, fmtPct, fmtNum, fmtDue, fmtT } from '@/lib/format'
import {
  selectExceptions, selectOpenOrders, selectDecidedRecIds, selectOpenRecommendationCount,
} from '@/engine/selectors'
import {
  weekBrief, stockLadder, coverBands, cashPosition, scorecard, rankQueue,
} from '@/engine/briefing'
import { demandOutlook } from '@/engine/insights'
import { wkLabel } from '@/lib/view'

type TabId = 'today' | 'demand' | 'cash' | 'proof'

/** The demand-signal-to-purchase-order chain, as a clickable rail. */
function Chain() {
  const { result, ds, approvals, rejected, dismissed } = useStore()
  const r = result!, k = r.kpis
  // Same selectors the destination pages use, so a count on the rail always
  // matches the count on the page it links to.
  const decided = selectDecidedRecIds(approvals, rejected)
  const openOrders = selectOpenOrders(ds, r, approvals).length
  const openRecs = selectOpenRecommendationCount(r, approvals, rejected)
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
  const [tab, setTab] = useState<TabId>('today')

  const queue = useMemo(
    () => selectExceptions(r, dismissed, selectDecidedRecIds(approvals, rejected)),
    [r, dismissed, approvals, rejected])

  const brief = useMemo(() => weekBrief(ds, r, queue), [ds, r, queue])
  const ladder = useMemo(() => stockLadder(r), [r])
  const bands = useMemo(() => coverBands(r), [r])
  const cash = useMemo(() => cashPosition(ds, r), [ds, r])
  const score = useMemo(() => scorecard(r), [r])
  const outlook = useMemo(() => demandOutlook(ds, r), [ds, r])

  const movers = useMemo(
    () => [...outlook].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 6),
    [outlook])

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

  const health = useMemo(() => ladder.map(x => ({ label: x.status, n: x.count })), [ladder])

  // Same ranking Exceptions uses, so the two screens agree on what comes first.
  const top = useMemo(() => rankQueue(queue).slice(0, 7), [queue])

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
          sub={`${k.openAnomalySeries} series behind them`} tone={k.highAnomalies ? 'warning' : 'success'} />
        <Tile k="Needs a person" v={fmtNum(brief.overdueToday)} onClick={() => setTab('today')}
          sub={`${brief.overdue} overdue of ${queue.length} waiting`}
          tone={brief.overdue ? 'danger' : brief.overdueToday ? 'warning' : 'success'} />
        <Tile k="Stock value" v={fmtINR(k.inventoryValueINR)} onClick={() => setTab('cash')}
          sub={`${k.daysOfInventory.toFixed(0)} days of cover`} />
        <Tile k="Excess" v={fmtINR(k.excessValueINR)} onClick={() => setTab('cash')}
          sub={`${k.excessCount} materials · releasable`} tone={k.excessCount ? 'warning' : 'success'} />
        <Tile k="Service" v={fmtPct(k.serviceLevelPct, 1)} onClick={() => setTab('proof')}
          sub="demand met, by value" tone={k.serviceLevelPct >= 99 ? 'success' : 'warning'} />
      </Tiles>

      {/* ---- the week in a sentence ---------------------------------- */}
      <Panel className="mt-2.5" title="This week, in one line"
        right={brief.firstToDo && (
          <button className="btn btn-primary btn-sm" onClick={() => nav(brief.firstToDo!.linkId)}>
            Open {brief.firstToDo.subject} <ArrowRight className="w-3 h-3" />
          </button>
        )}>
        <p className="text-base leading-relaxed">{brief.headline}</p>
        <p className="text-base leading-relaxed mt-1.5">
          <span className="font-semibold">{brief.verdict}</span>
        </p>
        <div className="grid sm:grid-cols-3 gap-2 mt-2.5">
          {brief.facts.map(f => <Fact key={f.k} k={f.k} v={f.v} sub={f.sub} />)}
        </div>
      </Panel>

      <div className="mt-2.5"><Chain /></div>

      <div className="mt-3">
        <Tabs active={tab} onChange={id => setTab(id as TabId)} tabs={[
          { id: 'today', label: 'Today', n: queue.length },
          { id: 'demand', label: 'Demand ahead' },
          { id: 'cash', label: 'Cash & cover' },
          { id: 'proof', label: 'Vs the old way' },
        ]} />
      </div>

      {/* ---------------- Today ---------------- */}
      {tab === 'today' && (
        <>
          <Panel pad={false}>
            <div className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2">
              <h3 className="h2">Needs a decision</h3>
              <Link to="/exceptions" className="btn btn-ghost btn-xs">All {queue.length} <ChevronRight className="w-3 h-3" /></Link>
            </div>
            {top.length === 0 ? (
              <div className="pb-3"><Empty title="Queue clear" hint="Nothing is waiting on a decision today." /></div>
            ) : (
              <div className="divide-y divide-line/70">
                {top.map(w => (
                  <button key={w.id} onClick={() => nav(w.linkId)}
                    className="w-full text-left px-3.5 py-2 hover:bg-primary-soft/40 transition-colors flex items-center gap-2.5">
                    <Status v={w.severity} />
                    <span className="hidden sm:inline-flex"><Chip tone="neutral">{w.queue}</Chip></span>
                    <span className="text-base font-medium truncate flex-1 min-w-0 sm:min-w-[160px]">{w.title}</span>
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
            )}
          </Panel>

          <div className="grid gap-3 lg:grid-cols-3 mt-3">
            <div className="lg:col-span-2">
              <Chart title="Demand by region" h={210}
                right={<Chip tone="neutral">10 wk actual · 6 wk forecast</Chip>}>
                <Lines data={regionTrend} x="label" unit=" t"
                  lines={ds.regions.map((g, i) => ({ k: g.id, name: g.name, color: C.series[i] }))} />
              </Chart>
            </div>
            <Chart title="Stock health" h={210}
              note="One bar per material status. Click through to Stock for the per-material position.">
              <Bars data={health} x="label" bars={[{ k: 'n', name: 'Materials' }]} />
            </Chart>
          </div>
        </>
      )}

      {/* ---------------- Demand ahead ---------------- */}
      {tab === 'demand' && (
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Chart title="Demand by region" h={240}
              right={<Chip tone="neutral">10 wk actual · 6 wk forecast</Chip>}
              note="The forecast continues the actual line rather than restarting it, so a step change is visible where it happens.">
              <Lines data={regionTrend} x="label" unit=" t"
                lines={ds.regions.map((g, i) => ({ k: g.id, name: g.name, color: C.series[i] }))} />
            </Chart>
          </div>
          <Panel title="Biggest moves ahead"
            note="Next 8 weeks of forecast against the last 8 weeks of actual sales, by grade and region.">
            <div className="space-y-1">
              {movers.map(m => {
                const up = m.changePct > 0
                return (
                  <Link key={`${m.grade}-${m.region}`} to={`/forecast?g=${m.grade}`}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface2 transition-colors">
                    {up ? <ArrowUpRight className="w-3.5 h-3.5 text-success shrink-0" />
                        : <ArrowDownRight className="w-3.5 h-3.5 text-danger shrink-0" />}
                    <span className="text-base font-medium truncate flex-1">{m.grade} · {m.region}</span>
                    <span className={`num text-base font-semibold ${up ? 'text-success' : 'text-danger'}`}>
                      {up ? '+' : ''}{m.changePct.toFixed(0)}%
                    </span>
                    <span className="num text-2xs text-muted w-16 text-right">{fmtT(m.nextT)}</span>
                  </Link>
                )
              })}
            </div>
            <p className="text-2xs text-muted mt-2 pt-2 border-t border-line">
              A move here is a forecast, not an anomaly — it is what the models expect, before anything
              has gone wrong. <Link to="/anomalies" className="link">Anomalies</Link> covers what already has.
            </p>
          </Panel>
        </div>
      )}

      {/* ---------------- Cash & cover ---------------- */}
      {tab === 'cash' && (
        <>
          <div className="grid gap-3 lg:grid-cols-3">
            <Panel className="lg:col-span-2" title="Where the stock value sits"
              note="Share is of total stock value, not of the material count — one imported alloy can outweigh thirty consumables.">
              <div className="space-y-2">
                {ladder.map(x => (
                  <div key={x.status}>
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <Status v={x.status} />
                        <span className="text-2xs text-muted truncate">
                          {x.count} material{x.count === 1 ? '' : 's'} · worst {x.items[0]?.name}
                        </span>
                      </span>
                      <span className="num text-base font-semibold shrink-0">
                        {fmtINR(x.valueINR)} <span className="text-2xs text-muted font-normal">{x.sharePct}%</span>
                      </span>
                    </div>
                    <Bar pct={x.sharePct}
                      tone={x.status === 'Stockout risk' ? 'danger' : x.status === 'Reorder now' ? 'warning'
                        : x.status === 'Excess' ? 'info' : 'success'} />
                  </div>
                ))}
              </div>
            </Panel>
            <Chart title="Materials by days of cover" h={210}
              note="The left-hand bars are the ones that can stop a line; the right-hand ones are cash sitting still.">
              <Bars data={bands} x="name" bars={[{ k: 'n', name: 'Materials', color: C.primary }]} />
            </Chart>
          </div>

          <div className="grid gap-3 lg:grid-cols-2 mt-3">
            <Panel title={`To spend — ${fmtINRShort(cash.spendINR)}`}
              right={<Link to="/buy" className="btn btn-ghost btn-xs">Buy <ChevronRight className="w-3 h-3" /></Link>}
              note="Nothing here has been ordered. These are recommendations waiting on a person.">
              {cash.buys.length === 0 ? <Empty title="Nothing to buy" /> : (
                <div className="space-y-1">
                  {cash.buys.map(b => (
                    <Link key={b.name} to={b.linkId}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface2 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="text-base font-medium truncate">{b.name}</div>
                        <div className="text-2xs text-muted truncate">{b.note}</div>
                      </div>
                      <span className="num text-base font-semibold shrink-0">{fmtINRShort(b.valueINR)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>
            <Panel title={`To release — ${fmtINRShort(cash.releaseINR)}`}
              right={<Link to="/stock" className="btn btn-ghost btn-xs">Stock <ChevronRight className="w-3 h-3" /></Link>}
              note={cash.netINR >= 0
                ? `Releasing the overstock more than covers the buying: ${fmtINRShort(cash.netINR)} net back.`
                : `Releasing the overstock covers part of the buying; ${fmtINRShort(Math.abs(cash.netINR))} is still needed.`}>
              {cash.releases.length === 0 ? <Empty title="Nothing overstocked" /> : (
                <div className="space-y-1">
                  {cash.releases.map(b => (
                    <Link key={b.name} to={b.linkId}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface2 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="text-base font-medium truncate">{b.name}</div>
                        <div className="text-2xs text-muted truncate">{b.note}</div>
                      </div>
                      <span className="num text-base font-semibold text-success shrink-0">{fmtINRShort(b.valueINR)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </>
      )}

      {/* ---------------- Vs the old way ---------------- */}
      {tab === 'proof' && (
        <div className="grid gap-3 lg:grid-cols-3">
          <Panel className="lg:col-span-2" title="The same 16 weeks, planned two ways"
            right={<Link to="/proof" className="btn btn-outline btn-sm">Full proof <ChevronRight className="w-3 h-3" /></Link>}
            pad={false}>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Measure</th>
                  <th className="th text-right">Spreadsheet</th>
                  <th className="th text-right">DemandPilot</th>
                </tr>
              </thead>
              <tbody>
                {score.rows.map(row => (
                  <tr key={row.k} className="tr">
                    <td className="td">{row.k}</td>
                    <td className={`td num text-right ${row.better === 'before' ? 'font-semibold' : 'text-muted'}`}>{row.before}</td>
                    <td className={`td num text-right ${row.better === 'after' ? 'font-semibold text-success' : 'text-warning'}`}>{row.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="The trade">
            <p className="text-base leading-relaxed">{score.trade}</p>
            <div className="grid grid-cols-2 gap-2 mt-2.5">
              <Fact k="Return on the extra stock" v={score.ratio ? `${score.ratio}×` : '—'}
                sub="production protected ÷ extra holding cost" />
              <Fact k="Signal to order" v={`${r.replay.after.signalToOrderDays} days`}
                sub={`was ${r.replay.before.signalToOrderDays} days`} />
            </div>
            <p className="text-2xs text-muted mt-2 pt-2 border-t border-line">
              Both columns come from one engine run over the same 16 weeks of real demand — the
              difference is the planning method, not the data.
            </p>
          </Panel>
        </div>
      )}
    </>
  )
}
