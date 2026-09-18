/**
 * 冒烟测试
 *
 * 覆盖两个渲染入口：
 *   1) 日历主窗 —— DOM 结构、尺寸守卫、缩放把手（验证窗口几何计算）
 *   2) 强提醒弹窗 —— 内容渲染与按钮行为
 *
 * 运行：npm run smoke
 * 指定产物目录：KAIROS_BUILD_DIR=out-verify npm run smoke
 */
const { app, BrowserWindow, ipcMain, screen } = require('electron')
const { existsSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const BUILD = process.env.KAIROS_BUILD_DIR || 'out'
const DARK = process.env.KAIROS_DARK === '1'
const OUT_IMAGE = join(ROOT, 'prototype', DARK ? 'calendar-preview-dark.png' : 'calendar-preview.png')
const OUT_REMINDER = join(ROOT, 'prototype', 'reminder-preview.png')

const CARD = { x: 1100, y: 90, width: 344, height: 660 }

// 用「真实的今天」，否则断言会随日期漂移
const TODAY = (() => {
  const d = new Date()
  const p = (n) => (n < 10 ? `0${n}` : `${n}`)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})()

/** 模拟同步进来的电脑日历事件：今天两条 + 一条跨天的 */
const MOCK_EVENTS = [
  { uid: 's1:e1', title: '部门周会', start: TODAY, end: TODAY, allDay: false, time: '14:00', location: '三楼会议室', sourceId: 's1', color: '#2f6bff' },
  { uid: 's1:e2', title: '项目评审', start: TODAY, end: TODAY, allDay: true, sourceId: 's1', color: '#12a594' },
  { uid: 's1:e3', title: '出差', start: TODAY, end: TODAY, allDay: true, sourceId: 's1', color: '#8b5cf6' }
]

const MOCK_SYNC_STATE = {
  sources: [
    { id: 's1', kind: 'ics-file', label: '工作安排', target: 'C:/cal/work.ics', color: '#2f6bff', enabled: true, eventCount: 3, lastSyncAt: Date.now() },
    { id: 's2', kind: 'ics-url', label: 'calendar.example.com', target: 'https://calendar.example.com/feed.ics', color: '#12a594', enabled: false, eventCount: 0 }
  ],
  outlookAvailable: false,
  outlookChecked: true,
  refreshing: false,
  lastRefreshAt: Date.now()
}

const MOCK_TODOS = [
  { id: 't1', title: '每天 20:00 背单词', date: '2026-09-10', time: '20:00', notifySystem: true, notifyStrong: true, leadMinutes: 15, repeat: 'daily', done: false },
  { id: 't2', title: '和面试官确认 BGP 模拟面试时间', date: '2026-09-17', time: '16:30', notifySystem: false, notifyStrong: true, leadMinutes: 5, repeat: 'none', done: false },
  { id: 't3', title: '每周复盘项目进度', date: '2026-09-10', time: '21:00', notifySystem: true, notifyStrong: false, leadMinutes: 0, repeat: 'weekly', done: false },
  { id: 't4', title: '每月交房租', date: '2026-09-01', time: '09:00', notifySystem: false, notifyStrong: false, leadMinutes: 30, repeat: 'monthly', done: false }
]

const REMINDER_PAYLOAD = {
  id: 't2',
  title: '和面试官确认 BGP 模拟面试时间',
  date: '2026-09-17',
  time: '16:30',
  level: 'strong'
}

const captured = { setBounds: [], reminderActions: [] }

function displays() {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: `屏幕 ${i + 1}${d.id === primaryId ? ' · 主屏' : ''}`,
    bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
    workArea: { x: d.workArea.x, y: d.workArea.y, width: d.workArea.width, height: d.workArea.height },
    scaleFactor: d.scaleFactor,
    primary: d.id === primaryId
  }))
}

let calWinRef = null
// 模拟应用主进程的契约：对渲染层暴露的始终是「名义几何」，
// 系统对窗口的尺寸补偿由主进程内部消化（见 calendarWindow.ts 的 compensate）
let intended = { ...CARD }

function registerStubs() {
  ipcMain.handle('settings:get', () => ({
    autoStart: true,
    snoozeMinutes: 10,
    theme: 'light',
    calendarMode: 'desktop',
    showHolidays: true,
    showLunar: true,
    holidayRegion: 'CN',
    syncIntervalMinutes: 30
  }))
  ipcMain.handle('settings:patch', (_e, patch) => patch)
  ipcMain.handle('runtime:get', () => ({ autoStart: true, packaged: false }))
  ipcMain.handle('autostart:set', () => true)
  ipcMain.handle('todo:list', () => MOCK_TODOS)
  ipcMain.handle('todo:add', () => MOCK_TODOS[0])
  ipcMain.handle('todo:toggle', () => MOCK_TODOS)
  ipcMain.handle('todo:remove', () => MOCK_TODOS)
  ipcMain.handle('todo:snooze', () => MOCK_TODOS)
  ipcMain.handle('todo:update', () => MOCK_TODOS)
  ipcMain.handle('window:bounds', () => ({ ...intended, displays: displays() }))
  ipcMain.on('window:set-bounds', (_e, bounds) => {
    captured.setBounds.push(bounds)
    intended = {
      x: bounds.x ?? intended.x,
      y: bounds.y ?? intended.y,
      width: bounds.width ?? intended.width,
      height: bounds.height ?? intended.height
    }
    // 同时真的改窗口大小，尽量贴近真实运行
    if (calWinRef && !calWinRef.isDestroyed()) calWinRef.setBounds(bounds)
  })
  ipcMain.on('window:hide', () => undefined)
  ipcMain.on('app:quit', () => undefined)
  ipcMain.on('reminder:test', () => undefined)
  ipcMain.handle('reminder:data', () => REMINDER_PAYLOAD)
  ipcMain.handle('sync:state', () => MOCK_SYNC_STATE)
  ipcMain.handle('sync:events', () => MOCK_EVENTS)
  ipcMain.handle('sync:toggle', () => MOCK_SYNC_STATE)
  ipcMain.handle('sync:remove', () => MOCK_SYNC_STATE)
  ipcMain.handle('sync:refresh', () => MOCK_SYNC_STATE)
  ipcMain.handle('sync:add-url', () => ({ state: MOCK_SYNC_STATE }))
  ipcMain.handle('sync:add-file', () => ({ canceled: true }))
  ipcMain.handle('sync:add-outlook', () => ({ error: '冒烟测试不探测 Outlook' }))
  ipcMain.on('reminder:action', (_e, action) => captured.reminderActions.push(action))
}

function makeWindow(width, height, x, y) {
  return new BrowserWindow({
    x,
    y,
    width,
    height,
    show: true,
    frame: false,
    transparent: true,
    // 必须与应用保持一致：resizable 打开会带来一圈不可见缩放边框，干扰几何测量
    resizable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(ROOT, BUILD, 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
}

async function settle(webContents, ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
  webContents.invalidate()
  await new Promise((resolve) => setTimeout(resolve, 500))
}

// KAIROS_DARK=1 时强制深色，用来给深色模式截一张图做人工核对
const { nativeTheme } = require('electron')
if (process.env.KAIROS_DARK === '1') {
  nativeTheme.themeSource = 'dark'
  console.log('DARK_MODE=on')
}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')

app.whenReady().then(async () => {
  registerStubs()

  const entry = join(ROOT, BUILD, 'renderer', 'index.html')
  const reminderEntry = join(ROOT, BUILD, 'renderer', 'reminder.html')
  if (!existsSync(entry) || !existsSync(reminderEntry)) {
    console.error(`构建产物不存在：${entry} / ${reminderEntry}，请先执行 npm run build`)
    app.exit(1)
    return
  }

  /* ================= 1. 日历主窗 ================= */
  const cal = makeWindow(CARD.width, CARD.height, CARD.x, CARD.y)
  calWinRef = cal
  const errors = []
  cal.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message)
  })
  cal.webContents.on('render-process-gone', (_e, details) => {
    errors.push(`日历窗渲染进程崩溃: ${details.reason}`)
  })

  await cal.loadFile(entry)
  await new Promise((resolve) => setTimeout(resolve, 1500))

  const probe = `(() => {
    const q = (s) => document.querySelectorAll(s).length
    const card = document.querySelector('.card')
    const cr = card ? card.getBoundingClientRect() : null
    return JSON.stringify({
      root: document.getElementById('root').children.length,
      card: !!card,
      cardFillsWindow: cr ? (Math.round(cr.width) === window.innerWidth && Math.round(cr.height) === window.innerHeight) : false,
      header: q('.head'),
      dayCells: q('.day'),
      gridCells: q('.grid > *'),
      resizeHandles: q('.rs'),
      todoRows: q('.todo'),
      repeatBadges: q('.pill.repeat'),
      /* 每条待办自己的两个提醒开关 */
      channelChips: q('.todo .chip'),
      chipsOn: Array.from(document.querySelectorAll('.todo .chip.on')).map((el) => el.textContent),
      chipsOff: Array.from(document.querySelectorAll('.todo .chip:not(.on)')).map((el) => el.textContent),
      leadBadges: q('.pill.lead'),
      formSelects: q('.add select'),
      settingRows: q('.set-row'),
      /* 新增：法定节假日与调休标记 */
      holidayCells: q('.day.holiday'),
      makeupCells: q('.day.makeup'),
      holidayLabels: Array.from(document.querySelectorAll('.day.holiday .lunar')).map((el) => el.textContent),
      makeupLabels: Array.from(document.querySelectorAll('.day.makeup .lunar')).map((el) => el.textContent),
      /* 新增：同步来的日程 */
      eventRows: q('.evt'),
      eventTitles: Array.from(document.querySelectorAll('.evt .nm')).map((el) => el.textContent),
      eventDots: q('.day .dots i.ev'),
      title: (document.querySelector('.head .title') || {}).textContent || null,
      firstCellText: (document.querySelector('.day:not(.blank)') || {}).textContent || null
    })
  })()`
  console.log('CAL_PROBE=' + (await cal.webContents.executeJavaScript(probe)))

  /* 缩放：拖右下手把 +80/+40，断言传给主进程的窗口几何 */
  const resize = `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const fire = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1,
      pointerId: 1, pointerType: 'mouse', isPrimary: true,
      clientX: x, clientY: y, screenX: x, screenY: y
    }));
    const se = document.querySelector('.rs-se');
    const sw = document.querySelector('.rs-w');
    const box = se.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;

    fire(se, 'pointerdown', cx, cy);
    await sleep(120);
    fire(window, 'pointermove', cx + 80, cy + 40);
    await sleep(120);
    fire(window, 'pointerup', cx + 80, cy + 40);
    await sleep(150);

    const wbox = sw.getBoundingClientRect();
    const wx = wbox.left + wbox.width / 2, wy = wbox.top + 60;
    fire(sw, 'pointerdown', wx, wy);
    await sleep(120);
    fire(window, 'pointermove', wx - 60, wy);
    await sleep(120);
    fire(window, 'pointerup', wx - 60, wy);
    await sleep(150);
    return 'done';
  })()`
  await cal.webContents.executeJavaScript(resize)

  const calls = captured.setBounds
  const grew = calls[0] || null
  // 第一次（右下角 +80/+40）之后窗口真的变大了，第二次（左边缘 -60）应当以新尺寸为基准
  const base = grew ? { x: grew.x, y: grew.y, width: grew.width, height: grew.height } : null
  const shrunk = base ? calls.find((c) => c.width !== base.width) || null : null
  console.log('RESIZE_CALLS_COUNT=' + calls.length)
  console.log('RESIZE_FIRST=' + JSON.stringify(grew))
  console.log('RESIZE_LEFT_EDGE=' + JSON.stringify(shrunk))
  console.log('RESIZE_CHECK=' + JSON.stringify({
    seGrewCorrectly: Boolean(grew) && grew.width === CARD.width + 80 && grew.height === CARD.height + 40 && grew.x === CARD.x && grew.y === CARD.y,
    wGrewLeftAndKeptRightEdge: Boolean(base && shrunk) &&
      shrunk.width === base.width + 60 &&
      shrunk.x === base.x - 60 &&
      shrunk.x + shrunk.width === base.x + base.width
  }))

  /* 尺寸守卫：防止短类名和全局样式撞车把元素撑大 */
  const guard = `(() => {
    const issues = [];
    document.querySelectorAll('.day .dots i').forEach(function (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 10 || r.height > 10) issues.push('待办圆点尺寸异常 ' + Math.round(r.width) + 'x' + Math.round(r.height));
    });
    document.querySelectorAll('.day').forEach(function (cell) {
      const cr = cell.getBoundingClientRect();
      cell.querySelectorAll('*').forEach(function (child) {
        const ch = child.getBoundingClientRect();
        if (ch.width > cr.width + 2 || ch.height > cr.height + 2) {
          issues.push('子元素超出日期格 ' + child.tagName + '.' + child.className + ' ' + Math.round(ch.width) + 'x' + Math.round(ch.height));
        }
      });
    });
    return JSON.stringify(issues);
  })()`
  const issues = JSON.parse(await cal.webContents.executeJavaScript(guard))
  console.log('LAYOUT_GUARD=' + JSON.stringify(issues))
  if (issues.length > 0) console.error('尺寸守卫失败，疑似 CSS 类名撞车或布局溢出')

  await cal.webContents.executeJavaScript(
    `document.body.style.background = 'linear-gradient(158deg,#eef3fb,#dfe8f6 55%,#eef1f8)'; 'ok'`
  )
  await settle(cal.webContents, 300)
  writeFileSync(OUT_IMAGE, (await cal.webContents.capturePage()).toPNG())
  console.log('PREVIEW_CAL=' + OUT_IMAGE)
  cal.close()

  /* ================= 2. 强提醒弹窗 ================= */
  const rem = makeWindow(420, 340, CARD.x + 40, CARD.y + 200)
  rem.webContents.on('render-process-gone', (_e, details) => {
    errors.push(`提醒窗渲染进程崩溃: ${details.reason}`)
  })
  await rem.loadFile(reminderEntry)
  await new Promise((resolve) => setTimeout(resolve, 1200))

  const remProbe = `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(400);
    const modal = document.querySelector('.reminder');
    const title = (document.querySelector('.reminder h3') || {}).textContent || null;
    const buttons = Array.from(document.querySelectorAll('.reminder .acts .btn')).map((b) => b.textContent.trim());
    const before = (document.querySelector('.reminder .time') || {}).textContent || null;
    const done = document.querySelector('.reminder .acts .btn.primary');
    if (done) done.click();
    await sleep(200);
    return JSON.stringify({ modal: !!modal, title, buttons, before });
  })()`
  console.log('REMINDER_PROBE=' + (await rem.webContents.executeJavaScript(remProbe)))
  console.log('REMINDER_ACTIONS=' + JSON.stringify(captured.reminderActions))

  await rem.webContents.executeJavaScript(
    `document.body.style.background = 'linear-gradient(158deg,#eef3fb,#dfe8f6 55%,#eef1f8)'; 'ok'`
  )
  await settle(rem.webContents, 300)
  writeFileSync(OUT_REMINDER, (await rem.webContents.capturePage()).toPNG())
  console.log('PREVIEW_REMINDER=' + OUT_REMINDER)
  rem.close()

  console.log('RENDERER_ERRORS=' + JSON.stringify(errors))
  const ok =
    issues.length === 0 &&
    errors.length === 0 &&
    captured.setBounds.length >= 2 &&
    captured.reminderActions.includes('done')
  console.log('SMOKE_RESULT=' + (ok ? 'OK' : 'FAILED'))
  app.exit(ok ? 0 : 1)
})
