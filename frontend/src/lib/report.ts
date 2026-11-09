import { getConfig } from './api'
import type { Alert } from './types'

export interface SessionReportInput {
  source: string
  model: string
  thresholds: { t1: number; t2: number; t3: number } | null
  counters: { rip: number; foreign_object: number; edge_damage: number; false_positive: number }
  alerts: Alert[]
}

export interface SessionReport {
  generated_at: string
  source: string
  model: string
  thresholds: { t1: number; t2: number; t3: number } | null
  counters: SessionReportInput['counters']
  alerts: Alert[]
}

/** Build the plain-object session report from live store data. No backend
 * call — everything here is already known to the frontend. */
export function buildSessionReport(input: SessionReportInput): SessionReport {
  return {
    generated_at: new Date().toISOString(),
    source: input.source,
    model: input.model,
    thresholds: input.thresholds,
    counters: input.counters,
    alerts: input.alerts,
  }
}

/** Serialize the report and trigger a browser download as a .json file. */
export function downloadSessionReport(input: SessionReportInput): void {
  const report = buildSessionReport(input)
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = report.generated_at.replace(/[:.]/g, '-')
  a.href = url
  a.download = `iris-session-report-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Composed helper used by both the account menu and the alert panel
 * header (the brief calls for the download action in both places).
 * Fetches current thresholds from /config at click time (the store
 * doesn't otherwise carry them) and falls back to `thresholds: null` if
 * that fetch fails, rather than blocking the download entirely - a
 * session report with everything except thresholds is still useful.
 */
export async function downloadCurrentSessionReport(state: {
  source: string
  model: string
  counts: SessionReportInput['counters']
  feed: Alert[]
}): Promise<void> {
  const configResult = await getConfig()
  const thresholds = configResult.ok ? configResult.data.tiers : null
  downloadSessionReport({
    source: state.source,
    model: state.model,
    thresholds,
    counters: state.counts,
    alerts: state.feed,
  })
}
