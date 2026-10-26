import { useMemo, useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CornerDownLeft } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { NAV } from './Shell'
import { Chip } from './kit'

interface Hit { label: string; sub: string; to: string; group: string }

export default function Palette() {
  const { commandOpen, setCommandOpen, ds, result } = useStore()
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const nav = useNavigate()
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { if (commandOpen) { setQ(''); setI(0); setTimeout(() => ref.current?.focus(), 20) } }, [commandOpen])
  useEffect(() => { setI(0) }, [q])

  const all = useMemo<Hit[]>(() => {
    const out: Hit[] = []
    for (const g of NAV) for (const it of g.items) out.push({ label: it.label, sub: g.group, to: it.to, group: 'Screen' })
    out.push({ label: 'Settings', sub: 'Parameters, alerts, master data', to: '/setup', group: 'Screen' })
    out.push({ label: 'Model accuracy', sub: 'Which model wins, and by how much', to: '/forecast?tab=accuracy', group: 'Screen' })
    for (const s of ds.skus) out.push({ label: s.code, sub: s.name, to: `/forecast?s=${s.id}`, group: 'Product' })
    for (const m of ds.materials) out.push({ label: `${m.code} ${m.name}`, sub: `${m.category} · ${m.leadTimeDays}d lead`, to: `/stock?m=${m.id}`, group: 'Material' })
    for (const s of ds.suppliers) out.push({ label: s.name, sub: `${s.leadTimeDays}d · ${s.otifPct}% on time`, to: '/setup', group: 'Supplier' })
    for (const s of ds.signals.slice(0, 16)) out.push({ label: s.title, sub: s.sourceType, to: '/signals', group: 'Signal' })
    for (const a of (result?.anomalies ?? []).slice(0, 30)) out.push({ label: `${a.skuCode} · ${a.region}`, sub: `${a.deltaPct > 0 ? '+' : ''}${a.deltaPct.toFixed(0)}% vs forecast`, to: '/anomalies', group: 'Anomaly' })
    for (const x of result?.recommendations ?? []) out.push({ label: `${x.materialCode} ${x.materialName}`, sub: `${x.type} · ${x.supplierName.split('—')[0].trim()}`, to: '/buy', group: 'Recommendation' })
    return out
  }, [ds, result])

  const hits = useMemo(() => {
    if (!q.trim()) return all.filter(h => h.group === 'Screen')
    const n = q.toLowerCase()
    return all.filter(h => h.label.toLowerCase().includes(n) || h.sub.toLowerCase().includes(n)).slice(0, 40)
  }, [q, all])

  if (!commandOpen) return null
  const go = (h: Hit) => { setCommandOpen(false); nav(h.to) }

  return (
    <div className="fixed inset-0 z-[80] p-4 pt-[12vh] no-print" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={() => setCommandOpen(false)} />
      <div className="relative mx-auto max-w-lg card shadow-lg overflow-hidden animate-scaleIn">
        <div className="flex items-center gap-2 px-3 border-b border-line">
          <Search className="w-3.5 h-3.5 text-muted shrink-0" />
          <input ref={ref} value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setI(x => Math.min(x + 1, hits.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(x - 1, 0)) }
              if (e.key === 'Enter' && hits[i]) go(hits[i])
              if (e.key === 'Escape') setCommandOpen(false)
            }}
            placeholder="Product, material, supplier, screen"
            className="flex-1 h-11 bg-transparent text-md outline-none placeholder:text-muted/70" />
          <kbd className="text-2xs text-muted px-1 rounded border border-line">Esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-auto py-1">
          {hits.length === 0 && <div className="px-3 py-6 text-center text-base text-muted">Nothing matched</div>}
          {hits.map((h, k) => (
            <button key={`${h.to}-${k}`} onClick={() => go(h)} onMouseEnter={() => setI(k)}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${k === i ? 'bg-primary-soft' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="text-base font-medium truncate">{h.label}</div>
                <div className="text-2xs text-muted truncate">{h.sub}</div>
              </div>
              <Chip tone="neutral">{h.group}</Chip>
              {k === i && <CornerDownLeft className="w-3 h-3 text-muted shrink-0" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
