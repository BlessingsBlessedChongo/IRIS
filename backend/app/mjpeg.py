"""
MJPEG frame buffer.

The inference loop paints each annotated frame into this buffer, and the
/mjpeg endpoint streams whatever is currently in it. This decouples the
inference rate from the HTTP client rate: a slow or newly-connected client
gets the latest frame, not a backlog, and each client only receives a frame
once it is actually new (see get_since below).

This buffer is written from the event loop thread (by the inference loop,
via mjpeg_buffer.update) and read from FastAPI's threadpool (each /mjpeg
connection's generator runs in a worker thread), so it is guarded with a
plain threading.Lock rather than an asyncio.Lock.
"""

from __future__ import annotations

import threading
import time
from typing import Optional

import cv2
import numpy as np


class MjpegBuffer:
    """Holds the single latest encoded JPEG frame, with a monotonic sequence
    number so multiple readers can each detect "is there a frame newer than
    the last one I saw" independently."""

    def __init__(self) -> None:
        self._frame: Optional[bytes] = None
        self._lock = threading.Lock()
        self._seq = 0
        self._last_update = 0.0

    def update(self, image: np.ndarray, quality: int = 75) -> None:
        """Encode the BGR frame as JPEG and store it, bumping the sequence
        number so waiting readers wake up on their next poll."""
        try:
            ok, buf = cv2.imencode(
                ".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality]
            )
            if not ok:
                return
            with self._lock:
                self._frame = buf.tobytes()
                self._seq += 1
                self._last_update = time.monotonic()
        except Exception:
            # A failed encode must never crash the inference loop.
            pass

    def get_since(
        self, last_seq: int, timeout: float = 2.0
    ) -> tuple[Optional[bytes], int]:
        """
        Block (via polling) until a frame newer than `last_seq` is available,
        or until timeout. Returns (frame_bytes, new_seq) on success, or
        (None, last_seq) on timeout so the caller can send a keepalive and
        try again with the same last_seq.

        Callers must pass back the sequence number they were given so this
        method can tell "new since your last call" apart from "any frame at
        all" — each caller (each /mjpeg connection) tracks its own last_seq.
        """
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with self._lock:
                if self._frame is not None and self._seq != last_seq:
                    return self._frame, self._seq
            time.sleep(0.01)
        return None, last_seq

    @property
    def has_frame(self) -> bool:
        with self._lock:
            return self._frame is not None


# One global buffer, set up here and shared with the inference loop and the
# /mjpeg endpoint in main.py.
mjpeg_buffer = MjpegBuffer()
