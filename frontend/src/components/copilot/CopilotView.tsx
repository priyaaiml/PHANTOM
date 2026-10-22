import { useEffect, useRef, useState } from 'react'
import { Info, MessagesSquare, Send, User, Zap } from 'lucide-react'
import Markdown from 'react-markdown'
import { useCopilotStore } from '../../stores/copilotStore'
import { Badge } from '../shared/Badge'

export function CopilotView() {
  const store = useCopilotStore()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void store.refreshStatus()
    void store.loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [store.messages])

  const submit = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    void store.send(text)
  }

  const available = store.status?.available ?? false
  const hint = store.status?.provider === 'openai'
    ? 'Configure the provider, model, base URL and API key in Settings → AI.'
    : 'Start the local runtime, or switch to a cloud provider in Settings → AI.'

  return (
    <div style={{ height: '100%', display: 'flex' }}>
      {/* chat column */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '9px 14px',
            background: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border-primary)',
          }}
        >
          <MessagesSquare size={15} color="var(--accent-primary)" />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Assistant</span>
          {available ? (
            <Badge color="var(--severity-low)" bg="#eef8f1">
              Online · {store.status?.model}
            </Badge>
          ) : (
            <Badge color="var(--text-secondary)" bg="var(--bg-primary)">
              Offline
            </Badge>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn ghost sm" title="Clear conversation history" onClick={() => void store.clearHistory()}>
            New chat
          </button>
          <span className="mono hide-sm" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{store.status?.base_url}</span>
        </div>

        {!available && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              background: 'var(--bg-primary)',
              borderBottom: '1px solid var(--border-primary)',
              fontSize: 11.5,
              color: 'var(--text-secondary)',
            }}
          >
            <Info size={13} color="var(--text-muted)" style={{ flex: '0 0 auto' }} />
            <span style={{ flex: 1, lineHeight: 1.5 }}>
              {store.status
                ? <>AI runtime unavailable{store.status.detail ? ` — ${store.status.detail}` : ''}. {hint}</>
                : 'Checking AI runtime…'}
            </span>
            <button className="btn sm" onClick={() => void store.refreshStatus()}>Retry</button>
            <a className="btn sm" href="#/settings">Settings</a>
          </div>
        )}

        <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {store.messages.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', marginTop: 48, lineHeight: 1.7 }}>
              <MessagesSquare size={26} style={{ marginBottom: 8, opacity: 0.45 }} />
              <div style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Your AI security assistant.</div>
              <div style={{ fontSize: 11.5 }}>Send a request from Proxy → “AI Analyze”, or ask anything about the traffic you're testing.</div>
            </div>
          )}
          {store.messages.map((m, i) => (
            <MessageBubble key={i} role={m.role} content={m.content} streaming={store.streaming && i === store.messages.length - 1} />
          ))}
        </div>

        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-primary)', background: 'var(--bg-secondary)' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder={available ? 'Ask PHANTOM AI…' : 'Ask PHANTOM AI… (requires an AI runtime)'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            <button className="btn primary" onClick={submit} disabled={store.streaming || !input.trim()}>
              <Send size={13} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {[
              { label: 'Analyze last request', run: () => void store.send('Analyze the most recent captured request in my proxy history for security issues.') },
              { label: 'Write report', run: () => void store.send('Write a brief executive summary of my current findings.') },
            ].map((q) => (
              <button key={q.label} className="btn ghost sm" disabled={store.streaming} onClick={q.run}>
                {q.label}
              </button>
            ))}
            {!store.streaming && store.lastAssistantPayloads().length > 0 && (
              <button
                className="btn sm"
                style={{ borderColor: 'var(--border-active)', color: 'var(--accent-primary)' }}
                title="Load the payloads from the last AI answer into the Intruder (request from context is pre-filled)"
                onClick={() => void store.sendLastToIntruder()}
              >
                <Zap size={11} /> Send {store.lastAssistantPayloads().length} payloads to Intruder
              </button>
            )}
          </div>
        </div>
      </div>

      {/* context column */}
      <div
        className="hide-sm"
        style={{ width: 280, flex: '0 0 auto', borderLeft: '1px solid var(--border-primary)', padding: 14, overflow: 'auto', background: 'var(--bg-secondary)' }}
      >
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 8 }}>CONTEXT</div>
        {store.context.type ? (
          <div className="panel" style={{ padding: 10, fontSize: 11.5, lineHeight: 1.5, boxShadow: 'none' }}>
            <Badge color="var(--accent-primary)" bg="var(--bg-active)">{store.context.type}</Badge>
            <div className="mono" style={{ marginTop: 8, wordBreak: 'break-all' }}>{store.context.label}</div>
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            No context attached. Right-click a proxy request → <b>AI Analyze</b> to attach one.
          </div>
        )}
        <div style={{ marginTop: 22, fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: 'var(--text-muted)' }}>SUGGESTED</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 8 }}>
          {['Test SQL injection', 'Check for brute force', 'Verify rate limiting', 'Test password policy'].map((s) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-secondary)' }}>
              <Zap size={11} color="var(--text-muted)" /> {s}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ role, content, streaming }: { role: string; content: string; streaming: boolean }) {
  const isUser = role === 'user'
  return (
    <div className="fade-in" style={{ display: 'flex', gap: 10, alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
      {!isUser && <MessagesSquare size={15} color="var(--accent-primary)" style={{ marginTop: 3, flexShrink: 0 }} />}
      <div
        style={{
          padding: '9px 12px',
          background: isUser ? 'var(--bg-active)' : 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
          fontSize: 12.5,
          lineHeight: 1.65,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          borderRadius: isUser ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
        }}
      >
        {isUser ? content : <Markdown components={{ p: 'span' }}>{content || (streaming ? '▍' : '')}</Markdown>}
      </div>
      {isUser && <User size={15} color="var(--text-muted)" style={{ marginTop: 3, flexShrink: 0 }} />}
    </div>
  )
}
