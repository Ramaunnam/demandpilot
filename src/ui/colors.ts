/**
 * Chart and SVG colours as literal values.
 *
 * These cannot be CSS custom properties. SVG presentation attributes such as
 * `stroke` and `fill` are parsed before custom properties are resolved, so
 * `stroke="rgb(var(--primary))"` is invalid and renders nothing at all — which
 * is exactly how you end up with a blank chart. Anything handed to Recharts, or
 * set as an SVG attribute, has to be a real colour.
 *
 * CSS classes and inline `style` are fine with variables; attributes are not.
 */
import { useStore } from '@/store/useStore'

export interface Palette {
  fg: string; muted: string; grid: string; axis: string; surface: string
  primary: string; success: string; warning: string; danger: string; info: string; ai: string
  actual: string; forecast: string; old: string
  series: string[]
}

const LIGHT: Palette = {
  fg: '#101c2a', muted: '#5c6e84', grid: '#d8e0ea', axis: '#8395a8', surface: '#ffffff',
  primary: '#14395c', success: '#117046', warning: '#a86a06', danger: '#b42a20',
  info: '#1a5f98', ai: '#6744c4',
  actual: '#101c2a', forecast: '#14395c', old: '#9aa9ba',
  series: ['#14395c', '#1a5f98', '#a86a06', '#6744c4', '#117046', '#b42a20'],
}

const DARK: Palette = {
  fg: '#e2eaf3', muted: '#95a6ba', grid: '#24364b', axis: '#7e92aa', surface: '#121d2c',
  primary: '#5c9ede', success: '#4ac48c', warning: '#e8ad46', danger: '#f27a70',
  info: '#60ace8', ai: '#ae90f8',
  actual: '#e2eaf3', forecast: '#5c9ede', old: '#607387',
  series: ['#5c9ede', '#60ace8', '#e8ad46', '#ae90f8', '#4ac48c', '#f27a70'],
}

/** The palette for the current theme. */
export function usePalette(): Palette {
  return useStore(s => (s.dark ? DARK : LIGHT))
}

/** For non-component code that needs a colour outside React. */
export const paletteFor = (dark: boolean): Palette => (dark ? DARK : LIGHT)
