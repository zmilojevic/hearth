import type { Chat } from './store'

const LIMIT = 40_000
const CUT = '[… earlier part of the conversation omitted …]'

function shortInput(input: Record<string, unknown>): string {
  const keys = ['file_path', 'path', 'notebook_path', 'command', 'pattern', 'url', 'query', 'description', 'prompt']
  let v: unknown
  for (const k of keys) {
    if (typeof input[k] === 'string' && input[k]) {
      v = input[k]
      break
    }
  }
  if (v === undefined) v = Object.values(input).find((x) => typeof x === 'string' && x)
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  return t.length > 120 ? t.slice(0, 119) + '…' : t
}

/** Condensed transcript of a chat (user/assistant text, one line per tool call, no results) to start the same work in the other engine. */
export function handoffText(c: Chat): string {
  const from = c.engine === 'codex' ? 'Codex' : 'Claude'
  const head = `Continuing work started in ${from} (session ${c.sessionId ?? c.chatId}). Condensed transcript follows; the files on disk are already in their current state.`
  const tail = 'Continue from where this left off.'
  const parts: string[] = []
  for (const m of c.messages) {
    const lines: string[] = []
    for (const b of m.blocks) {
      if (b.kind === 'text' && b.text.trim()) lines.push(b.text.trim())
      else if (b.kind === 'tool_use') lines.push(`[tool ${b.name}: ${shortInput(b.input)}]`)
    }
    if (lines.length) parts.push(`${m.role === 'user' ? 'User' : 'Assistant'}:\n${lines.join('\n')}`)
  }
  let budget = LIMIT
  const kept: string[] = []
  let cut = false
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (p.length + 2 <= budget) {
      kept.unshift(p)
      budget -= p.length + 2
      continue
    }
    cut = true
    if (budget > 500) kept.unshift('…' + p.slice(p.length - (budget - 3)))
    break
  }
  return [head, ...(cut ? [CUT] : []), ...kept, tail].join('\n\n')
}
