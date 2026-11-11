import { useState } from 'react'
import { ChevronRight, ChevronDown, RotateCcw } from 'lucide-react'
import type { ChatMessage } from '../reduce'
import type { PermissionRequest } from '@shared/types'
import Markdown from './Markdown'
import ToolCard from './ToolCard'
import ImageThumb from './ImageThumb'
import { dataUrl } from '../images'
import { useStore } from '../store'
import RewindDialog from './RewindDialog'

export default function MessageItem({
  chatId,
  message,
  pendingByTool,
  continuation,
  readOnly,
}: {
  chatId: string
  message: ChatMessage
  pendingByTool: Map<string, PermissionRequest>
  continuation?: boolean
  /** Subagent transcript view: no controls that act on the parent chat. */
  readOnly?: boolean
}) {
  if (message.role === 'divider') {
    return <div className="divider">{message.label}</div>
  }
  if (message.role === 'user') return <UserMessage chatId={chatId} message={message} readOnly={readOnly} />
  if (message.compactSummary) {
    return (
      <div className="msg local">
        <details className="local-out summary-card">
          <summary>Summary of the earlier conversation</summary>
          {message.blocks.map((b, i) => (b.kind === 'text' && b.text ? <Markdown key={i} text={b.text} /> : null))}
        </details>
      </div>
    )
  }
  if (message.local) {
    return (
      <div className="msg local">
        <div className="local-out">
          {message.blocks.map((b, i) => (b.kind === 'text' && b.text ? <Markdown key={i} text={b.text} /> : null))}
        </div>
      </div>
    )
  }
  // Nothing to show (e.g. empty reasoning from Codex): render nothing instead of an empty, padded row.
  if (!message.blocks.some((b) => b.kind === 'tool_use' || ((b.kind === 'text' || b.kind === 'thinking') && b.text))) return null
  return (
    <div className={`msg assistant ${continuation ? 'cont' : ''}`}>
      <div className="avatar">✦</div>
      <div className="content">
        {message.blocks.map((b, i) => {
          if (b.kind === 'text') return b.text ? <Markdown key={i} text={b.text} streaming={message.streaming} /> : null
          if (b.kind === 'thinking') return b.text ? <Thinking key={i} text={b.text} /> : null
          if (b.kind === 'tool_use') return <ToolCard key={b.id} chatId={chatId} block={b} pending={pendingByTool.get(b.id)} readOnly={readOnly} />
          return null
        })}
      </div>
    </div>
  )
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="thinking">
      <button className="thinking-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Thinking
      </button>
      {open && <div className="thinking-body">{text}</div>}
    </div>
  )
}

function UserMessage({ chatId, message, readOnly }: { chatId: string; message: ChatMessage; readOnly?: boolean }) {
  const [rewinding, setRewinding] = useState(false)
  // Claude chats only (Codex has no checkpoints to fork at), not while a turn runs.
  const canEdit = useStore((s) => {
    const c = s.chats[chatId]
    return !!c && c.engine !== 'codex' && !!c.sessionId && c.status !== 'running' && c.status !== 'compacting'
  })
  const images = message.blocks.filter((b) => b.kind === 'image')
  return (
    <div className="msg user">
      {!readOnly && canEdit && (
        <button className="msg-edit" title="Edit from here" aria-label="Edit from here" onClick={() => setRewinding(true)}>
          <RotateCcw size={13} />
        </button>
      )}
      <div className="bubble">
        {images.length > 0 && (
          <div className="bubble-images">
            {images.map((b, i) => (b.kind === 'image' ? <ImageThumb key={i} src={dataUrl(b.mediaType, b.data)} /> : null))}
          </div>
        )}
        {message.blocks.map((b, i) => (b.kind === 'text' ? <Markdown key={i} text={b.text} files /> : null))}
      </div>
      {rewinding && <RewindDialog chatId={chatId} messageId={message.id} onClose={() => setRewinding(false)} />}
    </div>
  )
}
