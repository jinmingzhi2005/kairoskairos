import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  STRONG_ESCALATE_MINUTES,
  type AppSettings,
  type RuntimeState,
  type SyncState,
  type SyncedEvent,
  type TodoItem
} from '@shared/types'
import { holidaySummary } from '@shared/holidays'
import { LEAD_OPTIONS, leadLabel, occursOn, repeatLabel, REPEAT_OPTIONS, type RepeatRule } from '@shared/repeat'
import { Toasts } from '../components/Toasts'
import { useToasts } from '../hooks/useToasts'
import { buildMonth, DOW, dstr, shiftDate, todayStr } from '../lib/date'
import { RESIZE_DIRS, useWindowResize } from '../lib/resize'

const SNOOZE_OPTIONS = [5, 10, 15, 30]
const SYNC_INTERVAL_OPTIONS = [0, 15, 30, 60, 180]

/** 日历格子里一天最多画几个事件点 */
const MAX_DOTS = 3
/** 选中日的日程列表最多展开几条，其余折叠成「还有 N 条」 */
const MAX_EVENTS_SHOWN = 2
/** 单个事件往格子上铺开的天数上限，防止畸形数据把内存撑爆 */
const MAX_SPAN_DAYS = 60

export function CalendarApp(): JSX.Element {
  const api = window.kairos
  const { toasts, push } = useToasts()
  const { resizing, onResizeStart } = useWindowResize()

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [runtime, setRuntime] = useState<RuntimeState>({ autoStart: false, packaged: false })
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [events, setEvents] = useState<SyncedEvent[]>([])
  const [sync, setSync] = useState<SyncState>({
    sources: [],
    outlookAvailable: false,
    outlookChecked: false,
    refreshing: false
  })
  const [today, setToday] = useState(todayStr())
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [cal, setCal] = useState(() => {
    const now = new Date()
    return { y: now.getFullYear(), m: now.getMonth() }
  })
  const [showSettings, setShowSettings] = useState(false)
  const [urlInput, setUrlInput] = useState('')

  const [title, setTitle] = useState('')
  const [time, setTime] = useState('09:00')
  // 两个独立的提醒开关，可以任意组合
  const [notifySystem, setNotifySystem] = useState(true)
  const [notifyStrong, setNotifyStrong] = useState(false)
  const [lead, setLead] = useState(0)
  const [repeat, setRepeat] = useState<RepeatRule>('none')

  /* ---------- 初始化与主进程事件 ---------- */
  useEffect(() => {
    void api.getSettings().then(setSettings)
    void api.getRuntime().then(setRuntime)
    void api.listTodos().then(setTodos)
    void api.getSyncState().then(setSync)

    const offRuntime = api.onRuntimeChanged((state) => {
      setRuntime(state)
      // 托盘和全局热键也能切换开机自启，这里必须跟着同步，
      // 否则设置面板里的开关会和系统里的真实状态对不上
      setSettings((prev) => ({ ...prev, autoStart: state.autoStart }))
    })
    const offToast = api.onToast((message) => push(message))
    const offTodos = api.onTodosChanged(() => {
      void api.listTodos().then(setTodos)
    })
    const offReminder = api.onReminder((payload) => {
      if (payload) push(`提醒：${payload.title}`)
      void api.listTodos().then(setTodos)
    })
    const offSync = api.onSyncChanged(setSync)

    return () => {
      offRuntime()
      offToast()
      offTodos()
      offReminder()
      offSync()
    }
  }, [api, push])

  // 跨零点自动刷新「今天」
  useEffect(() => {
    const timer = window.setInterval(() => setToday(todayStr()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  /* ---------- 同步事件按需拉取 ---------- */
  const reloadEvents = useCallback(() => {
    const first = dstr(cal.y, cal.m, 1)
    const last = dstr(cal.y, cal.m, new Date(cal.y, cal.m + 1, 0).getDate())
    // 前后各多取一周，避免跨月事件在边界上漏掉
    void api.eventsInRange(shiftDate(first, -7), shiftDate(last, 7)).then(setEvents)
  }, [api, cal])

  useEffect(() => {
    reloadEvents()
  }, [reloadEvents, sync.lastRefreshAt])

  /** 日期 → 当天事件。跨天事件会铺到经过的每一天 */
  const eventsByDate = useMemo(() => {
    const map = new Map<string, SyncedEvent[]>()
    for (const event of events) {
      let cursor = event.start
      let guard = 0
      while (cursor <= event.end && guard < MAX_SPAN_DAYS) {
        const list = map.get(cursor)
        if (list) list.push(event)
        else map.set(cursor, [event])
        cursor = shiftDate(cursor, 1)
        guard += 1
      }
    }
    return map
  }, [events])

  /* ---------- 待办与日程 ---------- */
  const dayList = useMemo(
    () => todos.filter((todo) => occursOn(todo.date, todo.repeat, selectedDate)),
    [todos, selectedDate]
  )

  const dayEvents = useMemo(
    () => (eventsByDate.get(selectedDate) ?? []).slice(),
    [eventsByDate, selectedDate]
  )

  const grid = useMemo(
    () => buildMonth(cal.y, cal.m, today, {
      showHolidays: settings.showHolidays,
      showLunar: settings.showLunar
    }),
    [cal, today, settings.showHolidays, settings.showLunar]
  )

  const yearHolidays = useMemo(() => holidaySummary(cal.y), [cal.y])

  const submit = useCallback(() => {
    const value = title.trim()
    if (!value) return
    void api
      .addTodo({
        title: value,
        date: selectedDate,
        time: time || '09:00',
        notifySystem,
        notifyStrong,
        leadMinutes: lead,
        repeat
      })
      .then(() => api.listTodos())
      .then(setTodos)
    setTitle('')
    const channels =
      [notifySystem ? '系统通知' : null, notifyStrong ? '强提醒' : null].filter(Boolean).join(' + ') ||
      '不提醒'
    const suffix = [channels, leadLabel(lead), repeat === 'none' ? null : repeatLabel(repeat)]
      .filter(Boolean)
      .join(' · ')
    push(`已添加 · ${selectedDate} ${time} · ${suffix}`)
  }, [api, lead, notifyStrong, notifySystem, push, repeat, selectedDate, time, title])

  /** 直接点待办上的提醒标签就能改，不用删了重建 */
  const toggleChannel = useCallback(
    (todo: TodoItem, channel: 'notifySystem' | 'notifyStrong') => {
      const next = !todo[channel]
      const other = channel === 'notifySystem' ? todo.notifyStrong : todo.notifySystem
      void api.updateTodo(todo.id, { [channel]: next }).then(setTodos)
      if (channel === 'notifySystem') {
        if (next && todo.notifyStrong) push(`已开启系统通知：会先通知，${STRONG_ESCALATE_MINUTES} 分钟后升级为强提醒`)
        else push(next ? '已开启系统通知' : '已关闭系统通知')
      } else {
        if (next && todo.notifySystem)
          push(`已开启强提醒：会先通知，${STRONG_ESCALATE_MINUTES} 分钟后升级为强提醒`)
        else push(next ? '已开启强提醒' : '已关闭强提醒')
      }
      if (!next && !other) push('两个提醒都关了，到点不会通知你')
    },
    [api, push]
  )

  const gotoToday = useCallback(() => {
    const now = new Date()
    setToday(todayStr())
    setSelectedDate(todayStr())
    setCal({ y: now.getFullYear(), m: now.getMonth() })
  }, [])

  const changeMonth = useCallback((delta: number) => {
    setCal((prev) => {
      let m = prev.m + delta
      let y = prev.y
      if (m < 0) {
        m = 11
        y -= 1
      }
      if (m > 11) {
        m = 0
        y += 1
      }
      return { y, m }
    })
  }, [])

  const toggleAutoStart = useCallback(() => {
    const next = !runtime.autoStart
    setRuntime((prev) => ({ ...prev, autoStart: next }))
    setSettings((prev) => ({ ...prev, autoStart: next }))
    void api.setAutoStart(next)
  }, [api, runtime.autoStart])

  const changeSnooze = useCallback(
    (minutes: number) => {
      setSettings((prev) => ({ ...prev, snoozeMinutes: minutes }))
      void api.patchSettings({ snoozeMinutes: minutes })
      push(`强提醒将「稍后 ${minutes} 分钟」`)
    },
    [api, push]
  )

  const toggleLunar = useCallback(() => {
    const next = !settings.showLunar
    setSettings((prev) => ({ ...prev, showLunar: next }))
    void api.patchSettings({ showLunar: next })
    push(next ? '已显示农历与节气' : '已隐藏农历')
  }, [api, push, settings.showLunar])

  const toggleCalendarMode = useCallback(() => {
    const next = settings.calendarMode === 'desktop' ? 'floating' : 'desktop'
    setSettings((prev) => ({ ...prev, calendarMode: next }))
    void api.patchSettings({ calendarMode: next })
    push(
      next === 'desktop'
        ? '日历已贴着桌面：切到别的程序时会被盖住，提醒不受影响'
        : '日历已改为始终浮在最上方'
    )
  }, [api, push, settings.calendarMode])

  const toggleHolidays = useCallback(() => {
    const next = !settings.showHolidays
    setSettings((prev) => ({ ...prev, showHolidays: next }))
    void api.patchSettings({ showHolidays: next })
    push(next ? '已在日历上标注法定节假日与调休' : '已隐藏法定节假日标注')
  }, [api, push, settings.showHolidays])

  const changeSyncInterval = useCallback(
    (minutes: number) => {
      setSettings((prev) => ({ ...prev, syncIntervalMinutes: minutes }))
      void api.patchSettings({ syncIntervalMinutes: minutes })
    },
    [api]
  )

  /* ---------- 同步源操作 ---------- */
  const handleAddFile = useCallback(() => {
    void api.addIcsFile().then((result) => {
      if (result.canceled) return
      if (result.error) {
        push(result.error)
        return
      }
      if (result.state) setSync(result.state)
      push('已添加日历文件，正在读取…')
    })
  }, [api, push])

  const handleAddUrl = useCallback(() => {
    const value = urlInput.trim()
    if (!value) {
      push('先粘贴日历订阅地址')
      return
    }
    void api.addIcsUrl(value).then((result) => {
      if (result.error) {
        push(result.error)
        return
      }
      if (result.state) setSync(result.state)
      setUrlInput('')
      push('已添加订阅，正在拉取…')
    })
  }, [api, push, urlInput])

  const handleAddOutlook = useCallback(() => {
    push('正在检测本机 Outlook…')
    void api.addOutlook().then((result) => {
      if (result.error) {
        push(result.error)
        return
      }
      if (result.state) setSync(result.state)
      push('已连接 Outlook 日历')
    })
  }, [api, push])

  const handleRefresh = useCallback(
    (id?: string) => {
      push('正在同步…')
      void api.refreshSync(id).then((state) => {
        setSync(state)
        const failed = state.sources.filter((source) => source.lastError)
        if (failed.length > 0) {
          push(`同步完成，但有 ${failed.length} 个源失败`)
        } else {
          const total = state.sources.reduce((sum, source) => sum + source.eventCount, 0)
          push(`同步完成，共 ${total} 条日程`)
        }
      })
    },
    [api, push]
  )

  const handleToggleSource = useCallback(
    (id: string, enabled: boolean) => {
      void api.toggleSyncSource(id, enabled).then(setSync)
    },
    [api]
  )

  const handleRemoveSource = useCallback(
    (id: string, label: string) => {
      void api.removeSyncSource(id).then(setSync)
      push(`已移除「${label}」`)
    },
    [api, push]
  )

  const syncStatusText = useCallback((source: SyncState['sources'][number]): string => {
    if (!source.enabled) return '已停用'
    if (source.lastError) return `同步失败：${source.lastError.slice(0, 24)}`
    if (source.kind === 'outlook') return `Outlook · ${source.eventCount} 条`
    if (source.kind === 'ics-url') return `订阅 · ${source.eventCount} 条`
    return `本地文件 · ${source.eventCount} 条`
  }, [])

  return (
    <div className="card">
      <header className="head">
        <div className="title">
          {grid.title}
          <small>{grid.subtitle}</small>
        </div>
        <button className="icon-btn text" title="回到今天" onClick={gotoToday}>
          今天
        </button>
        <button className="icon-btn" title="上一月" onClick={() => changeMonth(-1)}>
          ‹
        </button>
        <button className="icon-btn" title="下一月" onClick={() => changeMonth(1)}>
          ›
        </button>
        <button
          className="icon-btn"
          title="设置"
          onClick={() => setShowSettings((prev) => !prev)}
        >
          ⚙
        </button>
      </header>

      <div className="grid">
        {DOW.map((d, index) => (
          <div key={d} className={`dow${index >= 5 ? ' we' : ''}`}>
            {d}
          </div>
        ))}
        {grid.cells.map((cell) => {
          if (cell.blank) {
            return (
              <div key={cell.key} className="day blank">
                <span>{cell.label}</span>
              </div>
            )
          }
          const date = cell.date as string
          const mark = cell.mark
          const isMakeup = mark?.kind === 'workday'
          const cellTodos = todos.filter((todo) => occursOn(todo.date, todo.repeat, date))
          const cellEvents = eventsByDate.get(date) ?? []

          const classes = ['day']
          // 调休补班的周末要按工作日显示，不能标成周末休息
          if (cell.weekend && !isMakeup) classes.push('we')
          if (mark?.kind === 'holiday') classes.push('holiday')
          if (isMakeup) classes.push('makeup')
          if (cell.isToday) classes.push('today')
          if (date === selectedDate) classes.push('sel')

          return (
            <div key={cell.key} className={classes.join(' ')} onClick={() => setSelectedDate(date)}>
              <span>{cell.label}</span>
              {cell.sub ? <span className={`lunar k-${cell.subKind}`}>{cell.sub}</span> : null}
              {cellTodos.length > 0 || cellEvents.length > 0 ? (
                <div className="dots">
                  {cellTodos.slice(0, MAX_DOTS).map((todo) => (
                    <i
                      key={todo.id}
                      /* 红点=会弹强提醒，蓝点=只发系统通知，灰点=不提醒 */
                      className={todo.notifyStrong ? 'strong' : todo.notifySystem ? '' : 'off'}
                      style={todo.done ? { opacity: 0.35 } : undefined}
                    />
                  ))}
                  {cellEvents.slice(0, Math.max(0, MAX_DOTS - cellTodos.length)).map((event) => (
                    <i key={event.uid} className="ev" style={{ background: event.color }} />
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="todos">
        <div className="todos-head">
          <span>
            待办 · <b>{selectedDate}</b>
            {selectedDate === today ? <em className="today-tag">今天</em> : null}
          </span>
          <span style={{ color: '#878e99', fontWeight: 500 }}>{dayList.length} 条</span>
        </div>

        {dayEvents.length > 0 ? (
          <div className="evts">
            {dayEvents.slice(0, MAX_EVENTS_SHOWN).map((event) => (
              <div key={event.uid} className="evt" title={event.location ?? event.title}>
                <i style={{ background: event.color }} />
                <span className="tm">{event.allDay ? '全天' : (event.time ?? '')}</span>
                <span className="nm">{event.title}</span>
              </div>
            ))}
            {dayEvents.length > MAX_EVENTS_SHOWN ? (
              <div className="evt-more">还有 {dayEvents.length - MAX_EVENTS_SHOWN} 条日程</div>
            ) : null}
          </div>
        ) : null}

        <div className="add">
          <input
            className="inp"
            placeholder="添加事项，例如：每天 20:00 背单词"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
          />
          <div className="row">
            <input
              className="inp"
              type="time"
              style={{ flex: '0 0 92px' }}
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
            <div className="chips">
              <button
                className={`chip sys${notifySystem ? ' on' : ''}`}
                title="到点弹 Windows 系统通知，不打断你"
                onClick={() => setNotifySystem((v) => !v)}
              >
                系统通知
              </button>
              <button
                className={`chip strong${notifyStrong ? ' on' : ''}`}
                title="到点弹应用内强提醒窗口"
                onClick={() => setNotifyStrong((v) => !v)}
              >
                强提醒
              </button>
            </div>
          </div>
          <div className="row">
            <select
              className="inp select"
              title="提前提醒量"
              value={lead}
              onChange={(event) => setLead(Number(event.target.value))}
            >
              {LEAD_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes === 0 ? '准时提醒' : `提前 ${minutes} 分钟`}
                </option>
              ))}
            </select>
            <select
              className="inp select"
              title="重复规则"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value as RepeatRule)}
            >
              {REPEAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button className="btn primary" style={{ padding: '0 14px' }} onClick={submit}>
              添加
            </button>
          </div>
        </div>

        <div className="list">
          {dayList.length === 0 ? (
            <div className="empty">这天还没有安排，加一条试试</div>
          ) : (
            dayList.map((todo) => (
              <div key={todo.id} className={`todo${todo.done ? ' done' : ''}`}>
                <div
                  className={`cb${todo.done ? ' on' : ''}`}
                  title={todo.repeat === 'none' ? '标记完成' : '本次已完成，下个周期继续提醒'}
                  onClick={() => {
                    void api.toggleTodo(todo.id).then(setTodos)
                  }}
                >
                  {todo.done ? '✓' : ''}
                </div>
                <div className="tx">
                  <div className="ttl">{todo.title}</div>
                  <div className="meta">
                    <span>{todo.time}</span>
                    <button
                      className={`chip sm sys${todo.notifySystem ? ' on' : ''}`}
                      title="点击切换：系统通知"
                      onClick={() => toggleChannel(todo, 'notifySystem')}
                    >
                      系统通知
                    </button>
                    <button
                      className={`chip sm strong${todo.notifyStrong ? ' on' : ''}`}
                      title="点击切换：强提醒"
                      onClick={() => toggleChannel(todo, 'notifyStrong')}
                    >
                      强提醒
                    </button>
                    {todo.leadMinutes > 0 ? (
                      <span className="pill lead">{leadLabel(todo.leadMinutes)}</span>
                    ) : null}
                    {todo.repeat !== 'none' ? (
                      <span className="pill repeat">{repeatLabel(todo.repeat)}</span>
                    ) : null}
                    {todo.notifiedAt && !todo.done ? (
                      <span style={{ color: '#12a594' }}>已提醒</span>
                    ) : null}
                  </div>
                </div>
                <div className="ops">
                  {todo.repeat !== 'none' ? (
                    <button
                      className="del"
                      title="取消重复"
                      onClick={() => {
                        void api.updateTodo(todo.id, { repeat: 'none' }).then(setTodos)
                        push('已取消重复提醒')
                      }}
                    >
                      ⌁
                    </button>
                  ) : null}
                  <button
                    className="del"
                    title="删除"
                    onClick={() => {
                      void api.removeTodo(todo.id).then(setTodos)
                      push('已删除该事项')
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showSettings ? (
        <div className="foot">
          <div className="set-row">
            <div>
              日历贴着桌面
              <small>
                {settings.calendarMode === 'desktop'
                  ? '被其他程序盖住，只在看桌面时出现（提醒弹窗不受影响）'
                  : '始终浮在所有窗口的最上方'}
              </small>
            </div>
            <div
              className={`switch${settings.calendarMode === 'desktop' ? ' on' : ''}`}
              onClick={toggleCalendarMode}
            />
          </div>

          <div className="set-row">
            <div>
              开机自启
              <small>{runtime.packaged ? '随系统启动，到点提醒不会漏' : '开发模式下不写系统登录项'}</small>
            </div>
            <div className={`switch${runtime.autoStart ? ' on' : ''}`} onClick={toggleAutoStart} />
          </div>
          <div className="set-row">
            <div>
              强提醒稍后时长
              <small>点「稍后」后隔多久再提醒</small>
            </div>
            <select
              className="inp select"
              style={{ flex: '0 0 88px' }}
              value={settings.snoozeMinutes}
              onChange={(event) => changeSnooze(Number(event.target.value))}
            >
              {SNOOZE_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} 分钟
                </option>
              ))}
            </select>
          </div>

          <div className="set-row">
            <div>
              法定节假日
              <small>
                {yearHolidays.official
                  ? `${yearHolidays.year} 年放假 ${yearHolidays.holidayDays} 天 · 调休 ${yearHolidays.makeupDays} 天`
                  : `${yearHolidays.year} 年安排尚未发布，仅标公历节日`}
              </small>
            </div>
            <div className={`switch${settings.showHolidays ? ' on' : ''}`} onClick={toggleHolidays} />
          </div>

          <div className="set-row">
            <div>
              显示农历与节气
              <small>格子下方显示农历日、节气与传统节日</small>
            </div>
            <div className={`switch${settings.showLunar ? ' on' : ''}`} onClick={toggleLunar} />
          </div>

          <div className="set-sec">
            <span>电脑日历同步</span>
            <button className="mini-btn" onClick={() => handleRefresh()}>
              {sync.refreshing ? '同步中…' : '全部刷新'}
            </button>
          </div>

          {sync.sources.length === 0 ? (
            <div className="src-empty">
              还没有添加日历。可以从下面选一个方式接入。
            </div>
          ) : (
            sync.sources.map((source) => (
              <div key={source.id} className="src-row">
                <i className="dot" style={{ background: source.color }} />
                <div className="src-info">
                  <div className="src-name" title={source.target || source.label}>
                    {source.label}
                  </div>
                  <div className={`src-sub${source.lastError ? ' err' : ''}`}>
                    {syncStatusText(source)}
                  </div>
                </div>
                <button
                  className="mini-btn"
                  title={source.enabled ? '停用' : '启用'}
                  onClick={() => handleToggleSource(source.id, !source.enabled)}
                >
                  {source.enabled ? '停用' : '启用'}
                </button>
                <button
                  className="del"
                  title="移除"
                  onClick={() => handleRemoveSource(source.id, source.label)}
                >
                  ✕
                </button>
              </div>
            ))
          )}

          <div className="src-add">
            <button className="btn" onClick={handleAddFile}>
              选择 .ics 文件
            </button>
            <button className="btn" onClick={handleAddOutlook}>
              {sync.outlookAvailable ? '＋ Outlook' : '检测 Outlook'}
            </button>
          </div>

          <div className="src-url">
            <input
              className="inp"
              placeholder="粘贴日历订阅地址（webcal / https）"
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleAddUrl()
              }}
            />
            <button className="btn" onClick={handleAddUrl}>
              订阅
            </button>
          </div>

          <div className="set-row">
            <div>
              自动刷新
              <small>订阅地址会按这个间隔重新拉取</small>
            </div>
            <select
              className="inp select"
              style={{ flex: '0 0 88px' }}
              value={settings.syncIntervalMinutes}
              onChange={(event) => changeSyncInterval(Number(event.target.value))}
            >
              {SYNC_INTERVAL_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes === 0 ? '不自动' : `${minutes} 分钟`}
                </option>
              ))}
            </select>
          </div>

          <div className="set-hint">
            Outlook / Google / 苹果日历里都能把日历「发布」成 .ics 链接，复制过来即可。
          </div>

          <div className="set-row">
            <div>
              测试提醒
              <small>立刻弹一次强提醒，确认能正常提醒</small>
            </div>
            <button className="btn" onClick={() => api.testReminder()}>
              测一下
            </button>
          </div>
        </div>
      ) : null}

      {RESIZE_DIRS.map((dir) => (
        <div
          key={dir}
          className={`rs rs-${dir}`}
          data-resizing={resizing === dir ? '1' : undefined}
          onPointerDown={(event) => onResizeStart(event, dir)}
        />
      ))}

      <Toasts items={toasts} />
    </div>
  )
}
