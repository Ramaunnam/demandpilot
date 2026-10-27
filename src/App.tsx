import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Shell from '@/ui/Shell'
import Palette from '@/ui/Palette'
import Tour from '@/ui/Tour'
import { Loading, Panel } from '@/ui/kit'
import { useStore } from '@/store/useStore'

import Health from '@/screens/Health'
import Exceptions from '@/screens/Exceptions'
import Forecast from '@/screens/Forecast'
import Signals from '@/screens/Signals'
import Anomalies from '@/screens/Anomalies'
import Stock from '@/screens/Stock'
import Plan from '@/screens/Plan'
import Buy from '@/screens/Buy'
import Orders from '@/screens/Orders'
import Simulate from '@/screens/Simulate'
import Connected from '@/screens/Connected'
import Proof from '@/screens/Proof'
import Setup from '@/screens/Setup'

/** Screens that need the engine wait for it; Setup works without it. */
function Gate({ children }: { children: React.ReactNode }) {
  const { result, progress, error } = useStore()
  if (error) {
    return (
      <Panel className="max-w-md mx-auto mt-10 border-danger/35" title="The engine could not finish">
        <p className="text-base text-muted mb-3">{error}</p>
        <button className="btn btn-outline btn-md" onClick={() => location.reload()}>Reload</button>
      </Panel>
    )
  }
  if (!result) return <Loading stage={progress.stage} pct={progress.pct} />
  return <>{children}</>
}
const G = (el: React.ReactNode) => <Gate>{el}</Gate>

export default function App() {
  return (
    <BrowserRouter>
      <Palette />
      <Tour />
      <Routes>
        <Route element={<Shell />}>
          <Route index element={G(<Health />)} />
          <Route path="exceptions" element={G(<Exceptions />)} />
          <Route path="forecast" element={G(<Forecast />)} />
          <Route path="signals" element={G(<Signals />)} />
          <Route path="anomalies" element={G(<Anomalies />)} />
          {/* Models is a tab inside Forecast now. The route stays so older
              links, bookmarks and the Proof page's cross-references resolve
              instead of dropping people on the dashboard. */}
          <Route path="models" element={<Navigate to="/forecast?tab=accuracy" replace />} />
          <Route path="stock" element={G(<Stock />)} />
          <Route path="plan" element={G(<Plan />)} />
          <Route path="buy" element={G(<Buy />)} />
          <Route path="orders" element={G(<Orders />)} />
          <Route path="simulate" element={G(<Simulate />)} />
          <Route path="connected" element={G(<Connected />)} />
          <Route path="proof" element={G(<Proof />)} />
          <Route path="setup" element={<Setup />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
