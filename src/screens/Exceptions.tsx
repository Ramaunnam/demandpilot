/**
 * Exceptions — everything waiting on a decision.
 *
 * The queue tab is the working surface and is deliberately unchanged in shape:
 * a row per item, with Why / accept / dismiss on it. What was missing was any
 * way to see the queue as a whole. A list of 23 rows does not tell you that
 * four of them are the same material, or that most of the value sits in two
 * entries, or which ones the engine is least sure about — so those are the
 * other three tabs.
 *
 * Every count, chart and roll-up derives from the one list `selectExceptions()`
 * returns. `rankQueue()` is shared with Health, so both screens nominate the
 * same item as the one to do first — `queueBrief()` still supplies the tiles
 * and the header chips, which is all that is left of it on this screen.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, X, CheckCheck, ChevronRight } from 'lucide-react'
import { useStore } from '@/store/useStore'
import {
  Head, Tile, Tiles, Panel, Chip, Status, Confidence, Signals, Empty, Drawer,
  LVRow, Tabs, Bar,
} from '@/ui/kit'
import { Chart, Bars, useC } from '@/ui/charts'
import { fmtINR, fmtINRShort, fmtNum, fmtDue } from '@/lib/format'
import {
  selectExceptions, selectDueBuckets, selectQueueCounts, selectValueAtStakeINR, isOverdue,
  selectDecidedRecIds,
} from '@/engine/selectors'
import {
  queueBrief, repeatSubjects, valueByQueue, confidenceBands, rankQueue,
} from '@/engine/briefing'
import type { WorkbenchItem } from '@/engine'

type TabId = 'queue' | 'deadline' | 'repeat' | 'value'

export default function Exceptions() {
  const C = useC()
  const { result, dismissed, dismissItem, approveRecommendation, toast, approvals, rejected } = useStore()
  const nav = useNavigate()
  const r = result!
  const [tab, setTab] = useState<TabId>('queue')
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
  const items = useMemo(
    () => rankQueue(all.filter(w => q === 'All' || w.queue === q)), [all, q])
  const counts = useMemo(() => selectQueueCounts(all), [all])

  const brief = useMemo(() => queueBrief(all), [all])
  const repeats = useMemo(() => repeatSubjects(all), [all])
  const byValue = useMemo(() => valueByQueue(all), [all])
  const byConfidence = useMemo(() => confidenceBands(all), [all])

  // The queue by shape and by clock. Together they say what the day looks like.
  const queueNames = useMemo(() => Object.keys(counts).sort(), [counts])
  const byQueue = useMemo(() => queueNames.map(x => ({
    name: x,
    urgent: all.filter(w => w.queue === x && (w.severity === 'Critical' || w.severity === 'High')).length,
    rest: all.filter(w => w.queue === x && w.severity !== 'Critical' && w.severity !== 'High').length,
  })).filter(x => x.urgent + x.rest > 0), [all, queueNames])

  const byDue = useMemo(() => selectDueBuckets(all), [all])

  /** The items a person has to clear today, worst first. */
  const nowList = useMemo(() => rankQueue(all.filter(w => w.dueInDays <= 0)), [all])

  const accept = (w: WorkbenchItem) => {
    const rec = r.recommendations.find(x => `WB-${x.id}` === w.id)
    if (rec) approveRecommendation(rec.id, rec.qty, 'Accepted from Exceptions.')
    else toast(`${w.subject} accepted.`, 'good')
    dismissItem(w.id); setOpen(null)
  }

  const Row = ({ w }: { w: WorkbenchItem }) => (
    <div className={`card pad flex flex-wrap items-center gap-2.5 ${w.severity === 'Critical' ? 'border-danger/30' : ''}`}>
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
        <button className="btn btn-primary btn-xs" onClick={() => accept(w)} aria-label="Accept"><Check className="w-3 h-3" /></button>
        <button className="btn btn-ghost btn-xs" onClick={() => dismissItem(w.id)} aria-label="Dismiss"><X className="w-3 h-3" /></button>
      </div>
    </div>
  )

  return (
    <>
      <Head
        title="Exceptions"
        blurb="Everything waiting on a decision, ranked by how soon it must be made"
        chips={
          <>
            {brief.overdue > 0 && <Chip tone="danger">{brief.overdue} overdue</Chip>}
            {brief.lowConfidence > 0 && <Chip tone="warning">{brief.lowConfidence} to read first</Chip>}
          </>
        }
        actions={sel.length > 0 && (
          <button className="btn btn-primary btn-sm" onClick={() => { sel.forEach(id => { const w = all.find(x => x.id === id); if (w) accept(w) }); setSel([]) }}>
            <CheckCheck className="w-3 h-3" /> Accept {sel.length}
          </button>
        )}
      />

      <Tiles cols={5}>
        <Tile k="Open" v={fmtNum(all.length)} onClick={() => { setTab('queue'); setQ('All') }} />
        <Tile k="Needs a person today" v={fmtNum(brief.overdue + brief.today)}
          sub={`${brief.overdue} overdue · ${brief.today} due today`}
          tone={brief.overdue ? 'danger' : brief.today ? 'warning' : 'success'} onClick={() => setTab('deadline')} />
        <Tile k="Same subject twice" v={fmtNum(repeats.length)}
          sub={repeats[0] ? `worst: ${repeats[0].subject}` : 'none repeating'}
          tone={repeats.length ? 'info' : 'success'} onClick={() => setTab('repeat')} />
        <Tile k="Low confidence" v={fmtNum(brief.lowConfidence)} sub="under 60% — read the reasoning"
          tone={brief.lowConfidence ? 'warning' : 'success'} onClick={() => setTab('value')} />
        <Tile k="Value at stake" v={fmtINR(selectValueAtStakeINR(all))} sub="spend + release"
          onClick={() => setTab('value')} />
      </Tiles>

      <div className="mt-3">
        <Tabs active={tab} onChange={id => setTab(id as TabId)} tabs={[
          { id: 'queue', label: 'The queue', n: all.length },
          { id: 'deadline', label: 'By deadline', n: brief.overdue + brief.today },
          { id: 'repeat', label: 'Same subject', n: repeats.length },
          { id: 'value', label: "What it's worth" },
        ]} />
      </div>

      {/* ---------------- The queue ---------------- */}
      {tab === 'queue' && (
        <>
          <div className="flex flex-wrap gap-1 mb-3">
            <button onClick={() => setQ('All')} className={`chip ${q === 'All' ? 'chip-primary' : 'chip-neutral'}`}>All {all.length}</button>
            {queueNames.filter(x => counts[x] > 0).map(x => (
              <button key={x} onClick={() => setQ(x)} className={`chip ${q === x ? 'chip-primary' : 'chip-neutral'}`}>{x} {counts[x]}</button>
            ))}
          </div>

          {items.length === 0 ? <Panel><Empty title="Queue clear" hint="Nothing waiting in this filter." /></Panel> : (
            <div className="space-y-1.5">
              {(showAll ? items : items.slice(0, PAGE)).map(w => <Row key={w.id} w={w} />)}
              {items.length > PAGE && (
                <button className="btn btn-outline btn-sm w-full" onClick={() => setShowAll(v => !v)}>
                  {showAll ? 'Show fewer' : `Show all ${items.length}`}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* ---------------- By deadline ---------------- */}
      {tab === 'deadline' && (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <Chart title="When each decision is due" h={190}
              note="Anything in the first two columns needs a person today. The buckets and the rows below read the same date field, so they cannot disagree.">
              <Bars data={byDue} x="name" bars={[{ k: 'n', name: 'Items', color: C.primary }]} />
            </Chart>
            <Chart title="What the queue is made of" h={190}
              note="Critical and high severity are counted separately: those are the ones with a deadline that has teeth.">
              <Bars data={byQueue} x="name" stacked
                bars={[{ k: 'urgent', name: 'Critical / high', color: C.danger },
                       { k: 'rest', name: 'Medium / low', color: C.info }]} />
            </Chart>
          </div>

          <Panel className="mt-3" title={`Needs a person today — ${nowList.length}`}
            note="Overdue first, then due today. Same ranking the Health screen uses for its short list.">
            {nowList.length === 0
              ? <Empty title="Nothing due today" hint="The soonest decision is still ahead of its date." />
              : <div className="space-y-1.5">{nowList.map(w => <Row key={w.id} w={w} />)}</div>}
          </Panel>
        </>
      )}

      {/* ---------------- Same subject ---------------- */}
      {tab === 'repeat' && (
        repeats.length === 0 ? (
          <Panel><Empty title="No subject appears twice"
            hint="Every item in the queue is about a different material, product or line." /></Panel>
        ) : (
          <>
            <Panel title="One subject, several items"
              note="A material with an order-now, an expedite and an unusual-demand entry is three rows in the queue but one conversation with one supplier. Clearing it as a group is usually faster than working the list top to bottom.">
              <div className="space-y-2">
                {repeats.map(x => (
                  <div key={x.subjectId} className="rounded-lg border border-line bg-surface2 px-2.5 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Status v={x.worst} />
                      <button className="link font-mono text-sm" onClick={() => nav(x.linkId)}>{x.subject}</button>
                      <span className="text-2xs text-muted">{x.items.length} items</span>
                      <div className="flex-1" />
                      <span className="num text-base font-semibold">{fmtINRShort(x.valueINR)}</span>
                      <span className="num text-2xs text-muted w-16 text-right">
                        {x.soonestDays <= 0
                          ? <span className="text-danger font-bold">{fmtDue(x.soonestDays)}</span>
                          : fmtDue(x.soonestDays)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {x.queues.map(qn => <Chip key={qn} tone="neutral">{qn}</Chip>)}
                    </div>
                    <ul className="mt-1.5 space-y-0.5">
                      {x.items.map(w => (
                        <li key={w.id} className="flex items-center gap-2 text-2xs text-muted">
                          <ChevronRight className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate flex-1">{w.title}</span>
                          <button className="link shrink-0" onClick={() => setOpen(w)}>why</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Panel>
            <p className="text-2xs text-muted mt-2">
              {repeats.reduce((s, x) => s + x.items.length, 0)} of {all.length} items in the queue are
              about {repeats.length} subject{repeats.length === 1 ? '' : 's'}.
            </p>
          </>
        )
      )}

      {/* ---------------- What it's worth ---------------- */}
      {tab === 'value' && (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <Chart title="Spend and release, by queue" h={210}
              note="Kept as two bars rather than one net figure: a queue that wants ₹10 Cr spent and another that frees ₹10 Cr are not the same as a queue that does nothing.">
              <Bars data={byValue} x="name" unit=" ₹"
                bars={[{ k: 'spend', name: 'To spend', color: C.danger },
                       { k: 'release', name: 'To release', color: C.success }]} />
            </Chart>
            <Chart title="How sure the engine is" h={210}
              note="Confidence comes from the signals behind each item, shown under Why. Anything under 60% is worth reading before accepting.">
              <Bars data={byConfidence} x="name" bars={[{ k: 'n', name: 'Items', color: C.primary }]} />
            </Chart>
          </div>

          <Panel className="mt-3" title="Biggest items by value" pad={false}>
            <div className="divide-y divide-line/70">
              {[...all].sort((a, b) => Math.abs(b.valueINR) - Math.abs(a.valueINR)).slice(0, 10).map(w => (
                <div key={w.id} className="px-3.5 py-2 flex items-center gap-2.5">
                  <Status v={w.severity} />
                  <span className="hidden sm:inline-flex"><Chip tone="neutral">{w.queue}</Chip></span>
                  <span className="text-base font-medium truncate flex-1 min-w-0">{w.title}</span>
                  <div className="hidden lg:block w-20"><Bar pct={w.confidence} tone={w.confidence >= 80 ? 'success' : 'warning'} /></div>
                  <span className={`num text-base font-semibold w-20 text-right ${w.valueINR < 0 ? 'text-success' : ''}`}>
                    {w.valueINR < 0 ? '+' : ''}{fmtINRShort(Math.abs(w.valueINR))}
                  </span>
                  <button className="btn btn-soft btn-xs" onClick={() => setOpen(w)}>Why</button>
                </div>
              ))}
            </div>
            <p className="text-2xs text-muted px-3.5 py-2 border-t border-line">
              A figure in green is cash coming back rather than going out. Value at stake adds the two
              together, because both are money a decision moves.
            </p>
          </Panel>
        </>
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
            {(() => {
              const siblings = all.filter(w => w.subjectId === open.subjectId && w.id !== open.id)
              return siblings.length === 0 ? null : (
                <Panel title={`Also waiting on ${open.subject}`}
                  note="Deciding these together is usually one conversation rather than three.">
                  <div className="space-y-1">
                    {siblings.map(w => (
                      <button key={w.id} onClick={() => setOpen(w)}
                        className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface2 transition-colors">
                        <Status v={w.severity} />
                        <span className="text-base truncate flex-1">{w.title}</span>
                        <span className="num text-2xs text-muted">{fmtDue(w.dueInDays)}</span>
                      </button>
                    ))}
                  </div>
                </Panel>
              )
            })()}
          </>
        )}
      </Drawer>
    </>
  )
}
