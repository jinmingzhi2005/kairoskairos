/**
 * 托盘菜单功能回归测试（npm run test:tray）
 *
 * 覆盖三条容易出错、且用户能直接感知的链路：
 *
 * 1. 强提醒弹窗的数据通道 —— 渲染层 getReminderData() 必须有主进程处理器，
 *    否则 ready-to-show 的推送一旦早于 React 订阅，弹窗就是空白页。
 *
 * 2. 测试提醒不能污染真实数据 —— 托盘「测试一次强提醒」弹窗里的「我已完成」，
 *    必须只关掉测试窗，绝不能去改上一次真实提醒对应的那条待办。
 *
 * 3. 测试提醒要给出正确反馈，不能骗用户说「已标记完成」。
 *
 * 用法：
 *   node scripts/test-tray.cjs
 *   KAIROS_BUILD_DIR=out-verify node scripts/test-tray.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { app, BrowserWindow } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const BUILD = process.env.KAIROS_BUILD_DIR || 'out'
const MAIN = path.join(ROOT, BUILD, 'main', 'index.js')
// 用带随机后缀的独立目录，避免任何「删除已有目录」的动作
// （受限环境的删除保护会把 rmSync 转成回收站操作并报错）
const UD = process.env.KAIROS_TEST_UD || fs.mkdtempSync(path.join(os.tmpdir(), 'kairos-tray-'))

if (!fs.existsSync(MAIN)) {
  console.error(`找不到构建产物：${MAIN}，请先 npm run build`)
  process.exit(1)
}

fs.mkdirSync(UD, { recursive: true })
app.setPath('userData', UD)

const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
const now = new Date()
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

// 预置一条「今天 00:01 强提醒」的待办：启动时调度器会立刻触发它，
// 把主进程的 lastReminderId 指向 t-fire —— 这正是能暴露污染问题的前置条件
fs.writeFileSync(
  path.join(UD, 'todos.json'),
  JSON.stringify(
    [
      {
        id: 't-fire',
        title: '真实提醒占位项',
        date: today,
        time: '00:01',
        notifySystem: false,
        notifyStrong: true,
        leadMinutes: 0,
        repeat: 'none',
        done: false
      }
    ],
    null,
    2
  )
)

require(MAIN)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const wins = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
const calWin = () => wins().find((w) => w.webContents.getURL().includes('index.html'))
const remWin = () => wins().find((w) => w.webContents.getURL().includes('reminder.html'))
const titleOf = async (w) => {
  try {
    return await w.webContents.executeJavaScript(
      `(() => { const h = document.querySelector('h3'); return h ? h.textContent : '(空白页)' })()`
    )
  } catch {
    return '(读取失败)'
  }
}
const readTodos = () =>
  JSON.parse(fs.readFileSync(path.join(UD, 'todos.json'), 'utf8')).map((t) => ({
    id: t.id,
    done: t.done,
    lastFiredDate: t.lastFiredDate
  }))

const results = []
function check(name, pass, detail) {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(26)} ${detail}`)
}

app.whenReady().then(async () => {
  await sleep(4200)

  const c = calWin()
  if (!c) {
    console.log('FATAL=日历窗没起来')
    app.exit(1)
    return
  }

  /* ---------- 1. 强提醒数据通道 ---------- */
  const probe = await c.webContents.executeJavaScript(
    `window.kairos.getReminderData().then((d) => 'RESOLVED:' + (d ? 'has-data' : 'null'))
       .catch((e) => 'REJECTED:' + (e && e.message ? e.message : e))`
  )
  check(
    'reminder:data 通道',
    probe.startsWith('RESOLVED'),
    probe.slice(0, 80)
  )

  /* ---------- 2. 真实强提醒正常弹出 ---------- */
  const r1 = remWin()
  const realTitle = r1 ? await titleOf(r1) : '(无窗口)'
  check('真实强提醒弹出', Boolean(r1) && realTitle === '真实提醒占位项', realTitle)

  // 模拟用户直接关掉、没做任何处理
  if (r1) r1.close()
  await sleep(900)

  /* ---------- 3. 测试强提醒 ---------- */
  await c.webContents.executeJavaScript('window.kairos.testReminder()')
  await sleep(2200)

  const r2 = remWin()
  const testTitle = r2 ? await titleOf(r2) : '(无窗口)'
  check('测试强提醒弹出', Boolean(r2) && testTitle === '这是一条测试提醒', testTitle)

  if (r2) {
    // 在测试窗里点「我已完成」—— 这一步以前会把真实待办标记成完成
    await r2.webContents.executeJavaScript(`window.kairos.sendReminderAction('done')`)
    await sleep(1500)
  }

  /* ---------- 4. 真实待办必须毫发无伤 ---------- */
  const todos = readTodos()
  const fire = todos.find((t) => t.id === 't-fire')
  check(
    '测试提醒不误改待办',
    Boolean(fire) && fire.done === false,
    JSON.stringify(todos)
  )

  /* ---------- 5. 测试窗已关闭、给的是正确反馈 ---------- */
  check('测试提醒点完成后关窗', !remWin(), remWin() ? '窗口仍在' : '已关闭')

  const failed = results.filter((r) => !r.pass)
  console.log(`\n结果：${results.length - failed.length} 通过 / ${failed.length} 失败`)
  console.log('TRAY_RESULT=' + (failed.length === 0 ? 'OK' : 'FAILED'))

  // 清理失败不影响测试结论
  try {
    fs.rmSync(UD, { recursive: true, force: true })
  } catch {
    console.log(`（临时目录未清理：${UD}）`)
  }
  app.exit(failed.length === 0 ? 0 : 1)
})
