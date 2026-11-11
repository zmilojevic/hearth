import { useEffect, useMemo, useState } from 'react'
import type { WfGraph, WorkflowJournalEntry } from '../../../../shared/workflow'
import { useStore } from '../../store'
import { projectRoot } from '../../util'
import type { BgTask } from '../../reduce'

const POLL_MS = 2000

/** Journal entries of a run dir: polled every 2 s while `running`, and once more when it flips to false (final state). */
export function useWorkflowJournal(dir: string | undefined, running: boolean): WorkflowJournalEntry[] {
  const [entries, setEntries] = useState<WorkflowJournalEntry[]>([])
  useEffect(() => {
    if (!dir) {
      setEntries([])
      return
    }
    let dead = false
    const load = (): void => {
      void window.desktop.workflowJournal(dir).then((e) => {
        if (!dead) setEntries(e)
      })
    }
    load()
    if (!running) return () => void (dead = true)
    const t = setInterval(load, POLL_MS)
    return () => {
      dead = true
      clearInterval(t)
    }
  }, [dir, running])
  return entries
}

export const taskLive = (t: BgTask): boolean => t.status === 'running' || t.status === 'pending' || t.status === 'paused'

export interface LiveRun {
  chatId: string
  task: BgTask
}

/** The newest workflow run (live ones first) of a saved workflow in any open chat of the project. */
export function useLiveRun(root: string, name: string | undefined): LiveRun | null {
  const chats = useStore((s) => s.chats)
  return useMemo(() => {
    if (!name) return null
    let best: LiveRun | null = null
    for (const c of Object.values(chats)) {
      if (projectRoot(c.cwd) !== root) continue
      for (const t of c.tasks) {
        if (t.type !== 'local_workflow' || t.workflowName !== name || !t.runDir) continue
        const better = !best || (taskLive(t) && !taskLive(best.task)) || (taskLive(t) === taskLive(best.task) && t.startedAt > best.task.startedAt)
        if (better) best = { chatId: c.chatId, task: t }
      }
    }
    return best
  }, [chats, root, name])
}

export type StepState = 'pending' | 'running' | 'done'

export interface NodeProgress {
  state: StepState
  /** forEach: items finished / items seen. */
  done?: number
  total?: number
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Maps journal entries to designer nodes. The generator labels agents `<step label>` (phase = phase title),
 * forEach stages `<stage label> <i+1>` (single stage: the forEach's own label) and verify votes `Verify <i+1>.<v+1>`.
 * Keys: step ids (top-level steps and forEach stages).
 */
export function nodeProgress(graph: WfGraph, entries: WorkflowJournalEntry[]): Map<string, NodeProgress> {
  const res = new Map<string, NodeProgress>()
  const merge = (list: WorkflowJournalEntry[]): StepState => (!list.length ? 'pending' : list.some((e) => e.status === 'running') ? 'running' : 'done')
  for (const p of graph.phases) {
    const inPhase = entries.filter((e) => e.phase === p.title)
    let verifyTaken = false
    for (const s of p.steps) {
      if (s.kind === 'agent') {
        res.set(s.id, { state: merge(inPhase.filter((e) => e.label === s.label)) })
        continue
      }
      const single = s.stages.length === 1
      const all: WorkflowJournalEntry[] = []
      let lastByItem = new Map<number, WorkflowJournalEntry>()
      s.stages.forEach((st, si) => {
        const re = new RegExp(`^${esc(single ? s.label : st.label)} (\\d+)$`)
        const mine: WorkflowJournalEntry[] = []
        const byItem = new Map<number, WorkflowJournalEntry>()
        for (const e of inPhase) {
          const m = re.exec(e.label)
          if (!m) continue
          mine.push(e)
          byItem.set(Number(m[1]), e)
        }
        res.set(st.id, { state: merge(mine) })
        all.push(...mine)
        if (si === s.stages.length - 1) lastByItem = byItem
      })
      if (s.verify && !verifyTaken) {
        verifyTaken = true
        all.push(...inPhase.filter((e) => /^Verify \d+\.\d+$/.test(e.label)))
      }
      const items = new Set<number>()
      for (const st of s.stages) {
        const re = new RegExp(`^${esc(single ? s.label : st.label)} (\\d+)$`)
        for (const e of inPhase) {
          const m = re.exec(e.label)
          if (m) items.add(Number(m[1]))
        }
      }
      const done = [...lastByItem.values()].filter((e) => e.status === 'done').length
      res.set(s.id, { state: merge(all), done, total: items.size })
    }
  }
  return res
}

export interface RunRow {
  key: string
  label: string
  status: StepState
  result?: string
}
export interface RunPhase {
  title: string
  rows: RunRow[]
}

/** Journal entries grouped by phase (first-seen order); with a designer graph, unseen steps/phases are added as pending. */
export function runView(entries: WorkflowJournalEntry[], graph: WfGraph | null): RunPhase[] {
  const phases: RunPhase[] = []
  const get = (title: string): RunPhase => {
    let p = phases.find((x) => x.title === title)
    if (!p) phases.push((p = { title, rows: [] }))
    return p
  }
  if (graph) for (const p of graph.phases) get(p.title)
  for (const e of entries) get(e.phase).rows.push({ key: e.agentId, label: e.label, status: e.status, result: e.result })
  if (graph) {
    const prog = nodeProgress(graph, entries)
    for (const gp of graph.phases) {
      const p = get(gp.title)
      for (const s of gp.steps) if (prog.get(s.id)?.state === 'pending') p.rows.push({ key: `pending:${s.id}`, label: s.kind === 'forEach' ? `${s.label} (for each)` : s.label, status: 'pending' })
    }
  }
  return phases.filter((p) => p.rows.length)
}
