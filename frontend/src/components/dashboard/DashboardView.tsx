import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Clock,
  Globe,
  Info,
  Layers,
  ShieldCheck,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { dashboardService, type DashboardStats } from '../../services/dashboardService'
import { scannerService } from '../../services/scannerService'
import { formatMs } from '../../utils/formatters'
import { isLocalRuntime } from '../../utils/runtime'
import { SeverityBadge } from '../shared/Badge'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { DashboardHero } from './DashboardHero'
import { useScannerStore } from '../../stores/scannerStore'
import type { Finding } from '../../types/scanner'

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#b3261e',
  high: '#c2571c',
  medium: '#a97a06',
  low: '#4f7a21',
  info: '#7a6f63',
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info']
const SEVERITY_RANK: Record<string, number> = Object.fromEntries(SEVERITY_ORDER.map((s, i) => [s, i]))

const ACCENT = '#c2603c'
const AXIS_TICK = { fill: '#9c9186', fontSize: 9 }
const TOOLTIP_STYLE = {
  background: '#fffdf9',
  border: '1px solid #ece4d8',
  borderRadius: 6,
  fontSize: 11,
  boxShadow: '0 4px 12px rgba(74,55,38,0.10)',
}

/** Checks whose evidence compares two requests (original vs. tampered). */
const ACCESS_CONTROL_TYPES = new Set(['idor', 'cors'])

/** Honest reading of the scanner's confidence field. */
const CONFIDENCE_LABELS: Record<string, string> = {
  certain: 'confirmed',
  firm: 'observed',
  tentative: 'potential',
}

export function DashboardView() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [traffic, setTraffic] = useState<Array<{ bucket: string; count: number }>>([])
  const [tech, setTech] = useState<Array<{ technology: string; hosts: string[] }>>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [interval, setIntervalSel] = useState<'minute' | 'hour' | 'day'>('minute')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const [s, t, tech, f] = await Promise.all([
          dashboardService.stats(),
          dashboardService.traffic('minute'),
          dashboardService.technologies(),
          scannerService.findings(),
        ])
        setStats(s)
        setTraffic(t)
        setTech(tech)
        setFindings(f)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // Findings and their counts are the point of this screen — keep them current
  // while a scan is running elsewhere.
  useEffect(() => {
    const timer = window.setInterval(() => {
      void dashboardService.stats().then(setStats).catch(() => undefined)
      void scannerService.findings().then(setFindings).catch(() => undefined)
    }, 10000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    void dashboardService.traffic(interval).then(setTraffic)
  }, [interval])

  const pieData = stats
    ? Object.entries(stats.findings_by_severity)
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name, value }))
    : []

  const ranked = [...findings].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || b.id - a.id,
  )
  const topFindings = ranked.slice(0, 6)
  const openFindings = findings.filter((f) => (f.status ?? 'open') !== 'false_positive').length

  const openFinding = (f: Finding) => {
    useScannerStore.getState().selectFinding(f)
    navigate('/scanner')
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <DashboardHero />

      {!isLocalRuntime() && <RemoteDataSourceNotice />}

      {/* ---- Findings first ------------------------------------------------- */}
      <div className="panel" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <ShieldCheck size={16} color="var(--accent-primary)" />
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.4 }}>Security findings</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {findings.length === 0
              ? 'nothing recorded yet'
              : `${openFindings} open · ${findings.length} total`}
          </span>
          <div style={{ flex: 1 }} />
          <a className="btn sm" href="#/scanner">
            View Findings <ArrowRight size={11} />
          </a>
        </div>

        {stats && stats.total_findings > 0 && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {SEVERITY_ORDER.map((sev) => (
              <div key={sev} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <SeverityBadge severity={sev} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>{stats.findings_by_severity[sev] ?? 0}</span>
              </div>
            ))}
          </div>
        )}

        {loading && !stats && <LoadingSpinner label="Loading findings…" />}

        {!loading && findings.length === 0 && (
          <div style={{ fontSize: 11.8, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: '56rem' }}>
            No findings have been produced by this backend yet. PHANTOM only reports what its checks can
            evidence from captured traffic: enter an authorized target above and run a review, or browse
            the target through the proxy first so there are requests to analyse. Zero findings means
            nothing was established by the checks that ran — it is not a statement that the target is
            secure.
          </div>
        )}

        {topFindings.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {topFindings.map((f) => (
              <button
                key={f.id}
                onClick={() => openFinding(f)}
                className="finding-row"
                title="Open in Scanner"
              >
                <SeverityBadge severity={f.severity} />
                <span className="finding-title">{f.title}</span>
                <span className="badge" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
                  {CONFIDENCE_LABELS[f.confidence] ?? f.confidence}
                </span>
                {ACCESS_CONTROL_TYPES.has(f.finding_type) && (
                  <span
                    className="badge"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent-hover)' }}
                    title="Evidence compares the original request with a tampered or cross-origin one"
                  >
                    access control
                  </span>
                )}
                <span className="mono finding-url">{f.url}</span>
                {f.evidence && <span className="mono finding-evidence">{f.evidence.split('\n')[0]}</span>}
                {(f.status ?? 'open') !== 'open' && (
                  <span style={{ fontSize: 9.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {(f.status ?? '').replace('_', ' ')}
                  </span>
                )}
              </button>
            ))}
            {ranked.length > topFindings.length && (
              <a
                href="#/scanner"
                style={{ fontSize: 11.5, color: 'var(--accent-primary)', padding: '8px 2px 0', textDecoration: 'none' }}
              >
                {ranked.length - topFindings.length} more finding
                {ranked.length - topFindings.length === 1 ? '' : 's'} in the Scanner →
              </a>
            )}
          </div>
        )}
      </div>

      {/* ---- Session activity ----------------------------------------------- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Activity size={16} color="var(--accent-primary)" />
        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.4 }}>Captured activity</span>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>what the proxy has seen this session</span>
      </div>

      <div className="grid-stats">
        <StatCard icon={<Globe size={15} />} label="Total requests" value={stats?.total_requests ?? 0} to="/proxy" />
        <StatCard
          icon={<AlertTriangle size={15} color="var(--severity-high)" />}
          label="Findings"
          value={stats?.total_findings ?? 0}
          to="/scanner"
        />
        <StatCard
          icon={<Clock size={15} color="var(--accent-secondary)" />}
          label="Avg response"
          value={stats ? formatMs(stats.avg_response_time_ms) : '—'}
          to="/target"
        />
        <StatCard icon={<Layers size={15} color="var(--severity-info)" />} label="Technologies" value={tech.length} to="/target" />
      </div>

      <div className="grid-main">
        {/* traffic chart */}
        <div className="panel" style={{ padding: 12, height: 240 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'var(--text-secondary)' }}>TRAFFIC</span>
            <div style={{ flex: 1 }} />
            {(['minute', 'hour', 'day'] as const).map((i) => (
              <button
                key={i}
                className={`btn sm ghost ${interval === i ? 'primary' : ''}`}
                onClick={() => setIntervalSel(i)}
              >
                {i}
              </button>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={190}>
            <AreaChart data={traffic}>
              <defs>
                <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity={0.24} />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="bucket" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#ece4d8' }} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#262019', fontWeight: 600 }} />
              <Area type="monotone" dataKey="count" stroke={ACCENT} strokeWidth={2} fill="url(#tg)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* severity donut */}
        <div className="panel" style={{ padding: 12, height: 240 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 8 }}>FINDINGS BY SEVERITY</div>
          {pieData.length ? (
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={3} strokeWidth={0}>
                  {pieData.map((d) => (
                    <Cell key={d.name} fill={SEVERITY_COLORS[d.name] ?? '#9c9186'} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
              No findings yet
            </div>
          )}
        </div>
      </div>

      <div className="grid-halves">
        {/* top hosts */}
        <div className="panel" style={{ padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 8 }}>TOP HOSTS</div>
          {(stats?.top_hosts ?? []).map((h) => (
            <div key={h.host} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Globe size={11} color="var(--text-muted)" />
              <span className="mono" style={{ fontSize: 11.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.host}</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{h.count}</span>
            </div>
          ))}
          {!stats?.top_hosts.length && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No traffic yet</div>}
        </div>

        {/* technologies */}
        <div className="panel" style={{ padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 8 }}>DETECTED TECHNOLOGIES</div>
          {tech.map((t) => (
            <div key={t.technology} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Layers size={11} color="var(--severity-info)" />
              <span className="mono" style={{ fontSize: 11.5, flex: 1 }}>{t.technology}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t.hosts.join(', ').slice(0, 40)}</span>
            </div>
          ))}
          {!tech.length && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>None detected yet</div>}
        </div>
      </div>
    </div>
  )
}

/**
 * Says plainly what this page's numbers can and cannot contain. A deployed
 * dashboard reads one backend's database; a proxy started on the operator's own
 * laptop writes to that laptop's database and nothing here will ever show it.
 */
function RemoteDataSourceNotice() {
  return (
    <div
      className="panel"
      style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start', borderColor: 'var(--border-active)' }}
    >
      <Info size={15} color="var(--accent-primary)" style={{ flex: '0 0 auto', marginTop: 2 }} />
      <span style={{ fontSize: 11.8, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: '62rem' }}>
        <strong style={{ color: 'var(--text-primary)' }}>Cloud view.</strong> This page is served from{' '}
        <span className="mono">{location.host}</span> and reads only the backend it is deployed against — the
        totals, findings and response times below are that backend&rsquo;s stored captures. A PHANTOM proxy
        listening on <span className="mono">127.0.0.1:8080</span> on your own machine records into your local
        database and does not feed this deployment. To review your own captured traffic, run PHANTOM locally
        (frontend <span className="mono">:5173</span> · backend <span className="mono">:8899</span> · proxy{' '}
        <span className="mono">:8080</span>).
      </span>
    </div>
  )
}

function StatCard({ icon, label, value, to }: { icon: React.ReactNode; label: string; value: string | number; to?: string }) {
  const inner = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: 11 }}>{icon} {label}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
    </>
  )
  if (to) {
    return (
      <a
        href={`#${to}`}
        className="panel fade-in"
        style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6, textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border-active)')}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-primary)')}
      >
        {inner}
      </a>
    )
  }
  return (
    <div className="panel fade-in" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>{inner}</div>
  )
}
