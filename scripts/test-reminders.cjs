/**
 * 提醒调度集成测试
 *
 * 做法：往临时 userData 目录塞一份构造好的 todos.json，启动真实主进程跑十几秒，
 * 再读回 todos.json，检查哪些该触发（写了 lastFiredDate）、哪些不该触发。
 *
 * 运行：node scripts/test-reminders.cjs
 */
const { spawn } = require('node:child_process')
const { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const os = require('node:os')

const ROOT = join(__dirname, '..')
const BUILD = process.env.KAIROS_BUILD_DIR || 'out-verify'
// 每次用全新目录，避免「删除旧目录」这个动作（受限环境的删除保护会拦 rmSync，
// 而且残留目录还可能让上一次的 lastFiredDate 污染本次结果）
const USER_DIR = process.env.KAIROS_TEST_UD || mkdtempSync(join(os.tmpdir(), 'kairos-reminder-'))

/**
 * 「已经过了的时刻」统一用 00:01。
 * 早前写死 08:00，导致测试结果取决于什么时候跑：
 * 早上 8 点前跑，「今天 08:00 的事项」其实还没到点，期望值就对不上了。
 */
const PAST_TIME = '00:01'

function dayKey(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const p = (n) => (n < 10 ? `0${n}` : `${n}`)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const today = dayKey(0)
const weekdayToday = new Date().getDay()
// 找一个「和今天星期不同」的日期，用来验证每周规则不会误触发
const otherWeekdayOffset = weekdayToday === 2 ? -6 : -2

const cases = [
  { id: 'a-once-past', date: today, time: PAST_TIME, repeat: 'none', leadMinutes: 0, expect: true, why: '今天已过时间的一次性事项' },
  { id: 'b-daily', date: dayKey(-7), time: PAST_TIME, repeat: 'daily', leadMinutes: 0, expect: true, why: '每天重复，锚点是一周前' },
  { id: 'c-weekly-same', date: dayKey(-7), time: PAST_TIME, repeat: 'weekly', leadMinutes: 0, expect: true, why: '每周重复且今天正好是同一星期几' },
  { id: 'd-weekly-other', date: dayKey(otherWeekdayOffset), time: PAST_TIME, repeat: 'weekly', leadMinutes: 0, expect: false, why: '每周重复但今天不是那个星期几' },
  { id: 'e-future', date: dayKey(3), time: '09:00', repeat: 'none', leadMinutes: 0, expect: false, why: '未来的一次性事项' },
  { id: 'f-lead', date: today, time: '02:00', repeat: 'none', leadMinutes: 30, expect: true, why: '带 30 分钟提前量，时间已过' },
  { id: 'g-done', date: today, time: PAST_TIME, repeat: 'none', leadMinutes: 0, done: true, expect: false, why: '已完成的一次性事项' },
  { id: 'h-weekday', date: dayKey(-3), time: PAST_TIME, repeat: 'weekday', leadMinutes: 0, expect: weekdayToday >= 1 && weekdayToday <= 5, why: '工作日重复' },
  /* 提醒通道相关的用例：两个开关可以任意组合 */
  { id: 'i-only-system', date: today, time: PAST_TIME, repeat: 'none', leadMinutes: 0, notifySystem: true, notifyStrong: false, expect: true, why: '只开系统通知' },
  { id: 'j-only-strong', date: today, time: PAST_TIME, repeat: 'none', leadMinutes: 0, notifySystem: false, notifyStrong: true, expect: true, why: '只开强提醒' },
  { id: 'k-both', date: today, time: PAST_TIME, repeat: 'none', leadMinutes: 0, notifySystem: true, notifyStrong: true, expect: true, why: '两个都开：先系统通知，再升级强提醒' },
  { id: 'l-none', date: today, time: PAST_TIME, repeat: 'none', leadMinutes: 0, notifySystem: false, notifyStrong: false, expect: true, why: '两个都不开：只记账不打扰' }
]

const todos = cases.map((item) => ({
  id: item.id,
  title: item.why,
  date: item.date,
  time: item.time,
  // 默认「只发系统通知」，跟绝大多数用例的语义一致
  notifySystem: item.notifySystem ?? true,
  notifyStrong: item.notifyStrong ?? false,
  leadMinutes: item.leadMinutes,
  repeat: item.repeat,
  done: Boolean(item.done)
}))

mkdirSync(USER_DIR, { recursive: true })
writeFileSync(join(USER_DIR, 'todos.json'), JSON.stringify(todos, null, 2), 'utf8')

console.log(`今天=${today} 星期=${weekdayToday}`)
console.log(`构造 ${todos.length} 条待办，写入 ${USER_DIR}`)

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS
// 把轮询压到 1.5 秒、升级延迟压到 3 秒，
// 否则「先系统通知 → 5 分钟后强提醒」这条链路根本没法在测试里验证
env.KAIROS_TICK_MS = '1500'
env.KAIROS_ESCALATE_MS = '3000'
env.PATH = `${join(ROOT, 'node_modules', '.bin')};${env.PATH || ''}`

const child = spawn(
  'electron',
  [join(ROOT, BUILD, 'main', 'index.js'), `--user-data-dir=${USER_DIR}`, '--no-sandbox', '--disable-gpu', '--disable-gpu-compositing'],
  { cwd: ROOT, env, shell: true, stdio: 'ignore' }
)

setTimeout(() => {
  try {
    process.kill(child.pid)
  } catch {
    /* 忽略 */
  }
  setTimeout(finish, 800)
}, 14000)

function finish() {
  try {
    // 只收掉自己这棵进程树。
    // 早前用的是 `/im electron.exe`（按映像名无差别杀），
    // 结果在一条命令里串联跑多个测试时，会把下一个测试的窗口一起杀掉。
    spawn('taskkill', ['/f', '/t', '/pid', String(child.pid)], { shell: true, stdio: 'ignore' })
  } catch {
    /* 忽略 */
  }

  const file = join(USER_DIR, 'todos.json')
  if (!existsSync(file)) {
    console.error('失败：todos.json 不存在，主进程可能没跑起来')
    process.exit(1)
  }

  const result = JSON.parse(readFileSync(file, 'utf8'))
  const byId = Object.fromEntries(result.map((item) => [item.id, item]))

  let pass = 0
  let fail = 0
  for (const item of cases) {
    const saved = byId[item.id] || {}
    const fired = Boolean(saved.lastFiredDate)
    const ok = fired === item.expect
    if (ok) pass += 1
    else fail += 1
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${item.id.padEnd(16)} 触发=${String(fired).padEnd(5)} 期望=${String(item.expect).padEnd(5)} ${item.why}`
    )
  }

  /* ---------- 提醒通道的专项断言 ---------- */
  const both = byId['k-both']
  // 两段式：第一次 tick 发系统通知并挂起强提醒，延迟到点后弹强提醒并清空挂起项
  if (both && both.lastFiredDate && !both.pendingStrong && both.notifiedAt) {
    console.log(`PASS  k-both 两段升级完成（系统通知 → 强提醒，挂起项已清空）`)
    pass += 1
  } else {
    console.log(
      `FAIL  k-both 升级链路异常：lastFiredDate=${both ? both.lastFiredDate : 'N/A'} ` +
        `pendingStrong=${both ? JSON.stringify(both.pendingStrong) : 'N/A'}`
    )
    fail += 1
  }

  // 只开强提醒：不该有挂起项，应该直接弹
  const onlyStrong = byId['j-only-strong']
  if (onlyStrong && onlyStrong.lastFiredDate && !onlyStrong.pendingStrong) {
    console.log('PASS  j-only-strong 直接弹强提醒，没有多余的挂起项')
    pass += 1
  } else {
    console.log(`FAIL  j-only-strong 状态异常：${JSON.stringify(onlyStrong)}`)
    fail += 1
  }

  // 只开系统通知：不该产生强提醒挂起项
  const onlySystem = byId['i-only-system']
  if (onlySystem && onlySystem.lastFiredDate && !onlySystem.pendingStrong) {
    console.log('PASS  i-only-system 只发系统通知，不弹强提醒')
    pass += 1
  } else {
    console.log(`FAIL  i-only-system 状态异常：${JSON.stringify(onlySystem)}`)
    fail += 1
  }

  // 两个都不开：仍然要记账（否则会被反复判定）
  const none = byId['l-none']
  if (none && none.lastFiredDate) {
    console.log('PASS  l-none 两个都不开时只记账、不提醒')
    pass += 1
  } else {
    console.log(`FAIL  l-none 没有记账：${JSON.stringify(none)}`)
    fail += 1
  }

  const daily = byId['b-daily']
  if (daily && daily.lastFiredDate === today) {
    console.log(`PASS  b-daily 的 lastFiredDate=${today}（正确记录本次发生日）`)
    pass += 1
  } else {
    console.log(`FAIL  b-daily 的 lastFiredDate=${daily ? daily.lastFiredDate : 'N/A'}，期望 ${today}`)
    fail += 1
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  console.log(fail === 0 ? 'REMINDER_TEST=OK' : 'REMINDER_TEST=FAILED')
  process.exit(fail === 0 ? 0 : 1)
}
