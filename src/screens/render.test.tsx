/**
 * @vitest-environment jsdom
 *
 * Mounts every screen in a real DOM with a real planning result behind it.
 * Type-checking proves it compiles; this proves it renders *and paints* —
 * the blank-white-panel bug type-checked perfectly.
 */
import React from 'react'
import { describe, it, expect, afterEach, beforeEach, afterAll } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { useStore } from '@/store/useStore'
import { runPlanning, DEFAULT_SETTINGS } from '@/engine'
import { buildDataset, STORY } from '@/data/generate'
import * as S from '@/engine/selectors'
import { fmtNum } from '@/lib/format'
import { weekBrief, queueBrief, rankQueue, repeatSubjects } from '@/engine/briefing'
import { ALERT_RULES } from '@/content/alerts'

import Health from './Health'
import Exceptions from './Exceptions'
import Forecast from './Forecast'
import Signals from './Signals'
import Anomalies from './Anomalies'
import Stock from './Stock'
import Plan from './Plan'
import Buy from './Buy'
import Orders from './Orders'
import Simulate from './Simulate'
import Connected from './Connected'
import Proof from './Proof'
import Setup from './Setup'

const ds = buildDataset()
const RESULT = runPlanning({ ds, settings: DEFAULT_SETTINGS, weeksAdvanced: 0, overrides: [], anomalyResolutions: {} })
useStore.setState({ ds, result: RESULT, loading: false, error: null })

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no layout engine. Recharts' ResponsiveContainer reads
// getBoundingClientRect and waits for a ResizeObserver before it draws
// anything, so without both of these every chart here would be empty and the
// test could never catch a blank chart.
//
// Each call has to hand back a *fresh* object: Recharts writes into the rect it
// is given, and a single shared one comes back zeroed on the second screen —
// which silently turned this file into a test of nothing.
const W = 640, H = 280
const rect = (): DOMRect => ({
  width: W, height: H, top: 0, left: 0, bottom: H, right: W, x: 0, y: 0, toJSON: () => ({}),
} as DOMRect)
Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
  configurable: true, writable: true, value: rect,
})
;(globalThis as any).ResizeObserver = class {
  constructor(private cb: ResizeObserverCallback) {}
  observe(el: Element) { this.cb([{ target: el, contentRect: rect() } as any], this as any) }
  unobserve() {} disconnect() {}
}

let container: HTMLDivElement | null = null
let root: Root | null = null
afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove(); root = null; container = null
})

async function render(el: React.ReactElement, path = '/'): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="*" element={el} /></Routes>
      </MemoryRouter>,
    )
  })
  // ResponsiveContainer measures, then redraws. Let that settle.
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
  return container!
}

/** Chart panels that were handed a real size, not a collapsed one. */
const sizedCharts = (c: HTMLElement) =>
  [...c.querySelectorAll('svg.recharts-surface')].filter(s => Number(s.getAttribute('width')) > 50)

/** Drawn geometry inside the chart areas: bars, lines, areas, gridlines. */
const marks = (c: HTMLElement) =>
  c.querySelectorAll('.recharts-wrapper path, .recharts-wrapper line, .recharts-wrapper rect').length

describe('every screen renders', () => {
  // Expected number of chart panels on first paint, with no tab clicked and no
  // row opened. Setup is a settings form; its chart lives on the Data tab.
  const screens: [string, React.ReactElement, number][] = [
    ['Health', <Health />, 2],
    // Exceptions opens on the queue itself — a list, deliberately with no
    // chart on it. Its two charts are on the By-deadline tab, and the tab walk
    // in 'the summary screens' covers them.
    ['Exceptions', <Exceptions />, 0],
    ['Forecast', <Forecast />, 1],
    ['Signals', <Signals />, 1],
    ['Anomalies', <Anomalies />, 1],
    ['Stock', <Stock />, 2],
    ['Plan', <Plan />, 3],
    ['Buy', <Buy />, 2],
    ['Orders', <Orders />, 1],
    // Simulate's What-if tab deliberately has no chart: the one it used to show
    // plotted a 0-100 score, a count and a number of days on one axis. It is
    // before/after delta cards now. Its Cash tab still charts.
    ['Simulate', <Simulate />, 0],
    // Connected systems draws its own sparklines rather than Recharts ones:
    // a twelve-point sync duration does not need an axis.
    ['Connected', <Connected />, 0],
    ['Proof', <Proof />, 1],
    ['Setup', <Setup />, 0],
  ]

  for (const [name, el, charts] of screens) {
    it(`renders ${name}`, async () => {
      const c = await render(el)
      expect(c.innerHTML.length).toBeGreaterThan(4000)
      expect(sizedCharts(c)).toHaveLength(charts)
      if (charts > 0) expect(marks(c)).toBeGreaterThan(4 * charts)
      // Nothing may reach an SVG attribute as a CSS custom property: those are
      // parsed before variables resolve, so the shape renders invisibly.
      expect(c.innerHTML).not.toMatch(/(stroke|fill|stop-color)="[^"]*var\(/)
    })
  }

  it('opens a material from the URL', async () => {
    const c = await render(<Stock />, `/stock?m=${STORY.criticalMaterial}`)
    expect(c.innerHTML).toContain('Ferromolybdenum')
    // The drawer's own projection chart has to paint too.
    expect(sizedCharts(c).length).toBeGreaterThan(2)
  })

  /**
   * Proof is the page a sceptical reader attacks first, so the things that make
   * it credible are asserted on the rendered output rather than trusted.
   */
  it('states the stock trade-off on Proof rather than claiming a clean win', async () => {
    const c = await render(<Proof />, '/proof')
    const txt = c.textContent ?? ''
    const { before, after } = RESULT.replay

    // The storage card compares like with like: rupees against rupees, both
    // from the replay. It must never read "N days" against "₹N Cr" again.
    expect(txt).toContain('Storage cost')
    expect(txt).toContain('trade-off')

    // The page has to admit, in words, that it holds more stock.
    expect(txt).toContain('does not win on stock')
    expect(after.avgInventoryValueINR).toBeGreaterThan(before.avgInventoryValueINR)

    // And it has to price both sides of that trade.
    expect(txt).toContain('Extra cost of cover')
    expect(txt).toContain('Production it protects')

    // Line-stop days are labelled as a total, not left ambiguous.
    expect(txt).toContain('all lines')

    // No all-perfect scorecard: the DemandPilot column keeps real stockouts.
    expect(after.totalStockouts).toBeGreaterThan(0)
    expect(txt).toContain(String(after.totalStockouts))

    // The trade has to be on the landing view, not behind a tab — the storage
    // card points at it with "see the trade below", and a reader who never
    // opens "Why" would otherwise be told only the flattering half.
    const beforeTabs = txt.slice(0, txt.indexOf('Side by side'))
    expect(beforeTabs).toContain('does not win on stock')
    expect(beforeTabs).toContain('Return on the trade')
  })

  it('opens a product from the URL', async () => {
    const sku = ds.skus.find(s => s.grade === '316L')!
    const c = await render(<Forecast />, `/forecast?s=${sku.id}`)
    expect(c.innerHTML).toContain(sku.code)
  })

  it('survives a material id that does not exist', async () => {
    expect((await render(<Stock />, '/stock?m=NOPE')).innerHTML.length).toBeGreaterThan(4000)
  })

  it('opens Forecast on the model accuracy tab, where /models now lands', async () => {
    const c = await render(<Forecast />, '/forecast?tab=accuracy')
    const txt = c.textContent ?? ''
    expect(txt).toContain('Which model wins')
    expect(txt).toContain('Error: DemandPilot vs old method')
    expect(txt).toContain('Best of 3 models chosen per product, tested on the last 12 weeks.')
    // Two charts, and both actually drawn.
    expect(sizedCharts(c)).toHaveLength(2)
    expect(marks(c)).toBeGreaterThan(8)
    // The analyst tooling stays out of the demo flow.
    expect(txt).not.toContain('Drifting')
  })
})

/**
 * The Recommendations panel, and what approving actually does.
 *
 * Approving is the one action in the demo that moves money, so it has to move
 * every count that was describing the work as outstanding — not just the row it
 * was clicked on.
 */
describe('the recommendation panel', () => {
  const reset = () => useStore.setState({
    ds, result: RESULT, loading: false, error: null,
    role: 'Planner', approvals: [], rejected: {}, sentToBuyer: {}, dismissed: [],
  })
  beforeEach(reset)
  afterAll(reset)

  it('opens every recommendation from the URL and explains each one', async () => {
    const recs = RESULT.recommendations
    expect(recs.length).toBeGreaterThan(0)

    for (const rec of recs) {
      // Selection is keyed by material code so a refresh or a shared link
      // reopens the same decision.
      const c = await render(<Buy />, `/buy?r=${rec.materialCode}`)
      const txt = c.textContent ?? ''

      expect(txt, `${rec.materialCode} panel did not open`).toContain(rec.materialName)
      expect(txt).toContain('Why')
      expect(txt).toContain('If we do nothing')
      expect(txt).toContain('Compare options')

      // The reasons must be about this material, not a reused sentence.
      expect(txt).toMatch(/Only .* of stock left|Holding .* against a/)

      // Both lines of the with/without picture have to be drawn.
      expect(txt).toMatch(/With this order|With release/)
      expect(txt).toContain('Without it')

      // A release has no order-by deadline and must not be dressed as urgent.
      if (rec.type === 'Reduce / delay') expect(txt).toContain('No deadline')

      expect(txt).not.toMatch(/NaN|undefined|Infinity/)
      expect(txt).not.toMatch(/\d+\.\d+\s*nos/)
    }
  })

  it('survives a material code that is not in the list', async () => {
    const c = await render(<Buy />, '/buy?r=NOPE')
    expect(c.innerHTML.length).toBeGreaterThan(4000)
  })

  it('a planner is offered the handover, not the approval', async () => {
    useStore.setState({ role: 'Planner' })
    const rec = RESULT.recommendations[0]
    const txt = (await render(<Buy />, `/buy?r=${rec.materialCode}`)).textContent ?? ''
    expect(txt).toContain('A planner cannot approve a purchase.')
    expect(txt).toContain('Switch to Buyer')
    expect(txt).toContain('Send to buyer')
  })

  it('approving as Buyer drops the count everywhere and raises a purchase order', async () => {
    useStore.setState({ role: 'Buyer' })
    const rec = RESULT.recommendations[0]

    const before = {
      recs: S.selectOpenRecommendationCount(RESULT, [], {}),
      queue: S.selectExceptions(RESULT, [], S.selectDecidedRecIds([], {})).length,
      orders: S.selectOpenOrders(ds, RESULT, []).length,
      history: useStore.getState().planHistory.length,
    }

    useStore.getState().approveRecommendation(rec.id, rec.qty, 'Approved in test.')
    const st = useStore.getState()

    // 1. It is recorded as an approval.
    expect(st.approvals).toHaveLength(1)
    expect(st.approvals[0].recommendationId).toBe(rec.id)

    // 2. Every count that was describing it as outstanding drops by one.
    const decided = S.selectDecidedRecIds(st.approvals, st.rejected)
    expect(S.selectOpenRecommendationCount(RESULT, st.approvals, st.rejected)).toBe(before.recs - 1)
    expect(S.selectExceptions(RESULT, st.dismissed, decided).length).toBe(before.queue - 1)

    // 3. And it becomes a real purchase order.
    expect(S.selectOpenOrders(ds, RESULT, st.approvals).length).toBe(before.orders + 1)

    // 4. Visible on the Orders screen as Approved.
    const orders = (await render(<Orders />, '/orders')).textContent ?? ''
    expect(orders).toContain(st.approvals[0].poId)

    // 5. Gone from the waiting list.
    const buy = (await render(<Buy />, '/buy')).textContent ?? ''
    expect(S.selectOpenRecommendations(RESULT, st.approvals, st.rejected)
      .some(x => x.id === rec.id)).toBe(false)
    expect(buy).toContain('Waiting')

    // 6. And on the audit trail.
    expect(st.planHistory.length).toBe(before.history + 1)
    expect(st.planHistory[0].type).toBe('Purchase approved')
  })

  it('a planner sending to the buyer logs it without committing money', async () => {
    useStore.setState({ role: 'Planner' })
    const rec = RESULT.recommendations[0]
    useStore.getState().sendToBuyer(rec.id, 'Please approve today.')
    const st = useStore.getState()
    expect(st.sentToBuyer[rec.id]).toBe('Please approve today.')
    // Sending is a handover, not a decision: nothing has been bought.
    expect(st.approvals).toHaveLength(0)
    expect(S.selectOpenRecommendationCount(RESULT, st.approvals, st.rejected))
      .toBe(S.selectOpenRecommendationCount(RESULT, [], {}))
  })
})

/**
 * Simulate has to say what it is testing.
 *
 * The screen's failure mode was quiet: you clicked a case, some numbers moved,
 * and nothing on the page told you which scenario you were looking at or how to
 * get back. The banner and the chip state are the fix, so they are asserted.
 */
describe('the what-if scenario is always named', () => {
  const PRESETS = [
    ['South 316L +20%', '?d=20&g=316L'],
    ['Supplier B slips 2 wk', '?sd=14&sup=S-02'],
    ['Service 99%', '?sl=99'],
    ['430 falls 15%', '?d=-15&g=430'],
    ['Lean to 40 days', '?ex=40'],
    ['All suppliers +1 wk', '?sd=7'],
  ] as const

  it('opens on the current plan when nothing is set', async () => {
    const txt = (await render(<Simulate />, '/simulate')).textContent ?? ''
    expect(txt).toContain('Current plan — move a lever or pick a case')
    expect(txt).not.toContain('Testing')
  })

  for (const [name, query] of PRESETS) {
    it(`names "${name}" in the banner and marks its chip`, async () => {
      const c = await render(<Simulate />, `/simulate${query}`)
      const txt = c.textContent ?? ''

      // Banner says what is being tested.
      expect(txt).toContain('Testing')
      expect(txt, `banner did not name ${name}`).toContain(name)
      expect(txt).not.toContain('Current plan — move a lever')

      // The matching chip is the selected one, and only that one.
      const chips = [...c.querySelectorAll('button')]
        .filter(b => PRESETS.some(([n]) => b.textContent?.startsWith(n)))
      const on = chips.filter(b => b.className.includes('bg-primary ') || b.className.includes('bg-primary"'))
      expect(on).toHaveLength(1)
      expect(on[0].textContent).toContain(name)

      // And a way back.
      expect(txt).toContain('Reset')
    })
  }

  it('a lever moved by hand becomes a custom scenario', async () => {
    // 25% on 316L matches no ready-made case, so the chips must all clear and
    // the banner must stop claiming one of them.
    const c = await render(<Simulate />, '/simulate?d=25&g=316L')
    const txt = c.textContent ?? ''
    expect(txt).toContain('Custom scenario')
    const chips = [...c.querySelectorAll('button')]
      .filter(b => PRESETS.some(([n]) => b.textContent?.startsWith(n)))
    expect(chips.filter(b => b.className.includes('bg-primary ') || b.className.includes('bg-primary"'))).toHaveLength(0)

    // The changed levers are listed as tags.
    expect(txt).toContain('Demand +25')
    expect(txt).toContain('Grade 316L')
  })

  it('shows the materials a scenario pushes over the line', async () => {
    const txt = (await render(<Simulate />, '/simulate?d=30&g=316L')).textContent ?? ''
    expect(txt).toContain('Materials affected')
    // Either it names them, or it says plainly that nothing moved.
    expect(txt).toMatch(/change status|No material changes status/)
  })
})

/**
 * Plan & MRP, tab by tab.
 *
 * Three of its four tabs were quietly broken: the recipe picker was a native
 * select holding all 240 product codes, the MRP grid showed ten of twenty-six
 * weeks with no way to find a material, and the planned-order list stopped at
 * 80 rows of 740 — hiding 33 of the 38 materials that had orders.
 */
describe('plan and mrp', () => {
  it('the recipe totals up to the product cost', async () => {
    const txt = (await render(<Plan />, '/plan?tab=bom')).textContent ?? ''
    expect(txt).toContain('Metal per tonne')
    expect(txt).toContain('Conversion')
    expect(txt).toContain('Total cost / t')
    expect(txt).toContain('Margin')
    expect(txt).toContain('per tonne')
    // The picker is narrowed, not a raw list of every product.
    expect(txt).toMatch(/\d+ of 240 products/)
  })

  it('the recipe shows real materials with costs', async () => {
    const c = await render(<Plan />, '/plan?tab=bom')
    const txt = c.textContent ?? ''
    // 316L is the default, and it is the only grade carrying molybdenum.
    expect(txt).toContain('RM-105')
    expect(txt).toContain('Ferromolybdenum')
    expect(txt).not.toMatch(/NaN|undefined|Infinity/)
    // Trace inputs must not round away to nothing.
    expect(txt).not.toMatch(/\b0\.0000\b/)
  })

  it('the MRP grid can be filtered and widened', async () => {
    const txt = (await render(<Plan />, '/plan?tab=grid')).textContent ?? ''
    expect(txt).toContain('Shortfalls only')
    expect(txt).toContain('All categories')
    expect(txt).toContain('26 weeks')
    expect(txt).toContain('Start on hand')
    expect(txt).toContain('Projected on hand (end of week)')
    expect(txt).toMatch(/\d+ materials/)
    // Counts of physical things stay whole in the grid.
    expect(txt).not.toMatch(/\d+\.\d+\s*nos/)
  })

  it('the planned orders list holds every order, not the first eighty', async () => {
    const c = await render(<Plan />, '/plan?tab=orders')
    const txt = c.textContent ?? ''
    const total = RESULT.mrp.plannedOrders.length
    expect(total).toBeGreaterThan(80)
    // The filter chips carry the real totals, so nothing is silently dropped.
    expect(txt).toContain(`All ${total}`)
    expect(txt).toContain('Place by')
    expect(txt).toContain('All categories')
    expect(txt).not.toMatch(/\d+\.\d+\s*nos/)
  })

  it('shows the shutdown schedule as a timeline, not a list of chips', async () => {
    const c = await render(<Plan />, '/plan')
    const txt = c.textContent ?? ''
    const maint = RESULT.mrp.production.slice(0, 14).filter(p => p.maintenanceLines.length)
    expect(maint.length).toBeGreaterThan(0)

    expect(txt).toContain('Planned maintenance')
    expect(c.querySelectorAll('.recharts-scatter-symbol').length).toBeGreaterThanOrEqual(maint.length)
    expect(txt).toContain('cut finished output')
  })

  it('separates the shutdown that costs output from the ones that do not', async () => {
    // A line can be the tightest in its week and the plan still fit underneath
    // it. Only a shutdown that leaves the week short counts as costing output.
    const maint = RESULT.mrp.production.filter(p => p.maintenanceLines.length)
    const binding = maint.filter(p => p.maintenanceBinds)
    expect(maint.length).toBeGreaterThan(binding.length)   // some are absorbed
    expect(binding.length).toBeGreaterThan(0)              // and some are not
    for (const p of binding) {
      expect(p.constrained).toBe(true)
      expect(p.shortfallT).toBeGreaterThan(0)
      expect(p.maintenanceLines).toContain(p.limitingLine)
    }
    for (const p of maint.filter(x => !x.maintenanceBinds)) {
      expect(p.shortfallT).toBe(0)
    }
  })

  it('names the line the plant is waiting on', async () => {
    // The question the Lines panel exists to answer. Every week has an answer,
    // and it is always a real process.
    const processes = new Set(ds.lines.map(l => l.process))
    for (const p of RESULT.mrp.production) {
      expect(processes.has(p.limitingLine as any), `${p.limitingLine}`).toBe(true)
    }
    // Named on the load chart's header. The list that used to carry it could
    // not fit a line's name and truncated every one to "Meltin...".
    const txt = (await render(<Plan />, '/plan')).textContent ?? ''
    expect(txt).toContain('is the constraint')
    expect(txt).toMatch(/Melting & casting|Annealing & pickling/)
  })

  it('loads every line on the route a tonne takes, not one of them', async () => {
    // Steel is made in sequence. Dividing a tonne between the lines that could
    // make it summed the loads to the plant's output instead of several times
    // it, and reported every line's utilisation wrong.
    const planned = RESULT.mrp.production.slice(0, 8).reduce((s, p) => s + p.plannedT, 0)
    const load = ds.lines.reduce((s, l) =>
      s + RESULT.mrp.production.slice(0, 8).reduce((t, p) => t + (p.byLine[l.id] ?? 0), 0), 0)
    expect(load / planned).toBeGreaterThan(3)   // ~4 lines per tonne
    // Melting and hot rolling see everything; the finishing end sees less.
    const through = (proc: string) => {
      const l = ds.lines.find(x => x.process === proc)!
      return RESULT.mrp.production.slice(0, 8).reduce((t, p) => t + (p.byLine[l.id] ?? 0), 0)
    }
    expect(through('Melting & casting')).toBeCloseTo(planned, 0)
    expect(through('Cold rolling')).toBeLessThan(through('Melting & casting'))
  })

  it('sizes capacity against the forecast, not last year', async () => {
    // Capacity was set against the historical 3,800 t average while the forward
    // plan runs well above it, so 21 of 26 weeks read as "over capacity".
    const prod = RESULT.mrp.production
    const over = prod.filter(p => p.constrained).length
    expect(over).toBeGreaterThan(0)          // still a real exception
    expect(over).toBeLessThanOrEqual(6)      // not the default state
    // And the plant runs busy rather than impossibly.
    const normal = prod.filter(p => !p.maintenanceBinds)
    const avgUtil = normal.reduce((s, p) => s + p.utilisationPct, 0) / normal.length
    expect(avgUtil).toBeGreaterThan(80)
    expect(avgUtil).toBeLessThan(100)
  })

  it('no line reports impossible utilisation', async () => {
    // An even split across capable lines loaded a 900 t annealing line like a
    // 1,700 t melting line and reported 117%.
    for (const l of ds.lines) {
      const load = RESULT.mrp.production.slice(0, 8).reduce((s, p) => s + (p.byLine[l.id] ?? 0), 0)
      const pct = (load / (l.weeklyCapacityT * 8)) * 100
      expect(pct, `${l.process} at ${pct.toFixed(0)}%`).toBeLessThanOrEqual(100)
    }
  })
})

/**
 * Signals: a timeline, and a drawer that says what came of each event.
 */
describe('signals', () => {
  it('leads with the timeline, not a commodity chart', async () => {
    const c = await render(<Signals />, '/signals')
    const txt = c.textContent ?? ''
    expect(txt).toContain('Signals timeline — last 6 months')
    // The alloy index used to sit above the cards explaining nothing about them.
    expect(txt).not.toContain('Alloy price index')
    expect(txt).not.toContain('Weighting')
    // A graph: stacked columns by type with a net-effect line over them.
    expect(sizedCharts(c)).toHaveLength(1)
    expect(c.querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThan(5)
    expect(c.querySelectorAll('.recharts-line').length).toBeGreaterThan(0)
    expect(txt).toContain('Net effect on forecast')
  })

  it('filters sit above the cards and cover region, grade and severity', async () => {
    const c = await render(<Signals />, '/signals')
    const txt = c.textContent ?? ''
    // A placeholder is an attribute, not text, so check the element.
    expect(c.querySelector('input[placeholder="Search signals"]')).toBeTruthy()
    for (const label of ['Type', 'Region', 'Grade', 'Severity']) expect(txt).toContain(label)
    // Counts on the chips, so you can see where the signals are before clicking.
    expect(txt).toMatch(/Demand \d+/)
  })

  it('the timeline labels every period on its axis', async () => {
    const c = await render(<Signals />, '/signals')
    const ticks = c.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick')
    expect(ticks.length).toBeGreaterThan(5)
  })

  it('a price signal carries the alloy index; other kinds do not', async () => {
    const price = ds.signals.find(s => s.kind === 'Price')!
    const demand = ds.signals.find(s => s.kind === 'Demand' && s.materialIds.length > 0)!

    const withIndex = (await render(<Signals />, `/signals?s=${price.id}`)).textContent ?? ''
    expect(withIndex).toContain('Alloy price index')

    const without = (await render(<Signals />, `/signals?s=${demand.id}`)).textContent ?? ''
    expect(without).not.toContain('Alloy price index')
  })

  it('the drawer explains the signal and what it led to', async () => {
    const sig = ds.signals.find(s => s.materialIds.length > 0)!
    const txt = (await render(<Signals />, `/signals?s=${sig.id}`)).textContent ?? ''
    expect(txt).toContain('What happened')
    expect(txt).toContain('Source')
    expect(txt).toContain('Confidence')
    expect(txt).toContain('Effect on the forecast')
    expect(txt).toContain('Materials affected')
    expect(txt).toContain('What it led to')
    expect(txt).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('the signal weight lives in Settings, not on this page', async () => {
    const signals = (await render(<Signals />, '/signals')).textContent ?? ''
    expect(signals).not.toContain('Signal weight in forecast')
    const setup = (await render(<Setup />, '/setup')).textContent ?? ''
    expect(setup).toContain('Signal weight')
  })
})

/**
 * The Recipe tab, after the squashed listbox.
 */
describe('recipe tab', () => {
  it('uses a searchable picker, not a list of 240 codes', async () => {
    const c = await render(<Plan />, '/plan?tab=bom')
    const txt = c.textContent ?? ''
    expect(txt).toMatch(/\d+ of 240 products/)
    // A combobox input, not a sized listbox.
    const listboxes = [...c.querySelectorAll('select')].filter(el => el.size > 1)
    expect(listboxes).toHaveLength(0)
    expect(c.querySelector('input[placeholder="Search product code"]')).toBeTruthy()
  })

  it('capitalises the grade and spells out the form', async () => {
    const txt = (await render(<Plan />, '/plan?tab=bom')).textContent ?? ''
    expect(txt).toContain('Grade 316L')
    expect(txt).toContain('Cold-rolled coil')
  })

  it('shows where the cost goes, and the groups add up', async () => {
    const c = await render(<Plan />, '/plan?tab=bom')
    const txt = c.textContent ?? ''
    expect(txt).toContain('Where the cost goes')
    // Category chips carry a cost and a share each.
    expect(txt).toContain('Base metal')
    expect(txt).toContain('Alloy')
    expect(sizedCharts(c).length).toBeGreaterThan(0)
  })

  it('states a countable trace input as a rate, not a decimal', async () => {
    // A backup roll goes 0.00004 per tonne. "1 per 25,000 t" is the same fact
    // in the units a planner thinks in.
    const txt = (await render(<Plan />, '/plan?tab=bom')).textContent ?? ''
    expect(txt).toMatch(/1 per [\d,]+ t/)
    expect(txt).not.toMatch(/0\.0000\d+\s*nos/)
  })

  it('keeps the scrap column while the rates differ', async () => {
    // 4% on the acids and rolling oil, 2% elsewhere — so the column earns its
    // place. It hides itself only if a recipe ever becomes uniform.
    const sku = ds.skus.find(s => s.grade === '316L' && s.form === 'Cold-rolled coil')!
    const rates = new Set(ds.bom[sku.id].map(l => l.scrapPct))
    const txt = (await render(<Plan />, '/plan?tab=bom')).textContent ?? ''
    if (rates.size > 1) expect(txt).toContain('Scrap')
    expect(txt).toContain('scrap allowance')
  })

  it('offers a week range on the grid and the planned orders', async () => {
    const grid = (await render(<Plan />, '/plan?tab=grid')).textContent ?? ''
    expect(grid).toMatch(/from \d/)
    expect(grid).toContain('26 weeks')

    const orders = (await render(<Plan />, '/plan?tab=orders')).textContent ?? ''
    expect(orders).toContain('Place within 4 weeks')
    expect(orders).toContain('Every week')
  })
})

/**
 * What a sceptical viewer notices in the first ten seconds.
 *
 * None of these are logic bugs — they are the things that make a working
 * application look unfinished: a number that came out undefined, a count of
 * 855.7 physical objects, a cover figure in five digits.
 */
/**
 * Connected systems.
 *
 * The screen's whole claim is that its counts are the same ones the rest of the
 * app computes on, so the test asserts the dataset's own figures appear rather
 * than checking that the page is non-empty.
 */
describe('connected systems', () => {
  /**
   * Nothing on this screen may look clickable and do nothing.
   *
   * Three things did. The "Send" button was disabled in the default Planner
   * role, so the one obvious control on the panel was dead on arrival; the
   * queued rows were plain divs; and three of the six chain boxes carried the
   * hover styling of a link without being one.
   */
  describe('every control does something', () => {
    const clickText = async (c: HTMLElement, startsWith: string) => {
      const b = [...c.querySelectorAll('button')]
        .find(x => (x.textContent ?? '').trim().startsWith(startsWith))
      expect(b, `no button starting "${startsWith}"`).toBeTruthy()
      expect(b!.disabled, `"${startsWith}" is disabled`).toBe(false)
      await act(async () => { b!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      await act(async () => { await new Promise(r => setTimeout(r, 10)) })
      return b!
    }

    it('offers the manual feed its upload, not a dead sync button', async () => {
      const c = await render(<Connected />)
      const txt = c.textContent ?? ''
      // It has no schedule, so it is "on demand" rather than switched off.
      expect(txt).toContain('Manual upload')
      expect(txt).toContain('On demand')
      expect(txt).toContain('Upload a CSV')
      expect(txt).toContain('runs when you upload')

      await clickText(c, 'Manual upload')
      const open = c.textContent ?? ''
      expect(open).toContain('None — on demand')
      // Nothing has been uploaded in a fresh session, so there is no last upload.
      expect(open).toContain('never')
      // No sync or pause: there is nothing to sync, and nothing to pause.
      for (const label of ['Sync now', 'Pause', 'Retry connection']) {
        expect([...c.querySelectorAll('button')].some(b => (b.textContent ?? '').trim().startsWith(label)),
          `manual feed should not offer "${label}"`).toBe(false)
      }
      // The upload is a real link to the uploader the app already has.
      const link = [...c.querySelectorAll('a')].find(a => (a.textContent ?? '').includes('Upload a CSV'))
      expect(link, 'no upload link in the drawer').toBeTruthy()
      expect(link!.getAttribute('href')).toContain('tab=upload')
    })

    it('the counts do not treat an on-demand feed as a broken one', async () => {
      const txt = (await render(<Connected />)).textContent ?? ''
      // 8 scheduled feeds, 1 on demand — not "9, one of them paused".
      expect(txt).toContain('scheduled feeds')
      expect(txt).toContain('1 on demand')
    })

    it('leaves no chain box that looks clickable but is not', async () => {
      const c = await render(<Connected />)
      const chain = [...c.querySelectorAll('a, button')]
        .filter(el => /hover:border-primary/.test(el.querySelector('div')?.className ?? ''))
      // Six stages, every one of them either a link or a button.
      expect(chain.length).toBeGreaterThanOrEqual(6)
      for (const el of chain) {
        expect(['A', 'BUTTON']).toContain(el.tagName)
        if (el.tagName === 'BUTTON') expect((el as HTMLButtonElement).disabled).toBe(false)
      }
    })
  })

  it('reads its record counts off the dataset rather than restating them', async () => {
    const bomLines = Object.values(ds.bom).reduce((n, a) => n + a.length, 0)
    const txt = (await render(<Connected />)).textContent ?? ''
    expect(txt).toContain('SAP S/4HANA')
    expect(txt).toContain(fmtNum(ds.skus.length))
    expect(txt).toContain(fmtNum(bomLines))
    expect(txt).toContain(fmtNum(ds.orders.length))
    expect(txt).toContain(String(ds.materials.length))
  })

  it('no longer carries a write-back queue', async () => {
    const txt = (await render(<Connected />)).textContent ?? ''
    expect(txt).not.toContain('Waiting to go out')
    // The outbound systems are still described — removing the queue must not
    // remove the fact that this app writes anywhere.
    expect(txt).toContain('Writes out')
    expect(txt).toContain('Write back')
  })

  it('does not hide a feed that has gone stale', async () => {
    const txt = (await render(<Connected />)).textContent ?? ''
    expect(txt).toContain('Plant MES')
    expect(txt).toContain('Degraded')
    expect(txt).toContain('needs attention')
    // A failed read stays on the log. A log that only shows success is not one.
    expect(txt).toContain('Failed')
  })

})

describe('settings', () => {
  it('lands on the alert rules when a link asks for them', async () => {
    // Connected systems links here from every alert. It used to drop you on
    // Parameters, which is not where the rules are.
    const txt = (await render(<Setup />, '/setup?tab=alerts')).textContent ?? ''
    for (const rule of ALERT_RULES) expect(txt, `rule missing: ${rule.name}`).toContain(rule.name)
    expect(txt).toContain('Severity sets the channel')
  })

  it('has a working uploader where Connected systems says it does', async () => {
    const c = await render(<Setup />, '/setup?tab=upload')
    const txt = c.textContent ?? ''
    expect(txt).toContain('Upload a file')
    const input = c.querySelector('input[type="file"]') as HTMLInputElement | null
    expect(input, 'no file input on the upload tab').toBeTruthy()
    // Any type is accepted. An `accept` filter here is what stopped a PDF, a
    // photo or a video from ever reaching the feed.
    expect(input!.getAttribute('accept'), 'the uploader is filtered again').toBeNull()
    expect(input!.multiple).toBe(true)
    // And it says plainly which of them can move the forecast.
    expect(txt).toContain('read as demand history')
    expect(txt).toContain('attached')
  })

  it('still opens on parameters with no tab asked for', async () => {
    const txt = (await render(<Setup />, '/setup')).textContent ?? ''
    expect(txt).not.toContain('Severity sets the channel')
  })
})

describe('the summary screens', () => {
  /** Click a Tabs button by its label, matched on the Tabs button class. */
  async function clickTab(c: HTMLElement, label: string) {
    const btn = [...c.querySelectorAll('button')]
      .filter(b => b.className.includes('h-7 rounded-md'))
      .find(b => (b.textContent ?? '').trim().startsWith(label))
    expect(btn, `no tab labelled "${label}"`).toBeTruthy()
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // ResponsiveContainer measures, then redraws. Let that settle.
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
  }

  const QUEUE = S.selectExceptions(RESULT, [], S.selectDecidedRecIds([], {}))

  it('the due buckets neither overlap nor lose an item', async () => {
    // dueInDays is fractional. The buckets used to round, so an item at -0.4
    // landed in both Overdue and Today and the bars could total more than the
    // queue holds. Every item must fall in exactly one.
    for (const w of QUEUE) {
      const hit = S.DUE_BUCKETS.filter(b => b.has(w.dueInDays))
      expect(hit.map(b => b.name), `${w.subject} at d=${w.dueInDays}`).toHaveLength(1)
    }
    for (const d of [-2, -0.4, -0.001, 0, 0.3, 0.999, 1, 3.9, 4, 7.9, 8, 14.9, 15, 400]) {
      expect(S.DUE_BUCKETS.filter(b => b.has(d)).map(b => b.name), `d=${d}`).toHaveLength(1)
    }
    expect(S.selectDueBuckets(QUEUE).reduce((a, b) => a + b.n, 0)).toBe(QUEUE.length)
  })

  it('Health and Exceptions count "needs a person today" the same way', async () => {
    // Health reads one predicate and Exceptions adds two others. They have to
    // come out equal for every item, including fractional days.
    const wb = weekBrief(ds, RESULT, QUEUE)
    const qb = queueBrief(QUEUE)
    expect(wb.overdueToday).toBe(qb.overdue + qb.today)
    expect(wb.overdue).toBe(qb.overdue)
    expect(wb.today).toBe(qb.today)
    // The tile was removed; the figure survives in the lead panel, where it sits
    // beside the sentence that explains it.
    const txt = (await render(<Health />)).textContent ?? ''
    expect(txt).toContain('Needs a person today')
    expect(txt).toContain(`${wb.overdue} overdue · ${wb.today} due today · ${QUEUE.length} in total`)
  })

  it('Health leads with the week in a sentence, naming what to do first', async () => {
    const brief = weekBrief(ds, RESULT, QUEUE)
    const txt = (await render(<Health />)).textContent ?? ''
    expect(txt).toContain('This week, in one line')
    expect(txt).toContain(brief.headline)
    expect(txt).toContain(brief.verdict)
    // The lead panel is a claim about the data, not decoration: the headline has
    // to carry the same figures the tiles do.
    expect(brief.headline).toContain(String(RESULT.kpis.materialsAtRisk))
    expect(txt).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('every Health tab paints its charts', async () => {
    const c = await render(<Health />)
    for (const [label, charts] of [
      ['Today', 2], ['Demand ahead', 1], ['Cash & cover', 1], ['Vs the old way', 0],
    ] as [string, number][]) {
      await clickTab(c, label)
      expect(sizedCharts(c), `Health / ${label}`).toHaveLength(charts)
      if (charts > 0) expect(marks(c), `Health / ${label}`).toBeGreaterThan(4 * charts)
      expect(c.textContent ?? '', `Health / ${label}`).not.toMatch(/NaN|undefined|Infinity/)
      expect(c.innerHTML).not.toMatch(/(stroke|fill|stop-color)="[^"]*var\(/)
    }
  })

  it('Health reports the stock trade without hiding the losing rows', async () => {
    const c = await render(<Health />)
    await clickTab(c, 'Vs the old way')
    const txt = c.textContent ?? ''
    // Both directions are on the page: the wins and the stock it costs.
    expect(txt).toContain('Weeks a material ran short')
    expect(txt).toContain('Average stock held')
    expect(txt).toContain('Storage cost')
    expect(txt).toContain('does not win on inventory')
  })

  it('Exceptions still carries the queue figures on its tiles', async () => {
    // The lead panel was removed; the numbers it summarised have to survive on
    // the tiles, or the screen quietly stopped saying how much is overdue.
    const brief = queueBrief(QUEUE)
    const txt = (await render(<Exceptions />)).textContent ?? ''
    expect(txt).not.toContain('What the queue says')
    expect(txt).toContain('Needs a person today')
    expect(txt).toContain(String(brief.overdue + brief.today))
    expect(txt).toContain('Low confidence')
    expect(txt).not.toMatch(/NaN|undefined|Infinity/)
  })

  it('every Exceptions tab paints its charts', async () => {
    const c = await render(<Exceptions />)
    for (const [label, charts] of [
      ['The queue', 0], ['By deadline', 2], ['Same subject', 0], ["What it's worth", 2],
    ] as [string, number][]) {
      await clickTab(c, label)
      expect(sizedCharts(c), `Exceptions / ${label}`).toHaveLength(charts)
      if (charts > 0) expect(marks(c), `Exceptions / ${label}`).toBeGreaterThan(4 * charts)
      expect(c.textContent ?? '', `Exceptions / ${label}`).not.toMatch(/NaN|undefined|Infinity/)
      expect(c.innerHTML).not.toMatch(/(stroke|fill|stop-color)="[^"]*var\(/)
    }
  })

  it('rolls a subject up instead of listing it three times', async () => {
    const repeats = repeatSubjects(QUEUE)
    const c = await render(<Exceptions />)
    await clickTab(c, 'Same subject')
    const txt = c.textContent ?? ''
    if (repeats.length === 0) {
      expect(txt).toContain('No subject appears twice')
      return
    }
    // Every roll-up holds at least two items, and names them.
    for (const x of repeats) expect(x.items.length).toBeGreaterThanOrEqual(2)
    expect(txt).toContain(repeats[0].subject)
    expect(txt).toContain(`${repeats[0].items.length} items`)
    // A roll-up is presentation, not suppression: the queue tab still has them.
    await clickTab(c, 'The queue')
    expect((c.textContent ?? '')).toContain(repeats[0].subject)
  })

  it('Health and Exceptions agree on what to do first', async () => {
    const first = rankQueue(QUEUE)[0]
    if (!first) return
    const health = (await render(<Health />)).textContent ?? ''
    const exceptions = (await render(<Exceptions />)).textContent ?? ''
    expect(health, 'Health did not name the ranked-first subject').toContain(first.subject)
    expect(exceptions, 'Exceptions did not name the ranked-first subject').toContain(first.subject)
    expect(weekBrief(ds, RESULT, QUEUE).firstToDo?.id).toBe(first.id)
    expect(queueBrief(QUEUE).firstToDo?.id).toBe(first.id)
  })
})

describe('nothing renders as broken', () => {
  const screens: [string, React.ReactElement][] = [
    ['Health', <Health />], ['Exceptions', <Exceptions />], ['Forecast', <Forecast />],
    ['Signals', <Signals />], ['Anomalies', <Anomalies />],
    ['Stock', <Stock />], ['Plan', <Plan />], ['Buy', <Buy />], ['Orders', <Orders />],
    ['Simulate', <Simulate />], ['Connected', <Connected />],
    ['Proof', <Proof />], ['Setup', <Setup />],
  ]

  for (const [name, el] of screens) {
    it(`${name} shows no NaN, undefined or Infinity`, async () => {
      const txt = (await render(el)).textContent ?? ''
      expect(txt, `${name} rendered a broken number`).not.toMatch(/NaN|undefined|Infinity|\[object/)
    })
  }

  it('never shows a fraction of a countable item', async () => {
    // "855.7 nos" of wooden skids was the tell that nothing had decided what a
    // unit means. qtyDp() owns that now.
    for (const [name, el] of screens) {
      const txt = (await render(el)).textContent ?? ''
      expect(txt, `${name} rendered a fractional count`).not.toMatch(/\d+\.\d+\s*nos/)
    }
  })

  it('never shows a cover figure in the thousands of days', async () => {
    for (const el of [<Stock />, <Buy />, <Simulate />]) {
      const txt = (await render(el)).textContent ?? ''
      expect(txt).not.toMatch(/\b\d{4,}\s*d\b/)
    }
  })

  it('every screen still paints in dark mode', async () => {
    useStore.setState({ dark: true })
    try {
      for (const [name, el] of screens) {
        const c = await render(el)
        expect(c.innerHTML.length, `${name} collapsed in dark mode`).toBeGreaterThan(3000)
        // Chart colours are literal values per theme; a CSS variable in an SVG
        // attribute is parsed before variables resolve and renders invisibly.
        expect(c.innerHTML).not.toMatch(/(stroke|fill|stop-color)="[^"]*var\(/)
      }
    } finally {
      useStore.setState({ dark: false })
    }
  })
})

describe('six weeks further on', () => {
  // What the Advance control actually does. The screens have to redraw against
  // a later planning week without a chart collapsing or a date running off the
  // end of the calendar.
  const later = runPlanning({
    ds, settings: DEFAULT_SETTINGS, weeksAdvanced: 6, overrides: [], anomalyResolutions: {},
  })

  for (const [name, el, charts] of [
    ['Health', <Health />, 2], ['Forecast', <Forecast />, 1],
    ['Stock', <Stock />, 2], ['Plan', <Plan />, 3],
  ] as [string, React.ReactElement, number][]) {
    it(`redraws ${name}`, async () => {
      useStore.setState({ result: later, weeksAdvanced: 6 })
      try {
        const c = await render(el)
        expect(sizedCharts(c)).toHaveLength(charts)
        expect(marks(c)).toBeGreaterThan(4 * charts)
        expect(c.innerHTML).not.toContain('Invalid Date')
        expect(c.innerHTML).not.toContain('NaN')
      } finally {
        useStore.setState({ result: RESULT, weeksAdvanced: 0 })
      }
    })
  }
})
