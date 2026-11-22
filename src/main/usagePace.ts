import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PlanUsage, UsagePace } from '../shared/types'
import { usageDay } from '../shared/usageDay'

/** Per account, today's use of the weekly limit, persisted in `<userData>/usage-pace.json`. */
let state: Record<string, UsagePace> | null = null
let timer: ReturnType<typeof setTimeout> | null = null

const file = (): string => join(app.getPath('userData'), 'usage-pace.json')

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

/** Entries of today only. */
export function usagePace(now = Date.now()): Record<string, UsagePace> {
  const out: Record<string, UsagePace> = {}
  try {
    const today = usageDay(now)
    for (const [k, v] of Object.entries(get())) if (v.day === today) out[k] = v
  } catch {
    // ignore
  }
  return out
}
