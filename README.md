# IRIS — Intelligent Rip & Integrity System

Real-time conveyor belt rip and foreign-object detection using existing CCTV/IP cameras.
Built for the Kansanshi conveyor-belt challenge.

> **Prototype.** Not affiliated with First Quantum Minerals or Kansanshi Mining PLC.
> Branding is illustrative only.

---

## What it does

- Ingests a video source (mp4 file or rotation of files, webcam, or RTSP stream)
- Runs a small YOLOv8n model plus a classical OpenCV rip-line detector on each frame
- Streams annotated frames and structured detections to a React dashboard over WebSocket
- Escalates alerts through three tiers (visual → alarm → simulated PLC trip)
- Publishes a Modbus-shaped MQTT message when a Tier-3 alert fires

## Stack

- **Backend:** Python 3.11, FastAPI, OpenCV, Ultralytics YOLOv8n, ONNX Runtime, paho-mqtt
- **Frontend:** React 18, Vite 5, TypeScript, Tailwind, Zustand, Framer Motion
- **Model:** fine-tuned YOLOv8n exported to ONNX (`models/iris_yolov8n.onnx`)
- **Broker:** Mosquitto (optional, local)

## Project layout

```
backend/
  app/
    main.py        FastAPI app: /health, /config, /mjpeg, /trip, /ws
    config.py      every tunable, read from IRIS_* environment variables
    stream.py      video reader (mp4 / webcam / RTSP), reconnects on failure
    detector.py    YOLOv8 model + classical rip-line detector
    mjpeg.py       MJPEG preview stream
    plc.py         simulated PLC trip over MQTT
    schemas.py     API and WebSocket message shapes
  requirements.txt
frontend/          React + Vite dashboard
data/              sample conveyor clips (sample.mp4, sample1–3.mp4)
models/            iris_yolov8n.onnx — the fine-tuned model
.env.example       configuration template
```

The sample videos are stored with [Git LFS](https://git-lfs.com). Install it
before cloning (`git lfs install`), or run `git lfs pull` afterwards, to get the
real files instead of small pointer files.

## Quick start

### 1. Prerequisites

- Python **3.11** (3.12 also works)
- Node **20 LTS**, npm **10** (frontend only)
- Git LFS (for the sample videos)
- Optional: Mosquitto for the PLC-trip demo. The backend runs fine without it —
  trips are logged instead.

### 2. Configure

```bash
cp .env.example .env        # Windows: copy .env.example .env
```

The defaults play `data/sample.mp4` and load `models/iris_yolov8n.onnx`.
Relative paths are resolved against the repo root, so the backend finds them no
matter which folder you start it from. Set `IRIS_SOURCE` to `webcam` or `rtsp`
to use a live camera.

### 3. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open http://localhost:8000/docs for the API. `/health` reports
`"streaming": true` within a few seconds once a source is available. If the
source isn't available, the backend still starts, logs a warning and retries
every `IRIS_STREAM_RECONNECT_SECONDS`.

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and sign in with any valid email address and a
password of at least 6 characters. The login is a prototype screen only: there
is no user database, and the session is kept in the browser's local storage.

### 5. MQTT broker (optional)

```bash
mosquitto -v
```

Tier-3 alerts publish a JSON payload on `iris/plc/trip`, repeating roughly every
10 seconds while the fault persists. To watch them:
`mosquitto_sub -t iris/plc/trip -v`. With no broker running (or
`IRIS_MQTT_ENABLED=false`), trips are still logged by the backend — `POST /trip`
and the automatic Tier-3 path both fall back to log-only instead of failing.

## How detection works

The detector loads the best model it can find and never fails to start:

1. **Fine-tuned IRIS model** — `models/iris_yolov8n.onnx`, with the classes
   `rip`, `foreign_object` and `edge_damage`.
2. **Pretrained COCO YOLOv8n** — if the IRIS model is missing or fails to load.
   It picks up people, vehicles and tools as stand-ins for foreign objects. The
   `yolov8n.pt` weights are downloaded automatically on first run; a
   `yolov8n.onnx` export next to it is used instead if present (about 3× faster
   on CPU).
3. **Classical rip-line detector** — always runs alongside the model. It looks
   for long, dark, near-vertical streaks on the belt and needs no training data.

`GET /config` reports which model kind is active.

## Configuration

All settings are `IRIS_*` environment variables, read from `.env` at the repo
root. See `.env.example` for the full list.

| Setting | Default | Meaning |
|---|---|---|
| `IRIS_SOURCE` | `mp4` | `mp4`, `webcam` or `rtsp` |
| `IRIS_MP4_PATH` | `./data/sample.mp4` | single clip, looped |
| `IRIS_MP4_PATHS` | *(empty)* | comma-separated clips to rotate through; overrides `IRIS_MP4_PATH` |
| `IRIS_WEBCAM_INDEX` | `0` | webcam device number |
| `IRIS_RTSP_URL` | *(empty)* | camera stream URL |
| `IRIS_MODEL_PATH` | `./models/iris_yolov8n.onnx` | fine-tuned model |
| `IRIS_CONF_THRESHOLD` | `0.45` (`.env.example`: `0.75`) | minimum detection confidence |
| `IRIS_IMG_SIZE` | `640` (`.env.example`: `416`) | model input size |
| `IRIS_TIER1/2/3_FRAMES` | `1` / `5` / `15` (`.env.example`: `1` / `3` / `5`) | consecutive frames before each alert tier |
| `IRIS_MQTT_ENABLED` | `true` | publish Tier-3 trips over MQTT |
| `IRIS_FPS_TARGET` | `15` (`.env.example`: `25`) | processing frame rate |
| `IRIS_STREAM_RECONNECT_SECONDS` | `5` | retry interval when the source is unavailable |

## API

- `GET /health` → `{status, source, clients, mqtt, streaming}`
- `GET /config` → `{source, model, fallback, conf_threshold, tiers}`
- `GET /mjpeg` → `multipart/x-mixed-replace` MJPEG preview
- `POST /trip` → fires a Tier-3 trip manually (logs it, publishes over MQTT if
  connected, and broadcasts it to connected `/ws` clients) — for demos
- `WS /ws` → one `status` message on connect, then one `frame` message per
  processed frame, plus `trip` messages for manually triggered trips

## Demo script (60 seconds)

1. App is running, dashboard shows the live belt feed with a green "LIVE" dot.
2. Introduce a rip (tape on the screen, or play the rip clip). Within ~1 s a red
   alert card animates in: **RIP DETECTED — conf 0.9x**.
3. Point out the confidence timeline spike and the detection count increment.
4. Drop a spanner/tool in front of the camera: **FOREIGN OBJECT — metal tool**.
5. Press **Simulate PLC Trip** (calls `POST /trip`) and watch the MQTT payload arrive.
6. Close: "6 MB model, $249 edge device, cameras the mine already owns."

## License note

Ultralytics YOLOv8 is AGPL-3.0. Fine for this prototype. Commercial deployment
requires either open-sourcing the stack or an Ultralytics license.
