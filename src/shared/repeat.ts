import type { TodoItem } from './types'
import { markOf } from './holidays'

export type RepeatRule = TodoItem['repeat']

export const REPEAT_OPTIONS: Array<{ value: RepeatRule; label: string }> = [
  { value: 'none', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekday', label: '工作日' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' }
]

/** 提前提醒量（分钟）：0 表示准时 */
export const LEAD_OPTIONS = [0, 5, 15, 30]

export function repeatLabel(repeat: RepeatRule): string {
  return REPEAT_OPTIONS.find((option) => option.value === repeat)?.label ?? '不重复'
}

export function leadLabel(minutes: number): string {
  return minutes > 0 ? `提前 ${minutes} 分` : '准时'
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** 用本地时间解析 YYYY-MM-DD，避免 new Date(str) 被当成 UTC 而差一天 */
export function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0)
}

export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function addDays(dateStr: string, days: number): string {
  const date = parseDate(dateStr)
  date.setDate(date.getDate() + days)
  return formatDate(date)
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

/**
 * 判断某个待办是否发生在 target 这一天。
 * date 字段视为「首次发生日」（锚点），重复规则从锚点往后推算，
 * 这样不用改数据就能在日历上把重复事项铺满整个月。
 */
export function occursOn(anchor: string, repeat: RepeatRule, target: string): boolean {
  if (!anchor || !target) return false
  const anchorDate = parseDate(anchor)
  const targetDate = parseDate(target)
  if (targetDate.getTime() < anchorDate.getTime()) return false

  switch (repeat) {
    case 'daily':
      return true
    case 'weekday': {
      // 「工作日」= 周一到周五，但要去掉法定放假日、加上调休补班的周末
      const mark = markOf(target)
      if (mark?.kind === 'holiday') return false
      if (mark?.kind === 'workday') return true
      const day = targetDate.getDay()
      return day >= 1 && day <= 5
    }
    case 'weekly':
      return targetDate.getDay() === anchorDate.getDay()
    case 'monthly': {
      const last = daysInMonth(targetDate.getFullYear(), targetDate.getMonth())
      const wanted = Math.min(anchorDate.getDate(), last)
      return targetDate.getDate() === wanted
    }
    default:
      return target === anchor
  }
}

/**
 * 找出「最近一次应该发生」的日期（含今天，最多回看 lookback 天）。
 * 用于主进程调度：只认今天和昨天，避免应用关闭一周后补发一堆过期提醒。
 */
export function recentOccurrence(anchor: string, repeat: RepeatRule, now: Date, lookback = 1): string | null {
  for (let offset = 0; offset <= lookback; offset += 1) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    candidate.setDate(candidate.getDate() - offset)
    const key = formatDate(candidate)
    if (occursOn(anchor, repeat, key)) return key
  }
  return null
}

/** 某条待办在该日期下的提醒触发时间戳（含提前量） */
export function fireAtOf(occurrenceDate: string, time: string, leadMinutes: number): number {
  const [hh, mm] = time.split(':').map(Number)
  const at = parseDate(occurrenceDate)
  at.setHours(hh ?? 9, mm ?? 0, 0, 0)
  return at.getTime() - (leadMinutes || 0) * 60_000
}
