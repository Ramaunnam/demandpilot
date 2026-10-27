/**
 * The planning run.
 *
 * One function takes the data set plus the planner's settings and produces
 * every number the app displays. Change a setting, run this again, and every
 * screen moves together — because there is only one source for all of it.
 */
import type { Dataset, RegionName, Grade } from '@/data/types'
import { HISTORY_WEEKS, TODAY_WEEK, STORY } from '@/data/generate'
import { forecastSeries, type ForecastResult, type ModelName } from './forecast'
import { detectAnomalies, groupAnomalies, type Anomaly, type AnomalyStatus } from './anomaly'
import { computeInventory, type InventoryResult } from './inventory'
import { runMrp, type MrpResult } from './mrp'
import { buildRecommendations, type Recommendation } from './procurement'
import { runReplay, type ReplayResult, REPLAY_WEEKS } from './replay'
import { mean, stdev, clamp, fmtDateShort, fmtQty, fmtINR as money } from '@/lib/format'

export interface PlannerSettings {
  serviceLevelPct: number
  anomalyThreshold: number
  horizonWeeks: number
  leadTimeBufferDays: number
  excessCoverDays: number
  respectLotSizes: boolean
  /** How much of a market signal's stated effect we let into the forecast. */
  signalWeightPct: number
}

export const DEFAULT_SETTINGS: PlannerSettings = {
  serviceLevelPct: 97,
  anomalyThreshold: 2.5,
  horizonWeeks: 26,
  leadTimeBufferDays: 5,
  excessCoverDays: 60,
  respectLotSizes: true,
  signalWeightPct: 70,
}

export interface ForecastOverride {
  skuId: string
  region: RegionName | 'All'
  pct: number
  reason: string
  by: string
  at: string
}

export interface RunInput {
  ds: Dataset
  settings: PlannerSettings
  /** How many weeks past the fixed demo date we have advanced. */
  weeksAdvanced: number
  overrides: ForecastOverride[]
  anomalyResolutions: Record<string, AnomalyStatus>
}

export interface SkuForecast {
  skuId: string
  code: string
  name: string
  grade: Grade
  /** Total across all regions. */
  total: number[]
  lower: number[]
  upper: number[]
  byRegion: Record<RegionName, number[]>
  model: ModelName
  modelReason: string
  mape: number
  bias: number
  spreadsheetMape: number
  accuracyTrend: ForecastResult['accuracyTrend']
  drivers: { name: string; weight: number }[]
  parts: ForecastResult['parts']
  recentAvg: number
  priorAvg: number
  changePct: number
  volatility: number
  regionResults: Record<RegionName, ForecastResult>
  valueINR: number
}

export interface MaterialView {
  materialId: string
  code: string
  name: string
  unit: string
  category: string
  critical: boolean
  costPerUnit: number
  inv: InventoryResult
  dailyUsage: number
  weeklyUsage: number
  usageSd: number
  onHand: number
  onOrder: number
  onHandByWh: Record<string, number>
  coverByRegion: Record<string, { qty: number; days: number }>
  /** 12-week projection of stock on hand. */
  projection: { week: number; onHand: number; safety: number; reorder: number }[]
  usedBySkus: string[]
  usedByGrades: Grade[]
  demandNote: string
  anomalyIds: string[]
  signalIds: string[]
  transferSuggestion: { fromWh: string; toWh: string; qty: number; days: number } | null
}

export interface Kpis {
  forecastAccuracyPct: number
  forecastBiasPct: number
  spreadsheetAccuracyPct: number
  /** Open anomalies collapsed into market shifts — what the badge shows. */
  openAnomalies: number
  /** Individual SKU x region series behind those shifts. */
  openAnomalySeries: number
  highAnomalies: number
  materialsAtRisk: number
  stockoutRiskCount: number
  reorderNowCount: number
  excessCount: number
  inventoryValueINR: number
  excessValueINR: number
  openPOs: number
  openPOValueINR: number
  serviceLevelPct: number
  daysOfInventory: number
  inventoryHealth: number
  recommendationsOpen: number
  recommendedSpendINR: number
  cashFreedINR: number
  capacityConstrainedWeeks: number
  signalToActionDays: number
  skusCovered: number
  regionsCovered: number
}

export interface WorkbenchItem {
  id: string
  queue: 'Order now' | 'Expedite' | 'Bring forward' | 'Delay / reduce' | 'Capacity overload' | 'Unusual demand' | 'Missing data'
  severity: 'Critical' | 'High' | 'Medium' | 'Low'
  title: string
  subject: string
  subjectId: string
  subjectKind: 'material' | 'sku' | 'line'
  recommendedAction: string
  reason: string
  confidence: number
  signals: { name: string; weight: number; value: string }[]
  valueINR: number
  dueInDays: number
  linkId: string
}

/**
 * Everything `runReplay` needs, kept so a what-if can re-run the *same*
 * simulation under changed inputs rather than estimating what it might say.
 *
 * Small enough to carry: 40 materials x a few short arrays. Maps survive the
 * structured clone out of the worker.
 */
export interface ReplayInput {
  startWeek: number
  actualUsage: Map<string, number[]>
  priorUsage: Map<string, number[]>
  inbound: Map<string, Map<number, number>>
  onHand: Map<string, number>
  usageSd: Map<string, number>
  downstreamWeeklyValue: Map<string, number>
  signalWeek: number
}

export interface PlanningResult {
  todayWeek: number
  horizon: number
  skuForecasts: SkuForecast[]
  forecastByRegion: Record<RegionName, number[]>
  forecastByGrade: Record<string, number[]>
  totalForecast: number[]
  anomalies: Anomaly[]
  materials: MaterialView[]
  mrp: MrpResult
  recommendations: Recommendation[]
  kpis: Kpis
  workbench: WorkbenchItem[]
  replay: ReplayResult
  insights: Record<string, string[]>
  modelCounts: Record<string, number>
  /** Inputs for re-running the replay in a what-if. See ReplayInput. */
  replayInput: ReplayInput
  elapsedMs: number
}

const REGIONS: RegionName[] = ['North', 'South', 'East', 'West']

// ---------------------------------------------------------------------------

export function runPlanning(inp: RunInput): PlanningResult {
  const t0 = Date.now()
  const { ds, settings } = inp
  const todayWeek = TODAY_WEEK + inp.weeksAdvanced
  const horizon = settings.horizonWeeks

  // Price index aligned to weeks, used as a feature by the ridge model
  const priceIndex = ds.commodity.map(c => (c.nickel + c.moly + c.ferrochrome) / 3)

  // Which signals touch which SKU/region, and how much uplift they imply
  const signalLookup = new Map<string, { ids: string[]; uplift: number; flags: number[] }>()
  const histLen = HISTORY_WEEKS + inp.weeksAdvanced
  for (const sku of ds.skus) {
    for (const region of REGIONS) {
      const key = `${sku.id}|${region}`
      const flags = new Array(ds.commodity.length).fill(0)
      let uplift = 0
      const ids: string[] = []
      for (const s of ds.signals) {
        if (s.kind !== 'Demand') continue
        const gradeHit = s.grades.length === 0 || s.grades.includes(sku.grade)
        const regionHit = s.regions.length === 0 || s.regions.includes(region)
        if (!gradeHit || !regionHit) continue
        ids.push(s.id)
        uplift += s.effectPct * s.confidence * (settings.signalWeightPct / 100) * 0.45
        for (let w = s.week; w < flags.length; w++) flags[w] = 1
      }
      signalLookup.set(key, { ids, uplift: clamp(uplift, -35, 45), flags })
    }
  }

  const demandIndex = new Map<string, number[]>()
  for (const d of ds.demand) demandIndex.set(`${d.skuId}|${d.region}`, d.weeks)

  // ---- 1. Anomalies ---------------------------------------------------------
  // Found first, on the raw history, because the planner's decisions on them
  // feed the forecast below. Detection itself always looks at raw sales, so a
  // decided anomaly stays visible with its decision.
  const anomalies: Anomaly[] = []
  for (const sku of ds.skus) {
    const matIds = (ds.bom[sku.id] ?? []).map(b => b.materialId)
    const relevantSignals = ds.signals
      .filter(s => s.kind === 'Demand' && (s.grades.length === 0 || s.grades.includes(sku.grade)))
      .map(s => ({ id: s.id, week: s.week, title: s.title, effectPct: s.effectPct }))
    for (const region of REGIONS) {
      const hist = (demandIndex.get(`${sku.id}|${region}`) ?? []).slice(0, histLen)
      if (!hist.length) continue
      anomalies.push(...detectAnomalies({
        skuId: sku.id, skuCode: sku.code, grade: sku.grade, region,
        history: hist, pricePerT: sku.pricePerT,
        materialIds: matIds,
        signals: relevantSignals.filter(s => {
          const sig = ds.signals.find(x => x.id === s.id)!
          return sig.regions.length === 0 || sig.regions.includes(region)
        }),
        threshold: settings.anomalyThreshold,
        resolutions: inp.anomalyResolutions,
      }))
    }
  }
  anomalies.sort((a, b) => b.startWeek - a.startWeek || Math.abs(b.deltaPct) - Math.abs(a.deltaPct))

  // Planner decisions, per product × region, applied in the forecast below.
  //  · One-off: the flagged weeks are swapped for what was expected, so the
  //    models stop learning from them.
  //  · New trend: the forecast is moved to the level the product is actually
  //    selling at now, if the models have not already got there.
  // Before this, both buttons only changed a label — nothing downstream moved.
  const decided = new Map<string, Anomaly[]>()
  for (const a of anomalies) {
    if (a.status !== 'Ignored as one-off' && a.status !== 'Accepted as new trend') continue
    const k = `${a.skuId}|${a.region}`
    decided.set(k, [...(decided.get(k) ?? []), a])
  }

  // ---- 2. Forecast every SKU × region --------------------------------------
  const skuForecasts: SkuForecast[] = []
  const modelCounts: Record<string, number> = {}

  for (const sku of ds.skus) {
    const byRegion = {} as Record<RegionName, number[]>
    const regionResults = {} as Record<RegionName, ForecastResult>
    let total = new Array(horizon).fill(0)
    let lower = new Array(horizon).fill(0)
    let upper = new Array(horizon).fill(0)
    let mapeW = 0, mapeSum = 0, biasSum = 0, ssMapeSum = 0

    for (const region of REGIONS) {
      const hist = demandIndex.get(`${sku.id}|${region}`) ?? []
      const history = hist.slice(0, histLen)
      const sig = signalLookup.get(`${sku.id}|${region}`)!
      const ov = inp.overrides.find(o => o.skuId === sku.id && (o.region === region || o.region === 'All'))
      const choices = decided.get(`${sku.id}|${region}`) ?? []
      for (const a of choices) {
        if (a.status !== 'Ignored as one-off') continue
        for (let w = a.startWeek; w < a.startWeek + a.weeksRunning && w < history.length; w++) history[w] = a.expected
      }

      let r = forecastSeries({
        skuId: sku.id, region, history,
        priceIndex, signalFlag: sig.flags, horizon,
        signalUpliftPct: sig.uplift,
        overridePct: ov?.pct,
      })
      const trend = choices.filter(a => a.status === 'Accepted as new trend')
        .sort((x, y) => y.startWeek - x.startWeek)[0]
      if (trend && r.forecast.length) {
        const now = mean(r.forecast.slice(0, 4))
        const behind = trend.deltaT > 0 ? trend.actual > now : trend.actual < now
        if (now > 0 && behind) {
          const f = clamp(trend.actual / now, 0.5, 2)
          r = { ...r, forecast: r.forecast.map(v => v * f), lower: r.lower.map(v => v * f), upper: r.upper.map(v => v * f) }
        }
      }
      regionResults[region] = r
      byRegion[region] = r.forecast
      total = total.map((v, i) => v + r.forecast[i])
      lower = lower.map((v, i) => v + r.lower[i])
      upper = upper.map((v, i) => v + r.upper[i])

      const w = Math.max(0.01, r.recentAvg)
      mapeW += w; mapeSum += r.mape * w; biasSum += r.bias * w; ssMapeSum += r.spreadsheetMape * w
    }

    // The SKU's headline model is the one its biggest region chose.
    const topRegion = REGIONS.reduce((a, b) =>
      regionResults[a].recentAvg >= regionResults[b].recentAvg ? a : b)
    const lead = regionResults[topRegion]
    modelCounts[lead.model] = (modelCounts[lead.model] ?? 0) + 1

    const recentAvg = REGIONS.reduce((s, r) => s + regionResults[r].recentAvg, 0)
    const priorAvg = REGIONS.reduce((s, r) => s + regionResults[r].priorAvg, 0)

    skuForecasts.push({
      skuId: sku.id, code: sku.code, name: sku.name, grade: sku.grade,
      total, lower, upper, byRegion,
      model: lead.model, modelReason: lead.reason,
      mape: mapeW > 0 ? +(mapeSum / mapeW).toFixed(1) : 0,
      bias: mapeW > 0 ? +(biasSum / mapeW).toFixed(1) : 0,
      spreadsheetMape: mapeW > 0 ? +(ssMapeSum / mapeW).toFixed(1) : 0,
      accuracyTrend: lead.accuracyTrend,
      drivers: lead.drivers, parts: lead.parts,
      recentAvg, priorAvg,
      changePct: priorAvg > 0 ? +(((recentAvg - priorAvg) / priorAvg) * 100).toFixed(1) : 0,
      volatility: lead.volatility,
      regionResults,
      valueINR: Math.round(total.reduce((a, b) => a + b, 0) * sku.pricePerT),
    })
  }

  // Aggregations used by the hierarchy view
  const forecastByRegion = {} as Record<RegionName, number[]>
  for (const r of REGIONS) forecastByRegion[r] = new Array(horizon).fill(0)
  const forecastByGrade: Record<string, number[]> = {}
  const totalForecast = new Array(horizon).fill(0)
  for (const f of skuForecasts) {
    forecastByGrade[f.grade] ??= new Array(horizon).fill(0)
    for (let i = 0; i < horizon; i++) {
      totalForecast[i] += f.total[i]
      forecastByGrade[f.grade][i] += f.total[i]
      for (const r of REGIONS) forecastByRegion[r][i] += f.byRegion[r][i]
    }
  }

  // ---- 3. Material requirements and stock health ---------------------------
  const skuForecastMap = new Map(skuForecasts.map(f => [f.skuId, f.total]))

  // weekly usage per material from the forward plan
  const weeklyUsage = new Map<string, number[]>()
  for (const m of ds.materials) weeklyUsage.set(m.id, new Array(horizon).fill(0))
  const usedBySkus = new Map<string, string[]>()
  for (const sku of ds.skus) {
    const f = skuForecastMap.get(sku.id)!
    for (const bl of ds.bom[sku.id] ?? []) {
      const arr = weeklyUsage.get(bl.materialId)!
      for (let i = 0; i < horizon; i++) arr[i] += f[i] * bl.qtyPerTonne * (1 + bl.scrapPct / 100)
      const list = usedBySkus.get(bl.materialId) ?? []
      list.push(sku.id); usedBySkus.set(bl.materialId, list)
    }
  }

  // Historical weekly usage — used both for the variability figure and to seed
  // the "old way" rolling average in the before/after replay.
  const HIST_WEEKS = 26
  const histUsage = new Map<string, number[]>()
  for (const m of ds.materials) histUsage.set(m.id, new Array(HIST_WEEKS).fill(0))
  for (const sku of ds.skus) {
    for (let k = 0; k < HIST_WEEKS; k++) {
      let t = 0
      for (const r of REGIONS) t += (demandIndex.get(`${sku.id}|${r}`) ?? [])[histLen - HIST_WEEKS + k] ?? 0
      for (const bl of ds.bom[sku.id] ?? []) {
        histUsage.get(bl.materialId)![k] += t * bl.qtyPerTonne * (1 + bl.scrapPct / 100)
      }
    }
  }

  // anomaly + signal attribution per material
  const openAnoms = anomalies.filter(a => a.status === 'Open' || a.status === 'Investigating')
  const drivers = new Map<string, { skuCodes: string[]; anomalyIds: string[]; signalIds: string[]; note: string }>()
  for (const m of ds.materials) {
    const skus = usedBySkus.get(m.id) ?? []
    const anomsHere = openAnoms.filter(a => skus.includes(a.skuId) && a.severity !== 'Low')
    const sigIds = [...new Set(ds.signals.filter(s => s.materialIds.includes(m.id)).map(s => s.id))]
    let note = ''
    if (anomsHere.length) {
      const up = anomsHere.filter(a => a.deltaPct > 0)
      const down = anomsHere.filter(a => a.deltaPct < 0)
      const biggest = [...anomsHere].sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))[0]
      if (up.length >= down.length) {
        note = `${biggest.region} demand for grade ${biggest.grade} is running ${Math.abs(biggest.deltaPct).toFixed(0)}% above forecast.`
      } else {
        note = `${biggest.region} demand for grade ${biggest.grade} is running ${Math.abs(biggest.deltaPct).toFixed(0)}% below forecast.`
      }
    }
    drivers.set(m.id, {
      skuCodes: skus.slice(0, 12).map(id => ds.skus.find(s => s.id === id)?.code ?? id),
      anomalyIds: anomsHere.map(a => a.id).slice(0, 8),
      signalIds: sigIds, note,
    })
  }

  // Rupee value of product made each week that depends on each material.
  const downstreamWeeklyValue = new Map<string, number>()
  for (const m of ds.materials) downstreamWeeklyValue.set(m.id, 0)
  for (const sku of ds.skus) {
    const weekly = (skuForecastMap.get(sku.id)?.[0] ?? 0) * sku.pricePerT
    for (const bl of ds.bom[sku.id] ?? []) {
      downstreamWeeklyValue.set(bl.materialId, (downstreamWeeklyValue.get(bl.materialId) ?? 0) + weekly)
    }
  }

  // Deliveries already on the way, by material and week. Needed before the
  // stock projections below, which otherwise show stock sliding to zero while
  // a lorry is three days out — a chart flatly contradicting the status beside it.
  const scheduledReceipts = new Map<string, Map<number, number>>()
  for (const po of ds.purchaseOrders) {
    if (po.status === 'Received' || po.status === 'Cancelled') continue
    const map = scheduledReceipts.get(po.materialId) ?? new Map<number, number>()
    map.set(po.expectedWeek, (map.get(po.expectedWeek) ?? 0) + po.qty * (1 - po.receivedPct / 100))
    scheduledReceipts.set(po.materialId, map)
  }

  const inventory = new Map<string, InventoryResult>()
  const dailyUsageMap = new Map<string, number>()
  const usageSdMap = new Map<string, number>()
  const materials: MaterialView[] = []

  for (const m of ds.materials) {
    const fw = weeklyUsage.get(m.id)!
    const weekly = mean(fw.slice(0, 8))
    const daily = weekly / 7
    const sdWeekly = stdev(histUsage.get(m.id)!.filter(v => v > 0))
    const dailySd = (sdWeekly || weekly * 0.18) / Math.sqrt(7)
    const onHand = Object.values(m.onHandByWh).reduce((a, b) => a + b, 0)

    dailyUsageMap.set(m.id, daily)
    usageSdMap.set(m.id, dailySd)

    const inv = computeInventory({
      materialId: m.id, dailyUsage: daily, usageSd: dailySd,
      leadTimeDays: m.leadTimeDays, leadTimeSdDays: m.leadTimeSdDays,
      onHand, onOrder: m.onOrder,
      serviceLevelPct: settings.serviceLevelPct,
      leadTimeBufferDays: settings.leadTimeBufferDays,
      staticMinLevel: m.staticMinLevel,
      costPerUnit: m.costPerUnit,
      excessCoverDays: settings.excessCoverDays,
    })
    inventory.set(m.id, inv)

    // 12-week stock projection, including deliveries already inbound.
    const projection: MaterialView['projection'] = []
    const inbound = scheduledReceipts.get(m.id)
    let running = onHand
    for (let i = 0; i < Math.min(12, horizon); i++) {
      const week = todayWeek + i
      running = Math.max(0, running + (inbound?.get(week) ?? 0) - fw[i])
      projection.push({
        week, onHand: +running.toFixed(2),
        safety: inv.safetyStock, reorder: inv.reorderPoint,
      })
    }

    // stock and cover by region, so we can suggest transfers
    const coverByRegion: Record<string, { qty: number; days: number }> = {}
    for (const wh of ds.warehouses) {
      const qty = m.onHandByWh[wh.id] ?? 0
      if (qty <= 0) continue
      coverByRegion[wh.id] = { qty: +qty.toFixed(2), days: +(qty / Math.max(0.0001, daily * 0.5)).toFixed(1) }
    }
    const entries = Object.entries(coverByRegion).sort((a, b) => b[1].days - a[1].days)
    const transferSuggestion = entries.length >= 2 && entries[0][1].days > entries[entries.length - 1][1].days * 2.5
      ? { fromWh: entries[0][0], toWh: entries[entries.length - 1][0],
          qty: +((entries[0][1].qty - entries[entries.length - 1][1].qty) / 3).toFixed(2), days: 4 }
      : null

    materials.push({
      materialId: m.id, code: m.code, name: m.name, unit: m.unit, category: m.category,
      critical: m.critical, costPerUnit: m.costPerUnit,
      inv, dailyUsage: daily, weeklyUsage: weekly, usageSd: dailySd,
      onHand, onOrder: m.onOrder, onHandByWh: m.onHandByWh,
      coverByRegion, projection,
      usedBySkus: usedBySkus.get(m.id) ?? [],
      usedByGrades: m.usedByGrades,
      demandNote: drivers.get(m.id)?.note ?? '',
      anomalyIds: drivers.get(m.id)?.anomalyIds ?? [],
      signalIds: drivers.get(m.id)?.signalIds ?? [],
      transferSuggestion,
    })
  }

  // ---- 4. MRP ---------------------------------------------------------------
  const mrp = runMrp({
    ds, startWeek: todayWeek, horizon,
    skuForecast: skuForecastMap,
    safetyStock: new Map([...inventory].map(([k, v]) => [k, v.safetyStock])),
    onHand: new Map(materials.map(m => [m.materialId, m.onHand])),
    scheduledReceipts,
    lotSizeRespected: settings.respectLotSizes,
  })

  // ---- 5. Procurement recommendations --------------------------------------
  const recommendations = buildRecommendations({
    ds, todayWeek, inventory,
    plannedOrders: mrp.plannedOrders,
    dailyUsage: dailyUsageMap,
    drivers,
    stockByRegion: new Map(materials.map(m => [m.materialId, m.onHandByWh])),
    downstreamWeeklyValue,
    excessCoverDays: settings.excessCoverDays,
  })

  // ---- 6. Before vs After replay -------------------------------------------
  const actualUsage = new Map<string, number[]>()
  const priorUsage = new Map<string, number[]>()
  for (const m of ds.materials) {
    const fw = weeklyUsage.get(m.id)!
    actualUsage.set(m.id, fw.slice(0, REPLAY_WEEKS))
    // the 12 weeks of real consumption immediately before today
    priorUsage.set(m.id, histUsage.get(m.id)!.slice())
  }
  const replayInput: ReplayInput = {
    startWeek: todayWeek, actualUsage, priorUsage,
    inbound: scheduledReceipts,
    onHand: new Map(materials.map(m => [m.materialId, m.onHand])),
    usageSd: new Map(materials.map(m => [m.materialId, m.usageSd * 7])),
    downstreamWeeklyValue,
    signalWeek: ds.signals.find(s => s.id === 'SIG-001')?.week ?? todayWeek - 4,
  }

  const replay = runReplay({
    ds, ...replayInput,
    serviceLevelPct: settings.serviceLevelPct,
    leadTimeBufferDays: settings.leadTimeBufferDays,
    excessCoverDays: settings.excessCoverDays,
    storyMaterialId: STORY.criticalMaterial,
  })

  // ---- 7. KPIs --------------------------------------------------------------
  const wsum = skuForecasts.reduce((s, f) => s + Math.max(0.01, f.recentAvg), 0)
  const accuracy = 100 - skuForecasts.reduce((s, f) => s + f.mape * Math.max(0.01, f.recentAvg), 0) / wsum
  const ssAccuracy = 100 - skuForecasts.reduce((s, f) => s + f.spreadsheetMape * Math.max(0.01, f.recentAvg), 0) / wsum
  const bias = skuForecasts.reduce((s, f) => s + f.bias * Math.max(0.01, f.recentAvg), 0) / wsum

  // Counted as market shifts, not as series. A genuine step-up in one region
  // fires the detector in every affected product, so 316L alone can produce
  // dozens of rows for a single decision. See groupAnomalies().
  const openAnoms_ = anomalies.filter(a => a.status === 'Open')
  const openAnomGroups = groupAnomalies(openAnoms_, histLen - 1)
  // The badge counts real shifts. One-off weeks are still listed, and still
  // counted in openAnomalySeries, but they are not each a decision.
  const openAnomCount = openAnomGroups.filter(g => g.kind === 'Shift').length
  const riskCount = materials.filter(m => m.inv.status === 'Stockout risk').length
  const reorderCount = materials.filter(m => m.inv.status === 'Reorder now').length
  const excessCount = materials.filter(m => m.inv.status === 'Excess').length
  const invValue = materials.reduce((s, m) => s + m.inv.stockValue, 0)
  const excessValue = materials.reduce((s, m) => s + m.inv.excessValue, 0)
  const openPOs = ds.purchaseOrders.filter(p => !['Received', 'Cancelled'].includes(p.status))
  const healthW = materials.reduce((s, m) => s + Math.max(1, m.inv.stockValue), 0)
  const health = Math.round(materials.reduce((s, m) => s + m.inv.healthScore * Math.max(1, m.inv.stockValue), 0) / healthW)
  const coverW = materials.reduce((s, m) => s + m.inv.stockValue, 0)
  const doi = coverW > 0
    ? materials.reduce((s, m) => s + Math.min(400, m.inv.daysOfCover) * m.inv.stockValue, 0) / coverW : 0

  const kpis: Kpis = {
    forecastAccuracyPct: +accuracy.toFixed(1),
    forecastBiasPct: +bias.toFixed(1),
    spreadsheetAccuracyPct: +ssAccuracy.toFixed(1),
    openAnomalies: openAnomCount,
    openAnomalySeries: openAnoms_.length,
    highAnomalies: openAnomGroups.filter(g => g.kind === 'Shift' && g.severity === 'High').length,
    materialsAtRisk: riskCount + reorderCount,
    stockoutRiskCount: riskCount,
    reorderNowCount: reorderCount,
    excessCount,
    inventoryValueINR: invValue,
    excessValueINR: excessValue,
    openPOs: openPOs.length,
    openPOValueINR: openPOs.reduce((s, p) => s + p.valueINR, 0),
    serviceLevelPct: replay.after.serviceLevelPct,
    daysOfInventory: +doi.toFixed(1),
    inventoryHealth: health,
    recommendationsOpen: recommendations.length,
    recommendedSpendINR: recommendations.filter(r => r.valueINR > 0).reduce((s, r) => s + r.valueINR, 0),
    cashFreedINR: Math.abs(recommendations.filter(r => r.valueINR < 0).reduce((s, r) => s + r.valueINR, 0)),
    capacityConstrainedWeeks: mrp.production.filter(p => p.constrained).length,
    signalToActionDays: replay.after.signalToOrderDays,
    skusCovered: ds.skus.length,
    regionsCovered: REGIONS.length,
  }

  // ---- 8. Planner's workbench ----------------------------------------------
  const workbench: WorkbenchItem[] = []

  for (const r of recommendations) {
    const queue: WorkbenchItem['queue'] =
      r.type === 'Expedite' ? 'Expedite' :
      r.type === 'Reduce / delay' ? 'Delay / reduce' :
      r.type === 'Bring forward' ? 'Bring forward' : 'Order now'
    workbench.push({
      id: `WB-${r.id}`, queue,
      severity: r.urgency,
      title: `${r.type}: ${r.materialName}`,
      subject: r.materialCode, subjectId: r.materialId, subjectKind: 'material',
      recommendedAction: r.type === 'Reduce / delay'
        ? `Hold the next call-off and release about ${fmtQty(r.qty, r.unit)}`
        : `Order ${fmtQty(r.qty, r.unit)} from ${r.supplierName} ${r.orderByDays <= 0 ? 'today' : `within ${r.orderByDays} days`}`,
      reason: r.reason,
      confidence: r.confidence,
      signals: r.signals.map(s => ({ name: s.name, weight: s.weight, value: s.value })),
      valueINR: r.valueINR,
      dueInDays: r.orderByDays,
      linkId: `/buy`,
    })
  }

  // One row per market shift, not per affected product. A genuine change in a
  // region's buying trips the detector in every series it touches, so listing
  // them individually turned one decision into a dozen near-identical rows.
  for (const g of openAnomGroups.filter(x => x.severity !== 'Low').slice(0, 10)) {
    const peakZ = Math.max(...g.items.map(i => i.zScore))
    workbench.push({
      id: `WB-${g.id}`, queue: 'Unusual demand',
      severity: g.severity === 'High' ? 'High' : 'Medium',
      title: `Unusual demand: grade ${g.grade} in ${g.region}`,
      subject: `${g.grade} · ${g.region}`, subjectId: g.id, subjectKind: 'sku',
      recommendedAction: g.suggestedAction,
      reason: `${g.direction} by ${Math.abs(g.avgDeltaPct).toFixed(0)}% across ${g.products} product${g.products === 1 ? '' : 's'}, ${g.sustainedProducts} of them for 2+ weeks running. ${g.likelyCause}`,
      confidence: g.confidence,
      signals: [
        { name: 'Size of gap', weight: clamp(Math.abs(g.avgDeltaPct) / 60, 0.1, 0.98), value: `${g.avgDeltaPct > 0 ? '+' : ''}${g.avgDeltaPct.toFixed(0)}%` },
        { name: 'Products affected', weight: clamp(g.products / 20, 0.15, 0.98), value: `${g.products}` },
        { name: 'How long it has run', weight: clamp(g.weeksRunning / 4, 0.2, 0.95), value: `${g.weeksRunning} week(s)` },
        { name: 'Matching market signal', weight: g.linkedSignalId ? 0.86 : 0.12, value: g.linkedSignalId ? 'Yes' : 'None found' },
      ],
      valueINR: g.totalImpactINR,
      dueInDays: 3,
      linkId: '/anomalies',
    })
  }

  // Capacity overloads arrive as a run of near-identical weeks. One row for the
  // run, named by date rather than by an internal week index that means nothing
  // to a planner.
  const overloaded = mrp.production.filter(x => x.constrained)
  if (overloaded.length) {
    const first = overloaded[0]
    const worst = [...overloaded].sort((a, b) => b.shortfallT - a.shortfallT)[0]
    const totalT = overloaded.reduce((s, p) => s + p.shortfallT, 0)
    const when = (w: number) => fmtDateShort(ds.weekDates[clamp(w, 0, ds.weekDates.length - 1)])
    workbench.push({
      id: 'WB-CAP', queue: 'Capacity overload',
      severity: worst.shortfallT > worst.capacityT * 0.08 ? 'High' : 'Medium',
      title: overloaded.length === 1
        ? `Plan exceeds line capacity in w/c ${when(first.week)}`
        : `Line capacity over in ${overloaded.length} weeks`,
      subject: `w/c ${when(first.week)}`, subjectId: String(first.week), subjectKind: 'line',
      recommendedAction: `Move about ${totalT.toFixed(0)} t into adjacent weeks or add a shift.`,
      reason: overloaded.map(p =>
        `w/c ${when(p.week)}: ${p.requiredT.toFixed(0)} t wanted against ${p.capacityT.toFixed(0)} t available` +
        (p.maintenanceLines.length ? ` (${p.maintenanceLines[0].toLowerCase()} down for maintenance)` : '')).join(' · '),
      confidence: 90,
      signals: [
        { name: 'Weeks affected', weight: clamp(overloaded.length / 8, 0.2, 0.98), value: `${overloaded.length}` },
        { name: 'Worst overload', weight: clamp(worst.shortfallT / Math.max(1, worst.capacityT) * 6, 0.2, 0.98), value: `${worst.shortfallT.toFixed(0)} t` },
        { name: 'Peak utilisation', weight: clamp(worst.utilisationPct / 110, 0.3, 1), value: `${worst.utilisationPct.toFixed(0)}%` },
      ],
      valueINR: Math.round(totalT * 210000),
      dueInDays: (first.week - todayWeek) * 7,
      linkId: '/plan',
    })
  }

  for (const m of ds.materials.filter(x => x.backupSupplierIds.length === 0 && x.critical).slice(0, 5)) {
    workbench.push({
      id: `WB-SRC-${m.id}`, queue: 'Missing data',
      severity: 'Medium',
      title: `Only one approved supplier: ${m.name}`,
      subject: m.code, subjectId: m.id, subjectKind: 'material',
      recommendedAction: 'Qualify a second supplier so this material has a fallback route.',
      reason: `${m.name} is a critical material with a ${m.leadTimeDays}-day lead time and no approved alternative.`,
      confidence: 82,
      signals: [
        { name: 'Criticality', weight: 0.9, value: 'Critical' },
        { name: 'Lead time', weight: clamp(m.leadTimeDays / 60, 0.1, 0.95), value: `${m.leadTimeDays} d` },
        { name: 'Alternatives', weight: 0.95, value: 'None approved' },
      ],
      valueINR: 0, dueInDays: 30,
      linkId: `/stock?m=${m.id}`,
    })
  }

  const sevRank = { Critical: 0, High: 1, Medium: 2, Low: 3 }
  workbench.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.dueInDays - b.dueInDays)

  // ---- 9. Auto-written insights per screen ---------------------------------
  const storyMat = materials.find(m => m.materialId === STORY.criticalMaterial)
  const excessMat = materials.find(m => m.materialId === STORY.excessMaterial)
  const storyAnom = anomalies.filter(a =>
    a.grade === STORY.anomalyGrade && a.region === STORY.anomalyRegion && a.status === 'Open')
  // For the headline line we lead with the largest exposure, which is a
  // different question from which order is most urgent to place today.
  const topRec = [...recommendations].sort((a, b) => b.revenueAtRiskINR - a.revenueAtRiskINR)[0]

  const storyProducts = new Set(storyAnom.map(a => a.skuId)).size
  const insights: Record<string, string[]> = {
    overview: [
      storyAnom.length
        ? `${STORY.anomalyRegion} demand for grade ${STORY.anomalyGrade} is running about ${Math.abs(mean(storyAnom.map(a => a.deltaPct))).toFixed(0)}% above forecast across ${storyProducts} product${storyProducts > 1 ? 's' : ''}, spotted ${Math.min(...storyAnom.map(a => a.detectedAfterWeeks)) === 0 ? 'in the week it began' : `${Math.min(...storyAnom.map(a => a.detectedAfterWeeks))} week(s) after it began`}.`
        : `No unusual demand above the ${settings.anomalyThreshold} threshold this week.`,
      storyMat
        ? `${storyMat.name} has ${storyMat.inv.daysOfCover.toFixed(0)} days of cover against a ${storyMat.inv.daysToSafetyBreach > 0 ? storyMat.inv.daysToSafetyBreach.toFixed(0) : '0'}-day run to the safety level, and a ${storyMat.inv.daysOfCover < 45 ? 'six-week' : 'long'} import lead time.`
        : '',
      topRec ? `Top action: ${topRec.type.toLowerCase()} ${fmtQty(topRec.qty, topRec.unit)} of ${topRec.materialName} from ${topRec.supplierName}, ${topRec.orderByDays <= 0 ? 'order today' : `order within ${topRec.orderByDays} days`}.` : '',
      excessMat && excessMat.inv.excessValue > 0
        ? `${excessMat.name} is carrying ${excessMat.inv.daysOfCover.toFixed(0)} days of cover — about ${money(excessMat.inv.excessValue)} that could be released.`
        : '',
      `Across ${ds.skus.length} products and ${REGIONS.length} regions, ${kpis.materialsAtRisk} material${kpis.materialsAtRisk === 1 ? '' : 's'} need attention and ${kpis.excessCount} are overstocked.`,
    ].filter(Boolean),
    forecast: [
      `The system picks a different model per product. Right now ${Object.entries(modelCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} use ${k}`).join(', ')}.`,
      `Weighted accuracy is ${accuracy.toFixed(1)}% against ${ssAccuracy.toFixed(1)}% for the three-month average the planner used before — a gain of ${(accuracy - ssAccuracy).toFixed(1)} points.`,
      `Overall bias is ${bias >= 0 ? '+' : ''}${bias.toFixed(1)}%, meaning the forecast runs slightly ${bias >= 0 ? 'high' : 'low'}.`,
    ],
    inventory: [
      `${riskCount} material${riskCount === 1 ? ' is' : 's are'} at stockout risk and ${reorderCount} ${reorderCount === 1 ? 'has' : 'have'} reached the reorder point.`,
      `${excessCount} material${excessCount === 1 ? ' is' : 's are'} above the ${settings.excessCoverDays}-day cover target, holding about ${money(excessValue)} more than the plan needs.`,
      `Stock health is ${health} out of 100, combining availability and excess in one score.`,
    ],
    procurement: [
      `${recommendations.filter(r => r.valueINR > 0).length} buy recommendation${recommendations.filter(r => r.valueINR > 0).length === 1 ? '' : 's'} worth ${money(kpis.recommendedSpendINR)}, and ${recommendations.filter(r => r.valueINR < 0).length} reduction${recommendations.filter(r => r.valueINR < 0).length === 1 ? '' : 's'} that would free ${money(kpis.cashFreedINR)}.`,
      recommendations.filter(r => r.orderByDays <= 0).length
        ? `${recommendations.filter(r => r.orderByDays <= 0).length} recommendation${recommendations.filter(r => r.orderByDays <= 0).length === 1 ? '' : 's'} are already past the normal order-by date and need a faster supplier.`
        : 'Every recommendation can still be met through the usual supplier route.',
      'Nothing is ordered automatically. Each line needs Approve, Edit or Reject.',
    ],
    mrp: [
      `${mrp.plannedOrders.length} planned orders generated across ${ds.materials.length} materials and ${horizon} weeks.`,
      `${mrp.plannedOrders.filter(p => p.late).length} of them should already have been released, given the lead times involved.`,
      kpis.capacityConstrainedWeeks > 0
        ? `${kpis.capacityConstrainedWeeks} week${kpis.capacityConstrainedWeeks === 1 ? '' : 's'} in the plan exceed line capacity, so the plan has been trimmed to what the lines can actually make.`
        : 'Line capacity covers the whole plan over this horizon.',
    ],
    outcomes: [
      `Replaying the same ${REPLAY_WEEKS} weeks both ways: the spreadsheet method hits ${replay.before.totalStockouts} stockout week${replay.before.totalStockouts === 1 ? '' : 's'} across ${replay.before.materialsWithStockout} materials; DemandPilot hits ${replay.after.totalStockouts} across ${replay.after.materialsWithStockout}.`,
      `DemandPilot holds more stock, not less — ${money(replay.after.avgInventoryValueINR)} against ${money(replay.before.avgInventoryValueINR)}, costing ${money(Math.abs(replay.deltas.extraHoldingCostINR))} more to hold. That cover protects ${money(replay.deltas.productionProtectedINR)} of production the old way could not make.`,
      `Time from a market signal appearing to a purchase order being approved drops from ${replay.before.signalToOrderDays} days to ${replay.after.signalToOrderDays}.`,
    ],
  }

  return {
    todayWeek, horizon,
    skuForecasts, forecastByRegion, forecastByGrade, totalForecast,
    anomalies, materials, mrp, recommendations, kpis, workbench, replay,
    insights, modelCounts, replayInput,
    elapsedMs: Date.now() - t0,
  }
}

export { STORY, TODAY_WEEK, HISTORY_WEEKS, REPLAY_WEEKS }
export type { Anomaly, AnomalyStatus, InventoryResult, Recommendation, MrpResult, ReplayResult, ForecastResult, ModelName }
