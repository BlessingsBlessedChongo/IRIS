import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

/** Redirects to /login when there is no stored auth record. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}
