import React, { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Play, Check, Loader2, Search } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Head, Tile, Tiles, Panel, Chip, Status, Tabs, LV, LVRow, Why, Empty } from '@/ui/kit'
import { Chart, CapacityChart, Bars, Donut, Timeline, useC, type TimelinePoint } from '@/ui/charts'
import { Table, type Col } from '@/ui/Table'
import { fmtT, fmtNum, fmtINR, fmtPct, fmtQty, fmtRecipeQty } from '@/lib/format'
import { selectLateCount, selectLatePlannedOrderCount } from '@/engine/selectors'
import { recipeCostPerT } from '@/data/generate'
import { CONVERSION_COST_PER_T } from '@/data/catalog'
import { wkLabel, wkFull } from '@/lib/view'
import type { Grade, Form } from '@/data/types'

/** One line of a product recipe, flattened for the table. */
interface RecipeRow {
  materialId: string
  code: string
  name: string
  category: string
  unit: string
  qtyPerTonne: number
  scrapPct: number
  withScrap: number
  costPerT: number
  status: string
  cover: number
}

/** A planned order with the material details the table needs. */
interface OrderRow {
  id: string
  materialId: string
  code: string
  name: string
  unit: string
  category: string
  qty: number
  valueINR: number
  needWeek: number
  releaseWeek: number
  late: boolean
}

export default function Plan() {
  const C = useC()
  const { result, ds, toast } = useStore()
  const r = result!
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const [tab, setTab] = useState(sp.get('tab') ?? 'capacity')
  const [step, setStep] = useState(-1)
  const [running, setRunning] = useState(false)

  const cap = useMemo(() => r.mrp.production.slice(0, 14).map(p => ({
    label: wkLabel(ds, p.week), planned: p.plannedT, over: p.shortfallT, capacity: p.capacityT,
  })), [r.mrp, ds])

  /** Planned shutdowns inside the window the chart draws. */
  const maintenance = useMemo(() => r.mrp.production.slice(0, 14)
    .filter(p => p.maintenanceLines.length)
    .map(p => ({
      week: p.week, label: wkLabel(ds, p.week),
      lines: p.maintenanceLines, binds: p.maintenanceBinds,
    })), [r.mrp, ds])

  /** Markers for the capacity chart: only the binding one gets a label. */
  const capMaintenance = useMemo(() => maintenance.map(m => ({
    label: m.label, line: m.lines[0], binds: m.binds,
  })), [maintenance])

  /**
   * The shutdown schedule as a timeline: a row per line, a dot on each week it
   * is down, sized by whether that actually costs the plant any output.
   */
  const maintPoints: TimelinePoint[] = useMemo(() => maintenance.flatMap(m =>
    m.lines.map(line => ({
      id: `${line}-${m.week}`,
      x: m.week,
      kind: line,
      size: m.binds ? 3 : 1,
      title: `${line} down — ${m.binds ? 'cuts finished output' : 'covered by slack'}`,
      when: `w/c ${m.label}`,
    }))), [maintenance])

  const maintKinds = useMemo(() => {
    const seen = [...new Set(maintPoints.map(x => x.kind))]
    return seen.map(k => ({
      k,
      // Amber where the shutdown bites, grey where the plant absorbs it.
      color: maintPoints.some(x => x.kind === k && x.size > 1) ? C.warning : C.muted,
    }))
  }, [maintPoints, C])

  /**
   * Load on each line over the next eight weeks, against its own capacity.
   *
   * Every tonne passes through several lines in sequence, so these add up to
   * roughly four times the plant's output — which is the point. The line with
   * the least headroom is what the plant is actually waiting on.
   */
  const lines = useMemo(() => ds.lines.map(l => {
    const load = r.mrp.production.slice(0, 8).reduce((s, p) => s + (p.byLine[l.id] ?? 0), 0)
    const limits = r.mrp.production.filter(p => p.limitingLine === l.process).length
    return {
      id: l.id,
      label: l.process,
      process: l.process,
      capacityT: l.weeklyCapacityT,
      shifts: l.shifts,
      pct: +((load / (l.weeklyCapacityT * 8)) * 100).toFixed(0),
      limitsWeeks: limits,
    }
  }), [r.mrp, ds])

  /** The process that caps output most often across the horizon. */
  const bottleneckLine = useMemo(
    () => [...lines].sort((a, b) => b.limitsWeeks - a.limitsWeeks)[0], [lines])

  const run = () => {
    if (running) return            // a second click must not start a second run
    setRunning(true); setStep(0)
    const t = setInterval(() => setStep(s => {
      if (s >= r.mrp.steps.length - 1) {
        clearInterval(t); setRunning(false)
        // The plan is recalculated continuously; this walks through what it did
        // rather than creating anything, so the wording says so.
        toast(`MRP complete — ${r.mrp.plannedOrders.length} planned orders in the current plan.`, 'good')
        return s
      }
      return s + 1
    }), 420)
  }

  // -------------------------------------------------------------------------
  // Recipe
  // -------------------------------------------------------------------------
  const [grade, setGrade] = useState<Grade | 'All'>('316L')
  const [form, setForm] = useState<Form | 'All'>('All')
  const [skuQuery, setSkuQuery] = useState('')

  /**
   * The product picker was a native select holding all 240 codes, which is not
   * a control anyone can find anything in. Grade and form narrow it, and the
   * box filters what is left by code.
   */
  const skuChoices = useMemo(() => ds.skus.filter(s =>
    (grade === 'All' || s.grade === grade) &&
    (form === 'All' || s.form === form) &&
    (!skuQuery.trim() || s.code.toLowerCase().includes(skuQuery.toLowerCase()))
  ), [ds.skus, grade, form, skuQuery])

  const [bom, setBom] = useState(() =>
    ds.skus.find(s => s.grade === '316L' && s.form === 'Cold-rolled coil')?.id ?? ds.skus[0].id)
  const [pickerOpen, setPickerOpen] = useState(false)

  // Keep the selection inside the filtered list.
  const bomSku = ds.skus.find(s => s.id === bom) ?? ds.skus[0]
  const selected = skuChoices.some(s => s.id === bom) ? bom : (skuChoices[0]?.id ?? bom)
  const shownSku = ds.skus.find(s => s.id === selected) ?? bomSku

  const recipe: RecipeRow[] = useMemo(() => (ds.bom[shownSku.id] ?? []).map(b => {
    const m = ds.materials.find(x => x.id === b.materialId)!
    const mv = r.materials.find(x => x.materialId === b.materialId)
    const withScrap = b.qtyPerTonne * (1 + b.scrapPct / 100)
    return {
      materialId: b.materialId, code: m.code, name: m.name, category: m.category, unit: m.unit,
      qtyPerTonne: b.qtyPerTonne, scrapPct: b.scrapPct, withScrap,
      costPerT: withScrap * m.costPerUnit,
      status: mv?.inv.status ?? 'Healthy',
      cover: mv?.inv.daysOfCover ?? 0,
    }
  }), [ds, shownSku, r.materials])

  const metalCost = useMemo(() => recipeCostPerT(ds.bom[shownSku.id] ?? []), [ds, shownSku])
  const conversion = CONVERSION_COST_PER_T[shownSku.form]

  /**
   * Where the money in a tonne goes, by material category.
   *
   * Thirty-five rows sorted by cost tell you the biggest line; this tells you
   * the shape — that nearly three quarters of a 316L tonne is base metal before
   * any alloy is added.
   */
  const byCategory = useMemo(() => {
    const m = new Map<string, number>()
    for (const row of recipe) m.set(row.category, (m.get(row.category) ?? 0) + row.costPerT)
    return [...m.entries()]
      .map(([name, value]) => ({ name, value: Math.round(value), share: value / Math.max(1, metalCost) }))
      .sort((a, b) => b.value - a.value)
  }, [recipe, metalCost])

  /** Scrap is 4% on the acids and rolling oil, 2% elsewhere — so the column stays. */
  const scrapRates = useMemo(() => [...new Set(recipe.map(x => x.scrapPct))].sort(), [recipe])

  /**
   * "0.00004 nos" is a true number and a useless one. For countable items that
   * go less than one per tonne, the rate is what a planner thinks in: one
   * backup roll per 25,000 tonnes.
   */
  const qtyLabel = (x: RecipeRow) => {
    if (x.unit === 'nos' && x.withScrap > 0 && x.withScrap < 1) {
      return `1 per ${fmtNum(Math.round(1 / x.withScrap))} t`
    }
    return `${fmtRecipeQty(x.withScrap)} ${x.unit}`
  }

  const recipeCols: Col<RecipeRow>[] = [
    { key: 'c', h: 'Material', w: '190px', cell: x => (
      <div><div className="font-mono text-sm font-semibold">{x.code}</div>
        <div className="text-2xs text-muted truncate">{x.name}</div></div>
    ), val: x => `${x.code} ${x.name}` },
    { key: 'cat', h: 'Category', cell: x => <Chip tone="neutral">{x.category}</Chip>, val: x => x.category },
    { key: 'q', h: 'Per tonne', right: true, w: '120px',
      cell: x => <span className="whitespace-nowrap">{qtyLabel(x)}</span>, val: x => x.withScrap },
    { key: 's', h: 'Scrap', right: true, cell: x => `${x.scrapPct}%`, val: x => x.scrapPct,
      // Only worth a column while the rates actually differ.
      hide: scrapRates.length < 2 },
    { key: 'v', h: 'Cost / t', right: true, cell: x => <span className="whitespace-nowrap">{fmtINR(x.costPerT)}</span>, val: x => x.costPerT },
    { key: 'sh', h: 'Share', right: true, cell: x => fmtPct((x.costPerT / Math.max(1, metalCost)) * 100, 1), val: x => x.costPerT / Math.max(1, metalCost) },
    { key: 'st', h: 'Stock', cell: x => <Status v={x.status} />, val: x => x.status },
  ]

  // -------------------------------------------------------------------------
  // MRP grid
  // -------------------------------------------------------------------------
  const [gridQuery, setGridQuery] = useState('')
  const [gridCat, setGridCat] = useState('All')
  const [gridWeeks, setGridWeeks] = useState(10)
  const [gridFrom, setGridFrom] = useState(0)
  const [onlyTrouble, setOnlyTrouble] = useState(false)

  const categories = useMemo(() => [...new Set(ds.materials.map(m => m.category))].sort(), [ds.materials])

  const gridRows = useMemo(() => r.mrp.rows.filter(row => {
    const m = ds.materials.find(x => x.id === row.materialId)
    if (gridCat !== 'All' && m?.category !== gridCat) return false
    if (onlyTrouble && row.firstBreachWeek === null && row.firstStockoutWeek === null) return false
    const q = gridQuery.trim().toLowerCase()
    return !q || `${row.code} ${row.name}`.toLowerCase().includes(q)
  }), [r.mrp.rows, ds.materials, gridCat, gridQuery, onlyTrouble])

  const weeks = r.mrp.rows[0]?.cells.slice(gridFrom, gridFrom + gridWeeks) ?? []
  /** Materials whose projection dips under the safety level at some point. */
  const troubleCount = r.mrp.rows.filter(x => x.firstBreachWeek !== null || x.firstStockoutWeek !== null).length
  const startOnHand = (id: string) => r.materials.find(m => m.materialId === id)?.onHand ?? 0

  // -------------------------------------------------------------------------
  // Planned orders
  // -------------------------------------------------------------------------
  const orderRows: OrderRow[] = useMemo(() => r.mrp.plannedOrders.map(p => {
    const m = ds.materials.find(x => x.id === p.materialId)!
    return {
      id: p.id, materialId: p.materialId, code: m.code, name: m.name,
      unit: m.unit, category: m.category,
      qty: p.qty, valueINR: p.qty * m.costPerUnit,
      needWeek: p.needWeek, releaseWeek: p.releaseWeek, late: p.late,
    }
  }), [r.mrp.plannedOrders, ds.materials])

  const [orderLate, setOrderLate] = useState('All')
  const [orderCat, setOrderCat] = useState('All')
  const [orderWindow, setOrderWindow] = useState(0)   // 0 = every week
  const shownOrders = useMemo(() => orderRows.filter(o =>
    (orderLate === 'All' || (orderLate === 'Late' ? o.late : !o.late)) &&
    (orderCat === 'All' || o.category === orderCat) &&
    (orderWindow === 0 || o.releaseWeek <= r.todayWeek + orderWindow)
  ), [orderRows, orderLate, orderCat, orderWindow, r.todayWeek])

  const orderCols: Col<OrderRow>[] = [
    { key: 'c', h: 'Material', w: '190px', cell: o => (
      <div><div className="font-mono text-sm font-semibold">{o.code}</div>
        <div className="text-2xs text-muted truncate">{o.name}</div></div>
    ), val: o => `${o.code} ${o.name}` },
    { key: 'cat', h: 'Category', cell: o => <Chip tone="neutral">{o.category}</Chip>, val: o => o.category },
    { key: 'q', h: 'Qty', right: true, cell: o => fmtQty(o.qty, o.unit), val: o => o.qty },
    { key: 'v', h: 'Value', right: true, cell: o => fmtINR(o.valueINR), val: o => o.valueINR },
    { key: 'n', h: 'Needed', cell: o => wkFull(ds, o.needWeek), val: o => o.needWeek },
    { key: 'r', h: 'Place by', term: 'Order by', cell: o => (
      <span className={o.late ? 'text-danger font-semibold' : ''}>{wkFull(ds, o.releaseWeek)}</span>
    ), val: o => o.releaseWeek },
    { key: 's', h: 'Status', cell: o => o.late
      ? <Chip tone="danger">late</Chip> : <Chip tone="success">on time</Chip>, val: o => o.late ? 1 : 0 },
  ]

  const setTabUrl = (id: string) => {
    setTab(id)
    setSp(p => { id === 'capacity' ? p.delete('tab') : p.set('tab', id); return p }, { replace: true })
  }

  return (
    <>
      <Head title="Plan & MRP" blurb={`${r.horizon}-week plan across ${ds.lines.length} lines and ${ds.materials.length} materials`}
        actions={<button className="btn btn-primary btn-sm" onClick={run} disabled={running}>
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Run MRP</button>} />

      <Tiles>
        <Tile k="Planned orders" v={fmtNum(r.mrp.plannedOrders.length)} term="Planned order"
          onClick={() => setTabUrl('orders')} />
        <Tile k="Materials late" v={fmtNum(selectLateCount(r))} to="/buy"
          sub={`${fmtNum(selectLatePlannedOrderCount(r))} order lines`}
          tone={selectLateCount(r) ? 'danger' : 'success'} />
        <Tile k="Over capacity" v={fmtNum(r.kpis.capacityConstrainedWeeks)} unit="wk"
          onClick={() => setTabUrl('capacity')}
          tone={r.kpis.capacityConstrainedWeeks ? 'warning' : 'success'} />
        <Tile k="Plan volume" v={fmtT(r.mrp.production.reduce((s, p) => s + p.plannedT, 0))} />
        <Tile k="Planned spend" v={fmtINR(r.mrp.rows.reduce((s, m) => s + m.totalPlannedValue, 0))} />
        {/* Only clickable when there is something to look at — a tile reading
            zero that opens an empty grid is a dead end, not a drill-down. */}
        <Tile k="Shortfalls in plan" v={fmtNum(troubleCount)}
          sub={troubleCount ? 'materials dip below safety' : 'plan covers every week'}
          onClick={troubleCount ? () => { setTabUrl('grid'); setOnlyTrouble(true) } : undefined}
          tone={troubleCount ? 'danger' : 'success'} />
      </Tiles>

      {step >= 0 && (
        <Panel className="mt-3 border-primary/30" title="MRP run">
          <div className="grid sm:grid-cols-5 gap-1.5">
            {r.mrp.steps.map((s, i) => (
              <div key={s.label} className={`rounded-lg border p-2 transition-all ${
                i < step ? 'border-success/40 bg-success-soft' : i === step ? 'border-primary/50 bg-primary-soft' : 'border-line opacity-45'}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <div className={`w-4 h-4 rounded grid place-items-center text-2xs font-bold num ${
                    i < step ? 'bg-success text-white' : i === step ? 'bg-primary text-primary-fg' : 'bg-line text-muted'}`}>
                    {i < step ? <Check className="w-2.5 h-2.5" /> : i === step && running ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : i + 1}
                  </div>
                  <span className="num text-2xs font-semibold ml-auto">{fmtNum(s.count)}</span>
                </div>
                <div className="text-sm font-semibold leading-tight">{s.label}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="flex justify-end mt-3 mb-2">
        <Tabs active={tab} onChange={setTabUrl} tabs={[
          { id: 'capacity', label: 'Capacity' }, { id: 'bom', label: 'Recipe' },
          { id: 'grid', label: 'MRP grid', n: gridRows.length },
          { id: 'orders', label: 'Planned orders', n: r.mrp.plannedOrders.length },
        ]} />
      </div>

      {tab === 'capacity' && (
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-3">
            <Chart title="Plan against line capacity" h={250}
              note="Red is tonnage the lines cannot take that week. The dashed line is capacity after any planned shutdown, marked ⚙ where it bites.">
              <CapacityChart data={cap} maintenance={capMaintenance} />
            </Chart>

            {/* The list of shutdowns this replaces said the same thing five
                times and never said which one mattered. As a timeline you can
                see the schedule at a glance, and the one week that cuts output
                stands out from the four the plant absorbs. */}
            {maintenance.length > 0 && (
              <Chart title="Planned maintenance" h={190}
                note="One dot per shutdown. Large amber dots cut finished output; small grey ones are covered by slack on the other lines.">
                <Timeline data={maintPoints} kinds={maintKinds}
                  fmtX={w => wkLabel(ds, w)} onPoint={() => setTab('capacity')} />
              </Chart>
            )}
          </div>

          <div className="space-y-3">
            {/* The list of lines that sat under this chart is gone. It repeated
                what the bars already say and could not fit a line's name, a
                capacity, a utilisation and two chips into the column — so every
                label truncated to "Meltin…". The one fact worth keeping, which
                line the plant is waiting on, is in the header. */}
            <Chart title="Load by line — 8 weeks" h={230}
              right={bottleneckLine && (
                <Chip tone="warning">{bottleneckLine.process} is the constraint</Chip>
              )}
              note="Each line against its own capacity. A tonne is melted, rolled, annealed and finished, so it loads several lines on its way through.">
              <Bars data={lines} x="label" unit="%" h bars={[{ k: 'pct', name: 'Utilisation' }]} />
            </Chart>
          </div>
        </div>
      )}

      {tab === 'bom' && (
        <div className="flex flex-col xl:flex-row gap-3 items-start">
          {/* Fixed width so the table beside it never has to reflow. */}
          <div className="w-full xl:w-[260px] xl:shrink-0 space-y-3">
            <Panel title="Product">
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-1.5">
                  <select className="input select-none" value={grade} onChange={e => setGrade(e.target.value as Grade | 'All')}>
                    <option value="All">All grades</option>
                    {['304', '316L', '430', '201'].map(g => <option key={g} value={g}>Grade {g}</option>)}
                  </select>
                  <select className="input select-none" value={form} onChange={e => setForm(e.target.value as Form | 'All')}>
                    <option value="All">All forms</option>
                    {(['Cold-rolled coil', 'Hot-rolled coil', 'Sheet'] as Form[]).map(f =>
                      <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>

                {/* A combobox: type to narrow, click to pick. The squashed
                    six-row listbox it replaces could show 6 of 240. */}
                <div className="relative">
                  <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                  <input className="input pl-6" placeholder="Search product code"
                    value={pickerOpen ? skuQuery : shownSku.code}
                    onFocus={() => { setPickerOpen(true); setSkuQuery('') }}
                    onBlur={() => window.setTimeout(() => setPickerOpen(false), 120)}
                    onChange={e => setSkuQuery(e.target.value)} />
                  {pickerOpen && (
                    <div className="absolute z-30 left-0 right-0 top-full mt-1 card shadow-lg max-h-60 overflow-auto py-1">
                      {skuChoices.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted">No product matches</div>
                      ) : skuChoices.slice(0, 60).map(s => (
                        <button key={s.id} type="button"
                          onMouseDown={e => { e.preventDefault(); setBom(s.id); setPickerOpen(false) }}
                          className={`w-full text-left px-3 py-1.5 text-sm font-mono hover:bg-primary-soft transition-colors ${
                            s.id === selected ? 'bg-primary-soft text-primary font-semibold' : ''}`}>
                          {s.code}
                        </button>
                      ))}
                      {skuChoices.length > 60 && (
                        <div className="px-3 py-1.5 text-2xs text-muted">
                          {skuChoices.length - 60} more — narrow by grade or form
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <p className="text-2xs text-muted">{skuChoices.length} of {ds.skus.length} products</p>
              </div>
            </Panel>

            <Panel title={shownSku.code}>
              <div className="grid grid-cols-2 gap-2">
                <LV k="Grade" v={`Grade ${shownSku.grade}`} />
                <LV k="Form" v={shownSku.form} mono={false} />
                <LV k="Thickness" v={`${shownSku.thicknessMm} mm`} />
                <LV k="Finish" v={shownSku.finish} />
              </div>
            </Panel>

            <Chart title="Where the cost goes" h={210}
              note="Share of the metal cost in one tonne.">
              <Donut data={byCategory.map(c => ({ name: c.name, value: c.value }))} fmt={v => fmtINR(v)} />
            </Chart>
          </div>

          <div className="flex-1 min-w-0 space-y-3">
            {/* What the recipe actually costs, against what the product sells
                for. Cost is the sum of the lines below plus conversion, so the
                two figures can never drift apart. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
              {[
                { k: 'Metal per tonne', v: fmtINR(metalCost), tone: '' },
                { k: 'Conversion', v: fmtINR(conversion), tone: '' },
                { k: 'Total cost / t', v: fmtINR(shownSku.costPerT), tone: '' },
                { k: 'Price / t', v: fmtINR(shownSku.pricePerT), tone: '' },
                {
                  k: 'Margin',
                  v: fmtPct((1 - shownSku.costPerT / shownSku.pricePerT) * 100, 1),
                  tone: shownSku.costPerT < shownSku.pricePerT ? 'text-success' : 'text-danger',
                },
              ].map(c => (
                <div key={c.k} className="card pad">
                  <div className="eyebrow truncate">{c.k}</div>
                  <div className={`num text-lg font-bold leading-none mt-1 whitespace-nowrap ${c.tone}`}>{c.v}</div>
                </div>
              ))}
            </div>

            <Panel title={`Per tonne — ${recipe.length} materials`} pad={false}>
              <div className="pad">
                {/* Grouped by category, each group showing what it costs and
                    what share of the tonne it is. */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {byCategory.map(c => (
                    <Chip key={c.name} tone="neutral">
                      {c.name} · {fmtINR(c.value)} · {fmtPct(c.share * 100, 1)}
                    </Chip>
                  ))}
                </div>
                <Table rows={recipe} cols={recipeCols} rowKey={x => x.materialId}
                  onRow={x => nav(`/stock?m=${x.materialId}`)}
                  search={x => `${x.code} ${x.name} ${x.category}`}
                  sort={{ key: 'v', dir: 'desc' }} csv={`recipe-${shownSku.code}`} page={14} />
                <p className="text-2xs text-muted mt-2">
                  Quantities include the scrap allowance
                  {scrapRates.length === 1 ? ` (${scrapRates[0]}% on every line)` : ''}.
                  Countable items under one per tonne are shown as a rate. Click a row to open that material.
                </p>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'grid' && (
        <Panel pad={false}>
          <div className="flex flex-wrap items-center gap-1.5 px-3.5 pt-3 pb-2">
            <h3 className="h2 mr-1">Time-phased requirement<Why term="MRP" /></h3>
            <div className="relative w-40">
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <input className="input pl-6 h-7 text-sm" placeholder="Material" value={gridQuery}
                onChange={e => setGridQuery(e.target.value)} />
            </div>
            <select className="input w-auto h-7" value={gridCat} onChange={e => setGridCat(e.target.value)}>
              <option value="All">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={() => setOnlyTrouble(v => !v)}
              className={`chip ${onlyTrouble ? 'chip-danger' : 'chip-neutral'}`}>
              Shortfalls only
            </button>
            <div className="flex-1" />
            <span className="num text-2xs text-muted">{gridRows.length} materials</span>
            <select className="input w-auto h-7" value={gridFrom} onChange={e => setGridFrom(Number(e.target.value))}>
              {[0, 6, 12, 18].filter(n => n < r.horizon).map(n => (
                <option key={n} value={n}>
                  from {wkLabel(ds, r.todayWeek + n)}
                </option>
              ))}
            </select>
            <select className="input w-auto h-7" value={gridWeeks} onChange={e => setGridWeeks(Number(e.target.value))}>
              <option value={10}>10 weeks</option><option value={16}>16 weeks</option>
              <option value={26}>26 weeks</option>
            </select>
          </div>

          {gridRows.length === 0 ? (
            <div className="pad"><Empty title="No material matches" hint="Clear the filters to see the full grid." /></div>
          ) : (
            <div className="overflow-auto px-3.5 pb-3.5" style={{ maxHeight: 520 }}>
              <table className="w-full border-collapse text-2xs">
                <thead><tr>
                  <th className="th sticky left-0 z-20">Material</th><th className="th">Row</th>
                  <th className="th text-right min-w-[64px]">Start on hand</th>
                  {weeks.map(c => <th key={c.week} className="th text-right min-w-[52px]">{wkLabel(ds, c.week)}</th>)}
                </tr></thead>
                <tbody>
                  {gridRows.map(row => (
                    <React.Fragment key={row.materialId}>
                      {([
                        ['Gross', (c: any) => c.grossRequirement, ''],
                        ['Receipts', (c: any) => c.scheduledReceipts, 'text-info'],
                        ['Projected on hand (end of week)', (c: any) => c.projectedOnHand, 'font-semibold'],
                        ['Order recv', (c: any) => c.plannedOrderReceipt, 'text-primary'],
                        ['Order place', (c: any) => c.plannedOrderRelease, 'text-primary font-semibold'],
                      ] as const).map(([lab, pick, cls], ri) => (
                        <tr key={lab} className={ri === 0 ? 'border-t-2 border-line-strong' : ''}>
                          {ri === 0 && (
                            <td className="td sticky left-0 z-10 bg-surface align-top border-r border-line cursor-pointer hover:text-primary"
                              rowSpan={5} onClick={() => nav(`/stock?m=${row.materialId}`)}>
                              <div className="font-mono text-2xs font-semibold">{row.code}</div>
                              <div className="text-2xs text-muted truncate max-w-[110px]" title={row.name}>{row.name}</div>
                              <div className="text-2xs text-muted/70 mt-0.5">{row.unit}</div>
                            </td>
                          )}
                          <td className="td text-muted whitespace-nowrap">{lab}</td>
                          <td className="td text-right num text-muted">
                            {/* Opening stock, so this grid reconciles with the
                                Stock screen instead of appearing to contradict it. */}
                            {ri === 2 ? fmtQty(startOnHand(row.materialId), row.unit, false) : <span className="text-muted/40">–</span>}
                          </td>
                          {row.cells.slice(gridFrom, gridFrom + gridWeeks).map(c => {
                            const v = pick(c)
                            const bad = ri === 2 && (c.stockout || c.belowSafety)
                            return <td key={c.week} className={`td text-right num ${cls} ${
                              bad ? (c.stockout ? 'bg-danger-soft text-danger font-bold' : 'bg-warning-soft text-warning font-semibold') : ''}`}>
                              {/* Unit-aware, so a count of bricks never shows a fraction. */}
                              {v === 0 ? <span className="text-muted/40">–</span> : fmtQty(v, row.unit, false)}
                            </td>
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap gap-3 px-3.5 pb-3 text-2xs text-muted">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-warning-soft border border-warning/30" /> below safety</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-danger-soft border border-danger/30" /> stockout</span>
            <span>Click a material to open its stock position.</span>
          </div>
        </Panel>
      )}

      {tab === 'orders' && (
        <Panel pad={false}><div className="pad">
          {/* This list used to stop at 80 rows of 740, so 33 of the 38 materials
              with planned orders never appeared at all. */}
          <Table rows={shownOrders} cols={orderCols} rowKey={o => o.id}
            onRow={o => nav(`/stock?m=${o.materialId}`)}
            search={o => `${o.code} ${o.name} ${o.category}`}
            sort={{ key: 'r', dir: 'asc' }} csv="planned-orders" page={16}
            toolbar={
              <>
                {['All', 'Late', 'On time'].map(t => (
                  <button key={t} onClick={() => setOrderLate(t)}
                    className={`chip ${orderLate === t ? 'chip-primary' : 'chip-neutral'}`}>
                    {t} {t === 'All' ? orderRows.length
                      : t === 'Late' ? orderRows.filter(o => o.late).length
                      : orderRows.filter(o => !o.late).length}
                  </button>
                ))}
                <select className="input w-auto h-7 text-sm" value={orderCat} onChange={e => setOrderCat(e.target.value)}>
                  <option value="All">All categories</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="input w-auto h-7 text-sm" value={orderWindow}
                  onChange={e => setOrderWindow(Number(e.target.value))}>
                  <option value={0}>Every week</option>
                  <option value={4}>Place within 4 weeks</option>
                  <option value={8}>Place within 8 weeks</option>
                  <option value={13}>Place within 13 weeks</option>
                </select>
              </>
            } />
          <p className="text-2xs text-muted mt-2">
            Sorted by the date the order has to be placed. Click a row to open the material.
          </p>
        </div></Panel>
      )}
    </>
  )
}
