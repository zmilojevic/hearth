import type { AccountInfo, AccountsState } from '@shared/types'

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
