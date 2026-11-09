import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { initialsFrom } from '../lib/format'

const STORAGE_KEY = 'iris.auth'

export interface AuthRecord {
  email: string
  name: string
  initials: string
  loggedInAt: string
}

interface LoginResult {
  ok: boolean
  error?: string
}

interface AuthContextValue {
  user: AuthRecord | null
  login: (email: string, password: string) => LoginResult
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function readStoredAuth(): AuthRecord | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AuthRecord>
    if (!parsed.email || !parsed.loggedInAt) return null
    return {
      email: parsed.email,
      name: parsed.name ?? '',
      initials: parsed.initials ?? initialsFrom(parsed.name ?? '', parsed.email),
      loggedInAt: parsed.loggedInAt,
    }
  } catch {
    return null
  }
}

/**
 * Derive a display name from an email's local part, since this prototype
 * has no real user database or profile form - just email + password.
 * "alex.chen@iris.io" -> "Alex Chen". Documented assumption: the brief's
 * auth record shape includes a `name`, but the login form only collects
 * email + password, so the name is inferred rather than entered.
 */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthRecord | null>(() => readStoredAuth())

  const login = useCallback((email: string, password: string): LoginResult => {
    const trimmedEmail = email.trim()
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)
    if (!trimmedEmail) return { ok: false, error: 'Email is required.' }
    if (!emailValid) return { ok: false, error: 'Enter a valid email address.' }
    if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' }

    const name = nameFromEmail(trimmedEmail)
    const record: AuthRecord = {
      email: trimmedEmail,
      name,
      initials: initialsFrom(name, trimmedEmail),
      loggedInAt: new Date().toISOString(),
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
    setUser(record)
    return { ok: true }
  }, [])

  const logout = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY)
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
