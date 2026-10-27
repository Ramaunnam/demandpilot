import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Check, X, Search as Mag, ChevronRight, ArrowUpRight, ArrowDownRight, CircleCheck, CircleMinus,
  IndianRupee,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Head, Tile, Tiles, Panel, Chip, Status, Drawer, LVRow, Modal, Field, Empty, Tabs, Spark, Confidence, Fact, Bar } from '@/ui/kit'
import { ResponsiveContainer } from 'recharts'
import { Chart, Lines, Heat, useC } from '@/ui/charts'
import { Table, type Col } from '@/ui/Table'
import { fmtT, fmtSigned, fmtINR, fmtINRShort, fmtNum, fmtQty, fmtCover } from '@/lib/format'
import { wkLabel, wkFull } from '@/lib/view'
import { selectAnomalyGroups, type AnomalyGroup } from '@/engine/selectors'
import type { Anomaly, AnomalyStatus } from '@/engine/anomaly'
import {
  demandOutlook, priceAlerts, orderWatch, explainShift, spottedText,
  GRADES_ALL, REGIONS_ALL, type PriceAlert,
} from '@/engine/insights'

type TabId = 'shifts' | 'outlook' | 'prices' | 'orders' | 'oneoff'

const Up = ({ up }: { up: boolean }) => up
  ? <ArrowUpRight className="w-3.5 h-3.5 text-success inline" />
  : <ArrowDownRight className="w-3.5 h-3.5 text-danger inline" />

export default function Anomalies() {
  const C = useC()
  const { result, ds, settings, resolveAnomalies } = useStore()
  const r = result!
  const [tab, setTab] = useState<TabId>('shifts')
  const [status, setStatus] = useState<AnomalyStatus | 'All'>('Open')
  const [open, setOpen] = useState<AnomalyGroup | null>(null)
  const [pick, setPick] = useState<number | null>(null)
  const [act, setAct] = useState<{ status: AnomalyStatus; ids: string[]; label: string; preview?: string } | null>(null)
  const [why, setWhy] = useState('')
  const [leadId, setLeadId] = useState<string | null>(null)

  // ---- data -------------------------------------------------------------
  const groups = useMemo(() => selectAnomalyGroups(r, status), [r, status])
  const openGroups = useMemo(() => selectAnomalyGroups(r, 'Open'), [r])
  const shifts = groups.filter(g => g.kind === 'Shift')
  const oneOffs = groups.filter(g => g.kind === 'One-off weeks')
  const openShifts = openGroups.filter(g => g.kind === 'Shift')
  const openOneOffs = openGroups.filter(g => g.kind === 'One-off weeks')
  const oneOffSeries = openOneOffs.reduce((s, g) => s + g.products, 0)

  const prices = useMemo(() => priceAlerts(ds, r), [ds, r])
  const rising = prices.filter(p => p.direction === 'Rising')
  const orders = useMemo(() => orderWatch(ds, r), [ds, r])
  const outlook = useMemo(() => demandOutlook(ds, r), [ds, r])
  const biggest = [...outlook].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))[0]

  const story = useMemo(() => open ? explainShift(ds, r, open, prices) : null, [open, ds, r, prices])
  // The chart's subject, picked from the strip of cards. Defaults to the
  // worst one, which is the order groupAnomalies already returns.
  const lead = openShifts.find(g => g.id === leadId) ?? openShifts[0] ?? null
  const leadStory = useMemo(() => lead ? explainShift(ds, r, lead, prices) : null, [lead, ds, r, prices])

  const now = r.todayWeek - 1
  const member: Anomaly | undefined = open && pick !== null ? open.items[pick] : undefined
  const memberChart = useMemo(() => {
    if (!member) return []
    const h = ds.demand.find(d => d.skuId === member.skuId && d.region === member.region)?.weeks ?? []
    const from = Math.max(0, member.startWeek - 12)
    // Never past the last week that has happened: the dataset holds hidden
    // future sales for the simulator, and this chart used to show them.
    const to = Math.min(now, member.startWeek + member.weeksRunning + 3)
    return Array.from({ length: to - from + 1 }, (_, i) => {
      const w = from + i
      const inside = w >= member.startWeek && w < member.startWeek + member.weeksRunning
      return { label: wkLabel(ds, w), actual: +(h[w] ?? 0).toFixed(1), expected: inside ? +member.expected.toFixed(1) : null }
    })
  }, [member, ds, now])

  const openGroup = (g: AnomalyGroup) => { setOpen(g); setPick(null) }
  const decide = (g: AnomalyGroup, s: AnomalyStatus) => {
    const st = explainShift(ds, r, g, prices)
    const preview = s === 'Accepted as new trend'
      ? (Math.abs(st.ifNewTrend) >= 0.5 ? `Forecast moves ${fmtSigned(st.ifNewTrend, 1, ' t')} a week for these products. Materials and buying follow.` : 'The forecast has already caught up with this level, so it barely moves.')
      : s === 'Ignored as one-off'
        ? (Math.abs(st.ifOneOff) >= 0.5 ? `These weeks are taken out of the forecast's learning. Forecast moves about ${fmtSigned(st.ifOneOff, 1, ' t')} a week.` : 'These weeks are taken out of the forecast\'s learning. The forecast barely moves.')
        : 'Marked for follow-up. Nothing changes in the plan yet.'
    setAct({ status: s, ids: g.items.map(a => a.id), label: `${g.region} · grade ${g.grade}`, preview })
    setWhy(s === 'Ignored as one-off' && g.kind === 'One-off weeks' ? 'Scattered single weeks, not a trend' : '')
  }

  // ---- table columns ----------------------------------------------------
  const shiftCols: Col<AnomalyGroup>[] = [
    { key: 's', h: 'Sev', cell: g => <Status v={g.severity} />, val: g => g.severity },
    { key: 'g', h: 'Grade', cell: g => <Chip tone="neutral">{g.grade}</Chip>, val: g => g.grade },
    { key: 'r', h: 'Region', cell: g => <Chip tone="info">{g.region}</Chip>, val: g => g.region },
    { key: 'd', h: 'Demand', cell: g => <span className={g.avgDeltaPct > 0 ? 'text-success font-medium' : 'text-danger font-medium'}><Up up={g.avgDeltaPct > 0} /> {g.avgDeltaPct > 0 ? 'Up' : 'Down'} {Math.abs(g.avgDeltaPct).toFixed(0)}%</span>, val: g => g.avgDeltaPct },
    { key: 'n', h: 'Products', right: true, cell: g => <span className="num">{g.products} <span className="text-muted text-2xs">({g.sustainedProducts} for 2+ wks)</span></span>, val: g => g.products },
    { key: 't', h: 'Per week', right: true, cell: g => fmtSigned(g.weeklyGapT, 1, ' t'), val: g => g.weeklyGapT },
    { key: 'v', h: 'Sales / wk', right: true, cell: g => fmtINRShort(g.weeklyGapINR), val: g => g.weeklyGapINR },
    { key: 'since', h: 'Since', cell: g => wkLabel(ds, g.startWeek), val: g => g.startWeek },
    { key: 'c', h: 'Confidence', right: true, cell: g => <Confidence v={g.confidence} />, val: g => g.confidence },
    { key: 'st', h: 'Status', cell: g => <Status v={g.status} />, val: g => g.status },
  ]
  const oneOffCols: Col<AnomalyGroup>[] = [
    { key: 'g', h: 'Grade', cell: g => <Chip tone="neutral">{g.grade}</Chip>, val: g => g.grade },
    { key: 'r', h: 'Region', cell: g => <Chip tone="info">{g.region}</Chip>, val: g => g.region },
    { key: 'd', h: 'Direction', cell: g => <span className="text-muted"><Up up={g.avgDeltaPct > 0} /> {g.avgDeltaPct > 0 ? 'Above' : 'Below'}</span>, val: g => g.avgDeltaPct },
    { key: 'n', h: 'Products', right: true, cell: g => fmtNum(g.products), val: g => g.products },
    { key: 'sp', h: 'Spread over', right: true, cell: g => `${g.spanWeeks} wks`, val: g => g.spanWeeks },
    { key: 'gap', h: 'Avg gap', right: true, cell: g => fmtSigned(g.avgDeltaPct), val: g => g.avgDeltaPct },
    { key: 'st', h: 'Status', cell: g => <Status v={g.status} />, val: g => g.status },
  ]

  const statusChips = (
    <div className="flex flex-wrap gap-1 mb-2">
      {(['Open', 'Accepted as new trend', 'Ignored as one-off', 'Investigating', 'All'] as const).map(s => (
        <button key={s} onClick={() => setStatus(s)} className={`chip ${status === s ? 'chip-primary' : 'chip-neutral'}`}>
          {s === 'Accepted as new trend' ? 'Accepted' : s === 'Ignored as one-off' ? 'Ignored' : s}
        </button>
      ))}
    </div>
  )

  return (
    <>
      <Head title="Anomalies" blurb="What changed in demand, material prices and customer orders, and what to do about it"
        chips={<Chip tone={openShifts.length ? 'warning' : 'success'}>{openShifts.length} real shift{openShifts.length === 1 ? '' : 's'} · {rising.length} price{rising.length === 1 ? '' : 's'} rising</Chip>} />

      <Tiles>
        <Tile k="Real shifts" v={fmtNum(openShifts.length)} sub="need a decision" tone={openShifts.length ? 'warning' : 'success'} onClick={() => setTab('shifts')} />
        <Tile k="Next 8 weeks" v={biggest ? fmtSigned(biggest.changePct, 0) : '—'} sub={biggest ? `${biggest.grade} ${biggest.region}, biggest move` : ''}
          tone={biggest && Math.abs(biggest.changePct) >= 15 ? 'warning' : undefined} onClick={() => setTab('outlook')} />
        <Tile k="Prices rising" v={fmtNum(rising.length)} sub={rising[0] ? `${rising[0].name}${rising[0].urgent ? ': order now' : ''}` : 'none'}
          tone={rising.some(p => p.urgent) ? 'danger' : rising.length ? 'warning' : 'success'} onClick={() => setTab('prices')} />
        <Tile k="Customer changes" v={fmtNum(orders.moves.length)} sub={`of ${orders.customersChecked} customers`} onClick={() => setTab('orders')} />
        <Tile k="One-off weeks" v={fmtNum(openOneOffs.length)} sub={`${oneOffSeries} product-weeks, normal wobble`} onClick={() => setTab('oneoff')} />
        <Tile k="Sensitivity" v={settings.anomalyThreshold.toFixed(1)} unit="σ" to="/setup" sub="change in Setup" />
      </Tiles>

      <div className="mt-3">
        <Tabs active={tab} onChange={id => setTab(id as TabId)} tabs={[
          { id: 'shifts', label: 'Demand shifts', n: openShifts.length },
          { id: 'outlook', label: 'Demand outlook' },
          { id: 'prices', label: 'Material prices', n: rising.length },
          { id: 'orders', label: 'Customer orders', n: orders.moves.length },
          { id: 'oneoff', label: 'One-off weeks', n: openOneOffs.length },
        ]} />
      </div>

      {/* ---------------- Demand shifts ---------------- */}
      {tab === 'shifts' && (
        <>
          {lead && leadStory ? (
            <div className="grid gap-3 lg:grid-cols-3">
              <Chart title={`${lead.region} · grade ${lead.grade}: sales vs expected`} h={190}
                right={<button className="btn btn-outline btn-sm" onClick={() => openGroup(lead)}>Open <ChevronRight className="w-3 h-3" /></button>}>
                <Lines data={leadStory.chart.map(c => ({ label: wkLabel(ds, c.week), actual: c.actual, expected: c.expected }))} x="label" unit=" t" lines={[
                  { k: 'actual', name: 'Actual', color: C.actual },
                  { k: 'expected', name: 'Expected', color: C.forecast, dash: true },
                ]} />
              </Chart>
              <Panel className="lg:col-span-2" title={openShifts.length > 1 ? `This shift, in one line — ${openShifts.length} are open` : 'This shift, in one line'}
                right={<button className="btn btn-soft btn-sm" onClick={() => openGroup(lead)}>Explain it <ChevronRight className="w-3 h-3" /></button>}>
                <p className="text-base">
                  <b>{lead.region} {lead.grade}</b> demand is <b className={lead.avgDeltaPct > 0 ? 'text-success' : 'text-danger'}>{lead.avgDeltaPct > 0 ? 'up' : 'down'} {Math.abs(lead.avgDeltaPct).toFixed(0)}%</b> across {lead.products} products since {wkLabel(ds, lead.startWeek)}.
                  {' '}{leadStory.verdict}
                </p>
                <div className="grid sm:grid-cols-3 gap-2 mt-2.5">
                  <Fact k="Extra per week" v={fmtSigned(lead.weeklyGapT, 1, ' t')} sub={`${fmtINR(lead.weeklyGapINR)} of sales`} />
                  <Fact k="Biggest material hit" v={leadStory.materials[0]?.m.name ?? '—'}
                    sub={leadStory.materials[0] ? `${fmtQty(leadStory.materials[0].extraPerWeek, leadStory.materials[0].m.unit)} more a week` : ''} />
                  <Fact k="Why" v={lead.linkedSignalId ? 'Market signal' : 'No clear cause yet'} sub={lead.likelyCause} />
                </div>
              </Panel>
            </div>
          ) : (
            <OutlookHeat outlook={outlook} chart />
          )}

          {/* One card per open shift. With several running at once, the useful
              view is side by side — which are up, which are down, which has a
              cause — before dropping into any one of them. */}
          {openShifts.length > 1 && (
            <div className="grid gap-2 mt-3 sm:grid-cols-2 xl:grid-cols-3">
              {openShifts.map(g => {
                const up = g.avgDeltaPct > 0
                const on = g.id === lead?.id
                return (
                  <button key={g.id} onClick={() => setLeadId(g.id)} onDoubleClick={() => openGroup(g)}
                    className={`card pad text-left w-full transition-all ${on ? 'border-primary shadow-md' : 'border-line hover:border-primary/40'}`}>
                    <div className="flex items-center gap-1.5">
                      {up ? <ArrowUpRight className="w-4 h-4 text-success shrink-0" />
                          : <ArrowDownRight className="w-4 h-4 text-danger shrink-0" />}
                      <span className="text-md font-semibold truncate flex-1">{g.region} · {g.grade}</span>
                      <span className={`num text-md font-bold ${up ? 'text-success' : 'text-danger'}`}>
                        {fmtSigned(g.avgDeltaPct, 0)}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <Fact k="Products" v={`${g.products}`} sub={`${g.sustainedProducts} for 2+ wks`} />
                      <Fact k="Per week" v={fmtSigned(g.weeklyGapT, 1, ' t')} sub={fmtINRShort(Math.abs(g.weeklyGapINR))} />
                      <Fact k="Running" v={`${g.weeksRunning} wk`} sub={`since ${wkLabel(ds, g.startWeek)}`} />
                    </div>
                    <div className="mt-2 pt-2 border-t border-line flex items-center gap-1.5">
                      {g.linkedSignalId
                        ? <><CircleCheck className="w-3 h-3 text-success shrink-0" /><span className="text-2xs text-muted truncate">A signal explains it</span></>
                        : <><CircleMinus className="w-3 h-3 text-warning shrink-0" /><span className="text-2xs text-warning truncate">No signal explains it</span></>}
                      <div className="flex-1" />
                      <Confidence v={g.confidence} />
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          <Panel className="mt-3" pad={false}><div className="pad">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {statusChips}
              <p className="text-2xs text-muted mb-2">A shift = 3+ products unusual for 2+ weeks, at the same time, still running.</p>
            </div>
            {shifts.length === 0
              ? <Empty title="No real shifts in this filter" hint="Scattered unusual weeks are under One-off weeks." />
              : <Table rows={shifts} cols={shiftCols} rowKey={g => g.id} onRow={openGroup}
                  search={g => `${g.grade} ${g.region} ${g.direction}`} sort={{ key: 'c', dir: 'desc' }} csv="demand-shifts" page={12} />}
          </div></Panel>
        </>
      )}

      {/* ---------------- Demand outlook ---------------- */}
      {tab === 'outlook' && <OutlookHeat outlook={outlook} />}

      {/* ---------------- Material prices ---------------- */}
      {tab === 'prices' && (
        prices.length === 0 ? <Empty title="No price movement to report" /> : (
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {prices.map(p => <PriceCard key={p.materialId} p={p} />)}
          </div>
        )
      )}

      {/* ---------------- Customer orders ---------------- */}
      {tab === 'orders' && (
        <div className="grid gap-3 xl:grid-cols-2">
          <Panel title="Customers ordering differently from usual" note={`Last 4 weeks vs each customer's own usual, from the ${orders.weeksCovered}-week order book. Flagged only when clearly outside their normal swings.`} pad>
            {orders.moves.length === 0 ? <Empty title="Every customer is ordering within their usual range" /> : (
              <Table rows={orders.moves} rowKey={m => m.customerId} page={10} csv="customer-changes"
                search={m => `${m.customer} ${m.region} ${m.industry}`} sort={{ key: 'd', dir: 'desc' }}
                cols={[
                  { key: 'c', h: 'Customer', cell: m => <span className="font-medium whitespace-nowrap">{m.customer.split(' — ')[0]}</span>, val: m => m.customer },
                  { key: 'i', h: 'Industry', cell: m => <span className="text-muted">{m.industry}</span>, val: m => m.industry },
                  { key: 'r', h: 'Region', cell: m => <Chip tone="info">{m.region}</Chip>, val: m => m.region },
                  { key: 'b', h: 'Usual', right: true, cell: m => <span className="whitespace-nowrap">{fmtT(m.usualT)}</span>, val: m => m.usualT },
                  { key: 'n', h: 'Last 4 wks', right: true, cell: m => <span className="whitespace-nowrap">{fmtT(m.recentT)}</span>, val: m => m.recentT },
                  { key: 'd', h: 'Change', right: true, cell: m => <span className={m.changePct > 0 ? 'text-success font-semibold' : 'text-danger font-semibold'}>{fmtSigned(m.changePct, 0)}</span>, val: m => Math.abs(m.z) },
                  { key: 'g', h: 'Grades', cell: m => <span className="text-2xs">{m.grades.join(', ') || '—'}</span> },
                ]} />
            )}
          </Panel>
          <Panel title="Largest orders, last 4 weeks" note="'vs typical' compares each order with the usual order for the same product in the same region. 2.5× or more is marked unusual." pad>
            {orders.big.length === 0 ? <Empty title="No orders in the last 4 weeks" /> : (
              <Table rows={orders.big} rowKey={b => b.order.id} page={8} csv="largest-orders"
                search={b => `${b.customer} ${b.skuCode} ${b.order.region}`} sort={{ key: 'v', dir: 'desc' }}
                cols={[
                  { key: 'c', h: 'Customer', cell: b => <span className="font-medium whitespace-nowrap">{b.customer.split(' — ')[0]}</span>, val: b => b.customer },
                  { key: 'p', h: 'Product', cell: b => <span className="font-mono text-2xs">{b.skuCode}</span>, val: b => b.skuCode },
                  { key: 'r', h: 'Region', cell: b => <Chip tone="info">{b.order.region}</Chip>, val: b => b.order.region },
                  { key: 'q', h: 'Qty', right: true, cell: b => <span className="whitespace-nowrap">{fmtT(b.order.qtyT)}</span>, val: b => b.order.qtyT },
                  { key: 'x', h: 'vs typical', right: true, cell: b => b.unusual ? <Chip tone="warning"><span className="num">{b.timesUsual.toFixed(1)}×</span></Chip> : <span className="num text-muted">{b.timesUsual.toFixed(1)}×</span>, val: b => b.timesUsual },
                  { key: 'v', h: 'Value', right: true, cell: b => fmtINRShort(b.order.valueINR), val: b => b.order.valueINR },
                  { key: 'w', h: 'Placed', cell: b => wkLabel(ds, b.order.orderWeek), val: b => b.order.orderWeek },
                ]} />
            )}
          </Panel>
        </div>
      )}

      {/* ---------------- One-off weeks ---------------- */}
      {tab === 'oneoff' && (
        <Panel pad={false}><div className="pad">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            {statusChips}
            {status === 'Open' && openOneOffs.length > 0 && (
              <button className="btn btn-outline btn-sm mb-2" onClick={() => {
                setAct({ status: 'Ignored as one-off', ids: openOneOffs.flatMap(g => g.items.map(a => a.id)), label: `all ${oneOffSeries} one-off weeks`,
                  preview: 'All of these weeks are taken out of what the forecast learns from.' })
                setWhy('Scattered single weeks, not trends')
              }}><X className="w-3.5 h-3.5" /> Ignore all as one-off</button>
            )}
          </div>
          <p className="text-2xs text-muted mb-2">Unusual weeks that did not happen together. Usually normal week-to-week variation. Ignoring them stops them distorting the forecast.</p>
          {oneOffs.length === 0
            ? <Empty title="None in this filter" />
            : <Table rows={oneOffs} cols={oneOffCols} rowKey={g => g.id} onRow={openGroup}
                search={g => `${g.grade} ${g.region} ${g.direction}`} sort={{ key: 'n', dir: 'desc' }} csv="one-off-weeks" page={14} />}
        </div></Panel>
      )}

      {/* ---------------- Drawer: one group, as a story ---------------- */}
      <Drawer open={!!open} onClose={() => setOpen(null)}
        title={open ? `${open.region} · grade ${open.grade}` : ''}
        sub={open ? (open.kind === 'Shift'
          ? `${open.avgDeltaPct > 0 ? 'Up' : 'Down'} ${Math.abs(open.avgDeltaPct).toFixed(0)}% across ${open.products} products since ${wkFull(ds, open.startWeek)}`
          : `${open.products} product${open.products === 1 ? '' : 's'} with unusual weeks, spread over ${open.spanWeeks} weeks`) : ''}
        chips={open && <><Chip tone={open.kind === 'Shift' ? 'warning' : 'neutral'}>{open.kind === 'Shift' ? 'Real shift' : 'One-off weeks'}</Chip><Status v={open.status} /></>}
        footer={open?.status === 'Open' && (
          <div className="flex gap-1.5">
            <button className={`btn ${open.kind === 'Shift' ? 'btn-primary' : 'btn-outline'} btn-md flex-1`} onClick={() => decide(open, 'Accepted as new trend')}><Check className="w-4 h-4" /> New trend</button>
            <button className={`btn ${open.kind === 'Shift' ? 'btn-outline' : 'btn-primary'} btn-md flex-1`} onClick={() => decide(open, 'Ignored as one-off')}><X className="w-4 h-4" /> One-off</button>
            <button className="btn btn-ghost btn-md" title="Investigate" onClick={() => decide(open, 'Investigating')}><Mag className="w-4 h-4" /></button>
          </div>
        )}>
        {open && story && (
          <>
            <div className={`rounded-lg border px-3 py-2 flex items-center gap-2 ${open.kind === 'Shift' ? 'border-warning/40 bg-warning-soft' : 'border-line bg-surface2'}`}>
              <span className="text-base font-semibold flex-1">{story.verdict}</span>
              <Confidence v={open.confidence} />
            </div>

            {/* 1 — what normal looks like, so the gap below has something to be a gap from */}
            <Step n="1" title="What normal looks like"
              right={<Chip tone="neutral">measured on the {story.normal.weeks} weeks before it started</Chip>}>
              <div className="grid sm:grid-cols-3 gap-2">
                <Fact k="Normal level" v={`${fmtT(story.normal.levelT)}/wk`}
                  sub={`across these ${open.products} product${open.products === 1 ? '' : 's'} in ${open.region}`} />
                <Fact k="Normal week-to-week swing" v={`±${story.normal.wobblePct.toFixed(0)}%`}
                  sub="how much these products move about on their own" />
                <Fact k="Flagged past" v={`${settings.anomalyThreshold.toFixed(1)}σ`}
                  sub={<Link to="/setup" className="link">change the sensitivity</Link>} />
              </div>
              <p className="text-2xs text-muted mt-2">
                {Math.abs(open.avgDeltaPct) > story.normal.wobblePct * 2
                  ? `The move below is more than twice the normal swing, which is why it was flagged rather than absorbed.`
                  : `The move below is close to the normal swing for these products — worth reading the evidence before acting on it.`}
              </p>
            </Step>

            {/* 2 — how much, in the three units a planner needs */}
            <Step n="2" title={open.avgDeltaPct > 0 ? 'How much it is up' : 'How much it is down'}>
              <div className="grid sm:grid-cols-4 gap-2">
                <Fact k="Selling now" v={`${fmtT(story.actualNow)}/wk`}
                  sub={`normal is ${fmtT(story.normal.levelT)}`} />
                <Fact k="Gap" v={fmtSigned(open.avgDeltaPct, 0)}
                  sub={fmtSigned(open.weeklyGapT, 1, ' t') + ' a week'} />
                <Fact k="Worth" v={`${fmtINRShort(Math.abs(open.weeklyGapINR))}/wk`}
                  sub={open.weeklyGapT > 0 ? 'extra sales' : 'sales not happening'} />
                <Fact k="Running" v={`${open.weeksRunning} wk${open.weeksRunning === 1 ? '' : 's'}`}
                  sub={`since ${wkFull(ds, open.startWeek)} · spotted ${spottedText(open.detectedAfterWeeks)}`} />
              </div>
              <div className="mt-2" style={{ height: 150 }}>
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 560, height: 150 }}>
                  <Lines data={story.chart.map(c => ({ label: wkLabel(ds, c.week), actual: c.actual, expected: c.expected }))} x="label" unit=" t" lines={[
                    { k: 'actual', name: 'Actual (all products)', color: C.actual },
                    { k: 'expected', name: 'Normal', color: C.forecast, dash: true },
                  ]} />
                </ResponsiveContainer>
              </div>
              {open.kind === 'Shift' && (
                <p className="text-2xs text-muted mt-1">
                  If it holds for 8 more weeks: {fmtSigned(open.weeklyGapT * 8, 0, ' t')}, worth {fmtINR(Math.abs(open.weeklyGapINR * 8))} in sales.
                </p>
              )}
            </Step>

            {/* 3 — the question an average cannot answer */}
            <Step n="3" title="Is it spreading?"
              right={<Chip tone={story.widening ? 'warning' : 'neutral'}>{story.widening ? 'Widening' : 'Not widening'}</Chip>}>
              <p className="text-base">{story.spreadLabel}</p>
              <div className="mt-2 space-y-1">
                {story.spread.map(w => {
                  const peak = Math.max(...story.spread.map(x => x.products)) || 1
                  return (
                    <div key={w.week} className="grid grid-cols-[62px_1fr_auto_auto] items-center gap-2">
                      <span className="text-2xs text-muted">{wkLabel(ds, w.week)}</span>
                      <Bar pct={(w.products / peak) * 100} tone={open.avgDeltaPct > 0 ? 'success' : 'danger'} />
                      <span className="num text-2xs text-muted w-16 text-right">{w.products} prod</span>
                      <span className={`num text-2xs w-16 text-right ${w.gapT > 0 ? 'text-success' : 'text-danger'}`}>{fmtSigned(w.gapT, 1, ' t')}</span>
                    </div>
                  )
                })}
              </div>
              <p className="text-2xs text-muted mt-2 pt-2 border-t border-line">
                {open.sustainedProducts} of {open.products} products have been unusual for two or more weeks
                in a row. One product drifting for five weeks and five products moving together in the last
                two produce the same average, and mean very different things.
              </p>
            </Step>

            {/* 4 — why. Three channels, each allowed to disagree. */}
            <Step n="4" title={open.avgDeltaPct > 0 ? 'Why it is going up' : 'Why it is going down'}
              right={<Link to="/signals" className="btn btn-ghost btn-sm">Signals <ChevronRight className="w-3 h-3" /></Link>}>
              <div className="space-y-1.5">
                {story.evidence.map(e => (
                  <div key={e.label} className="flex items-start gap-2">
                    {e.supports
                      ? <CircleCheck className="w-4 h-4 text-success shrink-0 mt-0.5" />
                      : <CircleMinus className="w-4 h-4 text-muted shrink-0 mt-0.5" />}
                    <div className="min-w-0"><span className="text-sm font-semibold">{e.label}: </span><span className="text-sm">{e.detail}</span></div>
                  </div>
                ))}
              </div>
              {story.priceNote && (
                <div className="mt-2 pt-2 border-t border-line flex items-start gap-2">
                  <IndianRupee className="w-4 h-4 text-muted shrink-0 mt-0.5" />
                  <div className="min-w-0"><span className="text-sm font-semibold">Material prices: </span><span className="text-sm">{story.priceNote}</span></div>
                </div>
              )}
              <p className="text-2xs text-muted mt-2">
                A tick means that channel agrees with the move. A price is never ticked — a moving index is
                not a reason demand changed, it is what the change costs.
              </p>
            </Step>

            {/* 5 — what it reaches */}
            <Step n="5" title="What it affects"
              right={<Link to="/buy" className="btn btn-ghost btn-sm">Recommendations <ChevronRight className="w-3 h-3" /></Link>}>
              {story.materials.length === 0 ? <p className="text-sm text-muted">No material is affected.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-2xs text-muted text-left">
                      <th className="py-1 font-medium">Material</th><th className="py-1 font-medium text-right">Extra / wk</th>
                      <th className="py-1 font-medium text-right">Cost / wk</th><th className="py-1 font-medium text-right">Stock lasts</th><th className="py-1 pl-3 font-medium">Price</th>
                    </tr></thead>
                    <tbody>
                      {story.materials.map(x => (
                        <tr key={x.m.materialId} className="border-t border-line">
                          <td className="py-1.5"><Link to={`/stock?m=${x.m.materialId}`} className="hover:underline">{x.m.name}</Link></td>
                          <td className="py-1.5 text-right num">{fmtSigned(x.extraPerWeek, x.m.unit === 'nos' ? 0 : 1, ` ${x.m.unit}`)}</td>
                          <td className="py-1.5 text-right num">{fmtINRShort(x.extraCostPerWeekINR)}</td>
                          <td className="py-1.5 text-right num whitespace-nowrap">{fmtCover(x.coverDaysNow)} → <b>{fmtCover(x.coverDaysAfter)}</b></td>
                          <td className="py-1.5 pl-3">{x.price ? <Chip tone={x.price === 'Rising' ? 'danger' : x.price === 'Easing' ? 'success' : 'neutral'}>{x.price}</Chip> : <span className="text-muted">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-2xs text-muted mt-2">
                "Stock lasts" is cover today against cover if this gap holds at the same stock — the
                second figure is the one that decides whether anything needs ordering.
              </p>
            </Step>

            <Step n="6" title={`The ${open.products} product${open.products === 1 ? '' : 's'} affected`}
              right={<span className="text-2xs text-muted">click one for its own weeks</span>}>
              <div className="overflow-auto" style={{ maxHeight: 220 }}>
                {open.items.map((a, i) => (
                  <button key={a.id} onClick={() => setPick(pick === i ? null : i)}
                    className={`w-full grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-lg border px-2.5 py-1.5 mb-1 text-left transition-colors ${
                      i === pick ? 'border-primary bg-primary-soft' : 'border-line hover:border-primary/40'}`}>
                    <span className="font-mono text-sm truncate">{a.skuCode}</span>
                    <span className="text-2xs text-muted whitespace-nowrap">{a.weeksRunning} wk{a.weeksRunning === 1 ? '' : 's'}</span>
                    <span className="num text-2xs text-muted whitespace-nowrap">{fmtSigned(a.deltaT, 1, ' t')}</span>
                    <span className={`num text-sm font-semibold w-16 text-right ${a.deltaPct > 0 ? 'text-success' : 'text-danger'}`}>{fmtSigned(a.deltaPct, 0)}</span>
                  </button>
                ))}
              </div>
            </Step>
            {member && (
              <Chart title={`${member.skuCode}: normal vs actual`} h={170}>
                <Lines data={memberChart} x="label" unit=" t" lines={[
                  { k: 'actual', name: 'Actual', color: C.actual },
                  { k: 'expected', name: 'Normal', color: C.forecast, dash: true },
                ]} />
              </Chart>
            )}

            {/* 7 — the decision, with what each choice does to the plan */}
            <Step n="7" title="What to do">
              <p className="text-base mb-2"><b>Suggested:</b> {open.suggestedAction}</p>
              <div className="grid grid-cols-2 gap-2">
                <Choice title="If new trend" v={fmtSigned(story.ifNewTrend, 1, ' t/wk')}
                  sub="forecast moves to today's level, and buying follows" good={open.kind === 'Shift'} />
                <Choice title="If one-off" v={fmtSigned(story.ifOneOff, 1, ' t/wk')}
                  sub="these weeks leave what the models learn from" good={open.kind !== 'Shift'} />
              </div>
              <LVRow cols={3} items={[
                { k: 'Selling now', v: `${fmtT(story.actualNow)}/wk` },
                { k: 'Forecast says', v: `${fmtT(story.forecastNow)}/wk` },
                { k: 'Normal level', v: `${fmtT(story.normal.levelT)}/wk` },
              ]} />
              <p className="text-2xs text-muted mt-2">
                Neither button is cosmetic: whichever you pick changes what the forecast is fitted on, so
                the material needs and the buy plan move with it on the next run.
              </p>
            </Step>
          </>
        )}
      </Drawer>

      <Modal open={!!act} onClose={() => setAct(null)} title={act?.status ?? ''}>
        <div className="space-y-2.5">
          {act && <p className="text-base text-muted">Applies to {act.ids.length} product-week episode{act.ids.length === 1 ? '' : 's'} in {act.label}.</p>}
          {act?.preview && <div className="rounded-lg border border-line bg-surface2 px-3 py-2 text-base">{act.preview}</div>}
          <Field label="Reason"><textarea className="input h-16 py-1.5" value={why} onChange={e => setWhy(e.target.value)}
            placeholder="Two customers confirmed the change in writing" /></Field>
          <div className="flex gap-1.5 justify-end">
            <button className="btn btn-outline btn-md" onClick={() => setAct(null)}>Cancel</button>
            <button className="btn btn-primary btn-md" disabled={!why.trim()}
              onClick={() => {
                if (act) resolveAnomalies(act.ids, act.status, why)
                setAct(null); setOpen(null)
              }}>Confirm</button>
          </div>
        </div>
      </Modal>
    </>
  )

  // ---- local pieces ------------------------------------------------------
  function OutlookHeat({ outlook, chart }: { outlook: ReturnType<typeof demandOutlook>; chart?: boolean }) {
    const get = (g: string, reg: string) => outlook.find(c => c.grade === g && c.region === reg)?.changePct ?? null
    const ups = [...outlook].filter(c => c.changePct > 0).sort((a, b) => b.changePct - a.changePct).slice(0, 3)
    const downs = [...outlook].filter(c => c.changePct < 0).sort((a, b) => a.changePct - b.changePct).slice(0, 3)
    return (
      <div className="grid gap-3 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Next 8 weeks vs last 8 weeks" note="Forecast tonnes against actual tonnes sold, by grade and region. Green = demand about to rise, red = about to fall.">
          <Heat rows={GRADES_ALL} cols={REGIONS_ALL} get={get} fmt={v => fmtSigned(v, 0)} corner="Grade" />
          {chart && <p className="text-2xs text-muted mt-2">No real demand shift is open right now.</p>}
        </Panel>
        <Panel title="Biggest moves ahead">
          <MoveList title="Rising" items={ups} up />
          <div className="h-2" />
          <MoveList title="Falling" items={downs} up={false} />
        </Panel>
      </div>
    )
  }
}

function MoveList({ title, items, up }: { title: string; items: { grade: string; region: string; changePct: number; nextT: number; lastT: number }[]; up: boolean }) {
  return (
    <div>
      <div className="eyebrow mb-1">{title}</div>
      {items.length === 0 ? <p className="text-sm text-muted">None</p> : items.map(c => (
        <div key={c.grade + c.region} className="flex items-center gap-2 py-1 border-b border-line last:border-0">
          <Up up={up} />
          <span className="text-sm font-medium flex-1">{c.grade} · {c.region}</span>
          <span className="num text-2xs text-muted">{fmtSigned((c.nextT - c.lastT) / 8, 1, ' t/wk')}</span>
          <span className={`num text-sm font-semibold w-12 text-right ${up ? 'text-success' : 'text-danger'}`}>{fmtSigned(c.changePct, 0)}</span>
        </div>
      ))}
    </div>
  )
}

function PriceCard({ p }: { p: PriceAlert }) {
  const tone = p.direction === 'Rising' ? (p.urgent ? 'danger' : 'warning') : p.direction === 'Easing' ? 'success' : 'neutral'
  return (
    <section className={`card pad ${p.urgent ? 'border-danger/40' : ''}`}>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="h2 truncate">{p.name}</h3>
          <p className="text-2xs text-muted">{p.indexName ?? 'Supplier notice'} · {p.code}</p>
        </div>
        <Chip tone={tone}>{p.urgent ? 'Order now' : p.direction}</Chip>
      </header>
      {p.series.length > 1 && <Spark data={p.series.map(s => s.v)} tone={tone === 'neutral' ? 'primary' : tone} h={36} />}
      <div className="grid grid-cols-3 gap-2 mt-2">
        <Fact k="Last 4 wks" v={fmtSigned(p.change4Pct)} />
        <Fact k="Last 12 wks" v={p.indexName ? fmtSigned(p.change12Pct) : '—'} />
        <Fact k="Expected" v={fmtSigned(p.movePct)} sub={p.basis.toLowerCase()} />
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <Fact k="Extra spend / wk" v={fmtINRShort(p.extraPerWeekINR)} sub={`on ${fmtINRShort(p.weeklySpendINR)} a week`} />
        <Fact k="Stock lasts" v={fmtCover(p.coverDays)} sub={`lead time ${p.leadTimeDays} d`} />
      </div>
      {p.grades.length > 0 && (
        <div className="mt-2">
          <div className="eyebrow mb-1">Cost per tonne made</div>
          <div className="flex flex-wrap gap-1">
            {p.grades.map(g => <Chip key={g.grade} tone="neutral"><span className="num">{g.grade}: {g.perTonneINR > 0 ? '+' : ''}{fmtINR(g.perTonneINR)}/t</span></Chip>)}
          </div>
        </div>
      )}
      {p.signals[0] && <p className="text-2xs text-muted mt-2">Notice: {p.signals[0].title}</p>}
      <p className="text-sm mt-2 pt-2 border-t border-line">{p.advice}</p>
      <div className="flex gap-1.5 mt-2">
        <Link to={`/stock?m=${p.materialId}`} className="btn btn-outline btn-sm">Stock</Link>
        <Link to="/buy" className="btn btn-ghost btn-sm">Recommendations <ChevronRight className="w-3 h-3" /></Link>
      </div>
    </section>
  )
}

function Step({ n, title, right, children }: { n: string; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="card pad">
      <header className="flex items-center gap-2 mb-2">
        <span className="w-5 h-5 rounded bg-primary text-primary-fg grid place-items-center text-2xs font-bold num">{n}</span>
        <h3 className="h2 flex-1">{title}</h3>
        {right}
      </header>
      {children}
    </section>
  )
}

function Choice({ title, v, sub, good }: { title: string; v: string; sub: string; good: boolean }) {
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${good ? 'border-primary/50 bg-primary-soft' : 'border-line bg-surface2'}`}>
      <div className="text-2xs text-muted">{title}{good && ' · suggested'}</div>
      <div className="text-base font-bold num">{v}</div>
      <div className="text-2xs text-muted">{sub}</div>
    </div>
  )
}
