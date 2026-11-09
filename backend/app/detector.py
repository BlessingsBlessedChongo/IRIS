"""
Defect detection.

Detector wraps two independent signal sources and merges their output:

  1. A YOLOv8 model — the fine-tuned ONNX export if one has been trained
     and dropped into models/, otherwise a pretrained COCO model (as .pt or
     as an ONNX export of the .pt), so the demo has *something* to show on
     day one.
  2. A classical OpenCV line detector looking for long, dark, near-vertical
     streaks on the belt surface (candidate rips). This runs unconditionally,
     with or without a model, and is what makes the "no trained model yet"
     fallback a real fallback rather than a dead demo.

Results from both are merged and deduplicated by IoU before being handed
back to the caller (main.py's inference loop), which feeds them to the
AlertEngine.

Model kind reporting
--------------------
Internally we track four kinds, because the COCO fallback needs different
post-processing than a fine-tuned IRIS model, and because ONNX vs PyTorch
is a performance detail the frontend does not need to know about:

    onnx-iris : fine-tuned IRIS model, exported to ONNX       -> IRIS classes
    onnx-coco : pretrained COCO model, exported to ONNX       -> COCO classes
    pt-coco   : pretrained COCO model, loaded as PyTorch .pt  -> COCO classes
    none      : no model at all; classical detector only

/config reports the coarse kind ("onnx", "pt", "none") so the dashboard's
model_kind label keeps working unchanged.
"""

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from .config import Settings
from .schemas import BoundingBox, Detection

log = logging.getLogger("iris.detector")


# -- Internal result container --------------------------------------------
@dataclass
class DetectionResult:
    """Output of one Detector.infer() call: merged detections plus timing."""

    detections: list[Detection] = field(default_factory=list)
    inference_ms: float = 0.0


# -- Class mapping -----------------------------------------------------------
# Our fine-tuned model outputs these class indices directly.
IRIS_CLASSES = ["rip", "foreign_object", "edge_damage"]

# COCO class id -> IRIS class. Used only when running the pretrained fallback
# so the demo has *some* signal before a real model is trained.
# COCO: 24=backpack 26=handbag 28=suitcase 39=bottle 41=cup 43=knife
#       67=cell phone 76=scissors — the "tool-ish, doesn't belong on a belt"
# subset, mapped to foreign_object.
COCO_TO_IRIS = {
    24: "foreign_object",
    26: "foreign_object",
    28: "foreign_object",
    39: "foreign_object",
    41: "foreign_object",
    43: "foreign_object",
    67: "foreign_object",
    76: "foreign_object",
}

# -- Classical rip-line detector tuning --------------------------------------
# Named here (rather than left as inline literals) so the algorithm's
# behaviour can be understood and adjusted without reading the method body.
_CV_DOWNSCALE = 2  # process at half resolution for speed
_CV_BLUR_KERNEL = (5, 5)
_CV_ADAPTIVE_BLOCK_SIZE = 31  # must be odd; neighbourhood size for threshold
_CV_ADAPTIVE_C = 10  # constant subtracted from the local mean
_CV_CLOSE_KERNEL = (3, 15)  # tall, thin kernel: bridges gaps along a vertical rip
_CV_HOUGH_THRESHOLD = 60  # min votes for a line in Hough space
_CV_MIN_LINE_LENGTH_FRAC = 0.15  # of frame height, passed to HoughLinesP
_CV_MAX_LINE_GAP = 20
_CV_MIN_KEEP_LENGTH_FRAC = 0.25  # of frame height; shorter lines are discarded
_CV_ANGLE_MIN_DEG = 60  # near-vertical band: reject horizontal scratches/glare
_CV_ANGLE_MAX_DEG = 120
_CV_MAX_CONFIDENCE = 0.85  # classical signal is never as trustworthy as a trained model
_CV_CONFIDENCE_LENGTH_FRAC = 0.9  # length (as a fraction of frame height) for max confidence
_CV_MAX_LINES = 8  # cap results per frame so a noisy frame can't flood the dashboard


class Detector:
    """
    Wraps a YOLOv8 model (fine-tuned ONNX, or fallback COCO .pt / .onnx)
    plus the classical OpenCV rip-line detector described above.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.model: Any = None
        # One of: "onnx-iris", "onnx-coco", "pt-coco", "none"
        self.model_kind_internal: str = "none"
        self.model_loaded: str = ""  # actual file/name loaded, for /config
        self.class_names: dict[int, str] = {}
        self.source_w, self.source_h = 1280, 720

        self._load_model()

    # -- Model loading --------------------------------------------------------
    def _load_model(self) -> None:
        """
        Load the fine-tuned ONNX model if present. Otherwise:
          - If models/iris_yolov8n.onnx exists but failed to load, fall back.
          - Otherwise load the pretrained COCO model as .pt and, if the
            matching .onnx export exists, prefer that (it is ~3x faster on
            CPU and produces identical detections).

        Every branch here is expected to fail sometimes (no GPU, no model
        file, no network) and must not raise — the classical detector always
        keeps the service useful even when model_kind_internal == "none".
        """
        s = self.settings
        model_file = s.resolved_model_path

        # 1. Try the fine-tuned IRIS ONNX model.
        if model_file.exists() and model_file.suffix == ".onnx":
            try:
                from ultralytics import YOLO
                self.model = YOLO(str(model_file), task="detect")
                self.model_kind_internal = "onnx-iris"
                self.model_loaded = str(model_file)
                self.class_names = {i: n for i, n in enumerate(IRIS_CLASSES)}
                log.info("Loaded fine-tuned IRIS ONNX model: %s", model_file)
                return
            except Exception as exc:
                log.warning("Could not load IRIS ONNX model (%s); trying COCO fallback", exc)

        # 2. Look for a COCO ONNX export next to where yolov8n.pt lives.
        #    Convention: models/yolov8n.onnx. This is what the manual export
        #    command in the README produces, and it is dramatically faster
        #    than the .pt fallback on CPU.
        coco_onnx = Path(s.model_fallback).with_suffix(".onnx")
        if coco_onnx.exists():
            try:
                from ultralytics import YOLO
                self.model = YOLO(str(coco_onnx), task="detect")
                self.model_kind_internal = "onnx-coco"
                self.model_loaded = str(coco_onnx)
                names = getattr(self.model, "names", {}) or {}
                self.class_names = {int(k): str(v) for k, v in names.items()}
                log.warning(
                    "Loaded pretrained COCO ONNX fallback: %s. Detections will "
                    "be mapped to IRIS classes best-effort. Train a real model "
                    "for accuracy.",
                    coco_onnx,
                )
                return
            except Exception as exc:
                log.warning("Could not load COCO ONNX fallback (%s); trying .pt", exc)

        # 3. Load the pretrained COCO PyTorch model.
        try:
            from ultralytics import YOLO
            self.model = YOLO(s.model_fallback)
            self.model_kind_internal = "pt-coco"
            self.model_loaded = s.model_fallback
            names = getattr(self.model, "names", {}) or {}
            self.class_names = {int(k): str(v) for k, v in names.items()}
            log.warning(
                "Falling back to pretrained PyTorch model '%s' (COCO). This is "
                "the slowest configuration - export to ONNX for ~3x faster "
                "inference on CPU. Train a real model for accuracy.",
                s.model_fallback,
            )
        except Exception as exc:
            log.error(
                "No model could be loaded (%s). Running on the classical "
                "rip-line detector only.",
                exc,
            )
            self.model = None
            self.model_kind_internal = "none"
            self.model_loaded = ""

    # -- Public API -----------------------------------------------------------
    def infer(self, image: np.ndarray) -> DetectionResult:
        """
        Run both detectors on one BGR frame and return merged, deduplicated
        detections. This is a synchronous, CPU/GPU-bound call — callers on
        the event loop must run it via asyncio.to_thread (see main.py).
        """
        t0 = time.perf_counter()
        h, w = image.shape[:2]
        self.source_w, self.source_h = w, h

        detections: list[Detection] = []

        if self.model is not None:
            detections.extend(self._infer_yolo(image, w, h))

        # Always run the classical detector — it works with no model at all.
        detections.extend(self._infer_rip_lines(image, w, h))

        detections = self._dedupe(detections)

        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return DetectionResult(detections=detections, inference_ms=elapsed_ms)

    # -- Reporting (used by /config) ---------------------------------------
    @property
    def model_kind(self) -> str:
        """
        Coarse model kind for the dashboard: "onnx" | "pt" | "none".
        Both ONNX variants report "onnx" because that is the fact the
        operator cares about (is the fast path active).
        """
        if self.model_kind_internal in ("onnx-iris", "onnx-coco"):
            return "onnx"
        if self.model_kind_internal == "pt-coco":
            return "pt"
        return "none"

    # -- YOLO path --------------------------------------------------------------
    def _infer_yolo(self, image: np.ndarray, w: int, h: int) -> list[Detection]:
        """Run the loaded YOLO model and convert its boxes to Detection objects
        with normalized [0..1] coordinates."""
        assert self.model is not None
        try:
            results = self.model.predict(
                source=image,
                imgsz=self.settings.img_size,
                conf=self.settings.conf_threshold,
                verbose=False,
            )
        except Exception as exc:
            log.warning("Inference error: %s", exc)
            return []

        out: list[Detection] = []
        for r in results:
            if r.boxes is None:
                continue
            for box in r.boxes:
                cls_id = int(box.cls[0].item())
                conf = float(box.conf[0].item())
                x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]

                if self.model_kind_internal in ("pt-coco", "onnx-coco"):
                    # COCO fallback path — map COCO ids to IRIS vocabulary.
                    iris_cls = COCO_TO_IRIS.get(cls_id)
                    if iris_cls is None:
                        continue  # ignore people, cars, etc. in the demo
                    label = self.class_names.get(cls_id, "object")
                else:
                    # Fine-tuned IRIS model — class ids are 0..2 as trained.
                    iris_cls = (
                        IRIS_CLASSES[cls_id]
                        if 0 <= cls_id < len(IRIS_CLASSES)
                        else "unknown"
                    )
                    label = iris_cls

                out.append(
                    Detection(
                        cls=iris_cls,  # type: ignore[arg-type]
                        confidence=conf,
                        box=BoundingBox(
                            x=x1 / w,
                            y=y1 / h,
                            w=(x2 - x1) / w,
                            h=(y2 - y1) / h,
                        ),
                        label=label,
                    )
                )
        return out

    # -- Classical rip-line detector ----------------------------------------------
    def _infer_rip_lines(self, image: np.ndarray, w: int, h: int) -> list[Detection]:
        """
        Cheap, robust rip detector:
          1. Downscale + grayscale + blur
          2. Adaptive threshold to isolate dark features on the belt surface
          3. Morphological close to bridge gaps along a rip
          4. Hough line transform to find long, near-vertical streaks
          5. Keep lines that are long enough and steep enough to be a rip

        This works without any training data and is what runs the demo on
        day one, before a model has been trained.
        """
        try:
            small = cv2.resize(image, (w // _CV_DOWNSCALE, h // _CV_DOWNSCALE))
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            gray = cv2.GaussianBlur(gray, _CV_BLUR_KERNEL, 0)

            # Dark features on a lighter belt.
            thresh = cv2.adaptiveThreshold(
                gray, 255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY_INV,
                blockSize=_CV_ADAPTIVE_BLOCK_SIZE, C=_CV_ADAPTIVE_C,
            )

            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, _CV_CLOSE_KERNEL)
            closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

            lines = cv2.HoughLinesP(
                closed,
                rho=1,
                theta=np.pi / 180,
                threshold=_CV_HOUGH_THRESHOLD,
                minLineLength=int(h * _CV_MIN_LINE_LENGTH_FRAC),
                maxLineGap=_CV_MAX_LINE_GAP,
            )

            out: list[Detection] = []
            if lines is None:
                return out

            # HoughLinesP's output shape has changed across OpenCV versions
            # (historically (N, 1, 4); some builds — including OpenCV 5.x at
            # the time of writing — return (N, 4) directly). Normalize with
            # reshape rather than assuming either shape, so this keeps
            # working across the OpenCV version range in requirements.txt.
            lines = lines.reshape(-1, 4)

            for line in lines[:_CV_MAX_LINES]:
                x1, y1, x2, y2 = line
                # Scale coordinates back up to full resolution.
                x1, y1, x2, y2 = (
                    x1 * _CV_DOWNSCALE, y1 * _CV_DOWNSCALE,
                    x2 * _CV_DOWNSCALE, y2 * _CV_DOWNSCALE,
                )

                dx = x2 - x1
                dy = y2 - y1
                length = float(np.hypot(dx, dy))
                if length < h * _CV_MIN_KEEP_LENGTH_FRAC:
                    continue
                angle = abs(np.degrees(np.arctan2(dy, dx)))
                if not (_CV_ANGLE_MIN_DEG <= angle <= _CV_ANGLE_MAX_DEG):
                    continue

                bx = min(x1, x2)
                by = min(y1, y2)
                bw = max(abs(dx), 6)
                bh = max(abs(dy), 6)

                # Confidence proxy: relative length, capped so the classical
                # signal never outranks a real model's confidence.
                conf = float(
                    min(_CV_MAX_CONFIDENCE, length / (h * _CV_CONFIDENCE_LENGTH_FRAC))
                )

                out.append(
                    Detection(
                        cls="rip",
                        confidence=conf,
                        box=BoundingBox(
                            x=bx / w,
                            y=by / h,
                            w=bw / w,
                            h=bh / h,
                        ),
                        label="rip (cv)",
                    )
                )
            return out
        except Exception as exc:
            log.warning("Classical rip detector error: %s", exc)
            return []

    # -- Dedupe -----------------------------------------------------------------
    def _dedupe(self, detections: list[Detection]) -> list[Detection]:
        """Keep the highest-confidence detection per (class, overlapping-box)
        group, so the YOLO and classical detectors don't double-report the
        same rip."""
        if not detections:
            return []
        detections.sort(key=lambda d: d.confidence, reverse=True)
        kept: list[Detection] = []
        for d in detections:
            if any(self._iou(d.box, k.box) > 0.5 and d.cls == k.cls for k in kept):
                continue
            kept.append(d)
        return kept

    @staticmethod
    def _iou(a: BoundingBox, b: BoundingBox) -> float:
        """Intersection-over-union of two normalized boxes."""
        ax1, ay1, ax2, ay2 = a.x, a.y, a.x + a.w, a.y + a.h
        bx1, by1, bx2, by2 = b.x, b.y, b.x + b.w, b.y + b.h
        ix1, iy1 = max(ax1, bx1), max(ay1, by1)
        ix2, iy2 = min(ax2, bx2), min(ay2, by2)
        iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
        inter = iw * ih
        if inter <= 0:
            return 0.0
        area_a = max(0.0, (ax2 - ax1)) * max(0.0, (ay2 - ay1))
        area_b = max(0.0, (bx2 - bx1)) * max(0.0, (by2 - by1))
        union = area_a + area_b - inter
        return inter / union if union > 0 else 0.0