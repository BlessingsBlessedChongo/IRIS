/**
 * Types mirroring backend/app/schemas.py exactly. Field names and literal
 * unions here must stay in sync with the backend — this is the JSON
 * contract, not a place for the frontend to invent its own shape.
 */

export type DetectionClass = 'rip' | 'foreign_object' | 'edge_damage' | 'unknown'
export type AlertTier = 0 | 1 | 2 | 3

export interface BoundingBox {
  x: number
  y: number
  w: number
  h: number
}

export interface Detection {
  cls: DetectionClass
  confidence: number
  box: BoundingBox
  label: string
}

export interface FrameStats {
  frame_id: number
  fps: number
  inference_ms: number
  source: string
  timestamp: string
}

export interface Alert {
  id: string
  tier: AlertTier
  cls: DetectionClass
  confidence: number
  label: string
  frame_id: number
  timestamp: string
  message: string
}

export interface StatusMessage {
  type: 'status'
  source: string
  model: string
  mqtt_connected: boolean
}

export interface FrameMessage {
  type: 'frame'
  stats: FrameStats
  detections: Detection[]
  alerts: Alert[]
}

export interface TripMessage {
  type: 'trip'
  alert_id: string
  cls: DetectionClass
  confidence: number
  frame_id: number
  timestamp: string
  action: 'STOP_BELT'
  source: string
}

export type InboundMessage = StatusMessage | FrameMessage | TripMessage
