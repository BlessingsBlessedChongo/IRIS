import { useEffect } from 'react'
import type { InboundMessage } from '../lib/types'
import { useStore } from '../store/useStore'

const BASE_DELAY_MS = 500
const MAX_DELAY_MS = 5000

/**
 * Owns the single WebSocket connection to /ws for the lifetime of the
 * component that calls it (in practice, the Dashboard page).
 *
 * - Reconnects on close/error with exponential backoff, capped at 5s.
 * - Never throws if the backend is unreachable - a failed connection just
 *   schedules the next retry.
 * - Safe under React 18 StrictMode's dev-only double-invoke: the effect
 *   cleanup sets a `cancelled` flag and closes the socket synchronously,
 *   so the first (discarded) effect instance never leaves a live socket
 *   or a pending reconnect timer behind for the second instance to race
 *   against.
 */
export function useDetectionSocket(): void {
  const applyStatus = useStore((s) => s.applyStatus)
  const applyFrame = useStore((s) => s.applyFrame)
  const applyTrip = useStore((s) => s.applyTrip)
  const setConnected = useStore((s) => s.setConnected)

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let attempt = 0
    let cancelled = false

    function scheduleReconnect() {
      if (cancelled) return
      const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt)
      attempt += 1
      reconnectTimer = window.setTimeout(connect, delay)
    }

    function connect() {
      if (cancelled) return
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${protocol}://${window.location.host}/ws`)

      socket.onopen = () => {
        attempt = 0
        setConnected(true)
      }

      socket.onmessage = (event) => {
        let msg: InboundMessage
        try {
          msg = JSON.parse(event.data)
        } catch {
          return // malformed frame - ignore rather than crash the session
        }
        if (msg.type === 'status') applyStatus(msg)
        else if (msg.type === 'frame') applyFrame(msg)
        else if (msg.type === 'trip') applyTrip(msg)
      }

      socket.onerror = () => {
        // onerror is always followed by onclose for this socket; let
        // onclose own the reconnect decision so it only happens once.
        socket?.close()
      }

      socket.onclose = () => {
        setConnected(false)
        scheduleReconnect()
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [applyStatus, applyFrame, applyTrip, setConnected])
}
