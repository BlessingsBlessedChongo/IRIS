/**
 * Thin fetch wrappers around the backend's HTTP endpoints. Every function
 * returns a discriminated result instead of throwing, so callers can render
 * an honest failure state without try/catch scattered through components.
 */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface HealthResponse {
  status: string
  source: string
  clients: number
  mqtt: boolean
  streaming: boolean
}

export interface ConfigResponse {
  source: string
  model: string
  fallback: string
  conf_threshold: number
  tiers: { t1: number; t2: number; t3: number }
  model_kind: 'onnx' | 'pt' | 'none'
  model_loaded: string
}

export interface TripResponse {
  status: 'ok' | 'logged'
  alert_id: string
  mqtt: boolean
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, init)
    if (!res.ok) {
      return { ok: false, error: `${path} responded ${res.status}` }
    }
    const data = (await res.json()) as T
    return { ok: true, data }
  } catch {
    // Covers network failure, backend not running, and CORS/proxy errors -
    // all indistinguishable from the browser's perspective, and all mean
    // the same thing to the operator: the backend isn't reachable.
    return { ok: false, error: 'Backend unreachable' }
  }
}

export function getHealth(): Promise<ApiResult<HealthResponse>> {
  return request<HealthResponse>('/health')
}

export function getConfig(): Promise<ApiResult<ConfigResponse>> {
  return request<ConfigResponse>('/config')
}

export function postTrip(reason: string): Promise<ApiResult<TripResponse>> {
  return request<TripResponse>('/trip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
}
