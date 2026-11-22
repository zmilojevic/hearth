import { app } from 'electron'
import { appendFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Which Claude account ran which assistant message. Transcripts don't record it, so every assistant message id seen by a
 * runner is logged to `<userData>/usage-accounts.jsonl` as `{"m":id,"a":account,"t":ms}` (append-only, from now on).
 */
const MAX_AGE_MS = 180 * 24 * 3600 * 1000
const known = new Map<string, string>()
let loaded = false
let pending: string[] = []
let flushing = false

const file = (): string => join(app.getPath('userData'), 'usage-accounts.jsonl')

function load(): void {
  if (loaded) return
  loaded = true
  try {
    const keep: string[] = []
    let dropped = false
    const cutoff = Date.now() - MAX_AGE_MS
    for (const line of readFileSync(file(), 'utf8').split('\n')) {
      if (!line) continue
      try {
        const o = JSON.parse(line)
        if (typeof o?.m !== 'string' || typeof o?.a !== 'string') continue
        if (typeof o.t === 'number' && o.t < cutoff) {
          dropped = true
          continue
        }
        known.set(o.m, o.a)
        keep.push(line)
      } catch {
        dropped = true
      }
    }
    if (dropped) void writeFile(file(), keep.length ? keep.join('\n') + '\n' : '').catch(() => {})
  } catch {
    // no file yet
  }
}

async function flush(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    while (pending.length) {
      const chunk = pending.join('')
      pending = []
      await appendFile(file(), chunk).catch(() => {})
    }
  } finally {
    flushing = false
  }
}

/** Records the account of an SDK `assistant` message (once per message id). */
export function noteAssistant(account: string, message: unknown): void {
  try {
    const m = message as { type?: string; message?: { id?: unknown } }
    const id = m?.type === 'assistant' ? m.message?.id : undefined
    if (typeof id !== 'string' || !id) return
    load()
    if (known.has(id)) return
    known.set(id, account)
    pending.push(JSON.stringify({ m: id, a: account, t: Date.now() }) + '\n')
    void flush()
  } catch {
    // never throws
  }
}

export function accountOf(id: string): string | undefined {
  try {
    load()
    return known.get(id)
  } catch {
    return undefined
  }
}
