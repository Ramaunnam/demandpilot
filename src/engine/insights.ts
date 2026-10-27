/**
 * Read-only views for the Anomalies screen: what changed, why, what next, and
 * what it means for buying. Everything here is derived from the dataset and the
 * planning result — no new numbers are invented.
 *
 * Only weeks that have already happened are used (index < todayWeek). The
 * dataset carries hidden future weeks for the simulator; showing them here
 * would leak sales the planner cannot know yet.
 */
import type { Dataset, Grade, RegionName, CustomerOrder } from '@/data/types'
import type { PlanningResult, MaterialView } from './index'
import type { AnomalyGroup } from './anomaly'
import { mean, median, stdev, sum, clamp, fmtQty } from '@/lib/format'

export const GRADES_ALL: Grade[] = ['304', '316L', '430', '201']
export const REGIONS_ALL: RegionName[] = ['North', 'South', 'East', 'West']

// ---------------------------------------------------------------------------
// Demand outlook: where demand is about to jump or fall
// ---------------------------------------------------------------------------
export interface OutlookCell {
  grade: Grade
  region: RegionName
  /** Last 8 weeks of actual sales, tonnes. */
  lastT: number
  /** Next 8 weeks of forecast, tonnes. */
  nextT: number
  changePct: number
}

export function demandOutlook(ds: Dataset, r: PlanningResult, weeks = 8): OutlookCell[] {
  const last = r.todayWeek
  const bySku = new Map(ds.skus.map(s => [s.id, s]))
  const cells: OutlookCell[] = []
  for (const grade of GRADES_ALL) for (const region of REGIONS_ALL) {
    let lastT = 0, nextT = 0
    for (const d of ds.demand) {
      if (d.region !== region || bySku.get(d.skuId)?.grade !== grade) continue
      lastT += sum(d.weeks.slice(Math.max(0, last - weeks), last))
    }
    for (const f of r.skuForecasts) {
      if (f.grade !== grade) continue
      nextT += sum(f.byRegion[region].slice(0, weeks))
    }
    cells.push({ grade, region, lastT, nextT, changePct: lastT > 0 ? ((nextT - lastT) / lastT) * 100 : 0 })
  }
  return cells
}

// ---------------------------------------------------------------------------
// Material prices: which inputs are getting dearer, and what to do
// ---------------------------------------------------------------------------
const INDEX_OF: Record<string, 'nickel' | 'moly' | 'ferrochrome'> = {
  'RM-104': 'nickel', 'RM-105': 'moly', 'RM-102': 'ferrochrome',
}
const INDEX_NAME = { nickel: 'Nickel index (LME)', moly: 'Molybdenum index', ferrochrome: 'Ferrochrome index' }

export type PriceDirection = 'Rising' | 'Easing' | 'Steady'

export interface PriceAlert {
  materialId: string
  code: string
  name: string
  unit: string
  indexName: string | null
  /** Index points, last 26 weeks, for the chart. */
  series: { week: number; v: number }[]
  change4Pct: number
  change12Pct: number
  /** Straight-line run of the last 8 weeks, carried 8 weeks forward. */
  next8Pct: number
  /** Expected move used for the cost figures, and where it comes from. */
  movePct: number
  basis: 'Market notice' | 'Last 4 weeks' | 'Recent trend'
  direction: PriceDirection
  signals: { id: string; title: string; effectPct: number; week: number; confidence: number }[]
  weeklySpendINR: number
  /** Extra spend per week at the projected price, same usage. */
  extraPerWeekINR: number
  coverDays: number
  stockStatus: string
  leadTimeDays: number
  grades: { grade: Grade; perTonneINR: number; pctOfPrice: number }[]
  advice: string
  /** Rising and stock runs out inside lead time + 2 weeks. */
  urgent: boolean
}

function slopePerWeek(v: number[]): number {
  const n = v.length
  if (n < 2) return 0
  const xm = (n - 1) / 2, ym = mean(v)
  let num = 0, den = 0
  for (let i = 0; i < n; i++) { num += (i - xm) * (v[i] - ym); den += (i - xm) ** 2 }
  return den ? num / den : 0
}

export function priceAlerts(ds: Dataset, r: PlanningResult): PriceAlert[] {
  const now = r.todayWeek - 1
  const out: PriceAlert[] = []
  const matIds = new Set<string>(Object.keys(INDEX_OF))
  for (const s of ds.signals) if (s.kind === 'Price' && s.week <= now && s.week >= now - 8) s.materialIds.forEach(m => matIds.add(m))

  const gradePrice = new Map<Grade, number>()
  for (const g of GRADES_ALL) gradePrice.set(g, mean(ds.skus.filter(s => s.grade === g).map(s => s.pricePerT)))

  for (const id of matIds) {
    const m = ds.materials.find(x => x.id === id)
    const mv = r.materials.find(x => x.materialId === id)
    if (!m || !mv) continue
    const key = INDEX_OF[id]
    const signals = ds.signals
      .filter(s => s.kind === 'Price' && s.materialIds.includes(id) && s.week <= now && s.week >= now - 12)
      .map(s => ({ id: s.id, title: s.title, effectPct: s.effectPct, week: s.week, confidence: s.confidence }))

    let series: PriceAlert['series'] = [], change4 = 0, change12 = 0, next8 = 0
    if (key) {
      const pts = ds.commodity.filter(c => c.week <= now)
      series = pts.slice(-26).map(c => ({ week: c.week, v: c[key] }))
      const v = pts.map(c => c[key])
      const at = (k: number) => v[v.length - 1 - k]
      change4 = (at(0) / at(4) - 1) * 100
      change12 = (at(0) / at(12) - 1) * 100
      next8 = (slopePerWeek(v.slice(-8)) * 8 / at(0)) * 100
    } else if (signals.length) {
      // No index for this input: the supplier notice is the only evidence.
      change4 = 0
      next8 = 0
    }
    // Expected move over the next couple of months, from the strongest recent
    // evidence. A market notice from the last 8 weeks counts if it is newer
    // than a month, or agrees with the 12-week trend (an older notice that the
    // index has since contradicted is stale).
    const notice = signals.find(sg => sg.week >= now - 8 && (sg.week >= now - 4 || !key || Math.sign(sg.effectPct) === Math.sign(change12)))
    let movePct: number, basis: PriceAlert['basis']
    if (notice) { movePct = notice.effectPct * notice.confidence; basis = 'Market notice' }
    else if (Math.abs(change4) >= 2) { movePct = change4; basis = 'Last 4 weeks' }
    else { movePct = next8; basis = 'Recent trend' }
    const direction: PriceDirection = movePct >= 2 ? 'Rising' : movePct <= -2 ? 'Easing' : 'Steady'
    if (direction === 'Steady') movePct = 0

    const weeklySpendINR = mv.weeklyUsage * m.costPerUnit
    const grades = (m.usedByGrades as Grade[]).map(g => {
      const lines = ds.skus.filter(s => s.grade === g)
        .map(s => (ds.bom[s.id] ?? []).find(b => b.materialId === id)?.qtyPerTonne ?? 0)
      const qty = mean(lines)
      const perTonneINR = qty * m.costPerUnit * (movePct / 100)
      return { grade: g, perTonneINR, pctOfPrice: (perTonneINR / (gradePrice.get(g) || 1)) * 100 }
    }).filter(g => Math.abs(g.perTonneINR) >= 1).sort((a, b) => Math.abs(b.perTonneINR) - Math.abs(a.perTonneINR))

    const coverDays = mv.inv.daysOfCover
    const lead = m.leadTimeDays
    const urgent = direction === 'Rising' && coverDays < lead + 14
    const advice =
      direction === 'Rising'
        ? mv.inv.status === 'Excess'
          ? `Rising, but you already hold more than the plan needs. Don't buy extra. Fix the price on the next order.`
          : urgent
            ? `Rising, and stock lasts ${Math.round(coverDays)} days against a ${lead}-day lead time. Order now, at today's price.`
            : `Rising. Stock lasts ${Math.round(coverDays)} days. Bring the next order forward or fix its price with the supplier.`
        : direction === 'Easing'
          ? 'Easing. Buy only what the plan needs now and let the price come down before the next big order.'
          : 'Steady. No change to buying needed.'

    out.push({
      materialId: id, code: m.code, name: m.name, unit: m.unit,
      indexName: key ? INDEX_NAME[key] : null, series,
      change4Pct: change4, change12Pct: change12, next8Pct: next8, movePct, basis, direction, signals,
      weeklySpendINR, extraPerWeekINR: weeklySpendINR * (movePct / 100),
      coverDays, stockStatus: mv.inv.status, leadTimeDays: lead, grades, advice, urgent,
    })
  }
  const rank = { Rising: 0, Easing: 1, Steady: 2 }
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || rank[a.direction] - rank[b.direction] || Math.abs(b.extraPerWeekINR) - Math.abs(a.extraPerWeekINR))
}

// ---------------------------------------------------------------------------
// Customer orders: unusually big orders, and customers buying more or less
// ---------------------------------------------------------------------------
export interface BigOrder {
  order: CustomerOrder
  customer: string
  industry: string
  skuCode: string
  grade: Grade
  /** This order vs the typical order for the same product in the same region. */
  timesUsual: number
  unusual: boolean
}
export interface CustomerMove {
  customerId: string
  customer: string
  industry: string
  region: RegionName
  recentT: number
  /** What the customer's own history says 4 weeks should be, tonnes. */
  usualT: number
  changePct: number
  /** How many normal swings away from usual (4+ is flagged). */
  z: number
  grades: Grade[]
}

/**
 * Two honest questions about the order book:
 *  1. Which customers are ordering clearly more or less than THEIR OWN usual?
 *     Usual = their weekly average and spread over the earlier weeks; a move
 *     is flagged only if it is 4+ normal swings away and at least 10 t.
 *     (A plain "last 4 weeks vs the 4 before" flagged 25 of 60 customers on
 *     a flat order book: that was noise.)
 *  2. What are the largest recent orders, and is any of them unusual for that
 *     product in that region (2.5× the typical order or more)?
 */
export function orderWatch(ds: Dataset, r: PlanningResult) {
  const now = r.todayWeek - 1
  const placed = ds.orders.filter(o => o.orderWeek <= now)
  const first = Math.min(...placed.map(o => o.orderWeek))
  const cust = new Map(ds.customers.map(c => [c.id, c]))
  const sku = new Map(ds.skus.map(s => [s.id, s]))
  const win = 4
  const baseWeeks = now - win - first + 1

  // 1. customers vs their own usual
  const moves: CustomerMove[] = []
  const byCust = new Map<string, CustomerOrder[]>()
  for (const o of placed) byCust.set(o.customerId, [...(byCust.get(o.customerId) ?? []), o])
  if (baseWeeks >= 4) {
    for (const [cid, list] of byCust) {
      const weekly = new Array(now - first + 1).fill(0)
      for (const o of list) weekly[o.orderWeek - first] += o.qtyT
      const base = weekly.slice(0, baseWeeks)
      const m = mean(base)
      const sd = Math.max(Math.sqrt(mean(base.map(v => (v - m) ** 2))), m * 0.25, 0.5)
      const recentT = sum(weekly.slice(baseWeeks))
      const usualT = m * win
      const z = (recentT - usualT) / (sd * Math.sqrt(win))
      if (Math.abs(z) >= 4 && Math.abs(recentT - usualT) >= 10) {
        const c = cust.get(cid)!
        moves.push({
          customerId: cid, customer: c.name, industry: c.industry, region: c.region,
          recentT, usualT, changePct: usualT > 0 ? ((recentT - usualT) / usualT) * 100 : 100, z,
          grades: [...new Set(list.filter(o => o.orderWeek > now - win).map(o => sku.get(o.skuId)!.grade))],
        })
      }
    }
  }
  moves.sort((a, b) => Math.abs(b.z) - Math.abs(a.z))

  // 2. largest recent orders, against the same product in the same region
  const typical = new Map<string, number>()
  const groupsBy = new Map<string, number[]>()
  for (const o of placed) {
    const k = `${o.skuId}|${o.region}`
    groupsBy.set(k, [...(groupsBy.get(k) ?? []), o.qtyT])
  }
  for (const [k, qs] of groupsBy) if (qs.length >= 3) typical.set(k, median(qs))
  const big: BigOrder[] = placed
    .filter(o => o.orderWeek > now - win)
    .map(o => {
      const t = typical.get(`${o.skuId}|${o.region}`)
      const c = cust.get(o.customerId)!
      const s = sku.get(o.skuId)!
      const timesUsual = t ? o.qtyT / t : 1
      return { order: o, customer: c.name, industry: c.industry, skuCode: s.code, grade: s.grade, timesUsual, unusual: timesUsual >= 2.5 }
    })
    .sort((a, b) => b.order.valueINR - a.order.valueINR)
    .slice(0, 15)

  return {
    moves, big,
    unusualBig: big.filter(b => b.unusual).length,
    customersChecked: byCust.size,
    weeksCovered: now - first + 1,
  }
}

// ---------------------------------------------------------------------------
// One shift, explained: why, what next, and the knock-on for buying
// ---------------------------------------------------------------------------
export interface ShiftStory {
  /** Each piece of evidence, with whether it backs the shift. */
  evidence: { label: string; detail: string; supports: boolean }[]
  verdict: string
  /**
   * What a normal week looks like for these products, measured on the ten weeks
   * before the shift started. Without this, "up 50%" has nothing to be up
   * against — a series that normally swings ±35% and one that holds ±4% are
   * not telling you the same thing at the same percentage.
   */
  normal: { levelT: number; wobblePct: number; weeks: number }
  /**
   * Week by week: how many of the group's products were unusual, and the gap
   * they add up to. This is what answers "is it spreading" — one product
   * drifting for five weeks and five products moving together in the last two
   * look identical in a single average.
   */
  spread: { week: number; products: number; gapT: number }[]
  widening: boolean
  spreadLabel: string
  /** A price move on an affected material. Not a cause — a cost. */
  priceNote: string | null
  /** Planner's sales in these products, per week: before vs during. */
  orders: { beforePerWeekT: number; duringPerWeekT: number; customers: number; topCustomer: string | null; topSharePct: number } | null
  /** Tonnes per week. */
  actualNow: number
  expectedNow: number
  forecastNow: number
  /** What each decision would do to the forecast, tonnes per week. */
  ifNewTrend: number
  ifOneOff: number
  materials: {
    m: MaterialView
    extraPerWeek: number
    extraCostPerWeekINR: number
    coverDaysNow: number
    /** Cover if the gap continues, same stock. */
    coverDaysAfter: number
    price: PriceDirection | null
  }[]
  /** Chart: weekly sum across the group's products, last 16 weeks. */
  chart: { week: number; actual: number; expected: number | null }[]
}

export function explainShift(ds: Dataset, r: PlanningResult, g: AnomalyGroup, prices: PriceAlert[]): ShiftStory {
  const now = r.todayWeek - 1
  const skuIds = new Set(g.items.map(i => i.skuId))
  const up = g.direction === 'Above forecast'

  // --- orders from the order book for these products in this region
  let orders: ShiftStory['orders'] = null
  const placed = ds.orders.filter(o => o.region === g.region && skuIds.has(o.skuId) && o.orderWeek <= now)
  const firstOrderWeek = Math.min(...ds.orders.map(o => o.orderWeek))
  const beforeWeeks = g.startWeek - firstOrderWeek
  const duringWeeks = now - g.startWeek + 1
  if (placed.length && beforeWeeks >= 3) {
    const during = placed.filter(o => o.orderWeek >= g.startWeek)
    const before = placed.filter(o => o.orderWeek < g.startWeek)
    const byC = new Map<string, number>()
    for (const o of during) byC.set(o.customerId, (byC.get(o.customerId) ?? 0) + o.qtyT)
    const top = [...byC.entries()].sort((a, b) => b[1] - a[1])[0]
    const duringT = sum(during.map(o => o.qtyT))
    orders = {
      beforePerWeekT: sum(before.map(o => o.qtyT)) / beforeWeeks,
      duringPerWeekT: duringT / duringWeeks,
      customers: byC.size,
      topCustomer: top ? ds.customers.find(c => c.id === top[0])?.name ?? null : null,
      topSharePct: top && duringT > 0 ? (top[1] / duringT) * 100 : 0,
    }
  }

  // --- evidence
  const evidence: ShiftStory['evidence'] = []
  if (g.kind === 'Shift') {
    evidence.push({
      label: 'Pattern',
      detail: `${g.sustainedProducts} of ${g.products} products were unusual for 2+ weeks in a row, at the same time.`,
      supports: true,
    })
  } else {
    const singles = g.items.filter(i => i.weeksRunning === 1).length
    evidence.push({
      label: 'Pattern',
      detail: `${singles} of ${g.products} were single weeks, spread over ${g.spanWeeks} weeks rather than together.`,
      supports: false,
    })
  }
  const sig = g.linkedSignalId ? ds.signals.find(s => s.id === g.linkedSignalId) : null
  evidence.push(sig
    ? { label: 'Market signal', detail: `${sig.title} (${sig.sourceType.toLowerCase()}, ${sig.effectPct > 0 ? '+' : ''}${sig.effectPct}% expected).`, supports: true }
    : { label: 'Market signal', detail: 'Nothing in the signal feed explains it.', supports: false })
  if (orders) {
    const chg = orders.beforePerWeekT > 0 ? (orders.duringPerWeekT / orders.beforePerWeekT - 1) * 100 : 0
    const broad = orders.customers >= 3 && orders.topSharePct < 50
    const sameWay = up ? chg > 10 : chg < -10
    evidence.push({
      label: 'Customer orders',
      detail: `${orders.duringPerWeekT.toFixed(1)} t/week booked since it began vs ${orders.beforePerWeekT.toFixed(1)} t/week before (${chg > 0 ? '+' : ''}${chg.toFixed(0)}%), from ${orders.customers} customer${orders.customers === 1 ? '' : 's'}` +
        (orders.topCustomer ? `. Largest: ${orders.topCustomer} at ${orders.topSharePct.toFixed(0)}%.` : '.'),
      supports: sameWay && broad,
    })
    if (sameWay && !broad && orders.topCustomer) {
      evidence.push({ label: 'One customer', detail: `Most of the change is ${orders.topCustomer}. Confirm whether it repeats before treating it as a trend.`, supports: false })
    }
  }

  const backing = evidence.filter(e => e.supports).length
  const ordersLag = orders !== null && !evidence.find(e => e.label === 'Customer orders')?.supports
  const verdict = g.kind === 'Shift'
    ? backing >= 3 ? 'Real change. Pattern, market signal and orders all agree.'
      : backing === 2 ? `Real change. The pattern and ${sig ? 'the market signal' : 'customer orders'} agree${ordersLag ? '; the order book has not caught up yet' : ''}.`
      : 'Possible change. Only the sales pattern shows it so far. Watch one more week.'
    : 'Normal ups and downs, not a trend.'

  // --- what a normal week looked like before any of this started
  // Volume-weighted, so a tiny product with a wild percentage cannot set the
  // "normal wobble" for a group that is mostly one large one.
  let wobNum = 0, wobDen = 0
  for (const i of g.items) {
    const y = ds.demand.find(d => d.skuId === i.skuId && d.region === i.region)?.weeks ?? []
    const win = y.slice(Math.max(0, g.startWeek - 10), g.startWeek).filter(v => v > 0)
    if (win.length < 4) continue
    const m = mean(win)
    if (m <= 0) continue
    wobNum += (stdev(win) / m) * i.expected
    wobDen += i.expected
  }

  // --- is it spreading? products involved in each week since it began
  const spread: ShiftStory['spread'] = []
  for (let w = g.startWeek; w <= now; w++) {
    const inside = g.items.filter(i => w >= i.startWeek && w < i.startWeek + i.weeksRunning)
    spread.push({
      week: w,
      products: inside.length,
      gapT: +sum(inside.map(i => i.deltaT)).toFixed(1),
    })
  }
  const firstWk = spread[0]?.products ?? 0
  const lastWk = spread[spread.length - 1]?.products ?? 0
  const widening = spread.length >= 2 && lastWk > firstWk
  const spreadLabel = spread.length < 2
    ? `One week so far, ${lastWk} product${lastWk === 1 ? '' : 's'}.`
    : widening
      ? `Spreading: ${firstWk} product${firstWk === 1 ? '' : 's'} in the first week, ${lastWk} now.`
      : lastWk < firstWk
        ? `Narrowing: ${firstWk} product${firstWk === 1 ? '' : 's'} in the first week, ${lastWk} now.`
        : `Holding steady at about ${lastWk} product${lastWk === 1 ? '' : 's'} a week.`

  // --- levels, tonnes per week, across the group's products in this region
  const actualNow = sum(g.items.map(i => i.actual))
  const expectedNow = sum(g.items.map(i => i.expected))
  let forecastNow = 0
  for (const id of skuIds) {
    const f = r.skuForecasts.find(x => x.skuId === id)
    if (f) forecastNow += mean(f.byRegion[g.region].slice(0, 4))
  }
  const ifNewTrend = up ? Math.max(0, actualNow - forecastNow) : Math.min(0, actualNow - forecastNow)
  const ifOneOff = up ? Math.min(0, expectedNow - forecastNow) : Math.max(0, expectedNow - forecastNow)

  // --- knock-on for materials: extra need per week if the gap holds
  const need = new Map<string, number>()
  for (const i of g.items) for (const b of ds.bom[i.skuId] ?? []) {
    need.set(b.materialId, (need.get(b.materialId) ?? 0) + i.deltaT * b.qtyPerTonne)
  }
  const materials = [...need.entries()]
    .map(([id, extraPerWeek]) => {
      const m = r.materials.find(x => x.materialId === id)
      if (!m) return null
      const daily = m.dailyUsage + extraPerWeek / 7
      const p = prices.find(x => x.materialId === id)
      return {
        m, extraPerWeek, extraCostPerWeekINR: extraPerWeek * m.costPerUnit,
        coverDaysNow: m.inv.daysOfCover,
        coverDaysAfter: daily > 0 ? clamp(m.onHand / daily, 0, 999) : m.inv.daysOfCover,
        price: p ? p.direction : null,
      }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => Math.abs(b.extraCostPerWeekINR) - Math.abs(a.extraCostPerWeekINR))
    .slice(0, 6)

  // --- chart: summed across the group, only weeks that have happened
  const series = g.items.map(i => ({ i, y: ds.demand.find(d => d.skuId === i.skuId && d.region === i.region)?.weeks ?? [] }))
  const from = Math.max(0, now - 15)
  const chart: ShiftStory['chart'] = []
  for (let w = from; w <= now; w++) {
    let a = 0, e = 0, inside = false
    for (const { i, y } of series) {
      a += y[w] ?? 0
      const inEp = w >= i.startWeek && w < i.startWeek + i.weeksRunning
      e += inEp ? i.expected : (y[w] ?? 0)
      inside ||= inEp
    }
    chart.push({ week: w, actual: +a.toFixed(1), expected: inside ? +e.toFixed(1) : null })
  }

  // --- a price move on something this shift needs more of
  // Deliberately kept out of `evidence`: a rising index is not a reason demand
  // moved, it is what the move costs. Filing it as evidence would have the UI
  // tick or cross it as if it explained something.
  const moving = materials.find(x => x.price === 'Rising' || x.price === 'Easing')
  const priceNote = !moving ? null
    : `${moving.m.name} is ${moving.price!.toLowerCase()}` +
      (up && moving.price === 'Rising'
        ? `, and this shift needs ${fmtQty(Math.abs(moving.extraPerWeek), moving.m.unit)} more of it a week. Buying later costs more than buying now.`
        : up
          ? `, which takes some of the cost out of covering the extra ${fmtQty(Math.abs(moving.extraPerWeek), moving.m.unit)} a week.`
          : moving.price === 'Rising'
            ? `, so needing ${fmtQty(Math.abs(moving.extraPerWeek), moving.m.unit)} less of it a week is worth more than the tonnage suggests.`
            : `, and this shift needs less of it. Nothing to act on.`)

  return {
    evidence, verdict, orders, actualNow, expectedNow, forecastNow, ifNewTrend, ifOneOff,
    materials, chart, spread, widening, spreadLabel, priceNote,
    normal: {
      levelT: +expectedNow.toFixed(1),
      wobblePct: wobDen > 0 ? +((wobNum / wobDen) * 100).toFixed(1) : 0,
      weeks: 10,
    },
  }
}

/** Weeks-based wording for how fast something was spotted. */
export function spottedText(weeks: number): string {
  return weeks <= 0 ? 'same week' : `${weeks} wk${weeks === 1 ? '' : 's'}`
}
