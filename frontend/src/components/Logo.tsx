import { brand } from '../brand/tokens'

interface LogoProps {
  /** Compact renders the mark only, no wordmark - for tight header spaces. */
  compact?: boolean
  className?: string
}

export function Logo({ compact = false, className = '' }: LogoProps) {
  if (compact) {
    return (
      <img
        src="/logo.png"
        alt={brand.name}
        className={`h-8 w-8 rounded-md object-cover ${className}`}
      />
    )
  }
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <img src="/logo.png" alt="" aria-hidden className="h-8 w-8 rounded-md object-cover" />
      <div className="leading-tight">
        <div className="font-sans text-base font-extrabold tracking-tight text-ink">{brand.name}</div>
        <div className="font-sans text-[10px] uppercase tracking-[0.14em] text-ink-muted">
          {brand.fullName}
        </div>
      </div>
    </div>
  )
}
