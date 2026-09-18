import {
  STRONG_ESCALATE_MINUTES,
  type FireMode,
  type ReminderPayload,
  type TodoInput,
  type TodoItem,
  type TodoPatch
} from '@shared/types'
import { fireAtOf, formatDate, recentOccurrence } from '@shared/repeat'
import { readArray, writeJson } from '../store'

const FILE = 'todos'
const TICK_MS = Number(process.env['KAIROS_TICK_MS']) || 20_000
/** 超过这个时长才发现的提醒就静默丢弃，避免应用关了几天后一次性刷屏 */
const MAX_LATE_MS = 24 * 60 * 60 * 1000
/**
 * 「先系统通知、后强提醒」两段之间的间隔。
 * 允许用环境变量覆盖，方便测试把 5 分钟压成几秒。
 */
const ESCALATE_MS =
  Number(process.env['KAIROS_ESCALATE_MS']) || STRONG_ESCALATE_MINUTES * 60_000

let todos: TodoItem[] = []
let timer: NodeJS.Timeout | null = null
let onFire: ((payload: ReminderPayload, mode: FireMode) => void) | null = null

/**
 * 老版本的数据用 `level: 'normal' | 'strong'` 表示提醒方式，
 * 升级成双开关后要平滑迁移，别把用户已有的待办搞丢。
 */
interface LegacyTodo extends Partial<TodoItem> {
  level?: 'normal' | 'strong'
}

function migrate(raw: LegacyTodo): TodoItem {
  const { level, ...rest } = raw
  let notifySystem = rest.notifySystem
  let notifyStrong = rest.notifyStrong

  if (notifySystem === undefined && notifyStrong === undefined) {
    // 老数据：normal 走系统通知，strong 走强提醒
    notifySystem = level !== 'strong'
    notifyStrong = level === 'strong'
  }

  return {
    ...(rest as TodoItem),
    notifySystem: Boolean(notifySystem),
    notifyStrong: Boolean(notifyStrong)
  }
}

export function initTodos(fire: (payload: ReminderPayload, mode: FireMode) => void): void {
  // 纯净版：首次启动日历是空的，不预置任何示例数据
  todos = readArray<TodoItem>(FILE, []).map((item) => migrate(item as LegacyTodo))
  onFire = fire
  if (timer) clearInterval(timer)
  timer = setInterval(tick, TICK_MS)
  tick()
}

export function disposeTodos(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export function listTodos(): TodoItem[] {
  return todos.map((todo) => ({ ...todo }))
}

export function addTodo(input: TodoInput): TodoItem {
  const todo: TodoItem = {
    id: `t${Date.now()}`,
    done: false,
    title: input.title,
    date: input.date,
    time: input.time,
    // 没指定就按「只发系统通知」处理，跟老版本的默认行为一致
    notifySystem: input.notifySystem ?? true,
    notifyStrong: input.notifyStrong ?? false,
    leadMinutes: input.leadMinutes ?? 0,
    repeat: input.repeat ?? 'none'
  }
  todos = [...todos, todo]
  persist()
  return { ...todo }
}

/**
 * 勾选完成。
 * - 一次性事项：直接翻转 done
 * - 重复事项：表示「本次已完成」，把 lastFiredDate 记到今天，等下一次发生再提醒
 * 两种情况都要清掉挂起的强提醒——用户已经处理了，不该再弹。
 */
export function toggleTodo(id: string): TodoItem[] {
  const today = formatDate(new Date())
  todos = todos.map((todo) => {
    if (todo.id !== id) return todo
    if (todo.repeat === 'none') {
      return { ...todo, done: !todo.done, pendingStrong: undefined }
    }
    const completed = !todo.done
    return {
      ...todo,
      done: completed,
      lastFiredDate: completed ? today : undefined,
      notifiedAt: completed ? todo.notifiedAt : undefined,
      pendingStrong: undefined
    }
  })
  persist()
  return listTodos()
}

export function updateTodo(id: string, patch: TodoPatch): TodoItem[] {
  todos = todos.map((todo) => {
    if (todo.id !== id) return todo
    const next: TodoItem = { ...todo, ...patch }
    // 改了日期/时间/规则，之前的触发记录就不能再算了
    const scheduleChanged =
      patch.date !== undefined || patch.time !== undefined || patch.repeat !== undefined
    if (scheduleChanged) {
      next.lastFiredDate = undefined
      next.notifiedAt = undefined
      next.snoozeUntil = undefined
      next.pendingStrong = undefined
      next.done = false
    }
    // 关掉强提醒时，把已经挂起的那次也取消掉
    if (patch.notifyStrong === false) next.pendingStrong = undefined
    return next
  })
  persist()
  return listTodos()
}

export function removeTodo(id: string): TodoItem[] {
  todos = todos.filter((todo) => todo.id !== id)
  persist()
  return listTodos()
}

export function snoozeTodo(id: string, minutes: number): TodoItem[] {
  const until = Date.now() + minutes * 60_000
  todos = todos.map((todo) =>
    todo.id === id ? { ...todo, snoozeUntil: until, pendingStrong: undefined } : todo
  )
  persist()
  return listTodos()
}

function persist(): void {
  writeJson(FILE, todos)
}

function payloadOf(todo: TodoItem, occurrence: string): ReminderPayload {
  return { id: todo.id, title: todo.title, date: occurrence, time: todo.time }
}

function tick(): void {
  const now = new Date()
  const nowMs = now.getTime()
  let changed = false

  todos = todos.map((todo) => {
    // 已经进入稍后提醒窗口的，等 snoozeUntil 到点再说
    if (todo.snoozeUntil && nowMs < todo.snoozeUntil) return todo

    /* ---------- 第二段：已发过系统通知，等升级为强提醒 ---------- */
    if (todo.pendingStrong) {
      // 用户在这中间把它处理掉了，就别再打扰
      if (todo.done) {
        changed = true
        return { ...todo, pendingStrong: undefined }
      }
      if (nowMs >= todo.pendingStrong.at) {
        changed = true
        onFire?.(payloadOf(todo, todo.pendingStrong.occurrence), 'strong')
        return { ...todo, pendingStrong: undefined, notifiedAt: nowMs }
      }
      return todo
    }

    /* ---------- 第一段：正常到点判定 ---------- */
    const occurrence = recentOccurrence(todo.date, todo.repeat, now)
    if (!occurrence) return todo
    // 这一次发生日已经提醒过（或已完成）就跳过 —— 重复事项靠这个字段去重
    if (todo.lastFiredDate === occurrence) return todo
    if (todo.repeat === 'none' && todo.done) return todo

    const fireAt = todo.snoozeUntil ?? fireAtOf(occurrence, todo.time, todo.leadMinutes)
    if (nowMs < fireAt) return todo

    changed = true
    if (nowMs - fireAt > MAX_LATE_MS) {
      // 错过太久：只记录已处理，不弹提醒
      return { ...todo, lastFiredDate: occurrence, snoozeUntil: undefined }
    }

    // 两个通道都不开：只在日历上留个记录，不打扰
    const neither = !todo.notifySystem && !todo.notifyStrong

    if (todo.notifySystem) {
      onFire?.(payloadOf(todo, occurrence), 'system')
    }

    let pendingStrong: TodoItem['pendingStrong']
    if (todo.notifyStrong) {
      if (todo.notifySystem) {
        // 先让系统通知待一会儿，没处理再升级成强提醒
        pendingStrong = { at: nowMs + ESCALATE_MS, occurrence }
      } else {
        onFire?.(payloadOf(todo, occurrence), 'strong')
      }
    }

    // 重复事项提醒后重置完成态，进入下一轮
    return {
      ...todo,
      lastFiredDate: occurrence,
      notifiedAt: neither ? todo.notifiedAt : nowMs,
      pendingStrong,
      snoozeUntil: undefined,
      done: todo.repeat === 'none' ? todo.done : false
    }
  })

  if (changed) persist()
}
