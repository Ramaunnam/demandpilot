/** Formatting helpers. One place, so every screen shows numbers the same way. */

export const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** "14 Nov 2026" */
export function fmtDate(d: Date | string | number): string {
  const x = d instanceof Date ? d : new Date(d)
  if (isNaN(x.getTime())) return '—'
  return `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`
}

/** "14 Nov" — short form for dense tables */
export function fmtDateShort(d: Date | string | number): string {
  const x = d instanceof Date ? d : new Date(d)
  if (isNaN(x.getTime())) return '—'
  return `${x.getDate()} ${MONTHS[x.getMonth()]}`
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d); x.setDate(x.getDate() + n); return x
}
export function addWeeks(d: Date, n: number): Date { return addDays(d, n * 7) }

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

/** Tonnes, one decimal: "1,248.5 t" */
export function fmtT(n: number, unit = 't'): string {
  if (!isFinite(n)) return '—'
  return `${n.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit}`
}

export function fmtNum(n: number, dp = 0): string {
  if (!isFinite(n)) return '—'
  return n.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

/**
 * Indian money formatting.
 * Below 1 lakh -> ₹45,200 · below 1 crore -> ₹8.4 L · above -> ₹6.84 Cr
 */
export function fmtINR(n: number): string {
  if (!isFinite(n)) return '—'
  const neg = n < 0
  const a = Math.abs(n)
  let s: string
  if (a >= 1e7) s = `₹${(a / 1e7).toFixed(2)} Cr`
  else if (a >= 1e5) s = `₹${(a / 1e5).toFixed(2)} L`
  else s = `₹${Math.round(a).toLocaleString('en-IN')}`
  return neg ? `−${s}` : s
}

/** Compact money for tight table cells: "₹6.8 Cr" */
export function fmtINRShort(n: number): string {
  if (!isFinite(n)) return '—'
  const neg = n < 0
  const a = Math.abs(n)
  let s: string
  if (a >= 1e7) s = `₹${(a / 1e7).toFixed(1)} Cr`
  else if (a >= 1e5) s = `₹${(a / 1e5).toFixed(1)} L`
  else s = `₹${Math.round(a / 1000)}k`
  return neg ? `−${s}` : s
}

export function fmtPct(n: number, dp = 1): string {
  if (!isFinite(n)) return '—'
  return `${n.toFixed(dp)}%`
}

export function fmtSigned(n: number, dp = 1, suffix = '%'): string {
  if (!isFinite(n)) return '—'
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toFixed(dp)}${suffix}`
}

export function fmtDays(n: number): string {
  if (!isFinite(n)) return '—'
  if (n >= 999) return '> 999 d'
  return `${n.toFixed(1)} d`
}

// ---------------------------------------------------------------------------
// Quantities — the unit decides the precision
// ---------------------------------------------------------------------------

/**
 * How many decimals a unit deserves.
 *
 * You cannot hold 855.7 wooden skids or 2.1 graphite electrodes. Printing a
 * fractional count of a countable thing is the fastest way to make a planning
 * screen look like it is guessing, so the unit decides the precision rather
 * than the call site.
 */
export function qtyDp(unit: string): number {
  switch (unit) {
    case 'nos': return 0          // countable: whole units only
    case 'kg':
    case 'L':
    case 'm³': return 0           // bulk: a gram of argon is not a planning decision
    case 't': return 1
    default: return 1
  }
}

/** "14,968.5 t" · "856 nos" · "8,000 L" */
export function fmtQty(n: number, unit: string, withUnit = true): string {
  if (!isFinite(n)) return '—'
  const dp = qtyDp(unit)
  const s = n.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })
  return withUnit ? `${s} ${unit}` : s
}

/**
 * Days of cover, capped.
 *
 * A material with almost no usage divides into a number like 91,400 days,
 * which is arithmetically true and operationally meaningless. Past a year the
 * only useful statement is "more than you will ever need".
 */
export const COVER_CAP_DAYS = 365
export function fmtCover(days: number): string {
  if (!isFinite(days) || days < 0) return '—'
  if (days >= COVER_CAP_DAYS) return `${COVER_CAP_DAYS}+ d`
  return `${Math.round(days)} d`
}

/** Recipe quantities: three decimals, but never rounding a trace input to zero. */
export function fmtRecipeQty(n: number): string {
  if (!isFinite(n)) return '—'
  if (n === 0) return '0'
  return String(n >= 1 ? +n.toFixed(3) : +n.toPrecision(2))
}

/** "157.1 – 208.6 t" — a range, not two numbers run together. */
export function fmtRange(lo: number, hi: number, unit = ''): string {
  if (!isFinite(lo) || !isFinite(hi)) return '—'
  const u = unit ? ` ${unit}` : ''
  return `${lo.toFixed(1)} – ${hi.toFixed(1)}${u}`
}

/**
 * Days until something is due, in the words the rest of the app uses.
 * Zero is "today", not "within 0 days" and not "overdue".
 */
export function fmtDue(days: number): string {
  if (!isFinite(days)) return '—'
  const d = Math.round(days)
  if (d < 0) return 'overdue'
  if (d === 0) return 'today'
  return `in ${d}d`
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

export function sum(a: number[]): number { return a.reduce((s, x) => s + x, 0) }
export function mean(a: number[]): number { return a.length ? sum(a) / a.length : 0 }
export function stdev(a: number[]): number {
  if (a.length < 2) return 0
  const m = mean(a)
  return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1))
}
export function median(a: number[]): number {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function titleCase(s: string): string {
  return s.replace(/(^|\s|-)\w/g, c => c.toUpperCase())
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}
