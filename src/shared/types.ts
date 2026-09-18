import type { HolidayRegion } from './holidays'

export type RemindLevel = 'normal' | 'strong'
export type ThemeMode = 'light' | 'dark' | 'system'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayInfo {
  id: number
  label: string
  bounds: Rect
  workArea: Rect
  scaleFactor: number
  primary: boolean
}

/**
 * 一条待办。提醒方式是两个**互相独立**的开关：
 * - 只开系统通知 → 到点弹 Windows 通知，不打断你
 * - 只开强提醒   → 到点弹应用内弹窗
 * - 两个都开     → 先弹系统通知，过 STRONG_ESCALATE_MINUTES 分钟你还没处理，再升级成强提醒弹窗
 * - 两个都关     → 只在日历上记一笔，不打扰
 */
export interface TodoItem {
  id: string
  title: string
  /** 首次发生日（锚点）。重复事项从这天起按 repeat 规则往后推算 */
  date: string
  time: string
  /** 到点发系统通知 */
  notifySystem: boolean
  /** 到点弹强提醒窗口 */
  notifyStrong: boolean
  leadMinutes: number
  repeat: 'none' | 'daily' | 'weekly' | 'monthly' | 'weekday'
  done: boolean
  notifiedAt?: number
  /** 已发过系统通知、正在等升级为强提醒：{ 计划触发时刻, 对应的发生日 } */
  pendingStrong?: PendingStrong
  /** 已经提醒过的那一次发生日，避免同一次重复事项被反复触发 */
  lastFiredDate?: string
  snoozeUntil?: number
}

/** 新建待办的入参 */
export type TodoInput = Pick<TodoItem, 'title' | 'date' | 'time' | 'leadMinutes' | 'repeat'> &
  Partial<Pick<TodoItem, 'notifySystem' | 'notifyStrong'>>

/** 待办允许修改的字段 */
export type TodoPatch = Partial<
  Pick<
    TodoItem,
    'title' | 'date' | 'time' | 'leadMinutes' | 'repeat' | 'notifySystem' | 'notifyStrong'
  >
>

export interface PendingStrong {
  /** 计划触发强提醒的时间戳 */
  at: number
  /** 这一次对应的是哪个发生日 */
  occurrence: string
}

/** 「两个都开」时，系统通知发出后隔多久升级为强提醒 */
export const STRONG_ESCALATE_MINUTES = 5

/** 日历悬浮窗的位置与尺寸，按所属显示器分别记忆 */
export interface CardState {
  displayId: number
  x: number
  y: number
  w: number
  h: number
  collapsed: boolean
}

/** 日历窗的层级策略 */
export type CalendarMode =
  /** 贴着桌面：被其他程序的窗口盖住，只在看桌面时出现 */
  | 'desktop'
  /** 始终浮在所有窗口最上方 */
  | 'floating'

export interface AppSettings {
  autoStart: boolean
  snoozeMinutes: number
  theme: ThemeMode
  /** 日历窗是「贴桌面」还是「始终置顶」 */
  calendarMode: CalendarMode
  /** 是否在日历上标注法定节假日与调休补班 */
  showHolidays: boolean
  /** 节假日地区 */
  holidayRegion: HolidayRegion
  /** 日历同步的自动刷新间隔（分钟），0 = 不自动刷新 */
  syncIntervalMinutes: number
}

export const CARD_MIN_W = 300
export const CARD_MIN_H = 340
export const CARD_DEFAULT_W = 344
export const CARD_DEFAULT_H = 660

export const DEFAULT_SETTINGS: AppSettings = {
  autoStart: true,
  snoozeMinutes: 10,
  theme: 'light',
  // 默认贴着桌面：日历是「抬眼就能看到」的东西，不该压在工作窗口上面
  calendarMode: 'desktop',
  showHolidays: true,
  holidayRegion: 'CN',
  syncIntervalMinutes: 30
}

/* ---------- 电脑日历同步 ---------- */

export type SyncSourceKind = 'ics-file' | 'ics-url' | 'outlook'

/** 一个日历同步源 */
export interface SyncSource {
  id: string
  kind: SyncSourceKind
  /** 显示名，默认取文件名 / 站点名 */
  label: string
  /** 本地 .ics 路径 或 订阅地址；outlook 类型为空 */
  target: string
  /** 事件在日历上的标记色 */
  color: string
  enabled: boolean
  /** 上次成功同步的时间戳 */
  lastSyncAt?: number
  /** 上次失败原因，成功后清空 */
  lastError?: string
  eventCount: number
}

/** 同步进来的日历事件 */
export interface SyncedEvent {
  uid: string
  title: string
  /** 开始日 'YYYY-MM-DD' */
  start: string
  /** 结束日 'YYYY-MM-DD'（含） */
  end: string
  allDay: boolean
  /** 定时事件的开始时刻 'HH:mm' */
  time?: string
  location?: string
  sourceId: string
  color: string
}

export interface SyncState {
  sources: SyncSource[]
  /** 本机是否检测到可用的 Outlook 桌面版 */
  outlookAvailable: boolean
  /** 是否已探测过，避免反复探测拖慢启动 */
  outlookChecked: boolean
  refreshing: boolean
  lastRefreshAt?: number
}

/** 每个同步源的标记色，按加入顺序轮流分配 */
export const SYNC_COLORS = ['#2f6bff', '#12a594', '#8b5cf6', '#ec6a3f', '#e0a800', '#d946a0'] as const

export interface RuntimeState {
  autoStart: boolean
  packaged: boolean
}

/** 主进程推给界面的一次提醒 */
export interface ReminderPayload {
  id: string
  title: string
  date: string
  time: string
}

/** 提醒走哪条通道 */
export type FireMode = 'system' | 'strong'

export interface WindowBounds extends Rect {
  displays: DisplayInfo[]
}

export const IPC = {
  settingsGet: 'settings:get',
  settingsPatch: 'settings:patch',
  runtimeGet: 'runtime:get',
  runtimeChanged: 'runtime:changed',

  autostartSet: 'autostart:set',

  todoList: 'todo:list',
  todoAdd: 'todo:add',
  todoToggle: 'todo:toggle',
  todoRemove: 'todo:remove',
  todoSnooze: 'todo:snooze',
  todoUpdate: 'todo:update',

  /** 主进程 -> 日历窗：提醒已触发（用于刷新列表、弹普通提示） */
  reminderFired: 'reminder:fired',
  /** 主进程 -> 日历窗：待办数据变了，请重新拉取 */
  todosChanged: 'todos:changed',
  /** 手动触发一次强提醒，用于自测 */
  reminderTest: 'reminder:test',
  /** 强提醒窗口请求当前要展示的内容 */
  reminderData: 'reminder:data',
  /** 强提醒窗口 -> 主进程：用户点了稍后 / 完成 */
  reminderAction: 'reminder:action',

  windowBounds: 'window:bounds',
  windowSetBounds: 'window:set-bounds',
  windowHide: 'window:hide',
  displaysChanged: 'displays:changed',

  appQuit: 'app:quit',
  uiToast: 'ui:toast',

  /** 读取同步状态（源列表 + Outlook 可用性） */
  syncState: 'sync:state',
  /** 主进程 -> 日历窗：同步数据有变化 */
  syncChanged: 'sync:changed',
  /** 打开文件对话框选择一个 .ics 并加入 */
  syncAddFile: 'sync:add-file',
  /** 通过订阅地址加入 */
  syncAddUrl: 'sync:add-url',
  /** 探测并加入本机 Outlook 日历 */
  syncAddOutlook: 'sync:add-outlook',
  syncToggle: 'sync:toggle',
  syncRemove: 'sync:remove',
  syncRefresh: 'sync:refresh',
  /** 查询区间内的事件 */
  syncEvents: 'sync:events'
} as const
