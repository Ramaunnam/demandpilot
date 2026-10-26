import { useMemo, useState } from 'react'
import { Check, X, Search as Mag, ChevronRight } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Head, Tile, Tiles, Panel, Chip, Status, Drawer, LVRow, Modal, Field, Empty } from '@/ui/kit'
import { Chart, Lines, Bars, useC } from '@/ui/charts'
import { Table, type Col } from '@/ui/Table'
import { fmtT, fmtSigned, fmtINR, fmtNum, mean } from '@/lib/format'
import { wkLabel, wkFull } from '@/lib/view'
import { selectAnomalyGroups, type AnomalyGroup } from '@/engine/selectors'
import type { Anomaly, AnomalyStatus } from '@/engine/anomaly'

export default function Anomalies() {
  const C = useC()
  const { result, ds, settings, resolveAnomalies } = useStore()
  const r = result!
  const [status, setStatus] = useState<AnomalyStatus | 'All'>('Open')
  const [sev, setSev] = useState('All')
  const [open, setOpen] = useState<AnomalyGroup | null>(null)
  /** Which series inside the open group is charted. */
  const [pick, setPick] = useState(0)
  const [act, setAct] = useState<AnomalyStatus | null>(null)
  const [why, setWhy] = useState('')

  /**
   * One row per market shift, not per product.
   *
   * A genuine change in what a region buys trips the detector in every affected
   * series — 316L alone has 60 — so the raw list ran to 189 rows for roughly
   * twenty decisions. Grouping is presentation only: nothing is suppressed, and
   * every series is still reachable inside its group.
   */
  const groups = useMemo(
    () => selectAnomalyGroups(r, status).filter(g => sev === 'All' || g.severity === sev),
    [r, status, sev])

  const openGroups = useMemo(() => selectAnomalyGroups(r, 'Open'), [r])
  const speed = openGroups.length ? mean(openGroups.map(g => g.detectedAfterDays)) : 0
  const bySev = ['High', 'Medium', 'Low'].map(s => ({ label: s, n: openGroups.filter(g => g.severity === s).length }))

  const member: Anomaly | undefined = open?.items[Math.min(pick, open.items.length - 1)]

  const chart = useMemo(() => {
    if (!member) return []
    const h = ds.demand.find(d => d.skuId === member.skuId && d.region === member.region)?.weeks ?? []
    const from = Math.max(0, member.startWeek - 14)
    const to = Math.min(h.length, member.startWeek + member.weeksRunning + 3)
    return Array.from({ length: to - from }, (_, i) => {
      const w = from + i
      const inside = w >= member.startWeek && w < member.startWeek + member.weeksRunning
      return { label: wkLabel(ds, w), actual: +h[w].toFixed(1), expected: inside ? +member.expected.toFixed(1) : null }
    })
  }, [member, ds])

  const mats = open
    ? r.materials
        .filter(m => open.items.some(a => a.affectedMaterialIds.includes(m.materialId)))
        .sort((a, b) => a.inv.daysOfCover - b.inv.daysOfCover).slice(0, 5)
    : []

  const cols: Col<AnomalyGroup>[] = [
    { key: 's', h: 'Sev', cell: g => <Status v={g.severity} />, val: g => g.severity },
    { key: 'g', h: 'Grade', cell: g => <Chip tone="neutral">{g.grade}</Chip>, val: g => g.grade },
    { key: 'r', h: 'Region', cell: g => <Chip tone="info">{g.region}</Chip>, val: g => g.region },
    { key: 'd', h: 'Direction', cell: g => (
      <span className={g.avgDeltaPct > 0 ? 'text-success' : 'text-danger'}>{g.direction}</span>
    ), val: g => g.direction },
    { key: 'n', h: 'Products', right: true, cell: g => fmtNum(g.products), val: g => g.products },
    { key: 'gap', h: 'Avg gap', right: true, cell: g => (
      <span className={g.avgDeltaPct > 0 ? 'text-success font-semibold' : 'text-danger font-semibold'}>
        {fmtSigned(g.avgDeltaPct)}
      </span>
    ), val: g => g.avgDeltaPct },
    { key: 'wk', h: 'Weeks', right: true, cell: g => String(g.weeksRunning), val: g => g.weeksRunning },
    { key: 'c', h: 'Caught', right: true, cell: g => (
      <span className="text-success font-semibold">{g.detectedAfterDays}d</span>
    ), val: g => g.detectedAfterDays },
    { key: 'v', h: 'Impact', right: true, cell: g => fmtINR(g.totalImpactINR), val: g => g.totalImpactINR },
    { key: 'st', h: 'Status', cell: g => <Status v={g.status} />, val: g => g.status },
  ]

  const openGroup = (g: AnomalyGroup) => { setOpen(g); setPick(0) }

  return (
    <>
      <Head title="Anomalies" blurb="Demand that moved further than its usual wobble"
        chips={<Chip tone="success">caught in {speed.toFixed(0)} days on average</Chip>} />

      <Tiles>
        <Tile k="Open shifts" v={fmtNum(openGroups.length)} sub={`${r.kpis.openAnomalySeries} series`}
          tone={openGroups.length ? 'warning' : 'success'} />
        <Tile k="High" v={fmtNum(openGroups.filter(g => g.severity === 'High').length)} tone="danger" />
        <Tile k="Above" v={fmtNum(openGroups.filter(g => g.avgDeltaPct > 0).length)} sub="stockout risk" tone="warning" />
        <Tile k="Below" v={fmtNum(openGroups.filter(g => g.avgDeltaPct < 0).length)} sub="excess risk" tone="info" />
        <Tile k="Sensitivity" v={settings.anomalyThreshold.toFixed(1)} unit="σ" to="/setup" />
        <Tile k="Impact" v={fmtINR(openGroups.reduce((s, g) => s + g.totalImpactINR, 0))} />
      </Tiles>

      <div className="grid gap-3 lg:grid-cols-4 mt-3">
        <Chart title="By severity" h={170}>
          <Bars data={bySev} x="label" bars={[{ k: 'n', name: 'Open' }]} />
        </Chart>
        <Panel className="lg:col-span-3" title="How one is decided">
          <div className="grid sm:grid-cols-4 gap-2">
            {[
              ['1', 'Expected', 'From the 10 weeks before, adjusted for last year'],
              ['2', 'Wobble', 'How much this product normally varies'],
              ['3', 'Compare', `Flag if the gap exceeds ${settings.anomalyThreshold}σ`],
              ['4', 'Group', 'Collect one grade, region and direction into one shift'],
            ].map(([n, t, d]) => (
              <div key={n} className="rounded-lg border border-line bg-surface2 p-2.5">
                <div className="w-5 h-5 rounded bg-primary text-primary-fg grid place-items-center text-2xs font-bold num mb-1">{n}</div>
                <div className="text-base font-semibold">{t}</div>
                <p className="text-2xs text-muted mt-0.5">{d}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel className="mt-3" pad={false}><div className="pad">
        <div className="flex flex-wrap gap-1 mb-2">
          {(['Open', 'Accepted as new trend', 'Ignored as one-off', 'Investigating', 'All'] as const).map(s => (
            <button key={s} onClick={() => setStatus(s)} className={`chip ${status === s ? 'chip-primary' : 'chip-neutral'}`}>
              {s === 'Accepted as new trend' ? 'Accepted' : s === 'Ignored as one-off' ? 'Ignored' : s}
            </button>
          ))}
          <span className="w-px h-4 bg-line mx-1" />
          {['All', 'High', 'Medium', 'Low'].map(s => (
            <button key={s} onClick={() => setSev(s)} className={`chip ${sev === s ? 'chip-primary' : 'chip-neutral'}`}>{s}</button>
          ))}
        </div>
        {groups.length === 0 ? <Empty title="None in this filter" /> : (
          <Table rows={groups} cols={cols} rowKey={g => g.id} onRow={openGroup}
            search={g => `${g.grade} ${g.region} ${g.direction}`} sort={{ key: 'n', dir: 'desc' }}
            csv="anomalies" page={14} />
        )}
      </div></Panel>

      <Drawer open={!!open} onClose={() => setOpen(null)}
        title={open ? `${open.region} · grade ${open.grade}` : ''}
        sub={open ? `${open.direction} by ${Math.abs(open.avgDeltaPct).toFixed(0)}% across ${open.products} product${open.products === 1 ? '' : 's'}, from ${wkFull(ds, open.startWeek)}` : ''}
        chips={open && <><Status v={open.severity} /><Status v={open.status} /></>}
        footer={open?.status === 'Open' && (
          <div className="flex gap-1.5">
            <button className="btn btn-primary btn-md flex-1" onClick={() => { setAct('Accepted as new trend'); setWhy('') }}><Check className="w-4 h-4" /> New trend</button>
            <button className="btn btn-outline btn-md flex-1" onClick={() => { setAct('Ignored as one-off'); setWhy('') }}><X className="w-4 h-4" /> One-off</button>
            <button className="btn btn-ghost btn-md" onClick={() => { setAct('Investigating'); setWhy('') }}><Mag className="w-4 h-4" /></button>
          </div>
        )}>
        {open && member && (
          <>
            <LVRow cols={4} items={[
              { k: 'Products', v: fmtNum(open.products) },
              { k: 'Average gap', v: fmtSigned(open.avgDeltaPct), tone: open.avgDeltaPct > 0 ? 'success' : 'danger' },
              { k: 'Caught after', v: `${open.detectedAfterDays}d`, tone: 'success' },
              { k: 'Impact', v: fmtINR(open.totalImpactINR) },
            ]} />

            <Panel title="Likely cause"><p className="text-base">{open.likelyCause}</p></Panel>

            <Panel title={`Products in this shift (${open.products})`} pad={false}>
              <div className="overflow-auto pad" style={{ maxHeight: 190 }}>
                {open.items.map((a, i) => (
                  <button key={a.id} onClick={() => setPick(i)}
                    className={`w-full flex items-center gap-2 rounded-lg border px-2.5 py-1.5 mb-1 text-left transition-colors ${
                      i === pick ? 'border-primary bg-primary-soft' : 'border-line hover:border-primary/40'}`}>
                    <Status v={a.severity} />
                    <span className="font-mono text-sm flex-1 truncate">{a.skuCode}</span>
                    <span className={`num text-sm font-semibold ${a.deltaPct > 0 ? 'text-success' : 'text-danger'}`}>
                      {fmtSigned(a.deltaPct)}
                    </span>
                    <ChevronRight className="w-3 h-3 text-muted/50 shrink-0" />
                  </button>
                ))}
              </div>
            </Panel>

            <Chart title={`${member.skuCode} — expected vs actual`} h={180}>
              <Lines data={chart} x="label" unit=" t" lines={[
                { k: 'actual', name: 'Actual', color: C.actual },
                { k: 'expected', name: 'Expected', color: C.forecast, dash: true },
              ]} />
            </Chart>
            <LVRow cols={3} items={[
              { k: 'Expected', v: fmtT(member.expected) },
              { k: 'Actual', v: fmtT(member.actual), tone: member.deltaPct > 0 ? 'success' : 'danger' },
              { k: 'z-score', v: member.zScore.toFixed(1) },
            ]} />

            {mats.length > 0 && (
              <Panel title="Materials affected">
                <div className="space-y-1">
                  {mats.map(m => (
                    <div key={m.materialId} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
                      <span className="font-mono text-sm font-semibold">{m.code}</span>
                      <span className="text-base flex-1 truncate">{m.name}</span>
                      <Status v={m.inv.status} />
                      <span className="num text-2xs text-muted w-12 text-right">{m.inv.daysOfCover.toFixed(0)}d</span>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
            <Panel title="Suggested"><p className="text-base">{open.suggestedAction}</p></Panel>
          </>
        )}
      </Drawer>

      <Modal open={!!act} onClose={() => setAct(null)} title={act ?? ''}>
        <div className="space-y-2.5">
          {open && (
            <p className="text-base text-muted">
              Applies to all {open.products} product{open.products === 1 ? '' : 's'} in {open.region} · grade {open.grade}.
            </p>
          )}
          <Field label="Reason"><textarea className="input h-16 py-1.5" value={why} onChange={e => setWhy(e.target.value)}
            placeholder="Two customers confirmed the change in writing" /></Field>
          <div className="flex gap-1.5 justify-end">
            <button className="btn btn-outline btn-md" onClick={() => setAct(null)}>Cancel</button>
            <button className="btn btn-primary btn-md" disabled={!why.trim()}
              onClick={() => {
                if (open && act) resolveAnomalies(open.items.map(a => a.id), act, why)
                setAct(null); setOpen(null)
              }}>Confirm</button>
          </div>
        </div>
      </Modal>
    </>
  )
}
