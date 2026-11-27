import { useEffect, useRef, type RefObject } from 'react'

const THRESHOLD = 70
const MAX = 110
const RESISTANCE = 0.5

// Pull-to-refresh for a scroll element (phone list screen). Touch-driven, DOM-direct (no React state while
// pulling): sets --ptr (px) on the scroll element's parent and toggles data-ptr="pull|ready|spin|back".
// Release past the threshold reloads the page. Must not import mobile/shim.
export function usePullToRefresh(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  const busy = useRef(false)
  useEffect(() => {
    const el = ref.current
    const host = el?.parentElement
    if (!enabled || !el || !host) return
    let y0 = 0
    let x0 = 0
    let tracking = false
    let pulling = false
    let dist = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const clear = (): void => {
      host.style.removeProperty('--ptr')
      host.style.removeProperty('--ptr-p')
      host.style.removeProperty('--ptr-top')
      delete host.dataset.ptr
    }
    const set = (d: number, state: string): void => {
      dist = d
      host.style.setProperty('--ptr', `${d}px`)
      host.style.setProperty('--ptr-top', `${el.offsetTop}px`)
      host.style.setProperty('--ptr-p', String(Math.min(1, d / THRESHOLD)))
      host.dataset.ptr = state
    }
    const reset = (): void => {
      tracking = pulling = false
      if (busy.current) return
      if (dist > 0) {
        set(0, 'back')
        timer = setTimeout(clear, 200)
      }
    }
    const onStart = (e: TouchEvent): void => {
      tracking = false
      pulling = false
      if (timer) { clearTimeout(timer); timer = undefined; clear() }
      if (busy.current || e.touches.length !== 1 || el.scrollTop > 0) return
      tracking = true
      y0 = e.touches[0].clientY
      x0 = e.touches[0].clientX
    }
    const onMove = (e: TouchEvent): void => {
      if (!tracking) return
      if (e.touches.length !== 1) return reset()
      const dy = e.touches[0].clientY - y0
      const dx = e.touches[0].clientX - x0
      if (!pulling) {
        if (dy < 0 || el.scrollTop > 0) { tracking = false; return }
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) { tracking = false; return }
        if (dy < 6) return
        pulling = true
      }
      if (e.cancelable) e.preventDefault()
      const d = Math.min(MAX, Math.max(0, dy * RESISTANCE))
      set(d, d >= THRESHOLD ? 'ready' : 'pull')
    }
    const onEnd = (): void => {
      if (!pulling) { tracking = false; return }
      if (dist >= THRESHOLD) {
        busy.current = true
        tracking = pulling = false
        set(THRESHOLD, 'spin')
        window.location.reload()
      } else reset()
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', reset, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', reset)
      if (timer) clearTimeout(timer)
      clear()
    }
  }, [ref, enabled])
}
