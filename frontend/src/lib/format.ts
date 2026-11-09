/** Small, dependency-free formatting helpers used across components. */

/** Format an ISO timestamp (or Date) as local HH:MM:SS. */
export function formatClock(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '--:--:--'
  return d.toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Format a 0..1 confidence value as a whole-number percentage string, e.g. "94%". */
export function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** Zero-pad a counter to at least 2 digits, matching the console's readout style. */
export function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}

/** Initials from a display name, e.g. "Alex Chen" -> "AC". Falls back to the
 * first two characters of an email's local part if no name is given. */
export function initialsFrom(name: string, email: string): string {
  const source = name.trim() || email.split('@')[0] || '?'
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}
