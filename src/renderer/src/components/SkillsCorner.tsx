import type { CSSProperties } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useStore, isGeneral } from '../store'
import { isPhone } from '../util'
import type { SkillInfo } from '@shared/types'

function focusComposer(): void {
  document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus()
}

const REFETCH_MIN_MS = 30_000
const COL_W = 400
const WIDTH_VAR = { '--skills-w': `${COL_W}px` } as CSSProperties
const GUTTER_NEED = COL_W + 40
// These mirror styles.css (.chat-col max-width / padding-right, .composer max-width, .composer-wrap side padding)
const CHAT_COL_MAX = 1070
const CHAT_COL_PAD_R = 29
const COMPOSER_MAX = 1032
const COMPOSER_PAD_X = 24
const ABBREV = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|approx|incl|resp)\.$/i
const MAX_DESC = 70
const MIN_CUT = 15
const SEPARATORS = [': ', ' (', ' — ', ' – ', ' - ', '; ']

/** First sentence of a skill description, cut at the first separator, <= 70 chars. */
export function firstSentence(text: string): string {
  const t = text.trim()
  let end = t.length
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (c === '\n') {
      end = i
      break
    }
    if ((c === '.' || c === '!' || c === '?') && (i + 1 === t.length || /\s/.test(t[i + 1]))) {
      if (c === '.' && ABBREV.test(t.slice(0, i + 1))) continue
      end = i + 1
      break
    }
  }
  let out = t.slice(0, end).trim().replace(/:$/, '').trim()
  const cuts = SEPARATORS.map((sep) => out.indexOf(sep)).filter((i) => i >= MIN_CUT)
  if (cuts.length) out = out.slice(0, Math.min(...cuts)).trim()
  if (out.length > MAX_DESC) {
    const cut = out.slice(0, MAX_DESC)
    const sp = cut.lastIndexOf(' ')
    out = (sp > 0 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '') + '…'
  }
  return out
}

/**
 * Skills of the project (and user), listed at the bottom-right of the free space right of the composer
 * (portalled into .chat-pane). When that space is too narrow the chat shifts left first (see below); it never takes width from the chat.
 */
export default function SkillsCorner({ chatId }: { chatId: string }) {
  const cwd = useStore((s) => s.chats[chatId]?.cwd)
  const engine = useStore((s) => s.chats[chatId]?.engine)
  const generalDir = useStore((s) => s.generalDir)
  const mode = useStore((s) => s.skillsCorner)
  const setMode = useStore((s) => s.setSkillsCorner)
  const setDraft = useStore((s) => s.setDraft)
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const lastFetch = useRef(0)
  const [pane, setPane] = useState<HTMLElement | null>(null)
  const [gutter, setGutter] = useState(false)

  const eligible = !isPhone && !!cwd && engine !== 'codex' && !(generalDir && cwd === generalDir) && !isGeneral(cwd)
  const active = eligible && mode !== 'hidden'

  useEffect(() => {
    if (!active || !cwd) return
    let stale = false
    const load = (): void => {
      lastFetch.current = Date.now()
      void window.desktop.listSkills(cwd).then(
        (l) => !stale && setSkills(l),
        () => !stale && setSkills([])
      )
    }
    load()
    const onFocus = (): void => {
      if (Date.now() - lastFetch.current >= REFETCH_MIN_MS) load()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      stale = true
      window.removeEventListener('focus', onFocus)
    }
  }, [active, cwd])

  const visible = active && skills.length > 0

  // Show the list only when the free space right of the composer and the chat column is wide enough. If it is
  // not, first shift the chat column/composer left (inline --chat-shift on .chat-pane, up to flush-left) to make
  // room; hide the list only when even that is not enough. The override is removed whenever the list is not shown.
  useLayoutEffect(() => {
    if (!visible) return
    const el = document.querySelector<HTMLElement>('.chat-pane')
    setPane(el)
    if (!el) return
    const measure = (): void => {
      const W = el.getBoundingClientRect().width
      const s0 = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chat-shift')) || 0
      const gapAt = (shift: number): number => {
        const colRight = Math.max(0, (W - CHAT_COL_MAX) / 2 - shift) + Math.min(CHAT_COL_MAX, W) - CHAT_COL_PAD_R
        const Wc = W - 2 * COMPOSER_PAD_X
        const composerRight = COMPOSER_PAD_X + Math.max(0, (Wc - COMPOSER_MAX) / 2 - shift) + Math.min(COMPOSER_MAX, Wc)
        return W - Math.max(colRight, composerRight)
      }
      // beyond sMax both margins are clamped to 0, so shifting further changes nothing
      const sMax = Math.max(0, (W - CHAT_COL_MAX) / 2, (W - 2 * COMPOSER_PAD_X - COMPOSER_MAX) / 2)
      const upper = Math.ceil(Math.max(s0, sMax))
      if (gapAt(s0) >= GUTTER_NEED) {
        el.style.removeProperty('--chat-shift')
        setGutter(true)
      } else if (gapAt(upper) >= GUTTER_NEED) {
        let lo = Math.floor(s0)
        let hi = upper
        while (hi - lo > 1) {
          const mid = Math.floor((lo + hi) / 2)
          if (gapAt(mid) >= GUTTER_NEED) hi = mid
          else lo = mid
        }
        el.style.setProperty('--chat-shift', `${hi}px`)
        setGutter(true)
      } else {
        el.style.removeProperty('--chat-shift')
        setGutter(false)
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      ro.disconnect()
      el.style.removeProperty('--chat-shift')
    }
  }, [visible, chatId, skills])

  if (!visible || !gutter || !pane) return null

  const pick = (name: string): void => {
    const cur = useStore.getState().chats[chatId]?.draft ?? ''
    setDraft(chatId, cur.trim() ? `/${name} ${cur}` : `/${name} `)
    focusComposer()
  }

  const project = skills.filter((s) => s.scope === 'project')
  const projectNames = new Set(project.map((s) => s.name))
  const user = skills.filter((s) => s.scope === 'user' && !projectNames.has(s.name))
  const row = (s: SkillInfo) => (
    <button type="button" key={`${s.scope}:${s.name}`} className="skills-row" onClick={() => pick(s.name)}>
      <span className="skills-name">/{s.name}</span>
      {s.description && <span className="skills-desc">{firstSentence(s.description)}</span>}
    </button>
  )

  return createPortal(
    <div className="skills-list" style={WIDTH_VAR}>
      <div className="skills-head">
        <button type="button" className="skills-ib" title="Hide skills (re-enable in settings)" onClick={() => setMode('hidden')}>
          <X size={12} />
        </button>
        <span className="skills-label">Skills</span>
      </div>
      <div className="skills-body">
        {project.map(row)}
        {user.map(row)}
      </div>
    </div>,
    pane
  )
}
