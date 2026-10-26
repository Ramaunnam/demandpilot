import { useEffect, useMemo, useState } from 'react'
import { RotateCcw, Check, Trophy, Save, SlidersHorizontal, ArrowRight } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '@/store/useStore'
import { Head, Tile, Tiles, Panel, Chip, Status, Dot, Tabs, Confidence, Field, Modal, LVRow } from '@/ui/kit'
import { Chart, Bars, useC } from '@/ui/charts'
import { runScenario, runScenarioReplay, buildPlanOptions, type ScenarioLevers } from '@/engine/scenario'
import { fmtINR, fmtNum, fmtPct, fmtSigned, fmtDate, addDays } from '@/lib/format'
import { selectServiceLevelPct, selectPurchaseSpendINR } from '@/engine/selectors'
import { wkLabel } from '@/lib/view'
import { STORY, weekDate } from '@/data/generate'

export default function Simulate() {
  const C = useC()
  const { result, ds, settings, commitPlan, committedPlanId, planHistory, revertHistory, saveScenario } = useStore()
  const r = result!
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const [save, setSave] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [tab, setTab] = useState(sp.get('m') ? 'options' : 'levers')

  // ---- scenario levers ----------------------------------------------------
  const base = useMemo(() => {
    const m = new Map<string, any>()
    for (const mv of r.materials) {
      const raw = ds.materials.find(x => x.id === mv.materialId)!
      m.set(mv.materialId, {
        dailyUsage: mv.dailyUsage, usageSd: mv.usageSd, onHand: mv.onHand, onOrder: mv.onOrder,
        leadTimeDays: raw.leadTimeDays, leadTimeSdDays: raw.leadTimeSdDays, costPerUnit: raw.costPerUnit,
        staticMinLevel: raw.staticMinLevel, grades: raw.usedByGrades, primarySupplierId: raw.primarySupplierId,
      })
    }
    return m
  }, [r, ds])

  const defaults: ScenarioLevers = useMemo(() => ({
    demandChangePct: 0, demandGrade: 'All', demandRegion: 'All',
    supplierDelayDays: 0, supplierId: 'All',
    serviceLevelPct: settings.serviceLevelPct, leadTimeBufferDays: settings.leadTimeBufferDays,
    excessCoverDays: settings.excessCoverDays,
  }), [settings])

  /**
   * The scenario lives in the URL, so switching tabs, refreshing or sharing the
   * link all keep the same what-if open. Only levers that differ from the
   * current plan are written, which keeps a clean plan at a clean URL.
   */
  const [lv, setLv] = useState<ScenarioLevers>(() => ({
    ...defaults,
    demandChangePct: Number(sp.get('d') ?? 0) || 0,
    demandGrade: sp.get('g') ?? 'All',
    supplierDelayDays: Number(sp.get('sd') ?? 0) || 0,
    supplierId: sp.get('sup') ?? 'All',
    serviceLevelPct: Number(sp.get('sl') ?? 0) || defaults.serviceLevelPct,
    excessCoverDays: Number(sp.get('ex') ?? 0) || defaults.excessCoverDays,
  }))
  const set = <K extends keyof ScenarioLevers>(k: K, v: ScenarioLevers[K]) => setLv(s => ({ ...s, [k]: v }))
  const changed = JSON.stringify(lv) !== JSON.stringify(defaults)

  useEffect(() => {
    setSp(p => {
      const put = (key: string, v: string | number, dflt: string | number) =>
        v === dflt ? p.delete(key) : p.set(key, String(v))
      put('d', lv.demandChangePct, 0)
      put('g', lv.demandGrade, 'All')
      put('sd', lv.supplierDelayDays, 0)
      put('sup', lv.supplierId, 'All')
      put('sl', lv.serviceLevelPct, defaults.serviceLevelPct)
      put('ex', lv.excessCoverDays, defaults.excessCoverDays)
      return p
    }, { replace: true })
  }, [lv, defaults, setSp])

  const nowRun = useMemo(() => runScenario({ ds, levers: defaults, base }), [ds, defaults, base])
  const simRun = useMemo(() => runScenario({ ds, levers: lv, base }), [ds, lv, base])
  const now = nowRun.outcome, sim = simRun.outcome

  /**
   * Stock, cover and fill rate come from re-running the real sixteen-week
   * simulation under the levers — not from recomputing reorder points, which
   * cannot tell you what stock would actually do. With nothing moved this
   * reproduces the live replay exactly, so the "Now" column matches Proof.
   */
  const nowSim = useMemo(() => runScenarioReplay(ds, r.replayInput, defaults), [ds, r.replayInput, defaults])
  const simSim = useMemo(() => runScenarioReplay(ds, r.replayInput, lv), [ds, r.replayInput, lv])

  const presets: { n: string; about: string; lv: Partial<ScenarioLevers> }[] = [
    { n: 'South 316L +20%', about: 'Demand for grade 316L rises 20%', lv: { demandChangePct: 20, demandGrade: '316L' } },
    { n: 'Supplier B slips 2 wk', about: 'Imported alloys from Supplier B arrive 14 days later', lv: { supplierDelayDays: 14, supplierId: 'S-02' } },
    { n: 'Service 99%', about: 'Raise the service target from 97% to 99%', lv: { serviceLevelPct: 99 } },
    { n: '430 falls 15%', about: 'Demand for grade 430 drops 15%', lv: { demandChangePct: -15, demandGrade: '430' } },
    { n: 'Lean to 40 days', about: 'Cut the excess target from 60 to 40 days of cover', lv: { excessCoverDays: 40 } },
    { n: 'All suppliers +1 wk', about: 'Every supplier delivers 7 days later', lv: { supplierDelayDays: 7 } },
  ]

  /** The preset currently in force, found by value so a hand-moved lever clears it. */
  const activePreset = presets.find(p => JSON.stringify({ ...defaults, ...p.lv }) === JSON.stringify(lv)) ?? null
  const scenarioName = !changed ? 'Current plan' : activePreset ? activePreset.n : 'Custom scenario'

  /** Only the levers that differ, as readable tags. */
  const leverTags = useMemo(() => {
    const t: string[] = []
    if (lv.demandChangePct !== 0) t.push(`Demand ${fmtSigned(lv.demandChangePct, 0)}`)
    if (lv.demandGrade !== 'All') t.push(`Grade ${lv.demandGrade}`)
    if (lv.supplierDelayDays !== 0) t.push(`Supplier delay +${lv.supplierDelayDays}d`)
    if (lv.supplierId !== 'All') {
      t.push(ds.suppliers.find(s => s.id === lv.supplierId)?.name.split('—')[0].trim() ?? lv.supplierId)
    }
    if (lv.serviceLevelPct !== defaults.serviceLevelPct) t.push(`Service ${lv.serviceLevelPct}%`)
    if (lv.excessCoverDays !== defaults.excessCoverDays) t.push(`Excess target ${lv.excessCoverDays}d`)
    return t
  }, [lv, defaults, ds.suppliers])

  /** True when a lever sits away from the current plan — drives the "changed" dot. */
  const moved = (k: keyof ScenarioLevers) => lv[k] !== defaults[k]

  /**
   * Purchase spend, anchored to the real figure.
   *
   * The baseline column is the exact total the Recommendations screen shows, so
   * the two pages agree. The scenario column scales it by how far the plan's
   * shortfall moves — the only honest projection available without re-running
   * the whole recommendation engine on every keystroke.
   */
  const spendNow = selectPurchaseSpendINR(r)
  const spendSim = now.shortfallValueINR > 0
    ? Math.round(spendNow * (sim.shortfallValueINR / now.shortfallValueINR))
    : spendNow

  /**
   * The six result cards.
   *
   * Three come from recomputing the plan's parameters (risk counts, spend) and
   * three from re-running the simulation (stock, service, cover). Both are real
   * outcomes; neither is an estimate dressed as one. A card that genuinely does
   * not move says "No change" rather than printing the same number twice and
   * leaving the reader to spot it.
   */
  const cards = useMemo(() => [
    { name: 'Materials at risk', a: now.materialsAtRisk, b: sim.materialsAtRisk, f: (n: number) => fmtNum(n), down: true },
    { name: 'Stockout risk', a: now.stockoutRiskCount, b: sim.stockoutRiskCount, f: (n: number) => fmtNum(n), down: true },
    { name: 'Stock value', a: nowSim.avgStockValueINR, b: simSim.avgStockValueINR, f: fmtINR, down: true },
    { name: 'Purchase spend', a: spendNow, b: spendSim, f: fmtINR, down: true },
    { name: 'Service level', a: nowSim.serviceLevelPct, b: simSim.serviceLevelPct, f: (n: number) => fmtPct(n), down: false },
    { name: 'Days of inventory', a: nowSim.daysOfInventory, b: simSim.daysOfInventory, f: (n: number) => `${n.toFixed(0)}d`, down: true },
  ], [now, sim, nowSim, simSim, spendNow, spendSim])

  /**
   * Materials whose status actually changes, which is the part a planner acts
   * on. A scenario that moves a headline by two crore but flips nothing is
   * worth knowing about too, so an empty list says so.
   */
  const affected = useMemo(() => {
    const out: { id: string; code: string; name: string; from: string; to: string; runsOut: Date | null; worse: boolean }[] = []
    const rank: Record<string, number> = { Healthy: 0, Excess: 1, 'Reorder now': 2, 'Stockout risk': 3 }
    for (const mv of r.materials) {
      const a = nowRun.inventory.get(mv.materialId)
      const b = simRun.inventory.get(mv.materialId)
      if (!a || !b || a.status === b.status) continue
      out.push({
        id: mv.materialId, code: mv.code, name: mv.name,
        from: a.status, to: b.status,
        runsOut: b.status === 'Stockout risk' && isFinite(b.daysToStockout)
          ? addDays(weekDate(ds, r.todayWeek), Math.round(b.daysToStockout)) : null,
        worse: (rank[b.status] ?? 0) > (rank[a.status] ?? 0),
      })
    }
    return out.sort((x, y) => Number(y.worse) - Number(x.worse) || x.code.localeCompare(y.code))
  }, [r.materials, r.todayWeek, nowRun, simRun, ds])

  // ---- plan options -------------------------------------------------------
  const atRisk = r.materials.filter(m => m.inv.status === 'Stockout risk' || m.inv.status === 'Reorder now')
    .sort((a, b) => a.inv.daysOfCover - b.inv.daysOfCover)
  // Reachable from a Recommendation's "Compare options" button, so the two
  // screens open on the same material rather than making the user find it again.
  const [matId, setMatId] = useState(
    sp.get('m') ?? atRisk.find(m => m.materialId === STORY.criticalMaterial)?.materialId
    ?? atRisk[0]?.materialId ?? r.materials[0].materialId)
  useEffect(() => {
    const q = sp.get('m')
    if (q && q !== matId && r.materials.some(m => m.materialId === q)) { setMatId(q); setTab('options') }
  }, [sp, matId, r.materials])
  const mat = r.materials.find(m => m.materialId === matId)!
  const raw = ds.materials.find(m => m.id === matId)!
  const rec = r.recommendations.find(x => x.materialId === matId)
  const primary = ds.suppliers.find(s => s.id === raw.primarySupplierId)!
  const fast = ds.suppliers.find(s => s.id === (raw.backupSupplierIds[0] ?? raw.primarySupplierId))!
  const tFrom = Object.entries(mat.coverByRegion).sort((a, b) => b[1].days - a[1].days)[0]

  const opts = useMemo(() => buildPlanOptions({
    materialName: mat.name, qty: rec?.qty ?? Math.max(raw.moq, mat.inv.shortfall), unit: mat.unit,
    baseCostPerUnit: raw.costPerUnit, daysToSafetyBreach: mat.inv.daysToSafetyBreach, daysToStockout: mat.inv.daysToStockout,
    primaryLeadDays: primary.leadTimeDays, primaryName: primary.name, primaryPriceVarPct: primary.priceVariancePct,
    fastLeadDays: fast.leadTimeDays, fastName: fast.name, fastPriceVarPct: fast.priceVariancePct,
    revenueExposureINR: rec?.revenueAtRiskINR ?? mat.inv.stockValue * 6,
    transferAvailableUnits: tFrom ? tFrom[1].qty * 0.3 : 0,
    transferFromRegion: tFrom ? ds.warehouses.find(w => w.id === tFrom[0])?.region ?? '—' : '—', transferDays: 4,
  }), [mat, rec, raw, primary, fast, tFrom, ds])

  const [commit, setCommit] = useState<string | null>(null)
  const [why, setWhy] = useState('')
  const optRows = [
    { k: 'Production at risk', f: (o: any) => fmtINR(o.revenueAtRiskINR) },
    { k: 'Order value', f: () => rec ? fmtINR(Math.abs(rec.valueINR)) : '—' },
    { k: 'Extra cost vs normal route', f: (o: any) => o.extraCostINR ? fmtINR(o.extraCostINR) : '—' },
    { k: 'Late orders', f: (o: any) => fmtNum(o.lateOrders) },
    { k: 'Service after (projected)', f: (o: any) => fmtPct(o.serviceLevelPct) },
    { k: 'Arrives', f: (o: any) => `${o.arrivesInDays}d` },
    { k: 'Confidence', f: (o: any) => `${o.confidence}%` },
  ]

  // ---- cash ---------------------------------------------------------------
  const cash = useMemo(() => {
    const buys = r.recommendations.filter(x => x.valueINR > 0)
    const out: any[] = []
    for (let i = 0; i < 10; i++) {
      const w = r.todayWeek + i
      out.push({
        label: wkLabel(ds, w),
        out: -Math.round(buys.filter(b => b.expectedArrivalWeek === w).reduce((s, b) => s + b.valueINR, 0) / 1e5),
        back: i >= 2 && i <= 6 ? Math.round(r.kpis.cashFreedINR / 5 / 1e5) : 0,
      })
    }
    return out
  }, [r, ds])

  return (
    <>
      <Head title="Simulate" blurb="Move a lever, price the options, commit a plan" />

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: 'levers', label: 'What-if' }, { id: 'options', label: 'Plan options' },
        { id: 'cash', label: 'Cash' }, { id: 'history', label: 'History', n: planHistory.length },
      ]} />

      {tab === 'levers' && (
        <>
          {/* Always visible: what is being tested, and how to get back. */}
          <div className="sticky top-12 z-20 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2 mb-3
                          bg-bg/95 backdrop-blur border-b border-line">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`eyebrow ${changed ? 'text-primary' : 'text-muted'}`}>
                {changed ? 'Testing' : 'Showing'}
              </span>
              <span className="text-md font-bold">{scenarioName}</span>
              {changed && <Chip tone="primary">scenario</Chip>}
              <div className="flex-1" />
              {changed && (
                <>
                  <button className="btn btn-outline btn-sm" onClick={() => setLv(defaults)}>
                    <RotateCcw className="w-3 h-3" /> Reset
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => { setSave(true); setSaveName(scenarioName) }}>
                    <Save className="w-3 h-3" /> Save scenario
                  </button>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {changed
                ? leverTags.map(t => <Chip key={t} tone="primary">{t}</Chip>)
                : <span className="text-2xs text-muted">Current plan — move a lever or pick a case</span>}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title="Ready-made">
              <div className="grid grid-cols-2 gap-1">
                {presets.map(p => {
                  const on = activePreset?.n === p.n
                  return (
                    // Clicking the active case again returns to the current plan.
                    <button key={p.n} title={`${p.n} — ${p.about}`}
                      onClick={() => setLv(on ? defaults : { ...defaults, ...p.lv })}
                      className={`group relative rounded-lg border px-2 py-1.5 text-sm text-left transition-colors ${
                        on ? 'border-primary bg-primary text-primary-fg font-semibold'
                           : 'border-line bg-surface2 hover:border-primary/40'}`}>
                      <span className="flex items-center gap-1">
                        {on && <Check className="w-3 h-3 shrink-0" />}
                        <span className="truncate">{p.n}</span>
                      </span>
                      <span className={`block text-2xs mt-0.5 leading-tight ${on ? 'opacity-80' : 'text-muted'}`}>
                        {p.about}
                      </span>
                    </button>
                  )
                })}
              </div>
            </Panel>

            <Panel className="lg:col-span-2" title="Levers">
              {/* A lever away from the current plan gets a coloured frame and a
                  dot, so you can see at a glance which of the six is doing the
                  work in the results below. */}
              <div className="grid sm:grid-cols-2 gap-3">
                <div className={`sm:col-span-2 rounded-lg p-2 border transition-colors ${
                  moved('demandChangePct') ? 'border-primary/50 bg-primary-soft/40' : 'border-transparent'}`}>
                  <div className="flex justify-between mb-1">
                    <span className="lbl mb-0 flex items-center gap-1">
                      Demand change {moved('demandChangePct') && <Dot tone="primary" />}
                    </span>
                    <span className="num text-base font-bold text-primary">{fmtSigned(lv.demandChangePct)}</span>
                  </div>
                  <input type="range" min={-50} max={60} step={5} className="w-full accent-[rgb(var(--primary))]"
                    value={lv.demandChangePct} onChange={e => set('demandChangePct', Number(e.target.value))} />
                </div>
                <div className={`rounded-lg p-2 border transition-colors ${
                  moved('demandGrade') ? 'border-primary/50 bg-primary-soft/40' : 'border-transparent'}`}>
                  <Field label="Applies to">
                    <select className="input" value={lv.demandGrade} onChange={e => set('demandGrade', e.target.value)}>
                      <option value="All">All grades</option>{['304', '316L', '430', '201'].map(g => <option key={g} value={g}>Grade {g}</option>)}
                    </select>
                  </Field>
                </div>
                <div className={`rounded-lg p-2 border transition-colors ${
                  moved('supplierId') ? 'border-primary/50 bg-primary-soft/40' : 'border-transparent'}`}>
                  <Field label="Supplier">
                    <select className="input" value={lv.supplierId} onChange={e => set('supplierId', e.target.value)}>
                      <option value="All">All</option>{ds.suppliers.map(s => <option key={s.id} value={s.id}>{s.name.split('—')[0].trim()}</option>)}
                    </select>
                  </Field>
                </div>
                <div className={`sm:col-span-2 rounded-lg p-2 border transition-colors ${
                  moved('supplierDelayDays') ? 'border-primary/50 bg-primary-soft/40' : 'border-transparent'}`}>
                  <div className="flex justify-between mb-1">
                    <span className="lbl mb-0 flex items-center gap-1">
                      Supplier delay {moved('supplierDelayDays') && <Dot tone="primary" />}
                    </span>
                    <span className="num text-base font-bold text-primary">+{lv.supplierDelayDays}d</span>
                  </div>
                  <input type="range" min={0} max={42} step={7} className="w-full accent-[rgb(var(--primary))]"
                    value={lv.supplierDelayDays} onChange={e => set('supplierDelayDays', Number(e.target.value))} />
                </div>
                <div className={`rounded-lg p-2 border transition-colors ${
                  moved('serviceLevelPct') ? 'border-primary/50 bg-primary-soft/40' : 'border-transparent'}`}>
                  <Field label="Service level" term="Service level">
                    <select className="input" value={lv.serviceLevelPct} onChange={e => set('serviceLevelPct', Number(e.target.value))}>
                      {[90, 92, 94, 95, 96, 97, 98, 99].map(v => <option key={v} value={v}>{v}%</option>)}
                    </select>
                  </Field>
                </div>
                <div className={`rounded-lg p-2 border transition-colors ${
                  moved('excessCoverDays') ? 'border-primary/50 bg-primary-soft/40' : 'border-transparent'}`}>
                  <Field label="Excess target" term="Excess stock">
                    <select className="input" value={lv.excessCoverDays} onChange={e => set('excessCoverDays', Number(e.target.value))}>
                      {[30, 40, 45, 50, 60, 75, 90].map(v => <option key={v} value={v}>{v} days</option>)}
                    </select>
                  </Field>
                </div>
              </div>
            </Panel>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 mt-3">
            {cards.map(d => {
              const diff = d.b - d.a
              const same = Math.abs(diff) < 1e-9
              const better = d.down ? diff < 0 : diff > 0
              return (
                <div key={d.name} className={`card pad ${
                  same ? '' : better ? 'border-success/35' : 'border-danger/35'}`}>
                  <div className="eyebrow truncate">{d.name}</div>
                  <div className="num text-xl font-bold leading-none mt-1">{d.f(d.b)}</div>
                  {same ? (
                    <div className="text-2xs text-muted mt-1 font-semibold">No change</div>
                  ) : (
                    <div className={`num text-2xs mt-1 font-semibold flex items-center gap-1 ${
                      better ? 'text-success' : 'text-danger'}`}>
                      <span>{diff > 0 ? '▲' : '▼'}</span>
                      <span className="text-muted font-normal">from {d.f(d.a)}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <Panel className="mt-3" title="Materials affected"
            right={<Chip tone={affected.length ? 'warning' : 'neutral'}>{affected.length} change status</Chip>}>
            {!changed ? (
              <p className="text-base text-muted">Pick a case or move a lever to see which materials move.</p>
            ) : affected.length === 0 ? (
              <p className="text-base text-muted">
                No material changes status under this scenario. The headline numbers move, but nothing
                crosses from healthy to at-risk or back.
              </p>
            ) : (
              <div className="space-y-1">
                {affected.map(a => (
                  <button key={a.id} onClick={() => nav(`/stock?m=${a.id}`)}
                    className="w-full flex flex-wrap items-center gap-2 rounded-lg border border-line px-2.5 py-1.5
                               text-left hover:border-primary/40 hover:bg-primary-soft/30 transition-colors">
                    <span className="font-mono text-sm font-semibold">{a.code}</span>
                    <span className="text-base flex-1 truncate">{a.name}</span>
                    <Status v={a.from} />
                    <ArrowRight className="w-3 h-3 text-muted shrink-0" />
                    <Status v={a.to} />
                    {a.runsOut && (
                      <span className="num text-2xs text-danger font-semibold">runs out {fmtDate(a.runsOut)}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <div className="flex flex-wrap gap-1.5 mt-3">
            <button className="btn btn-outline btn-md" disabled={!affected.length && !changed}
              onClick={() => {
                // Open plan options on whatever this scenario hurt most.
                const worst = affected.find(a => a.worse) ?? affected[0]
                if (worst) { setMatId(worst.id); setSp(p => { p.set('m', worst.id); return p }, { replace: true }) }
                setTab('options')
              }}>
              <SlidersHorizontal className="w-4 h-4" /> Compare options
            </button>
            <button className="btn btn-outline btn-md" disabled={!changed}
              onClick={() => { setSave(true); setSaveName(scenarioName) }}>
              <Save className="w-4 h-4" /> Save to history
            </button>
            <div className="flex-1" />
            <Chip tone="neutral">service level measured over the last {16} weeks, same as Proof</Chip>
          </div>
        </>
      )}

      {tab === 'options' && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <select className="input w-auto max-w-xs" value={matId}
              onChange={e => { setMatId(e.target.value); setSp(p => { p.set('m', e.target.value); return p }, { replace: true }) }}>
              {(atRisk.length ? atRisk : r.materials).slice(0, 16).map(m => <option key={m.materialId} value={m.materialId}>{m.code} — {m.name}</option>)}
            </select>
            <Chip tone={mat.inv.daysOfCover < 14 ? 'danger' : 'warning'}>{mat.inv.daysOfCover.toFixed(0)}d cover</Chip>
            <Chip tone="neutral">{primary.leadTimeDays}d lead</Chip>
            <Chip tone={mat.inv.orderByDays <= 0 ? 'danger' : 'neutral'}>order by {mat.inv.orderByDays <= 0 ? 'passed' : `${Math.round(mat.inv.orderByDays)}d`}</Chip>
          </div>

          <Panel pad={false}>
            <div className="overflow-auto">
              <table className="w-full border-collapse">
                <thead><tr>
                  <th className="th">Measure</th>
                  {opts.map(o => (
                    <th key={o.id} className={`th text-right min-w-[150px] ${o.recommended ? 'bg-primary-soft text-primary' : ''}`}>
                      <span className="inline-flex items-center gap-1">{o.recommended && <Trophy className="w-3 h-3" />}{o.name}</span>
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {optRows.map(row => (
                    <tr key={row.k}>
                      <td className="td font-medium">{row.k}</td>
                      {opts.map(o => <td key={o.id} className={`td text-right num ${o.recommended ? 'bg-primary-soft/40 font-semibold' : ''}`}>{row.f(o)}</td>)}
                    </tr>
                  ))}
                  <tr>
                    <td className="td" />
                    {opts.map(o => (
                      <td key={o.id} className={`td text-right ${o.recommended ? 'bg-primary-soft/40' : ''}`}>
                        <button className={`btn btn-xs ${o.recommended ? 'btn-primary' : 'btn-outline'}`}
                          disabled={committedPlanId === o.id}
                          onClick={() => {
                            setCommit(o.id)
                            setWhy(`Spending ${fmtINR(o.extraCostINR)} to protect ${fmtINR(o.revenueAtRiskINR)} of production on ${mat.name}.`)
                          }}>
                          {committedPlanId === o.id ? <><Check className="w-3 h-3" /> done</> : 'Commit'}
                        </button>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 mt-3">
            {opts.map(o => (
              <Panel key={o.id} className={o.recommended ? 'border-primary/40' : ''}
                title={o.name} right={<Confidence v={o.confidence} />}>
                <ol className="space-y-1">
                  {o.steps.map((s, i) => (
                    <li key={i} className="text-sm text-muted flex gap-1.5"><span className="text-muted/60">{i + 1}.</span><span>{s}</span></li>
                  ))}
                </ol>
              </Panel>
            ))}
          </div>
        </>
      )}

      {tab === 'cash' && (
        <>
          <Tiles>
            <Tile k="Stock value" v={fmtINR(r.kpis.inventoryValueINR)} sub={`${r.kpis.daysOfInventory.toFixed(0)}d`} />
            <Tile k="To spend" v={fmtINR(r.kpis.recommendedSpendINR)} tone="warning" />
            <Tile k="To release" v={fmtINR(r.kpis.cashFreedINR)} tone="success" />
            <Tile k="Net" v={fmtINR(r.kpis.recommendedSpendINR - r.kpis.cashFreedINR)} />
            <Tile k="Excess" v={fmtINR(r.kpis.excessValueINR)} sub={`${r.kpis.excessCount} materials`} tone="info" />
            <Tile k="Holding / week" v={fmtINR(r.kpis.inventoryValueINR * 0.18 / 52)} sub="18% a year" />
          </Tiles>
          <div className="grid gap-3 lg:grid-cols-3 mt-3">
            <div className="lg:col-span-2">
              <Chart title="Cash out and back — 10 weeks" h={220} note="In lakh. Red leaves for purchases, green returns from releasing excess.">
                <Bars data={cash} x="label" unit=" L" bars={[
                  { k: 'out', name: 'Out', color: C.danger }, { k: 'back', name: 'Released', color: C.success },
                ]} />
              </Chart>
            </div>
            <Panel title="Where cash sits idle" pad={false}>
              <div className="overflow-auto pad" style={{ maxHeight: 220 }}>
                <table className="w-full border-collapse">
                  <thead><tr><th className="th">Material</th><th className="th text-right">Days</th><th className="th text-right">Releasable</th></tr></thead>
                  <tbody>
                    {[...r.materials].filter(m => m.inv.excessValue > 0).sort((a, b) => b.inv.excessValue - a.inv.excessValue).slice(0, 8).map(m => (
                      <tr key={m.materialId} className="tr">
                        <td className="td"><span className="font-mono text-2xs font-semibold">{m.code}</span></td>
                        <td className="td text-right num">{m.inv.daysOfCover.toFixed(0)}</td>
                        <td className="td text-right num font-semibold text-success">{fmtINR(m.inv.excessValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </>
      )}

      {tab === 'history' && (
        <Panel pad={false}>
          <div className="overflow-auto pad" style={{ maxHeight: 540 }}>
            <table className="w-full border-collapse">
              <thead><tr><th className="th">Type</th><th className="th">What</th><th className="th">Who</th>
                <th className="th text-right">Impact</th><th className="th">Status</th><th className="th"></th></tr></thead>
              <tbody>
                {planHistory.map(h => (
                  <tr key={h.id} className={h.reverted ? 'opacity-50' : ''}>
                    <td className="td"><Chip tone="neutral">{h.type.split(' ')[0]}</Chip></td>
                    <td className="td"><div className="text-base font-medium">{h.title}</div>
                      <div className="text-2xs text-muted italic truncate max-w-md">{h.reason}</div></td>
                    <td className="td text-sm">{h.user}</td>
                    <td className="td text-right num">{h.impactINR ? fmtINR(h.impactINR) : '—'}</td>
                    <td className="td">{h.reverted ? <Chip tone="neutral">reverted</Chip> : <Chip tone="success">in force</Chip>}</td>
                    <td className="td">{!h.reverted && <button className="btn btn-ghost btn-xs" onClick={() => revertHistory(h.id)}>Revert</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Modal open={save} onClose={() => setSave(false)} title="Save scenario">
        <div className="space-y-2.5">
          <Field label="Name">
            <input className="input" value={saveName} onChange={e => setSaveName(e.target.value)} />
          </Field>
          <div className="rounded-lg border border-line bg-surface2 px-3 py-2">
            <div className="eyebrow mb-1">Levers</div>
            <div className="flex flex-wrap gap-1">
              {leverTags.map(t => <Chip key={t} tone="primary">{t}</Chip>)}
            </div>
            <div className="eyebrow mt-2 mb-1">Result</div>
            <p className="text-2xs text-muted">
              {affected.length
                ? `${affected.length} material${affected.length === 1 ? '' : 's'} change status.`
                : 'No material changes status.'}
              {' '}Service {fmtPct(simSim.serviceLevelPct)}, stock {fmtINR(simSim.avgStockValueINR)}.
            </p>
          </div>
          <div className="flex gap-1.5 justify-end">
            <button className="btn btn-outline btn-md" onClick={() => setSave(false)}>Cancel</button>
            <button className="btn btn-primary btn-md" disabled={!saveName.trim()}
              onClick={() => {
                saveScenario(saveName, `${leverTags.join(' · ')} — ${affected.length} material(s) change status, ` +
                  `service ${fmtPct(simSim.serviceLevelPct)}, stock ${fmtINR(simSim.avgStockValueINR)}.`)
                setSave(false); setTab('history')
              }}>
              <Save className="w-4 h-4" /> Save
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!commit} onClose={() => setCommit(null)} title="Commit plan">
        <div className="space-y-2.5">
          {commit && (() => { const o = opts.find(x => x.id === commit)!; return (
            <LVRow cols={3} items={[
              { k: 'Revenue at risk', v: fmtINR(o.revenueAtRiskINR) },
              { k: 'Extra cost', v: o.extraCostINR ? fmtINR(o.extraCostINR) : '—' },
              { k: 'Confidence', v: `${o.confidence}%` },
            ]} />
          )})()}
          <Field label="Reason"><textarea className="input h-16 py-1.5" value={why} onChange={e => setWhy(e.target.value)}
            placeholder={commit
              ? `Spending ${fmtINR(opts.find(x => x.id === commit)!.extraCostINR)} to protect ${fmtINR(opts.find(x => x.id === commit)!.revenueAtRiskINR)} of production`
              : 'Why this option'} /></Field>
          <div className="flex gap-1.5 justify-end">
            <button className="btn btn-outline btn-md" onClick={() => setCommit(null)}>Cancel</button>
            <button className="btn btn-primary btn-md" disabled={!why.trim()} onClick={() => {
              const o = opts.find(x => x.id === commit)!
              commitPlan(o.id, `${o.name} — ${mat.name}`, why, -o.extraCostINR)
              setCommit(null); setTab('history')
            }}>Commit</button>
          </div>
        </div>
      </Modal>
    </>
  )
}
