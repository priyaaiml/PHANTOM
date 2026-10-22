interface BadgeProps {
  color?: string
  bg?: string
  children: React.ReactNode
}

export function Badge({ color, bg, children }: BadgeProps) {
  return (
    <span
      className="badge"
      style={{
        color: color ?? 'var(--text-secondary)',
        background: bg ?? 'var(--bg-primary)',
      }}
    >
      {children}
    </span>
  )
}

const SEVERITY_TONES: Record<string, { color: string; bg: string }> = {
  critical: { color: 'var(--severity-critical)', bg: '#fdf0f0' },
  high: { color: 'var(--severity-high)', bg: '#fdf3ec' },
  medium: { color: 'var(--severity-medium)', bg: '#fdf7e9' },
  low: { color: 'var(--severity-low)', bg: '#eef8f1' },
  info: { color: 'var(--severity-info)', bg: '#eef3fe' },
}

export function SeverityBadge({ severity }: { severity: string }) {
  const tone = SEVERITY_TONES[severity] ?? { color: 'var(--text-secondary)', bg: 'var(--bg-primary)' }
  return (
    <Badge color={tone.color} bg={tone.bg}>
      {severity}
    </Badge>
  )
}
