import { useEffect, useRef, useState } from 'react'
import { AlarmClock } from 'lucide-react'

/** Time label for a scheduled item: "14:05", or "Tomorrow 08:00" / a date when not today. */
export function scheduleLabel(ts: number): string {
  const d = new Date(ts)
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const day = new Date()
  if (d.toDateString() === day.toDateString()) return t
  day.setDate(day.getDate() + 1)
  if (d.toDateString() === day.toDateString()) return `Tomorrow ${t}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${t}`
}

/** Clock button next to send: schedules the draft for a time or for when the account's limit resets. */
export default function ScheduleButton({ disabled, onPick }: { disabled?: boolean; onPick: (when: { sendAt?: number; afterReset?: boolean }) => void }) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const [time, setTime] = useState('')
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const pick = (when: { sendAt?: number; afterReset?: boolean }): void => {
    setOpen(false)
    setCustom(false)
    onPick(when)
  }
  const at = (h: number, m: number, nextDay = false): number => {
    const d = new Date()
    if (nextDay) d.setDate(d.getDate() + 1)
    d.setHours(h, m, 0, 0)
    return d.getTime()
  }
  const hours = (n: number): number => Date.now() + n * 3_600_000
  const tomorrow8 = at(8, 0, true)

  const confirmCustom = (): void => {
    const [h, m] = time.split(':').map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return
    let ts = at(h, m)
    if (ts <= Date.now()) ts = at(h, m, true)
    pick({ sendAt: ts })
  }

  return (
    <div className="sched-wrap" ref={root}>
      <button className="icon-btn" disabled={disabled} title="Schedule this message" onClick={() => setOpen(!open)}>
        <AlarmClock size={16} />
      </button>
      {open && (
        <div className="dd-menu dd-up sched-menu" role="menu">
          <button className="dd-item" onClick={() => pick({ sendAt: hours(1) })}>
            In 1 hour
          </button>
          <button className="dd-item" onClick={() => pick({ sendAt: hours(3) })}>
            In 3 hours
          </button>
          <button className="dd-item" onClick={() => pick({ sendAt: tomorrow8 })}>
            Tomorrow 08:00
          </button>
          {custom ? (
            <div className="sched-custom">
              <input
                type="time"
                autoFocus
                value={time}
                onChange={(e) => setTime(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    confirmCustom()
                  }
                }}
              />
              <button className="btn primary" disabled={!time} onClick={confirmCustom}>
                Schedule
              </button>
            </div>
          ) : (
            <button className="dd-item" onClick={() => setCustom(true)}>
              At…
            </button>
          )}
          <button className="dd-item" title="Sends once the chat account's exhausted 5-hour or weekly limit has reset (right away if it is not limited)" onClick={() => pick({ afterReset: true })}>
            When the limit resets
          </button>
        </div>
      )}
    </div>
  )
}
