import { describe, it, expect } from 'vitest'
import { runPlanning, DEFAULT_SETTINGS } from './index'
import { buildDataset, STORY, weekDate, DEMO_TODAY, REAL_TODAY } from '@/data/generate'
import { spottedText } from './insights'

const DAY = 86_400_000

describe('full planning run', () => {
  const ds = buildDataset()
  const r = runPlanning({
    ds, settings: DEFAULT_SETTINGS, weeksAdvanced: 0,
    overrides: [], anomalyResolutions: {},
  })

  it('completes and produces every output the screens need', () => {
    expect(r.skuForecasts).toHaveLength(240)
    expect(r.materials).toHaveLength(40)
    expect(r.mrp.rows).toHaveLength(40)
    expect(r.mrp.plannedOrders.length).toBeGreaterThan(0)
    expect(r.recommendations.length).toBeGreaterThan(0)
    expect(r.workbench.length).toBeGreaterThan(0)
    expect(r.replay.before.materials.length).toBe(40)
    console.log(`\n  run took ${r.elapsedMs} ms`)
  })

  it('produces sane KPIs', () => {
    const k = r.kpis
    console.log('\n  KPIs:', {
      accuracy: `${k.forecastAccuracyPct}%`,
      spreadsheet: `${k.spreadsheetAccuracyPct}%`,
      bias: `${k.forecastBiasPct}%`,
      anomalies: k.openAnomalies,
      atRisk: k.materialsAtRisk,
      excess: k.excessCount,
      health: k.inventoryHealth,
      invValue: `${(k.inventoryValueINR / 1e7).toFixed(2)} Cr`,
      recs: k.recommendationsOpen,
    })
    expect(k.forecastAccuracyPct).toBeGreaterThan(40)
    expect(k.forecastAccuracyPct).toBeLessThanOrEqual(100)
    expect(k.inventoryHealth).toBeGreaterThan(0)
    expect(k.inventoryValueINR).toBeGreaterThan(0)
  })

  it('beats the three-month average overall', () => {
    expect(r.kpis.forecastAccuracyPct).toBeGreaterThan(r.kpis.spreadsheetAccuracyPct)
  })

  it('uses more than one model across the range', () => {
    console.log('\n  model mix:', r.modelCounts)
    expect(Object.keys(r.modelCounts).length).toBeGreaterThan(1)
  })

  it('catches the South 316L demand shift', () => {
    const story = r.anomalies.filter(a =>
      a.grade === STORY.anomalyGrade && a.region === STORY.anomalyRegion &&
      a.startWeek >= STORY.anomalyStartWeek - 1 && a.deltaPct > 0)
    console.log(`\n  South 316L anomalies found: ${story.length}`)
    if (story.length) {
      console.log(`  largest: ${story[0].skuCode} ${story[0].deltaPct}% spotted ${spottedText(story[0].detectedAfterWeeks)}`)
    }
    expect(story.length).toBeGreaterThan(0)
    // Weekly data, so detection is a whole number of weeks. Two is the limit:
    // past that the old three-month average would have caught it too.
    expect(Math.min(...story.map(a => a.detectedAfterWeeks))).toBeLessThanOrEqual(2)
    for (const a of story) expect(a.detectedAfterDays).toBe(a.detectedAfterWeeks * 7)
  })

  it('puts the molybdenum position under pressure', () => {
    const moly = r.materials.find(m => m.materialId === STORY.criticalMaterial)!
    console.log(`\n  ${moly.name}: ${moly.inv.daysOfCover.toFixed(1)} d cover, status ${moly.inv.status}, order-by ${moly.inv.orderByDays.toFixed(1)} d`)
    expect(moly.inv.daysOfCover).toBeLessThan(45)
    expect(['Stockout risk', 'Reorder now', 'Healthy']).toContain(moly.inv.status)
  })

  it('finds the ferrochrome excess from falling grade 430', () => {
    const fc = r.materials.find(m => m.materialId === STORY.excessMaterial)!
    console.log(`\n  ${fc.name}: ${fc.inv.daysOfCover.toFixed(0)} d cover, status ${fc.inv.status}, excess ${(fc.inv.excessValue / 1e5).toFixed(1)} L`)
    expect(fc.inv.daysOfCover).toBeGreaterThan(DEFAULT_SETTINGS.excessCoverDays)
    expect(fc.inv.status).toBe('Excess')
  })

  it('recommends both buying and reducing', () => {
    const buys = r.recommendations.filter(x => x.valueINR > 0)
    const cuts = r.recommendations.filter(x => x.valueINR < 0)
    console.log(`\n  ${buys.length} buy recommendations, ${cuts.length} reductions`)
    expect(buys.length).toBeGreaterThan(0)
    expect(cuts.length).toBeGreaterThan(0)
  })

  it('cuts stockouts sharply without claiming a perfect score', () => {
    const { before, after } = r.replay
    console.log(`\n  replay — spreadsheet: ${before.totalStockouts} stockout weeks across ${before.materialsWithStockout} materials, ${before.lineStopDays} line-stop days`)
    console.log(`  replay — DemandPilot: ${after.totalStockouts} stockout weeks across ${after.materialsWithStockout} materials, ${after.lineStopDays} line-stop days`)
    console.log(`  service level (by value): ${before.serviceLevelPct}% -> ${after.serviceLevelPct}%`)
    console.log(`  avg stock: ${(before.avgInventoryValueINR / 1e7).toFixed(1)} Cr -> ${(after.avgInventoryValueINR / 1e7).toFixed(1)} Cr`)

    // A large improvement, not a clean sweep. The replay carries the engine's
    // real forecast error and the supplier panel's real on-time record, so a
    // handful of stockouts survive — and they should. A simulation that returns
    // a flawless score is the least believable thing on the page.
    expect(after.totalStockouts).toBeGreaterThan(0)
    expect(after.totalStockouts).toBeLessThan(before.totalStockouts * 0.15)
    expect(after.materialsWithStockout).toBeLessThan(before.materialsWithStockout * 0.25)
    expect(after.lineStopDays).toBeLessThan(before.lineStopDays * 0.15)
    expect(after.serviceLevelPct).toBeGreaterThan(99)
    expect(after.serviceLevelPct).toBeLessThan(100)

    // And the old method must genuinely fail, or the comparison proves nothing.
    expect(before.totalStockouts).toBeGreaterThan(20)
    expect(before.materialsWithStockout).toBeGreaterThan(5)
  })

  it('reports the stock trade-off instead of claiming a saving it does not have', () => {
    const { before, after, deltas } = r.replay
    console.log(`\n  storage cost: ${(before.storageCostINR / 1e7).toFixed(2)} Cr -> ${(after.storageCostINR / 1e7).toFixed(2)} Cr`)
    console.log(`  production stopped: ${(before.productionStoppedINR / 1e7).toFixed(0)} Cr -> ${(after.productionStoppedINR / 1e7).toFixed(0)} Cr`)
    console.log(`  extra holding ${(deltas.extraHoldingCostINR / 1e7).toFixed(2)} Cr protects ${(deltas.productionProtectedINR / 1e7).toFixed(0)} Cr`)

    // On this opening position DemandPilot genuinely holds more, because cover
    // below a long lead time cannot be replaced in time. The page has to say
    // that with numbers rather than bury it.
    expect(after.avgInventoryValueINR).toBeGreaterThan(before.avgInventoryValueINR)
    expect(deltas.extraHoldingCostINR).toBeGreaterThan(0)

    // And what that extra cover buys must be measured, not asserted.
    expect(deltas.productionProtectedINR).toBeGreaterThan(deltas.extraHoldingCostINR)
    expect(before.productionStoppedINR).toBeGreaterThan(after.productionStoppedINR)
  })

  it('measures service level by value, not by mixed units', () => {
    // Oxygen is counted in cubic metres and nickel in tonnes. Adding them gives
    // a dimensionless number dominated by whichever unit is smallest, so the
    // fill rate is weighted by rupees instead.
    const { before, after } = r.replay
    expect(after.serviceLevelPct).toBeGreaterThan(before.serviceLevelPct)
    // Running out of the most valuable materials has to hurt the old score.
    expect(before.serviceLevelPct).toBeLessThan(95)
  })

  it('keeps the Proof page consistent with the rest of the app', () => {
    // The Health tile and the Proof table must read the same service level.
    expect(r.kpis.serviceLevelPct).toBe(r.replay.after.serviceLevelPct)
    // Line-stop days are a total across all lines, so they can never be fewer
    // than the number of stockout weeks that produced them.
    expect(r.replay.before.lineStopDays).toBeGreaterThanOrEqual(r.replay.before.totalStockouts)
    expect(r.replay.after.lineStopDays).toBeGreaterThanOrEqual(r.replay.after.totalStockouts)
  })

  it('identifies real excess stock to release at the same time', () => {
    // The other half of the case study's problem: too much of some things while
    // short of others. Both must show up, or the story is only half told.
    expect(r.kpis.excessValueINR).toBeGreaterThan(0)
    expect(r.kpis.excessCount).toBeGreaterThan(0)
    expect(r.recommendations.some(x => x.type === 'Reduce / delay')).toBe(true)
    expect(r.recommendations.some(x => x.valueINR > 0)).toBe(true)
  })

  it('writes a plain-language insight for every screen', () => {
    for (const lines of Object.values(r.insights)) {
      expect(lines.length).toBeGreaterThan(0)
      for (const l of lines) expect(l.length).toBeGreaterThan(20)
    }
    console.log('\n  overview insights:')
    r.insights.overview.forEach(l => console.log(`   • ${l}`))
  })

  it('responds to a settings change', () => {
    const tighter = runPlanning({
      ds, settings: { ...DEFAULT_SETTINGS, serviceLevelPct: 99 },
      weeksAdvanced: 0, overrides: [], anomalyResolutions: {},
    })
    expect(tighter.kpis.materialsAtRisk).toBeGreaterThanOrEqual(r.kpis.materialsAtRisk)
  })
})

/**
 * The demo is anchored to the real calendar, so the dates on screen always read
 * as current, and the planning week can be walked forward from there.
 */
describe('the planning calendar', () => {
  const ds = buildDataset()

  it('starts on the Monday of the week that contains today', () => {
    expect(DEMO_TODAY.getDay()).toBe(1)
    const diff = REAL_TODAY.getTime() - DEMO_TODAY.getTime()
    expect(diff).toBeGreaterThanOrEqual(0)
    expect(diff).toBeLessThan(7 * DAY)
    console.log(`\n  today ${REAL_TODAY.toDateString()} · planning week opens ${DEMO_TODAY.toDateString()}`)
  })

  it('puts the planning week where the engine thinks today is', () => {
    expect(weekDate(ds, ds.todayWeek).getTime()).toBe(DEMO_TODAY.getTime())
  })

  it('has a real Monday behind every jump the calendar offers', () => {
    for (let n = 0; n <= 12; n++) {
      const d = weekDate(ds, ds.todayWeek + n)
      expect(d.getDay()).toBe(1)
      expect(Math.round((d.getTime() - DEMO_TODAY.getTime()) / DAY)).toBe(7 * n)
    }
  })

  it('keeps two years of history behind today and a quarter ahead', () => {
    expect(weekDate(ds, 0).getTime()).toBeLessThan(DEMO_TODAY.getTime() - 700 * DAY)
    // A plan made from the furthest week the control allows still needs a real
    // date for every week of its 26-week horizon.
    expect(ds.weekDates.length).toBeGreaterThan(ds.todayWeek + 12 + DEFAULT_SETTINGS.horizonWeeks)
    const seen = new Set(ds.weekDates.slice(ds.todayWeek, ds.todayWeek + 39).map(d => d.getTime()))
    expect(seen.size).toBe(39)
  })
})

describe('advancing the week', () => {
  const ds = buildDataset()
  const run = (weeksAdvanced: number) => runPlanning({
    ds, settings: DEFAULT_SETTINGS, weeksAdvanced, overrides: [], anomalyResolutions: {},
  })
  const now = run(0)
  const later = run(6)

  it('moves the engine on by the same number of weeks', () => {
    expect(later.todayWeek).toBe(now.todayWeek + 6)
    expect(run(1).todayWeek).toBe(now.todayWeek + 1)
  })

  it('feeds in the newer actuals, so the numbers actually move', () => {
    const changed =
      later.kpis.forecastAccuracyPct !== now.kpis.forecastAccuracyPct ||
      later.kpis.materialsAtRisk !== now.kpis.materialsAtRisk ||
      later.kpis.inventoryValueINR !== now.kpis.inventoryValueINR
    expect(changed).toBe(true)
  })

  it('still fills every screen six weeks out', () => {
    expect(later.skuForecasts).toHaveLength(240)
    expect(later.materials).toHaveLength(40)
    expect(later.mrp.rows).toHaveLength(40)
    expect(later.recommendations.length).toBeGreaterThan(0)
    expect(later.workbench.length).toBeGreaterThan(0)
    for (const lines of Object.values(later.insights)) expect(lines.length).toBeGreaterThan(0)
  })

  it('keeps every projection inside the data it has', () => {
    const last = ds.weekDates.length - 1
    for (const m of later.materials) {
      for (const pt of m.projection) {
        expect(pt.week).toBeGreaterThanOrEqual(later.todayWeek)
        expect(pt.week).toBeLessThanOrEqual(last)
        expect(Number.isFinite(pt.onHand)).toBe(true)
      }
    }
  })

  it('survives the far end of the calendar control', () => {
    const edge = run(12)
    expect(edge.todayWeek).toBe(now.todayWeek + 12)
    expect(edge.materials).toHaveLength(40)
    expect(edge.skuForecasts.every(f => f.total.length > 0)).toBe(true)
  })
})
