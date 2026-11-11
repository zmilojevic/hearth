import { useEffect } from 'react'
import { useStore, type AwayItem } from '../store'
import { fmtDuration, fmtTokens, projectName, projectRoot } from '../util'

const STATUS: Record<AwayItem['status'], string> = { finished: 'Finished', error: 'Error', ask: 'Needs input' }

/** "While you were away" modal: chats that finished, failed or wait for input during a long absence. */
export default function AwayCard({ items }: { items: AwayItem[] }) {
  const dismiss = useStore((s) => s.dismissAway)
  const activate = useStore((s) => s.activate)
  const projectNames = useStore((s) => s.projectNames)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        dismiss()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [dismiss])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && dismiss()}>
      <div className="modal away-modal">
        <div className="modal-head">
          <h3>While you were away</h3>
        </div>
        <div className="away-list">
          {items.map((it) => (
            <button
              key={it.chatId}
              className="away-row"
              onClick={() => {
                activate(it.chatId)
                dismiss()
              }}
            >
              <span className="away-title">{it.title}</span>
              <span className={`away-status ${it.status}`}>{STATUS[it.status]}</span>
              <span className="away-meta">
                {[
                  projectName(projectNames, projectRoot(it.cwd)),
                  it.status === 'error' && it.error ? it.error.slice(0, 80) : '',
                  it.durationMs >= 1000 ? `active ${fmtDuration(it.durationMs)}` : '',
                  it.outputTokens ? `${fmtTokens(it.outputTokens)} output tokens` : '',
                  it.files ? `${it.files} file ${it.files === 1 ? 'edit' : 'edits'}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn primary" autoFocus onClick={dismiss}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
