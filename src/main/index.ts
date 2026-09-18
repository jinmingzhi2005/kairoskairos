import { app, BrowserWindow } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { bootstrapMain, shutdownMain } from './ipc'
import { installCrashHandlers, log } from './logger'
import { createCalendarWindow, getCalendarWindow, showCalendar } from './windows/calendarWindow'

installCrashHandlers()

const APP_ID = 'com.kairos.calendar'

/**
 * 早期版本叫 DeskBox，用户数据存在 `%APPDATA%\deskbox`。
 * 改名后 userData 目录跟着变，这里做一次性搬运（只搬 json 配置，不碰缓存），
 * 免得老用户升级后发现待办和布局全没了。
 */
function migrateLegacyData(): void {
  try {
    const current = app.getPath('userData')
    const legacy = join(app.getPath('appData'), 'deskbox')

    if (!existsSync(legacy)) return
    if (existsSync(current) && readdirSync(current).some((name) => name.endsWith('.json'))) return

    mkdirSync(current, { recursive: true })
    let copied = 0
    for (const name of readdirSync(legacy)) {
      if (!name.endsWith('.json')) continue
      copyFileSync(join(legacy, name), join(current, name))
      copied += 1
    }
    if (copied > 0) log(`已从旧版数据目录迁移 ${copied} 个配置文件`)
  } catch (error) {
    log('迁移旧数据失败（不影响新装使用）', error)
  }
}

// 无 GPU / 沙箱受限环境（虚拟机、远程桌面、CI）下兜底走软件渲染
if (process.env.KAIROS_NO_GPU === '1' || process.env.KAIROS_NO_GPU === 'true') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  console.log('[kairos] 已切换为软件渲染模式')
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setAppUserModelId(APP_ID)

  app.on('second-instance', () => {
    showCalendar()
  })

  app.whenReady().then(async () => {
    migrateLegacyData()
    log('应用已就绪，创建日历窗')
    createCalendarWindow()
    await bootstrapMain()
    log('日历提醒已启动')
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createCalendarWindow()
    else showCalendar()
  })

  app.on('window-all-closed', () => {
    // 常驻托盘：关掉窗口不等于退出
    if (!getCalendarWindow()) return
  })

  app.on('before-quit', () => {
    shutdownMain()
  })
}
