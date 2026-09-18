import { app, dialog, globalShortcut, ipcMain, nativeTheme, Notification, screen } from 'electron'
import type { ReminderAction } from '@shared/api'
import {
  CARD_DEFAULT_H,
  CARD_DEFAULT_W,
  IPC,
  type FireMode,
  type ThemeMode,
  type AppSettings,
  type ReminderPayload,
  type RuntimeState
} from '@shared/types'
import { getAutoStart, setAutoStart } from './services/autostart'
import {
  addSource,
  applySyncInterval,
  detectOutlook,
  disposeSync,
  eventsInRange,
  getSyncState,
  initCalendarSync,
  refreshAll,
  refreshSource,
  removeSource,
  toggleSource
} from './services/calendarSync'
import { listDisplays } from './services/displayService'
import { getSettings, patchSettings } from './services/settingsService'
import {
  addTodo,
  disposeTodos,
  initTodos,
  listTodos,
  removeTodo,
  snoozeTodo,
  toggleTodo,
  updateTodo
} from './services/todoService'
import { createTray, destroyTray, refreshTray, type TrayCallbacks } from './tray'
import { log } from './logger'
import {
  applyCalendarMode,
  calendarVisibilityListener,
  currentCardState,
  getCalendarWindow,
  healCalendarWindow,
  hideCalendar,
  persistCardState,
  resetCalendarPosition,
  setCalendarBounds,
  showCalendar,
  toggleCalendarVisible
} from './windows/calendarWindow'
import {
  closeReminderWindow,
  getReminderPayload,
  showReminderWindow
} from './windows/reminderWindow'

const runtime: RuntimeState = {
  autoStart: false,
  packaged: app.isPackaged
}

/** 当前正在提醒的待办 id，供强提醒窗口的「稍后 / 完成」回调用 */
let lastReminderId: string | null = null

/** 「测试一次强提醒」用的占位 id：它没有对应待办，操作时不能去动真实数据 */
const TEST_REMINDER_ID = '__test__'

/**
 * 主题。
 * 直接设 nativeTheme.themeSource —— Chromium 会据此改变 `prefers-color-scheme`，
 * 渲染层只用一条 CSS 媒体查询就能跟随，不需要额外的 IPC 往返。
 */
function applyTheme(mode: ThemeMode): void {
  nativeTheme.themeSource = mode === 'system' ? 'system' : mode
  log(`主题：${mode === 'system' ? `跟随系统（当前${nativeTheme.shouldUseDarkColors ? '深色' : '浅色'}）` : mode}`)
}

function calendarWin() {
  return getCalendarWindow()
}

function sendToCalendar(channel: string, payload?: unknown): void {
  calendarWin()?.webContents.send(channel, payload)
}

function syncRuntime(): void {
  runtime.autoStart = app.isPackaged ? getAutoStart() : getSettings().autoStart
  sendToCalendar(IPC.runtimeChanged, { ...runtime })
}

const trayCallbacks: TrayCallbacks = {
  isCalendarVisible: () => calendarWin()?.isVisible() ?? false,
  isAutoStart: () => runtime.autoStart,
  onToggleCalendar: () => {
    toggleCalendarVisible()
    refreshTray(trayCallbacks)
  },
  onToggleAutoStart: () => applyAutoStart(!runtime.autoStart),
  onTestReminder: () => {
    const now = new Date()
    const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`)
    // 必须覆盖 lastReminderId：否则用户在测试弹窗点「完成」，会去改上一次真实提醒的那条待办
    lastReminderId = TEST_REMINDER_ID
    showReminderWindow({
      id: TEST_REMINDER_ID,
      title: '这是一条测试提醒',
      date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      time: `${pad(now.getHours())}:${pad(now.getMinutes())}`
    })
  },
  onResetPosition: () => {
    resetCalendarPosition()
    sendToCalendar(IPC.displaysChanged, listDisplays())
  },
  onQuit: () => app.quit()
}

export function applyAutoStart(on: boolean): void {
  setAutoStart(on)
  patchSettings({ autoStart: on })
  runtime.autoStart = app.isPackaged ? getAutoStart() : on
  refreshTray(trayCallbacks)
  syncRuntime()
  sendToCalendar(
    IPC.uiToast,
    on ? '已开启开机自启，日历与提醒会随登录一起启动' : '已关闭开机自启，关闭后到点提醒可能收不到'
  )
}

export function registerIpc(): void {
  ipcMain.handle(IPC.settingsGet, () => getSettings())
  ipcMain.handle(IPC.settingsPatch, (_e, patch: Partial<AppSettings>) => {
    const next = patchSettings(patch)
    refreshTray(trayCallbacks)
    if (patch.syncIntervalMinutes !== undefined) applySyncInterval(next.syncIntervalMinutes)
    if (patch.calendarMode !== undefined) applyCalendarMode(next.calendarMode)
    if (patch.theme !== undefined) applyTheme(next.theme)
    return next
  })
  ipcMain.handle(IPC.runtimeGet, () => ({ ...runtime }))

  ipcMain.handle(IPC.autostartSet, (_e, on: boolean) => {
    applyAutoStart(on)
    return on
  })

  ipcMain.handle(IPC.todoList, () => listTodos())
  ipcMain.handle(IPC.todoAdd, (_e, input: Parameters<typeof addTodo>[0]) => addTodo(input))
  ipcMain.handle(IPC.todoToggle, (_e, id: string) => toggleTodo(id))
  ipcMain.handle(IPC.todoRemove, (_e, id: string) => removeTodo(id))
  ipcMain.handle(IPC.todoSnooze, (_e, id: string, minutes: number) => snoozeTodo(id, minutes))
  ipcMain.handle(IPC.todoUpdate, (_e, id: string, patch: Parameters<typeof updateTodo>[1]) =>
    updateTodo(id, patch)
  )

  ipcMain.on(IPC.reminderTest, () => trayCallbacks.onTestReminder())
  ipcMain.on(IPC.reminderAction, (_e, action: ReminderAction) => {
    const settings = getSettings()
    const id = currentReminderId()

    // 测试提醒没有对应待办：作答式反馈，但绝不碰真实数据
    if (!id || id === TEST_REMINDER_ID) {
      sendToCalendar(
        IPC.uiToast,
        action === 'snooze' ? '测试提醒：稍后动作不会真的生效' : '测试提醒已确认，未改动任何待办'
      )
      closeReminderWindow()
      return
    }

    if (action === 'snooze') {
      snoozeTodo(id, settings.snoozeMinutes)
      sendToCalendar(IPC.uiToast, `好的，${settings.snoozeMinutes} 分钟后再提醒你`)
    } else {
      toggleTodo(id)
      sendToCalendar(IPC.uiToast, '已标记完成')
    }
    closeReminderWindow()
    sendToCalendar(IPC.todosChanged)
  })

  ipcMain.handle(IPC.reminderData, () => getReminderPayload())

  /* ---------- 电脑日历同步 ---------- */
  ipcMain.handle(IPC.syncState, () => getSyncState())
  ipcMain.handle(IPC.syncEvents, (_e, from: string, to: string) => eventsInRange(from, to))
  ipcMain.handle(IPC.syncRefresh, (_e, id?: string) => (id ? refreshSource(id) : refreshAll()))
  ipcMain.handle(IPC.syncToggle, (_e, id: string, enabled: boolean) => toggleSource(id, enabled))
  ipcMain.handle(IPC.syncRemove, (_e, id: string) => removeSource(id))

  ipcMain.handle(IPC.syncAddUrl, (_e, url: string, label?: string) => {
    const result = addSource('ics-url', url, label)
    if (result.error) return { error: result.error }
    return { state: getSyncState() }
  })

  ipcMain.handle(IPC.syncAddFile, async () => {
    const win = calendarWin()
    const picked = win
      ? await dialog.showOpenDialog(win, {
          title: '选择日历文件',
          filters: [{ name: '日历文件', extensions: ['ics', 'ical', 'ifb'] }],
          properties: ['openFile']
        })
      : await dialog.showOpenDialog({
          title: '选择日历文件',
          filters: [{ name: '日历文件', extensions: ['ics', 'ical', 'ifb'] }],
          properties: ['openFile']
        })

    if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }

    const result = addSource('ics-file', picked.filePaths[0])
    if (result.error) return { error: result.error }
    return { state: getSyncState() }
  })

  ipcMain.handle(IPC.syncAddOutlook, async () => {
    const available = await detectOutlook()
    if (!available) {
      return {
        error: '没有检测到可用的 Outlook 桌面版。如果用的是网页版或 Click-to-Run 安装，可以在 Outlook 里把日历「发布」成 .ics 链接，再用订阅方式添加。'
      }
    }
    const result = addSource('outlook', '')
    if (result.error) return { error: result.error }
    return { state: getSyncState() }
  })

  ipcMain.handle(IPC.windowBounds, () => {
    const bounds = calendarWin()?.getBounds() ?? {
      x: 0,
      y: 0,
      width: CARD_DEFAULT_W,
      height: CARD_DEFAULT_H
    }
    return { ...bounds, displays: listDisplays() }
  })
  ipcMain.on(IPC.windowSetBounds, (_e, next: { x?: number; y?: number; width?: number; height?: number }) => {
    setCalendarBounds(next)
  })
  ipcMain.on(IPC.windowHide, () => hideCalendar())

  ipcMain.on(IPC.appQuit, () => app.quit())
}

function currentReminderId(): string | null {
  return lastReminderId
}

function onReminder(payload: ReminderPayload, mode: FireMode): void {
  if (mode === 'strong') {
    // 只有强提醒窗口上才有「稍后 / 完成」按钮，所以只有它需要记 id
    lastReminderId = payload.id
    showReminderWindow(payload)
    return
  }

  // 系统通知通道：走 Windows 原生通知（打包后生效），同时让日历窗刷新状态
  if (app.isPackaged && Notification.isSupported()) {
    new Notification({
      title: `${payload.time} · 待办提醒`,
      body: payload.title,
      silent: false
    }).show()
  }
  sendToCalendar(IPC.reminderFired, payload)
  sendToCalendar(IPC.todosChanged)
}

export async function bootstrapMain(): Promise<void> {
  const settings = getSettings()

  if (app.isPackaged) {
    runtime.autoStart = getAutoStart()
    // 首次安装要把「默认开机自启」真正写进系统登录项
    if (settings.autoStart && !runtime.autoStart) {
      setAutoStart(true)
      runtime.autoStart = getAutoStart()
      log(`已注册开机自启（登录项：${runtime.autoStart}）`)
    } else if (!settings.autoStart && runtime.autoStart) {
      setAutoStart(false)
      runtime.autoStart = false
    }
  } else {
    runtime.autoStart = settings.autoStart
  }

  // 窗口创建前先把主题定好，避免启动瞬间闪一下浅色
  applyTheme(settings.theme)

  registerIpc()
  createTray(trayCallbacks)
  initTodos(onReminder)
  initCalendarSync(() => sendToCalendar(IPC.syncChanged, getSyncState()))
  applySyncInterval(settings.syncIntervalMinutes)

  calendarVisibilityListener(() => refreshTray(trayCallbacks))

  for (const [accel, handler] of [
    ['Alt+Space', () => showCalendar()],
    ['Control+Alt+C', () => {
      toggleCalendarVisible()
      refreshTray(trayCallbacks)
    }]
  ] as Array<[string, () => void]>) {
    if (!globalShortcut.register(accel, handler)) log(`全局热键注册失败：${accel}`)
  }

  const card = currentCardState()
  log(`日历窗已就绪：${card ? `${card.w}x${card.h} @${card.x},${card.y}` : '未知位置'}`)

  // 显示器变化：把日历拉回可见区域并通知渲染层
  const onDisplayChange = (): void => {
    setTimeout(() => {
      healCalendarWindow()
      persistCardState()
      sendToCalendar(IPC.displaysChanged, listDisplays())
    }, 400)
  }
  screen.on('display-added', onDisplayChange)
  screen.on('display-removed', onDisplayChange)
  screen.on('display-metrics-changed', onDisplayChange)
}

export function shutdownMain(): void {
  globalShortcut.unregisterAll()
  destroyTray()
  disposeTodos()
  disposeSync()
}
