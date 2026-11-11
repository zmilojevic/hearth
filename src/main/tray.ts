import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resourceFile } from './resources'

interface TrayDeps {
  getWindow: () => BrowserWindow | null
  createWindow: () => void
  quit: () => void
  log: (s: string) => void
  emit: (channel: string, payload: unknown) => void
}

const onHyprland = (): boolean => !!process.env.HYPRLAND_INSTANCE_SIGNATURE
const dryRun = (): boolean => process.env.CCD_TRAY_DRY_RUN === '1'

function hyprctl(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('hyprctl', args, { timeout: 1500 }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })
}

/** Raises our window on Hyprland (switching to its workspace), else the plain Electron way. */
export async function focusWindow(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  if (onHyprland()) {
    const lua = `hl.dsp.focus({ window = (function() for _,w in ipairs(hl.get_windows()) do if w.pid == ${process.pid} then return w end end end)() })`
    try {
      if ((await hyprctl(['dispatch', lua])).trim() === 'ok') return
    } catch {
      /* try the classic form */
    }
    try {
      if ((await hyprctl(['dispatch', 'focuswindow', `pid:${process.pid}`])).trim() === 'ok') return
    } catch {
      /* fall through */
    }
  }
  win.show()
  win.focus()
}

/** Workspace ids of our window and the active workspace, or null when hyprctl cannot tell. */
async function hyprWorkspaces(): Promise<{ ours: number; active: number } | null> {
  if (!onHyprland()) return null
  try {
    const clients = JSON.parse(await hyprctl(['clients', '-j'])) as { pid: number; mapped?: boolean; workspace?: { id: number } }[]
    const mine = clients.find((c) => c.pid === process.pid && c.mapped !== false)
    const active = JSON.parse(await hyprctl(['activeworkspace', '-j'])) as { id: number }
    if (!mine?.workspace || typeof active?.id !== 'number') return null
    return { ours: mine.workspace.id, active: active.id }
  } catch {
    return null
  }
}

/** Draws an anti-aliased dot with a transparent ring into the bottom-right corner of a BGRA bitmap (returns a copy). */
export function drawBadge(buf: Buffer, w: number, h: number, rgb: [number, number, number]): Buffer {
  const out = Buffer.from(buf)
  const r = (w * 0.44) / 2
  const ring = Math.max(1, Math.round(w / 16))
  const cx = w - r
  const cy = h - r
  const outer = r + ring
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      if (d > outer + 0.5) continue
      const i = (y * w + x) * 4
      // Clear the icon under the ring, fading out at its edge.
      const keep = Math.min(1, Math.max(0, d - outer + 0.5))
      if (keep < 1) {
        for (let k = 0; k < 4; k++) out[i + k] = Math.round(out[i + k] * keep)
      }
      const cover = Math.min(1, Math.max(0, r - d + 0.5))
      if (cover > 0) {
        const a = out[i + 3] / 255
        const na = cover + a * (1 - cover)
        const mix = (c: number, o: number): number => Math.round((c * cover + o * a * (1 - cover)) / na)
        out[i] = mix(rgb[2], out[i])
        out[i + 1] = mix(rgb[1], out[i + 1])
        out[i + 2] = mix(rgb[0], out[i + 2])
        out[i + 3] = Math.round(na * 255)
      }
    }
  }
  return out
}

const BADGE_COLORS = { ask: [0x5b, 0x8f, 0xd0], done: [0x4f, 0xae, 0x73] } as const
const BADGE_TIPS = { ask: 'Hearth \u2014 needs your input', done: 'Hearth \u2014 finished' }
let applyBadge: ((state: 'ask' | 'done' | null) => void) | null = null

/** Shows a coloured dot on the tray icon (blue = needs input, green = finished); null = plain icon. */
export function setTrayBadge(state: 'ask' | 'done' | null): void {
  applyBadge?.(state)
}

export function setupTray(deps: TrayDeps): Tray | null {
  const { getWindow, createWindow, quit, log, emit } = deps
  let tray: Tray
  let base: Electron.NativeImage
  try {
    const load = (name: string): Electron.NativeImage => {
      const p = resourceFile(name)
      return existsSync(p) ? nativeImage.createFromPath(p) : nativeImage.createEmpty()
    }
    let img: Electron.NativeImage
    if (process.platform === 'darwin') {
      img = load('trayTemplate.png')
      if (img.isEmpty()) {
        img = load('icon.png')
        if (!img.isEmpty()) img = img.resize({ width: 18, height: 18 })
      } else {
        img.setTemplateImage(true)
      }
    } else {
      img = load('icon.png')
      const size = process.platform === 'win32' ? 16 : 32
      if (!img.isEmpty()) img = img.resize({ width: size, height: size })
    }
    base = img
    tray = new Tray(img)
  } catch (err) {
    log(`tray: unavailable: ${String(err)}`)
    return null
  }
  tray.setToolTip('Hearth')

  const badged = new Map<'ask' | 'done', Electron.NativeImage>()
  let current: 'ask' | 'done' | null = null
  applyBadge = (state) => {
    if (state === current) return
    current = state
    try {
      tray.setToolTip(state ? BADGE_TIPS[state] : 'Hearth')
      if (process.platform === 'darwin') {
        tray.setTitle(state ? '\u25cf' : '')
        return
      }
      if (!state || base.isEmpty()) {
        tray.setImage(base)
        return
      }
      let img = badged.get(state)
      if (!img) {
        const { width, height } = base.getSize()
        img = nativeImage.createFromBitmap(drawBadge(base.toBitmap(), width, height, [...BADGE_COLORS[state]]), { width, height })
        badged.set(state, img)
      }
      tray.setImage(img)
    } catch (err) {
      log(`tray: badge failed: ${String(err)}`)
    }
  }

  const show = async (): Promise<BrowserWindow | null> => {
    let win = getWindow()
    if (!win || win.isDestroyed()) {
      createWindow()
      win = getWindow()
    }
    if (win) await focusWindow(win)
    return win
  }

  const toggle = async (): Promise<void> => {
    const win = getWindow()
    if (!win || win.isDestroyed()) {
      log('tray: action=show (no window)')
      if (!dryRun()) await show()
      return
    }
    let action: 'show' | 'hide' | 'focus'
    let info = ''
    if (!win.isVisible() || win.isMinimized()) {
      action = 'show'
    } else {
      const ws = await hyprWorkspaces()
      if (ws) {
        action = ws.ours === ws.active ? 'hide' : 'focus'
        info = ` ws=${ws.ours} active=${ws.active}`
      } else {
        action = win.isFocused() ? 'hide' : 'focus'
      }
    }
    log(`tray: action=${action}${info}${dryRun() ? ' (dry run)' : ''}`)
    if (dryRun()) return
    if (action === 'hide') win.hide()
    else await focusWindow(win)
  }

  tray.on('click', () => void toggle())
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show / hide', click: () => void toggle() },
      {
        label: 'New chat',
        click: () => {
          void show().then((w) => {
            if (w) emit('tray:newChat', null)
          })
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: quit },
    ]),
  )
  return tray
}
