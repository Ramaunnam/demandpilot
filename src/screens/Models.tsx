import { useMemo, useState } from 'react'
import { RefreshCw, AlertTriangle } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Head, Tile, Tiles, Panel, Chip, Status, Ring, Modal, LVRow } from '@/ui/kit'
import { Chart, Bars, useC } from '@/ui/charts'
import { Table, type Col } from '@/ui/Table'
import { fmtPct, fmtSigned, fmtNum, mean } from '@/lib/format'
import type { SkuForecast } from '@/engine'

export default function Models() {
  const C = useC()
  const { result, rerun, toast, loading } = useStore()
  const r = result!
  const [ask, setAsk] = useState(false)
  const [worstFirst, setWorstFirst] = useState(false)

  const mix = useMemo(() => Object.entries(r.modelCounts)
    .map(([label, n]) => ({ label: label.split(' ')[0], n })).sort((a, b) => b.n - a.n), [r.modelCounts])

  const drift = useMemo(() => r.skuForecasts.filter(f => f.accuracyTrend === 'Getting worse')
    .sort((a, b) => b.mape - a.mape), [r.skuForecasts])

  const beats = r.skuForecasts.filter(f => f.mape < f.spreadsheetMape).length

  const byGrade = useMemo(() => ['304', '316L', '430', '201'].map(g => {
    const fs = r.skuForecasts.filter(f => f.grade === g)
    return { label: g, dp: +mean(fs.map(f => f.mape)).toFixed(1), old: +mean(fs.map(f => f.spreadsheetMape)).toFixed(1) }
  }), [r.skuForecasts])

  const drivers = useMemo(() => {
    const acc: Record<string, number[]> = {}
    for (const f of r.skuForecasts) for (const d of f.drivers) (acc[d.name] ??= []).push(d.weight)
    return Object.entries(acc).map(([label, v]) => ({ label, w: +(mean(v) * 100).toFixed(1) }))
      .sort((a, b) => b.w - a.w).slice(0, 7)
  }, [r.skuForecasts])

  const cols: Col<SkuForecast>[] = [
    { key: 'c', h: 'Product', cell: f => <span className="font-mono text-sm font-semibold">{f.code}</span>, val: f => f.code },
    { key: 'vol', h: 'Volume', right: true, cell: f => fmtNum(f.recentAvg, 1), val: f => f.recentAvg },
    { key: 'm', h: 'Model', cell: f => <Chip tone={f.model === 'Ridge regression' ? 'ai' : f.model === 'Holt-Winters' ? 'info' : f.model === 'Look-alike' ? 'warning' : 'neutral'}>{f.model}</Chip>, val: f => f.model },
    { key: 'e', h: 'Error', right: true, term: 'MAPE', cell: f => fmtPct(f.mape), val: f => f.mape },
    { key: 'o', h: 'Old method', right: true, cell: f => <span className="text-muted">{fmtPct(f.spreadsheetMape)}</span>, val: f => f.spreadsheetMape },
    { key: 'g', h: 'Gain', right: true, cell: f => <span className={f.spreadsheetMape > f.mape ? 'text-success font-semibold' : 'text-danger font-semibold'}>{fmtSigned(f.spreadsheetMape - f.mape, 1, '')}</span>, val: f => f.spreadsheetMape - f.mape },
    { key: 'b', h: 'Bias', right: true, term: 'Bias', cell: f => fmtSigned(f.bias), val: f => f.bias },
    { key: 't', h: 'Trend', cell: f => <Status v={f.accuracyTrend} />, val: f => f.accuracyTrend },
    { key: 'd', h: '', cell: f => f.accuracyTrend === 'Getting worse' ? <Chip tone="danger"><AlertTriangle className="w-2.5 h-2.5" /></Chip> : null, val: f => f.accuracyTrend === 'Getting worse' ? 1 : 0 },
  ]

  return (
    <>
      <Head title="Models" blurb="Which model won for each product, how well it does, and when it drifts"
        actions={<button className="btn btn-primary btn-sm" disabled={loading} onClick={() => setAsk(true)}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Retrain</button>} />

      <Tiles>
        <Tile k="Accuracy" v={fmtPct(r.kpis.forecastAccuracyPct, 1)} tone="success"
          delta={+(r.kpis.forecastAccuracyPct - r.kpis.spreadsheetAccuracyPct).toFixed(1)} deltaGood="up" sub="vs old method" />
        <Tile k="Beats old" v={`${Math.round((beats / r.skuForecasts.length) * 100)}%`} sub={`${beats} of ${r.skuForecasts.length}`} tone="success" />
        <Tile k="Bias" v={fmtSigned(r.kpis.forecastBiasPct)} tone={Math.abs(r.kpis.forecastBiasPct) < 4 ? 'success' : 'warning'} />
        <Tile k="Drifting" v={fmtNum(drift.length)} tone={drift.length ? 'warning' : 'success'} />
        <Tile k="Model fits" v={fmtNum(r.skuForecasts.length * 4 * 3)} sub="per run" />
        <Tile k="Run time" v={`${(r.elapsedMs / 1000).toFixed(1)}`} unit="s" />
      </Tiles>

      <div className="grid gap-3 lg:grid-cols-3 mt-3">
        <Chart title="Which model wins" h={190} right={<Chip tone="ai">per product</Chip>}>
          <Bars data={mix} x="label" bars={[{ k: 'n', name: 'Products' }]} />
        </Chart>
        <Chart title="Error by grade" h={190}>
          <Bars data={byGrade} x="label" unit="%" bars={[
            { k: 'dp', name: 'DemandPilot', color: C.forecast },
            { k: 'old', name: 'Old method', color: C.old },
          ]} />
        </Chart>
        <Chart title="What the ML model uses" h={190}>
          <Bars data={drivers} x="label" unit="%" h bars={[{ k: 'w', name: 'Weight', color: C.ai }]} />
        </Chart>
      </div>

      {drift.length > 0 && (
        <Panel className="mt-3 border-warning/30" title="Drifting" right={<Chip tone="warning">{drift.length}</Chip>}>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">
            {drift.slice(0, 8).map(f => (
              <div key={f.skuId} className="rounded-lg border border-line bg-surface2 p-2.5">
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="font-mono text-sm font-semibold">{f.code}</span>
                  <Ring v={Math.max(0, Math.round(100 - f.mape))} size={30} />
                </div>
                <div className="flex gap-2.5">
                  <div><div className="num text-base font-bold">{fmtPct(f.mape, 0)}</div><div className="text-2xs text-muted">error</div></div>
                  <div><div className="num text-base font-bold">{fmtSigned(f.bias, 0)}</div><div className="text-2xs text-muted">bias</div></div>
                </div>
                <Chip tone="neutral" className="mt-1.5">{f.model}</Chip>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel className="mt-3" pad={false}><div className="pad">
        {/* Sorted by volume by default: the biggest sellers are the ones worth
            fixing first. "Worst first" is one click away for an analyst. */}
        <Table rows={r.skuForecasts} cols={cols} rowKey={f => f.skuId}
          search={f => `${f.code} ${f.grade} ${f.model} ${f.accuracyTrend}`}
          sort={worstFirst ? { key: 'e', dir: 'desc' } : { key: 'vol', dir: 'desc' }}
          csv="models" page={16}
          toolbar={
            <button className={`chip ${worstFirst ? 'chip-primary' : 'chip-neutral'}`}
              onClick={() => setWorstFirst(v => !v)}>
              Worst first
            </button>
          } />
      </div></Panel>

      <Modal open={ask} onClose={() => setAsk(false)} title="Retrain every model">
        <LVRow cols={3} items={[
          { k: 'Series', v: fmtNum(r.skuForecasts.length * 4) },
          { k: 'Model fits', v: fmtNum(r.skuForecasts.length * 4 * 3) },
          { k: 'Last run', v: `${(r.elapsedMs / 1000).toFixed(1)}s` },
        ]} />
        <p className="text-base text-muted mt-2.5">
          Refits all three models per series, back-tests again, re-picks the winner, then recalculates
          everything downstream.
        </p>
        <div className="flex gap-1.5 justify-end mt-3">
          <button className="btn btn-outline btn-md" onClick={() => setAsk(false)}>Cancel</button>
          <button className="btn btn-primary btn-md" onClick={() => { rerun(); setAsk(false); toast('Retraining.', 'info') }}>
            <RefreshCw className="w-4 h-4" /> Retrain
          </button>
        </div>
      </Modal>
    </>
  )
}
