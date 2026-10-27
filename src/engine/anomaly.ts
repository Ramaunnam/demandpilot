/**
 * Anomaly detection (capability K2).
 *
 * The idea in one line: work out what each week *should* have looked like from the
 * weeks around it, then flag the weeks that are further away from that than normal.
 * We use a rolling z-score, which is just "how many typical wobbles away is this?".
 *
 * The planner sets the threshold, so they decide how twitchy the system is.
 */
import { mean, stdev, clamp } from '@/lib/format'
import type { RegionName, Grade } from '@/data/types'

export type AnomalySeverity = 'Low' | 'Medium' | 'High'
export type AnomalyStatus = 'Open' | 'Accepted as new trend' | 'Ignored as one-off' | 'Investigating'

export interface Anomaly {
  id: string
  skuId: string
  skuCode: string
  grade: Grade
  region: RegionName
  /** Week the unusual demand began. */
  startWeek: number
  /** Week our check first had enough evidence to flag it. */
  detectedWeek: number
  /** Whole weeks between the start and the flag. 0 = flagged at the close of the week it began. */
  detectedAfterWeeks: number
  /** detectedAfterWeeks × 7. The data is weekly, so this is never a finer number than that. */
  detectedAfterDays: number
  weeksRunning: number
  expected: number
  actual: number
  deltaT: number
  deltaPct: number
  zScore: number
  severity: AnomalySeverity
  direction: 'Above forecast' | 'Below forecast'
  status: AnomalyStatus
  likelyCause: string
  linkedSignalId: string | null
  /** Materials this SKU pulls, so we can show the knock-on effect. */
  affectedMaterialIds: string[]
  impactT: number
  impactINR: number
  suggestedAction: string
}

export interface AnomalyInput {
  skuId: string
  skuCode: string
  grade: Grade
  region: RegionName
  history: number[]
  pricePerT: number
  materialIds: string[]
  /** Signals that apply to this SKU/region, used to explain the cause. */
  signals: { id: string; week: number; title: string; effectPct: number }[]
  threshold: number
  /** Weeks already decided on, so a resolved anomaly stays resolved. */
  resolutions: Record<string, AnomalyStatus>
}

const WINDOW = 10        // weeks used to work out "normal"
const MIN_LEVEL = 6.0    // ignore small series, where a few tonnes look dramatic in percentage terms
const LOOKBACK = 16      // only look at the recent past — older episodes are history, not a work queue
const MAX_ZERO_SHARE = 0.3 // a series that is mostly zeros is lumpy, not anomalous

/**
 * Expected value for week t: a robust average of the preceding weeks,
 * adjusted for the same week last year if we have it.
 */
function expectedAt(y: number[], t: number): { exp: number; sd: number } {
  const from = Math.max(0, t - WINDOW)
  const win = y.slice(from, t).filter(v => v > 0)
  if (win.length < 4) return { exp: mean(y.slice(from, t)), sd: stdev(y.slice(from, t)) }

  const base = mean(win)
  const sd = Math.max(stdev(win), base * 0.06)

  // Lift the expectation by the year-on-year seasonal shape where we have it
  const lastYear = t - 52
  if (lastYear - 4 >= 0 && t - 52 + 1 < y.length) {
    const lyWin = mean(y.slice(Math.max(0, lastYear - 4), lastYear + 1).filter(v => v > 0))
    const lyNow = y[lastYear]
    if (lyWin > 0 && lyNow > 0) {
      const seasonalRatio = clamp(lyNow / lyWin, 0.6, 1.6)
      return { exp: base * seasonalRatio, sd }
    }
  }
  return { exp: base, sd }
}

export function detectAnomalies(inp: AnomalyInput): Anomaly[] {
  const y = inp.history
  const out: Anomaly[] = []

  // Three gates before we even look. Each one removes a class of false alarm
  // that would otherwise swamp the planner's queue.
  const recent = y.slice(-Math.min(LOOKBACK, y.length))
  if (mean(recent) < MIN_LEVEL) return out                                  // too small to matter
  if (recent.filter(v => v <= 0.0001).length / recent.length > MAX_ZERO_SHARE) return out  // lumpy, not unusual

  const flags: boolean[] = new Array(y.length).fill(false)
  const zs: number[] = new Array(y.length).fill(0)
  const exps: number[] = new Array(y.length).fill(0)

  const from = Math.max(WINDOW, y.length - LOOKBACK)
  for (let t = from; t < y.length; t++) {
    const { exp, sd } = expectedAt(y, t)
    exps[t] = exp
    const z = sd > 0 ? (y[t] - exp) / sd : 0
    zs[t] = z
    flags[t] = Math.abs(z) >= inp.threshold
  }

  // Group consecutive (or near-consecutive) flagged weeks into one episode
  let t = from
  let n = 0
  while (t < y.length) {
    if (!flags[t]) { t++; continue }
    const dir = zs[t] > 0 ? 1 : -1
    let end = t
    for (let k = t + 1; k < y.length; k++) {
      if (flags[k] && Math.sign(zs[k]) === dir) { end = k; continue }
      if (!flags[k] && k - end <= 1 && Math.abs(zs[k]) >= inp.threshold * 0.65) { end = k; continue }
      break
    }

    const weeks = end - t + 1
    const actual = mean(y.slice(t, end + 1))
    const expected = mean(exps.slice(t, end + 1))
    const deltaT = actual - expected
    const deltaPct = expected > 0 ? (deltaT / expected) * 100 : 0
    const peakZ = Math.max(...zs.slice(t, end + 1).map(Math.abs))

    // Only call it an anomaly if it is statistically odd, commercially material, and
    // measured against a baseline large enough for a percentage to mean anything.
    // Without that last test a week that went from 0.2 t to 2 t reads as "+900%".
    if (expected >= MIN_LEVEL * 0.5 &&
        Math.abs(deltaPct) >= 14 && Math.abs(deltaPct) <= 300 &&
        Math.abs(deltaT) * weeks >= 2.5) {
      n++
      // A single week needs a stronger signal to be believed; two weeks is enough on its own.
      const detectedWeek = weeks >= 2 ? t + 1 : t
      const severity: AnomalySeverity =
        peakZ >= inp.threshold * 1.6 && weeks >= 2 ? 'High' :
        peakZ >= inp.threshold * 1.15 || weeks >= 3 ? 'Medium' : 'Low'

      const sig = inp.signals
        .filter(s => s.week <= t && s.week >= t - 8 && Math.sign(s.effectPct) === Math.sign(deltaPct))
        .sort((a, b) => b.week - a.week)[0] ?? null

      const id = `AN-${inp.skuId}-${inp.region}-${t}`
      const impactT = Math.abs(deltaT) * weeks
      out.push({
        id, skuId: inp.skuId, skuCode: inp.skuCode, grade: inp.grade, region: inp.region,
        startWeek: t, detectedWeek,
        // Weekly data: we know the week, not the day. (This used to add a fixed
        // "+3 days", which read as a measurement but was a constant.)
        detectedAfterWeeks: detectedWeek - t,
        detectedAfterDays: (detectedWeek - t) * 7,
        weeksRunning: weeks,
        expected: +expected.toFixed(1), actual: +actual.toFixed(1),
        deltaT: +deltaT.toFixed(1), deltaPct: +deltaPct.toFixed(1),
        zScore: +peakZ.toFixed(2), severity,
        direction: deltaPct > 0 ? 'Above forecast' : 'Below forecast',
        status: inp.resolutions[id] ?? 'Open',
        likelyCause: sig
          ? sig.title
          : 'No matching market signal found.',
        linkedSignalId: sig?.id ?? null,
        affectedMaterialIds: inp.materialIds,
        impactT: +impactT.toFixed(1),
        impactINR: Math.round(impactT * inp.pricePerT),
        suggestedAction: deltaPct > 0
          ? (weeks >= 2
              ? 'Looks like a real step-up. Accept it as the new trend so the forecast, material needs and reorder levels all move together.'
              : 'Single week only. Watch one more week before changing the baseline.')
          : (weeks >= 2
              ? 'Sustained shortfall. Accept the lower level and release the stock that is no longer needed.'
              : 'Single soft week. Check whether despatches simply slipped into the next week.'),
      })
    }
    t = end + 1
  }

  return out
}

/** Severity ordering used for sorting queues. */
export const SEVERITY_RANK: Record<AnomalySeverity, number> = { High: 0, Medium: 1, Low: 2 }

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * What the planner decides on: a real shift, or a pile of one-off weeks.
 *
 * When a region genuinely changes what it buys, the detector fires in every
 * affected product, and it is right to. Those belong together as ONE decision.
 *
 * But grouping only by grade + region + direction also swept in unrelated
 * single-week blips from months apart, so normal week-to-week wobble read as
 * "+38% across 16 products". A shift now has to look like one:
 *   - it is still running (its last flagged week is within the last 3 weeks),
 *   - it started recently (within the last 8 weeks), and
 *   - at least 3 products show it for 2+ weeks in a row, at the same time.
 * Everything else in that grade/region/direction is "One-off weeks".
 *
 * Nothing is suppressed: every series sits in exactly one group.
 */
export type AnomalyGroupKind = 'Shift' | 'One-off weeks'

export interface AnomalyGroup {
  id: string
  kind: AnomalyGroupKind
  grade: Grade
  region: RegionName
  direction: Anomaly['direction']
  severity: AnomalySeverity
  status: AnomalyStatus
  /** Every series behind this group, worst gap first. */
  items: Anomaly[]
  products: number
  /** Products that were unusual for 2+ weeks in a row. */
  sustainedProducts: number
  avgDeltaPct: number
  /** Tonnes per week above (+) or below (−) expected, summed over the products. */
  weeklyGapT: number
  totalImpactT: number
  /** Sales value of the gap so far (tonnes × selling price). */
  totalImpactINR: number
  /** Sales value per week if the gap continues. */
  weeklyGapINR: number
  /** The fastest detection in the group — how quickly we knew at all. */
  detectedAfterWeeks: number
  detectedAfterDays: number
  startWeek: number
  /** Last week any member was flagged. */
  lastWeek: number
  weeksRunning: number
  /** How many weeks the members are spread across, first start to last flag. */
  spanWeeks: number
  /** How sure we are of the verdict (shift is real / weeks are noise), 0–100. */
  confidence: number
  likelyCause: string
  linkedSignalId: string | null
  suggestedAction: string
}

const SHIFT_MIN_SUSTAINED = 3
const SHIFT_RECENT_WEEKS = 8
const SHIFT_LIVE_WEEKS = 3

const lastFlagged = (a: Anomaly) => a.startWeek + a.weeksRunning - 1

function makeGroup(kind: AnomalyGroupKind, key: string, items: Anomaly[]): AnomalyGroup {
  items.sort((x, y) => Math.abs(y.deltaPct) - Math.abs(x.deltaPct))
  const lead = items[0]
  const up = lead.direction === 'Above forecast'
  const products = items.length
  const sustained = items.filter(i => i.weeksRunning >= 2).length
  const avgDeltaPct = +(items.reduce((s, i) => s + i.deltaPct, 0) / products).toFixed(1)
  // A shift starts when products began moving TOGETHER (the first 2+ week
  // run), not at the earliest stray week caught in its window.
  const anchor = kind === 'Shift' ? items.filter(i => i.weeksRunning >= 2) : items
  const startWeek = Math.min(...anchor.map(i => i.startWeek))
  const lastWeek = Math.max(...items.map(lastFlagged))
  const weeksRunning = Math.max(...items.map(i => i.weeksRunning))
  const spanWeeks = lastWeek - startWeek + 1
  const weeklyGapT = +items.reduce((s, i) => s + i.deltaT, 0).toFixed(1)
  const totalImpactT = +items.reduce((s, i) => s + i.impactT, 0).toFixed(1)
  const totalImpactINR = Math.round(items.reduce((s, i) => s + i.impactINR, 0))
  // Price per tonne implied by each member's own impact figures.
  const weeklyGapINR = Math.round(items.reduce((s, i) =>
    s + (i.impactT > 0 ? (i.impactINR / i.impactT) * i.deltaT : 0), 0))
  const explained = items.find(i => i.linkedSignalId) ?? null
  const detectedAfterWeeks = Math.min(...items.map(i => i.detectedAfterWeeks))

  let severity: AnomalySeverity, confidence: number, likelyCause: string, suggestedAction: string
  if (kind === 'Shift') {
    severity = sustained >= 6 || Math.abs(avgDeltaPct) >= 30 ? 'High' : 'Medium'
    // A missing cause is a lower ceiling, not a small bonus for having one.
    // This was `+ 14 if explained` inside a clamp at 95, which the cap swallowed
    // whole: once a shift was wide enough and had run long enough, one nobody
    // could explain still displayed 95%.
    confidence = Math.round(clamp(42 + sustained * 5 + weeksRunning * 7, 40, explained ? 95 : 82))
    likelyCause = explained
      ? explained.likelyCause
      : `${products} products moved together for up to ${weeksRunning} weeks. No market signal explains it yet. Check with the ${lead.region} sales team.`
    suggestedAction = up
      ? 'Accept it as the new level. The forecast, material needs and buy plan rise to match.'
      : 'Accept the lower level. The forecast and buying drop, so stock does not pile up.'
  } else {
    severity = 'Low'
    const singles = items.filter(i => i.weeksRunning === 1).length
    confidence = Math.round(clamp(55 + (singles / products) * 35, 50, 92))
    likelyCause = products === 1
      ? `One product, ${lead.weeksRunning === 1 ? 'one week' : `${lead.weeksRunning} weeks`}. Not part of a wider change.`
      : `Separate weeks spread over ${spanWeeks} weeks, not at the same time. Normal week-to-week variation, not a trend.`
    suggestedAction = 'Ignore as one-off. These weeks are taken out of what the forecast learns from, so they stop distorting it.'
  }

  return {
    id: `AG-${kind === 'Shift' ? 'S' : 'O'}-${key.replace(/\|/g, '-').replace(/\s+/g, '')}`,
    kind, grade: lead.grade, region: lead.region, direction: lead.direction,
    severity, status: lead.status,
    items, products, sustainedProducts: sustained,
    avgDeltaPct, weeklyGapT, totalImpactT, totalImpactINR, weeklyGapINR,
    detectedAfterWeeks, detectedAfterDays: detectedAfterWeeks * 7,
    startWeek, lastWeek, weeksRunning, spanWeeks, confidence,
    likelyCause,
    linkedSignalId: kind === 'Shift' ? explained?.linkedSignalId ?? null : null,
    suggestedAction,
  }
}

/**
 * @param nowWeek the last week with actual sales (today − 1). Defaults to the
 *                latest flagged week, which is right whenever anything is open.
 */
export function groupAnomalies(anomalies: Anomaly[], nowWeek?: number): AnomalyGroup[] {
  const by = new Map<string, Anomaly[]>()
  for (const a of anomalies) {
    const key = `${a.grade}|${a.region}|${a.direction}|${a.status}`
    const list = by.get(key) ?? []
    list.push(a)
    by.set(key, list)
  }
  const now = nowWeek ?? Math.max(...anomalies.map(lastFlagged))

  const out: AnomalyGroup[] = []
  for (const [key, items] of by) {
    const live = items.filter(a => lastFlagged(a) >= now - (SHIFT_LIVE_WEEKS - 1) && a.startWeek >= now - SHIFT_RECENT_WEEKS + 1)
    const isShift = live.filter(a => a.weeksRunning >= 2).length >= SHIFT_MIN_SUSTAINED
    const shift = isShift ? live : []
    const rest = isShift ? items.filter(a => !live.includes(a)) : items
    if (shift.length) out.push(makeGroup('Shift', key, shift))
    if (rest.length) out.push(makeGroup('One-off weeks', key, rest))
  }

  return out.sort((a, b) =>
    (a.kind === b.kind ? 0 : a.kind === 'Shift' ? -1 : 1) ||
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    b.products - a.products ||
    Math.abs(b.avgDeltaPct) - Math.abs(a.avgDeltaPct))
}
