import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PlanUsage, UsagePace, UsagePaceEstimate } from '../shared/types'
import { dayBoundaryMs, usageDay } from '../shared/usageDay'
import { accountCosts, type CostPoint } from './usageHistory'
import { firstAttributionMs } from './usageAccounts'

/** Per account, today's use of the weekly limit, persisted in `<userData>/usage-pace.json`. */
let state: Record<string, UsagePace> | null = null
let timer: ReturnType<typeof setTimeout> | null = null

const file = (): string => join(app.getPath('userData'), 'usage-pace.json')

/** A server-side increase of the weekly percent, seen by `observe`. */
export interface Tick {
  t: number
  pct: number
  resetsAt: string | null
}
const TICK_KEEP_MS = 14 * 24 * 3600 * 1000
const SEGMENT_TOL_MS = 3_600_000
let ticks: Record<string, Tick[]> | null = null
let tickTimer: ReturnType<typeof setTimeout> | null = null
const tickFile = (): string => join(app.getPath('userData'), 'usage-ticks.json')

function getTicks(): Record<string, Tick[]> {
  if (ticks) return ticks
  ticks = {}
  try {
    const o = JSON.parse(readFileSync(tickFile(), 'utf8'))
    if (o && typeof o === 'object')
      for (const [k, v] of Object.entries(o as Record<string, Tick[]>))
        if (Array.isArray(v)) ticks[k] = v.filter((x) => x && typeof x.t === 'number' && typeof x.pct === 'number')
  } catch {
    // none yet
  }
  return ticks
}

function saveTicks(): void {
  if (tickTimer) return
  tickTimer = setTimeout(() => {
    tickTimer = null
    void writeFile(tickFile(), JSON.stringify(ticks ?? {})).catch(() => {})
  }, 2000)
}

function recordTick(account: string, tick: Tick): void {
  const all = getTicks()
  const list = (all[account] ??= [])
  list.push(tick)
  const cutoff = tick.t - TICK_KEEP_MS
  all[account] = list.filter((x) => x.t >= cutoff)
  saveTicks()
}

function get(): Record<string, UsagePace> {
  if (state) return state
  state = {}
  try {
    const o = JSON.parse(readFileSync(file(), 'utf8'))
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o as Record<string, UsagePace>)) if (v && typeof v.day === 'string') state[k] = v
  } catch {
    // none yet
  }
  return state
}

function save(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    void writeFile(file(), JSON.stringify(state ?? {})).catch(() => {})
  }, 2000)
}

/** Feeds the latest plan usage of every account; never throws. */
export function observe(all: Record<string, PlanUsage | null>, now = Date.now()): void {
  try {
    const st = get()
    const today = usageDay(now)
    let changed = false
    for (const [account, u] of Object.entries(all)) {
      const row = u && u.available !== false ? u.rows.find((r) => r.kind === 'weekly_all') : undefined
      if (!row || typeof row.percent !== 'number' || !isFinite(row.percent)) continue
      const pct = row.percent
      const s = st[account]
      if (!s || s.day !== today) {
        st[account] = { account, day: today, since: now, startPercent: pct, lastPercent: pct, usedToday: 0, resetsAt: row.resetsAt }
        changed = true
      } else {
        const oldT = s.resetsAt ? Date.parse(s.resetsAt) : NaN
        const newT = row.resetsAt ? Date.parse(row.resetsAt) : NaN
        if (isFinite(oldT) && isFinite(newT) && newT - oldT > 3_600_000) {
          // genuine window change: the new window's usage so far counts as today's
          s.usedToday += pct
          s.lastPercent = pct
          s.resetsAt = row.resetsAt
          changed = true
        } else {
          if (pct > s.lastPercent) {
            recordTick(account, { t: now, pct, resetsAt: row.resetsAt })
            s.usedToday += pct - s.lastPercent
            s.lastPercent = pct
            changed = true
          }
          if (row.resetsAt && (!isFinite(oldT) || newT > oldT) && row.resetsAt !== s.resetsAt) {
            s.resetsAt = row.resetsAt
            changed = true
          }
        }
      }
    }
    if (changed) save()
  } catch {
    // never throws
  }
}

const sameWindow = (a: string | null, b: string | null): boolean => {
  const x = a ? Date.parse(a) : NaN
  const y = b ? Date.parse(b) : NaN
  return isFinite(x) && isFinite(y) ? Math.abs(x - y) <= SEGMENT_TOL_MS : a === b
}

/** Sum of the cost of points with from < ts <= to (list sorted by ts). */
export function costBetween(list: CostPoint[], from: number, to: number): number {
  let sum = 0
  for (const p of list) if (p.ts > from && p.ts <= to) sum += p.cost
  return sum
}

export interface Calibration {
  costPerPercent: number
  basis: 'ticks' | 'window' | 'rough'
  points: number
}

/** Cost per percent point of the weekly limit, from tick pairs (preferred) or the current window's total; null = not enough data. */
export function calibrate(
  s: UsagePace,
  tk: Tick[],
  costs: CostPoint[],
  firstAttr: number | null,
  now: number,
  roughCosts: CostPoint[] = []
): Calibration | null {
  const recent = tk.filter((x) => x.t >= now - TICK_KEEP_MS).sort((a, b) => a.t - b.t)
  let num = 0
  let den = 0
  for (let i = 1; i < recent.length; i++) {
    const a = recent[i - 1]
    const b = recent[i]
    if (!sameWindow(a.resetsAt, b.resetsAt) || !(b.pct > a.pct)) continue
    num += costBetween(costs, a.t, b.t)
    den += b.pct - a.pct
  }
  if (den >= 3 && num > 0) return { costPerPercent: num / den, basis: 'ticks', points: den }
  const rs = s.resetsAt ? Date.parse(s.resetsAt) : NaN
  if (isFinite(rs) && firstAttr !== null && s.lastPercent >= 3) {
    const ws = rs - 7 * 24 * 3600 * 1000
    const c = costBetween(costs, ws, now)
    if (firstAttr <= ws && c > 0) return { costPerPercent: c / s.lastPercent, basis: 'window', points: s.lastPercent }
  }
  // Rough: default account only, this week's transcripts incl. unattributed messages, all counted as this account's.
  if (s.account === 'default' && isFinite(rs) && s.lastPercent >= 3) {
    const c = costBetween(roughCosts, rs - 7 * 24 * 3600 * 1000, now)
    if (c > 0) return { costPerPercent: c / s.lastPercent, basis: 'rough', points: s.lastPercent }
  }
  return null
}

/** Estimate for one pace entry given its calibration; pure. */
export function estimateFor(s: UsagePace, tk: Tick[], costs: CostPoint[], cal: Calibration, now: number): UsagePaceEstimate {
  const cpp = cal.costPerPercent
  // Time the current percent was first seen: its tick in this window, else the entry's first observation.
  let lastT = s.since
  let found = -1
  for (const x of tk) if (x.pct === s.lastPercent && sameWindow(x.resetsAt, s.resetsAt) && x.t <= now && x.t > found) found = x.t
  if (found >= 0) lastT = found
  // Without a tick for this percent, cost since `since` also covers the whole points gained since tracking started
  // (already in usedToday), so only the residual beyond them counts.
  const frac =
    found >= 0
      ? Math.min(0.99, costBetween(costs, lastT, now) / cpp)
      : Math.min(0.99, Math.max(0, costBetween(costs, lastT, now) / cpp - (s.lastPercent - s.startPercent)))
  const boundary = dayBoundaryMs(s.since)
  let before = 0
  if (s.since > boundary) {
    const morn = costBetween(costs, boundary, s.since)
    before = Math.min(s.startPercent, morn / cpp)
    // Proportional cap: unattributed/other-account usage and calibration error can't make the morning exceed its share of the window's usage.
    const winStart = (s.resetsAt ? Date.parse(s.resetsAt) : NaN) - 7 * 24 * 3600 * 1000
    const win = Number.isFinite(winStart) ? costBetween(costs, winStart, s.since) : 0
    if (win > 0) before = Math.min(before, (s.startPercent * morn) / win)
  }
  return { used: s.usedToday + frac + before, frac, before, costPerPercent: cpp, basis: cal.basis, points: cal.points }
}

const calCache = new Map<string, { at: number; resetsAt: string | null; lastPercent: number; cal: Calibration | null }>()

/** Entries of today only, each with a token-based `estimate` when calibrated. */
export async function usagePace(now = Date.now()): Promise<Record<string, UsagePace>> {
  const out: Record<string, UsagePace> = {}
  try {
    const today = usageDay(now)
    for (const [k, v] of Object.entries(get())) if (v.day === today) out[k] = { ...v }
    const tk = getTicks()
    for (const [account, p] of Object.entries(out)) {
      try {
        // The default account also counts unattributed messages (usage outside Hearth's per-account tracking, e.g. a
        // chat started before the restart); other accounts only their attributed ones.
        const isDef = account === 'default'
        const costs = await accountCosts(account, { includeUnattributed: isDef })
        const mine = tk[account] ?? []
        let hit = calCache.get(account)
        if (!hit || now - hit.at > 60_000 || hit.resetsAt !== p.resetsAt || hit.lastPercent !== p.lastPercent) {
          hit = { at: now, resetsAt: p.resetsAt, lastPercent: p.lastPercent, cal: calibrate(p, mine, costs, firstAttributionMs(), now, isDef ? costs : []) }
          calCache.set(account, hit)
        }
        if (hit.cal) p.estimate = estimateFor(p, mine, costs, hit.cal, now)
      } catch {
        // no estimate for this account
      }
    }
  } catch {
    // ignore
  }
  return out
}
