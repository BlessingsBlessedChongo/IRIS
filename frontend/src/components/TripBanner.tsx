import { ShieldAlert } from 'lucide-react'
import { formatClock } from '../lib/format'
import { useStore } from '../store/useStore'

/**
 * Shown inside AlertPanel once a trip has been fired (manually or observed
 * via a "trip" WebSocket broadcast from another operator's session).
 * Message is honest about MQTT delivery rather than always claiming the
 * PLC received it - see store.trip.mqttDelivered.
 */
export function TripBanner() {
  const trip = useStore((s) => s.trip)
  const clearTrip = useStore((s) => s.clearTrip)

  if (!trip.firedAt) return null

  return (
    <div
      className={`mb-3 flex items-start gap-3 rounded-xl border px-3.5 py-3 ${
        trip.mqttDelivered
          ? 'border-rip/40 bg-rip/10 text-rip'
          : 'border-object/40 bg-object/10 text-object'
      }`}
      role="status"
    >
      <ShieldAlert size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-sans text-sm font-semibold tracking-wide">
          {trip.mqttDelivered ? 'PLC TRIP SIGNAL SENT' : 'TRIP LOGGED — MQTT OFFLINE'}
        </p>
        <p className="mt-0.5 font-mono text-xs opacity-80">{formatClock(trip.firedAt)}</p>
      </div>
      <button
        onClick={clearTrip}
        className="shrink-0 text-xs font-medium underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100"
      >
        Reset
      </button>
    </div>
  )
}
