/**
 * Shared app state: planner settings, approvals, overrides, role, demo controls.
 *
 * When anything here that the engine cares about changes, we re-run the whole
 * planning calculation. That is what makes "change a setting and every screen
 * updates" literally true rather than a claim.
 */
import { create } from 'zustand'
import { getDataset } from '@/data/generate'
import { DEFAULT_SETTINGS, type PlannerSettings, type PlanningResult, type ForecastOverride } from '@/engine'
import type { AnomalyStatus } from '@/engine/anomaly'
import type { Dataset, PlanHistoryEntry, POStatus } from '@/data/types'
import EngineWorker from '@/worker/engine.worker?worker'

export type Role = 'Planner' | 'Buyer' | 'Manager'

export interface Toast { id: number; text: string; kind: 'good' | 'info' | 'warn' | 'risk' }

export interface ApprovedOrder {
  recommendationId: string
  poId: string
  materialId: string
  qty: number
  supplierId: string
  valueINR: number
  approvedBy: string
  approvedAt: string
  status: POStatus
  note: string
}

interface State {
  ds: Dataset
  settings: PlannerSettings
  result: PlanningResult | null
  loading: boolean
  progress: { stage: string; pct: number }
  error: string | null

  role: Role
  dark: boolean
  presenter: boolean
  sidebarOpen: boolean
  commandOpen: boolean
  tourStep: number | null

  weeksAdvanced: number
  overrides: ForecastOverride[]
  anomalyResolutions: Record<string, AnomalyStatus>
  approvals: ApprovedOrder[]
  rejected: Record<string, string>
  /** Recommendations a planner has passed to the buyer for approval. */
  sentToBuyer: Record<string, string>
  dismissed: string[]
  planHistory: PlanHistoryEntry[]
  committedPlanId: string | null
  toasts: Toast[]

  // actions
  init: () => void
  rerun: () => void
  setSetting: <K extends keyof PlannerSettings>(k: K, v: PlannerSettings[K], label?: string) => void
  resetSettings: () => void
  setRole: (r: Role) => void
  toggleDark: () => void
  togglePresenter: () => void
  toggleSidebar: () => void
  setCommandOpen: (v: boolean) => void
  setTourStep: (n: number | null) => void

  advanceWeek: () => void
  stepWeek: (n: number) => void
  setWeeksAdvanced: (n: number) => void
  resetDemo: () => void

  addOverride: (o: ForecastOverride) => void
  removeOverride: (skuId: string, region: string) => void
  resolveAnomaly: (id: string, status: AnomalyStatus, reason: string) => void
  resolveAnomalies: (ids: string[], status: AnomalyStatus, reason: string) => void
  approveRecommendation: (recId: string, qty: number, note: string) => void
  rejectRecommendation: (recId: string, reason: string) => void
  sendToBuyer: (recId: string, note: string) => void
  dismissItem: (id: string) => void
  commitPlan: (planId: string, name: string, reason: string, impactINR: number) => void
  saveScenario: (name: string, detail: string) => void
  revertHistory: (id: string) => void
  toast: (text: string, kind?: Toast['kind']) => void
  dropToast: (id: number) => void
}

let worker: Worker | null = null
let reqId = 0
let debounce: ReturnType<typeof setTimeout> | null = null

/**
 * Theme preference, remembered.
 *
 * Wrapped because storage throws in a private window and comes back empty when
 * site data is cleared; a theme toggle is not worth a crashed app.
 */
const DARK_KEY = 'demandpilot.dark'
function readDark(): boolean {
  try { return localStorage.getItem(DARK_KEY) === '1' } catch { return false }
}
function writeDark(v: boolean) {
  try { localStorage.setItem(DARK_KEY, v ? '1' : '0') } catch { /* not important enough to fail on */ }
}

export const useStore = create<State>((set, get) => ({
  ds: getDataset(),
  settings: { ...DEFAULT_SETTINGS },
  result: null,
  loading: true,
  progress: { stage: 'Starting', pct: 0 },
  error: null,

  role: 'Planner',
  dark: readDark(),
  presenter: false,
  sidebarOpen: true,
  commandOpen: false,
  tourStep: null,

  weeksAdvanced: 0,
  overrides: [],
  anomalyResolutions: {},
  approvals: [],
  rejected: {},
  sentToBuyer: {},
  dismissed: [],
  planHistory: getDataset().planHistory,
  committedPlanId: null,
  toasts: [],

  init: () => {
    if (worker) return
    worker = new EngineWorker()
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m.type === 'progress') set({ progress: { stage: m.stage, pct: m.pct } })
      else if (m.type === 'result') set({ result: m.result, loading: false, error: null })
      else if (m.type === 'error') set({ error: m.message, loading: false })
    }
    worker.onerror = (e) => set({ error: e.message || 'The planning engine failed to start.', loading: false })
    get().rerun()
  },

  rerun: () => {
    if (!worker) return
    set({ loading: true, progress: { stage: 'Recalculating the plan', pct: 5 } })
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      const s = get()
      worker!.postMessage({
        id: ++reqId,
        settings: s.settings,
        weeksAdvanced: s.weeksAdvanced,
        overrides: s.overrides,
        anomalyResolutions: s.anomalyResolutions,
      })
    }, 120)
  },

  setSetting: (k, v, label) => {
    const prev = get().settings[k]
    set(st => ({ settings: { ...st.settings, [k]: v } }))
    get().rerun()
    if (label) {
      const entry: PlanHistoryEntry = {
        id: `PH-${Date.now()}`, week: get().ds.todayWeek + get().weeksAdvanced,
        at: new Date().toISOString(), type: 'Setting changed',
        title: `${label}: ${String(prev)} → ${String(v)}`,
        reason: 'Changed from the Planner Settings screen.',
        user: 'You', role: get().role, impactINR: 0, reverted: false,
      }
      set(st => ({ planHistory: [entry, ...st.planHistory] }))
    }
  },

  resetSettings: () => { set({ settings: { ...DEFAULT_SETTINGS } }); get().rerun(); get().toast('Settings returned to their defaults.') },

  setRole: r => {
    set({ role: r })
    get().toast(
      r === 'Buyer' ? 'Signed in as Buyer — you can approve purchases.'
      : r === 'Manager' ? 'Signed in as Manager — approvals and outcomes.'
      : 'Signed in as Planner — recommend, but not approve.', 'info')
  },
  toggleDark: () => set(s => { const dark = !s.dark; writeDark(dark); return { dark } }),
  togglePresenter: () => set(s => ({ presenter: !s.presenter })),
  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
  setCommandOpen: v => set({ commandOpen: v }),
  setTourStep: n => set({ tourStep: n }),

  advanceWeek: () => get().stepWeek(1),

  stepWeek: n => {
    const next = Math.max(0, Math.min(12, get().weeksAdvanced + n))
    if (next === get().weeksAdvanced) return
    set({ weeksAdvanced: next })
    get().rerun()
    get().toast(n > 0 ? 'Moved forward one week.' : 'Moved back one week.', 'info')
  },

  setWeeksAdvanced: n => {
    const next = Math.max(0, Math.min(12, n))
    if (next === get().weeksAdvanced) return
    set({ weeksAdvanced: next })
    get().rerun()
    get().toast(next === 0 ? 'Back to the current week.' : `Planning week +${next}.`, 'info')
  },

  resetDemo: () => {
    set({
      weeksAdvanced: 0, overrides: [], anomalyResolutions: {}, approvals: [],
      rejected: {}, sentToBuyer: {}, dismissed: [], committedPlanId: null,
      settings: { ...DEFAULT_SETTINGS }, planHistory: getDataset().planHistory,
    })
    get().rerun()
    get().toast('Demo reset to the starting position.', 'good')
  },

  addOverride: o => {
    set(s => ({ overrides: [...s.overrides.filter(x => !(x.skuId === o.skuId && x.region === o.region)), o] }))
    set(s => ({ planHistory: [{
      id: `PH-${Date.now()}`, week: s.ds.todayWeek + s.weeksAdvanced, at: new Date().toISOString(),
      type: 'Forecast override', title: `${o.skuId} ${o.region}: ${o.pct > 0 ? '+' : ''}${o.pct}%`,
      reason: o.reason, user: o.by, role: s.role, impactINR: 0, reverted: false,
    }, ...s.planHistory] }))
    get().rerun()
    get().toast('Forecast override saved.', 'good')
  },

  removeOverride: (skuId, region) => {
    set(s => ({ overrides: s.overrides.filter(x => !(x.skuId === skuId && x.region === region)) }))
    get().rerun()
    get().toast('Override removed.')
  },

  resolveAnomaly: (id, status, reason) => get().resolveAnomalies([id], status, reason),

  /**
   * Resolve a whole market shift at once.
   *
   * A real change in what a region buys fires the detector in every affected
   * product, so accepting it is one decision covering dozens of series. Taking
   * them one at a time would re-run the planning engine once per series.
   */
  resolveAnomalies: (ids, status, reason) => {
    if (!ids.length) return
    set(s => {
      const next = { ...s.anomalyResolutions }
      for (const id of ids) next[id] = status
      return { anomalyResolutions: next }
    })
    set(s => ({ planHistory: [{
      id: `PH-${Date.now()}`, week: s.ds.todayWeek + s.weeksAdvanced, at: new Date().toISOString(),
      type: 'Anomaly action',
      title: ids.length === 1 ? `${ids[0]}: ${status}` : `${ids.length} series: ${status}`,
      reason, user: 'You', role: s.role, impactINR: 0, reverted: false,
    }, ...s.planHistory] }))
    get().rerun()
    get().toast(ids.length === 1
      ? `Anomaly marked as "${status}".`
      : `${ids.length} series marked as "${status}".`, 'good')
  },

  approveRecommendation: (recId, qty, note) => {
    const s = get()
    const rec = s.result?.recommendations.find(r => r.id === recId)
    if (!rec) return
    const poId = `PO-${5000 + s.approvals.length + 1}`
    const ap: ApprovedOrder = {
      recommendationId: recId, poId, materialId: rec.materialId, qty,
      supplierId: rec.supplierId, valueINR: Math.round(qty * rec.pricePerUnit),
      approvedBy: 'You', approvedAt: new Date().toISOString(),
      status: 'Approved', note,
    }
    set(st => ({
      approvals: [...st.approvals, ap],
      planHistory: [{
        id: `PH-${Date.now()}`, week: st.ds.todayWeek + st.weeksAdvanced, at: new Date().toISOString(),
        type: 'Purchase approved',
        title: `${rec.materialName} — ${qty.toFixed(2)} ${rec.unit} from ${rec.supplierName} (${poId})`,
        reason: note || rec.reason, user: 'You', role: st.role,
        impactINR: ap.valueINR, reverted: false,
      }, ...st.planHistory],
    }))
    get().toast(`${poId} approved — ${rec.materialName}.`, 'good')
  },

  rejectRecommendation: (recId, reason) => {
    set(s => ({
      rejected: { ...s.rejected, [recId]: reason },
      planHistory: [{
        id: `PH-${Date.now()}`, week: s.ds.todayWeek + s.weeksAdvanced, at: new Date().toISOString(),
        type: 'Purchase approved', title: `Recommendation ${recId} rejected`,
        reason, user: 'You', role: s.role, impactINR: 0, reverted: false,
      }, ...s.planHistory],
    }))
    get().toast('Recommendation rejected and the reason recorded.', 'warn')
  },

  /**
   * A planner cannot commit money, but can put a recommendation in front of
   * someone who can. Recorded rather than silent, so the handover is on the
   * same audit trail as the approval that follows it.
   */
  sendToBuyer: (recId, note) => {
    const rec = get().result?.recommendations.find(x => x.id === recId)
    set(s => ({
      sentToBuyer: { ...s.sentToBuyer, [recId]: note },
      planHistory: [{
        id: `PH-${Date.now()}`, week: s.ds.todayWeek + s.weeksAdvanced, at: new Date().toISOString(),
        type: 'Plan committed',
        title: `Sent to buyer: ${rec?.materialName ?? recId}`,
        reason: note || rec?.reason || '', user: 'You', role: s.role,
        impactINR: 0, reverted: false,
      }, ...s.planHistory],
    }))
    get().toast('Sent to the buyer for approval.', 'good')
  },

  dismissItem: id => set(s => ({ dismissed: [...s.dismissed, id] })),

  commitPlan: (planId, name, reason, impactINR) => {
    set(s => ({
      committedPlanId: planId,
      planHistory: [{
        id: `PH-${Date.now()}`, week: s.ds.todayWeek + s.weeksAdvanced, at: new Date().toISOString(),
        type: 'Plan committed', title: name, reason, user: 'You', role: s.role,
        impactINR, reverted: false, payload: { planId },
      }, ...s.planHistory],
    }))
    get().toast(`Plan committed: ${name}`, 'good')
  },

  /**
   * Keep a what-if on the record.
   *
   * Deliberately separate from commitPlan: committing picks a course of action
   * and marks that plan option as taken, whereas saving a scenario only records
   * that it was examined. Conflating the two marked options as done that nobody
   * had chosen.
   */
  saveScenario: (name, detail) => {
    set(s => ({
      planHistory: [{
        id: `PH-${Date.now()}`, week: s.ds.todayWeek + s.weeksAdvanced, at: new Date().toISOString(),
        type: 'Setting changed',
        title: `Scenario saved: ${name}`,
        reason: detail, user: 'You', role: s.role, impactINR: 0, reverted: false,
      }, ...s.planHistory],
    }))
    get().toast(`Scenario saved: ${name}`, 'good')
  },

  revertHistory: id => {
    set(s => ({ planHistory: s.planHistory.map(h => h.id === id ? { ...h, reverted: true } : h) }))
    get().toast('Entry reverted. It stays on the record.', 'warn')
  },

  toast: (text, kind = 'good') => {
    const id = Date.now() + Math.random()
    set(s => ({
      // Replace any toast already saying this rather than stacking a second
      // copy of it — "688 planned orders created" twice is noise, not news.
      toasts: [...s.toasts.filter(t => t.text !== text), { id, text, kind }],
    }))
    setTimeout(() => get().dropToast(id), 4200)
  },
  dropToast: id => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))

/** Convenience selectors used all over the UI. */
export const useResult = () => useStore(s => s.result)
export const useDs = () => useStore(s => s.ds)
export const useTodayWeek = () => useStore(s => s.ds.todayWeek + s.weeksAdvanced)
