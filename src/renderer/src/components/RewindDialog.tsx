import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { useStore } from '../store'

/** "Edit from here" confirmation: drops a user message and everything after it, optionally restoring files. */
export default function RewindDialog({ chatId, messageId, onClose }: { chatId: string; messageId: string; onClose: () => void }) {
  const rewindChat = useStore((s) => s.rewindChat)
  const canFiles = useStore((s) => {
    const c = s.chats[chatId]
    return !!c && !c.closed
  })
  const [files, setFiles] = useState<string[]>([])
  const [restore, setRestore] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!canFiles) return
    let alive = true
    void window.desktop.rewindFiles(chatId, messageId, true).then((r) => {
      if (alive && r.canRewind && r.filesChanged?.length) setFiles(r.filesChanged)
    })
    return () => {
      alive = false
    }
  }, [chatId, messageId, canFiles])

  const confirm = (): void => {
    if (busy) return
    setBusy(true)
    onClose()
    void rewindChat(chatId, messageId, { restoreFiles: restore && files.length > 0 })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        confirm()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  })

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal rename-modal">
        <div className="modal-head">
          <h3>Edit from here?</h3>
        </div>
        <p className="modal-text">Later messages leave this chat (the full conversation stays under Archived). The message goes back into the composer.</p>
        {files.length > 0 && (
          <button
            type="button"
            role="checkbox"
            aria-checked={restore}
            className={`rewind-check${restore ? ' on' : ''}`}
            title={files.map((f) => f.split('/').pop()).join('\n')}
            onClick={() => setRestore(!restore)}
          >
            <span className="box">{restore && <Check size={10} strokeWidth={3} />}</span>
            Also restore files ({files.length} changed)
          </button>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" autoFocus onClick={confirm}>
            Edit from here
          </button>
        </div>
      </div>
    </div>
  )
}
