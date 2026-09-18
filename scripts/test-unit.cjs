/**
 * 纯逻辑单元测试（npm run test:unit）
 *
 * 覆盖两块最容易出错、又最适合离线验证的逻辑：
 * - 法定节假日判定（含调休补班）
 * - ICS 解析（折行、时区、DTEND 不含、RRULE 展开）
 *
 * 这两个模块都是零依赖的纯函数，所以先用 tsc 单独编译到临时目录，
 * 再用普通 node 跑断言——不用为了测两个函数把整个 Electron 拉起来。
 */
const { spawnSync } = require('node:child_process')
const { existsSync, mkdtempSync } = require('node:fs')
const { join } = require('node:path')
const os = require('node:os')

const ROOT = join(__dirname, '..')
const OUT = mkdtempSync(join(os.tmpdir(), 'kairos-unit-'))

const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
if (!existsSync(tsc)) {
  console.error('找不到 TypeScript，请先 npm install')
  process.exit(1)
}

const compile = spawnSync(
  process.execPath,
  [
    tsc,
    'src/main/services/icsParser.ts',
    'src/shared/holidays.ts',
    '--outDir',
    OUT,
    '--rootDir',
    'src',
    '--module',
    'commonjs',
    '--target',
    'ES2022',
    '--moduleResolution',
    'node',
    '--skipLibCheck'
  ],
  { cwd: ROOT, stdio: 'inherit' }
)

if (compile.status !== 0) {
  console.error('编译失败')
  process.exit(1)
}

const { parseIcs } = require(join(OUT, 'main', 'services', 'icsParser.js'))
const { markOf, holidaySummary, hasOfficialData } = require(join(OUT, 'shared', 'holidays.js'))

let pass = 0
let fail = 0

function check(name, ok, detail) {
  if (ok) {
    pass += 1
    console.log(`PASS  ${name}${detail ? '  ' + detail : ''}`)
  } else {
    fail += 1
    console.log(`FAIL  ${name}${detail ? '  ' + detail : ''}`)
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(name, a === e, a === e ? a : `实际 ${a} ≠ 期望 ${e}`)
}

/* ================= 法定节假日 ================= */

console.log('\n--- 法定节假日 ---')

eq('2026-01-01 元旦放假', markOf('2026-01-01'), {
  name: '元旦',
  short: '元旦',
  kind: 'holiday'
})
check('2026-02-15 春节首日', markOf('2026-02-15')?.name === '春节' && markOf('2026-02-15')?.kind === 'holiday')
check('2026-02-23 春节末日仍在假期内', markOf('2026-02-23')?.kind === 'holiday')
check(
  '2026-02-14 是调休补班（周六上班）',
  markOf('2026-02-14')?.kind === 'workday',
  `kind=${markOf('2026-02-14')?.kind}`
)
check(
  '2026-09-20 是国庆调休补班（周日上班）',
  markOf('2026-09-20')?.kind === 'workday'
)
check('2026-09-25 中秋节放假', markOf('2026-09-25')?.name === '中秋节')
check('2026-10-01 国庆节放假', markOf('2026-10-01')?.name === '国庆节')
check('2026-02-24 节后首个工作日无标记', markOf('2026-02-24') === null)
check('2025-10-01 国庆中秋合并放假', markOf('2025-10-01')?.name === '国庆节·中秋节')
check('2025-04-27 是劳动节调休补班', markOf('2025-04-27')?.kind === 'workday')

eq('03-08 妇女节是「不放假节日」', markOf('2026-03-08'), {
  name: '妇女节',
  short: '妇女',
  kind: 'festival'
})

check('2027 年暂无官方数据', hasOfficialData(2027) === false)
check('2027-01-01 仍能标出元旦', markOf('2027-01-01')?.name === '元旦')

const s2026 = holidaySummary(2026)
eq('2026 年放假总天数（官方：33 天）', s2026.holidayDays, 33)
eq('2026 年调休补班天数', s2026.makeupDays, 6)
eq('2026 年假期段数', s2026.groups.length, 7)

/* ================= ICS 解析 ================= */

console.log('\n--- ICS 解析 ---')

const wrap = (body) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//CN', body, 'END:VCALENDAR'].join('\r\n')

// 1) 单次全天事件。DTEND 按规范是「不含」的，20260919 表示只占 18 号一天
const allDay = wrap(
  [
    'BEGIN:VEVENT',
    'UID:e1',
    'SUMMARY:项目评审',
    'DTSTART;VALUE=DATE:20260918',
    'DTEND;VALUE=DATE:20260919',
    'END:VEVENT'
  ].join('\r\n')
)
const r1 = parseIcs(allDay, '2026-09-01', '2026-09-30')
eq('全天事件解析出 1 条', r1.length, 1)
eq('全天事件日期正确', { start: r1[0].start, end: r1[0].end, allDay: r1[0].allDay }, {
  start: '2026-09-18',
  end: '2026-09-18',
  allDay: true
})

// 2) 跨天事件：18 号到 20 号（DTEND 不含 21 号）
const multi = wrap(
  [
    'BEGIN:VEVENT',
    'UID:e2',
    'SUMMARY:出差',
    'DTSTART;VALUE=DATE:20260918',
    'DTEND;VALUE=DATE:20260921',
    'END:VEVENT'
  ].join('\r\n')
)
const r2 = parseIcs(multi, '2026-09-01', '2026-09-30')
eq('跨天事件末日在 09-20', { start: r2[0].start, end: r2[0].end }, { start: '2026-09-18', end: '2026-09-20' })

// 3) 定时事件：带时刻、不是全天
const timed = wrap(
  [
    'BEGIN:VEVENT',
    'UID:e3',
    'SUMMARY:周会',
    'DTSTART:20260918T140000',
    'DTEND:20260918T150000',
    'LOCATION:三楼会议室',
    'END:VEVENT'
  ].join('\r\n')
)
const r3 = parseIcs(timed, '2026-09-01', '2026-09-30')
eq('定时事件读出时刻与地点', { time: r3[0].time, allDay: r3[0].allDay, location: r3[0].location }, {
  time: '14:00',
  allDay: false,
  location: '三楼会议室'
})

// 4) 折行：ICS 每行超过 75 字节会折行，续行以空格开头
const folded = wrap(
  [
    'BEGIN:VEVENT',
    'UID:e4',
    'SUMMARY:这是一个特别长的标题用来验证折行处',
    ' 理是否正确拼接起来',
    'DTSTART;VALUE=DATE:20260918',
    'END:VEVENT'
  ].join('\r\n')
)
const r4 = parseIcs(folded, '2026-09-01', '2026-09-30')
eq('折行标题被正确拼回', r4[0].title, '这是一个特别长的标题用来验证折行处理是否正确拼接起来')

// 5) 转义字符
const escaped = wrap(
  [
    'BEGIN:VEVENT',
    'UID:e5',
    'SUMMARY:会议\\, 第一场\\; 请准时',
    'DTSTART;VALUE=DATE:20260918',
    'END:VEVENT'
  ].join('\r\n')
)
const r5 = parseIcs(escaped, '2026-09-01', '2026-09-30')
eq('转义逗号与分号被还原', r5[0].title, '会议, 第一场; 请准时')

// 6) RRULE：每天重复 3 次
const daily = wrap(
  [
    'BEGIN:VEVENT',
    'UID:e6',
    'SUMMARY:背单词',
    'DTSTART:20260918T200000',
    'RRULE:FREQ=DAILY;COUNT=3',
    'END:VEVENT'
  ].join('\r\n')
)
const r6 = parseIcs(daily, '2026-09-01', '2026-09-30')
eq('DAILY COUNT=3 展开成 3 天', r6.map((e) => e.start), ['2026-09-18', '2026-09-19', '2026-09-20'])

// 7) RRULE：每周一、周三。2026-09-18 是周五
const weekly = wrap(
  [
    'BEGIN:VEVENT',
    'UID:e7',
    'SUMMARY:健身',
    'DTSTART:20260907T190000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6',
    'END:VEVENT'
  ].join('\r\n')
)
const r7 = parseIcs(weekly, '2026-09-01', '2026-09-30')
const weekdaysOk = r7.every((e) => {
  const [y, m, d] = e.start.split('-').map(Number)
  const day = new Date(y, m - 1, d).getDay()
  return day === 1 || day === 3
})
check('WEEKLY BYDAY=MO,WE 只落在周一/周三', weekdaysOk, r7.map((e) => e.start).join(' '))
check('WEEKLY 命中 6 次（COUNT 生效）', r7.length === 6, `实际 ${r7.length} 条`)

// 8) 区间过滤：区间外的事件不该出现
const outside = wrap(
  [
    'BEGIN:VEVENT',
    'UID:e8',
    'SUMMARY:明年的事',
    'DTSTART;VALUE=DATE:20270601',
    'END:VEVENT'
  ].join('\r\n')
)
eq('区间外事件被过滤掉', parseIcs(outside, '2026-09-01', '2026-09-30').length, 0)

// 9) 没有 DTEND 的全天事件按单日处理
const noEnd = wrap(
  ['BEGIN:VEVENT', 'UID:e9', 'SUMMARY:单日', 'DTSTART;VALUE=DATE:20260918', 'END:VEVENT'].join('\r\n')
)
const r9 = parseIcs(noEnd, '2026-09-01', '2026-09-30')
eq('无 DTEND 时按单日', { start: r9[0].start, end: r9[0].end }, { start: '2026-09-18', end: '2026-09-18' })

// 10) 空日历 / 畸形内容不应抛错
eq('空字符串返回空数组', parseIcs('', '2026-09-01', '2026-09-30').length, 0)
eq(
  '缺 UID 的事件仍能解析',
  parseIcs(
    wrap(['BEGIN:VEVENT', 'SUMMARY:没有UID', 'DTSTART;VALUE=DATE:20260918', 'END:VEVENT'].join('\r\n')),
    '2026-09-01',
    '2026-09-30'
  ).length,
  1
)

// 11) 排序：同一天全天事件排前面
const mixed = wrap(
  [
    'BEGIN:VEVENT',
    'UID:m1',
    'SUMMARY:下午的会',
    'DTSTART:20260918T140000',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:m2',
    'SUMMARY:全天的事',
    'DTSTART;VALUE=DATE:20260918',
    'END:VEVENT'
  ].join('\r\n')
)
const r11 = parseIcs(mixed, '2026-09-01', '2026-09-30')
eq('同一天里全天事件排在定时事件前', r11.map((e) => e.summary ?? e.title), ['全天的事', '下午的会'])

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
console.log('UNIT_RESULT=' + (fail === 0 ? 'OK' : 'FAILED'))
process.exit(fail === 0 ? 0 : 1)
