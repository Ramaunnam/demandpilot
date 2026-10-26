import { describe, it, expect } from 'vitest'
import { forecastSeries, spreadsheetMethod, SEASON } from './forecast'
import { computeInventory, zForServiceLevel, dailyUsageStats } from './inventory'
import { detectAnomalies } from './anomaly'
import { buildPlanOptions } from './scenario'
import { buildDataset, HISTORY_WEEKS, FUTURE_WEEKS, STORY, TODAY_WEEK } from '@/data/generate'

const flat = (n: number, v: number) => new Array(n).fill(v)

function seasonal(n: number, base = 100, amp = 0.3) {
  return Array.from({ length: n }, (_, i) => base * (1 + amp * Math.sin((2 * Math.PI * i) / SEASON)))
}

describe('inventory maths', () => {
  it('gives a higher Z for a higher service level', () => {
    expect(zForServiceLevel(99)).toBeGreaterThan(zForServiceLevel(95))
    expect(zForServiceLevel(95)).toBeGreaterThan(zForServiceLevel(90))
  })

  it('reorder point equals usage over the lead time plus safety stock', () => {
    const r = computeInventory({
      materialId: 'X', dailyUsage: 10, usageSd: 2,
      leadTimeDays: 20, leadTimeSdDays: 0,
      onHand: 500, onOrder: 0, serviceLevelPct: 95,
      leadTimeBufferDays: 0, staticMinLevel: 100, costPerUnit: 1000, excessCoverDays: 45,
    })
    expect(r.reorderPoint).toBeCloseTo(10 * 20 + r.safetyStock, 4)
  })

  it('raises safety stock when the service level rises', () => {
    const base = { materialId: 'X', dailyUsage: 10, usageSd: 3, leadTimeDays: 14, leadTimeSdDays: 2,
      onHand: 400, onOrder: 0, leadTimeBufferDays: 0, staticMinLevel: 50, costPerUnit: 100, excessCoverDays: 45 }
    const a = computeInventory({ ...base, serviceLevelPct: 90 })
    const b = computeInventory({ ...base, serviceLevelPct: 99 })
    expect(b.safetyStock).toBeGreaterThan(a.safetyStock)
  })

  it('raises safety stock when the lead time is less reliable', () => {
    const base = { materialId: 'X', dailyUsage: 10, usageSd: 2, leadTimeDays: 14,
      onHand: 400, onOrder: 0, serviceLevelPct: 97, leadTimeBufferDays: 0,
      staticMinLevel: 50, costPerUnit: 100, excessCoverDays: 45 }
    const steady = computeInventory({ ...base, leadTimeSdDays: 0 })
    const erratic = computeInventory({ ...base, leadTimeSdDays: 6 })
    expect(erratic.safetyStock).toBeGreaterThan(steady.safetyStock)
  })

  it('days of cover is stock divided by daily use', () => {
    const r = computeInventory({
      materialId: 'X', dailyUsage: 20, usageSd: 1, leadTimeDays: 10, leadTimeSdDays: 1,
      onHand: 200, onOrder: 0, serviceLevelPct: 95, leadTimeBufferDays: 0,
      staticMinLevel: 50, costPerUnit: 10, excessCoverDays: 45,
    })
    expect(r.daysOfCover).toBeCloseTo(10, 1)
  })

  it('flags excess when cover is far beyond the target', () => {
    const r = computeInventory({
      materialId: 'X', dailyUsage: 1, usageSd: 0.1, leadTimeDays: 7, leadTimeSdDays: 1,
      onHand: 200, onOrder: 0, serviceLevelPct: 95, leadTimeBufferDays: 0,
      staticMinLevel: 10, costPerUnit: 1000, excessCoverDays: 45,
    })
    expect(r.status).toBe('Excess')
    expect(r.excessValue).toBeGreaterThan(0)
  })

  it('flags stockout risk when cover is shorter than the lead time', () => {
    const r = computeInventory({
      materialId: 'X', dailyUsage: 10, usageSd: 1, leadTimeDays: 30, leadTimeSdDays: 2,
      onHand: 50, onOrder: 0, serviceLevelPct: 97, leadTimeBufferDays: 0,
      staticMinLevel: 100, costPerUnit: 100, excessCoverDays: 45,
    })
    expect(r.status).toBe('Stockout risk')
    expect(r.orderByDays).toBeLessThan(0)
  })

  it('converts a weekly series to daily usage', () => {
    const { daily } = dailyUsageStats(flat(10, 70))
    expect(daily).toBeCloseTo(10, 5)
  })
})

describe('forecasting', () => {
  const priceIndex = flat(200, 100)
  const signalFlag = flat(200, 0)

  it('picks a model and returns a forecast of the right length', () => {
    const r = forecastSeries({
      skuId: 'A', region: 'North', history: seasonal(104),
      priceIndex, signalFlag, horizon: 12, signalUpliftPct: 0,
    })
    expect(r.forecast).toHaveLength(12)
    expect(r.scores.length).toBeGreaterThanOrEqual(1)
    expect(['Seasonal naive', 'Holt-Winters', 'Ridge regression', 'Look-alike']).toContain(r.model)
  })

  it('tracks a flat series closely', () => {
    const r = forecastSeries({
      skuId: 'A', region: 'North', history: flat(104, 50),
      priceIndex, signalFlag, horizon: 8, signalUpliftPct: 0,
    })
    for (const v of r.forecast) expect(v).toBeGreaterThan(30)
    expect(r.mape).toBeLessThan(20)
  })

  it('never returns a negative forecast', () => {
    const r = forecastSeries({
      skuId: 'A', region: 'North',
      history: Array.from({ length: 104 }, (_, i) => Math.max(0, 60 - i * 0.8)),
      priceIndex, signalFlag, horizon: 16, signalUpliftPct: 0,
    })
    for (const v of r.forecast) expect(v).toBeGreaterThanOrEqual(0)
  })

  it('applies the market signal uplift', () => {
    const base = { skuId: 'A', region: 'North', history: flat(104, 100), priceIndex, signalFlag, horizon: 6 }
    const plain = forecastSeries({ ...base, signalUpliftPct: 0 })
    const lifted = forecastSeries({ ...base, signalUpliftPct: 20 })
    expect(lifted.forecast[0]).toBeGreaterThan(plain.forecast[0] * 1.15)
  })

  it('applies a planner override on top of the model', () => {
    const base = { skuId: 'A', region: 'North', history: flat(104, 100), priceIndex, signalFlag, horizon: 6, signalUpliftPct: 0 }
    const plain = forecastSeries(base)
    const up = forecastSeries({ ...base, overridePct: 10 })
    expect(up.forecast[0]).toBeCloseTo(plain.forecast[0] * 1.1, 2)
  })

  it('produces a band that contains the forecast', () => {
    const r = forecastSeries({
      skuId: 'A', region: 'North', history: seasonal(104),
      priceIndex, signalFlag, horizon: 10, signalUpliftPct: 0,
    })
    r.forecast.forEach((v, i) => {
      expect(r.lower[i]).toBeLessThanOrEqual(v + 1e-6)
      expect(r.upper[i]).toBeGreaterThanOrEqual(v - 1e-6)
    })
  })

  it('marks a short series as short history', () => {
    const r = forecastSeries({
      skuId: 'A', region: 'North', history: flat(12, 20),
      priceIndex, signalFlag, horizon: 6, signalUpliftPct: 0,
    })
    expect(r.shortHistory).toBe(true)
    expect(r.model).toBe('Look-alike')
  })

  it('the spreadsheet method is a flat average', () => {
    const out = spreadsheetMethod(flat(52, 40), 5)
    expect(out).toHaveLength(5)
    out.forEach(v => expect(v).toBeCloseTo(40, 5))
  })

  it('beats the spreadsheet method on a strongly seasonal series', () => {
    const r = forecastSeries({
      skuId: 'A', region: 'North', history: seasonal(104, 100, 0.45),
      priceIndex, signalFlag, horizon: 12, signalUpliftPct: 0,
    })
    expect(r.mape).toBeLessThanOrEqual(r.spreadsheetMape + 0.01)
  })
})

describe('anomaly detection', () => {
  const baseInput = {
    skuId: 'A', skuCode: 'SS-TEST', grade: '304' as const, region: 'North' as const,
    pricePerT: 250000, materialIds: ['RM-101'], signals: [], threshold: 2.5, resolutions: {},
  }

  it('finds nothing in a steady series', () => {
    const out = detectAnomalies({ ...baseInput, history: flat(60, 100) })
    expect(out).toHaveLength(0)
  })

  it('finds a sustained step change', () => {
    const history = [...flat(40, 100), ...flat(6, 150)]
    const out = detectAnomalies({ ...baseInput, history })
    expect(out.length).toBeGreaterThan(0)
    expect(out[0].direction).toBe('Above forecast')
    expect(out[0].deltaPct).toBeGreaterThan(20)
  })

  it('finds a sustained drop', () => {
    const history = [...flat(40, 100), ...flat(6, 55)]
    const out = detectAnomalies({ ...baseInput, history })
    expect(out.length).toBeGreaterThan(0)
    expect(out[0].direction).toBe('Below forecast')
  })

  it('a higher threshold flags fewer things', () => {
    const history = [...flat(40, 100), ...flat(5, 132)]
    const loose = detectAnomalies({ ...baseInput, history, threshold: 1.5 })
    const tight = detectAnomalies({ ...baseInput, history, threshold: 4.0 })
    expect(tight.length).toBeLessThanOrEqual(loose.length)
  })

  it('ignores tiny series where a percentage looks dramatic', () => {
    const out = detectAnomalies({ ...baseInput, history: [...flat(40, 0.2), ...flat(5, 0.5)] })
    expect(out).toHaveLength(0)
  })

  it('keeps a decision that has already been made', () => {
    const history = [...flat(40, 100), ...flat(6, 150)]
    const first = detectAnomalies({ ...baseInput, history })
    const id = first[0].id
    const again = detectAnomalies({ ...baseInput, history, resolutions: { [id]: 'Accepted as new trend' } })
    expect(again[0].status).toBe('Accepted as new trend')
  })
})

describe('plan options', () => {
  it('the recommended option cuts revenue at risk', () => {
    const opts = buildPlanOptions({
      materialName: 'Test alloy', qty: 10, unit: 't', baseCostPerUnit: 100000,
      daysToSafetyBreach: 20, daysToStockout: 30,
      primaryLeadDays: 42, primaryName: 'Primary', primaryPriceVarPct: 0,
      fastLeadDays: 12, fastName: 'Fast', fastPriceVarPct: 8,
      revenueExposureINR: 10_000_000, transferAvailableUnits: 3,
      transferFromRegion: 'West', transferDays: 4,
    })
    const doNothing = opts.find(o => o.name === 'Do nothing')!
    const best = opts.find(o => o.recommended)!
    expect(best.revenueAtRiskINR).toBeLessThan(doNothing.revenueAtRiskINR)
    expect(best.serviceLevelPct).toBeGreaterThan(doNothing.serviceLevelPct)
    expect(opts).toHaveLength(4)
  })
})

describe('the demo data set', () => {
  const ds = buildDataset()

  it('has the volumes the brief asks for', () => {
    expect(ds.skus).toHaveLength(240)
    expect(ds.materials).toHaveLength(40)
    expect(ds.suppliers).toHaveLength(15)
    expect(ds.customers).toHaveLength(60)
    expect(ds.regions).toHaveLength(4)
    expect(ds.warehouses).toHaveLength(6)
    expect(ds.plants).toHaveLength(2)
    expect(ds.lines).toHaveLength(5)
    expect(ds.signals.length).toBeGreaterThanOrEqual(30)
    expect(ds.orders.length).toBeGreaterThan(600)
    expect(ds.purchaseOrders.length).toBeGreaterThan(200)
    expect(ds.planHistory.length).toBeGreaterThanOrEqual(20)
  })

  it('has 104 weeks of history for every product and region', () => {
    expect(ds.demand).toHaveLength(240 * 4)
    // Plus the weeks held back for the Advance control, which the engine only
    // reveals as the planning week moves forward.
    for (const d of ds.demand.slice(0, 50)) expect(d.weeks).toHaveLength(HISTORY_WEEKS + FUTURE_WEEKS)
  })

  it('holds back enough weeks for every step the calendar offers', () => {
    expect(FUTURE_WEEKS).toBeGreaterThan(12)
    for (const d of ds.demand.slice(0, 80)) {
      for (let t = HISTORY_WEEKS; t < HISTORY_WEEKS + 13; t++) {
        expect(Number.isFinite(d.weeks[t])).toBe(true)
        expect(d.weeks[t]).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('carries the demand level into those weeks, so advancing has no cliff', () => {
    // Advancing the planning week reveals these as actuals. If they were empty
    // or wildly off, every history line on screen would drop off a shelf.
    const total = (t: number) => ds.demand.reduce((s, d) => s + (d.weeks[t] ?? 0), 0)
    const todayLevel = total(TODAY_WEEK - 1)
    for (let n = 0; n < 13; n++) {
      const ahead = total(TODAY_WEEK + n)
      expect(ahead).toBeGreaterThan(todayLevel * 0.6)
      expect(ahead).toBeLessThan(todayLevel * 1.6)
    }
  })

  it('is repeatable — the same seed gives the same numbers', () => {
    const a = buildDataset(12345)
    const b = buildDataset(12345)
    expect(a.demand[0].weeks).toEqual(b.demand[0].weeks)
  })

  it('keeps the metallurgy sensible', () => {
    const moly = 'RM-105', nickel = 'RM-104'
    for (const sku of ds.skus) {
      const lines = ds.bom[sku.id].map(b => b.materialId)
      // molybdenum only in 316L
      if (lines.includes(moly)) expect(sku.grade).toBe('316L')
      // 430 uses no nickel
      if (sku.grade === '430') expect(lines).not.toContain(nickel)
    }
  })

  it('every product has a recipe', () => {
    for (const sku of ds.skus) {
      expect(ds.bom[sku.id]).toBeDefined()
      expect(ds.bom[sku.id].length).toBeGreaterThan(5)
    }
  })

  it('builds the South 316L demand step into the history', () => {
    const series = ds.demand.filter(d =>
      d.region === STORY.anomalyRegion &&
      ds.skus.find(s => s.id === d.skuId)?.grade === STORY.anomalyGrade)
    const before = series.reduce((s, d) => s + d.weeks[STORY.anomalyStartWeek - 2], 0)
    const after = series.reduce((s, d) => s + d.weeks[TODAY_WEEK - 1], 0)
    expect(after).toBeGreaterThan(before * 1.15)
  })

  it('gives the critical material a short cover and a long lead time', () => {
    const m = ds.materials.find(x => x.id === STORY.criticalMaterial)!
    expect(m.leadTimeDays).toBeGreaterThanOrEqual(35)
    expect(m.backupSupplierIds.length).toBeGreaterThan(0)
    const fast = ds.suppliers.find(s => s.id === m.backupSupplierIds[0])!
    expect(fast.leadTimeDays).toBeLessThan(m.leadTimeDays)
  })

  it('every material has a supplier that exists', () => {
    for (const m of ds.materials) {
      expect(ds.suppliers.find(s => s.id === m.primarySupplierId)).toBeDefined()
      for (const b of m.backupSupplierIds) expect(ds.suppliers.find(s => s.id === b)).toBeDefined()
    }
  })
})
