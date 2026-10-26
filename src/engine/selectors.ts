/**
 * Every number the screens display, derived in exactly one place.
 *
 * `runPlanning()` was already the only calculation in the app, but the screens
 * were each re-deriving their own aggregates from its output — and two of them
 * invented definitions outright. That is how one dashboard ended up showing
 * three different service levels, two purchase-spend figures and four counts of
 * "late".
 *
 * The rule from here: a screen may filter and format, but it may not define.
 * If a number appears on more than one screen, it is defined here and nowhere
 * else.
 */
import type { Dataset, PurchaseOrder, POStatus } from '@/data/types'
import type { PlanningResult, WorkbenchItem } from './index'
import { groupAnomalies, type Anomaly, type AnomalyGroup, type AnomalyStatus } from './anomaly'

export type { AnomalyGroup }

/**
 * An order approved inside this session. Declared structurally rather than
 * imported from the store, because the store imports the engine.
 */
export interface ApprovalRow {
  recommendationId: string
  poId: string
  materialId: string
  qty: number
  supplierId: string
  valueINR: number
  approvedBy: string
  note: string
}

// ---------------------------------------------------------------------------
// Due dates — one rule, used by every list, chart, chip and badge
// ---------------------------------------------------------------------------

/**
 * The order-by date has passed. Strictly in the past: something due *today* is
 * urgent but not yet missed, and calling it "overdue" costs the word its
 * meaning on the day it matters most.
 *
 * The Exceptions due-chart used to bucket on `< 0` while the rows next to it
 * labelled on `<= 0`, so everything due today vanished between the two.
 */
export const isOverdue = (dueInDays: number) => dueInDays < 0
export const isDueToday = (dueInDays: number) => Math.round(dueInDays) === 0
/** Needs a person today: overdue or due today. */
export const needsActionToday = (dueInDays: number) => dueInDays <= 0

export const DUE_BUCKETS: { name: string; has: (d: number) => boolean }[] = [
  { name: 'Overdue', has: d => d < 0 },
  { name: 'Today', has: d => Math.round(d) === 0 },
  { name: '2-3 days', has: d => d > 0 && d < 4 },
  { name: 'This week', has: d => d >= 4 && d < 8 },
  { name: 'Next week', has: d => d >= 8 && d < 15 },
  { name: 'Later', has: d => d >= 15 },
]

// ---------------------------------------------------------------------------
// The exception queue
// ---------------------------------------------------------------------------

/**
 * Recommendations already decided in this session.
 *
 * The engine cannot know about these — approvals and rejections live in the
 * store — so anything counting open work has to subtract them. Without this,
 * approving a purchase left the sidebar badge, the Health rail and the
 * exception queue all still counting it.
 */
export function selectDecidedRecIds(
  approvals: ApprovalRow[], rejected: Record<string, string>,
): Set<string> {
  const out = new Set<string>()
  for (const a of approvals) out.add(a.recommendationId)
  for (const id of Object.keys(rejected)) out.add(id)
  return out
}

/** Recommendations still waiting on a person. */
export function selectOpenRecommendations(
  r: PlanningResult, approvals: ApprovalRow[], rejected: Record<string, string>,
) {
  const decided = selectDecidedRecIds(approvals, rejected)
  return r.recommendations.filter(x => !decided.has(x.id))
}

export function selectOpenRecommendationCount(
  r: PlanningResult, approvals: ApprovalRow[], rejected: Record<string, string>,
): number {
  return selectOpenRecommendations(r, approvals, rejected).length
}

/**
 * The one list. Sidebar badge, Health, Exceptions and every chart read this.
 *
 * `decidedRecIds` drops the queue entries whose recommendation has already been
 * approved or rejected, so acting on something makes it leave every count at
 * once rather than only the screen it was actioned on.
 */
export function selectExceptions(
  r: PlanningResult, dismissed: string[] = [], decidedRecIds?: Set<string>,
): WorkbenchItem[] {
  const skip = new Set(dismissed)
  if (!skip.size && !decidedRecIds?.size) return r.workbench
  return r.workbench.filter(w =>
    !skip.has(w.id) && !decidedRecIds?.has(w.id.replace(/^WB-/, '')))
}

/** Due-date histogram, built from the same list that renders — never re-filtered. */
export function selectDueBuckets(items: WorkbenchItem[]) {
  return DUE_BUCKETS.map(b => ({ name: b.name, n: items.filter(w => b.has(w.dueInDays)).length }))
}

/** Queue histogram, likewise. Returns only queues that actually have members. */
export function selectQueueCounts(items: WorkbenchItem[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const w of items) out[w.queue] = (out[w.queue] ?? 0) + 1
  return out
}

/** Total value at stake across the queue — spend and release both count. */
export function selectValueAtStakeINR(items: WorkbenchItem[]): number {
  return items.reduce((s, w) => s + Math.abs(w.valueINR), 0)
}

// ---------------------------------------------------------------------------
// Late
// ---------------------------------------------------------------------------

/**
 * Materials whose order-by date has already passed.
 *
 * Plan counted *planned order rows* (hundreds, several per material),
 * Recommendations counted materials, and Exceptions counted queue items — three
 * honest numbers answering three different questions, printed as if they were
 * one. Materials is the useful unit: it is what a buyer acts on.
 */
export function selectLateMaterialIds(r: PlanningResult): Set<string> {
  return new Set(r.recommendations.filter(x => isOverdue(x.orderByDays)).map(x => x.materialId))
}

export function selectLateCount(r: PlanningResult): number {
  return selectLateMaterialIds(r).size
}

/** Planned-order rows already past their release week. Labelled as rows, not materials. */
export function selectLatePlannedOrderCount(r: PlanningResult): number {
  return r.mrp.plannedOrders.filter(p => p.late).length
}

// ---------------------------------------------------------------------------
// Money and service
// ---------------------------------------------------------------------------

/**
 * The single service-level definition: the replay's fill rate by value over the
 * last 16 weeks. `scenario.ts` used to invent its own from a formula with no
 * connection to any simulation, which is where Simulate's 92.7% came from.
 */
export const selectServiceLevelPct = (r: PlanningResult) => r.replay.after.serviceLevelPct

/** What the open buy recommendations would cost. */
export const selectPurchaseSpendINR = (r: PlanningResult) => r.kpis.recommendedSpendINR

/** What the reduce/delay recommendations would release. */
export const selectCashFreedINR = (r: PlanningResult) => r.kpis.cashFreedINR

/**
 * Net cash. Positive means money comes back.
 *
 * Buy showed `spend - freed`, so releasing more than it spent printed as
 * "−₹22.80 Cr" — a cash inflow wearing a minus sign.
 */
export const selectNetCashINR = (r: PlanningResult) => selectCashFreedINR(r) - selectPurchaseSpendINR(r)

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

const CLOSED: POStatus[] = ['Received', 'Cancelled']

/**
 * Every purchase order, including the ones approved in this session.
 *
 * Health counted only the generated order book while the Orders page counted
 * that plus local approvals, so approving anything made the two disagree.
 */
export function selectAllOrders(ds: Dataset, r: PlanningResult, approvals: ApprovalRow[]): PurchaseOrder[] {
  const extra: PurchaseOrder[] = approvals.map(a => {
    const rec = r.recommendations.find(x => x.id === a.recommendationId)
    return {
      id: a.poId, supplierId: a.supplierId, materialId: a.materialId, qty: a.qty,
      pricePerUnit: rec?.pricePerUnit ?? 0, valueINR: a.valueINR,
      orderWeek: r.todayWeek,
      promisedWeek: rec?.expectedArrivalWeek ?? r.todayWeek + 2,
      expectedWeek: rec?.expectedArrivalWeek ?? r.todayWeek + 2,
      neededWeek: rec?.neededByWeek ?? r.todayWeek + 3,
      status: 'Approved', receivedPct: 0, payment: 'Pending',
      linkedRecommendationId: a.recommendationId, raisedBy: a.approvedBy, note: a.note,
    }
  })
  return [...extra, ...ds.purchaseOrders]
}

export function selectOpenOrders(ds: Dataset, r: PlanningResult, approvals: ApprovalRow[]): PurchaseOrder[] {
  return selectAllOrders(ds, r, approvals).filter(p => !CLOSED.includes(p.status))
}

/** An order is late when it lands after the week it is needed, not after the promise. */
export const orderIsLate = (p: PurchaseOrder) => p.expectedWeek > p.neededWeek
export const orderDaysEarly = (p: PurchaseOrder) => (p.neededWeek - p.expectedWeek) * 7

// ---------------------------------------------------------------------------
// Anomalies
// ---------------------------------------------------------------------------

/** Open anomalies, collapsed into the market shifts a planner decides on. */
export function selectAnomalyGroups(r: PlanningResult, status: AnomalyStatus | 'All' = 'Open'): AnomalyGroup[] {
  const pool = status === 'All' ? r.anomalies : r.anomalies.filter(a => a.status === status)
  return groupAnomalies(pool)
}

export function selectOpenAnomalyGroupCount(r: PlanningResult): number {
  return selectAnomalyGroups(r, 'Open').length
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/**
 * Who may commit money.
 *
 * The planner recommends and the buyer approves — that separation is the point
 * of the Recommendations screen, so it is defined once rather than re-tested in
 * each component.
 */
export type RoleName = 'Planner' | 'Buyer' | 'Manager'
export const canApprove = (role: RoleName) => role === 'Buyer' || role === 'Manager'
export const roleHint = (role: RoleName) =>
  canApprove(role) ? '' : 'Switch role to Buyer to approve'

export type { Anomaly }
