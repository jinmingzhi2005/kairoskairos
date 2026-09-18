/**
 * 农历、节气与传统节日
 *
 * 农历日期**不自己算**，直接用运行时内置的 ICU 中文历法：
 * `Intl.DateTimeFormat('zh-CN-u-ca-chinese')`。这样零依赖、零数据表，
 * 也不用维护 1900–2100 那种几百个数字的农历表（那玩意儿抄错一位就全错）。
 * 闰月 ICU 会输出成 `month=闰6`，刚好能用。
 *
 * 节气必须自己算：ICU 不提供。用太阳视黄经判定 ——
 * 节气定义为太阳视黄经到达 15° 整数倍的时刻，精度足够定位到某一天。
 */

/** 农历日的中文写法 */
const DAY_NAMES = [
  '',
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
]

const MONTH_NAMES = [
  '', '正月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '冬月', '腊月'
]

/** 黄经 → 节气名 */
const TERM_NAMES: Record<number, string> = {
  0: '春分', 15: '清明', 30: '谷雨', 45: '立夏', 60: '小满', 75: '芒种',
  90: '夏至', 105: '小暑', 120: '大暑', 135: '立秋', 150: '处暑', 165: '白露',
  180: '秋分', 195: '寒露', 210: '霜降', 225: '立冬', 240: '小雪', 255: '大雪',
  270: '冬至', 285: '小寒', 300: '大寒', 315: '立春', 330: '雨水', 345: '惊蛰'
}

/** 农历传统节日：月-日 → 名称（简写用于日历格子） */
const LUNAR_FESTIVALS: Record<string, { name: string; short: string }> = {
  '1-1': { name: '春节', short: '春节' },
  '1-15': { name: '元宵节', short: '元宵' },
  '2-2': { name: '龙抬头', short: '龙头' },
  '5-5': { name: '端午节', short: '端午' },
  '7-7': { name: '七夕', short: '七夕' },
  '7-15': { name: '中元节', short: '中元' },
  '8-15': { name: '中秋节', short: '中秋' },
  '9-9': { name: '重阳节', short: '重阳' },
  '12-8': { name: '腊八节', short: '腊八' },
  '12-23': { name: '小年', short: '小年' }
}

const RAD = Math.PI / 180

/** 太阳视黄经（度），入参为儒略日 */
function sunLongitude(jd: number): number {
  const t = (jd - 2451545) / 36525
  const l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t
  const m = 357.52911 + 35999.05029 * t - 0.0001537 * t * t
  const c =
    (1.914602 - 0.004817 * t - 0.000014 * t * t) * Math.sin(m * RAD) +
    (0.019993 - 0.000101 * t) * Math.sin(2 * m * RAD) +
    0.000289 * Math.sin(3 * m * RAD)
  const omega = 125.04 - 1934.136 * t
  // 减去光行差与章动，得到视黄经
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD)
  return ((lambda % 360) + 360) % 360
}

/** 公历 → 儒略日（h 为 UT 小时） */
function julianDay(y: number, m: number, d: number, h = 0): number {
  let year = y
  let month = m
  if (month <= 2) {
    year -= 1
    month += 12
  }
  const a = Math.floor(year / 100)
  const b = 2 - a + Math.floor(a / 4)
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + d + b - 1524.5 + h / 24
}

/** 按年缓存节气：'YYYY-MM-DD' → 节气名 */
const termCache = new Map<number, Map<string, string>>()

function termsOfYear(year: number): Map<string, string> {
  const cached = termCache.get(year)
  if (cached) return cached

  const map = new Map<string, string>()

  for (let month = 1; month <= 12; month += 1) {
    const days = new Date(year, month, 0).getDate()
    for (let day = 1; day <= days; day += 1) {
      // 按「北京时间的这一整天」判断：UTC 区间 [前一天 16:00, 当天 16:00]
      // （早前写成 04:00，区间整体偏了 12 小时，节气会整天算错）
      const start = julianDay(year, month, day - 1, 16)
      const end = julianDay(year, month, day, 16)
      const a = sunLongitude(start)
      const b = sunLongitude(end)

      for (let k = 0; k < 24; k += 1) {
        const target = k * 15
        // 黄经在一个区间内最多跨过一个 15° 整数倍
        const crossed = b >= a ? a < target && target <= b : target > a || target <= b
        if (crossed) {
          const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          map.set(key, TERM_NAMES[target])
          break
        }
      }
    }
  }

  termCache.set(year, map)
  return map
}

/* ---------- 农历日期（走 ICU） ---------- */

let lunarFormatter: Intl.DateTimeFormat | null = null

function formatter(): Intl.DateTimeFormat {
  if (!lunarFormatter) {
    lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
      month: 'numeric',
      day: 'numeric'
    })
  }
  return lunarFormatter
}

interface LunarDate {
  month: number
  day: number
  leap: boolean
}

function lunarDateOf(date: Date): LunarDate | null {
  try {
    const parts = formatter().formatToParts(date)
    const rawMonth = parts.find((p) => p.type === 'month')?.value ?? ''
    const rawDay = parts.find((p) => p.type === 'day')?.value ?? ''
    const leap = rawMonth.includes('闰')
    const month = Number(rawMonth.replace(/[^\d]/g, ''))
    const day = Number(rawDay.replace(/[^\d]/g, ''))
    if (!month || !day) return null
    return { month, day, leap }
  } catch {
    return null
  }
}

export interface LunarInfo {
  monthName: string
  dayName: string
  /** 节气名，如「秋分」 */
  term?: string
  /** 传统节日名（农历），如「中秋」 */
  festival?: string
  /**
   * 日历格子用的短标签（最多两个汉字）。
   * 优先级：传统节日 > 节气 > 农历日
   */
  short: string
  /** 是否值得用醒目色（传统大节） */
  highlight: boolean
}

/**
 * 取某一天的农历信息。
 * @param dateStr 'YYYY-MM-DD'
 */
export function lunarInfoOf(dateStr: string): LunarInfo | null {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return null
  const date = new Date(y, m - 1, d)

  const lunar = lunarDateOf(date)
  if (!lunar) return null

  const monthName = (lunar.leap ? '闰' : '') + MONTH_NAMES[lunar.month]
  const dayName = DAY_NAMES[lunar.day] ?? String(lunar.day)

  const term = termsOfYear(y).get(dateStr)
  const festivalKey = `${lunar.month}-${lunar.day}`
  const festival = lunar.leap ? undefined : LUNAR_FESTIVALS[festivalKey]

  // 除夕：腊月的最后一天（廿九或三十），也就是次日为正月初一
  let isLunarNewYearEve = false
  if (!lunar.leap && lunar.month === 12) {
    const next = lunarDateOf(new Date(y, m - 1, d + 1))
    if (next && next.month === 1 && next.day === 1) isLunarNewYearEve = true
  }

  const named = isLunarNewYearEve
    ? { name: '除夕', short: '除夕' }
    : festival

  const short = named ? named.short : (term ?? dayName)
  return {
    monthName,
    dayName,
    term,
    festival: named?.name,
    short,
    highlight: Boolean(named)
  }
}
