/**
 * 法定节假日库
 *
 * 数据来源：国务院办公厅《关于××年部分节假日安排的通知》。
 * 每年 11 月左右发布次年安排，所以新一年的数据需要手工补，
 * 缺数据的年份会自动降级为「只标公历节日 + 周末」，不会出错也不会瞎编。
 *
 * 中国假期的特点是**带调休**：放假的那几天里有的是周末、有的是挪来的，
 * 而被挪走的周末要补班。所以这里同时维护「放假日」和「补班日」两张表。
 */

export type HolidayRegion = 'CN'

/** 一天的属性 */
export type DayKind =
  /** 法定放假日 */
  | 'holiday'
  /** 调休补班（本来是周末，要上班） */
  | 'workday'
  /** 一般节日，不放假，只做标注 */
  | 'festival'

export interface DayMark {
  name: string
  /** 两个字的短名，日历格子窄，放不下全名 */
  short: string
  kind: DayKind
  /** 补班日的说明，如「春节调休」 */
  note?: string
}

interface RangeSpec {
  name: string
  short: string
  /** 起始日（含） */
  from: string
  /** 结束日（含） */
  to: string
}

/** 各年度的放假区间，逐条对应国办通知里的七项安排 */
const CN_RANGES: Record<number, RangeSpec[]> = {
  2025: [
    { name: '元旦', short: '元旦', from: '2025-01-01', to: '2025-01-01' },
    { name: '春节', short: '春节', from: '2025-01-28', to: '2025-02-04' },
    { name: '清明节', short: '清明', from: '2025-04-04', to: '2025-04-06' },
    { name: '劳动节', short: '劳动', from: '2025-05-01', to: '2025-05-05' },
    { name: '端午节', short: '端午', from: '2025-05-31', to: '2025-06-02' },
    { name: '国庆节·中秋节', short: '国庆', from: '2025-10-01', to: '2025-10-08' }
  ],
  2026: [
    { name: '元旦', short: '元旦', from: '2026-01-01', to: '2026-01-03' },
    { name: '春节', short: '春节', from: '2026-02-15', to: '2026-02-23' },
    { name: '清明节', short: '清明', from: '2026-04-04', to: '2026-04-06' },
    { name: '劳动节', short: '劳动', from: '2026-05-01', to: '2026-05-05' },
    { name: '端午节', short: '端午', from: '2026-06-19', to: '2026-06-21' },
    { name: '中秋节', short: '中秋', from: '2026-09-25', to: '2026-09-27' },
    { name: '国庆节', short: '国庆', from: '2026-10-01', to: '2026-10-07' }
  ]
}

/** 调休补班的周末：'YYYY-MM-DD' → 为什么补 */
const CN_MAKEUP_DAYS: Record<number, Record<string, string>> = {
  2025: {
    '2025-01-26': '春节调休',
    '2025-02-08': '春节调休',
    '2025-04-27': '劳动节调休',
    '2025-09-28': '国庆节调休',
    '2025-10-11': '国庆节调休'
  },
  2026: {
    '2026-01-04': '元旦调休',
    '2026-02-14': '春节调休',
    '2026-02-28': '春节调休',
    '2026-05-09': '劳动节调休',
    '2026-09-20': '国庆节调休',
    '2026-10-10': '国庆节调休'
  }
}

/**
 * 不放假的公历节日，只做标注。
 * key 是 'MM-DD'，每年重复。
 */
export const SOLAR_FESTIVALS: Record<string, { name: string; short: string }> = {
  '01-01': { name: '元旦', short: '元旦' },
  '02-14': { name: '情人节', short: '情人' },
  '03-08': { name: '妇女节', short: '妇女' },
  '03-12': { name: '植树节', short: '植树' },
  '04-01': { name: '愚人节', short: '愚人' },
  '05-04': { name: '青年节', short: '青年' },
  '06-01': { name: '儿童节', short: '儿童' },
  '09-10': { name: '教师节', short: '教师' },
  '10-24': { name: '程序员节', short: '程序' },
  '12-25': { name: '圣诞节', short: '圣诞' }
}

/** 有官方数据的年份 */
export const SUPPORTED_YEARS: number[] = Object.keys(CN_RANGES).map(Number).sort()

/**
 * 假期区间是否已覆盖到这一天所在年份。
 * 没覆盖就说实话——日历上只标公历节日，不假装知道法定安排。
 */
export function hasOfficialData(year: number): boolean {
  return Boolean(CN_RANGES[year])
}

function parseDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function format(date: Date): string {
  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 把区间展开成「日期 → 标记」的查找表，运行时按年份缓存 */
const yearCache = new Map<number, Map<string, DayMark>>()

function buildYear(year: number): Map<string, DayMark> {
  const cached = yearCache.get(year)
  if (cached) return cached

  const map = new Map<string, DayMark>()

  for (const range of CN_RANGES[year] ?? []) {
    const end = parseDate(range.to)
    for (let day = parseDate(range.from); day <= end; day.setDate(day.getDate() + 1)) {
      map.set(format(day), {
        name: range.name,
        short: range.short,
        kind: 'holiday'
      })
    }
  }

  for (const [date, note] of Object.entries(CN_MAKEUP_DAYS[year] ?? {})) {
    map.set(date, { name: '调休上班', short: '班', kind: 'workday', note })
  }

  yearCache.set(year, map)
  return map
}

/**
 * 查某一天的标记。
 * 优先级：法定放假 / 调休补班 > 不放假节日。
 * 没有官方数据的年份只返回节日标注。
 */
export function markOf(date: string): DayMark | null {
  const year = Number(date.slice(0, 4))
  const official = buildYear(year).get(date)
  if (official) return official

  const solar = SOLAR_FESTIVALS[date.slice(5)]
  if (solar) {
    return { name: solar.name, short: solar.short, kind: 'festival' }
  }
  return null
}

export interface YearHolidaySummary {
  year: number
  /** 是否有官方安排数据 */
  official: boolean
  /** 全年法定放假日总数 */
  holidayDays: number
  /** 全年调休补班天数 */
  makeupDays: number
  /** 各假期：「名称 起—止」 */
  groups: Array<{ name: string; from: string; to: string; days: number }>
}

/** 年度概览，供设置面板展示「今年放假安排」 */
export function holidaySummary(year: number): YearHolidaySummary {
  const ranges = CN_RANGES[year] ?? []
  const groups = ranges.map((range) => {
    const from = parseDate(range.from)
    const to = parseDate(range.to)
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
    return { name: range.name, from: range.from, to: range.to, days }
  })

  let holidayDays = 0
  for (const group of groups) holidayDays += group.days

  return {
    year,
    official: ranges.length > 0,
    holidayDays,
    makeupDays: Object.keys(CN_MAKEUP_DAYS[year] ?? {}).length,
    groups
  }
}
