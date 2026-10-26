/** @vitest-environment jsdom */
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { Lines, Bars, Forecast, StockChart, Decomp, CapacityChart } from './charts'

/**
 * Charts went blank twice, for two reasons a type check cannot see:
 *
 *  1. CSS variables handed to SVG attributes (`stroke="rgb(var(--primary))"`).
 *     Presentation attributes are parsed before custom properties resolve, so
 *     nothing is drawn.
 *  2. ResponsiveContainer clones its child with `width` and `height`. A wrapper
 *     that swallows those props leaves the chart with no dimensions and draws
 *     nothing at all.
 *
 * These render each wrapper with the dimensions ResponsiveContainer would inject
 * and assert there is real geometry on screen. No measurement, so no flakiness.
 */
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null
afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove(); root = null; container = null
})

function paint(el: React.ReactElement): string {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(React.cloneElement(el, { width: 640, height: 280 } as any)) })
  return container!.innerHTML
}

function geometry(html: string) {
  const attrs = [...html.matchAll(/(?:stroke|fill)="([^"]+)"/g)].map(m => m[1])
  return {
    real: attrs.filter(v => v !== 'none' && v !== 'transparent' && !v.startsWith('url(') && !v.includes('var(')),
    vars: attrs.filter(v => v.includes('var(')),
  }
}

const d = [{ label: 'a', v: 4 }, { label: 'b', v: 9 }, { label: 'c', v: 6 }, { label: 'd', v: 11 }]

const cases: [string, React.ReactElement][] = [
  ['Lines', <Lines data={d} x="label" lines={[{ k: 'v', name: 'V' }]} />],
  ['Bars', <Bars data={d} x="label" bars={[{ k: 'v', name: 'V' }]} />],
  ['Bars horizontal', <Bars data={d} x="label" h bars={[{ k: 'v', name: 'V' }]} />],
  ['Forecast', <Forecast showOld fence="c" data={[
    { label: 'a', actual: 5, forecast: null, band: null, old: null },
    { label: 'b', actual: 7, forecast: null, band: null, old: null },
    { label: 'c', actual: null, forecast: 8, band: [6, 10], old: 6.5 },
    { label: 'd', actual: null, forecast: 9, band: [7, 11], old: 6.5 },
  ]} />],
  ['StockChart', <StockChart unit="t" data={[
    { label: 'a', onHand: 40, safety: 12, reorder: 20 },
    { label: 'b', onHand: 28, safety: 12, reorder: 20 },
    { label: 'c', onHand: 15, safety: 12, reorder: 20 },
  ]} />],
  ['Decomp', <Decomp data={[
    { label: 'a', base: 10, trend: 2, season: 1, signal: 3 },
    { label: 'b', base: 10, trend: 3, season: -1, signal: 4 },
  ]} />],
  ['CapacityChart', <CapacityChart data={[
    { label: 'a', planned: 100, over: 0, capacity: 120 },
    { label: 'b', planned: 120, over: 15, capacity: 120 },
  ]} />],
]

describe('charts paint', () => {
  for (const [name, el] of cases) {
    it(`${name} draws geometry`, () => {
      const html = paint(el)
      expect(html, 'no chart surface — the wrapper dropped width/height').toContain('recharts-surface')
      const { real, vars } = geometry(html)
      expect(vars, `CSS variables leaked into SVG attributes: ${vars.join(', ')}`).toHaveLength(0)
      expect(real.length, 'nothing stroked or filled — the chart is blank').toBeGreaterThan(4)
    })
  }

  it('renders axis ticks, so the data is actually plotted', () => {
    const html = paint(cases[0][1])
    expect(html).toContain('recharts-cartesian-axis-tick')
  })
})
