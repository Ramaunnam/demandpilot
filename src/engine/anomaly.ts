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
        detectedAfterDays: (detectedWeek - t) * 7 + 3,
        weeksRunning: weeks,
        expected: +expected.toFixed(1), actual: +actual.toFixed(1),
        deltaT: +deltaT.toFixed(1), deltaPct: +deltaPct.toFixed(1),
        zScore: +peakZ.toFixed(2), severity,
        direction: deltaPct > 0 ? 'Above forecast' : 'Below forecast',
        status: inp.resolutions[id] ?? 'Open',
        likelyCause: sig
          ? sig.title
          : deltaPct > 0
            ? 'No matching market signal. Most likely a single large order or channel stocking.'
            : 'No matching market signal. Most likely a despatch timing effect or a customer hold.',
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
 * One market shift, not one row per product.
 *
 * When a region genuinely changes what it buys, the detector finds it in every
 * affected product independently — and it is right to. Grade 316L has 60 SKUs,
 * so a real step-up in the South surfaces as dozens of separate anomalies.
 * Listing them individually turns one decision into sixty rows and makes the
 * open count read as noise rather than signal.
 *
 * So the detection stays exactly as sensitive as it was, and the *queue*
 * collapses by what a planner actually decides on: a grade, in a region, moving
 * in a direction. The per-product evidence is kept inside each group.
 */
export interface AnomalyGroup {
  id: string
  grade: Grade
  region: RegionName
  direction: Anomaly['direction']
  severity: AnomalySeverity
  status: AnomalyStatus
  /** Every series behind this group, worst gap first. */
  items: Anomaly[]
  products: number
  avgDeltaPct: number
  totalImpactT: number
  totalImpactINR: number
  /** The fastest detection in the group — how quickly we knew at all. */
  detectedAfterDays: number
  startWeek: number
  weeksRunning: number
  likelyCause: string
  linkedSignalId: string | null
  suggestedAction: string
}

export function groupAnomalies(anomalies: Anomaly[]): AnomalyGroup[] {
  const by = new Map<string, Anomaly[]>()
  for (const a of anomalies) {
    const key = `${a.grade}|${a.region}|${a.direction}|${a.status}`
    const list = by.get(key) ?? []
    list.push(a)
    by.set(key, list)
  }

  const out: AnomalyGroup[] = []
  for (const [key, items] of by) {
    items.sort((x, y) => Math.abs(y.deltaPct) - Math.abs(x.deltaPct))
    const lead = items[0]
    // The group is as severe as its worst member, and as quick as its fastest.
    const severity = items.some(i => i.severity === 'High') ? 'High'
      : items.some(i => i.severity === 'Medium') ? 'Medium' : 'Low'
    // Prefer an explanation that names a signal over one that admits it found none.
    const explained = items.find(i => i.linkedSignalId) ?? lead
    out.push({
      id: `AG-${key.replace(/\|/g, '-').replace(/\s+/g, '')}`,
      grade: lead.grade, region: lead.region, direction: lead.direction,
      severity, status: lead.status,
      items, products: items.length,
      avgDeltaPct: +(items.reduce((s, i) => s + i.deltaPct, 0) / items.length).toFixed(1),
      totalImpactT: +items.reduce((s, i) => s + i.impactT, 0).toFixed(1),
      totalImpactINR: Math.round(items.reduce((s, i) => s + i.impactINR, 0)),
      detectedAfterDays: Math.min(...items.map(i => i.detectedAfterDays)),
      startWeek: Math.min(...items.map(i => i.startWeek)),
      weeksRunning: Math.max(...items.map(i => i.weeksRunning)),
      likelyCause: explained.likelyCause,
      linkedSignalId: explained.linkedSignalId,
      suggestedAction: lead.suggestedAction,
    })
  }

  return out.sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    b.products - a.products ||
    Math.abs(b.avgDeltaPct) - Math.abs(a.avgDeltaPct))
}
