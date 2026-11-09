import { AlertTriangle, Radio, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useHealth } from '../hooks/useHealth'
import { postTrip } from '../lib/api'
import { useStore } from '../store/useStore'
import { AccountMenu } from './AccountMenu'
import { Logo } from './Logo'
import { StatusPill } from './StatusPill'

/** Top bar: brand, live status, PLC link status, account menu, and the
 * Simulate Trip control. */
export function Header() {
  const connected = useStore((s) => s.connected)
  const mqttConnected = useStore((s) => s.mqttConnected)
  const markFiredNow = useStore((s) => s.markFiredNow)
  const { health } = useHealth()

  const [firing, setFiring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorTimer = useRef<number>()

  // PLC LINKED shows only when /health OR the WS status message confirms
  // an actual MQTT connection - never inferred from anything else.
  const plcLinked = Boolean(health?.mqtt) || mqttConnected

  useEffect(() => () => window.clearTimeout(errorTimer.current), [])

  async function handleSimulateTrip() {
    setFiring(true)
    setError(null)
    const result = await postTrip('Dashboard operator test')
    setFiring(false)
    if (result.ok) {
      markFiredNow(result.data.mqtt)
    } else {
      setError(result.error)
      errorTimer.current = window.setTimeout(() => setError(null), 3000)
    }
  }

  return (
    <header className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
      <div className="flex items-center gap-4">
        <Logo />
      </div>

      <div className="flex items-center gap-2.5">
        <StatusPill active={connected} activeLabel="Live" inactiveLabel="Offline" icon={<Radio size={12} />} />
        <StatusPill
          active={plcLinked}
          activeLabel="PLC Linked"
          inactiveLabel="PLC Simulated"
          icon={<Zap size={12} />}
        />

        <div className="relative flex items-center gap-2">
          <button
            onClick={handleSimulateTrip}
            disabled={firing}
            className="flex items-center gap-1.5 rounded-lg bg-amber px-3 py-1.5 text-xs font-semibold text-navy transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <AlertTriangle size={13} />
            {firing ? 'Sending…' : 'Simulate Trip'}
          </button>
          {error && (
            <span className="absolute right-0 top-full mt-1.5 whitespace-nowrap rounded-md border border-rip/40 bg-rip/10 px-2 py-1 text-[11px] text-rip">
              {error}
            </span>
          )}
        </div>

        <AccountMenu />
      </div>
    </header>
  )
}