import { useEffect, useRef, useState } from 'react'
import { getHealth, type HealthResponse } from '../lib/api'

const POLL_MS = 5000

/**
 * Polls GET /health on an interval. Used for the PLC-link pill, which per
 * spec must reflect /health's mqtt flag OR the WebSocket status message -
 * this hook supplies the first half of that OR.
 */
export function useHealth(): { health: HealthResponse | null; error: string | null } {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false

    async function poll() {
      const result = await getHealth()
      if (cancelled.current) return
      if (result.ok) {
        setHealth(result.data)
        setError(null)
      } else {
        setError(result.error)
      }
    }

    poll()
    const id = window.setInterval(poll, POLL_MS)
    return () => {
      cancelled.current = true
      window.clearInterval(id)
    }
  }, [])

  return { health, error }
}
