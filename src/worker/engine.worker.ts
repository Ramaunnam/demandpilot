/// <reference lib="webworker" />
/**
 * The whole planning run happens in here, off the main thread, so the app stays
 * responsive while 240 products × 4 regions × 3 models are fitted and tested.
 */
import { buildDataset } from '@/data/generate'
import { runPlanning, type PlannerSettings, type ForecastOverride } from '@/engine'
import type { AnomalyStatus } from '@/engine/anomaly'

export interface WorkerRequest {
  id: number
  settings: PlannerSettings
  weeksAdvanced: number
  overrides: ForecastOverride[]
  anomalyResolutions: Record<string, AnomalyStatus>
}

let ds: ReturnType<typeof buildDataset> | null = null

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  try {
    ;(self as unknown as Worker).postMessage({ id: req.id, type: 'progress', stage: 'Loading sample data', pct: 8 })
    if (!ds) ds = buildDataset()

    ;(self as unknown as Worker).postMessage({ id: req.id, type: 'progress', stage: 'Fitting and testing forecast models', pct: 30 })
    const result = runPlanning({
      ds,
      settings: req.settings,
      weeksAdvanced: req.weeksAdvanced,
      overrides: req.overrides,
      anomalyResolutions: req.anomalyResolutions,
    })

    ;(self as unknown as Worker).postMessage({ id: req.id, type: 'progress', stage: 'Done', pct: 100 })
    ;(self as unknown as Worker).postMessage({ id: req.id, type: 'result', result })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({
      id: req.id, type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
