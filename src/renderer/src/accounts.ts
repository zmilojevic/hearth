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
