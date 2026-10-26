import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Check, X, Pencil, ShieldAlert, Send, SlidersHorizontal, ArrowRight } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Head, Tile, Tiles, Panel, Chip, Status, Confidence, Drawer, LVRow, Modal, Field, Empty } from '@/ui/kit'
import { Chart, Bars, Lines, useC } from '@/ui/charts'
import { fmtINR, fmtNum, fmtQty, fmtDue, fmtCover, fmtDate, fmtSigned, addDays } from '@/lib/format'
import {
  isOverdue, selectNetCashINR, selectPurchaseSpendINR, selectCashFreedINR,
  selectOpenRecommendations, canApprove,
} from '@/engine/selectors'
import { groupAnomalies } from '@/engine/anomaly'
import { weekDate } from '@/data/generate'
import { wkFull, wkLabel } from '@/lib/view'
import type { Recommendation } from '@/engine/procurement'

/** A reason a planner can follow back to the screen that produced it. */
interface Reason { text: string; to: string }

export default function Buy() {
  const C = useC()
  const {
    result, ds, settings, role, setRole, approvals, rejected, sentToBuyer,
    approveRecommendation, rejectRecommendation, sendToBuyer,
  } = useStore()
  const r = result!
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const [type, setType] = useState('All')
  const [mode, setMode] = useState<null | 'approve' | 'edit' | 'reject' | 'send'>(null)
  const [qty, setQty] = useState(''), [note, setNote] = useState('')

  const mayApprove = canApprove(role)
  const waiting = useMemo(() => selectOpenRecommendations(r, approvals, rejected), [r, approvals, rejected])
  const list = useMemo(() => waiting.filter(x => type === 'All' || x.type === type), [waiting, type])

  // ---------------------------------------------------------------------
  // Selection lives in the URL, so a refresh or the back button keeps the
  // panel open on the same material. Keyed by material code rather than the
  // internal recommendation id — one recommendation is raised per material,
  // and a code is something a person can read and share.
  // ---------------------------------------------------------------------
  const openCode = sp.get('r')
  const open = openCode ? r.recommendations.find(x => x.materialCode === openCode) ?? null : null
  const select = useCallback((code: string | null) => {
    setSp(p => { code ? p.set('r', code) : p.delete('r'); return p }, { replace: true })
  }, [setSp])

  // Arrow keys walk the list without going back to the mouse.
  useEffect(() => {
    if (!open || mode) return
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const pool = list.length ? list : waiting
      const i = pool.findIndex(x => x.materialCode === open.materialCode)
      if (i < 0) return
      e.preventDefault()
      const next = pool[e.key === 'ArrowDown' ? Math.min(i + 1, pool.length - 1) : Math.max(i - 1, 0)]
      if (next) select(next.materialCode)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, mode, list, waiting, select])

  const buys = r.recommendations.filter(x => x.valueINR > 0)
  const cuts = r.recommendations.filter(x => x.valueINR < 0)
  const net = selectNetCashINR(r)

  // ---------------------------------------------------------------------
  // Everything the panel needs about the selected recommendation
  // ---------------------------------------------------------------------
  const detail = useMemo(() => {
    if (!open) return null
    const mat = r.materials.find(m => m.materialId === open.materialId)
    const raw = ds.materials.find(m => m.id === open.materialId)
    if (!mat || !raw) return null

    const isCut = open.type === 'Reduce / delay'
    const today = weekDate(ds, r.todayWeek)
    const orderByDate = addDays(today, open.orderByDays)
    const runOutDate = addDays(today, Math.round(mat.inv.daysToStockout))

    /**
     * Why this is on the list, in the material's own terms.
     *
     * The old panel reused one sentence about steel grades for every material,
     * so wooden skids and nickel cathode carried identical explanations. These
     * are built from this material's own position and each links back to the
     * screen that produced it.
     */
    const why: Reason[] = []
    if (isCut) {
      why.push({
        text: `Holding ${fmtCover(mat.inv.daysOfCover)} against a ${settings.excessCoverDays}-day target`,
        to: `/stock?m=${open.materialId}`,
      })
      if (raw.shelfLifeDays) {
        why.push({ text: `Shelf life is ${raw.shelfLifeDays} days`, to: `/stock?m=${open.materialId}` })
      }
    } else {
      why.push({
        text: `Only ${fmtCover(mat.inv.daysOfCover)} of stock left`,
        to: `/stock?m=${open.materialId}`,
      })
      why.push({
        text: `Supplier lead time ${raw.leadTimeDays} days${raw.leadTimeSdDays ? ` (± ${raw.leadTimeSdDays})` : ''}`,
        to: `/stock?m=${open.materialId}`,
      })
    }

    // The demand shift driving it, if one is linked.
    const linked = r.anomalies.filter(a => open.linkedAnomalyIds.includes(a.id))
    if (linked.length) {
      const g = groupAnomalies(linked)[0]
      const lead = [...linked].sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))[0]
      why.push({
        text: `Grade ${g.grade} demand in ${g.region} ${g.avgDeltaPct > 0 ? 'up' : 'down'} ` +
          `${Math.abs(g.avgDeltaPct).toFixed(0)}% across ${g.products} product${g.products === 1 ? '' : 's'}`,
        to: `/forecast?s=${lead.skuId}`,
      })
    }
    const sig = ds.signals.find(s => open.linkedSignalIds.includes(s.id))
    if (sig && why.length < 4) {
      why.push({ text: `${sig.title} (${fmtSigned(sig.effectPct)})`, to: '/signals' })
    }

    /**
     * Stock with this order against stock without it.
     *
     * The point of the panel in one picture: the "without" line is what the
     * Stock screen already projects, and the "with" line adds the delivery on
     * the week it would land (or removes it, for a delay).
     */
    const delta = isCut ? -open.qty : open.qty
    const fromWeek = open.expectedArrivalWeek
    const chart = mat.projection.map(p => ({
      label: wkLabel(ds, p.week),
      without: +p.onHand.toFixed(1),
      with: +Math.max(0, p.onHand + (p.week >= fromWeek ? delta : 0)).toFixed(1),
      safety: +p.safety.toFixed(1),
      reorder: +p.reorder.toFixed(1),
    }))

    const chosen = ds.suppliers.find(s => s.id === open.supplierId)
    const alts = [raw.primarySupplierId, ...raw.backupSupplierIds]
      .filter(id => id !== open.supplierId)
      .map(id => ds.suppliers.find(s => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map(s => {
        const price = Math.round(raw.costPerUnit * (1 + s.priceVariancePct / 100))
        return { s, price, extra: Math.round((price - open.pricePerUnit) * open.qty) }
      })

    // What stops if this material runs out.
    const skus = mat.usedBySkus.map(id => ds.skus.find(x => x.id === id)).filter(Boolean)
    const lineIds = new Set(skus.flatMap(x => x!.lineIds))
    const lines = ds.lines.filter(l => lineIds.has(l.id)).map(l => l.process)

    return { mat, raw, isCut, orderByDate, runOutDate, why, chart, chosen, alts, skus, lines }
  }, [open, r, ds, settings.excessCoverDays])

  // Spend and release side by side, by the week the order has to leave.
  const byWeek = useMemo(() => {
    const by = new Map<number, { spend: number; release: number }>()
    for (const x of r.recommendations) {
      const w = Math.max(r.todayWeek, x.orderByWeek)
      const e = by.get(w) ?? { spend: 0, release: 0 }
      if (x.valueINR > 0) e.spend += x.valueINR / 1e7
      else e.release += x.valueINR / 1e7
      by.set(w, e)
    }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).slice(0, 12).map(([w, v]) => ({
      label: wkLabel(ds, w), spend: +v.spend.toFixed(2), release: +v.release.toFixed(2),
    }))
  }, [r, ds])

  // The ranked queue as a picture: how much is riding on each decision.
  const exposure = useMemo(() => [...r.recommendations]
    .sort((a, b) => b.revenueAtRiskINR - a.revenueAtRiskINR).slice(0, 8).reverse()
    .map(x => ({
      name: x.materialCode,
      risk: +(x.revenueAtRiskINR / 1e7).toFixed(1),
      cost: +(Math.abs(x.valueINR) / 1e7).toFixed(1),
    })), [r.recommendations])

  const go = (rec: Recommendation, m: typeof mode) => {
    select(rec.materialCode); setMode(m); setQty(String(rec.qty)); setNote('')
  }
  const confirm = () => {
    if (!open || !mode) return
    if (mode === 'reject') rejectRecommendation(open.id, note)
    else if (mode === 'send') sendToBuyer(open.id, note)
    else approveRecommendation(open.id, Number(qty) || open.qty, note)
    setMode(null); select(null)
  }

  /** One line a person can read out loud. */
  const decision = (rec: Recommendation) => rec.type === 'Reduce / delay'
    ? `Delay next delivery of ${fmtQty(rec.qty, rec.unit)} from ${rec.supplierName.split('—')[0].trim()}`
    : `Order ${fmtQty(rec.qty, rec.unit)} from ${rec.supplierName.split('—')[0].trim()} by ` +
      `${fmtDate(addDays(weekDate(ds, r.todayWeek), rec.orderByDays))}`

  return (
    <>
      <Head title="Recommendations" blurb="What to buy, how much, from whom, and by when"
        chips={!mayApprove ? <Chip tone="warning"><ShieldAlert className="w-2.5 h-2.5" /> Planner view</Chip> : undefined} />

      <Tiles>
        <Tile k="Waiting" v={fmtNum(waiting.length)} />
        <Tile k="Order-by passed" v={fmtNum(waiting.filter(x => isOverdue(x.orderByDays)).length)} tone="danger" />
        <Tile k="To spend" v={fmtINR(selectPurchaseSpendINR(r))} sub={`${buys.length} buys`} tone="warning" />
        <Tile k="To release" v={fmtINR(selectCashFreedINR(r))} sub={`${cuts.length} cuts`} tone="success" />
        <Tile k="Approved" v={fmtNum(approvals.length)} to="/orders" sub={fmtINR(approvals.reduce((s, a) => s + a.valueINR, 0))} />
        <Tile k={net >= 0 ? 'Net cash freed' : 'Net cash out'} v={fmtINR(Math.abs(net))}
          tone={net >= 0 ? 'success' : 'warning'} sub={net >= 0 ? 'release beats spend' : 'spend beats release'} />
      </Tiles>

      <div className="grid gap-3 lg:grid-cols-2 mt-3">
        <Chart title="Cash out and cash back, by order-by week" h={200}
          note="Crore. Spend is money leaving for purchases; release is money coming back from stock we do not need.">
          <Bars data={byWeek} x="label" unit=" Cr"
            bars={[{ k: 'spend', name: 'To spend', color: C.danger },
                   { k: 'release', name: 'To release', color: C.success }]} />
        </Chart>
        <Chart title="What is riding on each decision" h={200}
          note="Crore. Production value exposed if nobody acts, against what the order itself costs.">
          <Bars data={exposure} x="name" h unit=" Cr"
            bars={[{ k: 'risk', name: 'Production at risk', color: C.danger },
                   { k: 'cost', name: 'Order value', color: C.primary }]} />
        </Chart>
      </div>

      <div className="flex flex-wrap gap-1 mb-2">
        {['All', 'Order now', 'Expedite', 'Reduce / delay'].map(t => {
          const n = t === 'All' ? waiting.length : waiting.filter(x => x.type === t).length
          if (t !== 'All' && n === 0) return null
          return (
            <button key={t} onClick={() => setType(t)} className={`chip ${type === t ? 'chip-primary' : 'chip-neutral'}`}>
              {t} {n}
            </button>
          )
        })}
      </div>

      {list.length === 0 ? <Panel><Empty title="Nothing waiting" hint="All decided." /></Panel> : (
        <div className="space-y-1.5">
          {list.map(rec => (
            // The whole row opens the panel. The action buttons stop the click
            // so approving does not also open a drawer behind the modal.
            <div key={rec.id} role="button" tabIndex={0}
              onClick={() => select(rec.materialCode)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(rec.materialCode) } }}
              className={`card pad cursor-pointer transition-colors hover:border-primary/40 hover:bg-primary-soft/30
                ${rec.urgency === 'Critical' ? 'border-danger/30' : ''}
                ${open?.materialCode === rec.materialCode ? 'border-primary bg-primary-soft/40' : ''}`}>
              <div className="flex flex-wrap items-center gap-2.5">
                <Status v={rec.urgency} /><Status v={rec.type} />
                <span className="font-mono text-sm font-semibold">{rec.materialCode}</span>
                <div className="min-w-[200px] flex-1">
                  <div className="text-base font-semibold">
                    {rec.type === 'Reduce / delay' ? 'Release' : 'Order'} <span className="num">{fmtQty(rec.qty, rec.unit)}</span>
                    <span className="text-muted font-normal"> · {rec.supplierName.split('—')[0].trim()}</span>
                  </div>
                  <div className="text-2xs text-muted truncate">{rec.reason}</div>
                </div>
                {sentToBuyer[rec.id] && <Chip tone="info"><Send className="w-2.5 h-2.5" /> sent</Chip>}
                <div className="text-right">
                  <div className={`num text-base font-bold ${rec.valueINR < 0 ? 'text-success' : ''}`}>{fmtINR(Math.abs(rec.valueINR))}</div>
                  <div className="text-2xs text-muted">{rec.valueINR < 0 ? 'freed' : 'cost'}</div>
                </div>
                <div className="text-right w-16">
                  {rec.type === 'Reduce / delay' ? (
                    <>
                      <div className="num text-base font-bold text-muted">&mdash;</div>
                      <div className="text-2xs text-muted">no deadline</div>
                    </>
                  ) : (
                    <>
                      <div className={`num text-base font-bold ${isOverdue(rec.orderByDays) ? 'text-danger' : rec.orderByDays <= 7 ? 'text-warning' : ''}`}>
                        {fmtDue(rec.orderByDays)}
                      </div>
                      <div className="text-2xs text-muted">order by</div>
                    </>
                  )}
                </div>
                <Confidence v={rec.confidence} />
                <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                  {mayApprove ? (
                    <>
                      <button className="btn btn-primary btn-xs" title="Approve" onClick={() => go(rec, 'approve')}><Check className="w-3 h-3" /></button>
                      <button className="btn btn-outline btn-xs" title="Edit quantity" onClick={() => go(rec, 'edit')}><Pencil className="w-3 h-3" /></button>
                      <button className="btn btn-ghost btn-xs" title="Reject" onClick={() => go(rec, 'reject')}><X className="w-3 h-3" /></button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-primary btn-xs" title="Send to buyer" onClick={() => go(rec, 'send')}><Send className="w-3 h-3" /></button>
                      <button className="btn btn-ghost btn-xs" title="Dismiss with reason" onClick={() => go(rec, 'reject')}><X className="w-3 h-3" /></button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* The decision panel                                                */}
      {/* ---------------------------------------------------------------- */}
      <Drawer open={!!open && !mode} onClose={() => select(null)}
        title={open ? `${open.materialCode} · ${open.materialName}` : ''}
        sub={open ? decision(open) : ''}
        chips={open && <><Status v={open.type} /><Status v={open.urgency} /><Confidence v={open.confidence} /></>}
        footer={open && (
          mayApprove ? (
            <div className="flex gap-1.5">
              <button className="btn btn-primary btn-md flex-1" onClick={() => go(open, 'approve')}><Check className="w-4 h-4" /> Approve</button>
              <button className="btn btn-outline btn-md" onClick={() => go(open, 'edit')}>Edit</button>
              <button className="btn btn-ghost btn-md" onClick={() => go(open, 'reject')}>Reject with reason</button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-lg border border-warning/25 bg-warning-soft px-3 py-2">
                <ShieldAlert className="w-4 h-4 text-warning shrink-0" />
                <span className="text-base flex-1">A planner cannot approve a purchase.</span>
                <button className="btn btn-outline btn-sm" onClick={() => setRole('Buyer')}>Switch to Buyer</button>
              </div>
              <div className="flex gap-1.5">
                <button className="btn btn-primary btn-md flex-1" onClick={() => go(open, 'send')}><Send className="w-4 h-4" /> Send to buyer</button>
                <button className="btn btn-outline btn-md" onClick={() => go(open, 'edit')}>Edit quantity</button>
                <button className="btn btn-ghost btn-md" onClick={() => go(open, 'reject')}>Dismiss</button>
              </div>
            </div>
          )
        )}>
        {open && detail && (
          <>
            {/* 3. The four numbers that decide it */}
            <LVRow cols={4} items={[
              { k: 'Quantity', v: fmtQty(open.qty, open.unit) },
              { k: detail.isCut ? 'Cash freed' : 'Cost', v: fmtINR(Math.abs(open.valueINR)), tone: detail.isCut ? 'success' : undefined },
              {
                k: 'Order by',
                v: detail.isCut ? 'No deadline' : isOverdue(open.orderByDays) ? `Passed ${fmtDate(detail.orderByDate)}` : fmtDate(detail.orderByDate),
                tone: !detail.isCut && isOverdue(open.orderByDays) ? 'danger' : undefined,
              },
              { k: detail.isCut ? 'Review on' : 'Arrives on', v: wkFull(ds, open.expectedArrivalWeek) },
            ]} />

            {/* 4. Why — specific to this material, each linking to its source */}
            <Panel title="Why">
              <ul className="space-y-1">
                {detail.why.map((w, i) => (
                  <li key={i}>
                    <Link to={w.to} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 hover:border-primary/40 transition-colors">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                      <span className="text-base flex-1">{w.text}</span>
                      <ArrowRight className="w-3 h-3 text-muted/60 shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>

            {/* 5. The picture: with this order against without it */}
            <Chart title={detail.isCut ? 'Stock with and without this release' : 'Stock with and without this order'} h={200}
              note={detail.isCut
                ? 'Releasing the surplus brings stock down towards the target without touching the safety level.'
                : 'The lower line is what happens if nobody orders. Where it crosses the safety level, the buffer is gone.'}>
              <Lines data={detail.chart} x="label" unit={` ${open.unit}`} lines={[
                { k: 'with', name: detail.isCut ? 'With release' : 'With this order', color: C.primary },
                { k: 'without', name: 'Without it', color: C.danger },
                { k: 'safety', name: 'Safety', color: C.warning, dash: true },
                { k: 'reorder', name: 'Reorder', color: C.muted, dash: true },
              ]} />
            </Chart>

            {/* 6. Supplier and the alternatives */}
            <Panel title="Supplier">
              {detail.chosen && (
                <div className="rounded-lg border border-primary/30 bg-primary-soft/50 px-2.5 py-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold flex-1 truncate">{detail.chosen.name}</span>
                    <Chip tone="primary">chosen</Chip>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-1.5">
                    <div><div className="text-2xs text-muted">Lead time</div><div className="num text-base font-semibold">{detail.chosen.leadTimeDays}d</div></div>
                    <div><div className="text-2xs text-muted">On time</div><div className={`num text-base font-semibold ${detail.chosen.otifPct < 85 ? 'text-danger' : ''}`}>{detail.chosen.otifPct}%</div></div>
                    <div><div className="text-2xs text-muted">Price</div><div className="num text-base font-semibold">{fmtINR(open.pricePerUnit)}/{open.unit}</div></div>
                  </div>
                </div>
              )}
              <p className="text-2xs text-muted mb-2">{open.supplierNote}</p>
              {detail.alts.length > 0 ? (
                <div className="space-y-1">
                  {detail.alts.map(({ s, extra }) => (
                    <div key={s.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
                      <span className="text-base flex-1 truncate">{s.name}</span>
                      <span className="num text-2xs text-muted">{s.leadTimeDays}d</span>
                      <span className="num text-2xs text-muted">{s.otifPct}%</span>
                      <span className={`num text-sm font-semibold w-20 text-right ${extra > 0 ? 'text-danger' : extra < 0 ? 'text-success' : 'text-muted'}`}>
                        {extra === 0 ? 'same' : `${extra > 0 ? '+' : '−'}${fmtINR(Math.abs(extra)).replace('−', '')}`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : <Chip tone="warning">no approved alternative</Chip>}
            </Panel>

            {/* 7. The cost of doing nothing */}
            <Panel className="border-warning/30" title="If we do nothing">
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div className="rounded-lg border border-danger/25 bg-danger-soft p-2.5">
                  <div className="eyebrow">Production at risk</div>
                  <div className="num text-lg font-bold text-danger mt-0.5">{fmtINR(open.revenueAtRiskINR)}</div>
                </div>
                <div className="rounded-lg border border-line bg-surface2 p-2.5">
                  <div className="eyebrow">{detail.isCut ? 'Cash stays tied up' : 'Runs out on'}</div>
                  <div className="num text-lg font-bold mt-0.5">
                    {detail.isCut ? fmtINR(Math.abs(open.valueINR)) : fmtDate(detail.runOutDate)}
                  </div>
                </div>
              </div>
              <p className="text-base">{open.ifIgnored}</p>
              {!detail.isCut && detail.skus.length > 0 && (
                <div className="mt-2 pt-2 border-t border-line">
                  <div className="eyebrow mb-1">Stops {detail.skus.length} product{detail.skus.length === 1 ? '' : 's'} on {detail.lines.length} line{detail.lines.length === 1 ? '' : 's'}</div>
                  <div className="flex flex-wrap gap-1">
                    {detail.skus.slice(0, 6).map(sk => (
                      <Link key={sk!.id} to={`/forecast?s=${sk!.id}`} className="chip chip-neutral hover:chip-primary font-mono">{sk!.code}</Link>
                    ))}
                    {detail.skus.length > 6 && <Chip tone="neutral">+{detail.skus.length - 6} more</Chip>}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {detail.lines.map(l => <Chip key={l} tone="info">{l}</Chip>)}
                  </div>
                </div>
              )}
            </Panel>

            {/* 8. Price the alternatives properly */}
            <button className="btn btn-outline btn-md w-full"
              onClick={() => nav(`/simulate?m=${open.materialId}`)}>
              <SlidersHorizontal className="w-4 h-4" /> Compare options
            </button>

            <p className="text-2xs text-muted text-center">
              Esc closes · ↑ ↓ moves between recommendations
            </p>
          </>
        )}
      </Drawer>

      <Modal open={!!mode} onClose={() => setMode(null)}
        title={mode === 'reject' ? (mayApprove ? 'Reject with reason' : 'Dismiss with reason')
          : mode === 'edit' ? 'Edit quantity'
          : mode === 'send' ? 'Send to buyer' : 'Approve'}>
        {open && (
          <div className="space-y-2.5">
            <LVRow cols={2} items={[
              { k: 'Material', v: open.materialCode },
              { k: 'Supplier', v: open.supplierName.split('—')[0].trim() },
            ]} />
            <p className="text-base text-muted">{decision(open)}</p>
            {mode !== 'reject' && (
              <Field label={`Quantity (${open.unit})`}>
                <input className="input" type="number" value={qty} disabled={mode === 'approve'} onChange={e => setQty(e.target.value)} />
              </Field>
            )}
            {mode !== 'reject' && (
              <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                <span className="text-base text-muted">Order value</span>
                <span className="num text-lg font-bold">{fmtINR((Number(qty) || open.qty) * open.pricePerUnit)}</span>
              </div>
            )}
            <Field label={mode === 'reject' ? 'Reason (required)' : 'Note'}>
              <textarea className="input h-16 py-1.5" value={note} onChange={e => setNote(e.target.value)} />
            </Field>
            <div className="flex gap-1.5 justify-end">
              <button className="btn btn-outline btn-md" onClick={() => setMode(null)}>Cancel</button>
              <button className={`btn btn-md ${mode === 'reject' ? 'btn-danger' : 'btn-primary'}`}
                disabled={mode === 'reject' && !note.trim()} onClick={confirm}>
                {mode === 'reject' ? (mayApprove ? 'Reject' : 'Dismiss')
                  : mode === 'send' ? 'Send' : 'Approve'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
