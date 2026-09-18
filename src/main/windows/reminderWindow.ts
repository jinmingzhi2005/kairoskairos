import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { IPC, type ReminderPayload } from '@shared/types'
import { displayById, listDisplays, primaryDisplay } from '../services/displayService'
import { currentCardState } from './calendarWindow'

const W = 420
const H = 340

let win: BrowserWindow | null = null
let payload: ReminderPayload | null = null

export function getReminderPayload(): ReminderPayload | null {
  return payload
}

export function getReminderWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

/**
 * 强提醒单独开一个小窗口，居中显示在日历所在的屏幕上。
 * 每次提醒都新建、处理完即销毁，避免残留状态。
 */
export function showReminderWindow(data: ReminderPayload): void {
  payload = data

  const displays = listDisplays()
  const card = currentCardState()
  const display = displayById(displays, card?.displayId ?? -1) ?? primaryDisplay(displays)
  const wa = display.workArea

  const x = Math.round(wa.x + (wa.width - W) / 2)
  const y = Math.round(wa.y + (wa.height - H) / 2 - 40)

  const existing = getReminderWindow()
  if (existing) existing.close()

  win = new BrowserWindow({
    x,
    y,
    width: W,
    height: H,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    acceptFirstMouse: true,
    title: 'Kairos 提醒',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  // 'screen-saver' 是 Electron 在 Windows 上能给的最高层级。
  // relativeLevel 只有 macOS 认，带上不影响 Windows。
  win.setAlwaysOnTop(true, 'screen-saver', 1)
  win.setSkipTaskbar(true)
  startTopGuard(win)

  win.on('closed', () => {
    stopTopGuard()
    win = null
    payload = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(`${devUrl}/reminder.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/reminder.html'))
  }

  win.once('ready-to-show', () => {
    win?.show()
    win?.focus()
    // focus 只能保证拿到焦点，不一定把它抬到最上面，补一次 moveTop
    win?.moveTop()
    win?.webContents.send(IPC.reminderData, payload)
  })
}

/**
 * 顶层守卫。
 *
 * 即便设了最高层级，仍然有程序会把位置抢走：全屏播放器、部分游戏、
 * 以及某些安全软件自己的置顶弹窗。弹出后的头 30 秒里每隔 1.5 秒重申一次，
 * 覆盖住绝大多数抢占场景；之后自动停止，免得长期和别的程序抢层级。
 */
let topGuard: NodeJS.Timeout | null = null

function startTopGuard(target: BrowserWindow): void {
  stopTopGuard()
  let elapsed = 0
  topGuard = setInterval(() => {
    elapsed += 1500
    if (!target || target.isDestroyed()) {
      stopTopGuard()
      return
    }
    target.setAlwaysOnTop(true, 'screen-saver', 1)
    target.moveTop()
    if (elapsed >= 30_000) stopTopGuard()
  }, 1500)
}

function stopTopGuard(): void {
  if (topGuard) clearInterval(topGuard)
  topGuard = null
}

export function closeReminderWindow(): void {
  stopTopGuard()
  const existing = getReminderWindow()
  if (existing) existing.close()
  win = null
  payload = null
}

export function focusReminderWindow(): void {
  const existing = getReminderWindow()
  if (!existing) return
  existing.show()
  existing.focus()
}
