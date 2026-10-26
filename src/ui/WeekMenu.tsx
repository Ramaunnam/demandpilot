import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { weekDate, REAL_TODAY } from '@/data/generate'
import { fmtDate, fmtDateShort, addDays, MONTHS } from '@/lib/format'
import { Chip, Dot } from './kit'

const MAX_AHEAD = 12

/**
 * The planning-week control in the top bar.
 * Shows the real date, and opens a small calendar for moving the planning week.
 */
export default function WeekMenu() {
  const { ds, weeksAdvanced, stepWeek, setWeeksAdvanced, resetDemo, loading } = useStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [open])

  const week = ds.todayWeek + weeksAdvanced
  const start = weekDate(ds, week)
  const end = addDays(start, 6)
  const sameMonth = start.getMonth() === end.getMonth()
  const range = sameMonth
    ? `${start.getDate()}–${end.getDate()} ${MONTHS[end.getMonth()]}`
    : `${fmtDateShort(start)} – ${fmtDateShort(end)}`

  // the seven days of the planning week, with the real today marked
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const isToday = (d: Date) => d.toDateString() === REAL_TODAY.toDateString()

  const weeks = Array.from({ length: MAX_AHEAD + 1 }, (_, i) => i)

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 h-8 px-2 rounded-lg border border-line bg-surface
                   hover:bg-surface2 transition-colors"
        title="Planning week">
        <Dot tone={loading ? 'warning' : 'success'} pulse={loading} />
        {/* Once the demo is advanced, the header has to say which week is being
            planned. Showing the real date throughout made every screen look as
            though it had not moved. */}
        <span className="num text-sm font-semibold">
          {weeksAdvanced > 0 ? `w/c ${fmtDateShort(start)}` : fmtDateShort(REAL_TODAY)}
        </span>
        <CalendarDays className="w-3.5 h-3.5 text-muted" />
        {weeksAdvanced > 0 && <Chip tone="primary">+{weeksAdvanced}w</Chip>}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-72 card shadow-lg p-3 animate-scaleIn">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div>
              <div className="eyebrow">Today</div>
              <div className="num text-base font-bold">{fmtDate(REAL_TODAY)}</div>
            </div>
            <div className="text-right">
              <div className="eyebrow">Planning week</div>
              <div className="num text-base font-bold">{range}</div>
            </div>
          </div>

          {/* the week, day by day */}
          <div className="grid grid-cols-7 gap-0.5 mb-2">
            {days.map(d => (
              <div key={d.toISOString()}
                className={`rounded-md py-1 text-center ${isToday(d)
                  ? 'bg-primary text-primary-fg' : 'bg-surface2 text-muted'}`}>
                <div className="text-[9px] uppercase leading-tight opacity-70">
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'][(d.getDay() + 6) % 7]}
                </div>
                <div className="num text-xs font-bold leading-tight">{d.getDate()}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1 mb-2">
            <button className="btn btn-outline btn-sm flex-1" disabled={weeksAdvanced === 0 || loading}
              onClick={() => stepWeek(-1)}>
              <ChevronLeft className="w-3.5 h-3.5" /> Back
            </button>
            <button className="btn btn-primary btn-sm flex-1" disabled={weeksAdvanced >= MAX_AHEAD || loading}
              onClick={() => stepWeek(1)}>
              Advance 1 week <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="eyebrow mb-1">Jump to</div>
          <div className="grid grid-cols-7 gap-0.5 mb-2">
            {weeks.map(w => (
              <button key={w} onClick={() => setWeeksAdvanced(w)} disabled={loading}
                title={fmtDate(weekDate(ds, ds.todayWeek + w))}
                className={`num rounded-md py-1 text-xs font-semibold transition-colors ${
                  w === weeksAdvanced ? 'bg-primary text-primary-fg'
                    : 'bg-surface2 text-muted hover:bg-line/40'}`}>
                {w === 0 ? 'now' : `+${w}`}
              </button>
            ))}
          </div>

          <button className="btn btn-ghost btn-sm w-full" onClick={() => { resetDemo(); setOpen(false) }}>
            <RotateCcw className="w-3.5 h-3.5" /> Reset demo
          </button>

          <p className="text-2xs text-muted mt-2 pt-2 border-t border-line">
            Advancing feeds in the next week of actual orders. Every screen recalculates.
          </p>
        </div>
      )}
    </div>
  )
}
