import { RotateCw, Video } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { classColor, classLabel } from '../brand/tokens'
import { useStore } from '../store/useStore'

/**
 * Live MJPEG feed with a canvas overlay for detection boxes.
 *
 * The <img> uses object-contain so the whole video is always visible (never
 * cropped). The canvas matches the *image's rendered rect*, not the wrapper's
 * rect, so detection boxes land on the video pixels they were computed
 * against - not on the container's letterbox area.
 *
 * A ResizeObserver watches both the wrapper and the image element, since
 * the image's rendered size can change even when the wrapper's size does
 * not (e.g. when a new frame with a different aspect ratio arrives).
 */
export function LiveFeed() {
  const connected = useStore((s) => s.connected)
  const stats = useStore((s) => s.stats)
  const detections = useStore((s) => s.detections)

  const [imgKey, setImgKey] = useState(0)
  const [imgError, setImgError] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef({ w: 0, h: 0, left: 0, top: 0 })

  // Keep the canvas aligned to the actual rendered rect of the <img>,
  // accounting for object-contain letterboxing.
  useEffect(() => {
    const wrapper = wrapperRef.current
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!wrapper || !img || !canvas) return

    const realign = () => {
      const wrapRect = wrapper.getBoundingClientRect()
      const imgRect = img.getBoundingClientRect()
      const scale = window.devicePixelRatio || 1

      // Position and size the canvas to match where the image is actually
      // rendered inside the wrapper.
      const left = imgRect.left - wrapRect.left
      const top = imgRect.top - wrapRect.top
      const width = imgRect.width
      const height = imgRect.height

      canvas.style.left = `${left}px`
      canvas.style.top = `${top}px`
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      canvas.width = Math.round(width * scale)
      canvas.height = Math.round(height * scale)

      const ctx = canvas.getContext('2d')
      ctx?.setTransform(scale, 0, 0, scale, 0, 0)

      sizeRef.current = { w: width, h: height, left, top }
    }

    realign()

    const ro = new ResizeObserver(realign)
    ro.observe(wrapper)
    ro.observe(img)
    return () => ro.disconnect()
  }, [imgKey, imgError])

  // Redraw whenever detections change.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { w, h } = sizeRef.current
    ctx.clearRect(0, 0, w, h)
    if (imgError) return

    for (const d of detections) {
      const color = classColor[d.cls] ?? classColor.unknown
      const x = d.box.x * w
      const y = d.box.y * h
      const bw = d.box.w * w
      const bh = d.box.h * h
      drawCornerBrackets(ctx, x, y, bw, bh, color)
      drawLabelChip(
        ctx,
        x,
        y,
        `${classLabel[d.cls] ?? d.cls} ${Math.round(d.confidence * 100)}%`,
        color,
      )
    }
  }, [detections, imgError])

  function retry() {
    setImgError(false)
    setImgKey((k) => k + 1)
  }

  return (
    <section className="glass flex h-full min-h-0 flex-col rounded-2xl p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Video size={15} className="text-ink-muted" />
          <h2 className="font-sans text-sm font-semibold uppercase tracking-wide text-ink">
            Live feed
          </h2>
        </div>
        <div className="flex items-center gap-4 font-mono text-xs text-ink-muted">
          <span>FRAME {stats ? String(stats.frame_id).padStart(6, '0') : '------'}</span>
          <span>{stats ? stats.fps.toFixed(1) : '0.0'} FPS</span>
          <span>{stats ? stats.inference_ms.toFixed(1) : '0.0'} MS</span>
        </div>
      </div>

      <div
        ref={wrapperRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-navy-deep"
      >
        {!imgError ? (
          <img
            ref={imgRef}
            key={imgKey}
            src={`/mjpeg?_r=${imgKey}`}
            alt="Live conveyor belt feed"
            className="h-full w-full object-contain"
            onError={() => setImgError(true)}
            onLoad={() => {
              // Recompute alignment after each frame so boxes follow the
              // image's actual rendered rect as it resizes.
              const img = imgRef.current
              const wrapper = wrapperRef.current
              const canvas = canvasRef.current
              if (!img || !wrapper || !canvas) return
              const wrapRect = wrapper.getBoundingClientRect()
              const imgRect = img.getBoundingClientRect()
              const scale = window.devicePixelRatio || 1
              const left = imgRect.left - wrapRect.left
              const top = imgRect.top - wrapRect.top
              const width = imgRect.width
              const height = imgRect.height
              canvas.style.left = `${left}px`
              canvas.style.top = `${top}px`
              canvas.style.width = `${width}px`
              canvas.style.height = `${height}px`
              canvas.width = Math.round(width * scale)
              canvas.height = Math.round(height * scale)
              const ctx = canvas.getContext('2d')
              ctx?.setTransform(scale, 0, 0, scale, 0, 0)
              sizeRef.current = { w: width, h: height, left, top }
            }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Video size={28} className="text-ink-faint" />
            <div>
              <p className="text-sm font-medium text-ink">Feed unavailable</p>
              <p className="mt-1 text-xs text-ink-muted">Could not reach the video stream.</p>
            </div>
            <button
              onClick={retry}
              className="flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-white/10"
            >
              <RotateCw size={13} />
              Retry
            </button>
          </div>
        )}

        <canvas ref={canvasRef} className="pointer-events-none absolute" />

        {!connected && (
          <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-object/40 bg-object/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-object">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-object motion-reduce:animate-none" />
            Reconnecting…
          </div>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between text-xs text-ink-muted">
        <span>{detections.length} object{detections.length === 1 ? '' : 's'} in frame</span>
      </div>
    </section>
  )
}

function drawCornerBrackets(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  const len = Math.max(8, Math.min(18, Math.min(w, h) / 3))
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  const corners: [number, number, number, number][] = [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ]
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath()
    ctx.moveTo(cx, cy + len * dy)
    ctx.lineTo(cx, cy)
    ctx.lineTo(cx + len * dx, cy)
    ctx.stroke()
  }
}

function drawLabelChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
) {
  ctx.font = '600 11px Inter, system-ui, sans-serif'
  const paddingX = 6
  const textWidth = ctx.measureText(text).width
  const chipW = textWidth + paddingX * 2
  const chipH = 18
  const chipY = y - chipH - 4 >= 0 ? y - chipH - 4 : y + 4

  ctx.fillStyle = color
  ctx.fillRect(x, chipY, chipW, chipH)
  ctx.fillStyle = '#0A0A0A'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + paddingX, chipY + chipH / 2 + 0.5)
}