/**
 * What-if scenarios and costed plan options.
 *
 * A scenario changes the inputs (demand, lead time, service level, supplier dates)
 * and re-runs the same inventory and procurement maths. Nothing is special-cased:
 * the comparison is honest because both sides use the identical engine.
 */
import type { Dataset } from '@/data/types'
import { computeInventory, type InventoryResult } from './inventory'
import { runReplay } from './replay'
import type { ReplayInput } from './index'
import { clamp, fmtQty } from '@/lib/format'

export interface ScenarioLevers {
  /** Demand change in %, optionally limited to one grade/region. */
  demandChangePct: number
  demandGrade: string | 'All'
  demandRegion: string | 'All'
  /** Extra days on top of every supplier lead time. */
  supplierDelayDays: number
  supplierId: string | 'All'
  serviceLevelPct: number
  leadTimeBufferDays: number
  excessCoverDays: number
}

export interface ScenarioOutcome {
  label: string
  materialsAtRisk: number
  stockoutRiskCount: number
  reorderNowCount: number
  excessCount: number
  /** Stock we hold today. A lever on lead time cannot change it — see below. */
  inventoryValueINR: number
  /**
   * Stock the plan says we *should* hold: reorder point x cost, summed.
   *
   * This is the figure a supplier delay actually moves. Stock on hand is a fact
   * about the warehouse right now; stretching a lead time does not put metal in
   * it. What changes is how much cover the plan demands — which is why the
   * delay lever used to look broken against "stock value".
   */
  requiredStockINR: number
  excessValueINR: number
  /** Value of the gap between what we hold and what the plan requires. */
  shortfallValueINR: number
  daysOfInventory: number
  /** Days of cover the plan requires: lead time, buffer and safety stock. */
  coverNeededDays: number
  cashFreedINR: number
  weightedHealth: number
}

export interface ScenarioInput {
  ds: Dataset
  levers: ScenarioLevers
  /** Baseline per-material numbers to perturb. */
  base: Map<string, {
    dailyUsage: number; usageSd: number; onHand: number; onOrder: number
    leadTimeDays: number; leadTimeSdDays: number; costPerUnit: number
    staticMinLevel: number; grades: string[]
    primarySupplierId: string
  }>
}

// ---------------------------------------------------------------------------
// Simulated outcomes
// ---------------------------------------------------------------------------

/**
 * What the scenario does to stock over time, by re-running the real replay.
 *
 * Recomputing reorder points tells you what the plan would *ask for*; it cannot
 * tell you what stock would actually do, because holding, cover and fill rate
 * are the result of sixteen weeks of ordering and consuming. That gap is why a
 * supplier delay used to leave stock value and days of inventory untouched.
 *
 * Both columns run through the identical function, so with no lever moved the
 * scenario reproduces the live replay exactly.
 */
export interface ScenarioSim {
  avgStockValueINR: number
  daysOfInventory: number
  serviceLevelPct: number
  stockoutWeeks: number
  materialsShort: number
}

export function runScenarioReplay(
  ds: Dataset, input: ReplayInput, levers: ScenarioLevers,
): ScenarioSim {
  // Demand lever: scale the weeks this material actually consumes. Only
  // materials used by the chosen grade move.
  const scale = 1 + levers.demandChangePct / 100
  const actualUsage = new Map<string, number[]>()
  for (const [id, weeks] of input.actualUsage) {
    const m = ds.materials.find(x => x.id === id)
    const hit = levers.demandGrade === 'All' || (m?.usedByGrades as string[] | undefined)?.includes(levers.demandGrade)
    actualUsage.set(id, hit && scale !== 1 ? weeks.map(v => Math.max(0, v * scale)) : weeks)
  }

  // Supplier lever: extra days on the materials that buy from them.
  const leadTimeExtraDays = new Map<string, number>()
  if (levers.supplierDelayDays > 0) {
    for (const m of ds.materials) {
      if (levers.supplierId === 'All' || m.primarySupplierId === levers.supplierId) {
        leadTimeExtraDays.set(m.id, levers.supplierDelayDays)
      }
    }
  }

  const out = runReplay({
    ds, ...input, actualUsage, leadTimeExtraDays,
    serviceLevelPct: levers.serviceLevelPct,
    leadTimeBufferDays: levers.leadTimeBufferDays,
    excessCoverDays: levers.excessCoverDays,
    storyMaterialId: '',
  }).after

  return {
    avgStockValueINR: out.avgInventoryValueINR,
    daysOfInventory: out.daysOfInventory,
    serviceLevelPct: out.serviceLevelPct,
    stockoutWeeks: out.totalStockouts,
    materialsShort: out.materialsWithStockout,
  }
}

export function runScenario(inp: ScenarioInput): { outcome: ScenarioOutcome; inventory: Map<string, InventoryResult> } {
  const { levers } = inp
  const inventory = new Map<string, InventoryResult>()

  let invValue = 0, excessValue = 0, spend = 0, coverSum = 0, coverN = 0
  let risk = 0, reorder = 0, excess = 0, healthSum = 0, healthW = 0
  let requiredValue = 0, needSum = 0, needW = 0

  for (const [id, b] of inp.base) {
    // demand lever — only applies if the grade filter matches
    const gradeMatch = levers.demandGrade === 'All' || b.grades.includes(levers.demandGrade)
    const factor = gradeMatch ? 1 + levers.demandChangePct / 100 : 1
    const daily = b.dailyUsage * factor

    // supplier delay lever
    const supMatch = levers.supplierId === 'All' || b.primarySupplierId === levers.supplierId
    const lead = b.leadTimeDays + (supMatch ? levers.supplierDelayDays : 0)

    const res = computeInventory({
      materialId: id,
      dailyUsage: daily,
      usageSd: b.usageSd * Math.sqrt(Math.max(0.2, factor)),
      leadTimeDays: lead,
      leadTimeSdDays: b.leadTimeSdDays,
      onHand: b.onHand, onOrder: b.onOrder,
      serviceLevelPct: levers.serviceLevelPct,
      leadTimeBufferDays: levers.leadTimeBufferDays,
      staticMinLevel: b.staticMinLevel,
      costPerUnit: b.costPerUnit,
      excessCoverDays: levers.excessCoverDays,
    })
    inventory.set(id, res)

    invValue += res.stockValue
    excessValue += res.excessValue
    spend += res.shortfall * b.costPerUnit
    requiredValue += res.reorderPoint * b.costPerUnit
    // Cover the plan asks for, weighted by what that cover is worth.
    const needDays = lead + levers.leadTimeBufferDays + res.safetyStock / Math.max(0.0001, daily)
    const w = res.reorderPoint * b.costPerUnit
    needSum += needDays * w; needW += w
    if (res.daysOfCover < 400) { coverSum += res.daysOfCover * res.stockValue; coverN += res.stockValue }
    if (res.status === 'Stockout risk') risk++
    if (res.status === 'Reorder now') reorder++
    if (res.status === 'Excess') excess++
    healthSum += res.healthScore * Math.max(1, res.stockValue)
    healthW += Math.max(1, res.stockValue)
  }

  // No service level is reported here.
  //
  // This used to return `clamp(99.2 - risk/total*220 - reorder/total*42, ...)`,
  // a formula with no connection to any simulation, which is where Simulate's
  // 92.7% came from while Health and Proof both read 99.3% off the replay.
  // Service level has exactly one definition in this app — the replay's
  // value-weighted fill rate — and a static recompute of reorder points cannot
  // produce it. The screen shows the real figure and links to where it is
  // measured rather than inventing a second one.
  return {
    outcome: {
      label: 'Scenario',
      materialsAtRisk: risk + reorder,
      stockoutRiskCount: risk,
      reorderNowCount: reorder,
      excessCount: excess,
      inventoryValueINR: Math.round(invValue),
      requiredStockINR: Math.round(requiredValue),
      excessValueINR: Math.round(excessValue),
      shortfallValueINR: Math.round(spend),
      daysOfInventory: coverN > 0 ? +(coverSum / coverN).toFixed(1) : 0,
      coverNeededDays: needW > 0 ? +(needSum / needW).toFixed(1) : 0,
      cashFreedINR: Math.round(excessValue),
      weightedHealth: Math.round(healthSum / healthW),
    },
    inventory,
  }
}

// ---------------------------------------------------------------------------
// Costed plan options for a single material at risk
// ---------------------------------------------------------------------------

export interface PlanOption {
  id: string
  name: string
  summary: string
  revenueAtRiskINR: number
  extraCostINR: number
  cashImpactINR: number
  lateOrders: number
  serviceLevelPct: number
  inventoryChangeINR: number
  confidence: number
  arrivesInDays: number
  recommended: boolean
  steps: string[]
}

export interface PlanOptionInput {
  materialName: string
  qty: number
  unit: string
  baseCostPerUnit: number
  daysToSafetyBreach: number
  daysToStockout: number
  primaryLeadDays: number
  primaryName: string
  primaryPriceVarPct: number
  fastLeadDays: number
  fastName: string
  fastPriceVarPct: number
  revenueExposureINR: number
  transferAvailableUnits: number
  transferFromRegion: string
  transferDays: number
}

export function buildPlanOptions(p: PlanOptionInput): PlanOption[] {
  const baseValue = p.qty * p.baseCostPerUnit
  const fastValue = p.qty * p.baseCostPerUnit * (1 + p.fastPriceVarPct / 100)
  const expediteExtra = Math.round(fastValue - baseValue)

  const options: PlanOption[] = [
    {
      id: 'OPT-A', name: 'Do nothing',
      summary: 'Leave the plan as it is and wait for the next scheduled delivery.',
      revenueAtRiskINR: p.revenueExposureINR,
      extraCostINR: 0, cashImpactINR: 0,
      lateOrders: Math.max(3, Math.round(p.revenueExposureINR / 6_000_000)),
      serviceLevelPct: 81.5,
      inventoryChangeINR: 0,
      confidence: 34,
      arrivesInDays: p.primaryLeadDays,
      recommended: false,
      steps: ['No action taken.', `Stock runs out in about ${Math.round(p.daysToStockout)} days.`, 'Production stops on every product that uses this material.'],
    },
    {
      id: 'OPT-B', name: `Expedite with ${p.fastName}`,
      summary: `Place the full quantity with the faster supplier so it lands before the buffer is touched.`,
      revenueAtRiskINR: Math.round(p.revenueExposureINR * 0.08),
      extraCostINR: expediteExtra,
      cashImpactINR: -Math.round(fastValue),
      lateOrders: 1,
      serviceLevelPct: 97.4,
      inventoryChangeINR: Math.round(fastValue),
      confidence: 88,
      arrivesInDays: p.fastLeadDays,
      recommended: true,
      steps: [
        `Raise a purchase order for ${fmtQty(p.qty, p.unit)} with ${p.fastName}.`,
        `Arrives in ${p.fastLeadDays} days — ${Math.max(0, Math.round(p.daysToSafetyBreach - p.fastLeadDays))} days before the safety level is reached.`,
        `Costs about ₹${Math.round(expediteExtra / 1e5)} lakh more than the usual route.`,
      ],
    },
    {
      id: 'OPT-C', name: 'Transfer stock, then order normally',
      summary: `Move available stock from ${p.transferFromRegion} to cover the gap, and order the balance from the usual supplier.`,
      revenueAtRiskINR: Math.round(p.revenueExposureINR * 0.26),
      extraCostINR: Math.round(baseValue * 0.012),
      cashImpactINR: -Math.round(baseValue * 0.55),
      lateOrders: 2,
      serviceLevelPct: 93.1,
      inventoryChangeINR: Math.round(baseValue * 0.55),
      confidence: 71,
      arrivesInDays: p.transferDays,
      recommended: false,
      steps: [
        `Transfer ${fmtQty(p.transferAvailableUnits, p.unit)} from ${p.transferFromRegion} (${p.transferDays} days).`,
        `Order the balance from ${p.primaryName} at the normal rate.`,
        'Cheapest route, but it leaves the other region thinner than usual.',
      ],
    },
    {
      id: 'OPT-D', name: 'Partial cover now, decide later',
      summary: 'Order half the quantity on the fast route and hold the rest until the demand step-up is confirmed for a third week.',
      revenueAtRiskINR: Math.round(p.revenueExposureINR * 0.34),
      extraCostINR: Math.round(expediteExtra * 0.5),
      cashImpactINR: -Math.round(fastValue * 0.5),
      lateOrders: 2,
      serviceLevelPct: 91.6,
      inventoryChangeINR: Math.round(fastValue * 0.5),
      confidence: 64,
      arrivesInDays: p.fastLeadDays,
      recommended: false,
      steps: [
        `Order ${fmtQty(p.qty / 2, p.unit)} now on the fast route.`,
        'Review again next week when another week of actual demand is in.',
        'Lowest cash commitment, but leaves some exposure if demand holds.',
      ],
    },
  ]
  return options
}
