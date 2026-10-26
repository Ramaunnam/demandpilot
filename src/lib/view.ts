/** Small helpers shared by the screens. */
import { weekDate } from '@/data/generate'
import { fmtDateShort, fmtDate } from './format'
import type { Dataset } from '@/data/types'

export function wkLabel(ds: Dataset, week: number): string {
  return fmtDateShort(weekDate(ds, week))
}
export function wkFull(ds: Dataset, week: number): string {
  return fmtDate(weekDate(ds, week))
}
/** "in 12 days" / "4 days ago" / "today" */
export function relDays(n: number): string {
  const r = Math.round(n)
  if (r === 0) return 'today'
  if (r > 0) return `in ${r} day${r === 1 ? '' : 's'}`
  return `${-r} day${r === -1 ? '' : 's'} ago`
}

export function toneForCover(days: number): 'success' | 'warning' | 'danger' {
  return days < 7 ? 'danger' : days <= 14 ? 'warning' : 'success'
}

export function toneForScore(n: number): 'success' | 'warning' | 'danger' {
  return n >= 75 ? 'success' : n >= 50 ? 'warning' : 'danger'
}

/** Build the chart series for a forecast: history + forward forecast + band. */
export function buildForecastSeries(opts: {
  ds: Dataset
  history: number[]
  forecast: number[]
  lower: number[]
  upper: number[]
  spreadsheet?: number[]
  todayWeek: number
  historyWeeks?: number
  horizonWeeks?: number
}) {
  const hw = opts.historyWeeks ?? 26
  const fw = opts.horizonWeeks ?? 16
  const start = Math.max(0, opts.history.length - hw)
  const out: {
    label: string; actual: number | null; forecast: number | null
    band: [number, number] | null; spreadsheet: number | null
  }[] = []

  for (let i = start; i < opts.history.length; i++) {
    out.push({
      label: wkLabel(opts.ds, i),
      actual: +opts.history[i].toFixed(1),
      forecast: null, band: null,
      spreadsheet: opts.spreadsheet ? +(opts.spreadsheet[i] ?? 0).toFixed(1) : null,
    })
  }
  // join the two lines so there is no gap on the chart
  const lastActual = opts.history[opts.history.length - 1] ?? 0
  if (out.length) {
    out[out.length - 1].forecast = +lastActual.toFixed(1)
    out[out.length - 1].band = [+lastActual.toFixed(1), +lastActual.toFixed(1)]
  }
  for (let i = 0; i < Math.min(fw, opts.forecast.length); i++) {
    out.push({
      label: wkLabel(opts.ds, opts.todayWeek + i),
      actual: null,
      forecast: +opts.forecast[i].toFixed(1),
      band: [+opts.lower[i].toFixed(1), +opts.upper[i].toFixed(1)],
      spreadsheet: null,
    })
  }
  return out
}

export const ROLE_HOME: Record<string, string> = {
  Planner: '/workbench',
  Procurement: '/procurement',
  Management: '/before-after',
}
