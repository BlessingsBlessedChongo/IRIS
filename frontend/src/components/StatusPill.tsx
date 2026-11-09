import type { ReactNode } from 'react'

interface StatusPillProps {
  active: boolean
  activeLabel: string
  inactiveLabel: string
  icon?: ReactNode
}

/** Small status indicator pill - a colored dot/icon plus a label that
 * switches between an "active" and "inactive" state and color. */
export function StatusPill({ active, activeLabel, inactiveLabel, icon }: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
        active
          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
          : 'border-white/10 bg-white/5 text-ink-muted'
      }`}
    >
      {icon ?? <span className={`live-dot ${active ? '' : 'offline'}`} />}
      {active ? activeLabel : inactiveLabel}
    </span>
  )
}
