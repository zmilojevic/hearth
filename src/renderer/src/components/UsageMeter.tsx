import { useEffect, useRef, useState } from 'react'
import type { PlanUsage, UsagePace, UsageRow } from '../../../shared/types'
import { useStore } from '../store'
import { paceBudget, paceText, relativeTime } from '../util'

function until(iso: string | null, now: number): string {
  if (!iso) return ''
  const m = Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 60000))
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

function localStamp(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const wd = d.toLocaleDateString(undefined, { weekday: 'short' })
  const t = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${wd} ${t}`
}

const GROUPS: Record<string, string> = { session: 'Session (5 h)', weekly: 'Weekly' }
const groupTitle = (g: string): string => GROUPS[g] ?? g.charAt(0).toUpperCase() + g.slice(1)
const sevClass = (s: string): string => (s === 'critical' ? 'crit' : s === 'warning' ? 'warn' : '')

function money(minor: number | null, cur: string | null): string {
  if (minor == null) return '—'
  const v = minor / 100
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur ?? 'USD' }).format(v)
  } catch {
    return `${v.toFixed(2)} ${cur ?? ''}`.trim()
  }
}

function Bar({ row, big }: { row: UsageRow; big?: boolean }) {
  return (
    <span className={`usage-bar ${big ? 'big' : ''}`}>
      <span className={`usage-fill ${sevClass(row.severity)}`} style={{ width: `${Math.min(100, Math.max(row.percent, row.percent > 0 ? 1 : 0))}%` }} />
    </span>
  )
}

function PaceBar({ ratio, used, big }: { ratio: number; used: number; big?: boolean }) {
  return (
    <span className={`usage-bar ${big ? 'big' : ''}`}>
      <span className={`usage-fill ${ratio > 1.5 ? 'crit' : ratio > 1 ? 'warn' : ''}`} style={{ width: `${Math.min(100, Math.max(used > 0 ? 1 : 0, ratio * 100))}%` }} />
    </span>
  )
}

/** Claude plan usage (5 h session) in the top bar; hover lists every limit. */
export default function UsageMeter({ codex = false, label = false }: { codex?: boolean; label?: boolean }) {
  const [claudeUsage, setUsage] = useState<PlanUsage | null>(null)
  const codexUsage = useStore((s) => s.codexUsage)
  const usage = codex ? codexUsage : claudeUsage
  const [now, setNow] = useState(Date.now())
  const [open, setOpen] = useState(false)
  const activeAccount = useStore((s) => s.accounts.active)
  const accountUsage = useStore((s) => s.accountUsage)
  const [paceMap, setPaceMap] = useState<Record<string, UsagePace>>({})
  const openHistory = useStore((s) => s.openUsageHistory)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadPace = (): void => {
    if (codex) return
    void window.desktop.usagePace().then(setPaceMap).catch(() => {})
  }
  const loadPaceRef = useRef(loadPace)
  loadPaceRef.current = loadPace

  useEffect(() => {
    void window.desktop.getUsage().then((u) => u && setUsage(u))
    loadPaceRef.current()
    const off = window.desktop.onUsage((u) => {
      setUsage(u)
      loadPaceRef.current()
    })
    const t = setInterval(() => {
      setNow(Date.now())
      loadPaceRef.current()
    }, 30_000)
    return () => {
      off()
      clearInterval(t)
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

  useEffect(() => {
    loadPaceRef.current()
  }, [accountUsage, activeAccount])

  const show = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    if (!open) {
      setNow(Date.now())
      if (codex) void window.desktop.codexUsage().then((u) => u && useStore.setState({ codexUsage: u }))
      else if (!usage || Date.now() - usage.fetchedAt > 10 * 60_000) void window.desktop.getUsage(true).then((u) => u && setUsage(u))
    }
    setOpen(true)
  }
  const hide = (): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 180)
  }

  if (!usage || !usage.available || usage.rows.length === 0) return null
  const main = usage.rows.find((r) => r.group === 'session' || r.kind === 'session') ?? usage.rows.find((r) => r.active)
  if (!main) return null

  const groups: { group: string; rows: UsageRow[] }[] = []
  for (const r of usage.rows) {
    const g = groups.find((x) => x.group === r.group)
    if (g) g.rows.push(r)
    else groups.push({ group: r.group, rows: [r] })
  }
  const sub = usage.subscription ? usage.subscription.charAt(0).toUpperCase() + usage.subscription.slice(1) : ''
  const reset = until(main.resetsAt, now)
  const pace = codex ? undefined : paceMap[activeAccount]
  const pb = pace ? paceBudget(pace, now) : null

  return (
    <div className="ctx-meter-wrap" onMouseEnter={show} onMouseLeave={hide}>
      <div className="ctx-meter usage-meter-click" onClick={() => { setOpen(false); openHistory() }}>
        {label && <span className="usage-engine">{codex ? 'Codex' : 'Claude'}</span>}
        {pace && pb ? (
          <>
            <span className="ctx-meter-text">
              Today {paceText(pace, pb)}
            </span>
            <PaceBar ratio={pb.ratio} used={pace.usedToday} />
          </>
        ) : (
          <>
            <span className="ctx-meter-text">{Math.round(main.percent)}%</span>
            <Bar row={main} />
            {reset && <span className="ctx-meter-text">{reset}</span>}
          </>
        )}
      </div>
      {open && (
        <div className="ctx-pop usage-pop" onMouseEnter={show} onMouseLeave={hide}>
          <div className="ctx-pop-head">
            <span>{codex ? 'Codex usage' : 'Plan usage'}</span>
            <span className="muted">{sub}</span>
          </div>
          {pace && pb && (
            <div className="usage-group">
              <div className="usage-group-title">Today</div>
              <div className="usage-row">
                <div className="usage-row-head">
                  <span>Daily budget</span>
                  <span className="usage-pct">
                    {paceText(pace, pb)}
                  </span>
                </div>
                <PaceBar ratio={pb.ratio} used={pace.usedToday} big />
              </div>
            </div>
          )}
          {groups.map((g) => (
            <div key={g.group} className="usage-group">
              <div className="usage-group-title">{groupTitle(g.group)}</div>
              {g.rows.map((r, i) => (
                <div key={`${r.kind}-${i}`} className="usage-row">
                  <div className="usage-row-head">
                    <span>{r.label}</span>
                    <span className="usage-pct">{Math.round(r.percent)}%</span>
                  </div>
                  <Bar row={r} big />
                  {r.resetsAt && (
                    <div className="usage-reset muted">
                      Resets in {until(r.resetsAt, now)} · {localStamp(r.resetsAt)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
          {usage.extra?.enabled && (
            <div className="usage-row-head">
              <span>Extra usage</span>
              <span className="muted">
                {money(usage.extra.usedCredits, usage.extra.currency)}
                {usage.extra.monthlyLimit != null && ` / ${money(usage.extra.monthlyLimit, usage.extra.currency)}`}
              </span>
            </div>
          )}
          {usage.error && <div className="muted small">Couldn't refresh: {usage.error}</div>}
          <div className="muted small">Updated {relativeTime(usage.fetchedAt) === 'now' ? 'just now' : `${relativeTime(usage.fetchedAt)} ago`}</div>
        </div>
      )}
    </div>
  )
}
