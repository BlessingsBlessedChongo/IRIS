import { Download, ShieldAlert } from 'lucide-react'
import { downloadCurrentSessionReport } from '../lib/report'
import { useStore } from '../store/useStore'
import { AlertCard } from './AlertCard'
import { TripBanner } from './TripBanner'

/** Tier >=2 alert feed, newest first, plus the trip banner and the
 * session-report download action (also available from the account menu). */
export function AlertPanel() {
  const feed = useStore((s) => s.feed)

  function handleDownload() {
    const { source, model, counts } = useStore.getState()
    void downloadCurrentSessionReport({ source, model, counts, feed })
  }

  return (
    <section className="glass flex h-full min-h-0 flex-col rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert size={15} className="text-ink-muted" />
          <h2 className="font-sans text-sm font-semibold uppercase tracking-wide text-ink">
            Alert feed
          </h2>
        </div>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-white/10 hover:text-ink"
          title="Session report (JSON)"
        >
          <Download size={13} />
          Report
        </button>
      </div>

      <TripBanner />

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-0.5">
        {feed.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
            <ShieldAlert size={22} className="text-ink-faint" />
            <p className="text-sm text-ink-muted">No alerts yet. Belt is nominal.</p>
          </div>
        ) : (
          feed.map((alert) => <AlertCard key={alert.id} alert={alert} />)
        )}
      </div>
    </section>
  )
}
