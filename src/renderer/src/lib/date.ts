import { markOf, type DayMark } from '@shared/holidays'
import { lunarInfoOf, type LunarInfo } from '@shared/lunar'

export const DOW = ['一', '二', '三', '四', '五', '六', '日']

export function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

export function dstr(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`
}

export function todayStr(): string {
  const now = new Date()
  return dstr(now.getFullYear(), now.getMonth(), now.getDate())
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(y, m - 1, d + days)
  return dstr(next.getFullYear(), next.getMonth(), next.getDate())
}

/** 格子下方那行小字的类型，渲染时用来上色 */
export type SubKind =
  /** 法定放假 */
  | 'holiday'
  /** 调休补班 */
  | 'makeup'
  /** 农历传统节日 */
  | 'lunarFestival'
  /** 节气 */
  | 'term'
  /** 不放假的一般节日 */
  | 'festival'
  /** 平平常常的农历日 */
  | 'lunar'
  /** 周末 */
  | 'rest'
  | 'none'

export interface DayCell {
  key: string
  label: string
  date?: string
  blank: boolean
  /** 只看星期几算出来的周末；调休补班的周末在渲染时另行处理 */
  weekend: boolean
  isToday: boolean
  /** 格子下方那行小字 */
  sub: string
  subKind: SubKind
  /** 法定放假 / 调休补班 / 公历节日（原始标记，渲染时还要用） */
  mark: DayMark | null
}

export interface MonthGrid {
  cells: DayCell[]
  title: string
  subtitle: string
  /** 当月有官方放假安排的假期名，用于副标题 */
  holidayNames: string[]
}

/**
 * 决定格子下方显示什么、用什么颜色。优先级：
 * 法定放假 > 调休补班 > 农历传统节日 > 节气 > 一般节日 > 农历日 > 周末
 *
 * 「农历日优先于周末」是刻意的：周末从红色日期数字就能看出来，
 * 而农历信息（初一、廿七）是这一行小字真正能提供的增量。
 */
function resolveSub(
  mark: DayMark | null,
  lunar: LunarInfo | null,
  weekend: boolean,
  showLunar: boolean
): { sub: string; kind: SubKind } {
  if (mark?.kind === 'holiday') return { sub: mark.short, kind: 'holiday' }
  if (mark?.kind === 'workday') return { sub: '班', kind: 'makeup' }

  if (lunar?.festival) return { sub: lunar.short, kind: 'lunarFestival' }
  if (lunar?.term) return { sub: lunar.term.slice(0, 2), kind: 'term' }
  if (mark?.kind === 'festival') return { sub: mark.short, kind: 'festival' }
  if (showLunar && lunar) return { sub: lunar.short, kind: 'lunar' }
  if (weekend) return { sub: '休', kind: 'rest' }

  return { sub: '', kind: 'none' }
}

export function buildMonth(
  year: number,
  month: number,
  today: string,
  options: { showHolidays?: boolean; showLunar?: boolean } = {}
): MonthGrid {
  const showHolidays = options.showHolidays !== false
  const showLunar = options.showLunar !== false

  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  const days = new Date(year, month + 1, 0).getDate()
  const prevDays = new Date(year, month, 0).getDate()
  const cells: DayCell[] = []

  for (let b = offset - 1; b >= 0; b -= 1) {
    cells.push({
      key: `p${b}`,
      label: String(prevDays - b),
      blank: true,
      weekend: false,
      isToday: false,
      sub: '',
      subKind: 'none',
      mark: null
    })
  }

  const holidayNames: string[] = []

  for (let d = 1; d <= days; d += 1) {
    const date = dstr(year, month, d)
    const weekday = (new Date(year, month, d).getDay() + 6) % 7
    const mark = showHolidays ? markOf(date) : null
    const lunar = showLunar || showHolidays ? lunarInfoOf(date) : null

    if (mark?.kind === 'holiday' && !holidayNames.includes(mark.name)) {
      holidayNames.push(mark.name)
    }

    const { sub, kind } = resolveSub(mark, lunar, weekday >= 5, showLunar)

    cells.push({
      key: date,
      label: String(d),
      date,
      blank: false,
      weekend: weekday >= 5,
      isToday: date === today,
      sub,
      subKind: kind,
      mark
    })
  }

  const tail = (7 - (cells.length % 7)) % 7
  for (let t = 1; t <= tail; t += 1) {
    cells.push({
      key: `n${t}`,
      label: String(t),
      blank: true,
      weekend: false,
      isToday: false,
      sub: '',
      subKind: 'none',
      mark: null
    })
  }

  const subtitle = holidayNames.length
    ? holidayNames.join(' · ')
    : showLunar
      ? '农历 · 节气'
      : '公历'

  return { cells, title: `${year} 年 ${month + 1} 月`, subtitle, holidayNames }
}
