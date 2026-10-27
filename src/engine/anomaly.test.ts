/**
 * The Anomalies screen's promises, pinned down:
 *  - a "shift" is products moving together, not scattered single weeks
 *  - the planner's decision really moves the forecast
 *  - nothing shown comes from weeks that have not happened yet
 */
import { describe, it, expect } from 'vitest'
import { runPlanning, DEFAULT_SETTINGS } from './index'
import { buildDataset, STORY, SHIFTS } from '@/data/generate'
import { groupAnomalies } from './anomaly'
import { priceAlerts, orderWatch, explainShift, demandOutlook } from './insights'
import { sum, mean } from '@/lib/format'

const ds = buildDataset()
const base = { ds, settings: DEFAULT_SETTINGS, weeksAdvanced: 0, overrides: [] }
const r = runPlanning({ ...base, anomalyResolutions: {} })
const now = r.todayWeek - 1
const open = groupAnomalies(r.anomalies.filter(a => a.status === 'Open'), now)
const shifts = open.filter(g => g.kind === 'Shift')

describe('shifts vs one-off weeks', () => {
  it('finds the planted South 316L surge as a shift, and ranks it first', () => {
    expect(shifts.length).toBeGreaterThan(0)
    expect(shifts[0].grade).toBe(STORY.anomalyGrade)
    expect(shifts[0].region).toBe(STORY.anomalyRegion)
    expect(shifts[0].direction).toBe('Above forecast')
    expect(shifts[0].sustainedProducts).toBeGreaterThanOrEqual(3)
  })

  it('does not call scattered single weeks a shift', () => {
    for (const g of shifts) {
      // every member is recent and still running
      for (const a of g.items) {
        expect(a.startWeek).toBeGreaterThanOrEqual(now - 7)
        expect(a.startWeek + a.weeksRunning - 1).toBeGreaterThanOrEqual(now - 2)
      }
    }
    const fake = open.find(g => g.grade === '304' && g.region === 'South' && g.direction === 'Above forecast')
    expect(fake?.kind).toBe('One-off weeks')
  })

  it('every flagged series sits in exactly one group', () => {
    const ids = open.flatMap(g => g.items.map(a => a.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(r.anomalies.filter(a => a.status === 'Open').length)
  })

  it('reports detection in whole weeks, with no invented days', () => {
    for (const a of r.anomalies) {
      expect(a.detectedAfterDays % 7).toBe(0)
      expect(a.detectedAfterDays).toBe(a.detectedAfterWeeks * 7)
    }
  })
})

/**
 * Every shift planted in the history has to come out the other end.
 *
 * This is the test that was missing. Three of the shifts first written into
 * `SHIFTS` never formed a group at all — a fall drags the recent mean under the
 * detector's minimum-volume gate, so a small grade can drop 30% and be excluded
 * before it is examined. The screen simply showed fewer cards and said nothing.
 */
describe('the planted shifts all surface', () => {
  it('finds a shift for every one planted, in the right direction', () => {
    for (const sh of SHIFTS) {
      const want = sh.uplift > 0 ? 'Above forecast' : 'Below forecast'
      const found = shifts.find(g => g.grade === sh.grade && g.region === sh.region && g.direction === want)
      expect(found, `${sh.id} did not surface as a shift`).toBeTruthy()
      expect(found!.sustainedProducts, `${sh.id} is not sustained`).toBeGreaterThanOrEqual(3)
    }
  })

  it('surfaces no shift that was not planted', () => {
    // Background noise must not reach the bar a planted market change clears.
    for (const g of shifts) {
      const planted = SHIFTS.some(sh =>
        sh.grade === g.grade && sh.region === g.region &&
        (sh.uplift > 0) === (g.direction === 'Above forecast'))
      expect(planted, `unplanted shift: ${g.grade}/${g.region} ${g.direction}`).toBe(true)
    }
  })

  it('shows several at once, in both directions', () => {
    expect(shifts.length).toBeGreaterThanOrEqual(3)
    expect(shifts.some(g => g.direction === 'Above forecast')).toBe(true)
    expect(shifts.some(g => g.direction === 'Below forecast')).toBe(true)
  })

  it('leaves one shift with no cause, and says so rather than guessing', () => {
    const blind = shifts.filter(g => !g.linkedSignalId)
    expect(blind.length, 'every shift has a signal — the honest case is untested').toBeGreaterThan(0)
    for (const g of blind) {
      expect(g.likelyCause).toMatch(/No market signal explains it yet/)
      // And it must not quietly borrow confidence it has not earned: with no
      // cause, the ceiling is lower than an explained shift's.
      expect(g.confidence).toBeLessThanOrEqual(82)
    }
  })

  it('keeps the planted hero shift at the top', () => {
    expect(shifts[0].grade).toBe(STORY.anomalyGrade)
    expect(shifts[0].region).toBe(STORY.anomalyRegion)
    expect(shifts[0].products).toBeGreaterThan(shifts[1]?.products ?? 0)
  })
})

/**
 * What the drawer has to be able to say about one item, in the order a planner
 * asks it: what is normal, how far from it, is it spreading, and why.
 */
describe('one shift, explained', () => {
  const prices = priceAlerts(ds, r)

  it('says what normal looks like, and how far outside it this is', () => {
    for (const g of shifts) {
      const st = explainShift(ds, r, g, prices)
      expect(st.normal.levelT, `${g.grade}/${g.region} normal level`).toBeGreaterThan(0)
      expect(st.normal.wobblePct).toBeGreaterThan(0)
      // A wobble figure only means something if it is a share, not a tonnage.
      expect(st.normal.wobblePct).toBeLessThan(100)
      // The move has to be bigger than the noise, or it should not be a shift.
      expect(Math.abs(g.avgDeltaPct)).toBeGreaterThan(st.normal.wobblePct)
    }
  })

  it('says whether it is spreading, week by week', () => {
    for (const g of shifts) {
      const st = explainShift(ds, r, g, prices)
      expect(st.spread.length).toBe(now - g.startWeek + 1)
      for (const w of st.spread) {
        expect(w.week).toBeLessThanOrEqual(now)
        expect(w.products).toBeGreaterThanOrEqual(0)
        expect(w.products).toBeLessThanOrEqual(g.products)
      }
      expect(st.spreadLabel.length).toBeGreaterThan(10)
      expect(st.widening).toBe(st.spread[st.spread.length - 1].products > st.spread[0].products)
    }
  })

  it('never files a price move as a reason demand moved', () => {
    for (const g of shifts) {
      const st = explainShift(ds, r, g, prices)
      // A rising index is what the change costs, not why it happened. It must
      // stay out of the evidence list, which the UI ticks and crosses.
      for (const e of st.evidence) expect(e.label).not.toMatch(/price/i)
      if (st.priceNote) expect(st.priceNote).toMatch(/rising|easing/i)
    }
  })

  it('names the products and the materials a shift reaches', () => {
    const st = explainShift(ds, r, shifts[0], prices)
    expect(shifts[0].items.length).toBe(shifts[0].products)
    expect(st.materials.length).toBeGreaterThan(0)
    for (const m of st.materials) {
      expect(Number.isFinite(m.coverDaysNow)).toBe(true)
      expect(Number.isFinite(m.coverDaysAfter)).toBe(true)
      // A rise eats cover; a fall extends it. Either way the two must differ.
      expect(m.coverDaysAfter).not.toBe(m.coverDaysNow)
    }
  })
})

describe('decisions move the forecast', () => {
  const g = shifts[0]
  const fcFor = (res: typeof r) => sum(g.items.map(a => mean(res.skuForecasts.find(f => f.skuId === a.skuId)!.byRegion[a.region].slice(0, 4))))
  const before = fcFor(r)
  const decide = (status: 'Accepted as new trend' | 'Ignored as one-off') =>
    runPlanning({ ...base, anomalyResolutions: Object.fromEntries(g.items.map(a => [a.id, status])) })

  it('accepting a rise as a new trend raises the forecast, never lowers it', () => {
    const after = fcFor(decide('Accepted as new trend'))
    expect(after).toBeGreaterThanOrEqual(before)
    expect(after).toBeGreaterThan(before + 1)
  })

  it('ignoring it as a one-off lowers the forecast', () => {
    expect(fcFor(decide('Ignored as one-off'))).toBeLessThan(before - 1)
  })

  it('a decision keeps the anomaly visible, with its new status', () => {
    const res = decide('Ignored as one-off')
    const a = res.anomalies.find(x => x.id === g.items[0].id)
    expect(a?.status).toBe('Ignored as one-off')
  })
})

describe('only the past is shown', () => {
  it('the shift chart stops at the last week that has happened', () => {
    const st = explainShift(ds, r, shifts[0], priceAlerts(ds, r))
    expect(Math.max(...st.chart.map(c => c.week))).toBe(now)
  })

  it('prices read the index only up to today', () => {
    for (const p of priceAlerts(ds, r)) for (const pt of p.series) expect(pt.week).toBeLessThanOrEqual(now)
  })

  it('order watch uses only orders already placed', () => {
    const w = orderWatch(ds, r)
    for (const b of w.big) expect(b.order.orderWeek).toBeLessThanOrEqual(now)
  })
})

describe('material prices', () => {
  const prices = priceAlerts(ds, r)
  it('flags molybdenum as rising and urgent: low stock against a long lead time', () => {
    const moly = prices.find(p => p.materialId === STORY.criticalMaterial)!
    expect(moly.direction).toBe('Rising')
    expect(moly.urgent).toBe(true)
    expect(prices[0].materialId).toBe(STORY.criticalMaterial)
  })
  it('never tells you to buy ahead on a material already in excess', () => {
    for (const p of prices) if (p.stockStatus === 'Excess') expect(p.advice).not.toMatch(/Order now|Bring the next order forward/)
  })
})

describe('demand outlook', () => {
  it('shows the South 316L surge as the biggest rise ahead', () => {
    const o = demandOutlook(ds, r)
    const top = [...o].sort((a, b) => b.changePct - a.changePct)[0]
    expect(`${top.grade}|${top.region}`).toBe(`${STORY.anomalyGrade}|${STORY.anomalyRegion}`)
    for (const c of o) expect(Number.isFinite(c.changePct)).toBe(true)
  })
})
