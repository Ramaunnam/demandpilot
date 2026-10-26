/**
 * Safety stock, reorder point and stock health (capability K3).
 *
 * These are the "live parameters" the case study talks about. The old way was a
 * fixed minimum level typed into a spreadsheet once a year. Here both numbers are
 * recalculated from current usage, current variability and the current lead time,
 * every time the planner changes a setting.
 */
import { clamp, mean, stdev } from '@/lib/format'

/** Service level -> Z value from the normal distribution. */
export const Z_TABLE: Record<number, number> = {
  90: 1.2816, 92: 1.4051, 94: 1.5548, 95: 1.6449,
  96: 1.7507, 97: 1.8808, 98: 2.0537, 99: 2.3263, 99.5: 2.5758,
}

export function zForServiceLevel(pct: number): number {
  const keys = Object.keys(Z_TABLE).map(Number).sort((a, b) => a - b)
  let best = keys[0]
  for (const k of keys) if (Math.abs(k - pct) < Math.abs(best - pct)) best = k
  return Z_TABLE[best]
}

export type StockStatus = 'Healthy' | 'Reorder now' | 'Stockout risk' | 'Excess'
export type ActionTier = 'Order now' | 'Review' | 'Monitor'

export interface InventoryInput {
  materialId: string
  /** Average demand per day, from the forecast — not from last year's average. */
  dailyUsage: number
  /** How much that daily usage bounces around. */
  usageSd: number
  leadTimeDays: number
  leadTimeSdDays: number
  onHand: number
  onOrder: number
  serviceLevelPct: number
  /** Extra days the planner adds on top of the supplier's quoted lead time. */
  leadTimeBufferDays: number
  staticMinLevel: number
  costPerUnit: number
  excessCoverDays: number
}

export interface InventoryResult {
  materialId: string
  z: number
  safetyStock: number
  reorderPoint: number
  daysOfCover: number
  daysOfCoverWithOnOrder: number
  status: StockStatus
  actionTier: ActionTier
  /** Day the stock is projected to fall through the safety level. */
  daysToSafetyBreach: number
  daysToStockout: number
  /** Last day we can place an order and still arrive before the safety breach. */
  orderByDays: number
  shortfall: number
  excessUnits: number
  excessValue: number
  stockValue: number
  /** Health score 0-100: availability and excess combined. */
  healthScore: number
  availabilityScore: number
  excessScore: number
  staticMinLevel: number
  improvementVsStatic: number
  explain: {
    safetyStock: string
    reorderPoint: string
    daysOfCover: string
    orderBy: string
  }
}

export function computeInventory(inp: InventoryInput): InventoryResult {
  const z = zForServiceLevel(inp.serviceLevelPct)
  const LT = Math.max(0.5, inp.leadTimeDays + inp.leadTimeBufferDays)
  const d = Math.max(0.0001, inp.dailyUsage)
  const sd = Math.max(0, inp.usageSd)
  const sdLT = Math.max(0, inp.leadTimeSdDays)

  // The standard formula that covers both kinds of uncertainty:
  // how much we use varies, AND how long the supplier takes varies.
  const variance = LT * sd * sd + d * d * sdLT * sdLT
  const safetyStock = z * Math.sqrt(Math.max(0, variance))
  const reorderPoint = d * LT + safetyStock

  const daysOfCover = inp.onHand / d
  const daysOfCoverWithOnOrder = (inp.onHand + inp.onOrder) / d
  const daysToSafetyBreach = (inp.onHand - safetyStock) / d
  const daysToStockout = daysOfCover
  const orderByDays = daysToSafetyBreach - LT

  let status: StockStatus
  if (daysOfCover <= LT * 0.75) status = 'Stockout risk'
  else if (inp.onHand + inp.onOrder <= reorderPoint) status = 'Reorder now'
  else if (daysOfCover >= inp.excessCoverDays) status = 'Excess'
  else status = 'Healthy'

  const actionTier: ActionTier = daysOfCover < 7 ? 'Order now' : daysOfCover <= 14 ? 'Review' : 'Monitor'

  const shortfall = Math.max(0, reorderPoint - (inp.onHand + inp.onOrder))
  const targetUnits = d * inp.excessCoverDays
  const excessUnits = Math.max(0, inp.onHand - targetUnits)

  // Availability: how comfortable are we against the safety level?
  const availabilityScore = clamp(
    daysOfCoverWithOnOrder <= 0 ? 0 : (daysOfCoverWithOnOrder / Math.max(1, LT + safetyStock / d)) * 70,
    0, 100)
  // Excess: how much stock are we carrying beyond what the target cover needs?
  const excessRatio = targetUnits > 0 ? inp.onHand / targetUnits : 1
  const excessScore = clamp(100 - Math.max(0, excessRatio - 1) * 85, 0, 100)
  const healthScore = Math.round(availabilityScore * 0.58 + excessScore * 0.42)

  const u = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 })

  return {
    materialId: inp.materialId, z,
    safetyStock: +safetyStock.toFixed(2),
    reorderPoint: +reorderPoint.toFixed(2),
    daysOfCover: +daysOfCover.toFixed(1),
    daysOfCoverWithOnOrder: +daysOfCoverWithOnOrder.toFixed(1),
    status, actionTier,
    daysToSafetyBreach: +daysToSafetyBreach.toFixed(1),
    daysToStockout: +daysToStockout.toFixed(1),
    orderByDays: +orderByDays.toFixed(1),
    shortfall: +shortfall.toFixed(2),
    excessUnits: +excessUnits.toFixed(2),
    excessValue: Math.round(excessUnits * inp.costPerUnit),
    stockValue: Math.round(inp.onHand * inp.costPerUnit),
    healthScore,
    availabilityScore: Math.round(availabilityScore),
    excessScore: Math.round(excessScore),
    staticMinLevel: inp.staticMinLevel,
    improvementVsStatic: +(safetyStock - inp.staticMinLevel).toFixed(2),
    explain: {
      safetyStock:
        `Safety stock = Z × √(lead time × usage variability² + usage² × lead-time variability²). ` +
        `With a ${inp.serviceLevelPct}% service level Z is ${z.toFixed(2)}; we use about ${u(d)} per day ` +
        `(varying by ±${u(sd)}), and the lead time is ${LT.toFixed(0)} days (varying by ±${u(sdLT)} days). ` +
        `That gives ${u(safetyStock)} units of buffer.`,
      reorderPoint:
        `Reorder point = usage during the lead time + safety stock = ` +
        `(${u(d)} per day × ${LT.toFixed(0)} days) + ${u(safetyStock)} = ${u(reorderPoint)} units. ` +
        `When stock on hand plus stock on order drops to this level, it is time to buy.`,
      daysOfCover:
        `Days of cover = stock on hand ÷ usage per day = ${u(inp.onHand)} ÷ ${u(d)} = ${daysOfCover.toFixed(1)} days.`,
      orderBy:
        `Order-by = days until we hit the safety level − lead time = ` +
        `${daysToSafetyBreach.toFixed(1)} − ${LT.toFixed(0)} = ${orderByDays.toFixed(1)} days from today. ` +
        (orderByDays < 0
          ? 'This is already in the past with the normal supplier, so the order needs a faster route.'
          : 'Placing the order by then means it arrives just before the buffer is touched.'),
    },
  }
}

/** Standard deviation of weekly demand converted to a daily figure. */
export function dailyUsageStats(weeklySeries: number[]): { daily: number; dailySd: number } {
  const w = weeklySeries.filter(v => isFinite(v))
  const m = mean(w) / 7
  const s = stdev(w) / Math.sqrt(7)
  return { daily: Math.max(0, m), dailySd: Math.max(0, s) }
}
