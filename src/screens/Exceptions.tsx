import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, X, CheckCheck } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Head, Tile, Tiles, Panel, Chip, Status, Confidence, Signals, Empty, Drawer, LVRow } from '@/ui/kit'
import { Chart, Bars, useC } from '@/ui/charts'
import { fmtINR, fmtNum, fmtDue } from '@/lib/format'
import {
  selectExceptions, selectDueBuckets, selectQueueCounts, selectValueAtStakeINR, isOverdue,
  selectDecidedRecIds,
} from '@/engine/selectors'
import type { WorkbenchItem } from '@/engine'

export default function Exceptions() {
  const C = useC()
  const { result, dismissed, dismissItem, approveRecommendation, toast, approvals, rejected } = useStore()
  const nav = useNavigate()
  const r = result!
  const [q, setQ] = useState('All')
  const [sel, setSel] = useState<string[]>([])
  const [showAll, setShowAll] = useState(false)
  const PAGE = 10
  const [open, setOpen] = useState<WorkbenchItem | null>(null)

  // One list. Every count, chip and chart below is derived from it rather than
  // re-filtered from the raw result, which is how the badge, the tile and the
  // due-chart used to disagree with each other.
  const all = useMemo(
    () => selectExceptions(r, dismissed, selectDecidedRecIds(approvals, rejected)),
    [r, dismissed, approvals, rejected])
  const items = useMemo(() => all.filter(w => q === 'All' || w.queue === q), [all, q])
  const counts = useMemo(() => selectQueueCounts(all), [all])

  // The queue by shape and by clock. Together they say what the day looks like.
  const queueNames = useMemo(() => Object.keys(counts).sort(), [counts])
  const byQueue = useMemo(() => queueNames.map(x => ({
    name: x,
    urgent: all.filter(w => w.queue === x && (w.severity === 'Critical' || w.severity === 'High')).length,
    rest: all.filter(w => w.queue === x && w.severity !== 'Critical' && w.severity !== 'High').length,
  })).filter(x => x.urgent + x.rest > 0), [all, queueNames])

  const byDue = useMemo(() => selectDueBuckets(all), [all])

  const accept = (w: WorkbenchItem) => {
    const rec = r.recommendations.find(x => `WB-${x.id}` === w.id)
    if (rec) approveRecommendation(rec.id, rec.qty, 'Accepted from Exceptions.')
    else toast(`${w.subject} accepted.`, 'good')
    dismissItem(w.id); setOpen(null)
  }

  return (
    <>
      <Head
        title="Exceptions"
        blurb="Everything waiting on a decision, ranked by how soon it must be made"
        actions={sel.length > 0 && (
          <button className="btn btn-primary btn-sm" onClick={() => { sel.forEach(id => { const w = all.find(x => x.id === id); if (w) accept(w) }); setSel([]) }}>
            <CheckCheck className="w-3 h-3" /> Accept {sel.length}
          </button>
        )}
      />

      <Tiles cols={5}>
        <Tile k="Open" v={fmtNum(all.length)} />
        <Tile k="Critical" v={fmtNum(all.filter(w => w.severity === 'Critical').length)} tone="danger" />
        <Tile k="High" v={fmtNum(all.filter(w => w.severity === 'High').length)} tone="warning" />
        <Tile k="Confident" v={fmtNum(all.filter(w => w.confidence >= 80).length)} sub="80%+" tone="success" />
        <Tile k="Value at stake" v={fmtINR(selectValueAtStakeINR(all))} sub="spend + release" />
      </Tiles>

      <div className="grid gap-3 lg:grid-cols-2 mt-3">
        <Chart title="What the queue is made of" h={190}
          note="Critical and high severity are counted separately: those are the ones with a deadline that has teeth.">
          <Bars data={byQueue} x="name" h stacked
            bars={[{ k: 'urgent', name: 'Critical / high', color: C.danger },
                   { k: 'rest', name: 'Medium / low', color: C.info }]} />
        </Chart>
        <Chart title="When each decision is due" h={190}
          note="Anything in the first two columns needs a person today.">
          <Bars data={byDue} x="name" bars={[{ k: 'n', name: 'Items', color: C.primary }]} />
        </Chart>
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        <button onClick={() => setQ('All')} className={`chip ${q === 'All' ? 'chip-primary' : 'chip-neutral'}`}>All {all.length}</button>
        {queueNames.filter(x => counts[x] > 0).map(x => (
          <button key={x} onClick={() => setQ(x)} className={`chip ${q === x ? 'chip-primary' : 'chip-neutral'}`}>{x} {counts[x]}</button>
        ))}
      </div>

      {items.length === 0 ? <Panel><Empty title="Queue clear" hint="Nothing waiting in this filter." /></Panel> : (
        <div className="space-y-1.5">
          {(showAll ? items : items.slice(0, PAGE)).map(w => (
            <div key={w.id} className={`card pad flex flex-wrap items-center gap-2.5 ${w.severity === 'Critical' ? 'border-danger/30' : ''}`}>
              <input type="checkbox" checked={sel.includes(w.id)} aria-label={`Select ${w.title}`}
                onChange={() => setSel(s => s.includes(w.id) ? s.filter(x => x !== w.id) : [...s, w.id])} />
              <Status v={w.severity} />
              <Chip tone="neutral">{w.queue}</Chip>
              <button className="link font-mono text-sm shrink-0" onClick={() =>
                nav(w.subjectKind === 'material' ? `/stock?m=${w.subjectId}` : w.subjectKind === 'sku' ? `/forecast?s=${w.subjectId}` : '/plan')}>
                {w.subject}
              </button>
              <div className="min-w-[180px] flex-1">
                <div className="text-base font-medium truncate">{w.title}</div>
                <div className="text-2xs text-muted truncate">{w.recommendedAction}</div>
              </div>
              <Confidence v={w.confidence} />
              <span className="num text-2xs text-muted w-14 text-right">
                {isOverdue(w.dueInDays)
                  ? <span className="text-danger font-bold">overdue</span>
                  : fmtDue(w.dueInDays)}
              </span>
              <div className="flex gap-1">
                <button className="btn btn-soft btn-xs" onClick={() => setOpen(w)}>Why</button>
                <button className="btn btn-primary btn-xs" onClick={() => accept(w)}><Check className="w-3 h-3" /></button>
                <button className="btn btn-ghost btn-xs" onClick={() => dismissItem(w.id)}><X className="w-3 h-3" /></button>
              </div>
            </div>
          ))}
          {items.length > PAGE && (
            <button className="btn btn-outline btn-sm w-full" onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Show fewer' : `Show all ${items.length}`}
            </button>
          )}
        </div>
      )}

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.subject ?? ''}
        sub={open?.title} chips={open && <><Status v={open.severity} /><Confidence v={open.confidence} /></>}
        footer={open && (
          <div className="flex gap-1.5">
            <button className="btn btn-primary btn-md flex-1" onClick={() => accept(open)}><Check className="w-4 h-4" /> Accept</button>
            <button className="btn btn-outline btn-md" onClick={() => { dismissItem(open.id); setOpen(null) }}>Dismiss</button>
          </div>
        )}>
        {open && (
          <>
            <Panel title="Recommended">
              <p className="text-base">{open.recommendedAction}</p>
            </Panel>
            <Panel title="Why">
              <p className="text-base text-muted mb-2.5">{open.reason}</p>
              <Signals items={open.signals} />
            </Panel>
            <LVRow cols={3} items={[
              { k: 'Queue', v: open.queue },
              { k: 'Due', v: fmtDue(open.dueInDays), tone: isOverdue(open.dueInDays) ? 'danger' : undefined },
              { k: 'Value', v: fmtINR(Math.abs(open.valueINR)) },
            ]} />
          </>
        )}
      </Drawer>
    </>
  )
}
