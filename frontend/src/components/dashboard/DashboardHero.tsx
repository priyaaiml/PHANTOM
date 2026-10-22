import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Crosshair,
  ListChecks,
  Loader2,
  Power,
  Radar,
  ShieldCheck,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { BlackHoleHeroSection } from '../ui/blackhole-hero-section'
import { ParticleWave } from '../ui/particle-wave'
import { useProxyStore } from '../../stores/proxyStore'
import { useScannerStore } from '../../stores/scannerStore'
import { scannerService, type ScanTarget } from '../../services/scannerService'
import { settingsService } from '../../services/settingsService'
import { apiError } from '../../services/api'
import { hostInScope } from '../../utils/scope'
import type { Scan } from '../../types/scanner'

type Mode = 'passive' | 'active'

/** `https://app.example.com:8443/x?y=1` and `app.example.com` both -> `app.example.com`. */
function hostOf(input: string): string {
  const raw = input.trim().toLowerCase()
  if (!raw) return ''
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
  } catch {
    return ''
  }
}

function matchesHost(captured: string, host: string): boolean {
  const h = captured.toLowerCase()
  return h === host || h.startsWith(`${host}:`) || h.endsWith(`.${host}`)
}

/** True while the viewport is narrow — the hole visual needs a wide column. */
function useWide(query = '(min-width: 1100px)') {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const m = window.matchMedia(query)
    const sync = () => setWide(m.matches)
    sync()
    m.addEventListener('change', sync)
    return () => m.removeEventListener('change', sync)
  }, [query])
  return wide
}

/**
 * The dashboard hero. Its job is the engagement brief: say what PHANTOM is for,
 * take the target the operator is authorized to assess, and start the existing
 * scanner over that target's captured traffic. Nothing else here pretends to be
 * a check — every number comes from the API.
 */
export function DashboardHero() {
  const wide = useWide()
  const status = useProxyStore((s) => s.status)
  const scopeRules = useProxyStore((s) => s.scopeRules)
  const startProxy = useProxyStore((s) => s.startProxy)
  const stopProxy = useProxyStore((s) => s.stopProxy)
  const starting = useScannerStore((s) => s.starting)
  const startScan = useScannerStore((s) => s.startScan)

  const [target, setTarget] = useState('')
  const [mode, setMode] = useState<Mode>('passive')
  const [authorized, setAuthorized] = useState(false)
  const [captured, setCaptured] = useState<ScanTarget[]>([])
  const [addingScope, setAddingScope] = useState(false)
  const [scanId, setScanId] = useState<string | null>(null)
  const [finished, setFinished] = useState<Scan | null>(null)
  // Live check counts for the running scan, published over the websocket.
  const progress = useScannerStore((s) => (scanId ? s.progress[scanId] : undefined))

  const running = status?.running ?? false
  const addr = running ? `${status?.host}:${status?.port}` : 'proxy stopped'
  const host = hostOf(target)

  // Captured hosts come from the same endpoint the Scanner uses.
  const loadCaptured = async () => {
    try {
      setCaptured(await scannerService.targets())
    } catch {
      /* transient — the hint just stays empty */
    }
  }

  useEffect(() => {
    void loadCaptured()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => void loadCaptured(), 15000)
    return () => window.clearInterval(timer)
  }, [])

  const hostStats = useMemo(() => {
    if (!host) return { count: 0, lastSeen: null as string | null }
    const rows = captured.filter((t) => matchesHost(t.host, host))
    return {
      count: rows.reduce((a, t) => a + t.count, 0),
      lastSeen: rows.reduce<string | null>((a, t) => (t.last_seen && (!a || t.last_seen > a) ? t.last_seen : a), null),
    }
  }, [captured, host])

  const inScope = host ? hostInScope(scopeRules, host) : false
  const includeRules = scopeRules.filter((r) => r.rule_type === 'include' && (r.is_active === 1 || r.is_active === true))

  // Follow the scan we started until the backend says it is finished.
  useEffect(() => {
    if (!scanId || finished) return
    let alive = true
    const poll = async () => {
      try {
        const scans = await scannerService.scans()
        const row = scans.find((s) => s.id === scanId)
        if (!alive || !row) return
        if (row.status === 'completed' || row.status === 'failed') setFinished(row)
        else if (row.status === 'running' || row.status === 'paused') void loadCaptured()
      } catch {
        /* keep the last known state */
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2500)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [scanId, finished])

  const runAssessment = async () => {
    if (!host || !authorized) return
    setFinished(null)
    // An active scan over a host outside the include rules is refused by the
    // backend (403); offering that here would just be a dead button.
    if (mode === 'active' && !inScope) {
      toast.error(`Active checks need an include scope rule covering ${host}`)
      return
    }
    const id = await startScan(mode === 'active' ? 'active' : 'passive', [], host, false)
    if (id) {
      setScanId(id)
      window.setTimeout(() => void loadCaptured(), 1500)
    }
  }

  const addHostToScope = async () => {
    if (!host) return
    setAddingScope(true)
    try {
      await settingsService.addScope({
        rule_type: 'include',
        host_pattern: host,
        protocol: 'any',
        path_pattern: '.*',
      })
      await useProxyStore.getState().refreshScopeRules()
      toast.success(`${host} added to the active-scan scope`)
    } catch (err) {
      toast.error(apiError(err))
    } finally {
      setAddingScope(false)
    }
  }

  const canAssess = Boolean(host) && authorized && !starting && !(mode === 'active' && !inScope)
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <section className="hero fade-in">
      <div className="hero-wave" aria-hidden="true">
        <ParticleWave density={130} lightColor="#c2603c" background="transparent" maxDpr={1.5} />
      </div>
      <div className="hero-grid-lines" aria-hidden="true" />

      <div className="hero-inner">
        <span className="hero-eyebrow">
          <ShieldCheck size={11} />
          Authorized security assessment
        </span>

        <h1 className="hero-title">
          Discover exposed resources.
          <br />
          Investigate access-control weaknesses.
          <br />
          <span className="hero-title-accent">Turn evidence into actionable security findings.</span>
        </h1>

        <p className="hero-sub">
          Enter a target you are authorized to assess. PHANTOM runs its existing checks over the traffic
          you captured through your local proxy and reports what the evidence actually supports —
          severity, affected endpoint, impact and remediation. Findings are only ever drawn from
          captured responses and in-scope probes.
        </p>

        <div className="hero-assess">
          <Crosshair size={15} className="hero-assess-icon" />
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canAssess) void runAssessment()
            }}
            placeholder="app.example.com — the host you are authorized to assess"
            spellCheck={false}
            aria-label="Assessment target host"
          />
          <div className="hero-mode" role="group" aria-label="Assessment mode">
            <button
              type="button"
              className={mode === 'passive' ? 'on' : ''}
              onClick={() => setMode('passive')}
              title="Reads captured traffic only — sends nothing to the target"
            >
              Passive review
            </button>
            <button
              type="button"
              className={mode === 'active' ? 'on' : ''}
              onClick={() => setMode('active')}
              title="Replays captured requests with variants — requires an include scope rule"
            >
              Active checks
            </button>
          </div>
          <button className="glass-btn primary" disabled={!canAssess} onClick={() => void runAssessment()}>
            {starting ? <Loader2 size={14} className="spin" /> : <Radar size={14} />}
            {starting ? 'Assessing…' : 'Assess Target'}
          </button>
        </div>

        {/* Where the target stands — captured traffic, then scope for active probes. */}
        {!target.trim() && (
          <div className="hero-hint">
            <Crosshair size={12} />
            Type a domain to begin. PHANTOM only ever touches the host you enter here.
          </div>
        )}
        {target.trim() && !host && (
          <div className="hero-hint warn">That does not look like a host — try app.example.com</div>
        )}
        {host && hostStats.count === 0 && (
          <div className="hero-hint warn">
            No captured traffic for <span className="mono">{host}</span> yet — start the proxy, browse the
            target, then assess.
            {!running && (
              <button className="btn sm" onClick={() => void startProxy()}>
                <Power size={11} /> Start proxy
              </button>
            )}
          </div>
        )}
        {host && hostStats.count > 0 && (
          <div className="hero-hint ok">
            <ShieldCheck size={12} />
            {hostStats.count} captured request{hostStats.count === 1 ? '' : 's'} for{' '}
            <span className="mono">{host}</span>
            {hostStats.lastSeen ? ` · last seen ${hostStats.lastSeen.replace('T', ' ').slice(0, 19)}` : ''}
          </div>
        )}
        {host && mode === 'passive' && (
          <div className="hero-hint">
            Passive review reads stored requests and responses only — nothing is sent to the target.
          </div>
        )}
        {host && mode === 'active' && !inScope && (
          <div className="hero-hint warn">
            Active checks need an include scope rule covering <span className="mono">{host}</span>
            {includeRules.length === 0 ? ' (none defined yet)' : ''}.
            <button className="btn sm" disabled={addingScope} onClick={() => void addHostToScope()}>
              {addingScope ? 'Adding…' : `Add ${host} to scope`}
            </button>
          </div>
        )}
        {host && mode === 'active' && inScope && (
          <div className="hero-hint ok">
            <ShieldCheck size={12} />
            <span className="mono">{host}</span> is in scope · probes stay inside your declared scope
          </div>
        )}

        {/* Live state of the assessment we just started. */}
        {scanId && (
          <div className="hero-assessment">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className={`status-dot ${finished ? '' : 'pulse-dot'}`} style={{ background: finished ? 'var(--severity-low)' : 'var(--accent-primary)' }} />
              <span className="mono" style={{ fontSize: 11 }}>{scanId}</span>
              {!finished && (
                <>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {mode === 'active' ? 'active checks' : 'passive review'} running
                    {progress?.total ? ` · ${progress.done}/${progress.total} checks` : ''}
                  </span>
                  {pct > 0 && (
                    <span style={{ flex: 1, minWidth: 60, height: 4, background: 'var(--bg-primary)', borderRadius: 2, overflow: 'hidden' }}>
                      <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: 'var(--accent-primary)', transition: 'width 300ms ease' }} />
                    </span>
                  )}
                </>
              )}
              {finished && (
                <>
                  <span style={{ fontSize: 11.5, fontWeight: 600 }}>
                    {finished.status === 'completed' ? 'Assessment complete' : 'Assessment failed'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {finished.findings_count} finding{finished.findings_count === 1 ? '' : 's'} recorded
                    {finished.findings_count === 0 ? ' — nothing confirmed by the checks that ran' : ''}
                  </span>
                  <Link className="btn sm" to="/scanner">
                    <ListChecks size={11} /> Review findings
                  </Link>
                  <Link className="btn sm" to="/proxy">
                    <ArrowRight size={11} /> Traffic behind them
                  </Link>
                </>
              )}
            </div>
          </div>
        )}

        <div className="hero-actions">
          <Link className="glass-btn" to="/scanner">
            <ListChecks size={14} />
            View Findings
          </Link>
          <Link className="glass-btn" to="/proxy">
            <ArrowRight size={14} />
            Open Traffic History
          </Link>
          <button
            className={`glass-btn light ${running ? 'danger' : ''}`}
            onClick={() => (running ? void stopProxy() : void startProxy())}
            title={running ? 'Stop the local proxy' : 'Start the local proxy on :8080'}
          >
            <Power size={14} />
            {running ? 'Stop proxy' : 'Start proxy'}
          </button>
        </div>

        <label className="hero-consent">
          <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
          <span>
            I confirm I am authorized to assess <span className="mono">{host || 'this target'}</span>. PHANTOM
            sends nothing outside the scope rules above and runs no exploitation, credential attacks, or
            destructive tests.
          </span>
        </label>

        <div className="hero-meta">
          <span
            className={running ? 'status-dot pulse-dot' : 'status-dot'}
            style={{ background: running ? 'var(--severity-low)' : 'var(--text-muted)' }}
          />
          <span>{addr}</span>
          <span>·</span>
          <span>{status?.requests_captured ?? 0} requests captured</span>
          <span>·</span>
          <span>
            {includeRules.length} include rule{includeRules.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {wide && (
        <div className="hero-visual" aria-hidden="true">
          <BlackHoleHeroSection
            style={{ position: 'absolute', inset: 0, height: '100%', width: '100%' }}
            focus={[0.52, 0.5]}
            scrim="none"
            distance={22}
            elevation={-6}
            fov={46}
            steps={180}
            resolution={0.6}
            glow={0.9}
          />
        </div>
      )}
    </section>
  )
}
