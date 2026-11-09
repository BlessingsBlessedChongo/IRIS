import { LogIn, ShieldCheck, Lock, Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { brand } from '../brand/tokens'

/**
 * Operator sign-in. Validates input client-side, shows a brief simulated
 * authentication delay so the loading state is visible, and surfaces a
 * single inline error banner for any failure. Design is unchanged from the
 * original - only bug fixes and honest validation were added.
 */
export function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [shaking, setShaking] = useState(false)

  if (user) return <Navigate to="/dashboard" replace />

  function validate(): string | null {
    const trimmed = email.trim()
    if (!trimmed) return 'Operator email is required.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return 'Enter a valid operator email address.'
    }
    if (password.length < 6) {
      return 'Access password must be at least 6 characters.'
    }
    return null
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return

    const validationError = validate()
    if (validationError) {
      setError(validationError)
      setShaking(true)
      window.setTimeout(() => setShaking(false), 400)
      return
    }

    setError(null)
    setSubmitting(true)

    await new Promise((r) => setTimeout(r, 450))

    const result = login(email.trim(), password)
    if (!result.ok) {
      setSubmitting(false)
      setError(result.error ?? 'Authentication failed.')
      setShaking(true)
      window.setTimeout(() => setShaking(false), 400)
      return
    }

    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#070B12] p-4 overflow-hidden">
      {/* Background ambient lights. One pulsing, one static. */}
      <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-amber/10 blur-[120px] pointer-events-none animate-pulse motion-reduce:animate-none" />
      <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-cyan-500/10 blur-[120px] pointer-events-none" />

      {/* Main container */}
      <div
        className={`relative grid w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-[#0E1626]/80 backdrop-blur-xl shadow-[0_0_50px_rgba(0,0,0,0.6)] lg:grid-cols-2 ${
          shaking ? 'animate-[shake_0.4s_ease-in-out]' : ''
        }`}
      >
        {/* Brand side */}
        <div className="hidden flex-col justify-between p-8 lg:flex relative border-r border-white/5 bg-gradient-to-br from-white/[0.04] to-transparent">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt=""
              aria-hidden
              className="h-16 w-18 object-contain"
            />
            <div>
              <p className="font-sans text-lg font-extrabold tracking-tight text-white">
                {brand.name}
              </p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-cyan-400 font-medium">
                {brand.fullName}
              </p>
            </div>
          </div>

          <div className="space-y-4 my-auto py-8">
            <p className="font-sans text-3xl font-bold leading-tight text-white tracking-tight">
              {brand.tagline}
            </p>
            <p className="text-sm text-slate-400 leading-relaxed">
              Sub-millisecond optical inspection and predictive rip telemetry for mission-critical conveyor networks.
            </p>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-white/5 pt-4">
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping motion-reduce:animate-none" />
              Node Telemetry Secure
            </span>
            <span>{brand.footer}</span>
          </div>
        </div>

        {/* Authentication form side */}
        <div className="flex flex-col justify-center p-8 lg:p-10 bg-[#0B101B]/90">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <img
              src="/logo.png"
              alt=""
              aria-hidden
              className="h-12 w-12 object-contain"
            />
            <p className="font-sans text-lg font-extrabold tracking-tight text-white">
              {brand.name}
            </p>
          </div>

          <div className="space-y-1.5 mb-6">
            <div className="flex items-center gap-2 text-amber text-xs font-semibold uppercase tracking-wider">
              <ShieldCheck size={14} />
              <span>Authorized Personnel Only</span>
            </div>
            <h1 className="font-sans text-2xl font-bold text-white tracking-tight">
              Operator sign-in
            </h1>
            <p className="text-xs text-slate-400">
              Enter operator credentials to access real-time telemetry and safety controls.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                Operator Email
              </label>
              <div className="relative">
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition-all focus:border-amber focus:bg-white/[0.06] focus:ring-2 focus:ring-amber/30 shadow-inner disabled:opacity-60"
                  placeholder="operator@kansanshi.com"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="password"
                  className="block text-xs font-medium uppercase tracking-wider text-slate-400"
                >
                  Access Password
                </label>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition-all focus:border-amber focus:bg-white/[0.06] focus:ring-2 focus:ring-amber/30 shadow-inner disabled:opacity-60"
                  placeholder="••••••••••••"
                />
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-400"
              >
                <Lock size={13} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="relative group mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber to-amber/90 px-4 py-3 text-sm font-semibold text-[#070B12] shadow-lg shadow-amber/20 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
            >
              <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full duration-1000 bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform pointer-events-none motion-reduce:hidden" />
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin text-[#070B12]" />
                  <span>Authenticating…</span>
                </>
              ) : (
                <>
                  <LogIn size={16} className="text-[#070B12]" />
                  <span>Initialize Session</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-8 text-center">
            <span className="text-[11px] text-slate-500 tracking-wide">
              SECURE TLS 1.3 ENCRYPTION • HARDWARE NODE 01
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}