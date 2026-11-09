"""
Pydantic models shared across the pipeline.

These models are the contract between the backend and the React dashboard:
every field name here is a JSON key the frontend depends on, so field names
must stay snake_case and must not be renamed without a corresponding
frontend change. This module has no behaviour of its own — it is pure data
shape, imported by stream.py, detector.py, plc.py, and main.py.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

DetectionClass = Literal["rip", "foreign_object", "edge_damage", "unknown"]
AlertTier = Literal[0, 1, 2, 3]


class BoundingBox(BaseModel):
    """A detection box, normalized 0..1 against the source frame's width/height."""

    x: float
    y: float
    w: float
    h: float


class Detection(BaseModel):
    """A single detection (from either the YOLO model or the classical detector)."""

    cls: DetectionClass
    confidence: float = Field(ge=0.0, le=1.0)
    box: BoundingBox
    label: str = ""


class FrameStats(BaseModel):
    """Per-frame telemetry sent alongside detections on every /ws frame message."""

    frame_id: int
    fps: float
    inference_ms: float
    source: str
    timestamp: datetime


class Alert(BaseModel):
    """A tiered alert emitted by the AlertEngine when a streak crosses a threshold."""

    id: str
    tier: AlertTier
    cls: DetectionClass
    confidence: float
    label: str
    frame_id: int
    timestamp: datetime
    message: str


class FrameMessage(BaseModel):
    """What the backend pushes to the dashboard over WebSocket, once per frame."""

    type: Literal["frame"] = "frame"
    stats: FrameStats
    detections: list[Detection]
    alerts: list[Alert]


class StatusMessage(BaseModel):
    """One-shot hello sent when the WebSocket connects."""

    type: Literal["status"] = "status"
    source: str
    model: str
    mqtt_connected: bool


class TripMessage(BaseModel):
    """Emitted when a Tier-3 alert fires — mirrors what a real PLC would see."""

    type: Literal["trip"] = "trip"
    alert_id: str
    cls: DetectionClass
    confidence: float
    frame_id: int
    timestamp: datetime
    action: Literal["STOP_BELT"] = "STOP_BELT"
    source: str = "IRIS"


class TripRequest(BaseModel):
    """Optional body for POST /trip — a human-readable reason for the demo/audit log."""

    reason: str = "Manual trigger"
