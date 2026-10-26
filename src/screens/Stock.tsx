import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowRightLeft } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Head, Tile, Tiles, Panel, Chip, Status, Tabs, Bar, Ring, Drawer, LVRow, Calc, Why } from '@/ui/kit'
import { Chart, StockChart, Bars, Lines, useC } from '@/ui/charts'
import { Table, type Col } from '@/ui/Table'
import { fmtINR, fmtNum, fmtPct, fmtQty, fmtCover } from '@/lib/format'
import { wkLabel, toneForCover } from '@/lib/view'
import type { MaterialView } from '@/engine'

export default function Stock() {
  const C = useC()
  const { result, ds, settings } = useStore()
  const r = result!
  const [sp, setSp] = useSearchParams()
  const [tab, setTab] = useState('list')
  const [status, setStatus] = useState('All')
  const openId = sp.get('m')
  const open = openId ? r.materials.find(m => m.materialId === openId) ?? null : null
  const setOpen = (id: string | null) => setSp(p => { id ? p.set('m', id) : p.delete('m'); return p }, { replace: true })

  const rows = useMemo(() => r.materials.filter(m => status === 'All' || m.inv.status === status), [r.materials, status])
  const transfers = r.materials.filter(m => m.transferSuggestion)

  const proj = open ? open.projection.map(p => ({
    label: wkLabel(ds, p.week), onHand: p.onHand, safety: p.safety, reorder: p.reorder,
  })) : []
  const raw = open ? ds.materials.find(m => m.id === open.materialId)! : null
  const sup = raw ? ds.suppliers.find(s => s.id === raw.primarySupplierId)! : null
  const backups = raw ? raw.backupSupplierIds.map(b => ds.suppliers.find(s => s.id === b)!).filter(Boolean) : []
  const recs = open ? r.recommendations.filter(x => x.materialId === open.materialId) : []

  const pegging = useMemo(() => {
    if (!open) return []
    return open.usedBySkus.map(id => {
      const sk = ds.skus.find(s => s.id === id)!
      const bl = (ds.bom[id] ?? []).find(b => b.materialId === open.materialId)!
      const f = r.skuForecasts.find(x => x.skuId === id)!
      return { code: sk.code, grade: sk.grade, need: f.total[0] * bl.qtyPerTonne * (1 + bl.scrapPct / 100) }
    }).sort((a, b) => b.need - a.need).slice(0, 8)
  }, [open, ds, r.skuForecasts])

  const cols: Col<MaterialView>[] = [
    { key: 'c', h: 'Material', w: '170px', cell: m => (
      <div><div className="font-mono text-sm font-semibold">{m.code}</div><div className="text-2xs text-muted truncate">{m.name}</div></div>
    ), val: m => `${m.code} ${m.name}` },
    { key: 'oh', h: 'On hand', right: true, cell: m => fmtQty(m.onHand, m.unit), val: m => m.onHand },
    { key: 'cov', h: 'Cover', right: true, term: 'Days of cover', cell: m => (
      <div className="flex items-center justify-end gap-1.5">
        <div className="w-10"><Bar pct={Math.min(100, (m.inv.daysOfCover / 70) * 100)} tone={toneForCover(m.inv.daysOfCover)} /></div>
        <span className="num w-14 text-right">{fmtCover(m.inv.daysOfCover)}</span>
      </div>
    ), val: m => m.inv.daysOfCover },
    { key: 'ss', h: 'Safety', right: true, term: 'Safety stock', cell: m => fmtQty(m.inv.safetyStock, m.unit, false), val: m => m.inv.safetyStock },
    { key: 'rop', h: 'Reorder', right: true, term: 'Reorder point', cell: m => fmtQty(m.inv.reorderPoint, m.unit, false), val: m => m.inv.reorderPoint },
    { key: 'old', h: 'Old rule', right: true, cell: m => <span className="text-muted">{fmtQty(m.inv.staticMinLevel, m.unit, false)}</span>, val: m => m.inv.staticMinLevel },
    { key: 'ob', h: 'Order by', right: true, term: 'Order by', cell: m => m.inv.status === 'Excess'
      ? <span className="text-muted">&mdash;</span>
      : m.inv.orderByDays < 0
        ? <span className="text-danger font-semibold">passed</span>
        : `${Math.round(m.inv.orderByDays)}d`, val: m => m.inv.orderByDays },
    { key: 'lt', h: 'Lead', right: true, cell: m => `${ds.materials.find(x => x.id === m.materialId)!.leadTimeDays}d`, val: m => ds.materials.find(x => x.id === m.materialId)!.leadTimeDays },
    { key: 'v', h: 'Value', right: true, cell: m => fmtINR(m.inv.stockValue), val: m => m.inv.stockValue },
    { key: 'h', h: 'Health', right: true, cell: m => <span className={`num font-semibold ${m.inv.healthScore >= 75 ? 'text-success' : m.inv.healthScore >= 50 ? 'text-warning' : 'text-danger'}`}>{m.inv.healthScore}</span>, val: m => m.inv.healthScore },
    { key: 's', h: 'Status', cell: m => <Status v={m.inv.status} />, val: m => m.inv.status },
  ]

  // Every material's projection, added up in money. This is the one line that
  // answers "are we holding more or less next month" without opening a row.
  const valueProj = useMemo(() => {
    const weeks = r.materials[0]?.projection ?? []
    // Start from where we actually are. The first projected point is already a
    // week of consumption in, so the line used to open well below the Stock
    // value card above it and look like a different number.
    const floorNow = r.materials.reduce((s, m) => s + m.inv.safetyStock * m.costPerUnit, 0)
    const today = {
      label: 'now',
      stock: +(r.kpis.inventoryValueINR / 1e7).toFixed(1),
      floor: +(floorNow / 1e7).toFixed(1),
    }
    return [today, ...weeks.map((_, i) => {
      let stock = 0, floor = 0
      for (const m of r.materials) {
        const p = m.projection[i]
        if (!p) continue
        stock += Math.max(0, p.onHand) * m.costPerUnit
        floor += p.safety * m.costPerUnit
      }
      return { label: wkLabel(ds, weeks[i].week), stock: +(stock / 1e7).toFixed(1), floor: +(floor / 1e7).toFixed(1) }
    })]
  }, [r.materials, r.kpis.inventoryValueINR, ds])

  // Cover below the lead time is the definition of too late: a replacement
  // order placed today cannot land before the stock runs out.
  const tight = useMemo(() => {
    const lead = (id: string) => ds.materials.find(x => x.id === id)!.leadTimeDays
    return [...r.materials]
      .sort((a, b) => (a.inv.daysOfCover - lead(a.materialId)) - (b.inv.daysOfCover - lead(b.materialId)))
      .slice(0, 9).reverse()
      .map(m => ({ name: m.code, cover: Math.round(m.inv.daysOfCover), lead: lead(m.materialId) }))
  }, [r.materials, ds])

  const avail = Math.round(r.materials.reduce((s, m) => s + m.inv.availabilityScore, 0) / r.materials.length)
  const exc = Math.round(r.materials.reduce((s, m) => s + m.inv.excessScore, 0) / r.materials.length)

  return (
    <>
      <Head title="Stock" blurb={`${r.materials.length} materials across ${ds.warehouses.length} warehouses`}
        chips={<Chip tone="neutral">service level {fmtPct(settings.serviceLevelPct, 0)}</Chip>} />

      <Tiles>
        <Tile k="Stockout risk" v={fmtNum(r.kpis.stockoutRiskCount)} tone="danger" onClick={() => { setStatus('Stockout risk'); setTab('list') }} />
        <Tile k="At reorder" v={fmtNum(r.kpis.reorderNowCount)} tone="warning" onClick={() => { setStatus('Reorder now'); setTab('list') }} />
        <Tile k="Healthy" v={fmtNum(r.materials.filter(m => m.inv.status === 'Healthy').length)} tone="success" onClick={() => { setStatus('Healthy'); setTab('list') }} />
        <Tile k="Excess" v={fmtNum(r.kpis.excessCount)} sub={fmtINR(r.kpis.excessValueINR)} tone="info" onClick={() => { setStatus('Excess'); setTab('list') }} />
        <Tile k="Stock value" v={fmtINR(r.kpis.inventoryValueINR)} sub={`${r.kpis.daysOfInventory.toFixed(0)} days`} />
        <Tile k="Health" v={fmtNum(r.kpis.inventoryHealth)} unit="/100" tone={r.kpis.inventoryHealth >= 75 ? 'success' : 'warning'} />
      </Tiles>

      <div className="grid gap-3 lg:grid-cols-2 mt-3">
        <Chart title="Stock value — next 12 weeks" h={200}
          note="All 40 materials added up, in crore. The dashed line is the combined safety stock: the level we never plan to go below.">
          <Lines data={valueProj} x="label" unit=" Cr"
            lines={[{ k: 'stock', name: 'Projected stock', color: C.primary },
                    { k: 'floor', name: 'Safety floor', color: C.warning, dash: true }]} />
        </Chart>
        <Chart title="Cover against lead time — tightest nine" h={200}
          note="Where the cover bar is shorter than the lead-time bar, ordering today is already late.">
          <Bars data={tight} x="name" h unit=" d"
            bars={[{ k: 'cover', name: 'Days of cover', color: C.primary },
                   { k: 'lead', name: 'Lead time', color: C.danger }]} />
        </Chart>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-3 mb-2">
        {['All', 'Stockout risk', 'Reorder now', 'Healthy', 'Excess'].map(s => (
          <button key={s} onClick={() => setStatus(s)} className={`chip ${status === s ? 'chip-primary' : 'chip-neutral'}`}>{s}</button>
        ))}
        <div className="flex-1" />
        <Tabs active={tab} onChange={setTab} tabs={[
          { id: 'list', label: 'List', n: rows.length }, { id: 'regions', label: 'Regions' }, { id: 'health', label: 'Health' },
        ]} />
      </div>

      {tab === 'list' && (
        <Panel pad={false}><div className="pad">
          <Table rows={rows} cols={cols} rowKey={m => m.materialId} onRow={m => setOpen(m.materialId)}
            search={m => `${m.code} ${m.name} ${m.category}`} sort={{ key: 'cov', dir: 'asc' }} csv="stock" page={16} />
          {/* This legend used to describe a 7/14-day rule the Status column
              does not use, so a material with 23 days of cover reading
              "Stockout risk" looked like a bug. It describes the real rule now:
              cover is judged against each material's own lead time. */}
          <p className="text-2xs text-muted mt-2 leading-relaxed">
            <b>Stockout risk</b>: cover is shorter than the lead time, so a replacement order cannot land in time.
            <span className="mx-1">·</span>
            <b>Reorder now</b>: stock plus deliveries already on the way has reached the reorder point.
            <span className="mx-1">·</span>
            <b>Excess</b>: cover beyond the {settings.excessCoverDays}-day target.
            <span className="mx-1">·</span>
            <b>Healthy</b>: none of these.
          </p>
        </div></Panel>
      )}

      {tab === 'regions' && (
        <div className="space-y-3">
          <Panel title="Quantity and days of cover by warehouse" pad={false}>
            <div className="overflow-auto pad">
              <table className="w-full border-collapse">
                <thead><tr>
                  <th className="th">Material</th>
                  {ds.warehouses.map(w => (
                    <th key={w.id} className="th text-right" title={w.name}>
                      {w.name.replace(' Warehouse', '').replace('Distribution', 'Dist.')}
                    </th>
                  ))}
                  <th className="th text-right">Total</th><th className="th"></th>
                </tr></thead>
                <tbody>
                  {rows.filter(m => Object.keys(m.coverByRegion).length > 1).slice(0, 18).map(m => (
                    <tr key={m.materialId} className="tr cursor-pointer" onClick={() => setOpen(m.materialId)}>
                      <td className="td"><span className="font-mono text-sm font-semibold">{m.code}</span></td>
                      {ds.warehouses.map(w => {
                        const c = m.coverByRegion[w.id]
                        return <td key={w.id} className="td text-right num">
                          {c ? <><div>{fmtNum(c.qty, 0)}</div><div className={`text-2xs ${c.days < 10 ? 'text-danger' : c.days > 70 ? 'text-warning' : 'text-muted'}`}>{c.days.toFixed(0)}d</div></>
                             : <span className="text-muted/50">–</span>}
                        </td>
                      })}
                      <td className="td text-right num font-semibold">{fmtQty(m.onHand, m.unit, false)}</td>
                      <td className="td">{m.transferSuggestion && <Chip tone="primary"><ArrowRightLeft className="w-2.5 h-2.5" /> move</Chip>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          {transfers.length > 0 && (
            <Panel title="Transfer instead of buy" right={<Chip tone="primary">{transfers.length}</Chip>}>
              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">
                {transfers.slice(0, 8).map(m => {
                  const t = m.transferSuggestion!
                  const from = ds.warehouses.find(w => w.id === t.fromWh)!, to = ds.warehouses.find(w => w.id === t.toWh)!
                  return (
                    <button key={m.materialId} onClick={() => setOpen(m.materialId)}
                      className="rounded-lg border border-line bg-surface2 p-2.5 text-left hover:border-primary/40 transition-colors">
                      <div className="font-mono text-sm font-semibold">{m.code}</div>
                      <div className="flex items-center gap-1 text-2xs text-muted mt-1">
                        {from.region} <ArrowRightLeft className="w-2.5 h-2.5 text-primary" /> {to.region}
                      </div>
                      <div className="num text-base font-bold mt-0.5">{fmtQty(t.qty, m.unit)}</div>
                      <div className="text-2xs text-muted">{t.days}d vs {ds.materials.find(x => x.id === m.materialId)!.leadTimeDays}d buy</div>
                    </button>
                  )
                })}
              </div>
            </Panel>
          )}
        </div>
      )}

      {tab === 'health' && (
        <div className="grid gap-3 lg:grid-cols-3">
          <Panel title="Overall">
            <div className="flex items-center gap-3 mb-3">
              <Ring v={r.kpis.inventoryHealth} size={64} />
              <div>
                <div className="num text-2xl font-bold leading-none">{r.kpis.inventoryHealth}<span className="text-md text-muted">/100</span></div>
                <div className="text-2xs text-muted mt-0.5">weighted by stock value</div>
              </div>
            </div>
            <div className="space-y-2">
              <div><div className="flex justify-between text-2xs mb-0.5"><span>Availability</span><span className="num font-semibold">{avail}</span></div><Bar pct={avail} tone="primary" /></div>
              <div><div className="flex justify-between text-2xs mb-0.5"><span>Excess</span><span className="num font-semibold">{exc}</span></div><Bar pct={exc} tone="info" /></div>
            </div>
          </Panel>
          <Panel className="lg:col-span-2" title="Needs more buffer / carrying too much">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <div className="eyebrow text-danger mb-1.5">Raise the buffer</div>
                <div className="space-y-1">
                  {[...rows].filter(m => m.inv.status === 'Stockout risk' || m.inv.status === 'Reorder now')
                    .sort((a, b) => a.inv.healthScore - b.inv.healthScore).slice(0, 5).map(m => (
                    <button key={m.materialId} onClick={() => setOpen(m.materialId)}
                      className="w-full flex items-center gap-2 p-1.5 rounded-lg border border-line hover:border-primary/40 transition-colors text-left">
                      <Ring v={m.inv.healthScore} size={26} />
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-2xs font-semibold">{m.code}</div>
                        <div className="text-2xs text-muted truncate">{fmtCover(m.inv.daysOfCover)} · {m.inv.status}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="eyebrow text-warning mb-1.5">Cut the order</div>
                <div className="space-y-1">
                  {[...rows].filter(m => m.inv.status === 'Excess').sort((a, b) => b.inv.excessValue - a.inv.excessValue).slice(0, 5).map(m => (
                    <button key={m.materialId} onClick={() => setOpen(m.materialId)}
                      className="w-full flex items-center gap-2 p-1.5 rounded-lg border border-line hover:border-primary/40 transition-colors text-left">
                      <Ring v={m.inv.healthScore} size={26} />
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-2xs font-semibold">{m.code}</div>
                        <div className="text-2xs text-muted truncate">{fmtCover(m.inv.daysOfCover)} · {fmtINR(m.inv.excessValue)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Panel>
        </div>
      )}

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? `${open.code} · ${open.name}` : ''}
        sub={raw ? `${raw.category} · ${raw.leadTimeDays}d lead · ${fmtINR(raw.costPerUnit)}/${raw.unit}` : ''}
        chips={open && <><Status v={open.inv.status} />{raw?.critical && <Chip tone="warning">critical</Chip>}</>}>
        {open && raw && (
          <>
            {open.demandNote && (
              <div className="rounded-lg border border-primary/25 bg-primary-soft px-3 py-2">
                <div className="eyebrow text-primary mb-0.5">Why demand moved</div>
                <p className="text-base">{open.demandNote}</p>
              </div>
            )}
            <LVRow cols={4} items={[
              { k: 'On hand', v: fmtQty(open.onHand, open.unit) },
              { k: 'Cover', v: fmtCover(open.inv.daysOfCover), tone: toneForCover(open.inv.daysOfCover) },
              { k: 'Order by', v: open.inv.status === 'Excess' ? 'No deadline' : open.inv.orderByDays < 0 ? 'Passed' : `${Math.round(open.inv.orderByDays)}d`, tone: open.inv.orderByDays < 0 ? 'danger' : undefined },
              { k: 'Health', v: open.inv.healthScore },
            ]} />
            <Chart title="Next 12 weeks" h={170}>
              <StockChart data={proj} unit={open.unit} />
            </Chart>
            <Panel title="The numbers">
              <div className="grid grid-cols-2 gap-2">
                <div><div className="text-2xs text-muted">Safety stock<Why term="Safety stock" /></div>
                  <Calc v={fmtQty(open.inv.safetyStock, open.unit, false)} label="Safety stock" formula={open.inv.explain.safetyStock} /></div>
                <div><div className="text-2xs text-muted">Reorder point<Why term="Reorder point" /></div>
                  <Calc v={fmtQty(open.inv.reorderPoint, open.unit, false)} label="Reorder point" formula={open.inv.explain.reorderPoint} /></div>
                <div><div className="text-2xs text-muted">Old fixed rule</div>
                  <div className="num text-base font-semibold text-muted">{fmtQty(open.inv.staticMinLevel, open.unit, false)}</div></div>
                <div><div className="text-2xs text-muted">Order-by<Why term="Order by" /></div>
                  <Calc v={open.inv.orderByDays <= 0 ? 'Passed' : `${Math.round(open.inv.orderByDays)}d`} label="Order-by date" formula={open.inv.explain.orderBy} /></div>
              </div>
            </Panel>
            <Panel title="Suppliers">
              <div className="space-y-1">
                {[sup!, ...backups].map((s, i) => (
                  <div key={s.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${i === 0 ? 'border-primary/30 bg-primary-soft/50' : 'border-line'}`}>
                    <span className="text-base font-medium flex-1 truncate">{s.name}</span>
                    <Chip tone={i === 0 ? 'primary' : 'info'}>{i === 0 ? 'primary' : 'backup'}</Chip>
                    <span className="num text-2xs text-muted">{s.leadTimeDays}d</span>
                    <span className="num text-2xs text-muted">{s.otifPct}%</span>
                  </div>
                ))}
                {backups.length === 0 && <Chip tone="warning">no approved alternative</Chip>}
              </div>
            </Panel>
            <Panel title="Why we need it">
              <div className="space-y-1">
                {pegging.map(p => (
                  <div key={p.code} className="flex items-center gap-2">
                    <span className="font-mono text-2xs w-32 truncate">{p.code}</span>
                    <Chip tone="neutral">{p.grade}</Chip>
                    <div className="flex-1"><Bar pct={(p.need / Math.max(...pegging.map(x => x.need))) * 100} /></div>
                    <span className="num text-2xs text-muted w-16 text-right">{fmtQty(p.need, open.unit, false)}</span>
                  </div>
                ))}
              </div>
              <p className="text-2xs text-muted mt-2">Used by grades {open.usedByGrades.join(', ')}.</p>
            </Panel>
            {recs.length > 0 && (
              <Panel title="Recommended">
                {recs.map(rec => (
                  <div key={rec.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
                    <Status v={rec.urgency} /><Status v={rec.type} />
                    <span className="num text-base ml-auto font-semibold">{fmtQty(rec.qty, rec.unit)}</span>
                    <span className="num text-2xs text-muted">{fmtINR(Math.abs(rec.valueINR))}</span>
                  </div>
                ))}
              </Panel>
            )}
          </>
        )}
      </Drawer>
    </>
  )
}
