import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import {
  CARD_DEFAULT_H,
  CARD_DEFAULT_W,
  CARD_MIN_H,
  CARD_MIN_W,
  type CalendarMode,
  type CardState,
  type Rect
} from '@shared/types'
import { getCardState, saveCardState } from '../services/cardStore'
import { displayById, displayIdAt, listDisplays, primaryDisplay } from '../services/displayService'
import { getSettings } from '../services/settingsService'
import { pushWindowToBottom } from '../services/win32'
import { log } from '../logger'

const SNAP = 8

let win: BrowserWindow | null = null
let card: CardState | null = null
let saveTimer: NodeJS.Timeout | null = null

/**
 * 日历窗的层级策略。
 * - `desktop`：贴着桌面。不置顶，失焦后用系统接口压到 Z 序底部，
 *   于是它只在你看桌面的时候出现，不会压在工作窗口上面。
 * - `floating`：老行为，始终浮在所有窗口最上方。
 */
let mode: CalendarMode = 'desktop'

/** 按当前模式设置窗口层级（不改变可见性） */
function applyTopLevel(): void {
  const w = getCalendarWindow()
  if (!w) return
  if (mode === 'floating') {
    w.setAlwaysOnTop(true, 'floating')
    return
  }
  w.setAlwaysOnTop(false)
  pushWindowToBottom(w)
}

/**
 * Windows 上无边框透明窗口的实际尺寸会和请求值差几个像素（系统加的不可见边框）。
 * 如果不补偿，每次拖拽缩放都会多长/少长几个像素，几次下来就明显跑偏。
 * 这里在创建时测一次偏移量，之后所有 setBounds 都减去它，
 * 对外（渲染层 / 配置）一律只暴露「名义几何」，保持干净。
 */
let compensate = { x: 0, y: 0, width: 0, height: 0 }

function clampCompensation(value: number): number {
  return Math.max(-8, Math.min(8, Math.round(value)))
}

function measureCompensation(intended: { x: number; y: number; width: number; height: number }): void {
  const w = getCalendarWindow()
  if (!w) return
  const actual = w.getBounds()
  compensate = {
    x: clampCompensation(actual.x - intended.x),
    y: clampCompensation(actual.y - intended.y),
    width: clampCompensation(actual.width - intended.width),
    height: clampCompensation(actual.height - intended.height)
  }
  if (compensate.x || compensate.y || compensate.width || compensate.height) {
    log(`窗口尺寸补偿量：${JSON.stringify(compensate)}`)
  }
}

/** 名义几何 = 实际 bounds 去掉系统补偿 */
function intendedBounds(): Rect {
  const w = getCalendarWindow()
  const actual = w
    ? w.getBounds()
    : { x: 0, y: 0, width: CARD_DEFAULT_W, height: CARD_DEFAULT_H }
  return {
    x: actual.x - compensate.x,
    y: actual.y - compensate.y,
    width: actual.width - compensate.width,
    height: actual.height - compensate.height
  }
}

/**
 * 可见性变化回调。托盘的「显示日历」勾选状态是构建菜单那一刻的快照，
 * 所以任何改变可见性的入口（热键、二次启动、渲染层隐藏）都得通知托盘重建菜单，
 * 否则勾选状态会和实际不一致。
 */
let visibilityListener: (() => void) | null = null

export function calendarVisibilityListener(fn: (() => void) | null): void {
  visibilityListener = fn
}

function notifyVisibility(): void {
  visibilityListener?.()
}

export function getCalendarWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

export function currentCardState(): CardState | null {
  return card
}

function snapTo(value: number, targets: number[]): number {
  for (const target of targets) {
    if (Math.abs(value - target) <= SNAP) return target
  }
  return value
}

/** 把窗口当前的真实 bounds 写回配置，并重新判定所属屏幕 */
export function persistCardState(): CardState | null {
  const w = getCalendarWindow()
  if (!w || !card) return null
  const bounds = intendedBounds()
  const displays = listDisplays()
  card = {
    ...card,
    x: bounds.x,
    y: bounds.y,
    w: bounds.width,
    h: bounds.height,
    displayId: displayIdAt(displays, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  }
  return saveCardState(card)
}

function persistSoon(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    persistCardState()
  }, 400)
}

export function createCalendarWindow(): BrowserWindow {
  const displays = listDisplays()
  card = getCardState(displays)
  // 先按设置定好层级策略再建窗口 —— 创建参数里就要用到 mode
  mode = getSettings().calendarMode

  win = new BrowserWindow({
    x: card.x,
    y: card.y,
    width: card.w,
    height: card.h,
    minWidth: CARD_MIN_W,
    minHeight: CARD_MIN_H,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    // 必须关闭原生缩放：Windows 上无边框窗口若 resizable=true，
    // 系统会加一圈不可见缩放边框，getBounds/setBounds 会多出 3px、y 偏 1px，
    // 导致拖拽缩放的几何计算对不上。缩放完全由渲染层的 8 个把手 + setBounds 完成。
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // 初始按当前模式设定；桌面模式下它就是个普通窗口，会被别的程序盖住
    alwaysOnTop: mode === 'floating',
    acceptFirstMouse: true,
    title: 'Kairos · 日历',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  })

  applyTopLevel()
  win.setSkipTaskbar(true)

  win.once('ready-to-show', () => {
    win?.showInactive()
    // 桌面模式下要主动压一次底，否则刚起来时它会盖在别人上面
    if (mode === 'desktop' && win) pushWindowToBottom(win)
  })

  // 桌面模式的核心：一旦失焦（用户去看别的程序了），就沉回最底层。
  // 用户再点它时它自然浮上来，交互上很自然。
  win.on('blur', () => {
    if (mode === 'desktop' && win) pushWindowToBottom(win)
  })

  win.on('moved', persistSoon)
  win.on('resized', persistSoon)
  win.on('closed', () => {
    win = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  measureCompensation({ x: card.x, y: card.y, width: card.w, height: card.h })

  return win
}

/** 渲染层调整大小/位置时调用；主进程负责最小尺寸约束与工作区边缘吸附 */
export function setCalendarBounds(next: Partial<Rect>): CardState | null {
  const w = getCalendarWindow()
  if (!w || !card) return null

  const current = intendedBounds()
  const displays = listDisplays()
  const display = displayById(displays, card.displayId) ?? primaryDisplay(displays)
  const wa = display.workArea

  const width = Math.max(CARD_MIN_W, Math.round(next.width ?? current.width))
  const height = Math.max(CARD_MIN_H, Math.round(next.height ?? current.height))

  let x = Math.round(next.x ?? current.x)
  let y = Math.round(next.y ?? current.y)

  x = snapTo(x, [wa.x, wa.x + wa.width - width])
  y = snapTo(y, [wa.y, wa.y + wa.height - height])

  w.setBounds({
    x: x - compensate.x,
    y: y - compensate.y,
    width: width - compensate.width,
    height: height - compensate.height
  })
  return persistCardState()
}

/** 显示器变化后把窗口拉回可见区域 */
export function healCalendarWindow(): void {
  const w = getCalendarWindow()
  if (!w || !card) return
  const displays = listDisplays()
  card = getCardState(displays)
  w.setBounds({
    x: card.x - compensate.x,
    y: card.y - compensate.y,
    width: card.w - compensate.width,
    height: card.h - compensate.height
  })
  log(`日历窗已重新定位到 ${card.x},${card.y} ${card.w}x${card.h}`)
}

export function toggleCalendarVisible(): boolean {
  const w = getCalendarWindow()
  if (!w) return false
  if (w.isVisible()) {
    w.hide()
    notifyVisibility()
    return false
  }
  w.showInactive()
  bringToFrontMomentarily()
  notifyVisibility()
  return true
}

export function showCalendar(): void {
  const w = getCalendarWindow()
  if (!w) return
  w.showInactive()
  bringToFrontMomentarily()
  notifyVisibility()
}

/**
 * 主动唤出日历时，先让它浮到可见位置——否则桌面模式下它正沉在最底层，
 * 用户按了 Alt+Space 却什么也看不到。之后一旦失焦会自己沉回去。
 */
function bringToFrontMomentarily(): void {
  const w = getCalendarWindow()
  if (!w) return
  if (mode === 'floating') {
    w.setAlwaysOnTop(true, 'floating')
  }
  w.moveTop()
}

/** 切换日历窗的层级策略，立刻生效 */
export function applyCalendarMode(next: CalendarMode): void {
  mode = next
  const w = getCalendarWindow()
  if (!w) return
  if (next === 'floating') {
    w.setAlwaysOnTop(true, 'floating')
  } else {
    w.setAlwaysOnTop(false)
    pushWindowToBottom(w)
  }
  log(`日历窗层级：${next === 'floating' ? '始终浮在最上方' : '贴着桌面'}`)
}

export function currentCalendarMode(): CalendarMode {
  return mode
}

export function hideCalendar(): void {
  const w = getCalendarWindow()
  if (!w) return
  w.hide()
  notifyVisibility()
}

export function resetCalendarPosition(): CardState | null {
  const w = getCalendarWindow()
  if (!w) return null
  const displays = listDisplays()
  const display = primaryDisplay(displays)
  const wa = display.workArea
  card = {
    displayId: display.id,
    x: wa.x + wa.width - CARD_DEFAULT_W - 24,
    y: wa.y + 24,
    w: CARD_DEFAULT_W,
    h: Math.min(CARD_DEFAULT_H, wa.height - 48),
    collapsed: false
  }
  w.setBounds({
    x: card.x - compensate.x,
    y: card.y - compensate.y,
    width: card.w - compensate.width,
    height: card.h - compensate.height
  })
  return saveCardState(card)
}
