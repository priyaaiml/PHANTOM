import { useProxyStore } from '../../stores/proxyStore'

export function StatusBar() {
  const status = useProxyStore((s) => s.status)
  const total = useProxyStore((s) => s.total)
  const ws = useProxyStore((s) => s.wsConnected)
  const running = status?.running ?? false

  const cell: React.CSSProperties = {
    padding: '0 12px',
    borderRight: '1px solid var(--border-primary)',
    color: 'var(--text-secondary)',
    fontSize: 11,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: '100%',
  }

  return (
    <footer
      style={{
        height: 'var(--statusbar-h)',
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'stretch',
        background: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border-primary)',
      }}
    >
      <div style={cell} title="Local proxy listener address">
        <span
          className={running ? 'status-dot pulse-dot' : 'status-dot'}
          style={{ background: running ? 'var(--severity-low)' : 'var(--text-muted)' }}
        />
        <span className="mono">{running ? `${status?.host}:${status?.port}` : 'proxy stopped'}</span>
      </div>
      <div style={cell} title="Requests captured in this session">
        Requests <span className="mono">{status?.requests_captured ?? 0}</span>
      </div>
      <div style={cell} title="Requests stored in history">
        History <span className="mono">{total.toLocaleString()}</span>
      </div>
      <div style={cell} title="Request interception">
        Intercept <span className="mono">{status?.intercept_enabled ? 'on' : 'off'}</span>
      </div>
      <div style={{ ...cell, borderRight: 'none', marginLeft: 'auto' }} title="Live event stream">
        <span
          className="status-dot"
          style={{ background: ws ? 'var(--severity-low)' : 'var(--severity-medium)' }}
        />
        {ws ? 'Live' : 'Reconnecting…'}
      </div>
    </footer>
  )
}
