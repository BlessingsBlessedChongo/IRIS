import { create } from 'zustand'
import type { Alert, Detection, FrameMessage, FrameStats, StatusMessage, TripMessage } from '../lib/types'

export interface TimelinePoint {
  t: number
  rip: number
  foreign_object: number
  edge_damage: number
}

export interface Counts {
  rip: number
  foreign_object: number
  edge_damage: number
  false_positive: number
}

interface StoreState {
  // -- Connection / identity, from the WS "status" hello and the socket itself
  connected: boolean
  source: string
  model: string
  mqttConnected: boolean

  // -- Live frame data
  stats: FrameStats | null
  detections: Detection[]
  alerts: Alert[]

  // -- Derived / accumulated
  feed: Alert[]
  timeline: TimelinePoint[]
  counts: Counts
  trip: { firedAt: string | null; mqttDelivered: boolean }

  // -- Actions
  setConnected: (connected: boolean) => void
  applyStatus: (msg: StatusMessage) => void
  applyFrame: (msg: FrameMessage) => void
  applyTrip: (msg: TripMessage) => void
  markFiredNow: (mqttDelivered: boolean) => void
  clearTrip: () => void
  markFalsePositive: (alertId: string) => void
  resetSession: () => void
}

const TIMELINE_MAX_POINTS = 240
const TIMELINE_WINDOW_MS = 16_000
const sessionStart = Date.now()

function initialCounts(): Counts {
  return { rip: 0, foreign_object: 0, edge_damage: 0, false_positive: 0 }
}

export const useStore = create<StoreState>((set, get) => ({
  connected: false,
  source: '',
  model: '',
  mqttConnected: false,

  stats: null,
  detections: [],
  alerts: [],

  feed: [],
  timeline: [],
  counts: initialCounts(),
  trip: { firedAt: null, mqttDelivered: false },

  setConnected: (connected) => set({ connected }),

  applyStatus: (msg) =>
    set({
      source: msg.source,
      model: msg.model,
      mqttConnected: msg.mqtt_connected,
    }),

  applyFrame: (msg) => {
    const now = Date.now()
    const t = (now - sessionStart) / 1000

    // Per-class max confidence this frame (0 if the class wasn't seen).
    const maxByClass: Record<'rip' | 'foreign_object' | 'edge_damage', number> = {
      rip: 0,
      foreign_object: 0,
      edge_damage: 0,
    }
    for (const d of msg.detections) {
      if (d.cls === 'rip' || d.cls === 'foreign_object' || d.cls === 'edge_damage') {
        maxByClass[d.cls] = Math.max(maxByClass[d.cls], d.confidence)
      }
    }

    const point: TimelinePoint = { t, ...maxByClass }
    const cutoff = now - sessionStart - TIMELINE_WINDOW_MS
    let timeline = [...get().timeline, point].filter((p) => p.t * 1000 >= cutoff)
    if (timeline.length > TIMELINE_MAX_POINTS) {
      timeline = timeline.slice(timeline.length - TIMELINE_MAX_POINTS)
    }

    // Tier-2+ alerts join the feed (newest first, capped at 50). Tier-1
    // alerts only move the counters (see below) - they're "monitoring"
    // level and would otherwise flood the alert feed on every belt scuff.
    let feed = get().feed
    const tier2Plus = msg.alerts.filter((a) => a.tier >= 2)
    if (tier2Plus.length > 0) {
      feed = [...tier2Plus.slice().reverse(), ...feed].slice(0, 50)
    }

    // Tier-1 alerts increment the class counter exactly once per event -
    // the backend already latches tier-1 to fire once per detection streak,
    // so one tier-1 Alert object here is exactly one "event", never a
    // per-frame repeat.
    const counts = { ...get().counts }
    for (const a of msg.alerts) {
      if (a.tier === 1 && (a.cls === 'rip' || a.cls === 'foreign_object' || a.cls === 'edge_damage')) {
        counts[a.cls] += 1
      }
    }

    set({
      stats: msg.stats,
      detections: msg.detections,
      alerts: msg.alerts,
      timeline,
      feed,
      counts,
    })
  },

  applyTrip: (msg) =>
    // A "trip" WS broadcast doesn't carry per-message MQTT delivery status
    // (that's only known to the operator who directly triggered it, via
    // the POST /trip response). Best-effort: assume delivery matches the
    // current PLC-link state observed by this browser. Documented
    // assumption - see summary.
    set({ trip: { firedAt: msg.timestamp, mqttDelivered: get().mqttConnected } }),

  markFiredNow: (mqttDelivered) =>
    set({ trip: { firedAt: new Date().toISOString(), mqttDelivered } }),

  clearTrip: () => set({ trip: { firedAt: null, mqttDelivered: false } }),

  markFalsePositive: (alertId) => {
    // eslint-disable-next-line no-console
    console.log(`[iris] operator marked alert ${alertId} as a false alarm`)
    set((state) => ({ counts: { ...state.counts, false_positive: state.counts.false_positive + 1 } }))
  },

  resetSession: () =>
    set({
      stats: null,
      detections: [],
      alerts: [],
      feed: [],
      timeline: [],
      counts: initialCounts(),
      trip: { firedAt: null, mqttDelivered: false },
    }),
}))
