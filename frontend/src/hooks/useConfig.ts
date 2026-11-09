import { useCallback, useEffect, useState } from 'react'
import { getConfig, type ConfigResponse } from '../lib/api'

interface UseConfigResult {
  config: ConfigResponse | null
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Fetches GET /config on demand. `enabled` gates the initial fetch so the
 * Settings modal can refetch fresh data every time it opens, per spec,
 * instead of showing a stale snapshot from first render.
 */
export function useConfig(enabled: boolean): UseConfigResult {
  const [config, setConfig] = useState<ConfigResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const refetch = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    setError(null)

    getConfig().then((result) => {
      if (cancelled) return
      setLoading(false)
      if (result.ok) {
        setConfig(result.data)
      } else {
        setError(result.error)
      }
    })

    return () => {
      cancelled = true
    }
  }, [enabled, nonce])

  return { config, loading, error, refetch }
}
