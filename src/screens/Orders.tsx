import { useMemo, useState } from 'react'
import { CheckCircle2, Circle } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Head, Tile, Tiles, Panel, Status, Bar, Drawer, LVRow } from '@/ui/kit'
import { Chart, Bars, useC } from '@/ui/charts'
import { Table, type Col } from '@/ui/Table'
import { fmtINR, fmtNum, fmtQty } from '@/lib/format'
import { selectAllOrders, selectOpenOrders, orderIsLate, orderDaysEarly } from '@/engine/selectors'
import { wkFull, wkLabel } from '@/lib/view'
import type { PurchaseOrder } from '@/data/types'

const STAGES = ['Recommended', 'Approved', 'Sent', 'Confirmed', 'In transit', 'Received'] as const

export default function Orders() {
  const C = useC()
  const { ds, result, approvals } = useStore()
  const r = result!
  // Opens on what still needs attention, not on orders received months ago.
  const [status, setStatus] = useState('Open')
  const [open, setOpen] = useState<PurchaseOrder | null>(null)

  // Built by the same selector Health's chain rail reads, so approving an order
  // can no longer make the two screens disagree about how many are open.
  const all = useMemo(() => selectAllOrders(ds, r, approvals), [ds, r, approvals])
  const openPOs = useMemo(() => selectOpenOrders(ds, r, approvals), [ds, r, approvals])
  const rows = useMemo(() =>
    status === 'All' ? all
    : status === 'Open' ? openPOs
    : all.filter(p => p.status === status), [all, openPOs, status])
  // Late means it lands after the week it is *needed* — missing a supplier's
  // own promise matters less than missing the production date.
  const late = openPOs.filter(orderIsLate)
  const jit = openPOs.map(orderDaysEarly)
  const early = jit.length ? jit.reduce((a, b) => a + b, 0) / jit.length : 0

  // Money landing per week, split by whether it beats the date it is needed.
  const arrivals = useMemo(() => {
    const by = new Map<number, { onTime: number; late: number }>()
    for (const p of openPOs) {
      const e = by.get(p.expectedWeek) ?? { onTime: 0, late: 0 }
      const v = p.valueINR / 1e7
      if (p.expectedWeek > p.neededWeek) e.late += v
      else e.onTime += v
      by.set(p.expectedWeek, e)
    }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).slice(0, 14).map(([w, v]) => ({
      label: wkLabel(ds, w), onTime: +v.onTime.toFixed(2), late: +v.late.toFixed(2),
    }))
  }, [openPOs, ds])

  const cols: Col<PurchaseOrder>[] = [
    { key: 'id', h: 'PO', cell: p => <span className="font-mono text-sm font-semibold">{p.id}</span>, val: p => p.id },
    { key: 'm', h: 'Material', cell: p => {
      const m = ds.materials.find(x => x.id === p.materialId)
      return <><span className="font-mono text-2xs">{m?.code}</span><div className="text-2xs text-muted truncate max-w-[120px]">{m?.name}</div></>
    }, val: p => ds.materials.find(x => x.id === p.materialId)?.name ?? '' },
    { key: 's', h: 'Supplier', cell: p => <span className="text-sm">{ds.suppliers.find(x => x.id === p.supplierId)?.name.split('—')[0].trim()}</span>, val: p => p.supplierId },
    { key: 'q', h: 'Qty', right: true, cell: p => {
      const u = ds.materials.find(x => x.id === p.materialId)?.unit ?? 't'
      return fmtQty(p.qty, u, false)
    }, val: p => p.qty },
    { key: 'v', h: 'Value', right: true, cell: p => fmtINR(p.valueINR), val: p => p.valueINR },
    { key: 'e', h: 'Expected', cell: p => <span className={p.expectedWeek > p.promisedWeek ? 'text-danger font-semibold' : ''}>{wkFull(ds, p.expectedWeek)}</span>, val: p => p.expectedWeek },
    { key: 'j', h: 'Arrives', right: true, term: 'Just-in-time', cell: p => {
      const d = orderDaysEarly(p)
      return <span className={d < 0 ? 'text-danger font-semibold' : d > 28 ? 'text-warning' : 'text-success'}>
        {d < 0 ? `${-d}d late` : d === 0 ? 'on the day' : `${d}d early`}
      </span>
    }, val: p => orderDaysEarly(p) },
    { key: 'r', h: 'Received', right: true, cell: p => (
      <div className="flex items-center justify-end gap-1.5"><div className="w-10"><Bar pct={p.receivedPct} tone={p.receivedPct === 100 ? 'success' : 'primary'} /></div>
        <span className="num w-8 text-right">{p.receivedPct}%</span></div>
    ), val: p => p.receivedPct },
    { key: 'st', h: 'Status', cell: p => <Status v={p.status} />, val: p => p.status },
  ]

  const mat = open ? ds.materials.find(m => m.id === open.materialId) : null
  const sup = open ? ds.suppliers.find(s => s.id === open.supplierId) : null
  const stage = open ? STAGES.indexOf(open.status as any) : -1
  const jitDays = open ? orderDaysEarly(open) : 0

  return (
    <>
      <Head title="Orders" blurb="From recommendation to delivery, with an arrival-timing check" />

      <Tiles>
        <Tile k="Open" v={fmtNum(openPOs.length)} sub={fmtINR(openPOs.reduce((s, p) => s + p.valueINR, 0))} />
        <Tile k="Late" v={fmtNum(late.length)} tone={late.length ? 'warning' : 'success'} />
        <Tile k="Approved here" v={fmtNum(approvals.length)} tone="success" />
        <Tile k="Received" v={fmtNum(all.filter(p => p.status === 'Received').length)} />
        <Tile k="Avg arrival" v={`${early.toFixed(0)}`} unit="d early" tone={Math.abs(early) < 20 ? 'success' : 'warning'} />
        <Tile k="Total value" v={fmtINR(all.reduce((s, p) => s + p.valueINR, 0))} />
      </Tiles>

      <Panel className="mt-3" title="Where orders sit">
        <div className="flex items-stretch gap-1 overflow-x-auto no-scrollbar">
          {STAGES.map(st => {
            const n = all.filter(p => p.status === st).length
            return (
              <button key={st} onClick={() => setStatus(st)}
                className={`flex-1 min-w-[96px] rounded-lg border p-2 text-left transition-colors ${
                  status === st ? 'border-primary/50 bg-primary-soft' : 'border-line hover:bg-surface2'}`}>
                <div className="flex items-center gap-1 mb-0.5">
                  {n > 0 ? <CheckCircle2 className="w-3 h-3 text-primary" /> : <Circle className="w-3 h-3 text-muted/50" />}
                  <span className="eyebrow truncate">{st}</span>
                </div>
                <div className="num text-lg font-bold">{n}</div>
              </button>
            )
          })}
        </div>
      </Panel>

      <div className="mt-3">
        <Chart title="What arrives when" h={190}
          note="Open orders only, in crore, by the week they are expected. Red is money arriving after the week it is needed.">
          <Bars data={arrivals} x="label" unit=" Cr" stacked
            bars={[{ k: 'onTime', name: 'In time', color: C.success },
                   { k: 'late', name: 'Too late', color: C.danger }]} />
        </Chart>
      </div>

      <Panel className="mt-3" pad={false}><div className="pad">
        <div className="flex flex-wrap gap-1 mb-2">
          <button onClick={() => setStatus('Open')} className={`chip ${status === 'Open' ? 'chip-primary' : 'chip-neutral'}`}>Open {openPOs.length}</button>
          <button onClick={() => setStatus('All')} className={`chip ${status === 'All' ? 'chip-primary' : 'chip-neutral'}`}>All {all.length}</button>
          {STAGES.map(s => {
            const n = all.filter(p => p.status === s).length
            return n === 0 ? null : (
              <button key={s} onClick={() => setStatus(s)} className={`chip ${status === s ? 'chip-primary' : 'chip-neutral'}`}>{s} {n}</button>
            )
          })}
        </div>
        <Table rows={rows} cols={cols} rowKey={p => p.id} onRow={p => setOpen(p)}
          search={p => `${p.id} ${ds.materials.find(x => x.id === p.materialId)?.name} ${p.status}`}
          sort={{ key: 'e', dir: 'asc' }} csv="orders" page={16} />
      </div></Panel>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.id ?? ''} sub={mat?.name}
        chips={open && <Status v={open.status} />}>
        {open && mat && sup && (
          <>
            <Panel title="Progress">
              <div className="flex items-stretch gap-1">
                {STAGES.map((st, i) => (
                  <div key={st} className={`flex-1 rounded-lg border p-1.5 ${
                    i === stage ? 'border-primary bg-primary text-primary-fg'
                    : i < stage ? 'border-primary/40 bg-primary-soft' : 'border-line opacity-45'}`}>
                    <div className="eyebrow truncate text-center">{st.split(' ')[0]}</div>
                  </div>
                ))}
              </div>
            </Panel>
            <LVRow cols={4} items={[
              { k: 'Quantity', v: fmtQty(open.qty, mat.unit) },
              { k: 'Value', v: fmtINR(open.valueINR) },
              { k: 'Received', v: `${open.receivedPct}%` },
              { k: 'Payment', v: open.payment },
            ]} />
            <LVRow cols={4} items={[
              { k: 'Ordered', v: wkFull(ds, open.orderWeek) },
              { k: 'Promised', v: wkFull(ds, open.promisedWeek) },
              { k: 'Expected', v: wkFull(ds, open.expectedWeek), tone: open.expectedWeek > open.promisedWeek ? 'danger' : undefined },
              { k: 'Needed', v: wkFull(ds, open.neededWeek) },
            ]} />
            <div className={`rounded-lg border px-3 py-2 ${jitDays < 0 ? 'border-danger/25 bg-danger-soft' : jitDays > 28 ? 'border-warning/25 bg-warning-soft' : 'border-success/25 bg-success-soft'}`}>
              <div className="num text-lg font-bold">{jitDays < 0 ? `${-jitDays} days late` : `${jitDays} days early`}</div>
              <p className="text-2xs text-muted mt-0.5">
                {jitDays < 0 ? 'Arrives after it is needed.' : jitDays > 28 ? 'Arrives well before it is needed — paying to store it.' : 'Close to just-in-time.'}
              </p>
            </div>
            <Panel title="Supplier">
              <div className="text-base font-semibold mb-1.5">{sup.name}</div>
              <LVRow cols={4} items={[
                { k: 'On time', v: `${sup.otifPct}%`, tone: sup.otifPct >= 90 ? 'success' : 'warning' },
                { k: 'Quality', v: `${sup.qualityPct}%` },
                { k: 'Lead', v: `${sup.leadTimeDays}d` },
                { k: 'Terms', v: sup.paymentTerms },
              ]} />
            </Panel>
            {open.note && <p className="text-2xs text-muted">{open.note}</p>}
          </>
        )}
      </Drawer>
    </>
  )
}
