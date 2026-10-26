import { describe, it, expect } from 'vitest'
import { paletteFor } from './colors'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * SVG presentation attributes (stroke, fill) are parsed before CSS custom
 * properties resolve, so `stroke="rgb(var(--primary))"` silently renders nothing.
 * That turned every chart blank once. These tests make sure it cannot come back.
 */
describe('chart colours', () => {
  it('are real colour values, never CSS variables', () => {
    for (const dark of [false, true]) {
      const p = paletteFor(dark)
      const all = [...Object.values(p).filter(v => typeof v === 'string') as string[], ...p.series]
      for (const c of all) {
        expect(c, `"${c}" must not reference a CSS variable`).not.toMatch(/var\(/)
        expect(c, `"${c}" must be a hex or rgb() colour`).toMatch(/^(#[0-9a-f]{3,8}|rgba?\(\s*\d)/i)
      }
    }
  })

  it('light and dark differ', () => {
    expect(paletteFor(false).primary).not.toBe(paletteFor(true).primary)
    expect(paletteFor(false).fg).not.toBe(paletteFor(true).fg)
  })

  it('gives six distinct series colours per theme', () => {
    for (const dark of [false, true]) {
      const s = paletteFor(dark).series
      expect(s).toHaveLength(6)
      expect(new Set(s).size).toBe(6)
    }
  })

  const src = (f: string) => fs.readFileSync(path.join(process.cwd(), 'src', f), 'utf8')

  it('no SVG attribute in the UI hands a CSS variable to an attribute', () => {
    const offenders: string[] = []
    for (const f of ['ui/charts.tsx', 'ui/kit.tsx']) {
      const text = src(f)
      // stroke=/fill=/stopColor= followed by a string containing var(
      const re = /(stroke|fill|stopColor)\s*=\s*\{?["'`][^"'`]*var\(/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) offenders.push(`${f}: ${m[0]}`)
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0)
  })
})
