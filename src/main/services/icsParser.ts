/**
 * 轻量 iCalendar (.ics) 解析器
 *
 * 为什么自己写而不装 node-ical：这个应用要打成单文件 asar 安装包，
 * 少一个运行时依赖就少一处打包坑。日历同步只关心常用字段，
 * 自己实现反而更可控、出问题也好查。
 *
 * 支持范围：
 * - VEVENT 的 UID / SUMMARY / DTSTART / DTEND / LOCATION
 * - 全天事件（VALUE=DATE）与定时事件
 * - UTC（结尾带 Z）自动换算成本地时间
 * - RRULE 的 FREQ=DAILY|WEEKLY|MONTHLY|YEARLY，配合 INTERVAL / COUNT / UNTIL / BYDAY
 *
 * 明确不支持（遇到就忽略该规则，退化成单次事件，不会崩）：
 * - BYSETPOS / BYMONTH / EXDATE / RECURRENCE-ID 等复杂重复规则
 */

export interface IcsEvent {
  uid: string
  title: string
  /** 开始日 'YYYY-MM-DD' */
  start: string
  /** 结束日 'YYYY-MM-DD'（含），与开始日相同表示单日 */
  end: string
  allDay: boolean
  /** 定时事件的开始时刻 'HH:mm' */
  time?: string
  location?: string
}

interface RawLine {
  name: string
  params: Record<string, string>
  value: string
}

/** 单次展开的迭代上限，防止畸形 RRULE 把进程拖死 */
const MAX_OCCURRENCES = 2000

const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`)

function fmt(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/**
 * ICS 规定每行不超过 75 字节，超长会被折成多行，
 * 续行以空格或制表符开头。这里先把折行接回去。
 */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const lines: string[] = []

  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line)
    }
  }
  return lines
}

/** 拆成 名称 / 参数 / 值。参数里可能有冒号（如 TZID=Asia/Shanghai），所以只在参数段外找第一个冒号 */
function parseLine(line: string): RawLine | null {
  // 最后一个「未被引号包裹的冒号」之前是 名称;参数，之后是值。
  // 简化处理：先找第一个冒号把左侧和值分开，但左侧必须不含引号外的冒号语义问题——
  // 实际上 iCalendar 的参数值里不含裸冒号（含冒号的参数值必须加引号），所以直接 split 第一个冒号是安全的。
  const idx = line.indexOf(':')
  if (idx < 0) return null

  const left = line.slice(0, idx)
  const value = line.slice(idx + 1)
  const parts = left.split(';')
  const name = parts[0].toUpperCase()
  const params: Record<string, string> = {}

  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name, params, value }
}

/** 反转义 ICS 文本值 */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim()
}

interface ParsedDate {
  date: string
  time?: string
  allDay: boolean
}

/** 解析 DTSTART / DTEND 的值 */
function parseDateValue(line: RawLine | undefined): ParsedDate | null {
  if (!line) return null
  const value = line.value.trim()

  // 纯日期：20260918
  if (/^\d{8}$/.test(value)) {
    return {
      date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`,
      allDay: true
    }
  }

  // 日期 + 时刻：20260918T090000 或 20260918T090000Z
  const match = /^(\d{8})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value)
  if (!match) return null

  const [, ymd, hh, mm, ss, utc] = match
  const year = Number(ymd.slice(0, 4))
  const month = Number(ymd.slice(4, 6))
  const day = Number(ymd.slice(6, 8))

  if (utc) {
    // 带 Z 表示 UTC，换算成本地时间再取值
    const d = new Date(Date.UTC(year, month - 1, day, Number(hh), Number(mm), Number(ss ?? 0)))
    return { date: fmt(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, allDay: false }
  }

  // 不带 Z：按本地时间理解（TZID 不做换算，避免引入时区库）
  return {
    date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
    time: `${hh}:${mm}`,
    allDay: false
  }
}

interface RRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  count?: number
  until?: Date
  byDay: number[]
}

/** JS 的星期是 0=周日，ICS 的 BYDAY 用两个字母缩写 */
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

function parseRRule(value: string): RRule | null {
  const parts = value.split(';')
  const map: Record<string, string> = {}
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq > 0) map[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1)
  }

  const freq = map.FREQ?.toUpperCase()
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null

  const byDay: number[] = []
  if (map.BYDAY) {
    for (const token of map.BYDAY.split(',')) {
      // 支持 MO / +1MO 这类写法，数字前缀（第几个星期几）忽略
      const code = token.replace(/^[+-]?\d+/, '').toUpperCase()
      const index = DAY_CODES.indexOf(code)
      if (index >= 0) byDay.push(index)
    }
  }

  let until: Date | undefined
  if (map.UNTIL) {
    const parsed = parseDateValue({ name: 'UNTIL', params: {}, value: map.UNTIL })
    if (parsed) {
      const [y, m, d] = parsed.date.split('-').map(Number)
      const [hh, mm] = (parsed.time ?? '23:59').split(':').map(Number)
      until = new Date(y, m - 1, d, hh, mm)
    }
  }

  return {
    freq,
    interval: Math.max(1, Number(map.INTERVAL ?? 1) || 1),
    count: map.COUNT ? Math.max(1, Number(map.COUNT)) : undefined,
    until,
    byDay
  }
}

/** 把重复规则展开成具体日期列表（只取落在 [from, to] 区间内的） */
function expand(
  start: Date,
  rule: RRule,
  from: Date,
  to: Date
): Date[] {
  const result: Date[] = []
  let produced = 0

  const push = (d: Date): boolean => {
    // 返回 false 表示「可以停止了」
    produced += 1
    if (rule.count !== undefined && produced > rule.count) return false
    if (rule.until && d > rule.until) return false
    if (d > to) return false
    if (d >= from) result.push(new Date(d))
    return true
  }

  const cursor = new Date(start)
  let guard = 0

  if (rule.freq === 'WEEKLY' && rule.byDay.length > 0) {
    // 从 start 所在那一周的周日开始，逐日检查是否命中 BYDAY
    const weekStart = new Date(start)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())

    while (guard < MAX_OCCURRENCES) {
      guard += 1
      let anyHit = false
      for (let offset = 0; offset < 7; offset += 1) {
        const day = new Date(weekStart)
        day.setDate(day.getDate() + offset)
        if (day < start) continue
        if (!rule.byDay.includes(day.getDay())) continue
        anyHit = true
        if (!push(day)) return result
      }
      if (!anyHit && weekStart > to) return result
      weekStart.setDate(weekStart.getDate() + 7 * rule.interval)
      if (weekStart > to) return result
    }
    return result
  }

  while (guard < MAX_OCCURRENCES) {
    guard += 1
    if (!push(cursor)) return result

    if (rule.freq === 'DAILY') {
      cursor.setDate(cursor.getDate() + rule.interval)
    } else if (rule.freq === 'WEEKLY') {
      cursor.setDate(cursor.getDate() + 7 * rule.interval)
    } else if (rule.freq === 'MONTHLY') {
      cursor.setMonth(cursor.getMonth() + rule.interval)
    } else {
      cursor.setFullYear(cursor.getFullYear() + rule.interval)
    }

    if (cursor > to) return result
  }
  return result
}

interface PendingEvent {
  uid: string
  title: string
  dtStart?: RawLine
  dtEnd?: RawLine
  rrule?: RRule
  location?: string
}

/**
 * 解析 ICS 文本，返回落在 [from, to] 区间内的事件。
 * @param from 'YYYY-MM-DD' 起（含）
 * @param to   'YYYY-MM-DD' 止（含）
 */
export function parseIcs(text: string, from: string, to: string): IcsEvent[] {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const rangeStart = new Date(fy, fm - 1, fd)
  const rangeEnd = new Date(ty, tm - 1, td)

  const lines = unfold(text)
  const events: IcsEvent[] = []
  let current: PendingEvent | null = null

  for (const line of lines) {
    const parsed = parseLine(line)
    if (!parsed) continue

    if (parsed.name === 'BEGIN' && parsed.value.toUpperCase() === 'VEVENT') {
      current = { uid: '', title: '' }
      continue
    }
    if (parsed.name === 'END' && parsed.value.toUpperCase() === 'VEVENT') {
      if (current) emit(current, rangeStart, rangeEnd, events)
      current = null
      continue
    }
    if (!current) continue

    switch (parsed.name) {
      case 'UID':
        current.uid = parsed.value.trim()
        break
      case 'SUMMARY':
        current.title = unescapeText(parsed.value)
        break
      case 'LOCATION':
        current.location = unescapeText(parsed.value)
        break
      case 'DTSTART':
        current.dtStart = parsed
        break
      case 'DTEND':
        current.dtEnd = parsed
        break
      case 'RRULE':
        current.rrule = parseRRule(parsed.value) ?? undefined
        break
      default:
        break
    }
  }

  events.sort((a, b) => (a.start === b.start ? (a.time ?? '').localeCompare(b.time ?? '') : a.start.localeCompare(b.start)))
  return events
}

function emit(
  pending: PendingEvent,
  rangeStart: Date,
  rangeEnd: Date,
  out: IcsEvent[]
): void {
  const begin = parseDateValue(pending.dtStart)
  if (!begin) return

  const finish = parseDateValue(pending.dtEnd)
  const [sy, sm, sd] = begin.date.split('-').map(Number)
  const startDate = new Date(sy, sm - 1, sd)

  // 持续天数：全天事件的 DTEND 是「不含」的（iCalendar 规范），要减一天
  let spanDays = 0
  if (finish) {
    const [ey, em, ed] = finish.date.split('-').map(Number)
    let endDate = new Date(ey, em - 1, ed)
    if (begin.allDay) endDate = new Date(ey, em - 1, ed - 1)
    spanDays = Math.max(0, dayDiff(startDate, endDate))
  }

  const title = pending.title || '（无标题）'
  const uid = pending.uid || `${begin.date}-${title}`

  const dates: Date[] = pending.rrule
    ? expand(startDate, pending.rrule, rangeStart, rangeEnd)
    : startDate >= rangeStart && startDate <= rangeEnd
      ? [startDate]
      : []

  for (const day of dates) {
    const finishDay = new Date(day)
    finishDay.setDate(finishDay.getDate() + spanDays)

    // 跨天的重复事件会被裁掉一部分，保证落在区间内
    const clippedEnd = finishDay > rangeEnd ? rangeEnd : finishDay

    out.push({
      uid: `${uid}@${fmt(day)}`,
      title,
      start: fmt(day),
      end: fmt(clippedEnd),
      allDay: begin.allDay,
      time: begin.time,
      location: pending.location
    })
  }
}
