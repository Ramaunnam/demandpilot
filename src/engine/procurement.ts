/**
 * Procurement guidance (capability K5).
 *
 * Turns planned orders and stock positions into recommendations a buyer can act on:
 * what to buy, how much, from whom, and the last day it can be ordered.
 * It also recommends *reducing* orders where we are carrying too much.
 *
 * Nothing here places an order. Every recommendation ends in Approve / Edit / Reject.
 */
import type { Dataset, Material, Supplier } from '@/data/types'
import type { InventoryResult } from './inventory'
import type { PlannedOrder } from './mrp'
import { clamp, fmtQty } from '@/lib/format'

export type RecType = 'Order now' | 'Expedite' | 'Bring forward' | 'Reduce / delay' | 'Transfer stock' | 'No source'
export type Urgency = 'Critical' | 'High' | 'Medium' | 'Low'

export interface SignalWeight { name: string; weight: number; value: string }

export interface Recommendation {
  id: string
  type: RecType
  materialId: string
  materialName: string
  materialCode: string
  unit: string
  qty: number
  supplierId: string
  supplierName: string
  /** Why this supplier and not the usual one. */
  supplierNote: string
  pricePerUnit: number
  valueINR: number
  /** Last week the order can go out and still land in time. */
  orderByWeek: number
  orderByDays: number
  expectedArrivalWeek: number
  neededByWeek: number
  leadTimeDays: number
  urgency: Urgency
  confidence: number
  reason: string
  signals: SignalWeight[]
  /** What happens if nobody acts. */
  ifIgnored: string
  stockoutInDays: number
  revenueAtRiskINR: number
  alternatives: { label: string; detail: string; costDeltaINR: number }[]
  calculation: string
  linkedAnomalyIds: string[]
  linkedSignalIds: string[]
}

export interface ProcurementInput {
  ds: Dataset
  todayWeek: number
  inventory: Map<string, InventoryResult>
  plannedOrders: PlannedOrder[]
  /** Daily usage per material, used for the plain-language reasons. */
  dailyUsage: Map<string, number>
  /** Which SKUs and anomalies are driving each material, for the explanation. */
  drivers: Map<string, { skuCodes: string[]; anomalyIds: string[]; signalIds: string[]; note: string }>
  /** Stock split by region, so we can suggest a transfer instead of a purchase. */
  stockByRegion: Map<string, Record<string, number>>
  /**
   * Rupee value of finished product made each week that depends on this material.
   * Exposure has to be measured in money, not in units of the material itself —
   * 456 wooden skids a day and 3.3 tonnes of molybdenum a day are not comparable
   * numbers, and treating them as if they were makes packaging look like the
   * biggest risk on site.
   */
  downstreamWeeklyValue: Map<string, number>
  excessCoverDays: number
}

function supplierFor(ds: Dataset, id: string): Supplier | undefined {
  return ds.suppliers.find(s => s.id === id)
}

/**
 * Pick the supplier who can actually make the date.
 * If the usual supplier's lead time is already too long, look at the backups.
 */
function chooseSupplier(ds: Dataset, m: Material, daysAvailable: number) {
  const primary = supplierFor(ds, m.primarySupplierId)!
  const options = [primary, ...m.backupSupplierIds.map(id => supplierFor(ds, id)!).filter(Boolean)]

  const feasible = options.filter(s => s.leadTimeDays <= daysAvailable)
  if (feasible.length) {
    // cheapest supplier that still makes the date
    const best = feasible.sort((a, b) => a.priceVariancePct - b.priceVariancePct)[0]
    const note = best.id === primary.id
      ? `Usual supplier. ${best.leadTimeDays}-day lead time fits inside the ${Math.round(daysAvailable)} days we have.`
      : `${primary.name} needs ${primary.leadTimeDays} days, which is longer than the ${Math.round(daysAvailable)} days available. ` +
        `${best.name} delivers in ${best.leadTimeDays} days at about ${best.priceVariancePct > 0 ? '+' : ''}${best.priceVariancePct.toFixed(1)}% on price.`
    return { supplier: best, note, switched: best.id !== primary.id }
  }

  // Nobody makes the date — recommend the fastest and flag it as an expedite.
  const fastest = options.sort((a, b) => a.leadTimeDays - b.leadTimeDays)[0]
  return {
    supplier: fastest,
    note: `No approved supplier can deliver within ${Math.round(daysAvailable)} days. ` +
          `${fastest.name} is the fastest at ${fastest.leadTimeDays} days — this needs expediting or a partial cover plan.`,
    switched: fastest.id !== primary.id,
  }
}

function urgencyFor(daysOfCover: number, orderByDays: number, critical: boolean): Urgency {
  if (orderByDays <= 0 || daysOfCover < 7) return 'Critical'
  if (orderByDays <= 7 || daysOfCover < 14) return critical ? 'Critical' : 'High'
  if (orderByDays <= 21) return 'Medium'
  return 'Low'
}

export function buildRecommendations(inp: ProcurementInput): Recommendation[] {
  const { ds, todayWeek } = inp
  const out: Recommendation[] = []
  let n = 0

  for (const m of ds.materials) {
    const inv = inp.inventory.get(m.id)
    if (!inv) continue
    const daily = Math.max(0.0001, inp.dailyUsage.get(m.id) ?? 0)
    const drv = inp.drivers.get(m.id)
    const planned = inp.plannedOrders.filter(p => p.materialId === m.id).sort((a, b) => a.needWeek - b.needWeek)

    // -------------------------------------------------------------------
    // A. We are short, or will be — buy something
    // -------------------------------------------------------------------
    if (inv.status === 'Stockout risk' || inv.status === 'Reorder now' || planned.some(p => p.late)) {
      n++
      const first = planned[0]
      const neededByWeek = first ? first.needWeek : todayWeek + Math.max(1, Math.floor(inv.daysToSafetyBreach / 7))
      const daysAvailable = Math.max(0, inv.daysToSafetyBreach)
      const { supplier, note, switched } = chooseSupplier(ds, m, daysAvailable)

      // Quantity: cover the planned orders in the lead-time window, respecting MOQ.
      const windowWeeks = Math.ceil((supplier.leadTimeDays + 21) / 7)
      const rawQty = planned.filter(p => p.needWeek <= todayWeek + windowWeeks)
        .reduce((s, p) => s + p.qty, 0) || Math.max(inv.shortfall, daily * 21)
      const qty = m.lotRule === 'Lot-for-lot' ? rawQty : Math.max(m.moq, Math.ceil(rawQty / m.lotSize) * m.lotSize)

      const price = Math.round(m.costPerUnit * (1 + supplier.priceVariancePct / 100))
      const orderByDays = Math.round(inv.daysToSafetyBreach - supplier.leadTimeDays)
      const orderByWeek = todayWeek + Math.floor(orderByDays / 7)
      const expectedArrivalWeek = todayWeek + Math.ceil(supplier.leadTimeDays / 7)

      const type: RecType = orderByDays <= 0 ? 'Expedite' : inv.status === 'Stockout risk' ? 'Order now' : 'Order now'
      const urgency = urgencyFor(inv.daysOfCover, orderByDays, m.critical)

      // Confidence: how sure are we this is the right call?
      const signals: SignalWeight[] = [
        { name: 'Days of cover', weight: clamp(1 - inv.daysOfCover / 45, 0.05, 0.98), value: `${inv.daysOfCover.toFixed(1)} d` },
        { name: 'Demand change', weight: clamp(Math.abs((drv?.skuCodes.length ?? 0) > 0 ? 0.72 : 0.4), 0, 1), value: drv?.note ?? 'Stable' },
        { name: 'Lead-time risk', weight: clamp(m.leadTimeSdDays / Math.max(1, m.leadTimeDays) * 3.2, 0.05, 0.95), value: `${m.leadTimeDays} ± ${m.leadTimeSdDays} d` },
        { name: 'Supplier reliability', weight: clamp(1 - supplier.otifPct / 100, 0.02, 0.9), value: `${supplier.otifPct}% on time` },
        { name: 'Cost impact', weight: clamp(Math.log10(Math.max(10, qty * price)) / 8, 0.1, 0.95), value: `₹${Math.round(qty * price / 1e5)} L` },
      ]
      const confidence = Math.round(clamp(
        52 + (m.critical ? 12 : 4) + (inv.daysOfCover < 14 ? 18 : 6) +
        (drv?.anomalyIds.length ? 10 : 0) + (supplier.otifPct - 85) * 0.35 -
        (inv.daysOfCover > 30 ? 16 : 0) - (switched ? 4 : 0), 38, 96))

      const stockoutInDays = Math.round(inv.daysToStockout)
      // Exposure is the value of production that stops, multiplied by how long it
      // would stop for. We use the material's own lead time rather than the
      // expedite route's, because exposure is what you face before you act.
      const weeksStopped = clamp(m.leadTimeDays / 7, 1, 8)
      const revenueAtRisk = Math.round(
        (inp.downstreamWeeklyValue.get(m.id) ?? 0) * weeksStopped)

      out.push({
        id: `REC-${String(2000 + n)}`, type,
        materialId: m.id, materialName: m.name, materialCode: m.code, unit: m.unit,
        qty: +qty.toFixed(2),
        supplierId: supplier.id, supplierName: supplier.name, supplierNote: note,
        pricePerUnit: price, valueINR: Math.round(qty * price),
        orderByWeek, orderByDays, expectedArrivalWeek, neededByWeek,
        leadTimeDays: supplier.leadTimeDays,
        urgency, confidence,
        reason: drv?.note
          ? `${drv.note} ${m.name} falls below its safety level in ${Math.round(inv.daysToSafetyBreach)} days.`
          : `${m.name} is down to ${inv.daysOfCover.toFixed(1)} days of cover against a ${m.leadTimeDays}-day lead time.`,
        signals,
        ifIgnored: orderByDays <= 0
          ? `The normal ordering route has already passed. Stock runs out in about ${stockoutInDays} days, which stops every product that uses ${m.name}.`
          : `If no order is placed within ${orderByDays} days, stock drops through the safety buffer and a stockout follows in about ${stockoutInDays} days.`,
        stockoutInDays,
        revenueAtRiskINR: revenueAtRisk,
        alternatives: [
          { label: 'Do nothing', detail: `Stock runs out in about ${stockoutInDays} days and production stops.`, costDeltaINR: revenueAtRisk },
          switched
            ? { label: `Wait for ${supplierFor(ds, m.primarySupplierId)?.name}`, detail: `Cheaper by about ${Math.abs(supplier.priceVariancePct).toFixed(1)}%, but arrives after the buffer is gone.`, costDeltaINR: Math.round(revenueAtRisk * 0.6) }
            : { label: 'Split the order across two suppliers', detail: 'Reduces the risk of one late delivery, adds handling cost.', costDeltaINR: Math.round(qty * price * 0.03) },
          { label: 'Order a partial quantity now', detail: 'Covers the immediate gap and buys time to confirm the new demand level.', costDeltaINR: -Math.round(qty * price * 0.45) },
        ],
        calculation:
          `Requirement over the next ${windowWeeks} weeks is ${fmtQty(rawQty, m.unit)}. ` +
          `${m.lotRule === 'Lot-for-lot' ? 'Lot-for-lot, so we order exactly that.' :
             `Rounded up to the ${m.lotRule.toLowerCase()} of ${fmtQty(m.lotRule === 'Fixed lot' ? m.lotSize : m.moq, m.unit)}.`} ` +
          `At ₹${price.toLocaleString('en-IN')} per ${m.unit} that is ₹${Math.round(qty * price).toLocaleString('en-IN')}.`,
        linkedAnomalyIds: drv?.anomalyIds ?? [],
        linkedSignalIds: drv?.signalIds ?? [],
      })
    }

    // -------------------------------------------------------------------
    // B. We are carrying too much — reduce or delay
    // -------------------------------------------------------------------
    else if (inv.status === 'Excess' && inv.excessValue > 120000) {
      n++
      const supplier = supplierFor(ds, m.primarySupplierId)!
      const cut = inv.excessUnits
      const freed = inv.excessValue
      out.push({
        id: `REC-${String(2000 + n)}`, type: 'Reduce / delay',
        materialId: m.id, materialName: m.name, materialCode: m.code, unit: m.unit,
        qty: +cut.toFixed(2),
        supplierId: supplier.id, supplierName: supplier.name,
        supplierNote: `Hold the next call-off with ${supplier.name} rather than cancelling — the contract rate stays intact.`,
        pricePerUnit: m.costPerUnit, valueINR: -freed,
        orderByWeek: todayWeek, orderByDays: 0,
        expectedArrivalWeek: todayWeek, neededByWeek: todayWeek + 12,
        leadTimeDays: m.leadTimeDays,
        urgency: 'Low',
        confidence: Math.round(clamp(62 + (inv.daysOfCover - inp.excessCoverDays) * 0.45, 55, 92)),
        reason: drv?.note
          ? `${drv.note} We are holding ${inv.daysOfCover.toFixed(0)} days of ${m.name} against a ${inp.excessCoverDays}-day target.`
          : `We are holding ${inv.daysOfCover.toFixed(0)} days of ${m.name} against a ${inp.excessCoverDays}-day target.`,
        signals: [
          { name: 'Days of cover', weight: clamp(inv.daysOfCover / 120, 0.2, 0.98), value: `${inv.daysOfCover.toFixed(0)} d` },
          { name: 'Demand change', weight: 0.68, value: drv?.note ?? 'Falling' },
          { name: 'Cash impact', weight: clamp(Math.log10(Math.max(10, freed)) / 8, 0.2, 0.95), value: `₹${Math.round(freed / 1e5)} L freed` },
          { name: 'Shelf life', weight: m.shelfLifeDays ? clamp(1 - m.shelfLifeDays / 700, 0.1, 0.95) : 0.08, value: m.shelfLifeDays ? `${m.shelfLifeDays} d` : 'No limit' },
        ],
        ifIgnored: `Roughly ₹${Math.round(freed / 1e5)} lakh stays tied up in stock that the current demand plan does not need` +
          (m.shelfLifeDays ? `, and this material has a ${m.shelfLifeDays}-day shelf life.` : '.'),
        stockoutInDays: 999,
        revenueAtRiskINR: 0,
        alternatives: [
          { label: 'Delay the next call-off by 4 weeks', detail: 'Keeps the supplier relationship and the contract rate.', costDeltaINR: -Math.round(freed * 0.6) },
          { label: 'Cut the standing order quantity', detail: 'Larger saving, but may lose the volume rate.', costDeltaINR: -freed },
          { label: 'Leave it', detail: 'No change. Cash stays in stock.', costDeltaINR: 0 },
        ],
        calculation:
          `Target cover is ${inp.excessCoverDays} days at ${fmtQty(daily, m.unit)} per day = ` +
          `${fmtQty(daily * inp.excessCoverDays, m.unit)}. We hold ${fmtQty(inv.stockValue / m.costPerUnit, m.unit)}, ` +
          `so ${fmtQty(cut, m.unit)} is surplus — about ₹${freed.toLocaleString('en-IN')}.`,
        linkedAnomalyIds: drv?.anomalyIds ?? [],
        linkedSignalIds: drv?.signalIds ?? [],
      })
    }
  }

  // Rank by slack — days of cover minus the lead time — rather than by how soon
  // stock runs out. A packaging item with eleven days of cover and an eight-day
  // lead time has three days of headroom and is recoverable; an imported alloy
  // with twenty-four days of cover and a forty-two-day lead time does not, even
  // though it lasts longer. Slack is what actually tells you what to do first.
  const rank: Record<Urgency, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 }
  const slack = (r: Recommendation) => r.stockoutInDays - r.leadTimeDays
  return out.sort((a, b) =>
    rank[a.urgency] - rank[b.urgency] ||
    slack(a) - slack(b) ||
    b.revenueAtRiskINR - a.revenueAtRiskINR)
}
