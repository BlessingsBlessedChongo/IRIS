"""
Video source reader.

Wraps OpenCV's VideoCapture behind a single async interface regardless of
whether frames come from a looped mp4 file (single or a rotating set), a
local webcam, or an RTSP IP camera. This is the only module that touches
cv2.VideoCapture directly; everything downstream (detector, mjpeg, main)
just consumes Frame objects.

Behaviours implemented here (not left to the caller):

  1. Every blocking OpenCV call (opening a capture, reading a frame) is run
     via asyncio.to_thread so it never stalls the event loop - a slow RTSP
     read must not delay /health, /ws, or other clients' /mjpeg frames.

  2. If the source is unavailable at startup or drops mid-stream (no
     webcam, unreachable camera, missing file), StreamReader does not
     raise and does not crash the app. It logs a warning and retries on
     an interval, so the service comes up (and later recovers) without a
     restart.

  3. When multiple mp4 files are configured (IRIS_MP4_PATHS), the reader
     rotates through them in order, opening each fresh rather than seeking,
     which avoids the mid-file decode stalls that CAP_PROP_POS_FRAMES can
     produce on some codecs. When only one file is configured
     (IRIS_MP4_PATH), it loops that single file forever.
"""

import asyncio
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator

import cv2
import numpy as np

from .config import Settings

log = logging.getLogger("iris.stream")


@dataclass
class Frame:
    """A single decoded frame plus the metadata the rest of the pipeline needs."""

    frame_id: int
    image: np.ndarray  # BGR, as OpenCV gives it
    timestamp: float  # monotonic seconds


class StreamReader:
    """
    Unified video source reader.

    Supports three modes (set via IRIS_SOURCE in .env):
      - mp4     : loops a local file, or rotates through several files
      - webcam  : reads from a local camera index
      - rtsp    : reads from an RTSP URL (IP camera)

    Emits frames at approximately IRIS_FPS_TARGET. For file sources we sleep
    to hit the target; for live sources we drop frames if we fall behind.

    Construction never raises: if the source can't be opened immediately,
    the reader starts in a disconnected state and frames() retries opening
    it in the background at IRIS_STREAM_RECONNECT_SECONDS intervals.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.cap: cv2.VideoCapture | None = None
        self.frame_id = 0
        self._last_ts = 0.0
        self._fps_window: list[float] = []
        self._warned_disconnected = False

        # For mp4 rotation: the resolved list of file paths, plus the index
        # of the one currently open.
        self._mp4_paths: list[str] = []
        self._mp4_index: int = 0

        self._try_open()

    # -- Source resolution -------------------------------------------------
    def _resolve_mp4_paths(self) -> list[str]:
        """
        Build the ordered list of mp4 files to play.

        Priority:
          1. IRIS_MP4_PATHS if set (comma-separated). Missing entries are
             dropped with a warning.
          2. IRIS_MP4_PATH if set. Single-file loop.
        Always returns at least one element if it succeeds; empty list if
        nothing valid was found.
        """
        s = self.settings

        # 1. Multi-file list
        if s.mp4_paths:
            raw = [p.strip() for p in s.mp4_paths.split(",") if p.strip()]
            valid = [p for p in raw if Path(p).exists()]
            missing = [p for p in raw if p not in valid]
            for m in missing:
                log.warning("IRIS_MP4_PATHS entry not found, skipping: %s", m)
            if valid:
                return valid
            log.warning(
                "IRIS_MP4_PATHS was set but none of the files exist; falling "
                "back to IRIS_MP4_PATH"
            )

        # 2. Single-file fallback
        if s.mp4_path:
            if Path(s.mp4_path).exists():
                return [s.mp4_path]
            log.warning("IRIS_MP4_PATH not found: %s", s.mp4_path)

        return []

    # -- Setup --------------------------------------------------------------
    def _build_capture(self) -> cv2.VideoCapture | None:
        """Attempt to open the configured source. Returns None on failure
        instead of raising - callers decide how to log/retry."""
        s = self.settings

        if s.source == "mp4":
            paths = self._resolve_mp4_paths()
            if not paths:
                log.warning(
                    "No usable mp4 files (checked IRIS_MP4_PATHS and "
                    "IRIS_MP4_PATH); will retry."
                )
                return None
            self._mp4_paths = paths
            # Wrap the index if the list shrank since last open
            if self._mp4_index >= len(paths):
                self._mp4_index = 0
            path = paths[self._mp4_index]
            cap = cv2.VideoCapture(path)
            if not cap.isOpened():
                log.warning("Could not open video file: %s (will retry)", path)
                return None
            log.info(
                "Opened mp4 [%d/%d]: %s",
                self._mp4_index + 1,
                len(paths),
                path,
            )
            return cap

        if s.source == "webcam":
            cap = cv2.VideoCapture(s.webcam_index)
            if not cap.isOpened():
                log.warning(
                    "Could not open webcam index %d (will retry)", s.webcam_index
                )
                return None
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            return cap

        if s.source == "rtsp":
            if not s.rtsp_url:
                log.warning("IRIS_SOURCE=rtsp but IRIS_RTSP_URL is empty (will retry)")
                return None
            # Force FFmpeg backend for RTSP - gives us TCP transport, which
            # loses far fewer packets than UDP on a typical factory LAN.
            cap = cv2.VideoCapture(s.rtsp_url, cv2.CAP_FFMPEG)
            if not cap.isOpened():
                log.warning("Could not open RTSP stream: %s (will retry)", s.rtsp_url)
                return None
            return cap

        log.error("Unknown IRIS_SOURCE: %s", s.source)
        return None

    def _try_open(self) -> bool:
        """Synchronous open attempt. Safe to call repeatedly."""
        cap = self._build_capture()
        if cap is None:
            return False
        self.cap = cap
        self._warned_disconnected = False
        log.info("Stream opened: %s", self.settings.source_descriptor)
        return True

    def _release_and_reopen(self) -> bool:
        """
        Used when a file ends: release the current capture, advance to the
        next mp4 in the rotation (or rewind to the same one if only one),
        and open it fresh. Reopening is more reliable than seeking on a
        finished file for most codecs, and it makes multi-file rotation
        trivial.
        """
        if self.cap is not None:
            try:
                self.cap.release()
            except Exception:
                pass
            self.cap = None

        if self._mp4_paths:
            self._mp4_index = (self._mp4_index + 1) % len(self._mp4_paths)

        return self._try_open()

    # -- Properties ----------------------------------------------------------
    @property
    def is_open(self) -> bool:
        return self.cap is not None and self.cap.isOpened()

    @property
    def current_fps(self) -> float:
        if len(self._fps_window) < 2:
            return 0.0
        span = self._fps_window[-1] - self._fps_window[0]
        if span <= 0:
            return 0.0
        return (len(self._fps_window) - 1) / span

    @property
    def source_size(self) -> tuple[int, int]:
        """(width, height) of the source. Falls back to 1280x720."""
        if not self.cap:
            return (1280, 720)
        w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1280
        h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 720
        return (w, h)

    # -- Frame iterator --------------------------------------------------------
    async def frames(self) -> AsyncIterator[Frame]:
        """
        Yield frames forever. Never raises: a closed/unreachable source is
        retried on IRIS_STREAM_RECONNECT_SECONDS, logging once per outage
        (not once per attempt) to keep the log readable.

        For mp4 sources:
          - End of file triggers a release + reopen rather than a seek.
          - If multiple files were configured, the next one in the list is
            opened. Otherwise the same file restarts.
        """
        target_dt = 1.0 / max(1, self.settings.fps_target)
        is_file = self.settings.source == "mp4"
        reconnect_s = self.settings.stream_reconnect_seconds

        while True:
            if not self.is_open:
                if not self._warned_disconnected:
                    log.warning(
                        "Source unavailable (%s); retrying every %.0fs",
                        self.settings.source_descriptor,
                        reconnect_s,
                    )
                    self._warned_disconnected = True
                opened = await asyncio.to_thread(self._try_open)
                if not opened:
                    await asyncio.sleep(reconnect_s)
                    continue

            t0 = time.monotonic()
            assert self.cap is not None
            ok, image = await asyncio.to_thread(self.cap.read)

            if not ok or image is None:
                if is_file:
                    # End of file: reopen (advancing to the next mp4 if a
                    # rotation was configured). Runs in a thread because
                    # VideoCapture() can block for a few hundred ms.
                    log.info("End of clip; advancing to next mp4 source")
                    opened = await asyncio.to_thread(self._release_and_reopen)
                    if not opened:
                        # Something went wrong mid-rotation; back off briefly
                        await asyncio.sleep(reconnect_s)
                    continue
                # Live source dropped a frame (or the connection died). Close
                # and let the top of the loop attempt a clean reconnect
                # rather than spinning on a dead capture object.
                log.warning("Frame grab failed on live source; reconnecting")
                await asyncio.to_thread(self.cap.release)
                self.cap = None
                continue

            self.frame_id += 1
            now = time.monotonic()
            self._last_ts = now
            self._fps_window.append(now)
            if len(self._fps_window) > 30:
                self._fps_window.pop(0)

            yield Frame(frame_id=self.frame_id, image=image, timestamp=now)

            # Pace file sources so they play at real time; live sources play free.
            if is_file:
                elapsed = time.monotonic() - t0
                await asyncio.sleep(max(0.0, target_dt - elapsed))
            else:
                await asyncio.sleep(0)

    # -- Teardown ------------------------------------------------------------
    def close(self) -> None:
        """Release the underlying capture device. Safe to call multiple times."""
        if self.cap is not None:
            try:
                self.cap.release()
            except Exception:
                pass
            self.cap = None
            log.info("Stream closed")