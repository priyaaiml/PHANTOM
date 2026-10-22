import { Power, Shield } from 'lucide-react'
import { useProxyStore } from '../../stores/proxyStore'
import { isLocalRuntime } from '../../utils/runtime'

export function TopBar() {
  const status = useProxyStore((s) => s.status)
  const startProxy = useProxyStore((s) => s.startProxy)
  const stopProxy = useProxyStore((s) => s.stopProxy)
  const running = status?.running ?? false
  // In a deployed build the proxy the backend reports is not the one this
  // browser can route through, so the pill must not claim it is.
  const local = isLocalRuntime()
  const proxyLabel = !local ? 'remote host' : running ? `Running :${status?.port}` : 'Stopped'
  const proxyTitle = local
    ? `Local proxy ${running ? `running on ${status?.host}:${status?.port}` : 'stopped'}`
    : 'This backend runs its own proxy on its own host; your browser proxy is configured locally'

  return (
    <header
      className="frost"
      style={{
        height: 'var(--topbar-h)',
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 14px',
        borderBottom: '1px solid var(--border-primary)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span
          style={{
            width: 26,
            height: 26,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-active)',
            color: 'var(--accent-primary)',
          }}
        >
          <Shield size={15} />
        </span>
        <span style={{ fontWeight: 600, letterSpacing: 0.6, fontSize: 13.5 }}>PHANTOM</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>v1.0.0</span>
      </div>

      <div style={{ flex: 1 }} />

      <div
        title={proxyTitle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          height: 26,
          padding: '0 10px',
          borderRadius: 999,
          border: '1px solid var(--border-primary)',
          background: 'var(--bg-primary)',
          fontSize: 11.5,
          color: 'var(--text-secondary)',
        }}
      >
        <span className={local && running ? 'status-dot pulse-dot' : 'status-dot'} style={{ background: local && running ? 'var(--severity-low)' : 'var(--text-muted)' }} />
        <span style={{ color: 'var(--text-muted)' }}>Proxy:</span>
        <span className="mono" style={{ color: local && running ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: 500 }}>
          {proxyLabel}
        </span>
      </div>

      {local && (
        <button
          className={`glass-btn light sm ${running ? 'danger' : ''}`}
          onClick={() => (running ? void stopProxy() : void startProxy())}
        >
          <Power size={12} />
          {running ? 'Stop' : 'Start'}
        </button>
      )}
    </header>
  )
}
