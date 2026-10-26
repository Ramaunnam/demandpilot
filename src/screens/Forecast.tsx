import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Head, Tile, Tiles, Panel, Chip, Status, Tabs, Bar, Modal, Field, LV } from '@/ui/kit'
import { Chart, Forecast as FChart, Decomp, Bars, Heat, useC } from '@/ui/charts'
import { Table, type Col } from '@/ui/Table'
import { fmtT, fmtPct, fmtSigned, fmtNum, mean } from '@/lib/format'
import { wkLabel, buildForecastSeries } from '@/lib/view'
import { spreadsheetMethod } from '@/engine/forecast'
import type { SkuForecast } from '@/engine'
import type { RegionName } from '@/data/types'

const R: RegionName[] = ['North', 'South', 'East', 'West']

export default function Forecast() {
  const C = useC()
  const { result, ds, addOverride, overrides, removeOverride } = useStore()
  const r = result!
  const [sp, setSp] = useSearchParams()
  const [tab, setTab] = useState(sp.get('tab') ?? 'chart')
  // Grade and region come off the URL so a Signal can open Forecast already
  // narrowed to the products it affects.
  const [grade, setGrade] = useState(sp.get('g') ?? 'All')
  const [region, setRegion] = useState<'All' | RegionName>((sp.get('rg') as RegionName) ?? 'All')
  const [ovOpen, setOvOpen] = useState(false)
  const [pct, setPct] = useState('0')
  const [why, setWhy] = useState('')

  const skuId = sp.get('s') ?? r.skuForecasts.find(f => f.grade === '316L' && f.code.includes('CR-1.0-2B'))?.skuId ?? r.skuForecasts[0].skuId
  const setSku = (id: string) => setSp(p => { p.set('s', id); return p }, { replace: true })
  const f = r.skuForecasts.find(x => x.skuId === skuId) ?? r.skuForecasts[0]
  const list = useMemo(() => r.skuForecasts.filter(x => grade === 'All' || x.grade === grade), [r.skuForecasts, grade])

  // Changing grade used to leave a product from another grade selected.
  useEffect(() => {
    if (list.length && !list.some(x => x.skuId === skuId)) setSku(list[0].skuId)
  }, [grade, list, skuId])

  const chart = useMemo(() => {
    const hist: number[] = []
    for (let i = 0; i < r.todayWeek; i++) {
      let t = 0
      for (const g of R) { if (region !== 'All' && g !== region) continue
        t += ds.demand.find(d => d.skuId === f.skuId && d.region === g)?.weeks[i] ?? 0 }
      hist.push(t)
    }
    const old = spreadsheetMethod(hist, 1)[0]
    const s = buildForecastSeries({
      ds, history: hist, todayWeek: r.todayWeek, historyWeeks: 24, horizonWeeks: 14,
      forecast: region === 'All' ? f.total : f.byRegion[region],
      lower: region === 'All' ? f.lower : f.regionResults[region].lower,
      upper: region === 'All' ? f.upper : f.regionResults[region].upper,
    })
    return s.map(p => ({ ...p, old: p.actual === null ? +old.toFixed(1) : null }))
  }, [f, region, ds, r.todayWeek])

  const decomp = useMemo(() => {
    const p = region === 'All' ? f.parts : f.regionResults[region].parts
    return p.base.slice(0, 10).map((b, i) => ({
      label: wkLabel(ds, r.todayWeek + i), base: +b.toFixed(1),
      trend: +p.trend[i].toFixed(1), season: +p.season[i].toFixed(1), signal: +p.signal[i].toFixed(1),
    }))
  }, [f, region, ds, r.todayWeek])

  const byGrade = useMemo(() => ['304', '316L', '430', '201'].map(g => ({
    label: g, t: Math.round(r.skuForecasts.filter(x => x.grade === g).reduce((s, x) => s + x.total.slice(0, 13).reduce((a, b) => a + b, 0), 0)),
  })), [r.skuForecasts])

  const byRegion = useMemo(() => R.map(g => ({
    label: g, t: Math.round(r.forecastByRegion[g].slice(0, 13).reduce((a, b) => a + b, 0)),
  })), [r])

  const heat = useMemo(() => [...list].sort((a, b) => b.recentAvg - a.recentAvg).slice(0, 18), [list])

  const modelMix = useMemo(() => Object.entries(r.modelCounts)
    .map(([label, n]) => ({ label: label.split(' ')[0], n }))
    .sort((a, b) => b.n - a.n), [r.modelCounts])

  const errByGrade = useMemo(() => ['304', '316L', '430', '201'].map(g => {
    const fs = r.skuForecasts.filter(x => x.grade === g)
    return {
      label: g,
      dp: +mean(fs.map(x => x.mape)).toFixed(1),
      old: +mean(fs.map(x => x.spreadsheetMape)).toFixed(1),
    }
  }), [r.skuForecasts])
  const ov = overrides.find(o => o.skuId === f.skuId && (o.region === region || o.region === 'All'))

  /**
   * Model scores on the same basis as the headline error beside them.
   *
   * This used to hard-code South whenever the region filter said "All", so the
   * panel showed one region's bars under an all-region MAPE — a label reading
   * 8.7% above a bar drawn at 13%. With "All" selected the scores are now
   * volume-weighted across regions exactly as `f.mape` is.
   */
  const scores = useMemo(() => {
    if (region !== 'All') return f.regionResults[region].scores
    const acc = new Map<string, { model: string; w: number; mape: number; bias: number; rmse: number }>()
    for (const g of R) {
      const rr = f.regionResults[g]
      const w = Math.max(0.01, rr.recentAvg)
      for (const sc of rr.scores) {
        const e = acc.get(sc.model) ?? { model: sc.model, w: 0, mape: 0, bias: 0, rmse: 0 }
        e.w += w; e.mape += sc.mape * w; e.bias += sc.bias * w; e.rmse += sc.rmse * w
        acc.set(sc.model, e)
      }
    }
    return [...acc.values()]
      .map(e => ({ model: e.model as typeof f.model, mape: e.mape / e.w, bias: e.bias / e.w, rmse: e.rmse / e.w }))
      .sort((a, b) => a.mape - b.mape)
  }, [f, region])

  const cols: Col<SkuForecast>[] = [
    { key: 'code', h: 'Product', w: '150px', cell: x => <span className="font-mono text-sm font-semibold">{x.code}</span>, val: x => x.code },
    { key: 'g', h: 'Grade', cell: x => <Chip tone="neutral">{x.grade}</Chip>, val: x => x.grade },
    { key: 'm', h: 'Model', cell: x => <Chip tone={x.model === 'Ridge regression' ? 'ai' : x.model === 'Holt-Winters' ? 'info' : 'neutral'}>{x.model.split(' ')[0]}</Chip>, val: x => x.model },
    { key: 'now', h: 'Now', right: true, cell: x => fmtT(x.recentAvg), val: x => x.recentAvg },
    { key: 'next', h: '12 wk', right: true, cell: x => fmtT(x.total.slice(0, 12).reduce((a, b) => a + b, 0)), val: x => x.total.slice(0, 12).reduce((a, b) => a + b, 0) },
    { key: 'chg', h: 'Change', right: true, cell: x => <span className={x.changePct > 8 ? 'text-success font-semibold' : x.changePct < -8 ? 'text-danger font-semibold' : ''}>{fmtSigned(x.changePct)}</span>, val: x => x.changePct },
    { key: 'err', h: 'Error', right: true, term: 'MAPE', cell: x => fmtPct(x.mape), val: x => x.mape },
    { key: 'gain', h: 'vs old', right: true, cell: x => <span className={x.spreadsheetMape > x.mape ? 'text-success' : 'text-danger'}>{fmtSigned(x.spreadsheetMape - x.mape, 1, '')}</span>, val: x => x.spreadsheetMape - x.mape },
    { key: 'tr', h: 'Trend', cell: x => <Status v={x.accuracyTrend} />, val: x => x.accuracyTrend },
  ]

  return (
    <>
      <Head title="Forecast" blurb={`${r.skuForecasts.length} products × ${R.length} regions, ${r.horizon} weeks ahead`}
        chips={<Chip tone="ai">{Object.entries(r.modelCounts).sort((a, b) => b[1] - a[1])[0][0]} leads</Chip>}
        actions={<button className="btn btn-outline btn-sm" onClick={() => { setPct(String(ov?.pct ?? 0)); setOvOpen(true) }}>
          <Pencil className="w-3 h-3" /> Override</button>} />

      <Tiles>
        <Tile k="Accuracy" v={fmtPct(r.kpis.forecastAccuracyPct, 1)} delta={+(r.kpis.forecastAccuracyPct - r.kpis.spreadsheetAccuracyPct).toFixed(1)} deltaGood="up" sub="vs old method" tone="success" />
        <Tile k="Bias" v={fmtSigned(r.kpis.forecastBiasPct)} sub={r.kpis.forecastBiasPct >= 0 ? 'runs high' : 'runs low'} tone={Math.abs(r.kpis.forecastBiasPct) < 4 ? 'success' : 'warning'} />
        <Tile k="Series" v={fmtNum(r.skuForecasts.length * 4)} sub="fitted & tested" />
        <Tile k="Next 12 wk" v={fmtT(r.totalForecast.slice(0, 12).reduce((a, b) => a + b, 0))} />
        <Tile k="Horizon" v={`${r.horizon}`} unit="wk" to="/setup" />
        <Tile k="Overrides" v={fmtNum(overrides.length)} tone={overrides.length ? 'warning' : 'success'} />
      </Tiles>

      <div className="flex flex-wrap items-center gap-1.5 mt-3 mb-2">
        <select className="input w-auto" value={grade} onChange={e => setGrade(e.target.value)}>
          <option>All</option>{['304', '316L', '430', '201'].map(g => <option key={g}>{g}</option>)}
        </select>
        <select className="input w-auto max-w-[190px]" value={f.skuId} onChange={e => setSku(e.target.value)}>
          {list.map(x => <option key={x.skuId} value={x.skuId}>{x.code}</option>)}
        </select>
        <select className="input w-auto" value={region} onChange={e => setRegion(e.target.value as any)}>
          <option value="All">All regions</option>{R.map(x => <option key={x}>{x}</option>)}
        </select>
        <div className="flex-1" />
        <Tabs active={tab} onChange={setTab} tabs={[
          { id: 'chart', label: 'Chart' }, { id: 'parts', label: 'Parts' },
          { id: 'levels', label: 'Levels' }, { id: 'heat', label: 'Heatmap' },
          { id: 'table', label: 'Table', n: list.length },
          { id: 'accuracy', label: 'Model accuracy' },
        ]} />
      </div>

      {tab === 'chart' && (
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Chart title={f.code} h={280} right={<Chip tone="neutral">{region === 'All' ? 'all regions' : region}</Chip>}>
              <FChart data={chart} fence={wkLabel(ds, r.todayWeek)} fenceLabel="today" showOld />
            </Chart>
          </div>
          <div className="space-y-3">
            <Panel title="Model chosen">
              <div className="flex items-center gap-2 mb-2">
                <Chip tone="ai">{f.model}</Chip>
                <span className="num text-2xs text-muted">{fmtPct(f.mape)} error</span>
              </div>
              <div className="space-y-1.5">
                {scores.map(s => (
                  <div key={s.model} className="grid grid-cols-[88px_1fr_auto] items-center gap-2">
                    <span className="text-2xs truncate">{s.model.split(' ')[0]}</span>
                    <Bar pct={Math.min(100, s.mape * 2)} tone={s.model === f.model ? 'primary' : 'neutral'} />
                    <span className="num text-2xs w-10 text-right">{fmtPct(s.mape, 0)}</span>
                  </div>
                ))}
              </div>
              <p className="text-2xs text-muted mt-2 pt-2 border-t border-line">Lower bar = lower error. Tested on 12 held-out weeks.</p>
            </Panel>
            <Panel title="Drivers">
              <div className="space-y-1">
                {f.drivers.slice(0, 5).map(d => (
                  <div key={d.name} className="grid grid-cols-[1fr_auto] items-center gap-2">
                    <span className="text-2xs truncate">{d.name}</span>
                    <div className="w-20"><Bar pct={d.weight * 100} tone="ai" /></div>
                  </div>
                ))}
              </div>
            </Panel>
            {ov && (
              <Panel title="Override" right={<button className="btn btn-ghost btn-xs text-danger" onClick={() => removeOverride(f.skuId, ov.region)}>Remove</button>}>
                <div className="num text-lg font-bold">{fmtSigned(ov.pct)}</div>
                <p className="text-2xs text-muted mt-0.5">{ov.reason}</p>
              </Panel>
            )}
          </div>
        </div>
      )}

      {tab === 'parts' && (
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Chart title="Base + trend + season + signal" h={280}>
              <Decomp data={decomp} />
            </Chart>
          </div>
          <Panel title="Average per week">
            <div className="grid grid-cols-2 gap-2">
              <LV k="Base" v={fmtT(mean(decomp.map(d => d.base)))} />
              <LV k="Trend" v={fmtT(mean(decomp.map(d => d.trend)))} />
              <LV k="Season" v={fmtT(mean(decomp.map(d => d.season)))} />
              <LV k="Signal" v={fmtT(mean(decomp.map(d => d.signal)))} tone={Math.abs(mean(decomp.map(d => d.signal))) > 1 ? 'warning' : undefined} />
            </div>
            <p className="text-2xs text-muted mt-2 pt-2 border-t border-line">
              Base level, trend, season and market signal, separated.
            </p>
          </Panel>
        </div>
      )}

      {tab === 'levels' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Chart title="Next 13 weeks by grade" h={220}>
            <Bars data={byGrade} x="label" unit=" t" bars={[{ k: 't', name: 'Tonnes' }]} />
          </Chart>
          <Chart title="Next 13 weeks by region" h={220}>
            <Bars data={byRegion} x="label" unit=" t" bars={[{ k: 't', name: 'Tonnes', color: C.info }]} />
          </Chart>
          <Panel className="lg:col-span-2" title="316L by region — next 13 weeks">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {R.map(g => (
                <div key={g} className="rounded-lg border border-line bg-surface2 px-3 py-2">
                  <div className="text-2xs text-muted">{g}</div>
                  <div className="num text-lg font-bold">
                    {fmtT(r.skuForecasts.filter(x => x.grade === '316L').reduce((s, x) => s + x.byRegion[g].slice(0, 13).reduce((a, b) => a + b, 0), 0))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {tab === 'heat' && (
        <Panel title="Change vs previous 8 weeks" right={<Chip tone="neutral">top 18 by volume</Chip>}>
          <Heat rows={heat.map(x => x.code)} cols={R}
            fmt={v => { const n = Math.round(v); return `${n > 0 ? '+' : ''}${n === 0 ? 0 : n}` }}
            get={(code, g) => {
              const x = heat.find(h => h.code === code)
              const rr = x?.regionResults[g as RegionName]
              if (!rr || rr.priorAvg <= 0.01) return null
              return ((rr.recentAvg - rr.priorAvg) / rr.priorAvg) * 100
            }}
            onCell={(code, g) => { const x = heat.find(h => h.code === code); if (x) { setSku(x.skuId); setRegion(g as RegionName); setTab('chart') } }} />
        </Panel>
      )}

      {tab === 'table' && (
        <Panel pad={false}><div className="pad">
          <Table rows={list} cols={cols} rowKey={x => x.skuId} onRow={x => { setSku(x.skuId); setTab('chart') }}
            search={x => `${x.code} ${x.grade} ${x.model}`} sort={{ key: 'next', dir: 'desc' }} csv="forecast" page={16} />
        </div></Panel>
      )}

      {tab === 'accuracy' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Chart title="Which model wins" h={220} right={<Chip tone="ai">per product</Chip>}>
            <Bars data={modelMix} x="label" bars={[{ k: 'n', name: 'Products' }]} />
          </Chart>
          <Chart title="Error: DemandPilot vs old method" h={220} note="Lower is better. Average error per grade.">
            <Bars data={errByGrade} x="label" unit="%" bars={[
              { k: 'dp', name: 'DemandPilot', color: C.forecast },
              { k: 'old', name: 'Old method', color: C.old },
            ]} />
          </Chart>
          <Panel className="lg:col-span-2">
            <p className="text-base">
              Best of 3 models chosen per product, tested on the last 12 weeks.
            </p>
          </Panel>
        </div>
      )}

      <Modal open={ovOpen} onClose={() => setOvOpen(false)} title={`Override ${f.code}`}>
        <div className="space-y-2.5">
          <Field label="Adjustment %"><input className="input" type="number" value={pct} onChange={e => setPct(e.target.value)} /></Field>
          <Field label="Reason"><textarea className="input h-16 py-1.5" value={why} onChange={e => setWhy(e.target.value)}
            placeholder="Customer confirmed a programme change" /></Field>
          <div className="flex gap-1.5 justify-end">
            <button className="btn btn-outline btn-md" onClick={() => setOvOpen(false)}>Cancel</button>
            <button className="btn btn-primary btn-md" disabled={!why.trim()} onClick={() => {
              addOverride({ skuId: f.skuId, region: region === 'All' ? 'All' : region, pct: Number(pct) || 0, reason: why, by: 'You', at: new Date().toISOString() })
              setOvOpen(false); setWhy('')
            }}>Save</button>
          </div>
        </div>
      </Modal>
    </>
  )
}
