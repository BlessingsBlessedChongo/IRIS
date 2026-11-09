"""
FastAPI application: routes, lifespan, and the per-frame inference loop.

This is the wiring layer. It owns no algorithm of its own — it pulls frames
from StreamReader, runs them through Detector, turns detections into alerts
via AlertEngine, paints boxes for the MJPEG preview, and fans the result out
to every connected WebSocket client and (on Tier-3) the PlcPublisher.

Pipeline per frame (see inference_loop):
  StreamReader.frames() -> Detector.infer() -> AlertEngine.update()
      -> draw_annotations() -> MjpegBuffer.update()
      -> broadcast() to all /ws clients
      -> PlcPublisher.publish_trip() for any Tier-3 alert

Shutdown design
---------------
Ctrl-C must feel immediate even though the detection call runs on a worker
thread. Python threads are not cancellable, so any shutdown path that waits
for an in-flight `asyncio.to_thread(detector.infer, ...)` to finish will
appear to hang for the duration of one inference call (up to ~1s on CPU).
The strategy here is therefore:

  1. Close every WebSocket client immediately, so uvicorn's own connection
     drain has nothing to wait on.
  2. Cancel the inference task, but do NOT await it past a very short
     timeout. The thread will wind down on its own; it does not need to be
     joined for the process to exit cleanly.
  3. Release the capture device and MQTT client synchronously.

If a second Ctrl-C arrives, uvicorn's own force-quit path handles it.
"""

import asyncio
import json
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime

import cv2
from fastapi import Body, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from .config import get_settings
from .detector import Detector
from .mjpeg import mjpeg_buffer
from .plc import AlertEngine, PlcPublisher
from .schemas import Alert, StatusMessage, TripRequest
from .stream import StreamReader

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("iris.main")

settings = get_settings()

# Bounded waits on shutdown. Kept deliberately short: an in-flight
# to_thread inference call cannot be cancelled, so the only thing a longer
# timeout buys is a longer-feeling hang. If the inference task has not
# stopped within this window we let it wind down on its own while the rest
# of shutdown proceeds in parallel.
_SHUTDOWN_TASK_TIMEOUT_S = 0.5
_SHUTDOWN_CLIENT_CLOSE_TIMEOUT_S = 0.5


# -- Shared runtime state -----------------------------------------------------
class Runtime:
    """
    Holds the objects created at startup and shared across requests.

    All mutation of `clients` happens on the asyncio event loop (inside
    async request handlers, with no `await` between a check and its
    corresponding mutation), so no additional locking is needed for it —
    Python/asyncio only switches coroutines at an `await` point. The one
    piece of state genuinely shared across OS threads is mjpeg_buffer,
    which has its own threading.Lock (see mjpeg.py), and PlcPublisher's
    `connected` flag, which has its own lock (see plc.py).
    """

    def __init__(self) -> None:
        self.detector: Detector | None = None
        self.stream: StreamReader | None = None
        self.plc: PlcPublisher | None = None
        self.alerts: AlertEngine | None = None
        self.clients: set[WebSocket] = set()


runtime = Runtime()


# -- Broadcast helper -----------------------------------------------------------
async def broadcast(payload: dict) -> None:
    """Send a JSON payload to every connected /ws client, dropping any that
    fail (they will have already triggered WebSocketDisconnect handling)."""
    if not runtime.clients:
        return
    dead: list[WebSocket] = []
    text = json.dumps(payload, default=str)
    for ws in list(runtime.clients):
        try:
            await ws.send_text(text)
        except Exception:
            dead.append(ws)
    for ws in dead:
        runtime.clients.discard(ws)


async def close_all_clients() -> None:
    """
    Force-close every open WebSocket client. Called from the lifespan's
    finally block so uvicorn does not sit on open connections during
    shutdown. Each close is wrapped in try/except so a single broken socket
    cannot prevent the rest from closing, and the whole batch is bounded by
    a short timeout so a hung TCP teardown cannot stall the process either.
    """
    if not runtime.clients:
        return

    async def _close_one(ws: WebSocket) -> None:
        try:
            await ws.close(code=1001)  # 1001 = going away
        except Exception:
            pass

    log.info("Closing %d WebSocket client(s) for shutdown", len(runtime.clients))
    try:
        await asyncio.wait_for(
            asyncio.gather(
                *(_close_one(ws) for ws in list(runtime.clients)),
                return_exceptions=True,
            ),
            timeout=_SHUTDOWN_CLIENT_CLOSE_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        log.warning("Timed out closing WebSocket clients; continuing shutdown")
    runtime.clients.clear()


# -- Annotation -------------------------------------------------------------
# Colours in BGR (OpenCV) — mirrors the frontend palette.
CLASS_COLOR_BGR = {
    "rip": (68, 68, 239),  # #ef4444
    "foreign_object": (11, 158, 245),  # #f59e0b
    "edge_damage": (248, 189, 56),  # #38bdf8
    "unknown": (170, 170, 170),
}


def draw_annotations(image, detections) -> None:
    """
    Draw boxes + labels onto the frame in place. This is what the /mjpeg
    stream shows — the same boxes the JSON sends, so what the operator sees
    matches the events in the alert feed.
    """
    h, w = image.shape[:2]
    for d in detections:
        x1 = int(d.box.x * w)
        y1 = int(d.box.y * h)
        x2 = int((d.box.x + d.box.w) * w)
        y2 = int((d.box.y + d.box.h) * h)
        color = CLASS_COLOR_BGR.get(d.cls, CLASS_COLOR_BGR["unknown"])

        # Corner brackets (matches the frontend's aesthetic) instead of a
        # full rectangle — cheaper to draw and easier to read over video.
        corner = max(8, min(20, min(x2 - x1, y2 - y1) // 4))
        thickness = 2
        cv2.line(image, (x1, y1), (x1 + corner, y1), color, thickness)
        cv2.line(image, (x1, y1), (x1, y1 + corner), color, thickness)
        cv2.line(image, (x2, y1), (x2 - corner, y1), color, thickness)
        cv2.line(image, (x2, y1), (x2, y1 + corner), color, thickness)
        cv2.line(image, (x1, y2), (x1 + corner, y2), color, thickness)
        cv2.line(image, (x1, y2), (x1, y2 - corner), color, thickness)
        cv2.line(image, (x2, y2), (x2 - corner, y2), color, thickness)
        cv2.line(image, (x2, y2), (x2, y2 - corner), color, thickness)

        # Label chip.
        label = f"{d.cls.replace('_', ' ').upper()} {int(d.confidence * 100)}%"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        chip_y = y1 - th - 8 if y1 > th + 10 else y2 + 4
        cv2.rectangle(image, (x1, chip_y), (x1 + tw + 10, chip_y + th + 8), color, -1)
        cv2.putText(
            image,
            label,
            (x1 + 5, chip_y + th + 2),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (10, 10, 10),
            1,
            cv2.LINE_AA,
        )


# -- Main inference loop --------------------------------------------------------
async def inference_loop() -> None:
    """
    Consume frames forever, running detection/alerting/streaming on each
    one. Runs as a background asyncio task started in lifespan() and
    cancelled on shutdown.

    Cancellation semantics: `asyncio.to_thread` cannot cancel the worker
    thread it dispatched to. When this task is cancelled mid-inference the
    CancelledError will only be raised at the next await point after the
    thread call returns — i.e. up to one inference duration later. That is
    acceptable for shutdown, because lifespan() does not wait for this task
    to actually finish; it only cancels it and moves on. The thread winds
    down on its own.
    """
    assert runtime.stream and runtime.detector and runtime.plc and runtime.alerts
    stream = runtime.stream
    detector = runtime.detector
    plc = runtime.plc
    engine = runtime.alerts

    async for frame in stream.frames():
        result = await asyncio.to_thread(detector.infer, frame.image)

        alerts = engine.update(result.detections, frame.frame_id)

        # Paint annotations on a copy and hand off to the MJPEG buffer —
        # never mutate frame.image in place, since nothing downstream
        # expects it to change.
        annotated = frame.image.copy()
        draw_annotations(annotated, result.detections)
        mjpeg_buffer.update(annotated, quality=75)

        message = {
            "type": "frame",
            "stats": {
                "frame_id": frame.frame_id,
                "fps": round(stream.current_fps, 1),
                "inference_ms": round(result.inference_ms, 1),
                "source": settings.source_descriptor,
                "timestamp": datetime.utcnow().isoformat(),
            },
            "detections": [d.model_dump() for d in result.detections],
            "alerts": [a.model_dump() for a in alerts],
        }

        await broadcast(message)

        for alert in alerts:
            if alert.tier == 3:
                await plc.publish_trip(alert)


# -- Lifespan -----------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup: build the detector, stream reader, alert engine, and MQTT
    publisher, then launch the inference loop as a background task.

    Shutdown order matters, and is deliberately:

      1. Close every WebSocket client. Uvicorn's own connection drain
         will not exit while a /ws client is still attached; closing them
         here gives the drain nothing to wait for.
      2. Cancel the inference task, but do not wait more than a fraction
         of a second for it. If a detection call is mid-flight on a worker
         thread, that thread cannot be interrupted, and waiting for it is
         the difference between a Ctrl-C that feels instant and one that
         feels like a hang. The task is cancelled; the thread winds down on
         its own; the process exits regardless.
      3. Release the capture device and MQTT client. Both are synchronous
         and wrapped so a failure in one cannot skip the other.

    Note: Detector() and StreamReader() are constructed synchronously here.
    Both are internally resilient (Detector always falls back to "no
    model" rather than raising; StreamReader always falls back to a
    disconnected/retrying state rather than raising), so a missing model
    or camera cannot prevent the app from starting — /health will simply
    report streaming: false until a source/model becomes available.
    """
    log.info("IRIS starting — source=%s", settings.source_descriptor)

    runtime.detector = Detector(settings)
    runtime.stream = StreamReader(settings)
    runtime.alerts = AlertEngine(settings)
    runtime.plc = PlcPublisher(settings)
    runtime.plc.connect()

    task = asyncio.create_task(inference_loop())
    log.info("Inference loop started")

    try:
        yield
    finally:
        log.info("IRIS shutting down")

        # 1. Close WebSocket clients first so uvicorn's connection drain
        #    has nothing left to wait on.
        try:
            await close_all_clients()
        except Exception:
            log.exception("Error closing WebSocket clients during shutdown")

        # 2. Cancel the inference task with a very short bound. The worker
        #    thread running detector.infer cannot be cancelled; waiting on
        #    it would stall shutdown for up to one inference duration.
        #    Cancelling the task is sufficient to stop new iterations, and
        #    the process will exit even while the old thread is winding
        #    down.
        task.cancel()
        try:
            await asyncio.wait_for(task, timeout=_SHUTDOWN_TASK_TIMEOUT_S)
        except asyncio.CancelledError:
            pass
        except asyncio.TimeoutError:
            log.info(
                "Inference task did not stop within %.2fs (worker thread "
                "still finishing one detection call); proceeding with "
                "shutdown",
                _SHUTDOWN_TASK_TIMEOUT_S,
            )
        except Exception:
            log.exception("Inference loop raised during shutdown")

        # 3. Release resources. Each wrapped so a failure in one does not
        #    prevent the others from running.
        try:
            if runtime.stream is not None:
                runtime.stream.close()
        except Exception:
            log.exception("Error closing stream during shutdown")
        try:
            if runtime.plc is not None:
                runtime.plc.close()
        except Exception:
            log.exception("Error closing MQTT publisher during shutdown")

        log.info("IRIS stopped")


app = FastAPI(title="IRIS", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# -- Routes -----------------------------------------------------------------
@app.get("/health")
async def health() -> JSONResponse:
    """
    Liveness/readiness check.

    Response: {status, source, clients, mqtt, streaming}
      - streaming is true once at least one frame has been produced.
    Never fails on its own; it only reports on the state of the other
    components (a disconnected camera shows up as streaming: false, not
    as an HTTP error).
    """
    return JSONResponse(
        {
            "status": "ok",
            "source": settings.source_descriptor,
            "clients": len(runtime.clients),
            "mqtt": bool(runtime.plc and runtime.plc.connected),
            "streaming": mjpeg_buffer.has_frame,
        }
    )


@app.get("/config")
async def config() -> JSONResponse:
    """Return the active, non-secret configuration for the dashboard's
    settings panel. Response: {source, model, fallback, conf_threshold,
    tiers, model_kind, model_loaded}.

    model_kind / model_loaded reflect what Detector actually loaded at
    startup (not just what's configured) — "onnx" means a fine-tuned or
    COCO-exported ONNX model is running, "pt" means it fell back to the
    pretrained COCO PyTorch model, "none" means only the classical
    rip-line detector is active.
    """
    detector = runtime.detector
    return JSONResponse(
        {
            "source": settings.source_descriptor,
            "model": settings.model_path,
            "fallback": settings.model_fallback,
            "conf_threshold": settings.conf_threshold,
            "tiers": {
                "t1": settings.tier1_frames,
                "t2": settings.tier2_frames,
                "t3": settings.tier3_frames,
            },
            "model_kind": detector.model_kind if detector else "none",
            "model_loaded": detector.model_loaded if detector else "",
        }
    )


# -- MJPEG stream -------------------------------------------------------------
BOUNDARY = "irisboundary"
_MJPEG_STARTUP_WAIT_S = 5.0
_MJPEG_STARTUP_POLL_S = 0.1
_MJPEG_KEEPALIVE_TIMEOUT_S = 2.0


def mjpeg_generator():
    """
    Yield MJPEG parts for one /mjpeg connection. This is a plain (sync)
    generator; Starlette's StreamingResponse detects that and iterates it
    via its threadpool, which is required here because mjpeg_buffer.get_since
    blocks (via polling) while waiting for a new frame.

    Each connection tracks its own `last_seq` so multiple simultaneous
    dashboard clients each get every new frame once, rather than racing
    each other on a single shared cursor.
    """
    import time

    waited = 0.0
    while not mjpeg_buffer.has_frame and waited < _MJPEG_STARTUP_WAIT_S:
        time.sleep(_MJPEG_STARTUP_POLL_S)
        waited += _MJPEG_STARTUP_POLL_S

    last_seq = -1
    while True:
        frame, last_seq = mjpeg_buffer.get_since(last_seq, timeout=_MJPEG_KEEPALIVE_TIMEOUT_S)
        if frame is None:
            # No new frame within the timeout — send a keepalive so
            # intermediate proxies/browsers don't time out the connection.
            yield b"--" + BOUNDARY.encode() + b"\r\n\r\n"
            continue
        yield (
            b"--" + BOUNDARY.encode() + b"\r\n"
            b"Content-Type: image/jpeg\r\n"
            b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n"
            + frame + b"\r\n"
        )


@app.get("/mjpeg")
async def mjpeg() -> StreamingResponse:
    """
    MJPEG preview stream (multipart/x-mixed-replace). Renders directly in
    an <img> tag or a browser. Never returns an error: if no frame has
    been produced yet, it waits briefly at connection time and then sends
    periodic keepalive parts until one arrives.
    """
    return StreamingResponse(
        mjpeg_generator(),
        media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Connection": "close",
        },
    )


# -- Manual trip (demo) ---------------------------------------------------------
@app.post("/trip")
async def trip(payload: TripRequest | None = Body(default=None)) -> JSONResponse:
    """
    Manually fire a Tier-3 trip, for demos where waiting for a real rip to
    persist for tier3_frames isn't practical. Accepts an optional JSON body
    ``{"reason": "..."}`` for the audit log; a request with no body at all
    is also accepted and uses a default reason.

    Builds a synthetic Alert, routes it through the same
    PlcPublisher.publish_trip path a genuine Tier-3 alert would use (so it
    logs and, if MQTT is connected, publishes exactly like the real thing),
    and also broadcasts it to connected /ws clients so the dashboard
    reflects it immediately rather than waiting for the next frame message.

    Response: {status, alert_id, mqtt}
      - status is "ok" when published to a connected MQTT broker, or
        "logged" when MQTT is offline/disabled — this is intentionally
        never faked as a success when there is no broker to receive it.
      - mqtt is the actual connection state used to decide the above.

    This always returns 200: a missing PLC integration is a normal,
    expected operating mode for the prototype, not a request failure.
    """
    reason = payload.reason if payload else "Manual trigger"
    frame_id = runtime.stream.frame_id if runtime.stream else 0
    alert = Alert(
        id=str(uuid.uuid4())[:8],
        tier=3,
        cls="rip",
        confidence=1.0,
        label="manual trigger",
        frame_id=frame_id,
        timestamp=datetime.utcnow(),
        message=f"Manually triggered trip (demo): {reason}",
    )
    log.warning("Manual trip requested via POST /trip (reason=%r)", reason)

    mqtt_published = False
    if runtime.plc is not None:
        trip_msg = await runtime.plc.publish_trip(alert)
        mqtt_published = bool(runtime.plc.connected)
        await broadcast({**trip_msg.model_dump(), "type": "trip"})
    else:
        log.info("PLC publisher not initialized — trip logged only")

    return JSONResponse(
        {
            "status": "ok" if mqtt_published else "logged",
            "alert_id": alert.id,
            "mqtt": mqtt_published,
        }
    )


# -- WebSocket ---------------------------------------------------------------
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    """
    Dashboard live feed. On connect: accepts, registers the client, and
    sends one StatusMessage. Thereafter it only reads (and discards)
    incoming text, since the client has nothing to send — this keeps the
    connection's receive loop alive so WebSocketDisconnect is detected
    promptly. All outbound frame/alert/trip messages are pushed from
    inference_loop via broadcast().

    Failure modes: any send/receive error removes the client from the
    broadcast set; it does not affect other clients or the inference loop.
    """
    await ws.accept()
    runtime.clients.add(ws)
    log.info("Client connected — total=%d", len(runtime.clients))

    hello = StatusMessage(
        source=settings.source_descriptor,
        model=settings.model_path,
        mqtt_connected=bool(runtime.plc and runtime.plc.connected),
    )
    await ws.send_text(hello.model_dump_json())

    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.warning("WebSocket error: %s", exc)
    finally:
        runtime.clients.discard(ws)
        log.info("Client disconnected — total=%d", len(runtime.clients))