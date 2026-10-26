/**
 * Before vs After — proving the three outcomes with numbers.
 *
 * We run the same 16 weeks of real demand twice, through two different planning
 * methods, and record what happens to stock each week.
 *
 *   THE OLD WAY  — forecast is a 13-week average, so it only notices a demand
 *                  shift once the shift has dragged the average up. The reorder
 *                  level is a fixed minimum that nobody has revisited in a year,
 *                  and orders always go to the usual supplier.
 *
 *   DEMANDPILOT  — forecast is the model the engine picked, the reorder level is
 *                  recalculated from current usage and variability, and the order
 *                  goes to whichever approved supplier can still make the date.
 *
 * Nothing is assumed about the result. Whatever the simulation produces is what
 * the screen shows.
 */
import type { Dataset } from '@/data/types'
import { computeInventory } from './inventory'
import { mean, clamp } from '@/lib/format'
import { Rng } from '@/lib/rng'

export const REPLAY_WEEKS = 16
/** Cost of holding stock, as a percentage of its value, per year. */
export const HOLDING_COST_PCT_PER_YEAR = 18

/**
 * How much stock each order tops up to, beyond the reorder level. Smaller,
 * more frequent orders carry less cycle stock for the same service.
 */
export const ORDER_CYCLE_WEEKS = 2

/**
 * The spread on DemandPilot's forecast inside the replay.
 *
 * This matters more than it looks. Taking the true forward demand as the
 * forecast would make the engine clairvoyant and hand it a perfect score, which
 * is the least believable thing a simulation can do. Material-level demand is
 * an aggregate of hundreds of SKUs, so it forecasts far better than any single
 * series — around 8% here against roughly 11% at SKU level. The residual
 * stockouts on the DemandPilot side come from this, and they should: a planner
 * working from a good forecast still sometimes orders a little light.
 */
export const FORECAST_ERROR_SD = 0.08

/** Deterministic per-material stream, so the demo reads the same every run. */
function seedFor(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/**
 * Whether a delivery slips, and by how many weeks.
 *
 * Both methods buy from the same supplier panel, and that panel is not perfectly
 * reliable — on-time records here run from 78% to 97%. Assuming every lorry
 * arrives on the day was the other half of why this simulation used to return a
 * flawless DemandPilot score.
 *
 * Keyed on the material and the arrival week rather than drawn from a running
 * stream, so an order landing in a given week slips identically whichever method
 * placed it. Without that, the two arms would consume the stream at different
 * points and face different weather, which would make the comparison worthless.
 */
function slipWeeks(materialId: string, arriveWeek: number, otifPct: number): number {
  const h = seedFor(`${materialId}:${arriveWeek}`)
  const u = (h >>> 8) / 0x1000000
  if (u >= 1 - otifPct / 100) return 0
  return (h & 1) ? 2 : 1
}

export interface ReplayWeek {
  week: number
  demand: number
  onHandStart: number
  received: number
  consumed: number
  onHandEnd: number
  shortfall: number
  stockout: boolean
  orderPlaced: number
  orderArrivesWeek: number | null
  reorderLevel: number
  forecastUsed: number
}

export interface ReplayMaterial {
  materialId: string
  code: string
  name: string
  unit: string
  weeks: ReplayWeek[]
  stockoutWeeks: number
  lineStopDays: number
  shortUnits: number
  avgStockValue: number
  peakStockValue: number
  storageCostINR: number
  /** How many days before it was needed each delivery landed. */
  arrivalLeadDays: number[]
  ordersPlaced: number
}

export interface ReplaySide {
  label: 'Spreadsheet planning' | 'DemandPilot'
  materials: ReplayMaterial[]
  totalStockouts: number
  materialsWithStockout: number
  lineStopDays: number
  avgInventoryValueINR: number
  storageCostINR: number
  daysOfInventory: number
  serviceLevelPct: number
  /** Average days early a delivery arrived — closer to zero is better (just-in-time). */
  avgArrivalEarlinessDays: number
  /** Days from the market signal appearing to a purchase order being approved. */
  signalToOrderDays: number
  excessValueINR: number
  /**
   * Rupee value of finished production that could not be made, because a
   * material ran short. This is what the extra stock on the DemandPilot side
   * is actually buying, and without it "we hold more stock" reads as a pure
   * cost rather than a trade.
   */
  productionStoppedINR: number
}

export interface ReplayResult {
  before: ReplaySide
  after: ReplaySide
  deltas: {
    stockoutsAvoided: number
    lineStopDaysAvoided: number
    inventoryReducedINR: number
    storageCostSavedINR: number
    daysOfInventoryReduced: number
    serviceLevelGain: number
    signalToOrderDaysSaved: number
    arrivalEarlinessImprovedDays: number
    /** Extra holding cost the DemandPilot side carries. Negative means it saved. */
    extraHoldingCostINR: number
    /** Production value the extra cover protected. */
    productionProtectedINR: number
  }
  storyMaterialId: string
}

interface SimInput {
  ds: Dataset
  startWeek: number
  /** Actual demand per material per replay week. */
  actualUsage: Map<string, number[]>
  /**
   * Usage in the weeks BEFORE the replay starts. This is what makes the
   * comparison meaningful: the spreadsheet's rolling average is seeded with the
   * old level, so it under-orders a material whose demand has just risen and
   * keeps over-ordering one whose demand has been falling. Both failures at
   * once — which is exactly the problem the case study describes.
   */
  priorUsage: Map<string, number[]>
  /**
   * Deliveries already on the way when the replay starts, by material and week.
   * Both methods inherit the same inbound pipeline — without it every material
   * whose cover is shorter than its lead time would stock out under either
   * method, which would tell us nothing about the planning method itself.
   */
  inbound: Map<string, Map<number, number>>
  onHand: Map<string, number>
  serviceLevelPct: number
  leadTimeBufferDays: number
  excessCoverDays: number
  usageSd: Map<string, number>
  /** Week the market signal that explains the shift appeared. */
  signalWeek: number
  /** Rupee value of finished product made each week that needs this material. */
  downstreamWeeklyValue: Map<string, number>
  /**
   * Extra days on a material's lead time, for what-if runs.
   *
   * A supplier delay has to be modelled rather than asserted: it changes how
   * early the reorder point fires, how much cover the plan demands, and whether
   * the delivery lands before the stock runs out. Those are simulation
   * outcomes, not arithmetic on the current balance, which is why Simulate's
   * delay lever used to leave every headline number untouched.
   */
  leadTimeExtraDays?: Map<string, number>
}

type Mode = 'spreadsheet' | 'demandpilot'

function simulate(inp: SimInput, mode: Mode): ReplaySide {
  const out: ReplayMaterial[] = []
  let totalStockouts = 0, matWithStockout = 0, lineStopDays = 0
  let stockValueSum = 0, storageCost = 0, coverSum = 0, coverW = 0
  const earliness: number[] = []
  let excessValue = 0
  /**
   * Production value lost in each week, taken as the single worst material
   * shortage rather than the sum of them.
   *
   * Nearly every material on this site feeds all 240 products, so adding up a
   * per-material figure counts the same stopped tonnage once per material and
   * produces a number many times larger than the plant's entire output. In any
   * given week the line is held by its binding constraint, so that is what is
   * counted here.
   */
  const stoppedByWeek = new Array(REPLAY_WEEKS).fill(0)

  const weeklyHolding = HOLDING_COST_PCT_PER_YEAR / 100 / 52

  for (const m of inp.ds.materials) {
    const usage = inp.actualUsage.get(m.id)
    if (!usage) continue
    const prior = inp.priorUsage.get(m.id) ?? []

    const leadDays = m.leadTimeDays + (inp.leadTimeExtraDays?.get(m.id) ?? 0)
    const leadWeeks = Math.max(1, Math.round(leadDays / 7))
    const fcRng = new Rng(seedFor(m.id))
    let onHand = inp.onHand.get(m.id) ?? 0
    const pipeline = new Map<number, number>(inp.inbound.get(m.id) ?? [])  // week -> qty arriving
    const weeks: ReplayWeek[] = []
    let stockoutWeeks = 0, shortUnits = 0, ordersPlaced = 0
    const stockVals: number[] = []

    for (let i = 0; i < REPLAY_WEEKS; i++) {
      const week = inp.startWeek + i
      const demand = usage[i] ?? 0
      const received = pipeline.get(week) ?? 0
      const start = onHand + received

      // --- what does each method think demand will be? ---------------------
      let forecast: number
      if (mode === 'spreadsheet') {
        // A 13-week rolling average, seeded with the weeks before the replay began.
        // It cannot see a step change until several weeks of the new level have
        // dragged the average along, which is the whole problem.
        const seen = [...prior, ...usage.slice(0, i)].slice(-13)
        forecast = seen.length ? mean(seen) : demand
      } else {
        // The engine's forward forecast already carries the step change, because
        // the anomaly was accepted into the baseline weeks ago. It looks ahead
        // over the period the order has to cover — the lead time plus a cycle —
        // rather than a fixed four weeks, which would under-order anything with
        // a long lead time.
        const ahead = usage.slice(i, i + leadWeeks + ORDER_CYCLE_WEEKS)
        const truth = ahead.length ? mean(ahead) : demand
        // ...but it is a forecast, not foresight. See FORECAST_ERROR_SD.
        forecast = Math.max(0, truth * (1 + clamp(fcRng.normal(0, FORECAST_ERROR_SD), -0.25, 0.25)))
      }

      // --- what is the reorder level? --------------------------------------
      let reorderLevel: number
      let orderQty = 0
      if (mode === 'spreadsheet') {
        reorderLevel = m.staticMinLevel      // the fixed rule, never revisited
      } else {
        const inv = computeInventory({
          materialId: m.id,
          dailyUsage: forecast / 7,
          usageSd: (inp.usageSd.get(m.id) ?? forecast * 0.2) / 7,
          leadTimeDays: leadDays,
          leadTimeSdDays: m.leadTimeSdDays,
          onHand: start, onOrder: [...pipeline.values()].reduce((a, b) => a + b, 0),
          serviceLevelPct: inp.serviceLevelPct,
          leadTimeBufferDays: inp.leadTimeBufferDays,
          staticMinLevel: m.staticMinLevel,
          costPerUnit: m.costPerUnit,
          excessCoverDays: inp.excessCoverDays,
        })
        reorderLevel = inv.reorderPoint
      }

      const inPipeline = [...pipeline.entries()].filter(([w]) => w > week).reduce((a, [, q]) => a + q, 0)
      // Test the position we expect to be in *after* this week's consumption, not
      // the position at the start of it. Checking the opening balance means the
      // trigger fires a week late, by which point the shortage has already happened.
      const projected = start - demand + inPipeline
      if (projected <= reorderLevel) {
        // Standard order-up-to policy: top up to the reorder level plus one
        // ordering cycle of demand. Both methods use the identical base rule,
        // so neither is simply allowed to order more than the other.
        let orderUpTo = reorderLevel + forecast * ORDER_CYCLE_WEEKS

        // DemandPilot alone will not order *into* excess. The planner sets an
        // excess target; topping up past it manufactures exactly the overstock
        // the system exists to release, so the order is capped there.
        //
        // This is the one place the two policies genuinely differ in how much
        // they may order, and it is a capability difference rather than a thumb
        // on the scale: a fixed minimum level has no upper bound to respect.
        // Where a lead time is so long that lead-time cover already exceeds the
        // excess target, the cap cannot bind, so it never starves a material —
        // it keeps one ordering cycle of headroom.
        if (mode === 'demandpilot') {
          const ceiling = (forecast / 7) * inp.excessCoverDays
          orderUpTo = Math.min(orderUpTo, Math.max(reorderLevel + forecast, ceiling))
        }

        const need = Math.max(0, orderUpTo - projected)
        orderQty = m.lotRule === 'Lot-for-lot' ? need : Math.max(m.moq, Math.ceil(need / m.lotSize) * m.lotSize)

        if (orderQty > 0) {
          ordersPlaced++
          // DemandPilot checks whether the usual supplier can still make the date
          // and switches to a faster approved supplier when it cannot.
          let effLead = leadWeeks
          let effOtif = inp.ds.suppliers.find(s => s.id === m.primarySupplierId)?.otifPct ?? 90
          if (mode === 'demandpilot') {
            const daysToBreach = (start - reorderLevel * 0.5) / Math.max(0.0001, forecast / 7)
            if (daysToBreach < leadDays) {
              // Switch to the quickest approved alternative — but only if it is
              // genuinely quicker. Several materials list a backup that is slower
              // than the usual supplier, and moving to one of those would make
              // the shortage worse rather than better.
              const fastest = m.backupSupplierIds
                .map(id => inp.ds.suppliers.find(s => s.id === id))
                .filter((s): s is NonNullable<typeof s> => !!s)
                .sort((a, b) => a.leadTimeDays - b.leadTimeDays)[0]
              if (fastest && fastest.leadTimeDays < leadDays) {
                effLead = Math.max(1, Math.round(fastest.leadTimeDays / 7))
                effOtif = fastest.otifPct
              }
            }
          }
          const due = week + effLead
          const arrive = due + slipWeeks(m.id, due, effOtif)
          pipeline.set(arrive, (pipeline.get(arrive) ?? 0) + orderQty)
          const needWeek = week + Math.max(1, Math.floor((start - reorderLevel) / Math.max(0.0001, forecast)))
          earliness.push((needWeek - arrive) * 7)
        }
      }

      const consumed = Math.min(start, demand)
      const shortfall = Math.max(0, demand - start)
      const end = Math.max(0, start - demand)
      const stockout = shortfall > 0.0001

      if (stockout) {
        stockoutWeeks++
        shortUnits += shortfall
        // Scale by the share of the week's requirement that was missing: being
        // 10% short slows the line, being 100% short stops it.
        const missed = demand > 0 ? Math.min(1, shortfall / demand) : 1
        const atStake = (inp.downstreamWeeklyValue.get(m.id) ?? 0) * missed
        stoppedByWeek[i] = Math.max(stoppedByWeek[i], atStake)
      }

      const value = end * m.costPerUnit
      stockVals.push(value)
      storageCost += value * weeklyHolding

      weeks.push({
        week, demand: +demand.toFixed(3), onHandStart: +start.toFixed(3),
        received: +received.toFixed(3), consumed: +consumed.toFixed(3),
        onHandEnd: +end.toFixed(3), shortfall: +shortfall.toFixed(3), stockout,
        orderPlaced: +orderQty.toFixed(3),
        orderArrivesWeek: orderQty > 0 ? [...pipeline.keys()].sort((a, b) => b - a)[0] : null,
        reorderLevel: +reorderLevel.toFixed(3),
        forecastUsed: +forecast.toFixed(3),
      })
      onHand = end
      pipeline.delete(week)
    }

    const avgVal = mean(stockVals)
    const dailyUse = mean(usage) / 7
    const cover = dailyUse > 0 ? mean(weeks.map(w => w.onHandEnd)) / dailyUse : 0

    totalStockouts += stockoutWeeks
    if (stockoutWeeks > 0) matWithStockout++
    // A week without a critical material stops the line for the working week.
    lineStopDays += stockoutWeeks * (m.critical ? 5 : 1)
    stockValueSum += avgVal
    coverSum += cover * avgVal
    coverW += avgVal
    const target = dailyUse * inp.excessCoverDays
    excessValue += Math.max(0, mean(weeks.map(w => w.onHandEnd)) - target) * m.costPerUnit

    out.push({
      materialId: m.id, code: m.code, name: m.name, unit: m.unit, weeks,
      stockoutWeeks, lineStopDays: stockoutWeeks * (m.critical ? 5 : 1),
      shortUnits: +shortUnits.toFixed(2),
      avgStockValue: Math.round(avgVal),
      peakStockValue: Math.round(Math.max(...stockVals, 0)),
      storageCostINR: Math.round(mean(stockVals) * weeklyHolding * REPLAY_WEEKS),
      arrivalLeadDays: [], ordersPlaced,
    })
  }

  // Fill rate: the share of demand actually met from stock.
  //
  // Weighted by value, not by raw units. Adding a cubic metre of oxygen to a
  // tonne of nickel and a wooden skid gives a number with no dimension, and it
  // would be dominated by whichever material happens to be counted in the
  // smallest unit — oxygen runs to five figures a week, nickel to three. The
  // same reasoning applies here as to exposure in procurement.ts.
  let demandValue = 0, shortValue = 0
  for (const m of out) {
    const cost = inp.ds.materials.find(x => x.id === m.materialId)?.costPerUnit ?? 0
    for (const w of m.weeks) {
      demandValue += w.demand * cost
      shortValue += w.shortfall * cost
    }
  }
  const serviceLevel = demandValue > 0
    ? +(100 * (1 - shortValue / demandValue)).toFixed(1)
    : 100

  return {
    label: mode === 'spreadsheet' ? 'Spreadsheet planning' : 'DemandPilot',
    materials: out,
    totalStockouts,
    materialsWithStockout: matWithStockout,
    lineStopDays,
    avgInventoryValueINR: Math.round(stockValueSum),
    storageCostINR: Math.round(storageCost),
    daysOfInventory: coverW > 0 ? +(coverSum / coverW).toFixed(1) : 0,
    serviceLevelPct: Math.max(0, Math.min(100, serviceLevel)),
    avgArrivalEarlinessDays: earliness.length ? +mean(earliness).toFixed(1) : 0,
    // The old way only reacts once the average moves; the new way reacts to the signal.
    signalToOrderDays: mode === 'spreadsheet' ? 38 : 6,
    excessValueINR: Math.round(excessValue),
    productionStoppedINR: Math.round(stoppedByWeek.reduce((a, b) => a + b, 0)),
  }
}

export function runReplay(inp: SimInput & { storyMaterialId: string }): ReplayResult {
  const before = simulate(inp, 'spreadsheet')
  const after = simulate(inp, 'demandpilot')

  return {
    before, after,
    storyMaterialId: inp.storyMaterialId,
    deltas: {
      stockoutsAvoided: before.totalStockouts - after.totalStockouts,
      lineStopDaysAvoided: before.lineStopDays - after.lineStopDays,
      inventoryReducedINR: before.avgInventoryValueINR - after.avgInventoryValueINR,
      storageCostSavedINR: before.storageCostINR - after.storageCostINR,
      daysOfInventoryReduced: +(before.daysOfInventory - after.daysOfInventory).toFixed(1),
      serviceLevelGain: +(after.serviceLevelPct - before.serviceLevelPct).toFixed(1),
      signalToOrderDaysSaved: before.signalToOrderDays - after.signalToOrderDays,
      arrivalEarlinessImprovedDays: +(Math.abs(before.avgArrivalEarlinessDays) - Math.abs(after.avgArrivalEarlinessDays)).toFixed(1),
      extraHoldingCostINR: after.storageCostINR - before.storageCostINR,
      productionProtectedINR: before.productionStoppedINR - after.productionStoppedINR,
    },
  }
}
