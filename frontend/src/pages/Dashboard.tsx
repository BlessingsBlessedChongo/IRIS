import { brand } from '../brand/tokens'
import { AlertPanel } from '../components/AlertPanel'
import { ConfidenceTimeline } from '../components/ConfidenceTimeline'
import { Header } from '../components/Header'
import { LiveFeed } from '../components/LiveFeed'
import { StatStrip } from '../components/StatStrip'
import { useDetectionSocket } from '../hooks/useDetectionSocket'

export function Dashboard() {
  useDetectionSocket()

  return (
    <div className="flex min-h-screen flex-col gap-4 p-4 lg:h-screen lg:overflow-hidden">
      <Header />

      <div className="grid min-h-[540px] flex-1 grid-cols-12 gap-4 lg:min-h-0">
        <div className="col-span-12 min-h-[360px] lg:col-span-8 lg:min-h-0">
          <LiveFeed />
        </div>
        <div className="col-span-12 grid min-h-[420px] grid-rows-[65%_35%] gap-4 lg:col-span-4 lg:min-h-0">
          <div className="min-h-[220px] lg:min-h-0">
            <AlertPanel />
          </div>
          <div className="min-h-[160px] lg:min-h-0">
            <ConfidenceTimeline />
          </div>
        </div>
      </div>

      <div className="mt-2 lg:mt-4">
        <StatStrip />
      </div>

      <footer className="px-1 pb-1 text-center text-[11px] text-ink-faint">
        {brand.footer}
      </footer>
    </div>
  )
}