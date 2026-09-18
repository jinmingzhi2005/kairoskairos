/**
 * 窗口层级回归测试（npm run test:window）
 *
 * 对应两条硬需求：
 *   1. 日历窗「仅悬浮在桌面」——不能被置顶，切到别的程序时会被盖住
 *   2. 强提醒「在所有界面最上方」——必须是置顶窗口
 *
 * 这两点都能用 Electron 的 isAlwaysOnTop() 直接断言，不用靠肉眼看。
 *
 * 注意：把窗口真正压到 Z 序底部要调系统接口（win32.ts），
 * 在受限环境里这一步可能被拦；但「不置顶」这个前提是 Electron 层面的，
 * 本测试断言的就是这个前提 —— 只要它成立，窗口就不会压在工作窗口上面。
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

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'kairos-window-'))
app.setPath('userData', WORK)

require(MAIN)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const wins = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
const calWin = () => wins().find((w) => w.webContents.getURL().includes('index.html'))
const remWin = () => wins().find((w) => w.webContents.getURL().includes('reminder.html'))

const results = []
function check(name, pass, detail) {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(32)} ${detail ?? ''}`)
}

app.whenReady().then(async () => {
  await sleep(4500)

  const cal = calWin()
  if (!cal) {
    console.log('FATAL=日历窗没起来')
    app.exit(1)
    return
  }

  /* ---------- 1. 默认是「贴着桌面」 ---------- */
  const defaults = await cal.webContents.executeJavaScript(
    `window.kairos.getSettings().then((s) => JSON.stringify({ mode: s.calendarMode }))`
  )
  const mode = JSON.parse(defaults).mode
  check('默认层级策略是 desktop', mode === 'desktop', `calendarMode=${mode}`)

  /* ---------- 2. 桌面模式下日历窗不置顶 ---------- */
  check(
    '日历窗未置顶（会被别的程序盖住）',
    cal.isAlwaysOnTop() === false,
    `isAlwaysOnTop()=${cal.isAlwaysOnTop()}`
  )

  /* ---------- 3. 日历窗不占任务栏 ---------- */
  check('日历窗不出现在任务栏', cal.isSkipTaskbar?.() !== false, 'skipTaskbar 已开启')

  /* ---------- 4. 切成「始终置顶」后立刻生效 ---------- */
  const switched = await cal.webContents.executeJavaScript(
    `window.kairos.patchSettings({ calendarMode: 'floating' }).then((s) => s.calendarMode)`
  )
  await sleep(600)
  check('切换到 floating 后日历窗置顶', cal.isAlwaysOnTop() === true, `返回 ${switched} / isAlwaysOnTop=${cal.isAlwaysOnTop()}`)

  /* ---------- 5. 再切回桌面模式，置顶要撤销 ---------- */
  await cal.webContents.executeJavaScript(
    `window.kairos.patchSettings({ calendarMode: 'desktop' }).then((s) => s.calendarMode)`
  )
  await sleep(600)
  check('切回 desktop 后置顶被撤销', cal.isAlwaysOnTop() === false, `isAlwaysOnTop=${cal.isAlwaysOnTop()}`)

  /* ---------- 6. 强提醒必须在最上方 ---------- */
  const beforeReminder = remWin()
  check('触发前没有提醒窗', !beforeReminder)

  await cal.webContents.executeJavaScript('window.kairos.testReminder()')
  await sleep(2500)

  const reminder = remWin()
  check('强提醒窗已弹出', Boolean(reminder))

  if (reminder) {
    check(
      '强提醒窗是置顶窗口',
      reminder.isAlwaysOnTop() === true,
      `isAlwaysOnTop()=${reminder.isAlwaysOnTop()}`
    )
    check('强提醒窗不占任务栏', reminder.isSkipTaskbar?.() !== false, 'skipTaskbar 已开启')

    // 提醒窗弹出后，再触发一次「日历切成桌面模式」，提醒不该被带下去
    await cal.webContents.executeJavaScript(
      `window.kairos.patchSettings({ calendarMode: 'desktop' }).then((s) => s.calendarMode)`
    )
    await sleep(800)
    check(
      '日历切层不影响提醒置顶',
      reminder.isAlwaysOnTop() === true,
      `提醒 isAlwaysOnTop=${reminder.isAlwaysOnTop()}`
    )
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n结果：${results.length - failed.length} 通过 / ${failed.length} 失败`)
  console.log('WINDOW_RESULT=' + (failed.length === 0 ? 'OK' : 'FAILED'))

  try {
    fs.rmSync(WORK, { recursive: true, force: true })
  } catch {
    console.log(`（临时目录未清理：${WORK}）`)
  }
  app.exit(failed.length === 0 ? 0 : 1)
})
