import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { QrCode, X } from 'lucide-react'
import { renderSVG } from 'uqr'
import { useStore } from '../store'
import { copyText } from '../util'
import { extractLoginUrl } from '../loginUrl'
import { ensureTerminal, mountTerminal, fitTerminal, focusTerminal, disposeTerminal } from '../terminals'

type Phase = 'starting' | 'running' | 'failed' | 'done'

/** Runs `claude auth login` / `codex login` in a pty and shows it in an xterm (the CLI opens the browser and may ask for a pasted code). */
export default function LoginDialog({ provider = 'claude', account }: { provider?: 'claude' | 'codex'; account?: string }) {
  const closeLogin = useStore((s) => s.closeLogin)
  // Extra accounts are named in the title; the default (or only) account keeps the plain wording.
  const accountId = useStore((s) => account ?? s.accounts.active)
  const extra = provider === 'claude' && accountId !== 'default'
  const accountName = useStore((s) => {
    const a = s.accounts.accounts.find((x) => x.id === accountId)
    return a?.label || a?.email?.split('@')[0] || ''
  })
  const [phase, setPhase] = useState<Phase>('starting')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [ptyId, setPtyId] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [qr, setQr] = useState(false)
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const current = useRef<string | null>(null)

  const close = (): void => {
    if (current.current) void window.desktop.ptyKill(current.current)
    closeLogin()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation() // also keeps xterm's Esc handler (close the terminal panel) from seeing it
        closeLogin()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [closeLogin])

  // Kill the login process when the dialog goes away, whichever way.
  useEffect(
    () => () => {
      if (current.current) {
        void window.desktop.ptyKill(current.current)
        disposeTerminal(current.current)
      }
    },
    [],
  )

  useEffect(() => {
    let alive = true
    let id: string | null = null
    const early: string[] = []
    const earlyData: { id: string; data: string }[] = []
    let acc = ''
    let found = false
    const feed = (data: string): void => {
      if (provider !== 'claude' || found) return
      acc = (acc + data).slice(-65536)
      const u = extractLoginUrl(acc)
      if (u) {
        found = true
        setUrl(u)
      }
    }
    const onExit = (): void => {
      setPhase('running')
      const recheck =
        provider === 'codex'
          ? useStore.getState().checkCodex().then(() => !!useStore.getState().codexStatus?.loggedIn)
          : useStore.getState().checkAuth(account).then((s) => s === 'in')
      void recheck.then((loggedIn) => {
        if (!alive) return
        if (loggedIn) {
          setPhase('done')
          if (provider === 'claude') void window.desktop.getUsage(true).catch(() => null)
          closeLogin(true)
        } else setPhase('failed')
      })
    }
    // Subscribed before the pty exists, so an immediate exit is not missed.
    const off = window.desktop.onPtyExit((e) => {
      if (id === null) early.push(e.id)
      else if (e.id === id) onExit()
    })
    const offData = window.desktop.onPtyData((e) => {
      if (id === null) earlyData.push({ id: e.id, data: e.data })
      else if (e.id === id) feed(e.data)
    })
    setPhase('starting')
    setError('')
    setUrl(null)
    setCopied(false)
    setQr(false)
    setCode('')
    setSent(false)
    void (provider === 'codex' ? window.desktop.codexLogin() : window.desktop.authLogin(account)).then((r) => {
      if (!alive) {
        if (r.id) void window.desktop.ptyKill(r.id)
        return
      }
      if (!r.id) {
        setError(r.error ?? 'Could not start the login')
        setPhase('failed')
        return
      }
      id = r.id
      current.current = r.id
      ensureTerminal(r.id)
      setPtyId(r.id)
      setPhase('running')
      for (const d of earlyData) if (d.id === r.id) feed(d.data)
      earlyData.length = 0
      if (early.includes(r.id)) onExit()
    })
    return () => {
      alive = false
      off()
      offData()
      if (id) {
        void window.desktop.ptyKill(id)
        disposeTerminal(id)
        if (current.current === id) current.current = null
      }
    }
  }, [attempt, closeLogin, provider, account])

  useEffect(() => {
    const el = host.current
    if (!ptyId || !el) return
    mountTerminal(ptyId, el)
    let n = 0
    const focus = (): void => {
      if (!focusTerminal(ptyId) && n++ < 20) requestAnimationFrame(focus)
    }
    focus()
    const ro = new ResizeObserver(() => fitTerminal(ptyId))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ptyId])

  const submit = (): void => {
    if (!ptyId || !code.trim() || sent) return
    window.desktop.ptyWrite(ptyId, code.trim() + '\r')
    setCode('')
    setSent(true)
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal login-modal">
        <div className="modal-head">
          <h3>{provider === 'codex' ? 'Log in to Codex' : extra ? `Log in – ${accountName || 'new account'}` : 'Log in to Claude'}</h3>
          <button className="icon-btn" onClick={close} title="Close">
            <X size={16} />
          </button>
        </div>
        <p className="modal-text">
          {provider === 'codex'
            ? 'Hearth uses your Codex (ChatGPT) login. A browser window opens; if it doesn\'t, open the link below and paste the code you get back here.'
            : 'Hearth uses your Claude Code login. A browser window opens on this computer. To sign in somewhere else, open the link below there and paste the code you get back.'}
        </p>
        {error && <p className="modal-text login-err">{error}</p>}
        {provider === 'claude' && url && (
          <div className="login-remote">
            <div className="login-remote-title">Signing in on another computer?</div>
            <div className="login-url-row">
              <span className="login-url mono" title={url}>
                {url}
              </span>
              <button
                className="btn"
                onClick={() => {
                  void copyText(url).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  })
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button className={'icon-btn' + (qr ? ' active' : '')} onClick={() => setQr((v) => !v)} title="Show QR code">
                <QrCode size={16} />
              </button>
            </div>
            {qr && <div className="login-qr" dangerouslySetInnerHTML={{ __html: renderSVG(url) }} />}
            <div className="login-code-row">
              <input
                className="login-code"
                value={code}
                placeholder="Paste the code from the browser"
                spellCheck={false}
                disabled={sent && phase !== 'failed'}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submit()
                  }
                }}
              />
              <button className="btn" disabled={!code.trim() || !ptyId || sent} onClick={submit}>
                Sign in
              </button>
            </div>
            {sent && <div className="muted small">Checking…</div>}
          </div>
        )}
        <div className={'login-term' + (provider === 'claude' && url ? ' small' : '')} ref={host} />
        <div className="modal-actions">
          {phase === 'failed' && (
            <button
              className="btn"
              onClick={() => {
                if (current.current) {
                  void window.desktop.ptyKill(current.current)
                  disposeTerminal(current.current)
                  current.current = null
                }
                setPtyId(null)
                setAttempt((n) => n + 1)
              }}
            >
              Try again
            </button>
          )}
          <button className="btn" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
