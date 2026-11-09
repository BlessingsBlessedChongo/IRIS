import { Radar } from 'lucide-react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { colors } from '../brand/tokens'
import { useStore } from '../store/useStore'

const SERIES: { key: 'rip' | 'foreign_object' | 'edge_damage'; label: string; color: string }[] = [
  { key: 'rip', label: 'Rip', color: colors.rip },
  { key: 'foreign_object', label: 'Object', color: colors.object },
  { key: 'edge_damage', label: 'Edge', color: colors.edge },
]

/** Rolling confidence-over-time chart: three series, fixed 0..1 y range,
 * x = seconds since session start. Legend is hand-built (colored dots)
 * rather than recharts' default, per spec. */
export function ConfidenceTimeline() {
  const timeline = useStore((s) => s.timeline)

  return (
    <section className="glass flex h-full min-h-0 flex-col rounded-2xl p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radar size={15} className="text-ink-muted" />
          <h2 className="font-sans text-sm font-semibold uppercase tracking-wide text-ink">
            Confidence timeline
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {timeline.length < 2 ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-muted">
            Waiting for detection data…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={timeline} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <XAxis
                dataKey="t"
                type="number"
                domain={['dataMin', 'dataMax']}
                tick={{ fill: '#4C6E8C', fontSize: 10 }}
                tickFormatter={(v: number) => `${v.toFixed(0)}s`}
                stroke="#1B3A5C"
              />
              <YAxis
                domain={[0, 1]}
                ticks={[0, 0.5, 1]}
                tick={{ fill: '#4C6E8C', fontSize: 10 }}
                stroke="#1B3A5C"
              />
              <Tooltip
                contentStyle={{
                  background: '#10283f',
                  border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 8,
                  color: '#F4F7FA',
                  fontSize: 11,
                }}
                labelFormatter={(v: number) => `t = ${v.toFixed(1)}s`}
                formatter={(value: number) => value.toFixed(2)}
              />
              {SERIES.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}
