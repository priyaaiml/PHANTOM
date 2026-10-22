import { NavLink } from 'react-router-dom'
import {
  Activity,
  Blocks,
  Crosshair,
  ListTree,
  Lock,
  MessagesSquare,
  Radar,
  Repeat2,
  Search,
  Settings,
  Shield,
} from 'lucide-react'
import { useProxyStore } from '../../stores/proxyStore'

const ITEMS = [
  { to: '/', label: 'Dashboard', icon: Activity },
  { to: '/proxy', label: 'Proxy', icon: Shield },
  { to: '/target', label: 'Target', icon: ListTree },
  { to: '/repeater', label: 'Repeater', icon: Repeat2 },
  { to: '/intruder', label: 'Intruder', icon: Crosshair },
  { to: '/scanner', label: 'Scanner', icon: Radar },
  { to: '/plugins', label: 'Plugins', icon: Blocks },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/decoder', label: 'Decoder', icon: Lock },
  { to: '/copilot', label: 'Assistant', icon: MessagesSquare },
]

const navClass = ({ isActive }: { isActive: boolean }) => `nav-item${isActive ? ' active' : ''}`

export function Sidebar() {
  const wsConnected = useProxyStore((s) => s.wsConnected)
  const proxyRunning = useProxyStore((s) => s.status?.running ?? false)

  const liveLabel = wsConnected ? (proxyRunning ? 'Live · capturing' : 'Live · idle') : 'Reconnecting…'
  const liveColor = wsConnected
    ? proxyRunning
      ? 'var(--severity-low)'
      : 'var(--text-muted)'
    : 'var(--severity-medium)'

  return (
    <nav className="sidebar">
      {ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} title={label} className={navClass}>
          <Icon size={17} />
          <span className="nav-label">{label}</span>
        </NavLink>
      ))}

      <div style={{ flex: 1 }} />

      <NavLink to="/settings" title="Settings" className={navClass}>
        <Settings size={17} />
        <span className="nav-label">Settings</span>
      </NavLink>

      <div className="sidebar-foot" title={liveLabel}>
        <span
          className={`status-dot${wsConnected && proxyRunning ? ' pulse-dot' : ''}`}
          style={{ background: liveColor }}
        />
        <span className="sidebar-foot-label nav-label">{liveLabel}</span>
      </div>
    </nav>
  )
}
