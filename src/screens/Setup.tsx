import React, { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RotateCcw, Upload, Download, Mail, MessageSquare, Bell, FileText } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Head, Tile, Tiles, Panel, Chip, Status, Tabs, Field, Why, LV, LVRow, Empty } from '@/ui/kit'
import { Chart, Forecast as FChart } from '@/ui/charts'
import { Table, type Col } from '@/ui/Table'
import { parseCSV, downloadText } from '@/lib/csv'
import { forecastSeries, spreadsheetMethod } from '@/engine/forecast'
import { fmtINR, fmtNum, fmtPct, fmtSigned, fmtBytes } from '@/lib/format'
import { GLOSSARY_ENTRIES } from '@/content/glossary'
import { ALERT_RULES } from '@/content/alerts'
import { DEFAULT_SETTINGS } from '@/engine'
import type { Sku, Material, Supplier } from '@/data/types'

const CH: Record<string, React.ElementType> = { Email: Mail, SMS: MessageSquare, 'In-app': Bell }

export default function Setup() {
  const { settings, setSetting, resetSettings, result, ds, loading, role, toast, uploads, addUpload, removeUpload } = useStore()
  const r = result
  // Read from the URL so a link can land on a tab. The "Alert rules" button on
  // Connected systems pointed at /setup and dropped you on Parameters, which is
  // not where the alert rules are.
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'params'
  const setTab = (id: string) => setParams(id === 'params' ? {} : { tab: id }, { replace: true })
  const [on, setOn] = useState<string[]>(ALERT_RULES.map(x => x.id))
  const [dtab, setDtab] = useState('skus')
  const [up, setUp] = useState<{ name: string; series: { key: string; values: number[] }[] } | null>(null)
  const [pick, setPick] = useState(0)
  const [gq, setGq] = useState('')

  const Slider = ({ k, label, min, max, step, suffix, term }: any) => (
    <div>
      <div className="flex justify-between mb-1">
        <span className="lbl mb-0 flex items-center">{label}{term && <Why term={term} />}</span>
        <span className="num text-base font-bold text-primary">{String(settings[k as keyof typeof settings])}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} className="w-full accent-[rgb(var(--primary))]"
        value={settings[k as keyof typeof settings] as number}
        onChange={e => setSetting(k, Number(e.target.value) as any, label)} />
    </div>
  )

  // ---- upload -------------------------------------------------------------
  /**
   * Any file is accepted. Only a tabular one can become demand history: a
   * photo of a delivery note or a supplier's PDF quote is evidence attached to
   * the feed, and saying otherwise would be the screen claiming the forecast
   * had moved when it had not.
   *
   * Detection is on extension first and the browser's MIME type second,
   * because Windows frequently reports a .csv as `application/vnd.ms-excel`
   * and an exported .txt as nothing at all.
   */
  const TABULAR = /\.(csv|tsv|txt)$/i
  const isTabular = (f: File) =>
    TABULAR.test(f.name) || /^text\/(csv|plain|tab-separated-values)$/.test(f.type)

  const kindOf = (f: File): string => {
    const t = f.type || ''
    if (isTabular(f)) return 'Data'
    if (t.startsWith('image/')) return 'Image'
    if (t.startsWith('video/')) return 'Video'
    if (t.startsWith('audio/')) return 'Audio'
    if (t === 'application/pdf' || /\.pdf$/i.test(f.name)) return 'PDF'
    if (/\.(xlsx|xls|ods)$/i.test(f.name)) return 'Spreadsheet'
    if (/\.(docx?|odt|rtf)$/i.test(f.name)) return 'Document'
    if (/\.(zip|7z|rar|tar|gz)$/i.test(f.name)) return 'Archive'
    return 'File'
  }

  const handle = async (f: File) => {
    if (!isTabular(f)) {
      const kind = kindOf(f)
      addUpload({
        name: f.name, mime: f.type, sizeBytes: f.size, parsed: false, seriesCount: 0,
        note: `${kind} attached to the Manual upload feed. It is kept as evidence — only a CSV, TSV or text file can be read as demand history.`,
      })
      toast(`${f.name} attached. ${kind}s are kept with the feed but do not change the forecast.`, 'info')
      return
    }
    const { headers, rows } = parseCSV(await f.text())
    const sk = headers.find(h => /sku|product|item|code/i.test(h))
    const qt = headers.find(h => /qty|quantity|volume|sales|tonnes|demand/i.test(h))
    const rg = headers.find(h => /region|area|zone/i.test(h))
    const wk = headers.find(h => /week|period|date/i.test(h))
    if (!sk || !qt) {
      addUpload({
        name: f.name, mime: f.type, sizeBytes: f.size, parsed: false, seriesCount: 0,
        note: 'Read as a table, but no product column and quantity column were found. Attached anyway.',
      })
      toast('Need a product column and a quantity column.', 'risk')
      return
    }
    const g = new Map<string, { w: number; v: number }[]>()
    rows.forEach((row, i) => {
      const key = rg ? `${row[sk]} · ${row[rg]}` : row[sk]
      const v = Number(String(row[qt]).replace(/[^0-9.\-]/g, ''))
      if (!isFinite(v)) return
      const w = wk ? Number(String(row[wk]).replace(/[^0-9]/g, '')) || i : i
      const arr = g.get(key) ?? []; arr.push({ w, v }); g.set(key, arr)
    })
    const series = [...g.entries()].map(([key, p]) => ({ key, values: p.sort((a, b) => a.w - b.w).map(x => x.v) }))
      .filter(s => s.values.length >= 8).sort((a, b) => b.values.length - a.values.length).slice(0, 40)
    setUp({ name: f.name, series }); setPick(0)
    addUpload({
      name: f.name, mime: f.type, sizeBytes: f.size, parsed: series.length > 0, seriesCount: series.length,
      note: series.length ? 'Read as demand history and fitted below.' : 'Read as a table, but no series had the eight periods a fit needs.',
    })
    toast(`${series.length} series found in ${f.name}.`, series.length ? 'good' : 'warn')
  }
  const cur = up?.series[pick]
  const fc = cur ? forecastSeries({
    skuId: cur.key, region: '-', history: cur.values,
    priceIndex: new Array(cur.values.length + 30).fill(100),
    signalFlag: new Array(cur.values.length + 30).fill(0), horizon: 10, signalUpliftPct: 0,
  }) : null
  const upChart = cur && fc ? [
    ...cur.values.slice(-20).map((v, i) => ({ label: `P${i + 1}`, actual: +v.toFixed(1), forecast: null, band: null, old: null })),
    ...fc.forecast.map((v, i) => ({
      label: `F${i + 1}`, actual: null, forecast: +v.toFixed(1),
      band: [+fc.lower[i].toFixed(1), +fc.upper[i].toFixed(1)] as [number, number],
      old: +spreadsheetMethod(cur.values, 1)[0].toFixed(1),
    })),
  ] : []

  // ---- master data --------------------------------------------------------
  const skuCols: Col<Sku>[] = [
    { key: 'c', h: 'Code', cell: s => <span className="font-mono text-sm font-semibold">{s.code}</span>, val: s => s.code },
    { key: 'g', h: 'Grade', cell: s => <Chip tone="neutral">{s.grade}</Chip>, val: s => s.grade },
    { key: 'f', h: 'Form', cell: s => <span className="text-sm">{s.form}</span>, val: s => s.form },
    { key: 't', h: 'mm', right: true, cell: s => String(s.thicknessMm), val: s => s.thicknessMm },
    { key: 'fi', h: 'Finish', cell: s => s.finish, val: s => s.finish },
    { key: 'p', h: 'Price/t', right: true, cell: s => fmtINR(s.pricePerT), val: s => s.pricePerT },
    { key: 'm', h: 'Margin', right: true, cell: s => fmtPct(s.marginPct, 0), val: s => s.marginPct },
    { key: 'a', h: 'ABC', cell: s => <Chip tone="neutral">{s.abc}/{s.xyz}</Chip>, val: s => s.abc },
    { key: 'l', h: 'Lifecycle', cell: s => <Chip tone={s.lifecycle === 'Declining' ? 'warning' : s.lifecycle === 'Growing' ? 'success' : 'neutral'}>{s.lifecycle}</Chip>, val: s => s.lifecycle },
  ]
  const matCols: Col<Material>[] = [
    { key: 'c', h: 'Code', cell: m => <span className="font-mono text-sm font-semibold">{m.code}</span>, val: m => m.code },
    { key: 'n', h: 'Material', cell: m => <span className="text-sm">{m.name}</span>, val: m => m.name },
    { key: 'cat', h: 'Category', cell: m => <Chip tone="neutral">{m.category}</Chip>, val: m => m.category },
    { key: 'u', h: 'Unit', cell: m => m.unit, val: m => m.unit },
    { key: 'co', h: 'Cost', right: true, cell: m => fmtINR(m.costPerUnit), val: m => m.costPerUnit },
    { key: 'lt', h: 'Lead', right: true, cell: m => `${m.leadTimeDays}±${m.leadTimeSdDays}d`, val: m => m.leadTimeDays },
    { key: 'mo', h: 'MOQ', right: true, cell: m => fmtNum(m.moq), val: m => m.moq },
    { key: 'cr', h: 'Critical', cell: m => m.critical ? <Chip tone="warning">yes</Chip> : null, val: m => m.critical ? 1 : 0 },
    { key: 'alt', h: 'Alts', right: true, cell: m => m.backupSupplierIds.length || <span className="text-danger font-semibold">0</span>, val: m => m.backupSupplierIds.length },
  ]
  const supCols: Col<Supplier>[] = [
    { key: 'n', h: 'Supplier', cell: s => <span className="text-sm font-medium">{s.name}</span>, val: s => s.name },
    { key: 'lt', h: 'Lead', right: true, cell: s => `${s.leadTimeDays}±${s.leadTimeSdDays}d`, val: s => s.leadTimeDays },
    { key: 'o', h: 'On time', right: true, term: 'OTIF', cell: s => <span className={s.otifPct < 85 ? 'text-danger font-semibold' : ''}>{fmtPct(s.otifPct, 0)}</span>, val: s => s.otifPct },
    { key: 'q', h: 'Quality', right: true, cell: s => fmtPct(s.qualityPct), val: s => s.qualityPct },
    { key: 'p', h: 'Price var', right: true, cell: s => <span className={s.priceVariancePct > 4 ? 'text-danger' : s.priceVariancePct < 0 ? 'text-success' : ''}>{fmtSigned(s.priceVariancePct)}</span>, val: s => s.priceVariancePct },
    { key: 'm', h: 'Materials', right: true, cell: s => fmtNum(ds.materials.filter(m => m.primarySupplierId === s.id).length), val: s => ds.materials.filter(m => m.primarySupplierId === s.id).length },
    { key: 'r', h: 'Risk', cell: s => <Status v={s.risk === 'High' ? 'Critical' : s.risk === 'Medium' ? 'Medium' : 'Low'} />, val: s => s.risk },
  ]

  const gloss = useMemo(() => GLOSSARY_ENTRIES
    .filter(e => !gq || e.term.toLowerCase().includes(gq.toLowerCase()) || e.plain.toLowerCase().includes(gq.toLowerCase()))
    .sort((a, b) => a.term.localeCompare(b.term)), [gq])

  return (
    <>
      <Head title="Settings" blurb="Parameters, alerts, master data and the glossary"
        chips={loading ? <Chip tone="warning">recalculating</Chip> : undefined}
        actions={tab === 'params' && <button className="btn btn-outline btn-sm" onClick={resetSettings}><RotateCcw className="w-3 h-3" /> Defaults</button>} />

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'params', label: 'Parameters' }, { id: 'alerts', label: 'Alerts', n: on.length },
        { id: 'data', label: 'Master data' }, { id: 'upload', label: 'Your data' },
        { id: 'glossary', label: 'Glossary', n: GLOSSARY_ENTRIES.length },
      ]} />

      {tab === 'params' && (
        <>
          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title="Service & buffers">
              <div className="space-y-4">
                <Field label="Service level" term="Service level">
                  <select className="input" value={settings.serviceLevelPct}
                    onChange={e => setSetting('serviceLevelPct', Number(e.target.value), 'Service level')}>
                    {[90, 92, 94, 95, 96, 97, 98, 99].map(v => <option key={v} value={v}>{v}%</option>)}
                  </select>
                </Field>
                <Slider k="leadTimeBufferDays" label="Lead-time buffer" min={0} max={14} step={1} suffix="d" term="Lead time" />
                <Slider k="excessCoverDays" label="Excess target" min={30} max={120} step={5} suffix="d" term="Excess stock" />
              </div>
            </Panel>
            <Panel title="Forecasting">
              <div className="space-y-4">
                <Slider k="horizonWeeks" label="Horizon" min={12} max={26} step={1} suffix=" wk" />
                <Slider k="anomalyThreshold" label="Anomaly sensitivity" min={1.5} max={4} step={0.1} suffix="σ" term="Z-score" />
                <Slider k="signalWeightPct" label="Signal weight" min={0} max={100} step={10} suffix="%" />
              </div>
            </Panel>
            <Panel title="Ordering">
              <label className="flex items-center gap-2 cursor-pointer mb-3">
                <input type="checkbox" className="w-4 h-4" checked={settings.respectLotSizes}
                  onChange={e => setSetting('respectLotSizes', e.target.checked, 'Lot sizes')} />
                <span className="text-base font-medium flex items-center">Respect lot sizes<Why term="Lot size" /></span>
              </label>
              {r && (
                <div className="grid grid-cols-2 gap-2">
                  <LV k="Planned orders" v={fmtNum(r.mrp.plannedOrders.length)} />
                  <LV k="Already late" v={fmtNum(r.mrp.plannedOrders.filter(p => p.late).length)} tone="danger" />
                  <LV k="At risk" v={fmtNum(r.kpis.materialsAtRisk)} />
                  <LV k="Overstocked" v={fmtNum(r.kpis.excessCount)} />
                </div>
              )}
              <p className="text-2xs text-muted mt-2 pt-2 border-t border-line">Signed in as {role}.</p>
            </Panel>
          </div>
          <Panel className="mt-3" title="What each one touches" pad={false}>
            <div className="overflow-auto pad">
              <table className="w-full border-collapse">
                <thead><tr><th className="th">Setting</th><th className="th">Now</th><th className="th">Default</th><th className="th">Changes</th></tr></thead>
                <tbody>
                  {[
                    ['Service level', `${settings.serviceLevelPct}%`, `${DEFAULT_SETTINGS.serviceLevelPct}%`, 'Safety stock · reorder points · recommendations · cash'],
                    ['Lead-time buffer', `${settings.leadTimeBufferDays}d`, `${DEFAULT_SETTINGS.leadTimeBufferDays}d`, 'Safety stock · order-by dates'],
                    ['Excess target', `${settings.excessCoverDays}d`, `${DEFAULT_SETTINGS.excessCoverDays}d`, 'What counts as overstocked · releasable cash'],
                    ['Horizon', `${settings.horizonWeeks} wk`, `${DEFAULT_SETTINGS.horizonWeeks} wk`, 'Forecast length · MRP grid · planned orders'],
                    ['Anomaly sensitivity', `${settings.anomalyThreshold}σ`, `${DEFAULT_SETTINGS.anomalyThreshold}σ`, 'How many anomalies · exception queue'],
                    ['Signal weight', `${settings.signalWeightPct}%`, `${DEFAULT_SETTINGS.signalWeightPct}%`, 'Forecast level · everything downstream'],
                    ['Lot sizes', settings.respectLotSizes ? 'On' : 'Off', DEFAULT_SETTINGS.respectLotSizes ? 'On' : 'Off', 'Order quantities · purchase spend'],
                  ].map(([k, n, d, t]) => (
                    <tr key={k}><td className="td font-medium">{k}</td><td className="td num font-semibold">{n}</td>
                      <td className="td num text-muted">{d}</td><td className="td text-2xs text-muted">{t}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      {tab === 'alerts' && (
        <Panel pad={false}>
          <div className="overflow-auto pad">
            <table className="w-full border-collapse">
              <thead><tr><th className="th">On</th><th className="th">Rule</th><th className="th">Trigger</th>
                <th className="th">Severity</th><th className="th">Channels</th><th className="th">Who</th><th className="th">When</th></tr></thead>
              <tbody>
                {ALERT_RULES.map(x => (
                  <tr key={x.id} id={`rule-${x.id}`} className={on.includes(x.id) ? '' : 'opacity-45'}>
                    <td className="td"><input type="checkbox" className="w-3.5 h-3.5" checked={on.includes(x.id)}
                      aria-label={x.name}
                      onChange={() => setOn(s => s.includes(x.id) ? s.filter(y => y !== x.id) : [...s, x.id])} /></td>
                    <td className="td text-base font-medium">{x.name}</td>
                    <td className="td text-2xs text-muted">{x.trigger}</td>
                    <td className="td"><Status v={x.severity} /></td>
                    <td className="td"><div className="flex gap-0.5">{x.channels.map(c => { const I = CH[c]; return (
                      <span key={c} title={c} className="w-5 h-5 rounded bg-surface2 grid place-items-center text-muted"><I className="w-3 h-3" /></span>
                    )})}</div></td>
                    <td className="td text-2xs">{x.who}</td>
                    <td className="td text-2xs">{x.frequency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-2xs text-muted mt-2">Severity sets the channel, the audience and the frequency — not just a colour.</p>
          </div>
        </Panel>
      )}

      {tab === 'data' && (
        <>
          <Tiles cols={6}>
            <Tile k="Products" v={fmtNum(ds.skus.length)} onClick={() => setDtab('skus')} />
            <Tile k="Materials" v={fmtNum(ds.materials.length)} onClick={() => setDtab('mats')} />
            <Tile k="Suppliers" v={fmtNum(ds.suppliers.length)} onClick={() => setDtab('sups')} />
            <Tile k="Customers" v={fmtNum(ds.customers.length)} />
            <Tile k="Orders" v={fmtNum(ds.orders.length)} />
            <Tile k="Recipe lines" v={fmtNum(Object.values(ds.bom).reduce((s, b) => s + b.length, 0))} />
          </Tiles>
          <div className="flex justify-end my-2">
            <Tabs active={dtab} onChange={setDtab} tabs={[
              { id: 'skus', label: 'Products' }, { id: 'mats', label: 'Materials' },
              { id: 'sups', label: 'Suppliers' }, { id: 'plants', label: 'Plants' },
            ]} />
          </div>
          <Panel pad={false}><div className="pad">
            {dtab === 'skus' && <Table rows={ds.skus} cols={skuCols} rowKey={s => s.id} search={s => `${s.code} ${s.name}`} sort={{ key: 'c', dir: 'asc' }} csv="products" page={14} />}
            {dtab === 'mats' && <Table rows={ds.materials} cols={matCols} rowKey={m => m.id} search={m => `${m.code} ${m.name} ${m.category}`} sort={{ key: 'c', dir: 'asc' }} csv="materials" page={14} />}
            {dtab === 'sups' && <Table rows={ds.suppliers} cols={supCols} rowKey={s => s.id} search={s => s.name} sort={{ key: 'o', dir: 'desc' }} csv="suppliers" page={14} />}
            {dtab === 'plants' && (
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <div className="eyebrow mb-1.5">Plants</div>
                  {ds.plants.map(p => (
                    <div key={p.id} className="rounded-lg border border-line p-2.5 mb-1.5">
                      <div className="flex items-center gap-2"><span className="text-base font-semibold">{p.name}</span><Chip tone="info">{p.region}</Chip></div>
                      <div className="text-2xs text-muted mt-0.5">{p.lines.length} lines · from {p.commissioned}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="eyebrow mb-1.5">Warehouses</div>
                  {ds.warehouses.map(w => (
                    <div key={w.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 mb-1">
                      <span className="text-base flex-1 truncate">{w.name}</span>
                      <Chip tone="info">{w.region}</Chip>
                      <span className="num text-2xs text-muted">{fmtNum(w.capacityT)}t</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div></Panel>
        </>
      )}

      {tab === 'upload' && (
        <div className="grid gap-3 lg:grid-cols-3">
          <Panel className="lg:col-span-2" title="Upload a file">
            <label className="block border-2 border-dashed border-line rounded-xl p-6 text-center cursor-pointer hover:border-primary/50 transition-colors">
              <input type="file" multiple className="hidden"
                onChange={e => { for (const f of Array.from(e.target.files ?? [])) handle(f); e.target.value = '' }} />
              <Upload className="w-6 h-6 mx-auto text-muted mb-1.5" />
              <p className="text-base font-semibold">Choose files</p>
              <p className="text-2xs text-muted mt-0.5">
                Any type · read in your browser · nothing leaves this machine
              </p>
            </label>
            <p className="text-2xs text-muted mt-2">
              <b>CSV, TSV and text</b> are read as demand history and the models are fitted on them.
              Anything else — a PDF quote, a photo of a delivery note, a video from the line — is attached
              to the feed as evidence. It is kept with the upload, but it does not move the forecast.
            </p>
            {up && (
              <div className="mt-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip tone="primary">{up.name}</Chip>
                  <Chip tone={up.series.length ? 'success' : 'danger'}>{up.series.length} series</Chip>
                </div>
                {up.series.length > 0 && (
                  <select className="input mt-2" value={pick} onChange={e => setPick(Number(e.target.value))}>
                    {up.series.map((s, i) => <option key={s.key} value={i}>{s.key} — {s.values.length} periods</option>)}
                  </select>
                )}
              </div>
            )}

            {uploads.length > 0 && (
              <div className="mt-3 pt-3 border-t border-line">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="eyebrow">Files on this feed</span>
                  <span className="num text-2xs text-muted">
                    {uploads.filter(u => u.parsed).length} read as data · {uploads.filter(u => !u.parsed).length} attached
                  </span>
                </div>
                <div className="space-y-1">
                  {uploads.map(u => (
                    <div key={u.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface2 px-2.5 py-1.5">
                      <FileText className="w-3.5 h-3.5 text-muted shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-base font-medium truncate">{u.name}</div>
                        <div className="text-2xs text-muted truncate">{u.note}</div>
                      </div>
                      <span className="num text-2xs text-muted shrink-0">{fmtBytes(u.sizeBytes)}</span>
                      <Chip tone={u.parsed ? 'success' : 'neutral'}>
                        {u.parsed ? `${u.seriesCount} series` : 'Attached'}
                      </Chip>
                      <button className="btn btn-ghost btn-xs" aria-label={`Remove ${u.name}`}
                        onClick={() => removeUpload(u.id)}>×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>
          <Panel title="Templates">
            <div className="space-y-1">
              {[['Sales history', 'sku,region,week,quantity', 'sku,region,week,quantity\nSS-304-CR-1.0-2B,North,1,42.5\nSS-304-CR-1.0-2B,North,2,45.1'],
                ['Stock', 'material_code,on_hand,lead_time_days', 'material_code,material_name,unit,on_hand,lead_time_days\nRM-105,Ferromolybdenum,t,3.4,42'],
                ['Recipe', 'sku,material_code,qty_per_tonne', 'sku,material_code,qty_per_tonne\nSS-316L-CR-1.0-2B,RM-105,0.028']].map(([n, c, body]) => (
                <button key={n} onClick={() => downloadText(`demandpilot-${n.toLowerCase().replace(/ /g, '-')}.csv`, body, 'text/csv')}
                  className="w-full flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 hover:border-primary/40 transition-colors text-left">
                  <div className="min-w-0 flex-1"><div className="text-base font-medium">{n}</div>
                    <div className="text-2xs text-muted font-mono truncate">{c}</div></div>
                  <Download className="w-3 h-3 text-muted" />
                </button>
              ))}
            </div>
          </Panel>

          {cur && fc && (
            <>
              <div className="lg:col-span-2">
                <Chart title={cur.key} h={220}><FChart data={upChart} showOld /></Chart>
              </div>
              <Panel title="Result">
                <LVRow cols={2} items={[
                  { k: 'Model', v: fc.model },
                  { k: 'Error', v: fmtPct(fc.mape) },
                  { k: 'Bias', v: fmtSigned(fc.bias) },
                  { k: 'Old method', v: fmtPct(fc.spreadsheetMape) },
                ]} />
                <div className={`mt-2 rounded-lg px-2.5 py-2 border ${fc.mape < fc.spreadsheetMape ? 'bg-success-soft border-success/25' : 'bg-warning-soft border-warning/25'}`}>
                  <p className="text-sm">
                    {fc.mape < fc.spreadsheetMape
                      ? `${(fc.spreadsheetMape - fc.mape).toFixed(1)} points better than a three-month average.`
                      : 'A three-month average wins on this series — the system says so rather than hiding it.'}
                  </p>
                </div>
              </Panel>
            </>
          )}
          {!up && <div className="lg:col-span-3"><Panel><Empty title="No file yet" hint="Download a template, add a few products, upload it back." /></Panel></div>}
        </div>
      )}

      {tab === 'glossary' && (
        <>
          <input className="input max-w-xs mb-2.5" placeholder="Search a term" value={gq} onChange={e => setGq(e.target.value)} />
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {gloss.map(e => (
              <div key={e.term} className="card pad">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h4 className="text-base font-bold">{e.term}</h4>
                  <Chip tone="neutral">{e.group}</Chip>
                </div>
                <p className="text-sm leading-relaxed">{e.plain}</p>
                <p className="text-2xs text-muted mt-1.5 pt-1.5 border-t border-line">{e.example}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
