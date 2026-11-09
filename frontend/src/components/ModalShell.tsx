import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalShellProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

/**
 * Shared modal chrome used by ProfileModal and SettingsModal: backdrop
 * click-to-close, Escape-to-close, and a consistent glass surface.
 *
 * Rendered through a React portal into document.body. This is required, not
 * decorative: the modals are mounted inside <Header className="glass">, and
 * .glass applies backdrop-filter, which creates a new stacking context in
 * Chromium and WebKit. Without the portal, the modal - even with a high
 * z-index - is trapped inside the header's stacking context and painted
 * behind sibling panels like AlertPanel and StatStrip.
 *
 * z-[1100] sits above the AccountMenu dropdown portal (zIndex 1000) so that
 * opening Settings or Profile from the menu layers correctly.
 */
export function ModalShell({ open, title, onClose, children }: ModalShellProps) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // Lock body scroll while any modal is open, so a long modal doesn't
  // push the background page.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
          role="presentation"
        >
          <motion.div
            className="glass-strong w-full max-w-md rounded-2xl p-5 shadow-glass"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-sans text-sm font-semibold uppercase tracking-wide text-ink">
                {title}
              </h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="rounded-md p-1 text-ink-muted transition-colors hover:bg-white/10 hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}