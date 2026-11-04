import { execFile } from 'node:child_process'
import { claudeBinary } from './claudeBin'
import { accountEnv, ensureAccountDir, listAccounts, resolveAccount, updateAccountInfo } from './accounts'
import type { AuthStatus } from '../shared/types'

/** `claude auth status --json` for an account (default: the active one); `out` only when the CLI clearly says logged out, anything else odd is `unknown`. Refreshes the stored email/org/plan of a logged-in account. */
export function authStatus(account?: string): Promise<AuthStatus> {
  const bin = claudeBinary()
  if (!bin) return Promise.resolve({ state: 'unknown' })
  const id = resolveAccount(account)
  ensureAccountDir(id)
  return new Promise((resolve) => {
    // The CLI exits 1 when logged out but still prints the JSON, so read stdout whatever the exit code.
    execFile(bin, ['auth', 'status', '--json'], { timeout: 15_000, env: accountEnv(id) ?? process.env, windowsHide: true }, (_err, stdout) => {
      try {
        const j = JSON.parse(String(stdout)) as { loggedIn?: boolean; authMethod?: string; apiProvider?: string; email?: string; orgName?: string; subscriptionType?: string }
        const provider = j.apiProvider
        if (j.loggedIn === true) {
          const info = { email: str(j.email), org: str(j.orgName), plan: str(j.subscriptionType) }
          updateAccountInfo(id, info)
          return resolve({ state: 'in', method: j.authMethod, provider, email: info.email, orgName: info.org, subscriptionType: info.plan })
        }
        if (j.loggedIn === false && (!provider || provider === 'firstParty')) return resolve({ state: 'out', method: j.authMethod, provider })
      } catch {
        /* fall through */
      }
      resolve({ state: 'unknown' })
    })
  })
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/** Fills label data (email/org/plan) of every account; cheap, parallel, never throws. */
export async function refreshAccountInfo(): Promise<void> {
  await Promise.all(listAccounts().accounts.map((a) => authStatus(a.id).catch(() => null)))
}
