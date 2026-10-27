import React, { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Activity, ListChecks, TrendingUp, Radio, AlertTriangle, Boxes, Factory,
  ShoppingCart, FileText, SlidersHorizontal, Trophy, Settings as Cog, Search,
  Moon, Sun, FastForward, PanelLeftClose, PanelLeft, Play, Network,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
import { selectExceptions, selectDecidedRecIds, selectOpenRecommendationCount } from '@/engine/selectors'
import Logo from './Logo'
import WeekMenu from './WeekMenu'

interface Item { to: string; label: string; icon: React.ElementType; badge?: 'ex' | 'an' | 'buy' | 'risk' }

export const NAV: { group: string; items: Item[] }[] = [
  { group: 'Overview', items: [
    { to: '/', label: 'Health', icon: Activity },
    { to: '/exceptions', label: 'Exceptions', icon: ListChecks, badge: 'ex' },
  ]},
  { group: 'Demand', items: [
    { to: '/forecast', label: 'Forecast', icon: TrendingUp },
    { to: '/signals', label: 'Signals', icon: Radio },
    { to: '/anomalies', label: 'Anomalies', icon: AlertTriangle, badge: 'an' },
  ]},
  { group: 'Supply', items: [
    { to: '/stock', label: 'Stock', icon: Boxes, badge: 'risk' },
    { to: '/plan', label: 'Plan & MRP', icon: Factory },
  ]},
  { group: 'Buy', items: [
    { to: '/buy', label: 'Recommendations', icon: ShoppingCart, badge: 'buy' },
    { to: '/orders', label: 'Orders', icon: FileText },
  ]},
  { group: 'Decide', items: [
    { to: '/simulate', label: 'Simulate', icon: SlidersHorizontal },
    { to: '/connected', label: 'Connected systems', icon: Network },
    { to: '/proof', label: 'Proof', icon: Trophy },
  ]},
]

/**
 * Whether a sidebar item is the one you are looking at.
 *
 * Exact match for Health, because "/" is a prefix of everything. Settings is
 * deliberately not in this list, so nothing in the rail lights up while you are
 * on it — it is a place you configure the tool, not a stage of the plan.
 */
export function isNavActive(to: string, pathname: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)
}

function Side() {
  const { sidebarOpen, result, dismissed, approvals, rejected } = useStore()
  const loc = useLocation()
  const k = result?.kpis
  const decided = selectDecidedRecIds(approvals, rejected)
  // Every badge reads the same selector the destination page reads, so the
  // number on the rail can never disagree with the number on the screen.
  const badge = (b?: Item['badge']) =>
    !result ? undefined
    : b === 'ex' ? selectExceptions(result, dismissed, decided).length
    : b === 'an' ? k?.openAnomalies
    : b === 'buy' ? selectOpenRecommendationCount(result, approvals, rejected)
    : b === 'risk' ? k?.materialsAtRisk : undefined

  const active = (to: string) => isNavActive(to, loc.pathname)

  return (
    <aside className={`no-print shrink-0 border-r border-line bg-surface transition-all duration-200
      ${sidebarOpen ? 'w-52' : 'w-[52px]'} h-screen sticky top-0 overflow-y-auto overflow-x-hidden`}>
      <div className="h-12 flex items-center px-3 border-b border-line sticky top-0 bg-surface z-20">
        <Logo compact={!sidebarOpen} />
      </div>

      {/* Tight enough that all twelve destinations fit without scrolling. */}
      <nav className="p-1.5 pb-3 select-none">
        {NAV.map(g => (
          <div key={g.group} className="mb-1">
            {sidebarOpen && <div className="px-2 pt-1 pb-0.5 eyebrow">{g.group}</div>}
            {g.items.map(it => {
              const Icon = it.icon
              const n = badge(it.badge)
              const on = active(it.to)
              return (
                <NavLink key={it.to} to={it.to} title={!sidebarOpen ? it.label : undefined}
                  className={`flex items-center gap-2 px-2 py-1 rounded-lg text-base font-medium mb-0.5 transition-colors ${
                    on ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface2 hover:text-fg'}`}>
                  <Icon className="w-4 h-4 shrink-0" />
                  {sidebarOpen && <span className="truncate flex-1">{it.label}</span>}
                  {sidebarOpen && !!n && (
                    <span className="num text-2xs font-bold px-1 rounded bg-surface2 text-muted">{n}</span>
                  )}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>
    </aside>
  )
}

function Top() {
  const {
    role, setRole, dark, toggleDark, toggleSidebar, sidebarOpen,
    setCommandOpen, advanceWeek, setTourStep, loading,
  } = useStore()

  return (
    <header className="no-print select-none sticky top-0 z-30 h-12 bg-surface/90 backdrop-blur border-b border-line
                       flex items-center gap-1.5 px-2.5">
      <button className="btn btn-ghost btn-sm" onClick={toggleSidebar} aria-label="Toggle menu">
        {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
      </button>

      <button onClick={() => setCommandOpen(true)}
        className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line bg-surface2
                   text-sm text-muted hover:bg-line/30 transition-colors w-9 shrink-0 sm:w-56" aria-label="Search">
        {/* Icon-only on a phone: the full bar plus seven controls ran 400 px past the screen edge. */}
        <Search className="w-3 h-3 shrink-0" /><span className="truncate hidden sm:inline">Search</span>
        <kbd className="ml-auto hidden sm:inline text-2xs px-1 rounded border border-line bg-surface">⌘K</kbd>
      </button>

      <div className="flex-1 min-w-0" />

      <WeekMenu />

      <button className="btn btn-outline btn-sm" onClick={advanceWeek} disabled={loading} title="Advance one week">
        <FastForward className="w-3.5 h-3.5" /><span className="hidden lg:inline">+1 week</span>
      </button>
      <button className="btn btn-ghost btn-sm hidden sm:inline-flex" onClick={toggleDark} title="Theme">
        {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>
      <NavLink to="/setup" title="Settings" aria-label="Settings"
        className={({ isActive }) => `btn btn-sm hidden sm:inline-flex ${isActive ? 'btn-soft' : 'btn-ghost'}`}>
        <Cog className="w-4 h-4" />
      </NavLink>

      <select value={role} onChange={e => setRole(e.target.value as any)}
        className="h-8 px-1.5 rounded-lg border border-line bg-surface text-sm font-medium cursor-pointer">
        <option>Planner</option><option>Buyer</option><option>Manager</option>
      </select>

      <button className="btn btn-primary btn-sm" onClick={() => setTourStep(0)}>
        <Play className="w-3 h-3" /><span className="hidden md:inline">Tour</span>
      </button>
    </header>
  )
}

function Toasts() {
  const { toasts, dropToast } = useStore()
  return (
    <div className="fixed bottom-3 right-3 z-[70] space-y-1.5 no-print">
      {toasts.map(t => (
        <div key={t.id} className={`card shadow-lg px-3 py-2 text-base flex items-center gap-2 max-w-xs animate-fadeUp
          border-l-2 ${t.kind === 'good' ? 'border-l-success' : t.kind === 'warn' ? 'border-l-warning'
            : t.kind === 'risk' ? 'border-l-danger' : 'border-l-info'}`}>
          <span className="flex-1">{t.text}</span>
          <button className="text-muted hover:text-fg" onClick={() => dropToast(t.id)}>&times;</button>
        </div>
      ))}
    </div>
  )
}

export default function Shell() {
  const { init, dark, setCommandOpen } = useStore()
  const loc = useLocation()

  useEffect(() => { init() }, [init])
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCommandOpen(true) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [setCommandOpen])

  return (
    <div className="flex min-h-screen bg-bg">
      <Side />
      <div className="flex-1 min-w-0 flex flex-col bg-bg">
        <Top />
        <main className="flex-1 p-3 sm:p-4 max-w-[1680px] w-full mx-auto bg-bg">
          <Outlet />
        </main>
      </div>
      <Toasts />
    </div>
  )
}
