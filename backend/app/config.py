"""
Application configuration.

Loads every tunable value used by the IRIS pipeline from environment
variables (and, if present, a local ``.env`` file). This module is the
single source of truth for tunables — nothing in the rest of the codebase
should hard-code a threshold, path, or frame count that belongs here.

``get_settings()`` is the only supported way to obtain a ``Settings``
instance elsewhere in the app; it is cached so the .env file is parsed
once per process.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# The documented way to run IRIS is `cd backend && uvicorn app.main:app`,
# which puts the process's working directory at backend/ — but .env lives
# at the repo root (backend/app/config.py -> app -> backend -> repo root).
# A plain env_file=".env" would resolve against the CWD and silently never
# find it (all fields have defaults, so this would not error — it would
# just quietly run on defaults instead of the configured values). Anchor
# the path to this file's location instead so it works regardless of where
# uvicorn is launched from.
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_ENV_FILE = _REPO_ROOT / ".env"


class Settings(BaseSettings):
    """
    All runtime configuration for IRIS, sourced from ``IRIS_*`` environment
    variables. See ``.env`` (or ``.env.example``) at the repo root for the
    full list with descriptions and defaults.
    """

    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    # -- Input source --------------------------------------------------
    source: Literal["mp4", "webcam", "rtsp"] = Field("mp4", alias="IRIS_SOURCE")

    # Single-file mp4 source. Used when IRIS_MP4_PATHS is empty. Looped
    # forever by the stream reader.
    mp4_path: str = Field("./data/sample.mp4", alias="IRIS_MP4_PATH")

    # Optional rotation of multiple mp4 files. Comma-separated, full paths,
    # no spaces around commas. When set (non-empty after stripping), the
    # stream reader rotates through these files in order and loops back to
    # the first after the last. When empty, the reader falls back to
    # IRIS_MP4_PATH and loops that single file.
    #
    # Example:
    #   IRIS_MP4_PATHS=C:\iris\data\sample1.mp4,C:\iris\data\sample2.mp4
    mp4_paths: str = Field("", alias="IRIS_MP4_PATHS")

    webcam_index: int = Field(0, alias="IRIS_WEBCAM_INDEX")
    rtsp_url: str = Field("", alias="IRIS_RTSP_URL")

    # -- Model -----------------------------------------------------------
    model_path: str = Field("./models/iris_yolov8n.onnx", alias="IRIS_MODEL_PATH")
    model_fallback: str = Field("yolov8n.pt", alias="IRIS_MODEL_FALLBACK")
    conf_threshold: float = Field(0.45, alias="IRIS_CONF_THRESHOLD")
    img_size: int = Field(640, alias="IRIS_IMG_SIZE")

    # -- Alerting tiers ----------------------------------------------------
    tier1_frames: int = Field(1, alias="IRIS_TIER1_FRAMES")
    tier2_frames: int = Field(5, alias="IRIS_TIER2_FRAMES")
    tier3_frames: int = Field(15, alias="IRIS_TIER3_FRAMES")

    # -- MQTT --------------------------------------------------------------
    mqtt_host: str = Field("localhost", alias="IRIS_MQTT_HOST")
    mqtt_port: int = Field(1883, alias="IRIS_MQTT_PORT")
    mqtt_topic: str = Field("iris/plc/trip", alias="IRIS_MQTT_TOPIC")
    mqtt_enabled: bool = Field(True, alias="IRIS_MQTT_ENABLED")

    # -- Server --------------------------------------------------------------
    host: str = Field("0.0.0.0", alias="IRIS_HOST")
    port: int = Field(8000, alias="IRIS_PORT")
    fps_target: int = Field(15, alias="IRIS_FPS_TARGET")

    # -- Stream reconnection (was hard-coded in stream.py; moved here so it
    #    is tunable and documented alongside the rest of the config) --------
    stream_reconnect_seconds: float = Field(5.0, alias="IRIS_STREAM_RECONNECT_SECONDS")

    def model_post_init(self, __context: object) -> None:
        # data/ and models/ live at the repo root (siblings of backend/),
        # but the default values here ("./data/sample.mp4",
        # "./models/iris_yolov8n.onnx") were being resolved against the
        # process's working directory. Since the documented quick-start is
        # `cd backend && uvicorn app.main:app`, that CWD is backend/, not
        # the repo root — so these relative defaults pointed at
        # backend/data/... and backend/models/..., which don't exist. Anchor
        # any non-absolute path to the repo root, same as the .env file
        # above, so the documented run command finds the real files.
        self.mp4_path = self._to_repo_path(self.mp4_path)
        self.model_path = self._to_repo_path(self.model_path)
        # IRIS_MP4_PATHS is a comma-separated list of paths. Apply the same
        # repo-root anchoring to each entry so relative paths work the same
        # way single-path config does. Empty entries and stray whitespace
        # are stripped.
        self.mp4_paths = self._normalize_mp4_paths(self.mp4_paths)

    @staticmethod
    def _to_repo_path(value: str) -> str:
        p = Path(value)
        return str(p) if p.is_absolute() else str((_REPO_ROOT / p).resolve())

    @classmethod
    def _normalize_mp4_paths(cls, raw: str) -> str:
        """
        Split, trim, drop empties, resolve each entry to an absolute path,
        and re-join with commas. Returns an empty string when nothing valid
        was supplied so the stream reader can fall back to IRIS_MP4_PATH.
        """
        if not raw or not raw.strip():
            return ""
        entries = [e.strip() for e in raw.split(",")]
        resolved = [cls._to_repo_path(e) for e in entries if e]
        return ",".join(resolved)

    @property
    def resolved_model_path(self) -> Path:
        """Absolute filesystem path to the configured model file."""
        return Path(self.model_path)

    @property
    def mp4_path_list(self) -> list[str]:
        """
        The configured mp4 rotation as a list. Empty when IRIS_MP4_PATHS is
        unset. The stream reader uses this in preference to mp4_path.
        """
        if not self.mp4_paths:
            return []
        return [p for p in self.mp4_paths.split(",") if p]

    @property
    def source_descriptor(self) -> str:
        """
        Human-readable description of the active video source, for logs/API.
        For mp4 rotation, reports the full list so the dashboard shows what
        will play, not just the first file.
        """
        if self.source == "mp4":
            paths = self.mp4_path_list
            if paths:
                return "mp4s:" + ",".join(paths)
            return self.mp4_path
        if self.source == "webcam":
            return f"webcam:{self.webcam_index}"
        return self.rtsp_url or "rtsp:<unset>"


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide Settings singleton (parsed once, then cached)."""
    return Settings()