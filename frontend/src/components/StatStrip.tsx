import { motion } from 'framer-motion'
import { colors } from '../brand/tokens'
import { useStore } from '../store/useStore'

const METRICS: { key: 'rip' | 'foreign_object' | 'edge_damage' | 'false_positive'; label: string; color: string }[] = [
  { key: 'rip', label: 'Rips', color: colors.rip },
  { key: 'foreign_object', label: 'Foreign objects', color: colors.object },
  { key: 'edge_damage', label: 'Edge damage', color: colors.edge },
  { key: 'false_positive', label: 'False alarms', color: colors.inkMuted },
]

/** Four session counters. Each bumps 1 -> 1.15 -> 1 on increment (disabled
 * automatically under prefers-reduced-motion via whileInView guard below). */
export function StatStrip() {
  const counts = useStore((s) => s.counts)
  const reduceMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  return (
    <div className="glass grid grid-cols-2 gap-3 rounded-2xl p-4 sm:grid-cols-4">
      {METRICS.map((m) => {
        const value = counts[m.key]
        return (
          <div key={m.key} className="flex items-center gap-3">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.color }} />
            <div className="min-w-0">
              <p
                className="truncate text-[11px] uppercase tracking-wide text-ink-muted"
                title="Since page load"
              >
                {m.label}
              </p>
              <motion.p
                key={reduceMotion ? m.key : `${m.key}-${value}`}
                initial={reduceMotion ? false : { scale: 1 }}
                animate={reduceMotion ? undefined : { scale: [1, 1.15, 1] }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="tabular-nums font-mono text-2xl font-semibold text-ink"
              >
                {value.toString().padStart(2, '0')}
              </motion.p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
