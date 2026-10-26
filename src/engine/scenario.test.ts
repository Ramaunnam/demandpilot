/**
 * What-if scenarios have to actually do something.
 *
 * A lever that leaves every headline number identical is worse than no lever:
 * it reads as a broken control. These tests put each ready-made case through
 * the same code the screen uses and insist it moves at least one of the six
 * result cards — and that the ones it *should* move are the ones that do.
 */
import { describe, it, expect } from 'vitest'
import { runPlanning, DEFAULT_SETTINGS } from './index'
import { runScenario, runScenarioReplay, type ScenarioLevers } from './scenario'
import { buildDataset } from '@/data/generate'
import { selectPurchaseSpendINR, selectServiceLevelPct } from './selectors'

const ds = buildDataset()
const r = runPlanning({ ds, settings: DEFAULT_SETTINGS, weeksAdvanced: 0, overrides: [], anomalyResolutions: {} })

const base = new Map(r.materials.map(m => {
  const raw = ds.materials.find(x => x.id === m.materialId)!
  return [m.materialId, {
    dailyUsage: m.dailyUsage, usageSd: m.usageSd, onHand: m.onHand, onOrder: m.onOrder,
    leadTimeDays: raw.leadTimeDays, leadTimeSdDays: raw.leadTimeSdDays,
    costPerUnit: raw.costPerUnit, staticMinLevel: raw.staticMinLevel,
    grades: raw.usedByGrades as string[], primarySupplierId: raw.primarySupplierId,
  }]
}))

const defaults: ScenarioLevers = {
  demandChangePct: 0, demandGrade: 'All', demandRegion: 'All',
  supplierDelayDays: 0, supplierId: 'All',
  serviceLevelPct: DEFAULT_SETTINGS.serviceLevelPct,
  leadTimeBufferDays: DEFAULT_SETTINGS.leadTimeBufferDays,
  excessCoverDays: DEFAULT_SETTINGS.excessCoverDays,
}

/** The six cards the screen shows, computed exactly as Simulate computes them. */
function cards(lv: ScenarioLevers) {
  const out = runScenario({ ds, levers: lv, base }).outcome
  const nowOut = runScenario({ ds, levers: defaults, base }).outcome
  const sim = runScenarioReplay(ds, r.replayInput, lv)
  const spendNow = selectPurchaseSpendINR(r)
  return {
    materialsAtRisk: out.materialsAtRisk,
    stockoutRisk: out.stockoutRiskCount,
    stockValue: sim.avgStockValueINR,
    purchaseSpend: nowOut.shortfallValueINR > 0
      ? Math.round(spendNow * (out.shortfallValueINR / nowOut.shortfallValueINR))
      : spendNow,
    serviceLevel: sim.serviceLevelPct,
    daysOfInventory: sim.daysOfInventory,
  }
}

/** The six ready-made cases on the screen, in order. */
const PRESETS: { n: string; lv: Partial<ScenarioLevers> }[] = [
  { n: 'South 316L +20%', lv: { demandChangePct: 20, demandGrade: '316L' } },
  { n: 'Supplier B slips 2 wk', lv: { supplierDelayDays: 14, supplierId: 'S-02' } },
  { n: 'Service 99%', lv: { serviceLevelPct: 99 } },
  { n: '430 falls 15%', lv: { demandChangePct: -15, demandGrade: '430' } },
  { n: 'Lean to 40 days', lv: { excessCoverDays: 40 } },
  { n: 'All suppliers +1 wk', lv: { supplierDelayDays: 7 } },
]

describe('every ready-made case changes something', () => {
  const baseline = cards(defaults)

  it('the baseline reproduces the live plan exactly', () => {
    // With nothing moved, the scenario must land on the same numbers the rest
    // of the app shows — otherwise "Now" and the Proof page disagree.
    expect(baseline.serviceLevel).toBe(selectServiceLevelPct(r))
    expect(baseline.stockValue).toBe(r.replay.after.avgInventoryValueINR)
    expect(baseline.daysOfInventory).toBe(r.replay.after.daysOfInventory)
    expect(baseline.purchaseSpend).toBe(selectPurchaseSpendINR(r))
  })

  for (const p of PRESETS) {
    it(`"${p.n}" moves at least one result card`, () => {
      const c = cards({ ...defaults, ...p.lv })
      const moved = (Object.keys(baseline) as (keyof typeof baseline)[])
        .filter(k => c[k] !== baseline[k])
      console.log(`\n  ${p.n}: ${moved.length ? moved.join(', ') : 'NOTHING MOVED'}`)
      for (const k of moved) console.log(`    ${k}: ${baseline[k]} -> ${c[k]}`)
      expect(moved.length, `${p.n} left every card identical`).toBeGreaterThan(0)
    })
  }
})

describe('levers move the measures they are supposed to', () => {
  const baseline = cards(defaults)

  it('a supplier delay moves stock value, days of inventory and stockout risk', () => {
    // This is the one the brief called out: the delay lever used to leave every
    // headline untouched, because recomputing a reorder point cannot tell you
    // what stock will do over sixteen weeks of ordering.
    const c = cards({ ...defaults, supplierDelayDays: 14, supplierId: 'All' })
    expect(c.stockValue).not.toBe(baseline.stockValue)
    expect(c.daysOfInventory).not.toBe(baseline.daysOfInventory)
    expect(c.stockoutRisk).not.toBe(baseline.stockoutRisk)
  })

  it('a demand change moves purchase spend and materials at risk', () => {
    const up = cards({ ...defaults, demandChangePct: 30, demandGrade: 'All' })
    expect(up.purchaseSpend).not.toBe(baseline.purchaseSpend)
    expect(up.materialsAtRisk).not.toBe(baseline.materialsAtRisk)
    // More demand should need more buying, not less.
    expect(up.purchaseSpend).toBeGreaterThan(baseline.purchaseSpend)
  })

  it('a longer delay hurts more than a shorter one', () => {
    const small = cards({ ...defaults, supplierDelayDays: 7, supplierId: 'All' })
    const big = cards({ ...defaults, supplierDelayDays: 42, supplierId: 'All' })
    expect(big.serviceLevel).toBeLessThanOrEqual(small.serviceLevel)
  })

  it('a demand drop on one grade does not move an unrelated grade', () => {
    // 430 contains no molybdenum, so cutting it must not change the moly
    // position. A scenario that moves everything is as useless as one that
    // moves nothing.
    const cut430 = runScenario({ ds, levers: { ...defaults, demandChangePct: -40, demandGrade: '430' }, base })
    const flat = runScenario({ ds, levers: defaults, base })
    const moly = 'RM-105'
    expect(cut430.inventory.get(moly)!.reorderPoint).toBe(flat.inventory.get(moly)!.reorderPoint)
  })
})
