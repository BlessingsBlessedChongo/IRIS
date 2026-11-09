"""
Alerting and PLC integration.

Two responsibilities live here:

  - AlertEngine turns raw per-frame detections into tiered alerts, tracking
    how many consecutive frames each class has persisted for. This is what
    keeps a single noisy frame from triggering a belt trip.
  - PlcPublisher is the outbound side: when a Tier-3 alert fires, it
    publishes a TripMessage over MQTT (or just logs it if no broker is
    configured/reachable), standing in for a real Modbus/OPC-UA PLC write.

Latency note
------------
For most defect classes, tiered confirmation across consecutive frames is
the correct behaviour: it suppresses single-frame noise without meaningfully
delaying response. But a *rip* is categorically different from a shadow or
an occlusion — it is the failure mode that costs the mine production, and
every frame it is allowed to persist, the belt loses more undamaged surface.
At typical Kansanshi belt speeds (3-5 m/s), one second of confirmation delay
equals 3-5 metres of damaged belt.

For this reason the AlertEngine implements a HARD-TRIP override: any rip
detection above HARD_TRIP_CONFIDENCE fires tier 3 on the *first* frame it
appears in, bypassing the tier3_frames streak requirement entirely. The
persistence rule still applies to lower-confidence rip detections and to
foreign_object and edge_damage, which are not catastrophic on their own.
"""

import asyncio
import json
import logging
import threading
import uuid
from collections import defaultdict
from datetime import datetime
from typing import Any

from .config import Settings
from .schemas import Alert, Detection, TripMessage

log = logging.getLogger("iris.plc")


# Confidence at or above which a rip detection is treated as an immediate
# trip condition, bypassing streak-based confirmation. Chosen so that the
# model's own confidence curve does the filtering: if the detector is 90%+
# sure this is a rip, waiting for 15 more frames to agree is a luxury the
# belt cannot afford.
HARD_TRIP_CONFIDENCE = 0.90


# -- Per-class consecutive-frame tracker -----------------------------------
class _Streak:
    """Tracks how many consecutive frames a given class has been detected on,
    plus the tier/cooldown state needed to decide when to alert again."""

    __slots__ = (
        "cls",
        "count",
        "last_conf",
        "best_conf",
        "first_seen_frame",
        "last_alert_tier",
        "cooldown_until_frame",
    )

    def __init__(self, cls: str) -> None:
        self.cls = cls
        self.count = 0
        self.last_conf = 0.0
        self.best_conf = 0.0
        self.first_seen_frame = 0
        self.last_alert_tier = 0
        self.cooldown_until_frame = 0

    def reset(self) -> None:
        """Called when the class has been absent for GRACE_FRAMES frames."""
        self.count = 0
        self.last_conf = 0.0
        self.best_conf = 0.0
        self.first_seen_frame = 0
        self.last_alert_tier = 0
        self.cooldown_until_frame = 0


class AlertEngine:
    """
    Turns per-frame detections into tiered alerts with cross-frame persistence.

    Rules:
      - Each class has a streak counter of consecutive frames it appeared in.
      - Tier 1 fires once, at tier1_frames; Tier 2 fires once, at
        tier2_frames — both are one-shot per streak (an operator does not
        need the same "monitoring" alert repeated every frame).
      - Tier 3 fires at tier3_frames and then re-fires every
        TIER3_COOLDOWN frames for as long as the fault persists. This is
        deliberate: a real trip condition that is still active after the
        cooldown window should keep re-asserting STOP_BELT rather than go
        silent after the first MQTT publish, in case that publish was
        missed downstream. The cooldown's job is only to bound the *rate*
        of tier-3 alerts, not to cap them at one per fault.
      - HARD-TRIP OVERRIDE: any rip detection at confidence >=
        HARD_TRIP_CONFIDENCE fires tier 3 immediately, bypassing the
        tier3_frames streak entirely. See module docstring for rationale.
      - A class that disappears for >= GRACE_FRAMES frames resets its
        streak entirely (count, tier, and cooldown).
    """

    GRACE_FRAMES = 3  # tolerance for missed frames (jitter, occlusion)
    TIER3_COOLDOWN = 150  # frames (~10s at 15fps) between repeated tier-3 alerts

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.streaks: dict[str, _Streak] = defaultdict(lambda: _Streak("unknown"))
        self._grace: dict[str, int] = defaultdict(int)

    def update(self, detections: list[Detection], frame_id: int) -> list[Alert]:
        """Advance all streaks by one frame and return any alerts generated."""
        alerts: list[Alert] = []
        seen_classes: set[str] = set()

        # Group detections by class, keeping only the max-confidence one —
        # the streak/tier logic operates per class, not per box.
        by_class: dict[str, Detection] = {}
        for d in detections:
            seen_classes.add(d.cls)
            prev = by_class.get(d.cls)
            if prev is None or d.confidence > prev.confidence:
                by_class[d.cls] = d

        # Advance streaks for classes seen this frame.
        for cls, det in by_class.items():
            streak = self.streaks[cls]
            if streak.count == 0:
                streak.first_seen_frame = frame_id
            streak.count += 1
            streak.last_conf = det.confidence
            streak.best_conf = max(streak.best_conf, det.confidence)
            self._grace[cls] = 0

            alert = self._maybe_alert(streak, det, frame_id)
            if alert:
                alerts.append(alert)

        # Age out classes not seen this frame.
        for cls in list(self.streaks.keys()):
            if cls in seen_classes:
                continue
            self._grace[cls] += 1
            if self._grace[cls] >= self.GRACE_FRAMES:
                self.streaks[cls].reset()

        return alerts

    def _maybe_alert(self, streak: _Streak, det: Detection, frame_id: int) -> Alert | None:
        s = self.settings

        # Cooldown gates *all* tiers for this class. In practice this mostly
        # matters for tier 3 re-firing, but it also prevents a hard-trip
        # rip from re-firing every frame during an active event.
        if frame_id < streak.cooldown_until_frame:
            return None

        # Hard-trip override: a high-confidence rip fires tier 3 immediately,
        # on the first frame, without waiting for the streak to build. This
        # is the single biggest reduction in belt distance travelled between
        # rip onset and trip signal. Applies only to rip; other classes still
        # use the ordinary tiered logic below.
        if det.cls == "rip" and det.confidence >= HARD_TRIP_CONFIDENCE:
            streak.last_alert_tier = 3
            streak.cooldown_until_frame = frame_id + self.TIER3_COOLDOWN
            log.warning(
                "HARD TRIP — rip at conf %.2f on frame %d (no streak wait)",
                det.confidence,
                frame_id,
            )
            return self._make_alert(3, streak, det, frame_id)

        if streak.count >= s.tier3_frames:
            streak.last_alert_tier = 3
            streak.cooldown_until_frame = frame_id + self.TIER3_COOLDOWN
            return self._make_alert(3, streak, det, frame_id)

        if streak.count >= s.tier2_frames and streak.last_alert_tier < 2:
            streak.last_alert_tier = 2
            return self._make_alert(2, streak, det, frame_id)

        if streak.count >= s.tier1_frames and streak.last_alert_tier < 1:
            streak.last_alert_tier = 1
            return self._make_alert(1, streak, det, frame_id)

        return None

    @staticmethod
    def _make_alert(tier: int, streak: _Streak, det: Detection, frame_id: int) -> Alert:
        messages = {
            1: f"{det.cls.replace('_', ' ').title()} detected — monitoring",
            2: f"{det.cls.replace('_', ' ').title()} persistent — operator attention",
            3: f"{det.cls.replace('_', ' ').title()} confirmed — TRIP RECOMMENDED",
        }
        return Alert(
            id=str(uuid.uuid4())[:8],
            tier=tier,  # type: ignore[arg-type]
            cls=det.cls,
            confidence=streak.best_conf,
            label=det.label,
            frame_id=frame_id,
            timestamp=datetime.utcnow(),
            message=messages[tier],
        )


# -- MQTT publisher ---------------------------------------------------------
class PlcPublisher:
    """
    Publishes a Modbus-shaped JSON message to MQTT when a Tier-3 alert fires.

    In a real deployment this would be replaced by (or sit alongside) a
    Modbus TCP / OPC-UA writer targeting the belt PLC's trip coil. The message
    shape is intentionally flat and explicit so an integrator can map it in
    five minutes.

    If IRIS_MQTT_ENABLED is false, paho-mqtt is missing, or the broker is
    unreachable, this degrades to logging the trip payload instead of
    raising — a missing PLC integration must never take down the vision
    pipeline.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client: Any = None
        self.connected = False
        self._lock = threading.Lock()

    # -- Connect --------------------------------------------------------------
    def connect(self) -> None:
        """Attempt to connect to the configured MQTT broker. Never raises."""
        if not self.settings.mqtt_enabled:
            log.info("MQTT disabled (IRIS_MQTT_ENABLED=false)")
            return
        try:
            import paho.mqtt.client as mqtt
        except Exception as exc:
            log.warning("paho-mqtt not available: %s", exc)
            return

        try:
            # paho-mqtt >= 2.0 requires an explicit callback API version.
            client = mqtt.Client(
                mqtt.CallbackAPIVersion.VERSION2,
                client_id=f"iris-{uuid.uuid4().hex[:6]}",
            )
        except AttributeError:
            # paho-mqtt < 2.0 has no CallbackAPIVersion at all.
            client = mqtt.Client(client_id=f"iris-{uuid.uuid4().hex[:6]}")

        client.on_connect = self._on_connect
        client.on_disconnect = self._on_disconnect

        try:
            client.connect(self.settings.mqtt_host, self.settings.mqtt_port, keepalive=30)
            client.loop_start()
            self.client = client
            log.info("MQTT connecting to %s:%d", self.settings.mqtt_host, self.settings.mqtt_port)
        except Exception as exc:
            log.warning("MQTT connect failed (%s). Trips will be logged only.", exc)
            self.client = None

    def _on_connect(self, client, userdata, flags, reason_code, properties=None) -> None:
        with self._lock:
            self.connected = True
        log.info("MQTT connected (reason=%s)", reason_code)

    def _on_disconnect(self, client, userdata, flags, reason_code, properties=None) -> None:
        with self._lock:
            self.connected = False
        log.warning("MQTT disconnected (reason=%s)", reason_code)

    # -- Publish --------------------------------------------------------------
    async def publish_trip(self, alert: Alert) -> TripMessage:
        """
        Build a TripMessage for the given Tier-3 alert, publish it over MQTT
        if a broker is connected, and always log it. Returns the TripMessage
        so callers (e.g. a manual /trip request) can also broadcast it to
        WebSocket clients.
        """
        trip = TripMessage(
            alert_id=alert.id,
            cls=alert.cls,
            confidence=alert.confidence,
            frame_id=alert.frame_id,
            timestamp=alert.timestamp,
        )
        payload_json = json.dumps(trip.model_dump(), default=str)

        log.warning(
            "TRIP TIER-3 | %s | conf=%.2f | frame=%d",
            alert.cls, alert.confidence, alert.frame_id,
        )

        if not self.client or not self.connected:
            log.info("MQTT offline — trip logged only: %s", payload_json)
            return trip

        try:
            # publish() itself does not block on network I/O (it queues onto
            # paho's own loop thread), but we still offload it in case a
            # future paho version or transport changes that.
            await asyncio.to_thread(
                self.client.publish,
                self.settings.mqtt_topic,
                payload_json,
                qos=1,
                retain=False,
            )
            log.info("MQTT published to %s: %s", self.settings.mqtt_topic, payload_json)
        except Exception as exc:
            log.warning("MQTT publish failed: %s", exc)

        return trip

    # -- Teardown ---------------------------------------------------------------
    def close(self) -> None:
        """Disconnect from the broker, if connected. Safe to call multiple times."""
        if self.client is not None:
            try:
                self.client.loop_stop()
                self.client.disconnect()
            except Exception:
                pass
            self.client = None
        self.connected = False