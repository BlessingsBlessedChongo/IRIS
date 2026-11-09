import { useAuth } from '../auth/AuthContext'
import { formatClock } from '../lib/format'
import { ModalShell } from './ModalShell'

interface ProfileModalProps {
  open: boolean
  onClose: () => void
}

/** Read-only view of the stored auth record - email, derived name, and
 * when the current session started. */
export function ProfileModal({ open, onClose }: ProfileModalProps) {
  const { user } = useAuth()

  return (
    <ModalShell open={open} title="Profile" onClose={onClose}>
      {user ? (
        <dl className="space-y-3 text-sm">
          <Row label="Name" value={user.name || '—'} />
          <Row label="Email" value={user.email} />
          <Row
            label="Signed in"
            value={`${new Date(user.loggedInAt).toLocaleDateString()} ${formatClock(user.loggedInAt)}`}
          />
        </dl>
      ) : (
        <p className="text-sm text-ink-muted">No operator session found.</p>
      )}
    </ModalShell>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0">
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="font-mono text-sm text-ink">{value}</dd>
    </div>
  )
}
