import { ChevronDown, Download, LogOut, Settings, UserRound } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { downloadCurrentSessionReport } from '../lib/report'
import { useStore } from '../store/useStore'
import { ProfileModal } from './ProfileModal'
import { SettingsModal } from './SettingsModal'

/**
 * Avatar + dropdown: Profile, Settings, Download session report, Sign out.
 *
 * The dropdown is rendered through a React portal into document.body so it
 * escapes the header's stacking context. The header uses .glass, which
 * applies backdrop-filter and therefore creates a new stacking context in
 * Chromium and WebKit - any absolutely-positioned child would be trapped
 * inside it and could not be layered above sibling panels. The portal
 * sidesteps that entirely.
 */
export function AccountMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return
      }
      setOpen(false)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Position the portal relative to the trigger button. Recompute on resize
  // and scroll so the menu stays anchored if the layout shifts.
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    setMenuPos({
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()

    const onResize = () => updatePosition()
    const onScroll = () => updatePosition()
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, updatePosition])

  function handleSignOut() {
    setOpen(false)
    logout()
    navigate('/login', { replace: true })
  }

  function handleDownloadReport() {
    setOpen(false)
    const { source, model, counts, feed } = useStore.getState()
    void downloadCurrentSessionReport({ source, model, counts, feed })
  }

  if (!user) return null

  const menu = open && menuPos ? (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'fixed',
        top: menuPos.top,
        right: menuPos.right,
        zIndex: 1000,
      }}
      className="glass-strong w-56 overflow-hidden rounded-xl p-1 shadow-glass"
    >
      <MenuItem
        icon={<UserRound size={15} />}
        onClick={() => {
          setProfileOpen(true)
          setOpen(false)
        }}
      >
        Profile
      </MenuItem>
      <MenuItem
        icon={<Settings size={15} />}
        onClick={() => {
          setSettingsOpen(true)
          setOpen(false)
        }}
      >
        Settings
      </MenuItem>
      <MenuItem icon={<Download size={15} />} onClick={handleDownloadReport}>
        Download session report
      </MenuItem>
      <div className="my-1 border-t border-white/10" />
      <MenuItem icon={<LogOut size={15} />} onClick={handleSignOut} tone="danger">
        Sign out
      </MenuItem>
    </div>
  ) : null

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pl-1 pr-2.5 text-sm text-ink transition-colors hover:bg-white/10"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber font-mono text-xs font-semibold text-navy">
          {user.initials}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-xs font-semibold">{user.name || user.email}</span>
          <span className="block text-[10px] uppercase tracking-wide text-ink-muted">Operator</span>
        </span>
        <ChevronDown size={14} className="text-ink-muted" />
      </button>

      {typeof document !== 'undefined' && menu
        ? createPortal(menu, document.body)
        : null}

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

function MenuItem({
  children,
  icon,
  onClick,
  tone = 'default',
}: {
  children: ReactNode
  icon: ReactNode
  onClick: () => void
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/10 ${
        tone === 'danger' ? 'text-rip' : 'text-ink'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}