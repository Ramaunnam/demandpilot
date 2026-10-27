import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { X, ArrowUpRight, ArrowDownRight, Minus, ChevronRight, Info } from 'lucide-react'
import { GLOSSARY } from '@/content/glossary'
import { Wordmark } from './Logo'
import { usePalette } from './colors'

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'ai'

/** The whole status vocabulary. Deliberately small. */
const TONE_OF: Record<string, Tone> = {
  Healthy: 'success', OK: 'success', Good: 'success', Improving: 'success', Monitor: 'success',
  Stable: 'info', Review: 'warning', Watch: 'warning', 'Reorder now': 'warning', Excess: 'info',
  'Stockout risk': 'danger', 'Order now': 'danger', Critical: 'danger', Late: 'danger',
  High: 'warning', Medium: 'info', Low: 'neutral', Open: 'warning',
  'Getting worse': 'danger', Expedite: 'danger', 'Reduce / delay': 'info',
  Approved: 'success', Received: 'success', Sent: 'info', Confirmed: 'primary',
  'In transit': 'warning', Recommended: 'info', Cancelled: 'neutral',
  'Accepted as new trend': 'success', 'Ignored as one-off': 'neutral', Investigating: 'info',
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------
export function Chip({ tone = 'neutral', children, className = '' }: {
  tone?: Tone; children: ReactNode; className?: string
}) {
  return <span className={`chip chip-${tone} ${className}`}>{children}</span>
}

export function Status({ v }: { v: string }) {
  return <Chip tone={TONE_OF[v] ?? 'neutral'}>{v}</Chip>
}

/** A coloured dot — the lightest possible status signal. */
export function Dot({ tone = 'neutral', pulse }: { tone?: Tone; pulse?: boolean }) {
  const bg = {
    neutral: 'bg-muted', primary: 'bg-primary', success: 'bg-success',
    warning: 'bg-warning', danger: 'bg-danger', info: 'bg-info', ai: 'bg-ai',
  }[tone]
  return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${bg} ${pulse ? 'animate-pulseDot' : ''}`} />
}

// ---------------------------------------------------------------------------
// Label / value — the core data primitive
// ---------------------------------------------------------------------------
export function LV({ k, v, tone, mono = true }: {
  k: string; v: ReactNode; tone?: Tone; mono?: boolean
}) {
  const color = tone ? {
    neutral: '', primary: 'text-primary', success: 'text-success', warning: 'text-warning',
    danger: 'text-danger', info: 'text-info', ai: 'text-ai',
  }[tone] : ''
  return (
    <div className="min-w-0">
      <div className="text-2xs text-muted truncate">{k}</div>
      <div className={`text-base font-semibold truncate ${mono ? 'num' : ''} ${color}`}>{v}</div>
    </div>
  )
}

/** A row of label/value pairs inside a bordered strip. */
export function LVRow({ items, cols = 4 }: {
  items: { k: string; v: ReactNode; tone?: Tone }[]; cols?: number
}) {
  return (
    <div className={`grid gap-3 rounded-lg border border-line bg-surface2 px-3 py-2`}
      style={{ gridTemplateColumns: `repeat(${Math.min(cols, items.length)}, minmax(0,1fr))` }}>
      {items.map(i => <LV key={i.k} {...i} />)}
    </div>
  )
}

/**
 * One supporting number beside a narrative line. Smaller than a Tile, which is
 * a headline; a row of three of these is what a lead panel says after it has
 * made its point.
 */
export function Fact({ k, v, sub }: { k: string; v: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface2 px-2.5 py-1.5 min-w-0">
      <div className="text-2xs text-muted truncate">{k}</div>
      <div className="text-base font-semibold num truncate">{v}</div>
      {sub && <div className="text-2xs text-muted line-clamp-2">{sub}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------
export function Tile({ k, v, unit, delta, deltaGood, sub, tone, to, spark, onClick, term }: {
  k: string; v: string; unit?: string
  delta?: number; deltaGood?: 'up' | 'down'
  sub?: string; tone?: Tone; to?: string; spark?: number[]
  onClick?: () => void; term?: string
}) {
  const good = delta === undefined ? null : deltaGood === 'down' ? delta < 0 : delta > 0
  const ring = tone === 'danger' ? 'border-danger/35' : tone === 'warning' ? 'border-warning/35'
    : tone === 'success' ? 'border-success/35' : 'border-line'
  const body = (
    <>
      <div className="flex items-start justify-between gap-1">
        <span className="eyebrow truncate flex items-center">{k}{term && <Why term={term} />}</span>
        {(to || onClick) && <ChevronRight className="w-3 h-3 text-muted/60 shrink-0" />}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="num text-2xl font-bold leading-none tracking-tight">{v}</span>
        {unit && <span className="text-xs text-muted">{unit}</span>}
      </div>
      <div className="mt-1 flex items-center gap-1.5 min-h-[16px]">
        {delta !== undefined && (
          <span className={`num inline-flex items-center text-xs font-semibold ${
            good ? 'text-success' : good === false ? 'text-danger' : 'text-muted'}`}>
            {delta > 0 ? <ArrowUpRight className="w-3 h-3" /> : delta < 0 ? <ArrowDownRight className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
            {Math.abs(delta).toFixed(1)}
          </span>
        )}
        {sub && <span className="text-2xs text-muted truncate">{sub}</span>}
      </div>
      {spark && spark.length > 1 && <Spark data={spark} tone={tone} />}
    </>
  )
  const cls = `card pad block text-left ${ring} ${(to || onClick) ? 'hover:border-primary/40 hover:shadow-md transition-all' : ''}`
  if (to) return <Link to={to} className={cls}>{body}</Link>
  if (onClick) return <button onClick={onClick} className={cls}>{body}</button>
  return <div className={cls}>{body}</div>
}

export function Tiles({ children, cols = 'auto' }: { children: ReactNode; cols?: 'auto' | 4 | 5 | 6 }) {
  const c = cols === 'auto'
    ? 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6'
    : cols === 4 ? 'grid-cols-2 lg:grid-cols-4'
    : cols === 5 ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6'
  return <div className={`grid gap-2.5 ${c}`}>{children}</div>
}

export function Spark({ data, tone = 'primary', h = 22 }: { data: number[]; tone?: Tone; h?: number }) {
  if (data.length < 2) return null
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${100 - ((v - min) / span) * 100}`).join(' ')
  // SVG attributes cannot take CSS variables, so this must be a real colour.
  const p = usePalette()
  const stroke = { neutral: p.muted, primary: p.primary, success: p.success,
    warning: p.warning, danger: p.danger, info: p.info, ai: p.ai }[tone]
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height: h }} className="w-full mt-1.5" aria-hidden>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="3.5" vectorEffect="non-scaling-stroke"
        strokeLinecap="round" strokeLinejoin="round" opacity=".8" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Meters
// ---------------------------------------------------------------------------
export function Bar({ pct, tone = 'primary', h = 'h-1.5' }: { pct: number; tone?: Tone; h?: string }) {
  const bg = {
    neutral: 'bg-muted', primary: 'bg-primary', success: 'bg-success',
    warning: 'bg-warning', danger: 'bg-danger', info: 'bg-info', ai: 'bg-ai',
  }[tone]
  return (
    <div className={`w-full ${h} rounded-full bg-line/60 overflow-hidden`}>
      <div className={`h-full rounded-full ${bg} transition-all`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}

export function Ring({ v, size = 46, tone }: { v: number; size?: number; tone?: Tone }) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r
  const t = tone ?? (v >= 75 ? 'success' : v >= 50 ? 'warning' : 'danger')
  const p = usePalette()
  const stroke = { neutral: p.muted, primary: p.primary, success: p.success,
    warning: p.warning, danger: p.danger, info: p.info, ai: p.ai }[t]
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.grid} strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={stroke} strokeWidth="5"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(100, v)) / 100)} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="num text-xs font-bold">{v}</span>
      </div>
    </div>
  )
}

/** Weighted signal bars — used wherever the system explains a score. */
export function Signals({ items }: { items: { name: string; weight: number; value: string }[] }) {
  return (
    <div className="space-y-1">
      {items.map(s => (
        <div key={s.name} className="grid grid-cols-[96px_1fr_auto] items-center gap-2">
          <span className="text-2xs text-muted truncate">{s.name}</span>
          <Bar pct={s.weight * 100} h="h-1" />
          <span className="num text-2xs text-muted text-right whitespace-nowrap">{s.value}</span>
        </div>
      ))}
    </div>
  )
}

export function Confidence({ v }: { v: number }) {
  return <Chip tone={v >= 80 ? 'success' : v >= 60 ? 'warning' : 'neutral'}><span className="num">{v}%</span></Chip>
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------
export function Panel({ title, right, children, className = '', pad = true, note }: {
  title?: string; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean; note?: string
}) {
  return (
    <section className={`card min-w-0 ${pad ? 'pad' : ''} ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-2 mb-2.5">
          {title && <h3 className="h2">{title}</h3>}
          {right && <div className="flex items-center gap-1.5 shrink-0">{right}</div>}
        </header>
      )}
      {children}
      {note && <p className="text-2xs text-muted mt-2 pt-2 border-t border-line">{note}</p>}
    </section>
  )
}

/** Page header: title, a short blurb (one line, never a paragraph), actions. */
export function Head({ title, blurb, actions, chips }: {
  title: string; blurb: string; actions?: ReactNode; chips?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="h1">{title}</h1>
          {chips}
        </div>
        <p className="sub mt-0.5">{blurb}</p>
      </div>
      {actions && <div className="flex items-center gap-1.5 flex-wrap no-print">{actions}</div>}
    </div>
  )
}

export function Tabs({ tabs, active, onChange }: {
  tabs: { id: string; label: string; n?: number }[]; active: string; onChange: (id: string) => void
}) {
  return (
    <div className="flex gap-0.5 p-0.5 rounded-lg bg-surface2 border border-line mb-3 overflow-x-auto no-scrollbar w-fit max-w-full">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`px-2.5 h-7 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
            active === t.id ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>
          {t.label}
          {t.n !== undefined && <span className="num ml-1 text-2xs opacity-60">{t.n}</span>}
        </button>
      ))}
    </div>
  )
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-center py-10">
      <p className="text-md font-semibold">{title}</p>
      {hint && <p className="sub mt-0.5">{hint}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drawer — replaces separate detail pages
// ---------------------------------------------------------------------------
export function Drawer({ open, onClose, title, sub, chips, children, footer }: {
  open: boolean; onClose: () => void; title: string; sub?: string
  chips?: ReactNode; children: ReactNode; footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 no-print" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-[640px] bg-bg border-l border-line
                      shadow-lg flex flex-col animate-slideIn">
        <header className="flex items-start gap-3 px-4 py-3 border-b border-line bg-surface shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold tracking-tight truncate">{title}</h2>
              {chips}
            </div>
            {sub && <p className="sub mt-0.5">{sub}</p>}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="flex-1 overflow-auto p-4 space-y-3">{children}</div>
        {footer && <footer className="px-4 py-3 border-t border-line bg-surface shrink-0">{footer}</footer>}
      </div>
    </div>
  )
}

export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4 no-print" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <div className={`relative card shadow-lg w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[86vh] flex flex-col animate-scaleIn`}>
        <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-line">
          <h3 className="h2">{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></button>
        </header>
        <div className="p-4 overflow-auto">{children}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Explain — the formula behind a number, on demand only
// ---------------------------------------------------------------------------
export function Why({ term, text }: { term?: string; text?: string }) {
  const [open, setOpen] = useState(false)
  const body = text ?? (term ? GLOSSARY[term] : undefined)
  if (!body) return null
  return (
    <>
      <button onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}
        className="text-muted/60 hover:text-primary transition-colors align-middle ml-0.5"
        aria-label={`What is ${term ?? 'this'}?`}>
        <Info className="w-3 h-3" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={term ?? 'How this works'}>
        <p className="text-base leading-relaxed">{body}</p>
      </Modal>
    </>
  )
}

/** A number you can click to see its formula with the real values in it. */
export function Calc({ v, label, formula }: { v: string; label: string; formula: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} className="link num font-semibold" title="Show the calculation">{v}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={label}>
        <div className="num text-2xl font-bold mb-2">{v}</div>
        <p className="text-base leading-relaxed text-muted">{formula}</p>
      </Modal>
    </>
  )
}

export function Field({ label, children, term }: { label: string; children: ReactNode; term?: string }) {
  return (
    <div>
      <label className="lbl flex items-center">{label}{term && <Why term={term} />}</label>
      {children}
    </div>
  )
}

export function Loading({ stage, pct }: { stage: string; pct: number }) {
  return (
    <div className="grid place-items-center min-h-[70vh]">
      <div className="w-full max-w-xs text-center">
        <div className="grid place-items-center mb-3"><Wordmark height={44} /></div>
        <p className="text-md font-semibold">Running the plan</p>
        <p className="sub mb-3">{stage}</p>
        <Bar pct={pct} />
        <p className="text-2xs text-muted mt-2">960 series · 3 models each</p>
      </div>
    </div>
  )
}
