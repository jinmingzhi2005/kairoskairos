/**
 * 日历同步集成测试（npm run test:sync）
 *
 * 启动真实主进程，让它去读一个真实存在的 .ics 文件，
 * 再验证：解析结果 → 落盘缓存 → 渲染层通过 IPC 取回，整条链路都通。
 *
 * 同时验证一个负面用例：订阅地址不可达时，源上要留下错误信息，
 * 而且要保留上一次的数据（不能把日历清空）。
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { app, BrowserWindow } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const BUILD = process.env.KAIROS_BUILD_DIR || 'out'
const MAIN = path.join(ROOT, BUILD, 'main', 'index.js')

if (!fs.existsSync(MAIN)) {
  console.error(`找不到构建产物：${MAIN}，请先 npm run build`)
  process.exit(1)
}

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'kairos-sync-'))
app.setPath('userData', WORK)

const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const shift = (base, days) => {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

const today = fmt(new Date())
const in3Days = fmt(shift(new Date(), 3))

/* ---------- 造一个真实的 .ics 文件 ---------- */
const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Kairos//Sync Test//CN',
  'CALSCALE:GREGORIAN',
  'BEGIN:VEVENT',
  'UID:sync-1',
  'SUMMARY:同步测试 · 部门例会',
  'DTSTART:' + today.replace(/-/g, '') + 'T100000',
  'DTEND:' + today.replace(/-/g, '') + 'T110000',
  'LOCATION:三楼会议室',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:sync-2',
  'SUMMARY:同步测试 · 全天培训',
  'DTSTART;VALUE=DATE:' + today.replace(/-/g, ''),
  'DTEND;VALUE=DATE:' + in3Days.replace(/-/g, ''),
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:sync-3',
  'SUMMARY:同步测试 · 每天站会',
  'DTSTART:' + today.replace(/-/g, '') + 'T090000',
  'RRULE:FREQ=DAILY;COUNT=3',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

const ICS_FILE = path.join(WORK, 'work.ics')
fs.writeFileSync(ICS_FILE, ICS, 'utf8')

/* ---------- 预置一个已启用的文件源 ---------- */
fs.writeFileSync(
  path.join(WORK, 'syncSources.json'),
  JSON.stringify([
    {
      id: 'src-test',
      kind: 'ics-file',
      label: '工作安排',
      target: ICS_FILE,
      color: '#2f6bff',
      enabled: true,
      eventCount: 0
    }
  ]),
  'utf8'
)

require(MAIN)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const wins = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
const calWin = () => wins().find((w) => w.webContents.getURL().includes('index.html'))

const results = []
function check(name, pass, detail) {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(30)} ${detail ?? ''}`)
}

app.whenReady().then(async () => {
  // initCalendarSync 在启动 3 秒后才会拉第一次，这里多等一会儿
  await sleep(8000)

  const cal = calWin()
  if (!cal) {
    console.log('FATAL=日历窗没起来')
    app.exit(1)
    return
  }

  /* ---------- 1. 解析结果落到缓存 ---------- */
  const cacheFile = path.join(WORK, 'syncEvents.json')
  const cached = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : []
  check('事件已写入本地缓存', cached.length > 0, `${cached.length} 条`)

  const titles = cached.map((e) => e.title)
  check(
    '单次事件解析正确',
    titles.includes('同步测试 · 部门例会'),
    titles.join(' | ')
  )
  check('重复规则展开正确（DAILY COUNT=3）', titles.filter((t) => t === '同步测试 · 每天站会').length === 3)
  check('全天事件解析正确', titles.includes('同步测试 · 全天培训'))

  const meeting = cached.find((e) => e.title === '同步测试 · 部门例会')
  check(
    '定时事件带上了时刻与地点',
    meeting && meeting.time === '10:00' && meeting.location === '三楼会议室',
    meeting ? `${meeting.time} @ ${meeting.location}` : '(没找到)'
  )

  /* ---------- 2. 渲染层能通过 IPC 取到 ---------- */
  const viaIpc = await cal.webContents.executeJavaScript(
    `window.kairos.eventsInRange(${JSON.stringify(today)}, ${JSON.stringify(in3Days)})
       .then((list) => JSON.stringify(list.length))
       .catch((e) => 'ERR:' + e.message)`
  )
  check('渲染层 IPC 能取到事件', /^\d+$/.test(viaIpc) && Number(viaIpc) > 0, `返回 ${viaIpc} 条`)

  /* ---------- 3. 同步状态正确回填 ---------- */
  const state = await cal.webContents.executeJavaScript(
    `window.kairos.getSyncState().then((s) => JSON.stringify({
       count: s.sources.length,
       label: s.sources[0] && s.sources[0].label,
       events: s.sources[0] && s.sources[0].eventCount,
       synced: Boolean(s.sources[0] && s.sources[0].lastSyncAt),
       error: s.sources[0] && s.sources[0].lastError
     }))`
  )
  const parsed = JSON.parse(state)
  check('源信息正确', parsed.count === 1 && parsed.label === '工作安排', JSON.stringify(parsed))
  check('源上记录了同步时间与事件数', parsed.synced && parsed.events > 0, `eventCount=${parsed.events}`)
  check('成功同步时不留错误信息', !parsed.error, String(parsed.error ?? '无'))

  /* ---------- 4. 负面用例：不可达的订阅地址 ---------- */
  const bad = await cal.webContents.executeJavaScript(
    `window.kairos.addIcsUrl('https://kairos-does-not-exist.invalid/feed.ics', '坏地址')
       .then((r) => JSON.stringify({ error: r.error || null, sources: r.state ? r.state.sources.length : 0 }))
       .catch((e) => 'ERR:' + e.message)`
  )
  check('无效订阅地址不会抛异常', !String(bad).startsWith('ERR:'), String(bad).slice(0, 60))

  // 等它拉取失败
  await sleep(6000)

  const afterBad = await cal.webContents.executeJavaScript(
    `window.kairos.getSyncState().then((s) => JSON.stringify({
       total: s.sources.length,
       badError: (s.sources.find((x) => x.label === '坏地址') || {}).lastError || null,
       goodCount: (s.sources.find((x) => x.label === '工作安排') || {}).eventCount
     }))`
  )
  const badState = JSON.parse(afterBad)
  check('失败源上留下错误原因', Boolean(badState.badError), String(badState.badError).slice(0, 50))
  check('失败不影响其他源的数据', badState.goodCount > 0, `正常源仍有 ${badState.goodCount} 条`)

  const finalCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
  check(
    '失败的源不会清空现有事件',
    finalCache.filter((e) => e.sourceId === 'src-test').length > 0,
    `缓存里还有 ${finalCache.length} 条`
  )

  const failed = results.filter((r) => !r.pass)
  console.log(`\n结果：${results.length - failed.length} 通过 / ${failed.length} 失败`)
  console.log('SYNC_RESULT=' + (failed.length === 0 ? 'OK' : 'FAILED'))

  try {
    fs.rmSync(WORK, { recursive: true, force: true })
  } catch {
    console.log(`（临时目录未清理：${WORK}）`)
  }
  app.exit(failed.length === 0 ? 0 : 1)
})
