import { RefreshCw } from 'lucide-react'
import { useConfig } from '../hooks/useConfig'
import { ModalShell } from './ModalShell'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

/**
 * Read-only view of GET /config, refetched every time the modal opens.
 * Includes the "Assets" section from the brief (model in use, ONNX vs
 * COCO fallback, active source, tier thresholds) rather than a separate
 * page/route.
 */
export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { config, loading, error, refetch } = useConfig(open)

  return (
    <ModalShell open={open} title="Settings" onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-ink-muted">Live from the backend - read only.</p>
        <button
          onClick={refetch}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-white/10 hover:text-ink"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {loading && !config && <p className="text-sm text-ink-muted">Loading configuration…</p>}

      {error && (
        <p className="rounded-lg border border-rip/30 bg-rip/10 px-3 py-2 text-sm text-rip">
          Could not load configuration: {error}
        </p>
      )}

      {config && (
        <div className="space-y-5 text-sm">
          <section>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-ink-muted">
              Detection thresholds
            </h3>
            <dl className="space-y-2">
              <Row label="Confidence threshold" value={config.conf_threshold.toFixed(2)} />
              <Row label="Tier 1 (frames)" value={String(config.tiers.t1)} />
              <Row label="Tier 2 (frames)" value={String(config.tiers.t2)} />
              <Row label="Tier 3 (frames)" value={String(config.tiers.t3)} />
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-ink-muted">
              Assets &amp; model
            </h3>
            <dl className="space-y-2">
              <Row label="Active model" value={modelKindLabel(config.model_kind)} />
              <Row label="Model file" value={config.model_loaded || 'none loaded'} />
              <Row label="Configured path" value={config.model} />
              <Row label="Fallback model" value={config.fallback} />
              <Row label="Video source" value={config.source} />
            </dl>
          </section>
        </div>
      )}
    </ModalShell>
  )
}

function modelKindLabel(kind: 'onnx' | 'pt' | 'none'): string {
  if (kind === 'onnx') return 'Fine-tuned (ONNX)'
  if (kind === 'pt') return 'COCO fallback (pretrained)'
  return 'None - classical detector only'
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 pb-2 last:border-0 last:pb-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="truncate font-mono text-xs text-ink" title={value}>
        {value}
      </dd>
    </div>
  )
}
