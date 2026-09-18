import { app, Menu, nativeImage, Tray } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { log } from './logger'

let tray: Tray | null = null

function resourcesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icons') : join(app.getAppPath(), 'resources', 'icons')
}

function imageOf(name: string): Electron.NativeImage {
  const file = join(resourcesDir(), name)
  if (existsSync(file)) return nativeImage.createFromPath(file)
  return nativeImage.createEmpty()
}

export interface TrayCallbacks {
  isCalendarVisible: () => boolean
  isAutoStart: () => boolean
  onToggleCalendar: () => void
  onToggleAutoStart: () => void
  onTestReminder: () => void
  onResetPosition: () => void
  onQuit: () => void
}

export function createTray(cb: TrayCallbacks): Tray | null {
  try {
    const icon = imageOf('tray.png')
    if (icon.isEmpty()) {
      log('托盘图标未找到，跳过托盘创建')
      return null
    }
    tray = new Tray(icon)
    tray.setToolTip('日历提醒')
    refreshTray(cb)
    tray.on('click', () => cb.onToggleCalendar())
    return tray
  } catch (error) {
    log('创建托盘失败，继续以无托盘模式运行', error)
    tray = null
    return null
  }
}

export function refreshTray(cb: TrayCallbacks): void {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '日历提醒', enabled: false },
      { type: 'separator' },
      {
        label: '显示日历',
        type: 'checkbox',
        checked: cb.isCalendarVisible(),
        click: () => cb.onToggleCalendar()
      },
      {
        label: '开机自启',
        type: 'checkbox',
        checked: cb.isAutoStart(),
        click: () => cb.onToggleAutoStart()
      },
      { type: 'separator' },
      { label: '测试一次强提醒', click: () => cb.onTestReminder() },
      { label: '把日历摆回右上角', click: () => cb.onResetPosition() },
      { type: 'separator' },
      { label: '退出', click: () => cb.onQuit() }
    ])
  )
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
