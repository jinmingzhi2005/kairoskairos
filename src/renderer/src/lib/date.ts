import { markOf, type DayMark } from '@shared/holidays'

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

export interface DayCell {
  key: string
  label: string
  date?: string
  blank: boolean
  /** 只看星期几算出来的周末；调休补班的周末会在渲染时另行处理 */
  weekend: boolean
  /** 法定放假 / 调休补班 / 不放假节日 */
  mark: DayMark | null
  isToday: boolean
}

export interface MonthGrid {
  cells: DayCell[]
  title: string
  subtitle: string
  /** 当月有官方放假安排的假期名，用于副标题 */
  holidayNames: string[]
}

export function buildMonth(
  year: number,
  month: number,
  today: string,
  options: { showHolidays?: boolean } = {}
): MonthGrid {
  const showHolidays = options.showHolidays !== false
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
      mark: null,
      isToday: false
    })
  }

  const holidayNames: string[] = []

  for (let d = 1; d <= days; d += 1) {
    const date = dstr(year, month, d)
    const weekday = (new Date(year, month, d).getDay() + 6) % 7
    const mark = showHolidays ? markOf(date) : null

    if (mark?.kind === 'holiday' && !holidayNames.includes(mark.name)) {
      holidayNames.push(mark.name)
    }

    cells.push({
      key: date,
      label: String(d),
      date,
      blank: false,
      weekend: weekday >= 5,
      mark,
      isToday: date === today
    })
  }

  const tail = (7 - (cells.length % 7)) % 7
  for (let t = 1; t <= tail; t += 1) {
    cells.push({ key: `n${t}`, label: String(t), blank: true, weekend: false, mark: null, isToday: false })
  }

  const subtitle = holidayNames.length
    ? holidayNames.join(' · ')
    : showHolidays
      ? '公历 · 节日 · 调休'
      : '公历'

  return {
    cells,
    title: `${year} 年 ${month + 1} 月`,
    subtitle,
    holidayNames
  }
}
