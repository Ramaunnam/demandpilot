/**
 * Material Requirements Planning (capability K4).
 *
 * This is the step the case study calls "turning the production schedule directly
 * into material needs". It runs in five stages:
 *
 *   1. Take the forecast and build a weekly production plan, limited by line capacity.
 *   2. Explode that plan through the bill of materials -> gross requirement per week.
 *   3. Net it off against stock on hand and deliveries already on the way.
 *   4. Apply the lot-size rule (minimum order quantity, fixed lot, or lot-for-lot).
 *   5. Work backwards by the lead time to get the date the order must be released.
 */
import type { Dataset, BomLine, Form, ProductionLine } from '@/data/types'
import { ROUTING } from '@/data/catalog'

export interface ProductionWeek {
  week: number
  /** Tonnes we want to make, before any capacity limit. */
  requiredT: number
  /** Tonnes we can actually make. */
  plannedT: number
  shortfallT: number
  byLine: Record<string, number>
  capacityT: number
  utilisationPct: number
  constrained: boolean
  /** Lines down for planned maintenance this week, so a dip can be labelled. */
  maintenanceLines: string[]
  /**
   * True when the shutdown actually cost output.
   *
   * Being the tightest line that week is not enough — a line can set the limit
   * and the plan still fit underneath it. This is the stricter question a
   * planner is asking: did we fail to make what we needed because of it.
   */
  maintenanceBinds: boolean
  /**
   * The process that caps output this week.
   *
   * This is what the Lines panel exists to answer: of five lines, which one is
   * the plant waiting on. Annealing is normally the tightest; in a maintenance
   * week it is whichever line is down.
   */
  limitingLine: string
}

export interface MrpCell {
  week: number
  grossRequirement: number
  scheduledReceipts: number
  projectedOnHand: number
  netRequirement: number
  plannedOrderReceipt: number
  plannedOrderRelease: number
  belowSafety: boolean
  stockout: boolean
}

export interface MrpRow {
  materialId: string
  code: string
  name: string
  unit: string
  safetyStock: number
  leadTimeWeeks: number
  cells: MrpCell[]
  /** First week the projection dips under the safety level. */
  firstBreachWeek: number | null
  firstStockoutWeek: number | null
  totalPlannedQty: number
  totalPlannedValue: number
}

export interface PlannedOrder {
  id: string
  materialId: string
  qty: number
  /** Week the material is needed on site. */
  needWeek: number
  /** Week the order has to be placed. */
  releaseWeek: number
  late: boolean
  reason: string
}

export interface MrpResult {
  production: ProductionWeek[]
  rows: MrpRow[]
  plannedOrders: PlannedOrder[]
  steps: { label: string; detail: string; count: number }[]
  horizon: number
  startWeek: number
}

export interface MrpInput {
  ds: Dataset
  startWeek: number
  horizon: number
  /** Forecast tonnes per SKU per future week (index 0 = startWeek). */
  skuForecast: Map<string, number[]>
  /** Safety stock and on-hand per material, from the inventory engine. */
  safetyStock: Map<string, number>
  onHand: Map<string, number>
  /** Receipts already scheduled: materialId -> week -> qty. */
  scheduledReceipts: Map<string, Map<number, number>>
  lotSizeRespected: boolean
}

/**
 * What a line still produces while it is down for planned maintenance.
 *
 * At 0.35 a single melt week collapsed the plant to a third of its output — a
 * 3,000 t cliff that flattened every other week on the chart. Maintenance is
 * scheduled around production, not instead of it.
 */
const MAINTENANCE_FACTOR = 0.7

export function runMrp(inp: MrpInput): MrpResult {
  const { ds, startWeek, horizon } = inp

  // ---- Stage 1: production plan, limited by line capacity -------------------
  const production: ProductionWeek[] = []
  const feasibleByWeek: number[] = []     // ratio of what we can make vs what we want

  for (let i = 0; i < horizon; i++) {
    const week = startWeek + i
    let requiredT = 0
    const byForm: Record<string, number> = {}
    for (const sku of ds.skus) {
      const f = inp.skuForecast.get(sku.id)
      const v = f?.[i] ?? 0
      requiredT += v
      byForm[sku.form] = (byForm[sku.form] ?? 0) + v
    }

    /**
     * How much of this week's tonnage passes through each process.
     *
     * Driven by the product mix: everything is melted and hot rolled, while
     * only the cold-rolled and sheet volume carries on through the cold mill,
     * the anneal and finishing.
     */
    const shareOf = (process: ProductionLine['process']) => {
      if (requiredT <= 0) return 0
      let through = 0
      for (const [form, t] of Object.entries(byForm)) {
        if (ROUTING[form as Form].includes(process)) through += t
      }
      return through / requiredT
    }

    /**
     * The plant can only make what its tightest process allows.
     *
     * Each line's capacity is divided by the share of output that passes
     * through it, which converts "tonnes through this line" into "tonnes of
     * finished product the plant can make". The smallest answer is the
     * constraint — and naming it is the point of the Lines panel.
     */
    let capacityT = 0
    let bottleneck = Infinity
    let limitingLine = ''
    const byLine: Record<string, number> = {}
    const maintenanceLines: string[] = []

    for (const line of ds.lines) {
      const down = line.maintenanceWeeks.includes(week)
      if (down) maintenanceLines.push(line.process)
      const cap = down ? line.weeklyCapacityT * MAINTENANCE_FACTOR : line.weeklyCapacityT
      capacityT += cap
      byLine[line.id] = 0

      const share = shareOf(line.process)
      if (share > 0) {
        const supports = cap / share
        if (supports < bottleneck) { bottleneck = supports; limitingLine = line.process }
      }
    }
    if (!isFinite(bottleneck)) bottleneck = capacityT

    const plannedT = Math.min(requiredT, bottleneck)
    const ratio = requiredT > 0 ? plannedT / requiredT : 1
    feasibleByWeek.push(ratio)

    // A tonne loads every line on its route, not one of them.
    for (const [form, t] of Object.entries(byForm)) {
      for (const process of ROUTING[form as Form]) {
        const onProcess = ds.lines.filter(l => l.process === process)
        for (const line of onProcess) byLine[line.id] += (t * ratio) / onProcess.length
      }
    }

    const constrained = requiredT > bottleneck * 1.001
    production.push({
      week, requiredT: +requiredT.toFixed(1), plannedT: +plannedT.toFixed(1),
      shortfallT: +(requiredT - plannedT).toFixed(1),
      byLine, capacityT: +bottleneck.toFixed(1),
      utilisationPct: bottleneck > 0 ? +((plannedT / bottleneck) * 100).toFixed(1) : 0,
      constrained,
      maintenanceLines,
      // Both tests have to hold: the shutdown is what caps the week, and the
      // week falls short because of it.
      maintenanceBinds: constrained && maintenanceLines.includes(limitingLine),
      limitingLine,
    })
  }

  // ---- Stage 2: explode the plan through the bill of materials -------------
  const gross = new Map<string, number[]>()
  for (const m of ds.materials) gross.set(m.id, new Array(horizon).fill(0))

  for (const sku of ds.skus) {
    const f = inp.skuForecast.get(sku.id)
    if (!f) continue
    const lines: BomLine[] = ds.bom[sku.id] ?? []
    for (let i = 0; i < horizon; i++) {
      const tonnes = (f[i] ?? 0) * feasibleByWeek[i]
      if (tonnes <= 0) continue
      for (const bl of lines) {
        const arr = gross.get(bl.materialId)
        if (arr) arr[i] += tonnes * bl.qtyPerTonne * (1 + bl.scrapPct / 100)
      }
    }
  }

  // ---- Stages 3-5: net off stock, apply lot sizes, offset by lead time -----
  const rows: MrpRow[] = []
  const plannedOrders: PlannedOrder[] = []
  let orderNo = 0

  for (const m of ds.materials) {
    const g = gross.get(m.id)!
    const ss = inp.safetyStock.get(m.id) ?? 0
    const ltWeeks = Math.max(1, Math.round((m.leadTimeDays) / 7))
    const receipts = inp.scheduledReceipts.get(m.id) ?? new Map<number, number>()

    let onHand = inp.onHand.get(m.id) ?? 0
    const cells: MrpCell[] = []
    let firstBreachWeek: number | null = null
    let firstStockoutWeek: number | null = null
    let totalQty = 0

    for (let i = 0; i < horizon; i++) {
      const week = startWeek + i
      const sched = receipts.get(week) ?? 0
      const before = onHand + sched
      const net = Math.max(0, g[i] + ss - before)

      let receipt = 0
      if (net > 0) {
        if (inp.lotSizeRespected) {
          if (m.lotRule === 'Fixed lot') receipt = Math.ceil(net / m.lotSize) * m.lotSize
          else if (m.lotRule === 'Min order qty') receipt = Math.max(m.moq, Math.ceil(net / m.lotSize) * m.lotSize)
          else receipt = net
        } else receipt = net
      }

      const projected = before + receipt - g[i]
      const belowSafety = projected < ss - 0.0001
      const stockout = projected < -0.0001

      if (belowSafety && firstBreachWeek === null) firstBreachWeek = week
      if (stockout && firstStockoutWeek === null) firstStockoutWeek = week

      if (receipt > 0) {
        orderNo++
        const releaseWeek = week - ltWeeks
        plannedOrders.push({
          id: `PLO-${String(5000 + orderNo)}`,
          materialId: m.id, qty: +receipt.toFixed(2),
          needWeek: week, releaseWeek,
          late: releaseWeek < startWeek,
          reason: releaseWeek < startWeek
            ? `Needed in week ${week}, but with a ${m.leadTimeDays}-day lead time the order should already have gone out in week ${releaseWeek}.`
            : `Covers the week ${week} requirement of ${g[i].toFixed(2)} ${m.unit} while keeping the ${ss.toFixed(2)} ${m.unit} buffer intact.`,
        })
        totalQty += receipt
      }

      cells.push({
        week,
        grossRequirement: +g[i].toFixed(3),
        scheduledReceipts: +sched.toFixed(3),
        projectedOnHand: +projected.toFixed(3),
        netRequirement: +net.toFixed(3),
        plannedOrderReceipt: +receipt.toFixed(3),
        plannedOrderRelease: 0,
        belowSafety, stockout,
      })
      onHand = projected
    }

    // write the release quantities back onto the right week in the grid
    for (const po of plannedOrders.filter(p => p.materialId === m.id)) {
      const idx = po.releaseWeek - startWeek
      if (idx >= 0 && idx < cells.length) cells[idx].plannedOrderRelease += po.qty
    }

    rows.push({
      materialId: m.id, code: m.code, name: m.name, unit: m.unit,
      safetyStock: +ss.toFixed(2), leadTimeWeeks: ltWeeks, cells,
      firstBreachWeek, firstStockoutWeek,
      totalPlannedQty: +totalQty.toFixed(2),
      totalPlannedValue: Math.round(totalQty * m.costPerUnit),
    })
  }

  const constrainedWeeks = production.filter(p => p.constrained).length
  const steps = [
    { label: 'Read the forecast', detail: `${ds.skus.length} products × ${horizon} weeks of demand`, count: ds.skus.length },
    { label: 'Build the production plan', detail: `Checked against ${ds.lines.length} lines; ${constrainedWeeks} week(s) hit the capacity limit`, count: horizon },
    { label: 'Explode the bill of materials', detail: `${ds.materials.length} materials across every product recipe`, count: ds.materials.length },
    { label: 'Net against stock and deliveries', detail: 'Subtracted stock on hand and orders already on the way, then added the safety buffer', count: ds.materials.length },
    { label: 'Create planned orders', detail: `${plannedOrders.length} planned orders, ${plannedOrders.filter(p => p.late).length} of them already late`, count: plannedOrders.length },
  ]

  return { production, rows, plannedOrders, steps, horizon, startWeek }
}
