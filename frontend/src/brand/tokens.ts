/**
 * Shared brand tokens: colors, copy, and small constants used across
 * components so the visual language stays consistent in one place rather
 * than being re-declared per component.
 */

export const colors = {
  base: '#0A1E33',
  baseMid: '#1B3A5C',
  baseDeep: '#061422',
  amber: '#E8A020',
  rip: '#EF4444',
  object: '#F59E0B',
  edge: '#38BDF8',
  ink: '#F4F7FA',
  inkMuted: '#7EA9C9',
} as const

/** Detection/alert class -> display color. Matches the brief exactly. */
export const classColor: Record<string, string> = {
  rip: colors.rip,
  foreign_object: colors.object,
  edge_damage: colors.edge,
  unknown: colors.inkMuted,
}

/** Detection/alert class -> short display label. */
export const classLabel: Record<string, string> = {
  rip: 'RIP',
  foreign_object: 'OBJECT',
  edge_damage: 'EDGE',
  unknown: 'UNKNOWN',
}

export const tierColor: Record<number, string> = {
  1: colors.edge,
  2: colors.object,
  3: colors.rip,
}

export const tierLabel: Record<number, string> = {
  1: 'TIER 1',
  2: 'TIER 2',
  3: 'TIER 3',
}

export const brand = {
  name: 'IRIS',
  fullName: 'Intelligent Rip & Integrity System',
  tagline: 'See the signal before the failure.',
  footer: 'IRIS - For Demonstration purposes only not safety verified.',
}
