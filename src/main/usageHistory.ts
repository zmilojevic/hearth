import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { accountOf } from './usageAccounts'
import type { UsageDayRow, UsageHistory } from '../shared/types'
import { usageDay } from '../shared/usageDay'

interface Rec {
  id: string
  ts: number
  day: string
  cwd: string
  model: string
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
}
interface FileCache {
  size: number
  mtimeMs: number
  /** Byte offset just past the last complete line already read. */
  offset: number
  records: Map<string, Rec>
}

const cache = new Map<string, FileCache>()
let inflight: Promise<UsageHistory> | null = null
let last: UsageHistory = { rows: [], scannedAt: 0, files: 0 }
/** Deduped records of the last scan (for per-account cost series). */
let lastRecs: Rec[] = []
const costCache = new Map<string, { scannedAt: number; list: CostPoint[] }>()

/**
 * Relative input price per model. An API-price proxy for how the plan limit weighs tokens (not real money): only
 * the ratios matter, the calibration against the server's percent absorbs the scale.
 */
export function modelPrice(model: string): number {
  const m = model.toLowerCase()
  if (m.includes('fable') || m.includes('mythos')) return 10
  if (m.includes('opus-5-5')) return 4
  if (m.includes('opus')) return 5
  if (m.includes('sonnet-4')) return 3
  if (m.includes('sonnet')) return 2
  if (m.includes('haiku-4')) return 1
  if (m.includes('haiku')) return 0.1
  return 4
}

/** Weighted cost of one message: price x (input + 1.25 cache write + 0.1 cache read + 5 output). */
export function messageCost(model: string, t: { input: number; cacheWrite: number; cacheRead: number; output: number }): number {
  return modelPrice(model) * (t.input + 1.25 * t.cacheWrite + 0.1 * t.cacheRead + 5 * t.output)
}

export interface CostPoint {
  ts: number
  cost: number
}

async function listJsonl(dir: string, out: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) await listJsonl(p, out)
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p)
  }
}

function dayOf(ts: string): string | null {
  const t = Date.parse(ts)
  return isNaN(t) ? null : usageDay(t)
}

function parseLine(line: string, into: Map<string, Rec>): void {
  if (!line.includes('"usage"')) return
  let o: any
  try {
    o = JSON.parse(line)
  } catch {
    return
  }
  const m = o?.message
  const u = m?.usage
  if (o?.type !== 'assistant' || !u || typeof m.id !== 'string' || !m.model || m.model === '<synthetic>') return
  const day = typeof o.timestamp === 'string' ? dayOf(o.timestamp) : null
  if (!day) return
  const n = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0)
  into.set(m.id, {
    id: m.id,
    ts: Date.parse(o.timestamp),
    day,
    cwd: typeof o.cwd === 'string' ? o.cwd : '',
    model: String(m.model),
    input: n(u.input_tokens),
    cacheWrite: n(u.cache_creation_input_tokens),
    cacheRead: n(u.cache_read_input_tokens),
    output: n(u.output_tokens),
  })
}

/** Reads from `start`; returns the offset after the last newline-terminated line. */
async function readFrom(path: string, start: number, size: number, into: Map<string, Rec>): Promise<number> {
  const rl = createInterface({ input: createReadStream(path, { start, encoding: 'utf8' }), crlfDelay: Infinity })
  let end = start
  let lastLen = 0
  for await (const line of rl) {
    lastLen = Buffer.byteLength(line, 'utf8') + 1
    end += lastLen
    parseLine(line, into)
  }
  // Without a trailing newline the last line may still be growing: leave it for the next scan (re-parsing is idempotent).
  return end > size ? end - lastLen : end
}

async function scan(): Promise<UsageHistory> {
  const root = join(homedir(), '.claude', 'projects')
  const files: string[] = []
  await listJsonl(root, files)
  const seen = new Set(files)
  for (const k of cache.keys()) if (!seen.has(k)) cache.delete(k)

  for (const path of files) {
    try {
      const st = await stat(path)
      let c = cache.get(path)
      if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) continue
      if (!c || st.size < c.size || st.mtimeMs < c.mtimeMs) c = { size: 0, mtimeMs: 0, offset: 0, records: new Map() }
      const end = await readFrom(path, c.offset, st.size, c.records)
      c.offset = Math.max(0, Math.min(end, st.size))
      c.size = st.size
      c.mtimeMs = st.mtimeMs
      cache.set(path, c)
    } catch {
      // unreadable or vanished file: skip
    }
  }

  // Global dedupe: forked sessions copy lines with the same message id.
  const byId = new Map<string, Rec>()
  for (const c of cache.values()) for (const [id, r] of c.records) if (!byId.has(id)) byId.set(id, r)
  lastRecs = [...byId.values()]
  costCache.clear()
  const agg = new Map<string, UsageDayRow>()
  for (const r of byId.values()) {
    const account = accountOf(r.id) ?? ''
    const key = `${r.day}\0${r.cwd}\0${r.model}\0${account}`
    let row = agg.get(key)
    if (!row) agg.set(key, (row = { day: r.day, cwd: r.cwd, model: r.model, account, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, messages: 0 }))
    row.input += r.input
    row.cacheWrite += r.cacheWrite
    row.cacheRead += r.cacheRead
    row.output += r.output
    row.messages++
  }
  return { rows: [...agg.values()], scannedAt: Date.now(), files: files.length }
}

/** Token usage per day / project / model across every transcript; incremental, never throws. */
export function usageHistory(): Promise<UsageHistory> {
  if (inflight) return inflight
  inflight = scan()
    .then((h) => (last = h))
    .catch(() => last)
    .finally(() => {
      inflight = null
    })
  return inflight
}

/**
 * Cost points (sorted by time) of the messages attributed to `account` (plus unattributed ones with `includeUnattributed`), from the incremental scan; a scan younger than
 * 60 s is reused. Never throws.
 */
export async function accountCosts(account: string, opts: { includeUnattributed?: boolean } = {}, maxAgeMs = 60_000): Promise<CostPoint[]> {
  try {
    if (inflight || Date.now() - last.scannedAt >= maxAgeMs) await usageHistory()
    const inc = !!opts.includeUnattributed
    const key = inc ? `${account}\0+u` : account
    const hit = costCache.get(key)
    if (hit && hit.scannedAt === last.scannedAt) return hit.list
    const list: CostPoint[] = []
    for (const r of lastRecs) {
      const a = accountOf(r.id)
      if (a === account || (inc && a === undefined)) list.push({ ts: r.ts, cost: messageCost(r.model, r) })
    }
    list.sort((a, b) => a.ts - b.ts)
    costCache.set(key, { scannedAt: last.scannedAt, list })
    return list
  } catch {
    return []
  }
}
