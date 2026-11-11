import type { AccountInfo, AccountsState, PlanUsage } from '@shared/types'

/** Short name of an account: its label, else the email's local part. */
export function accountLabel(a: AccountInfo): string {
  return a.label || a.email?.split('@')[0] || (a.id === 'default' ? 'Default' : 'New account')
}

/** Muted second line: email (when a label hides it), org, plan. */
export function accountDetail(a: AccountInfo): string {
  return [a.label ? a.email : undefined, a.org, a.plan].filter(Boolean).join(' · ')
}

/** Accounts the CLI has reported as logged in (email/org/plan are only stored from a logged-in `auth status`). */
export function loggedInAccounts(s: AccountsState): AccountInfo[] {
  return s.accounts.filter((a) => a.email || a.org || a.plan)
}

export interface LimitPressure {
  percent: number
  window: string
  label: string
  resetsAt: number | null
}

/** Highest plan-limit usage that applies to the chat's account, if it reaches `threshold` percent (0 = off). */
export function limitPressure(
  chat: { rateLimit?: { percent: number; window: string; resetsAt: number | null }; account?: string },
  usage: PlanUsage | null,
  accounts: AccountsState,
  threshold: number,
): LimitPressure | null {
  if (threshold <= 0) return null
  const now = Date.now()
  const label = (w: string): string => (w === 'five_hour' ? '5-hour' : w === 'seven_day' ? 'weekly' : w.startsWith('scoped:') ? `${w.slice(7)} weekly` : w.replace(/_/g, ' '))
  const cands: LimitPressure[] = []
  const rl = chat.rateLimit
  if (rl && (rl.resetsAt === null || rl.resetsAt > now)) cands.push({ percent: rl.percent, window: rl.window, label: label(rl.window), resetsAt: rl.resetsAt })
  if (usage && (chat.account ?? accounts.active) === accounts.active) {
    for (const r of usage.rows) {
      const t = r.resetsAt ? Date.parse(r.resetsAt) : null
      if (t !== null && !(t > now)) continue
      const w = r.kind === 'session' ? 'five_hour' : r.kind === 'weekly_all' ? 'seven_day' : r.kind === 'weekly_scoped' ? `scoped:${r.label}` : null
      if (w) cands.push({ percent: r.percent, window: w, label: label(w), resetsAt: t })
    }
  }
  let best: LimitPressure | null = null
  for (const c of cands) if (!best || c.percent > best.percent) best = c
  return best && best.percent >= threshold ? best : null
}

/** A plan/usage limit hit (assistant `error` field or a result error text). */
export const RATE_LIMIT = /hit your (usage )?limit|usage limit|rate.?limit/i

/** Cached usage older than this is shown dimmed. */
export const USAGE_STALE_MS = 2 * 60 * 60_000

/** "5h 12% · 7d 40%" from the session / weekly_all rows (missing ones omitted); empty string when nothing is known. */
export function usageSummary(u: PlanUsage | null | undefined): string {
  if (!u) return ''
  const pct = (kind: string): number | undefined => u.rows.find((r) => r.kind === kind)?.percent
  const s = pct('session')
  const w = pct('weekly_all')
  return [s !== undefined ? `5h ${Math.round(s)}%` : '', w !== undefined ? `7d ${Math.round(w)}%` : ''].filter(Boolean).join(' · ')
}

/** Highest session/weekly percent of an account's usage whose window has not reset yet (null = unknown). */
export function usageHeadroomLoad(u: PlanUsage | null | undefined, now = Date.now()): { load: number; blocked: boolean } | null {
  if (!u) return null
  let load = -1
  let blocked = false
  for (const r of u.rows) {
    if (r.kind !== 'session' && r.kind !== 'weekly_all') continue
    const t = r.resetsAt ? Date.parse(r.resetsAt) : null
    if (t !== null && !(t > now)) continue // window already reset
    load = Math.max(load, r.percent)
    if (r.percent >= 100 && t !== null) blocked = true
  }
  return load < 0 ? null : { load, blocked }
}

/** Other logged-in account with the most headroom (unknown usage ranks after known; exhausted ones are skipped). */
export function pickAutoSwitchAccount(accounts: AccountsState, current: string, usage: Record<string, PlanUsage | null>): AccountInfo | null {
  let best: { a: AccountInfo; load: number } | null = null
  for (const a of loggedInAccounts(accounts)) {
    if (a.id === current) continue
    const h = usageHeadroomLoad(usage[a.id])
    if (h?.blocked) continue
    const load = h ? h.load : 1000
    if (!best || load < best.load) best = { a, load }
  }
  return best?.a ?? null
}

/** "~120k tokens" style count for the switch-cost hint. */
export function tokensText(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}
