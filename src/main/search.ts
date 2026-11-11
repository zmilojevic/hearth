import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { MessageHit } from '../shared/types'

/** Full-text search over the user/assistant text of every Claude transcript (top level of ~/.claude/projects/*; no subagents, no Codex). */

interface Entry {
  uuid: string
  ts: number
  text: string
}
interface FileIndex {
  size: number
  mtimeMs: number
  /** Byte offset just past the last complete line already read. */
  offset: number
  cwd: string
  entries: Entry[]
}

const index = new Map<string, FileIndex>()
let inflight: Promise<void> | null = null
const MAX_TEXT = 20_000 // per message, bounds memory

// Same texts the reducer hides in the chat.
const HIDDEN = ['<command-name>', '<command-message>', '<local-command-stdout>', '<local-command-caveat>', '<system-reminder>', '<task-notification>']

function visible(raw: string): string {
  const t = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
  if (!t || HIDDEN.some((h) => t.startsWith(h))) return ''
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) : t
}

function parseLine(line: string, f: FileIndex): void {
  const isUser = line.includes('"type":"user"')
  if (!isUser && !line.includes('"type":"assistant"')) return
  let o: any
  try {
    o = JSON.parse(line)
  } catch {
    return
  }
  if (o?.type !== 'user' && o?.type !== 'assistant') return
  if (!f.cwd && typeof o.cwd === 'string') f.cwd = o.cwd
  if (o.isMeta || o.isSidechain || o.isCompactSummary || typeof o.uuid !== 'string') return
  const c = o.message?.content
  let raw = ''
  if (typeof c === 'string') raw = c
  else if (Array.isArray(c)) raw = c.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n')
  if (!raw) return
  const text = visible(raw)
  if (!text) return
  const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN
  f.entries.push({ uuid: o.uuid, ts: isNaN(ts) ? 0 : ts, text })
}

async function readFrom(path: string, f: FileIndex, size: number): Promise<number> {
  const rl = createInterface({ input: createReadStream(path, { start: f.offset, encoding: 'utf8' }), crlfDelay: Infinity })
  let end = f.offset
  let lastLen = 0
  let before = f.entries.length
  for await (const line of rl) {
    lastLen = Buffer.byteLength(line, 'utf8') + 1
    end += lastLen
    before = f.entries.length
    parseLine(line, f)
  }
  // Without a trailing newline the last line may still be growing: leave it for the next scan.
  if (end > size) {
    // the unterminated last line was parsed already; drop what it added so the re-read does not duplicate it
    f.entries.length = before
    return end - lastLen
  }
  return end
}

async function refresh(): Promise<void> {
  const root = join(homedir(), '.claude', 'projects')
  const files: string[] = []
  try {
    for (const d of await readdir(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      try {
        for (const e of await readdir(join(root, d.name), { withFileTypes: true })) if (e.isFile() && e.name.endsWith('.jsonl')) files.push(join(root, d.name, e.name))
      } catch {
        /* unreadable dir */
      }
    }
  } catch {
    return
  }
  const seen = new Set(files)
  for (const k of index.keys()) if (!seen.has(k)) index.delete(k)
  for (const path of files) {
    try {
      const st = await stat(path)
      let f = index.get(path)
      if (f && f.size === st.size && f.mtimeMs === st.mtimeMs) continue
      if (!f || st.size < f.size) f = { size: 0, mtimeMs: 0, offset: 0, cwd: '', entries: [] }
      const end = await readFrom(path, f, st.size)
      f.offset = Math.max(0, Math.min(end, st.size))
      f.size = st.size
      f.mtimeMs = st.mtimeMs
      index.set(path, f)
    } catch {
      /* unreadable or vanished */
    }
  }
}

function snippetAround(text: string, at: number, len: number): string {
  const from = Math.max(0, at - 60)
  const to = Math.min(text.length, at + len + 60)
  const s = text.slice(from, to).replace(/\s+/g, ' ').trim()
  return (from > 0 ? '…' : '') + s + (to < text.length ? '…' : '')
}

/** Newest-first list, one hit per session (its newest matching message) plus the number of matching messages. Never throws. */
export async function searchTranscripts(query: string, limit = 50): Promise<MessageHit[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  try {
    if (!inflight) {
      inflight = refresh().finally(() => {
        inflight = null
      })
    }
    await inflight
    const hits: MessageHit[] = []
    for (const [path, f] of index) {
      let best: { e: Entry; at: number } | null = null
      let count = 0
      for (const e of f.entries) {
        const at = e.text.toLowerCase().indexOf(q)
        if (at < 0) continue
        count++
        if (!best || e.ts >= best.e.ts) best = { e, at }
      }
      if (!best || !f.cwd) continue
      const sessionId = basename(path, '.jsonl')
      hits.push({ sessionId, cwd: f.cwd, snippet: snippetAround(best.e.text, best.at, q.length), uuid: best.e.uuid, timestamp: best.e.ts, count })
    }
    hits.sort((a, b) => b.timestamp - a.timestamp)
    return hits.slice(0, Math.max(1, limit))
  } catch {
    return []
  }
}
