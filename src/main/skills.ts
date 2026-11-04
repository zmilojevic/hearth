import { join } from 'node:path'
import { homedir } from 'node:os'
import { readdir, readFile, stat } from 'node:fs/promises'
import type { SkillInfo } from '../shared/types'

function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

/** Strip a trailing `/.claude/worktrees/<name>` (git-free project root of a worktree cwd). */
function rootOf(cwd: string): string {
  const m = cwd.replace(/\\/g, '/').match(/^(.*)\/\.claude\/worktrees\/[^/]+\/?$/)
  return m ? m[1] : cwd
}

const unquote = (v: string): string => {
  const t = v.trim()
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    const inner = t.slice(1, -1)
    return t[0] === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner.replace(/''/g, "'")
  }
  return t
}

/** Read `name` / `description` from the YAML frontmatter (plain, quoted, `>` / `|` block values). */
function frontmatter(text: string): { name?: string; description?: string } {
  const m = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return {}
  const lines = m[1].split(/\r?\n/)
  const out: Record<string, string> = {}
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(name|description):\s*(.*)$/)
    if (!kv) continue
    const key = kv[1]
    const val = kv[2].trim()
    if (/^[>|][+-]?\d*$/.test(val) || val === '') {
      const parts: string[] = []
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1] === '')) parts.push(lines[++i].trim())
      out[key] = parts.join(' ')
    } else if (val[0] === '"' || val[0] === "'") {
      let full = val
      while (!(full.length >= 2 && full.endsWith(val[0]) && !full.endsWith('\\' + val[0])) && i + 1 < lines.length && /^\s/.test(lines[i + 1])) {
        full += ' ' + lines[++i].trim()
      }
      out[key] = unquote(full)
    } else {
      const parts = [val]
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim())
      out[key] = parts.join(' ')
    }
  }
  return { name: out.name?.replace(/\s+/g, ' ').trim(), description: out.description?.replace(/\s+/g, ' ').trim() }
}

async function scan(dir: string, scope: SkillInfo['scope']): Promise<SkillInfo[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const res: SkillInfo[] = []
  for (const n of names) {
    const path = join(dir, n, 'SKILL.md')
    try {
      if (!(await stat(join(dir, n))).isDirectory()) continue
      const text = await readFile(path, 'utf8')
      const fm = frontmatter(text)
      res.push({ name: fm.name || n, description: fm.description ?? '', scope, path })
    } catch {
      /* no SKILL.md or unreadable: skip */
    }
  }
  return res.sort((a, b) => a.name.localeCompare(b.name))
}

export async function listSkills(cwd: string): Promise<SkillInfo[]> {
  try {
    if (typeof cwd !== 'string' || !cwd) return []
    const dirs = [cwd, rootOf(cwd)].filter((d, i, a) => a.indexOf(d) === i)
    const seen = new Set<string>()
    const project: SkillInfo[] = []
    for (const d of dirs) {
      for (const s of await scan(join(d, '.claude', 'skills'), 'project')) {
        if (seen.has(s.name)) continue
        seen.add(s.name)
        project.push(s)
      }
    }
    project.sort((a, b) => a.name.localeCompare(b.name))
    return [...project, ...(await scan(join(configDir(), 'skills'), 'user'))]
  } catch {
    return []
  }
}
