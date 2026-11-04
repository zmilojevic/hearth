import { query } from '@anthropic-ai/claude-agent-sdk'
import { homedir } from 'node:os'
import { claudeExecutable } from './claudeBin'
import type { PlanUsage, UsageRow } from '../shared/types'
import type { RunnerRegistry } from './agent'
import { accountEnv, activeAccount, ensureAccountDir } from './accounts'

type Json = Record<string, any>

function severityOf(p: number): string {
  return p >= 90 ? 'critical' : p >= 75 ? 'warning' : 'normal'
}

/** Turns the SDK usage response into the renderer's PlanUsage. */
export function normalizeUsage(res: unknown, now = Date.now()): PlanUsage {
  const r = (res ?? {}) as Json
  const rl: Json = r.rate_limits ?? {}
  const rows: UsageRow[] = []
  if (Array.isArray(rl.limits)) {
    for (const l of rl.limits as Json[]) {
      if (!l || typeof l.percent !== 'number') continue
      const kind = String(l.kind ?? '')
      const label =
        kind === 'session'
          ? 'Current session'
          : kind === 'weekly_all'
            ? 'All models'
            : kind === 'weekly_scoped'
              ? (l.scope?.model?.display_name ?? l.scope?.surface?.display_name ?? 'Scoped')
              : kind.replace(/_/g, ' ')
      rows.push({
        kind,
        group: String(l.group ?? 'other'),
        label,
        percent: l.percent,
        resetsAt: l.resets_at ?? null,
        severity: l.severity ?? severityOf(l.percent),
        active: !!l.is_active,
      })
    }
  } else {
    const add = (kind: string, group: string, label: string, e: Json | null | undefined): void => {
      if (!e || typeof e.utilization !== 'number') return
      rows.push({ kind, group, label, percent: e.utilization, resetsAt: e.resets_at ?? null, severity: severityOf(e.utilization), active: false })
    }
    add('session', 'session', 'Current session', rl.five_hour)
    add('weekly_all', 'weekly', 'All models', rl.seven_day)
    add('weekly_scoped', 'weekly', 'Opus', rl.seven_day_opus)
    add('weekly_scoped', 'weekly', 'Sonnet', rl.seven_day_sonnet)
    for (const m of (rl.model_scoped ?? []) as Json[]) add('weekly_scoped', 'weekly', m?.display_name ?? 'Scoped', m)
  }
  const x: Json | null = rl.extra_usage ?? null
  return {
    available: r.rate_limits_available !== false && rows.length > 0,
    subscription: r.subscription_type ?? null,
    rows,
    extra: x
      ? { enabled: !!x.is_enabled, usedCredits: x.used_credits ?? null, monthlyLimit: x.monthly_limit ?? null, currency: x.currency ?? null }
      : undefined,
    fetchedAt: now,
  }
}

/** Never fetch more often than this (also the forced-refresh threshold). */
const MIN_INTERVAL_MS = 10 * 60_000
/** Refetch at least this often even without transcript activity. */
const IDLE_INTERVAL_MS = 60 * 60_000
const BACKOFF_MAX_MS = 60 * 60_000

interface AccountUsage {
  last: PlanUsage | null
  inflight: Promise<PlanUsage | null> | null
  failures: number
  nextAllowedAt: number
}

/** Plan usage per account; every throttling rule applies per account and only the ACTIVE account is ever fetched. */
export class UsageService {
  private accounts = new Map<string, AccountUsage>()
  private lastActivityAt = 0

  constructor(
    private runners: RunnerRegistry,
    private log: (s: string) => void,
    private push: (u: PlanUsage | null) => void,
  ) {}

  private slot(account: string): AccountUsage {
    let s = this.accounts.get(account)
    if (!s) {
      s = { last: null, inflight: null, failures: 0, nextAllowedAt: 0 }
      this.accounts.set(account, s)
    }
    return s
  }

  start(): void {
    void this.refresh(activeAccount())
    setInterval(() => this.tick(), 60_000).unref?.()
  }

  /** Records that transcripts changed (a session did something); cheap, never fetches. */
  noteActivity(): void {
    this.lastActivityAt = Date.now()
  }

  /** The active account changed: show its cached value (or nothing) at once and refresh when its own rules allow. */
  activeChanged(): void {
    const account = activeAccount()
    this.push(this.slot(account).last)
    this.tick()
  }

  private tick(): void {
    const account = activeAccount()
    const s = this.slot(account)
    const now = Date.now()
    if (now < s.nextAllowedAt) return
    const last = s.last
    if (!last) {
      void this.refresh(account)
      return
    }
    const age = now - last.fetchedAt
    const hasRows = last.rows.length > 0
    if ((hasRows && this.lastActivityAt > last.fetchedAt && age >= MIN_INTERVAL_MS) || age >= IDLE_INTERVAL_MS || (!hasRows && !!last.error)) void this.refresh(account)
  }

  /** Cached value of the active account; fetches only when nothing is cached (outside backoff), or when forced, >= MIN_INTERVAL_MS old and outside backoff. */
  get(force: boolean): Promise<PlanUsage | null> {
    const account = activeAccount()
    const s = this.slot(account)
    const now = Date.now()
    const ok = now >= s.nextAllowedAt
    if (ok && (!s.last || (force && now - s.last.fetchedAt >= MIN_INTERVAL_MS))) return this.refresh(account)
    return Promise.resolve(s.last)
  }

  /** Pushes only while the account is still the active one (a switch during a fetch just fills the cache). */
  private emit(account: string, u: PlanUsage): void {
    if (activeAccount() === account) this.push(u)
  }

  private refresh(account: string): Promise<PlanUsage | null> {
    const s = this.slot(account)
    if (s.inflight) return s.inflight
    const p = this.fetchOnce(account)
      .then((u) => {
        if (!u.available && u.rows.length === 0 && (s.last?.rows.length ?? 0) > 0) throw new Error('Usage response had no limits')
        s.failures = 0
        s.nextAllowedAt = 0
        s.last = u
        this.emit(account, u)
        return u
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e)
        s.failures++
        const wait = Math.min(MIN_INTERVAL_MS * 2 ** (s.failures - 1), BACKOFF_MAX_MS)
        s.nextAllowedAt = Date.now() + wait
        this.log(`usage: ${msg}; next try in ${Math.round(wait / 60_000)} min`)
        s.last = { available: false, subscription: null, rows: [], ...s.last, fetchedAt: s.last?.fetchedAt ?? Date.now(), error: msg }
        this.emit(account, s.last)
        return s.last
      })
      .finally(() => {
        s.inflight = null
      })
    s.inflight = p
    return p
  }

  private async fetchOnce(account: string): Promise<PlanUsage> {
    const work = (async () => {
      try {
        const viaRunner = this.runners.any(account)?.usage()
        if (viaRunner) return await viaRunner
      } catch {
        /* fall back to a temporary query */
      }
      return this.viaTemporaryQuery(account)
    })()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error('Timed out fetching usage')), 20_000)
    })
    try {
      return normalizeUsage(await Promise.race([work, timeout]))
    } finally {
      clearTimeout(timer)
    }
  }

  private async viaTemporaryQuery(account: string): Promise<unknown> {
    const log = this.log
    let release!: () => void
    const gate = new Promise<void>((res) => (release = res))
    async function* idle(): AsyncGenerator<never> {
      await gate
    }
    const exe = claudeExecutable()
    const env = accountEnv(account)
    if (env) ensureAccountDir(account)
    const q = query({ prompt: idle(), options: { cwd: homedir(), persistSession: false, stderr: (d) => log(d), ...(exe ? { pathToClaudeCodeExecutable: exe } : {}), ...(env ? { env } : {}) } })
    try {
      return await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
    } finally {
      release()
      try {
        q.close()
      } catch {
        /* already closed */
      }
    }
  }
}
