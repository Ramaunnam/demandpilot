import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, ArrowRight, ArrowLeft } from 'lucide-react'
import { useStore } from '@/store/useStore'

/** Seven steps, one short line each. */
export const TOUR = [
  { to: '/', t: 'One dashboard', b: 'Forecast, materials and purchases all from the same calculation.' },
  { to: '/signals', t: 'A signal arrives', b: 'New pharma plants announced in the South. Those buyers specify 316L.' },
  { to: '/anomalies', t: 'Caught in days', b: 'South 316L is running above forecast. Flagged in the week it showed up, not five weeks later.' },
  { to: '/forecast?tab=accuracy', t: 'Why trust it', b: 'Three models fitted per product; the one that back-tested best is kept.' },
  { to: '/stock', t: 'The knock-on', b: '316L needs molybdenum — six-week lead, and the order-by date has passed.' },
  { to: '/plan', t: 'Plan to materials', b: 'Run MRP: forecast, capacity, recipes, netting, planned orders.' },
  { to: '/buy', t: 'A person decides', b: 'Quantity, supplier, order-by date, confidence. Nothing is ordered automatically.' },
  { to: '/proof', t: 'The proof', b: 'Same 16 weeks, two methods, one engine. Far fewer stockouts — and the stock trade-off shown in full.' },
]

export default function Tour() {
  const { tourStep, setTourStep } = useStore()
  const nav = useNavigate()

  useEffect(() => { if (tourStep !== null && TOUR[tourStep]) nav(TOUR[tourStep].to) }, [tourStep, nav])
  useEffect(() => {
    if (tourStep === null) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTourStep(null)
      if (e.key === 'ArrowRight') setTourStep(Math.min(tourStep + 1, TOUR.length - 1))
      if (e.key === 'ArrowLeft') setTourStep(Math.max(tourStep - 1, 0))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [tourStep, setTourStep])

  if (tourStep === null) return null
  const s = TOUR[tourStep]
  if (!s) return null
  const last = tourStep === TOUR.length - 1

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[75] w-[min(520px,calc(100vw-2rem))] no-print">
      <div className="card shadow-lg pad border-primary/40 animate-fadeUp">
        <div className="flex items-start gap-2.5">
          <span className="num w-6 h-6 rounded-lg bg-primary text-primary-fg grid place-items-center text-2xs font-bold shrink-0">{tourStep + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-base font-bold">{s.t}</h4>
              <button className="btn btn-ghost btn-xs" onClick={() => setTourStep(null)}><X className="w-3.5 h-3.5" /></button>
            </div>
            <p className="text-sm text-muted mt-0.5">{s.b}</p>
            <div className="flex items-center gap-1.5 mt-2.5">
              <div className="flex gap-1 flex-1">
                {TOUR.map((_, i) => (
                  <button key={i} onClick={() => setTourStep(i)} aria-label={`Step ${i + 1}`}
                    className={`h-1 rounded-full transition-all ${i === tourStep ? 'w-4 bg-primary' : 'w-1 bg-line hover:bg-line-strong'}`} />
                ))}
              </div>
              <button className="btn btn-outline btn-xs" disabled={tourStep === 0} onClick={() => setTourStep(tourStep - 1)}>
                <ArrowLeft className="w-3 h-3" />
              </button>
              <button className="btn btn-primary btn-xs" onClick={() => last ? setTourStep(null) : setTourStep(tourStep + 1)}>
                {last ? 'Done' : <>Next <ArrowRight className="w-3 h-3" /></>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
