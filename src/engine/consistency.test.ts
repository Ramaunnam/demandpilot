/**
 * Cross-page agreement.
 *
 * The app's credibility problem was never a wrong calculation — it was the same
 * question answered differently on different screens. Three service levels, two
 * purchase-spend figures, four counts of "late". Each number was individually
 * defensible and the dashboard as a whole was not.
 *
 * These tests exist so that can only happen again on purpose. They assert that
 * a figure appearing on more than one screen has exactly one definition, and
 * that the definition lives in `selectors.ts`.
 */
import { describe, it, expect } from 'vitest'
import { runPlanning, DEFAULT_SETTINGS } from './index'
import { runScenario } from './scenario'
import { buildDataset, recipeCostPerT } from '@/data/generate'
import { CONVERSION_COST_PER_T } from '@/data/catalog'
import { fmtQty, fmtCover, COVER_CAP_DAYS } from '@/lib/format'
import * as S from './selectors'

const ds = buildDataset()
const run = () => runPlanning({
  ds, settings: DEFAULT_SETTINGS, weeksAdvanced: 0, overrides: [], anomalyResolutions: {},
})
const r = run()

describe('one number, one definition', () => {
  it('service level is the replay fill rate everywhere it appears', () => {
    // Health's tile, Proof's table and Simulate's context chip all read this.
    expect(S.selectServiceLevelPct(r)).toBe(r.replay.after.serviceLevelPct)
    expect(r.kpis.serviceLevelPct).toBe(S.selectServiceLevelPct(r))
    console.log(`\n  service level: ${S.selectServiceLevelPct(r)}%`)
  })

  it('the scenario engine no longer invents its own service level', () => {
    const base = new Map(r.materials.map(m => {
      const raw = ds.materials.find(x => x.id === m.materialId)!
      return [m.materialId, {
        dailyUsage: m.dailyUsage, usageSd: m.usageSd, onHand: m.onHand, onOrder: m.onOrder,
        leadTimeDays: raw.leadTimeDays, leadTimeSdDays: raw.leadTimeSdDays,
        costPerUnit: raw.costPerUnit, staticMinLevel: raw.staticMinLevel,
        grades: raw.usedByGrades as string[], primarySupplierId: raw.primarySupplierId,
      }]
    }))
    const out = runScenario({
      ds,
      levers: {
        demandChangePct: 0, demandGrade: 'All', demandRegion: 'All',
        supplierDelayDays: 0, supplierId: 'All',
        serviceLevelPct: DEFAULT_SETTINGS.serviceLevelPct,
        leadTimeBufferDays: DEFAULT_SETTINGS.leadTimeBufferDays,
        excessCoverDays: DEFAULT_SETTINGS.excessCoverDays,
      },
      base,
    })
    expect('serviceLevelPct' in out.outcome).toBe(false)

    // And a supplier delay must visibly move something. It used to leave every
    // headline figure untouched, which made the lever look broken.
    const delayed = runScenario({
      ds,
      levers: {
        demandChangePct: 0, demandGrade: 'All', demandRegion: 'All',
        supplierDelayDays: 14, supplierId: 'All',
        serviceLevelPct: DEFAULT_SETTINGS.serviceLevelPct,
        leadTimeBufferDays: DEFAULT_SETTINGS.leadTimeBufferDays,
        excessCoverDays: DEFAULT_SETTINGS.excessCoverDays,
      },
      base,
    })
    expect(delayed.outcome.requiredStockINR).toBeGreaterThan(out.outcome.requiredStockINR)
    expect(delayed.outcome.coverNeededDays).toBeGreaterThan(out.outcome.coverNeededDays)
    console.log(`  +14d delay: cover required ${out.outcome.coverNeededDays}d -> ${delayed.outcome.coverNeededDays}d`)
  })

  it('net cash is positive when the plan releases more than it spends', () => {
    const net = S.selectNetCashINR(r)
    expect(net).toBe(S.selectCashFreedINR(r) - S.selectPurchaseSpendINR(r))
    // Buy showed `spend - freed`, so a cash inflow printed with a minus sign.
    if (S.selectCashFreedINR(r) > S.selectPurchaseSpendINR(r)) expect(net).toBeGreaterThan(0)
    console.log(`  spend ${(S.selectPurchaseSpendINR(r) / 1e7).toFixed(2)} Cr · ` +
      `release ${(S.selectCashFreedINR(r) / 1e7).toFixed(2)} Cr · net ${(net / 1e7).toFixed(2)} Cr`)
  })

  it('open orders include orders approved in this session', () => {
    const approval: S.ApprovalRow = {
      recommendationId: r.recommendations[0].id, poId: 'PO-TEST', materialId: r.recommendations[0].materialId,
      qty: 1, supplierId: r.recommendations[0].supplierId, valueINR: 1, approvedBy: 'You', note: '',
    }
    const before = S.selectOpenOrders(ds, r, []).length
    const after = S.selectOpenOrders(ds, r, [approval]).length
    // Health counted only the generated book, so approving made the two screens
    // disagree by exactly the number of approvals.
    expect(after).toBe(before + 1)
  })

  it('overdue means one thing in the list, the chart and the chip', () => {
    const items = S.selectExceptions(r, [])
    const buckets = S.selectDueBuckets(items)
    const overdueBucket = buckets.find(b => b.name === 'Overdue')!.n
    const overdueRows = items.filter(w => S.isOverdue(w.dueInDays)).length
    expect(overdueBucket).toBe(overdueRows)

    // Every item lands in exactly one bucket — nothing may fall through the gap
    // between "< 0" and "> 0" the way items due today used to.
    const total = buckets.reduce((s, b) => s + b.n, 0)
    expect(total).toBe(items.length)
    console.log(`  queue ${items.length}: ` + buckets.map(b => `${b.name} ${b.n}`).join(' · '))
  })

  it('the exceptions badge equals the exceptions page', () => {
    expect(S.selectExceptions(r, []).length).toBe(r.workbench.length)
    const dismissed = [r.workbench[0].id]
    expect(S.selectExceptions(r, dismissed).length).toBe(r.workbench.length - 1)
  })

  it('queue chip counts add up to the headline count', () => {
    const items = S.selectExceptions(r, [])
    const counts = S.selectQueueCounts(items)
    // The chips used to enumerate a fixed list of six queue kinds while the
    // workbench could emit seven, so they could never sum to the total.
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(items.length)
  })

  it('the anomaly badge counts market shifts, and loses no series', () => {
    const groups = S.selectAnomalyGroups(r, 'Open')
    expect(r.kpis.openAnomalies).toBe(groups.length)
    // Grouping is presentation, not suppression: every open series is still in
    // exactly one group.
    const inGroups = groups.reduce((s, g) => s + g.products, 0)
    expect(inGroups).toBe(r.kpis.openAnomalySeries)
    expect(groups.length).toBeLessThan(r.kpis.openAnomalySeries)
    console.log(`  anomalies: ${groups.length} shifts covering ${inGroups} series`)
  })

  it('late has one definition, and each count says what it counts', () => {
    const lateMaterials = S.selectLateCount(r)
    const lateRows = S.selectLatePlannedOrderCount(r)
    const overdueRecs = r.recommendations.filter(x => S.isOverdue(x.orderByDays)).length
    // Materials late and recommendations past their order-by date are the same
    // set, because one recommendation is raised per material.
    expect(lateMaterials).toBe(overdueRecs)
    // Planned-order rows are a different unit and may legitimately differ —
    // the screen labels them as order lines rather than as materials.
    expect(lateRows).toBeGreaterThanOrEqual(0)
    console.log(`  late: ${lateMaterials} materials · ${lateRows} planned order lines`)
  })
})

describe('numbers a planner can act on', () => {
  it('no material reports absurd days of cover', () => {
    // Ferroniobium was in the material catalogue but in no recipe at all, so
    // its usage computed as zero and its cover as 91,400 days.
    const worst = [...r.materials].sort((a, b) => b.inv.daysOfCover - a.inv.daysOfCover)[0]
    console.log(`  deepest cover: ${worst.code} ${worst.inv.daysOfCover.toFixed(0)} d`)
    expect(worst.inv.daysOfCover).toBeLessThan(5000)
    // Anything past a year reads as a cap rather than a specific number.
    expect(fmtCover(91_400)).toBe(`${COVER_CAP_DAYS}+ d`)
  })

  it('every material is actually used by something', () => {
    for (const m of ds.materials) {
      const used = Object.values(ds.bom).some(lines => lines.some(l => l.materialId === m.id))
      expect(used, `${m.code} ${m.name} appears in no recipe`).toBe(true)
    }
  })

  it('countable units never render a fraction', () => {
    expect(fmtQty(855.7, 'nos')).toBe('856 nos')
    expect(fmtQty(2400, 'nos')).toBe('2,400 nos')
    expect(fmtQty(8000.4, 'L')).toBe('8,000 L')
    expect(fmtQty(14968.53, 't')).toBe('14,968.5 t')
  })
})

describe('a product costs what its recipe costs', () => {
  it('no product is priced below the metal in it', () => {
    // Price and cost were generated from grade/form tables with no reference to
    // the bill of materials, so 170 of the 240 products sold for less than the
    // metal they contain. Nothing showed both numbers together, so it stayed
    // hidden until the Plan screen started totalling a recipe.
    let worst = { code: '', margin: Infinity }
    for (const s of ds.skus) {
      const metal = recipeCostPerT(ds.bom[s.id])
      const margin = (1 - metal / s.pricePerT) * 100
      if (margin < worst.margin) worst = { code: s.code, margin }
      expect(metal, `${s.code} costs more in metal than it sells for`).toBeLessThan(s.pricePerT)
    }
    console.log(`\n  thinnest margin over metal: ${worst.code} ${worst.margin.toFixed(1)}%`)
  })

  it('stated cost is the recipe plus conversion, not a separate number', () => {
    for (const s of ds.skus) {
      const expected = Math.round(recipeCostPerT(ds.bom[s.id]) + CONVERSION_COST_PER_T[s.form])
      expect(s.costPerT, `${s.code}`).toBe(expected)
    }
  })

  it('every product still turns a margin', () => {
    for (const s of ds.skus) expect(s.costPerT, `${s.code}`).toBeLessThan(s.pricePerT)
    // And the grades stay in the right order: 316L carries molybdenum and the
    // most nickel, 430 carries neither.
    const avg = (g: string) => {
      const list = ds.skus.filter(s => s.grade === g)
      return list.reduce((t, s) => t + s.pricePerT, 0) / list.length
    }
    expect(avg('316L')).toBeGreaterThan(avg('304'))
    expect(avg('304')).toBeGreaterThan(avg('201'))
    expect(avg('201')).toBeGreaterThan(avg('430'))
  })
})

describe('the plan is reproducible', () => {
  it('two runs of the same inputs give the same numbers', () => {
    // The demo is anchored to the real current week, so date labels move. The
    // numbers behind them must not.
    const a = run(), b = run()
    expect(JSON.stringify(b.kpis)).toBe(JSON.stringify(a.kpis))
    expect(b.replay.after.totalStockouts).toBe(a.replay.after.totalStockouts)
    expect(b.replay.before.totalStockouts).toBe(a.replay.before.totalStockouts)
    expect(b.replay.after.avgInventoryValueINR).toBe(a.replay.after.avgInventoryValueINR)
  })
})
