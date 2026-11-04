import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import type { AccountInfo, AccountsState } from '../shared/types'

/**
 * Multiple Claude logins. The CLI keeps its login in $CLAUDE_CONFIG_DIR (default ~/.claude), so an extra account is a config dir of its own
 * (`<userData>/claude-accounts/<id>`) whose history/settings are symlinks to the base dir; only the login (.credentials.json) and the
 * per-account state stay separate. The `default` account is today's behaviour: no env override at all.
 */

export const DEFAULT_ACCOUNT = 'default'

/** Entries of the base config dir shared with every extra account. Allowlist on purpose: credentials, policy/remote settings and caches are org-specific. */
const SHARED_ENTRIES = [
  'projects',
  'settings.json',
  'settings.local.json',
  'CLAUDE.md',
  'agents',
  'commands',
  'skills',
  'plugins',
  'output-styles',
  'hooks',
  'plans',
  'todos',
  'file-history',
  'history.jsonl',
  'keybindings.json',
  'workflows',
]
/** Keys of `.claude.json` copied to a new account and merged (missing keys only) when switching to it. */
const SEED_KEYS = ['hasCompletedOnboarding', 'lastOnboardingVersion', 'mcpServers', 'projects', 'githubRepoPaths']

const baseDir = (): string => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
/** The CLI's state file: `~/.claude.json` for the default dir, `<dir>/.claude.json` when CLAUDE_CONFIG_DIR is set. */
const baseStateFile = (): string => (process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json'))
const accountsRoot = (): string => join(app.getPath('userData'), 'claude-accounts')
const storeFile = (): string => join(app.getPath('userData'), 'accounts.json')

let state: AccountsState | null = null
const listeners = new Set<() => void>()

function load(): AccountsState {
  if (state) return state
  let raw: Partial<AccountsState> = {}
  try {
    raw = JSON.parse(readFileSync(storeFile(), 'utf8'))
  } catch {
    /* first run or unreadable: only the default account */
  }
  const accounts: AccountInfo[] = [{ id: DEFAULT_ACCOUNT }]
  for (const a of Array.isArray(raw.accounts) ? raw.accounts : []) {
    if (!a || typeof a.id !== 'string') continue
    if (a.id === DEFAULT_ACCOUNT) Object.assign(accounts[0], pickInfo(a))
    else if (/^acc-[0-9a-f]{8}$/.test(a.id)) accounts.push({ id: a.id, ...pickInfo(a) })
  }
  const active = typeof raw.active === 'string' && accounts.some((a) => a.id === raw.active) ? raw.active : DEFAULT_ACCOUNT
  state = { active, accounts }
  return state
}

function pickInfo(a: Partial<AccountInfo>): Omit<AccountInfo, 'id'> {
  const o: Omit<AccountInfo, 'id'> = {}
  for (const k of ['label', 'email', 'org', 'plan'] as const) if (typeof a[k] === 'string' && a[k]) o[k] = a[k]
  return o
}

function save(): void {
  try {
    writeAtomic(storeFile(), JSON.stringify(load(), null, 2))
  } catch {
    /* never throws */
  }
  for (const l of listeners) l()
}

function writeAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

/** Called after every change of the account list / active account / account info. */
export function onAccountsChanged(cb: () => void): void {
  listeners.add(cb)
}

export function listAccounts(): AccountsState {
  const s = load()
  return { active: s.active, accounts: s.accounts.map((a) => ({ ...a })) }
}

export function activeAccount(): string {
  return load().active
}

/** The id when it names a known account, else the default one. */
export function resolveAccount(id?: string): string {
  const s = load()
  const want = id ?? s.active
  return s.accounts.some((a) => a.id === want) ? want : DEFAULT_ACCOUNT
}

/** Config dir of an account (the base dir for the default). */
export function accountConfigDir(id: string): string {
  return id === DEFAULT_ACCOUNT ? baseDir() : join(accountsRoot(), id)
}

/** Full env for a CLI of this account (the SDK's `env` option replaces the process env); undefined for the default account (no override at all). */
export function accountEnv(id: string): Record<string, string> | undefined {
  if (id === DEFAULT_ACCOUNT) return undefined
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  env.CLAUDE_CONFIG_DIR = accountConfigDir(id)
  return env
}

function link(target: string, path: string): void {
  try {
    lstatSync(path)
    return // exists (a link or a real entry): leave it
  } catch {
    /* missing */
  }
  try {
    const isDir = statSync(target).isDirectory()
    symlinkSync(target, path, isDir && process.platform === 'win32' ? 'junction' : undefined)
  } catch {
    /* Windows file links need privileges; skipped */
  }
}

/** Creates the account dir and the links into the base dir that are still missing; never throws. */
export function ensureAccountDir(id: string): void {
  if (id === DEFAULT_ACCOUNT) return
  try {
    const dir = accountConfigDir(id)
    const base = baseDir()
    mkdirSync(dir, { recursive: true })
    try {
      mkdirSync(join(base, 'projects'), { recursive: true })
    } catch {
      /* base not writable */
    }
    for (const name of SHARED_ENTRIES) if (existsSync(join(base, name))) link(join(base, name), join(dir, name))
  } catch {
    /* never throws */
  }
}

function readJson(file: string): Record<string, any> | null {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null
  } catch {
    return null
  }
}

/** Seeds the account's `.claude.json` from the base one (new account), or merges missing `mcpServers` keys and `projects` entries (switching to it). */
function syncState(id: string, seed: boolean): void {
  if (id === DEFAULT_ACCOUNT) return
  try {
    const src = readJson(baseStateFile())
    if (!src) return
    const file = join(accountConfigDir(id), '.claude.json')
    const dst = readJson(file)
    if (!dst && !seed && existsSync(file)) return // unreadable existing file: do not overwrite
    const out: Record<string, any> = dst ?? {}
    let changed = !dst
    for (const k of SEED_KEYS) {
      if (!(k in src)) continue
      if (k === 'mcpServers' || k === 'projects') {
        const cur = out[k] && typeof out[k] === 'object' ? out[k] : {}
        for (const [name, v] of Object.entries(src[k] ?? {})) {
          if (!(name in cur)) {
            cur[name] = v
            changed = true
          }
        }
        if (out[k] !== cur) out[k] = cur
      } else if (seed && !(k in out)) {
        out[k] = src[k]
        changed = true
      }
    }
    if (changed) writeAtomic(file, JSON.stringify(out, null, 2))
  } catch {
    /* never throws */
  }
}

export function setActiveAccount(id: string): void {
  const s = load()
  if (!s.accounts.some((a) => a.id === id)) return
  if (s.active !== id) {
    ensureAccountDir(id)
    syncState(id, false)
    s.active = id
  }
  save()
}

/** Creates an extra account (dir, links, seeded state) and returns its id. */
export function addAccount(): string {
  const s = load()
  let id = ''
  do id = `acc-${randomBytes(4).toString('hex')}`
  while (s.accounts.some((a) => a.id === id))
  ensureAccountDir(id)
  syncState(id, true)
  s.accounts.push({ id })
  save()
  return id
}

export async function removeAccount(id: string): Promise<void> {
  const s = load()
  if (id === DEFAULT_ACCOUNT || !s.accounts.some((a) => a.id === id)) return
  s.accounts = s.accounts.filter((a) => a.id !== id)
  if (s.active === id) s.active = DEFAULT_ACCOUNT
  save()
  // rm does not follow symlinks; still make sure the target is exactly an account dir under our root.
  try {
    const dir = resolve(accountConfigDir(id))
    if (dirname(dir) === resolve(accountsRoot()) && lstatSync(dir).isDirectory()) await rm(dir, { recursive: true, force: true })
  } catch {
    /* already gone */
  }
}

/** Stores what `auth status` reported; only the changed fields trigger a push. */
export function updateAccountInfo(id: string, info: { email?: string; org?: string; plan?: string }): void {
  const a = load().accounts.find((x) => x.id === id)
  if (!a) return
  let changed = false
  for (const k of ['email', 'org', 'plan'] as const) {
    const v = info[k]
    if (v && a[k] !== v) {
      a[k] = v
      changed = true
    }
  }
  if (changed) save()
}
