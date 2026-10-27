/**
 * Read-only views for Health and Exceptions: the week in a sentence, where the
 * money is sitting, and what the queue is actually made of.
 *
 * Same rule as `insights.ts` — nothing here invents a number. Every figure is
 * derived from the dataset, the `PlanningResult`, or the one exception list that
 * `selectExceptions()` returns, so a figure on Health cannot disagree with the
 * screen it links to.
 *
 * `rankQueue()` is the reason both screens name the same item as the one to do
 * first. Health used to show `queue.slice(0, 7)` in engine order while
 * Exceptions sorted its own way, so the two screens could each nominate a
 * different "most urgent" thing from the same list.
 */
import type { Dataset } from '@/data/types'
import type { PlanningResult, WorkbenchItem, MaterialView } from './index'
import type { StockStatus } from './inventory'
import { REPLAY_WEEKS } from './replay'
import { fmtINRShort, fmtQty, sum } from '@/lib/format'
import { isOverdue, isDueToday, needsActionToday } from './selectors'

type Severity = WorkbenchItem['severity']

const SEV_RANK: Record<Severity, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 }

export const STOCK_STATUSES: StockStatus[] = ['Stockout risk', 'Reorder now', 'Healthy', 'Excess']

/** Spend is a positive value, cash released is a negative one. See the workbench. */
const spendOf = (items: WorkbenchItem[]) => items.reduce((s, w) => s + Math.max(0, w.valueINR), 0)
const releaseOf = (items: WorkbenchItem[]) => items.reduce((s, w) => s + Math.max(0, -w.valueINR), 0)

/**
 * The queue in the order a person should work it: anything past its date first,
 * then by severity, then by how soon it is due, then by what it is worth.
 */
export function rankQueue(items: WorkbenchItem[]): WorkbenchItem[] {
  return [...items].sort((a, b) =>
    Number(isOverdue(b.dueInDays)) - Number(isOverdue(a.dueInDays)) ||
    SEV_RANK[a.severity] - SEV_RANK[b.severity] ||
    a.dueInDays - b.dueInDays ||
    Math.abs(b.valueINR) - Math.abs(a.valueINR))
}

// ---------------------------------------------------------------------------
// Health: the week in a sentence
// ---------------------------------------------------------------------------
export interface Fact { k: string; v: string; sub?: string }

export interface WeekBrief {
  /** The position, stated plainly. */
  headline: string
  /** What to do about it, naming the one thing to start with. */
  verdict: string
  facts: Fact[]
  firstToDo: WorkbenchItem | null
  /** The material with the least room left, whatever its status. */
  tightest: MaterialView | null
  /** Past its date. */
  overdue: number
  /** Due today, and not already past. */
  today: number
  /** Past its date or due today — what a person has to look at before going home. */
  overdueToday: number
}

export function weekBrief(ds: Dataset, r: PlanningResult, queue: WorkbenchItem[]): WeekBrief {
  const k = r.kpis
  const ranked = rankQueue(queue)
  const firstToDo = ranked[0] ?? null
  const overdue = queue.filter(w => isOverdue(w.dueInDays)).length
  const today = queue.filter(w => isDueToday(w.dueInDays)).length
  const spend = spendOf(queue)
  const release = releaseOf(queue)

  // Least headroom = fewest days left before the order-by date passes. A
  // material already past it is the most pressing, so negatives sort first.
  const tightest = [...r.materials]
    .filter(m => m.inv.status === 'Stockout risk' || m.inv.status === 'Reorder now')
    .sort((a, b) => a.inv.orderByDays - b.inv.orderByDays)[0] ?? null

  const headline = queue.length === 0
    ? `Nothing is waiting on a decision. ${k.materialsAtRisk} material${k.materialsAtRisk === 1 ? '' : 's'} need attention and ${k.excessCount} ${k.excessCount === 1 ? 'is' : 'are'} overstocked, but neither has crossed a line yet.`
    : `${queue.length} decision${queue.length === 1 ? '' : 's'} waiting${overdue ? `, ${overdue} already past the date` : ''}. ` +
      `${k.materialsAtRisk} material${k.materialsAtRisk === 1 ? '' : 's'} need attention, ${k.excessCount} ${k.excessCount === 1 ? 'is' : 'are'} overstocked, ` +
      `and the forecast is running at ${k.forecastAccuracyPct.toFixed(1)}% against ${k.spreadsheetAccuracyPct.toFixed(1)}% for the old method.`

  const verdict = !firstToDo
    ? 'Nothing needs a person today.'
    : `Start with ${firstToDo.subject} — ${firstToDo.recommendedAction.replace(/\.$/, '')}.` +
      (overdue > 1 ? ` ${overdue - 1} other${overdue - 1 === 1 ? '' : 's'} ${overdue - 1 === 1 ? 'is' : 'are'} also past the date.` : '')

  const net = release - spend
  const facts: Fact[] = [
    {
      k: 'Needs a person today',
      v: String(queue.filter(w => needsActionToday(w.dueInDays)).length),
      sub: `${overdue} overdue · ${today} due today · ${queue.length} in total`,
    },
    {
      k: net >= 0 ? 'Net cash released' : 'Net cash needed',
      v: fmtINRShort(Math.abs(net)),
      sub: `${fmtINRShort(release)} to release, ${fmtINRShort(spend)} to spend`,
    },
    tightest
      ? {
        k: 'Least room left',
        v: tightest.name,
        sub: tightest.inv.orderByDays < 0
          ? `order-by date passed ${Math.abs(Math.round(tightest.inv.orderByDays))} days ago`
          : `${Math.round(tightest.inv.orderByDays)} days left to order`,
      }
      : { k: 'Least room left', v: 'None', sub: 'every material can still be ordered in time' },
  ]

  return {
    headline, verdict, facts, firstToDo, tightest, overdue, today,
    overdueToday: queue.filter(w => needsActionToday(w.dueInDays)).length,
  }
}

// ---------------------------------------------------------------------------
// Health: where the stock value sits
// ---------------------------------------------------------------------------
export interface StockRung {
  status: StockStatus
  count: number
  valueINR: number
  sharePct: number
  /** Materials in this rung, worst first. */
  items: MaterialView[]
}

export function stockLadder(r: PlanningResult): StockRung[] {
  const total = sum(r.materials.map(m => m.inv.stockValue)) || 1
  return STOCK_STATUSES.map(status => {
    const items = r.materials
      .filter(m => m.inv.status === status)
      .sort((a, b) => a.inv.daysOfCover - b.inv.daysOfCover)
    const valueINR = Math.round(sum(items.map(m => m.inv.stockValue)))
    return {
      status, items, valueINR,
      count: items.length,
      sharePct: +((valueINR / total) * 100).toFixed(1),
    }
  }).filter(x => x.count > 0)
}

export interface CoverBand { name: string; n: number; valueINR: number }

const COVER_BANDS: { name: string; has: (d: number) => boolean }[] = [
  { name: 'Under 7 d', has: d => d < 7 },
  { name: '7–14 d', has: d => d >= 7 && d < 14 },
  { name: '14–30 d', has: d => d >= 14 && d < 30 },
  { name: '30–60 d', has: d => d >= 30 && d < 60 },
  { name: '60 d +', has: d => d >= 60 },
]

/** How the 40 materials spread across days of cover, by count and by value. */
export function coverBands(r: PlanningResult): CoverBand[] {
  return COVER_BANDS.map(b => {
    const items = r.materials.filter(m => b.has(m.inv.daysOfCover))
    return { name: b.name, n: items.length, valueINR: Math.round(sum(items.map(m => m.inv.stockValue))) }
  })
}

// ---------------------------------------------------------------------------
// Health: the cash position
// ---------------------------------------------------------------------------
export interface CashLine { name: string; valueINR: number; note: string; linkId: string }

export interface CashPosition {
  spendINR: number
  releaseINR: number
  netINR: number
  buys: CashLine[]
  releases: CashLine[]
}

export function cashPosition(ds: Dataset, r: PlanningResult): CashPosition {
  const line = (x: typeof r.recommendations[number]): CashLine => ({
    name: x.materialName,
    valueINR: Math.abs(x.valueINR),
    note: x.valueINR > 0
      ? `${fmtQty(x.qty, x.unit)} from ${x.supplierName.split('—')[0].trim()}`
      : `${Math.round(r.materials.find(m => m.materialId === x.materialId)?.inv.daysOfCover ?? 0)} days of cover`,
    linkId: `/buy?r=${x.materialCode}`,
  })
  const buys = r.recommendations.filter(x => x.valueINR > 0)
    .sort((a, b) => b.valueINR - a.valueINR).map(line)
  const releases = r.recommendations.filter(x => x.valueINR < 0)
    .sort((a, b) => a.valueINR - b.valueINR).map(line)
  return {
    spendINR: r.kpis.recommendedSpendINR,
    releaseINR: r.kpis.cashFreedINR,
    netINR: r.kpis.cashFreedINR - r.kpis.recommendedSpendINR,
    buys, releases,
  }
}

// ---------------------------------------------------------------------------
// Health: how this run compares with the old way
// ---------------------------------------------------------------------------
export interface ScoreRow {
  k: string
  before: string
  after: string
  /** Which column is the better outcome, so the UI never has to guess. */
  better: 'before' | 'after'
}

export function scorecard(r: PlanningResult): { rows: ScoreRow[]; trade: string; ratio: number } {
  const b = r.replay.before, a = r.replay.after, d = r.replay.deltas
  const rows: ScoreRow[] = [
    { k: 'Weeks a material ran short', before: String(b.totalStockouts), after: String(a.totalStockouts), better: 'after' },
    { k: 'Materials affected', before: String(b.materialsWithStockout), after: String(a.materialsWithStockout), better: 'after' },
    { k: 'Line-stop days', before: String(b.lineStopDays), after: String(a.lineStopDays), better: 'after' },
    { k: 'Demand met, by value', before: `${b.serviceLevelPct.toFixed(1)}%`, after: `${a.serviceLevelPct.toFixed(1)}%`, better: 'after' },
    { k: 'Production stopped', before: fmtINRShort(b.productionStoppedINR), after: fmtINRShort(a.productionStoppedINR), better: 'after' },
    { k: 'Average stock held', before: fmtINRShort(b.avgInventoryValueINR), after: fmtINRShort(a.avgInventoryValueINR), better: 'before' },
    { k: 'Storage cost', before: fmtINRShort(b.storageCostINR), after: fmtINRShort(a.storageCostINR), better: 'before' },
    { k: 'Signal to order', before: `${b.signalToOrderDays} days`, after: `${a.signalToOrderDays} days`, better: 'after' },
  ]
  const ratio = d.extraHoldingCostINR > 0
    ? Math.round(d.productionProtectedINR / d.extraHoldingCostINR) : 0
  const trade = d.extraHoldingCostINR > 0
    ? `Holding more stock costs ${fmtINRShort(Math.abs(d.extraHoldingCostINR))} more over the ${REPLAY_WEEKS} weeks, and protects ${fmtINRShort(d.productionProtectedINR)} of production the old method could not make — about ${ratio}× the cost. It does not win on inventory, and that is the trade.`
    : 'This run holds no more stock than the old method did.'
  return { rows, trade, ratio }
}

// ---------------------------------------------------------------------------
// Exceptions: what the queue is made of
// ---------------------------------------------------------------------------
export interface QueueBrief {
  headline: string
  verdict: string
  overdue: number
  today: number
  spendINR: number
  releaseINR: number
  /** Items whose confidence is below 60 — worth a human look before accepting. */
  lowConfidence: number
  firstToDo: WorkbenchItem | null
}

export function queueBrief(items: WorkbenchItem[]): QueueBrief {
  const ranked = rankQueue(items)
  const firstToDo = ranked[0] ?? null
  const overdue = items.filter(w => isOverdue(w.dueInDays)).length
  const today = items.filter(w => isDueToday(w.dueInDays)).length
  const critical = items.filter(w => w.severity === 'Critical').length
  const lowConfidence = items.filter(w => w.confidence < 60).length
  const spendINR = spendOf(items)
  const releaseINR = releaseOf(items)

  const headline = items.length === 0
    ? 'The queue is clear. Nothing is waiting on a decision.'
    : `${items.length} item${items.length === 1 ? '' : 's'} waiting, ` +
      `${overdue + today} of them needing a person today` +
      (critical ? ` and ${critical} rated critical` : '') + '. ' +
      `${fmtINRShort(spendINR)} of spend and ${fmtINRShort(releaseINR)} of releasable cash sit behind them.`

  const verdict = !firstToDo
    ? 'Nothing needs a person today.'
    : `${firstToDo.subject} first — ${firstToDo.recommendedAction.replace(/\.$/, '')}` +
      (isOverdue(firstToDo.dueInDays)
        ? `, ${Math.abs(Math.round(firstToDo.dueInDays))} days past its date.`
        : '.') +
      (lowConfidence ? ` ${lowConfidence} item${lowConfidence === 1 ? '' : 's'} below 60% confidence — read the reasoning before accepting ${lowConfidence === 1 ? 'it' : 'those'}.` : '')

  return { headline, verdict, overdue, today, spendINR, releaseINR, lowConfidence, firstToDo }
}

/**
 * Subjects that turn up more than once.
 *
 * One material generating an Order-now, an Expedite and an Unusual-demand entry
 * is three rows in the queue but one conversation with one supplier. Rolling
 * them up is what turns a list into a plan for the morning.
 */
export interface RepeatSubject {
  subject: string
  subjectId: string
  subjectKind: WorkbenchItem['subjectKind']
  linkId: string
  items: WorkbenchItem[]
  queues: string[]
  worst: Severity
  valueINR: number
  soonestDays: number
}

export function repeatSubjects(items: WorkbenchItem[]): RepeatSubject[] {
  const by = new Map<string, WorkbenchItem[]>()
  for (const w of items) by.set(w.subjectId, [...(by.get(w.subjectId) ?? []), w])

  const out: RepeatSubject[] = []
  for (const group of by.values()) {
    if (group.length < 2) continue
    const ranked = rankQueue(group)
    const lead = ranked[0]
    out.push({
      subject: lead.subject, subjectId: lead.subjectId, subjectKind: lead.subjectKind,
      linkId: lead.linkId, items: ranked,
      queues: [...new Set(ranked.map(w => w.queue))],
      worst: ranked.reduce((a, b) => (SEV_RANK[b.severity] < SEV_RANK[a.severity] ? b : a)).severity,
      valueINR: group.reduce((s, w) => s + Math.abs(w.valueINR), 0),
      soonestDays: Math.min(...group.map(w => w.dueInDays)),
    })
  }
  return out.sort((a, b) =>
    SEV_RANK[a.worst] - SEV_RANK[b.worst] ||
    b.items.length - a.items.length ||
    b.valueINR - a.valueINR)
}

export interface QueueValue { name: string; spend: number; release: number; n: number }

/** Spend and release per queue, so the two never net each other out in a bar. */
export function valueByQueue(items: WorkbenchItem[]): QueueValue[] {
  const names = [...new Set(items.map(w => w.queue))].sort()
  return names.map(name => {
    const mine = items.filter(w => w.queue === name)
    return {
      name,
      n: mine.length,
      spend: Math.round(spendOf(mine)),
      release: Math.round(releaseOf(mine)),
    }
  }).filter(x => x.spend + x.release > 0)
}

export interface ConfidenceBand { name: string; n: number }

const CONF_BANDS: { name: string; has: (c: number) => boolean }[] = [
  { name: 'Under 60%', has: c => c < 60 },
  { name: '60–79%', has: c => c >= 60 && c < 80 },
  { name: '80–89%', has: c => c >= 80 && c < 90 },
  { name: '90% +', has: c => c >= 90 },
]

export function confidenceBands(items: WorkbenchItem[]): ConfidenceBand[] {
  return CONF_BANDS.map(b => ({ name: b.name, n: items.filter(w => b.has(w.confidence)).length }))
}
