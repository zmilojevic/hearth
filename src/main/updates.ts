import { app, net } from 'electron'
import type { UpdateInfo, UpdateProgress } from '../shared/types'

const URL = 'https://api.github.com/repos/zmilojevic/hearth/releases/latest'
const TTL = 6 * 60 * 60 * 1000

let cache: { at: number; info: UpdateInfo } | null = null

const FEED = process.env.CCD_UPDATE_FEED || ''

/** In-app install: packaged Windows (NSIS) / Linux AppImage, or the CCD_UPDATE_FEED test hook on any packaged build. */
function canInstall(): boolean {
  if (!app.isPackaged) return false
  if (FEED) return true
  return process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE)
}

// electron-updater is CJS and only loaded when an install path is actually used.
type Updater = typeof import('electron-updater').autoUpdater
let updater: Updater | null = null
async function getUpdater(): Promise<Updater> {
  if (updater) return updater
  const mod = await import('electron-updater')
  const u = (mod.autoUpdater ?? (mod as unknown as { default: { autoUpdater: Updater } }).default.autoUpdater) as Updater
  u.autoDownload = false
  u.autoInstallOnAppQuit = true
  u.logger = {
    info: (m?: unknown) => console.log('update:', m),
    warn: (m?: unknown) => console.warn('update:', m),
    error: (m?: unknown) => console.error('update:', m),
    debug: (m?: unknown) => console.log('update:', m),
  }
  if (FEED) u.setFeedURL({ provider: 'generic', url: FEED })
  updater = u
  return u
}

let progress: UpdateProgress | null = null
let downloading = false

function parts(v: string): number[] {
  return v
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .slice(0, 3)
    .map((n) => parseInt(n, 10) || 0)
}

function isNewer(latest: string, current: string): boolean {
  const a = parts(latest)
  const b = parts(current)
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/** Looks up the latest GitHub release; never throws, only successful answers are cached (6 h). */
export async function checkUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion()
  const install = canInstall()
  if (FEED && install) {
    try {
      const r = await (await getUpdater()).checkForUpdates()
      const latest = r?.updateInfo.version
      return { current, latest, newer: !!latest && isNewer(latest, current), canInstall: true }
    } catch (e) {
      return { current, newer: false, canInstall: true, error: e instanceof Error ? e.message : String(e) }
    }
  }
  if (cache && Date.now() - cache.at < TTL) return { ...cache.info, current, canInstall: install }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 10_000)
  try {
    const res = await net.fetch(URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Hearth/${current}` },
      signal: ctl.signal,
    })
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const j = (await res.json()) as { tag_name?: string; html_url?: string }
    if (!j.tag_name) throw new Error('No release found')
    const latest = j.tag_name.replace(/^v/i, '')
    const info: UpdateInfo = { current, latest, url: j.html_url, newer: isNewer(latest, current), canInstall: install }
    cache = { at: Date.now(), info }
    return info
  } catch (e) {
    return { current, newer: false, canInstall: install, error: ctl.signal.aborted ? 'Timed out' : e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}

/** Downloads the update found by a fresh check; progress goes through `emit`. Never throws. */
export async function downloadUpdate(emit: (p: UpdateProgress) => void): Promise<void> {
  const send = (p: UpdateProgress): void => {
    progress = p
    emit(p)
  }
  if (progress?.state === 'ready' || downloading) {
    if (progress) emit(progress)
    return
  }
  if (!canInstall()) return send({ state: 'error', error: 'In-app updates are not supported here' })
  downloading = true
  try {
    const u = await getUpdater()
    const r = await u.checkForUpdates()
    if (!r || !r.isUpdateAvailable || !isNewer(r.updateInfo.version, app.getVersion())) {
      return send({ state: 'error', error: 'No installable update found' })
    }
    send({ state: 'downloading', percent: 0 })
    let last = -1
    const onProgress = (p: { percent: number }): void => {
      const pct = Math.floor(p.percent)
      if (pct === last) return
      last = pct
      send({ state: 'downloading', percent: pct })
    }
    u.on('download-progress', onProgress)
    try {
      await u.downloadUpdate()
      send({ state: 'ready' })
    } finally {
      u.removeListener('download-progress', onProgress)
    }
  } catch (e) {
    send({ state: 'error', error: e instanceof Error ? e.message : String(e) })
  } finally {
    downloading = false
  }
}

/** Quits, runs the silent installer and relaunches. */
export function installUpdate(): void {
  void getUpdater().then((u) => u.quitAndInstall(true, true))
}
