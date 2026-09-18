/**
 * 电脑日历同步服务
 *
 * 支持三种来源：
 * - ics-file  本地 .ics 文件（Outlook / Google / 苹果日历都能导出）
 * - ics-url   订阅地址，定时自动拉取（Outlook 的「发布日历」、Google 的「密钥地址」都是这个）
 * - outlook   直接读本机 Outlook 桌面版（启动时探测，不可用就静默跳过）
 *
 * 同步来的事件只做展示，不参与提醒调度——提醒归 todoService 管，两者互不干扰。
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import {
  SYNC_COLORS,
  type SyncSource,
  type SyncSourceKind,
  type SyncState,
  type SyncedEvent
} from '@shared/types'
import { readArray, writeJson } from '../store'
import { log } from '../logger'
import { parseIcs } from './icsParser'
import { fetchOutlookEvents, isOutlookAvailable } from './outlookService'

const SOURCE_FILE = 'syncSources'
const CACHE_FILE = 'syncEvents'

/** 往前拉 40 天：够覆盖月初回看；往后拉 400 天：够翻完一整年 */
const DAYS_BACK = 40
const DAYS_FORWARD = 400

const FETCH_TIMEOUT_MS = 20_000

let sources: SyncSource[] = []
let events: SyncedEvent[] = []
let outlookAvailable = false
let outlookChecked = false
let refreshing = false
let lastRefreshAt: number | undefined
let timer: NodeJS.Timeout | null = null
let notify: (() => void) | null = null

const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`)

function shiftDay(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function rangeOf(): { from: string; to: string } {
  return { from: shiftDay(-DAYS_BACK), to: shiftDay(DAYS_FORWARD) }
}

function nextColor(): string {
  return SYNC_COLORS[sources.length % SYNC_COLORS.length]
}

function persistSources(): void {
  writeJson(SOURCE_FILE, sources)
}

function persistEvents(): void {
  writeJson(CACHE_FILE, events)
}

function changed(): void {
  notify?.()
}

/* ---------- 各类来源的拉取 ---------- */

/** webcal:// 是订阅链接的常见写法，转成 https 才能直接请求 */
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('webcal://')) return `https://${trimmed.slice('webcal://'.length)}`
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`
  return trimmed
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // 部分日历服务会按 UA 判断，给一个常规浏览器标识
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Kairos/0.3',
        Accept: 'text/calendar, text/plain, */*'
      }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

interface PullResult {
  events: SyncedEvent[]
  /** 本次是否成功（失败时保留上一次的数据） */
  ok: boolean
  error?: string
}

async function pull(source: SyncSource): Promise<PullResult> {
  const { from, to } = rangeOf()

  try {
    if (source.kind === 'outlook') {
      const list = await fetchOutlookEvents(from, to)
      if (list === null) return { events: [], ok: false, error: '读取 Outlook 失败' }
      return {
        ok: true,
        events: list.map((item) => ({
          uid: `${source.id}:${item.uid || item.title}`,
          title: item.title,
          start: item.start,
          end: item.end,
          allDay: item.allDay,
          time: item.time,
          location: item.location,
          sourceId: source.id,
          color: source.color
        }))
      }
    }

    let text: string
    if (source.kind === 'ics-file') {
      if (!existsSync(source.target)) {
        return { events: [], ok: false, error: '文件不存在或已被移动' }
      }
      text = readFileSync(source.target, 'utf8')
    } else {
      text = await fetchText(normalizeUrl(source.target))
    }

    const parsed = parseIcs(text, from, to)
    return {
      ok: true,
      events: parsed.map((item) => ({
        uid: `${source.id}:${item.uid}`,
        title: item.title,
        start: item.start,
        end: item.end,
        allDay: item.allDay,
        time: item.time,
        location: item.location,
        sourceId: source.id,
        color: source.color
      }))
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`同步失败 [${source.label}]：${message}`)
    return { events: [], ok: false, error: message }
  }
}

/* ---------- 对外接口 ---------- */

export function getSyncState(): SyncState {
  return {
    sources: sources.map((source) => ({ ...source })),
    outlookAvailable,
    outlookChecked,
    refreshing,
    lastRefreshAt
  }
}

/** 取区间内的事件，按时间排序 */
export function eventsInRange(from: string, to: string): SyncedEvent[] {
  return events
    .filter((event) => event.end >= from && event.start <= to)
    .map((event) => ({ ...event }))
    .sort((a, b) => {
      if (a.start !== b.start) return a.start.localeCompare(b.start)
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
      return (a.time ?? '').localeCompare(b.time ?? '')
    })
}

export function addSource(
  kind: SyncSourceKind,
  target: string,
  label?: string
): { source?: SyncSource; error?: string } {
  const trimmed = target.trim()
  if (kind !== 'outlook' && !trimmed) return { error: '请输入文件路径或订阅地址' }

  if (kind !== 'outlook') {
    const duplicated = sources.find(
      (source) => source.target.toLowerCase() === trimmed.toLowerCase()
    )
    if (duplicated) return { error: `「${duplicated.label}」已经在列表里了` }
  } else if (sources.some((source) => source.kind === 'outlook')) {
    return { error: 'Outlook 日历已经加过了' }
  }

  let name = label?.trim() ?? ''
  if (!name) {
    if (kind === 'ics-file') {
      name = basename(trimmed, extname(trimmed))
    } else if (kind === 'ics-url') {
      try {
        name = new URL(normalizeUrl(trimmed)).hostname.replace(/^www\./, '')
      } catch {
        name = '日历订阅'
      }
    } else {
      name = 'Outlook 日历'
    }
  }

  const source: SyncSource = {
    id: `s${Date.now()}`,
    kind,
    label: name || '日历',
    target: trimmed,
    color: nextColor(),
    enabled: true,
    eventCount: 0
  }

  sources = [...sources, source]
  persistSources()
  changed()

  // 后台立刻拉一次，失败也不影响源已经加进去
  void refreshSource(source.id)
  return { source }
}

export function toggleSource(id: string, enabled: boolean): SyncState {
  sources = sources.map((source) => (source.id === id ? { ...source, enabled } : source))
  persistSources()
  // 停用的源要从缓存里清掉它的事件
  if (!enabled) {
    events = events.filter((event) => event.sourceId !== id)
    persistEvents()
  } else {
    void refreshSource(id)
  }
  changed()
  return getSyncState()
}

export function removeSource(id: string): SyncState {
  sources = sources.filter((source) => source.id !== id)
  events = events.filter((event) => event.sourceId !== id)
  persistSources()
  persistEvents()
  changed()
  return getSyncState()
}

/** 刷新单个源 */
export async function refreshSource(id: string): Promise<SyncState> {
  const source = sources.find((item) => item.id === id)
  if (!source || !source.enabled) return getSyncState()

  refreshing = true
  changed()

  const result = await pull(source)

  // 失败时保留上一次的数据，只是把错误记下来——总比日历突然空了强
  if (result.ok) {
    events = [...events.filter((event) => event.sourceId !== id), ...result.events]
  }

  sources = sources.map((item) =>
    item.id === id
      ? {
          ...item,
          lastSyncAt: result.ok ? Date.now() : item.lastSyncAt,
          lastError: result.ok ? undefined : result.error,
          eventCount: result.ok ? result.events.length : item.eventCount
        }
      : item
  )

  persistSources()
  persistEvents()
  refreshing = false
  lastRefreshAt = Date.now()
  changed()
  return getSyncState()
}

/** 刷新全部启用的源 */
export async function refreshAll(): Promise<SyncState> {
  const active = sources.filter((source) => source.enabled)
  if (active.length === 0) {
    lastRefreshAt = Date.now()
    changed()
    return getSyncState()
  }

  refreshing = true
  changed()

  const results = await Promise.all(
    active.map(async (source) => ({ id: source.id, result: await pull(source) }))
  )

  for (const { id, result } of results) {
    if (result.ok) {
      events = [...events.filter((event) => event.sourceId !== id), ...result.events]
    }
    sources = sources.map((item) =>
      item.id === id
        ? {
            ...item,
            lastSyncAt: result.ok ? Date.now() : item.lastSyncAt,
            lastError: result.ok ? undefined : result.error,
            eventCount: result.ok ? result.events.length : item.eventCount
          }
        : item
    )
  }

  // 清掉不属于任何存活源的残留事件
  const alive = new Set(sources.filter((source) => source.enabled).map((source) => source.id))
  events = events.filter((event) => alive.has(event.sourceId))

  persistSources()
  persistEvents()
  refreshing = false
  lastRefreshAt = Date.now()
  changed()
  return getSyncState()
}

/** 探测本机 Outlook 是否可用（结果会缓存，不重复探测） */
export async function detectOutlook(): Promise<boolean> {
  if (outlookChecked) return outlookAvailable
  outlookAvailable = await isOutlookAvailable()
  outlookChecked = true
  changed()
  return outlookAvailable
}

function scheduleAutoRefresh(minutes: number): void {
  if (timer) clearInterval(timer)
  timer = null
  if (minutes <= 0) return
  timer = setInterval(() => {
    void refreshAll()
  }, Math.max(5, minutes) * 60_000)
}

/** 设置项变化时重新安排定时刷新 */
export function applySyncInterval(minutes: number): void {
  scheduleAutoRefresh(minutes)
}

export function initCalendarSync(onChange: () => void): void {
  notify = onChange
  sources = readArray<SyncSource>(SOURCE_FILE, [])
  events = readArray<SyncedEvent>(CACHE_FILE, [])

  // 事件缓存可能来自很旧的版本，裁剪掉区间外的，避免无限增长
  const { from, to } = rangeOf()
  events = events.filter((event) => event.end >= from && event.start <= to)
  persistEvents()

  // Outlook 源需要在启动时确认一次可用性，否则每次刷新都白等超时
  if (sources.some((source) => source.kind === 'outlook')) {
    void detectOutlook()
  }

  // 启动后延迟几秒再拉，别和首次扫描/渲染抢时间
  setTimeout(() => {
    void refreshAll()
  }, 3000)
}

export function disposeSync(): void {
  if (timer) clearInterval(timer)
  timer = null
}
