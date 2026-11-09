import { classLabel, tierColor, tierLabel } from '../brand/tokens'
import { formatClock, formatConfidence } from '../lib/format'
import type { Alert } from '../lib/types'
import { useStore } from '../store/useStore'

interface AlertCardProps {
  alert: Alert
}

export function AlertCard({ alert }: AlertCardProps) {
  const markFalsePositive = useStore((s) => s.markFalsePositive)
  const color = tierColor[alert.tier] ?? '#7EA9C9'

  return (
    <div
      className={`rounded-xl border px-3.5 py-3 ${alert.tier === 3 ? 'motion-safe:animate-ring-pulse' : ''}`}
      style={{
        borderColor: `${color}40`,
        background: `${color}14`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={{ background: `${color}26`, color }}
            >
              {tierLabel[alert.tier] ?? 'ALERT'}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {classLabel[alert.cls] ?? alert.cls}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-ink">{alert.message}</p>
        </div>
        <span className="shrink-0 font-mono text-xs text-ink-muted">{formatClock(alert.timestamp)}</span>
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3 font-mono text-xs text-ink-muted">
          <span>{formatConfidence(alert.confidence)} conf</span>
          <span>frame {alert.frame_id}</span>
        </div>
        <button
          onClick={() => markFalsePositive(alert.id)}
          className="text-xs font-medium text-ink-muted underline decoration-dotted underline-offset-2 transition-colors hover:text-ink"
        >
          Mark as false alarm
        </button>
      </div>
    </div>
  )
}
