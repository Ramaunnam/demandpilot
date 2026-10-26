/**
 * Where the navigation points.
 *
 * Every dead link in this app so far has been a rename that something else was
 * still referencing — `/workbench`, `/procurement`, `/materials/:id`, and now
 * `/models`. These tests hold the destinations and the rail against one list,
 * so a screen cannot be moved without the links that reach it being updated.
 */
import { describe, it, expect } from 'vitest'
import { NAV, isNavActive } from './Shell'
import { TOUR } from './Tour'

/** Every path App.tsx actually serves. */
const ROUTES = [
  '/', '/exceptions', '/forecast', '/signals', '/anomalies',
  '/stock', '/plan', '/buy', '/orders', '/simulate', '/proof', '/setup',
  '/models',  // redirect only
]

const items = NAV.flatMap(g => g.items)

describe('the sidebar', () => {
  it('lists the eleven working screens, in order', () => {
    expect(NAV.map(g => g.group)).toEqual(['Overview', 'Demand', 'Supply', 'Buy', 'Decide'])
    expect(items.map(i => i.label)).toEqual([
      'Health', 'Exceptions',
      'Forecast', 'Signals', 'Anomalies',
      'Stock', 'Plan & MRP',
      'Recommendations', 'Orders',
      'Simulate', 'Proof',
    ])
  })

  it('does not carry Settings or Models', () => {
    // Settings is a top-bar control: it configures the tool rather than being a
    // stage of the plan. Models became a tab inside Forecast.
    expect(items.map(i => i.to)).not.toContain('/setup')
    expect(items.map(i => i.to)).not.toContain('/models')
  })

  it('every item points at a route that exists', () => {
    for (const i of items) expect(ROUTES, `${i.label} -> ${i.to}`).toContain(i.to)
  })

  it('fits without scrolling', () => {
    // Eleven items plus five group labels is what the rail was measured for.
    expect(items.length).toBeLessThanOrEqual(12)
  })
})

describe('the active highlight', () => {
  it('marks exactly one item on every sidebar route', () => {
    for (const i of items) {
      const lit = items.filter(x => isNavActive(x.to, i.to))
      expect(lit.map(x => x.label), `on ${i.to}`).toEqual([i.label])
    }
  })

  it('marks nothing while you are in Settings', () => {
    // The settings icon carries its own active state in the top bar.
    expect(items.filter(x => isNavActive(x.to, '/setup'))).toHaveLength(0)
  })

  it('does not light Health on every page', () => {
    // "/" is a prefix of every path, so a startsWith test lit Health everywhere.
    expect(isNavActive('/', '/stock')).toBe(false)
    expect(isNavActive('/', '/')).toBe(true)
  })

  it('keeps a deep link on the right item', () => {
    expect(isNavActive('/stock', '/stock')).toBe(true)
    expect(isNavActive('/buy', '/buy')).toBe(true)
    // A sibling route starting with the same letters must not steal it.
    expect(isNavActive('/plan', '/planning-other')).toBe(false)
  })
})

describe('the tour', () => {
  it('never walks into a route that no longer exists', () => {
    for (const step of TOUR) {
      const path = step.to.split('?')[0]
      expect(ROUTES, `tour step "${step.t}" -> ${step.to}`).toContain(path)
    }
  })

  it('does not stop at Models any more', () => {
    expect(TOUR.map(s => s.to)).not.toContain('/models')
    // The step that explained model choice now points at the Forecast tab.
    expect(TOUR.some(s => s.to === '/forecast?tab=accuracy')).toBe(true)
  })

  it('still tells the whole story, start to finish', () => {
    const paths = TOUR.map(s => s.to.split('?')[0])
    expect(paths[0]).toBe('/')
    expect(paths[paths.length - 1]).toBe('/proof')
    expect(TOUR.length).toBeGreaterThanOrEqual(6)
  })
})
