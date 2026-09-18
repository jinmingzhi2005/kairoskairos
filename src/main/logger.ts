import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

let logFile: string | null = null

function file(): string {
  if (!logFile) {
    logFile = join(app.getPath('userData'), 'kairos.log')
    try {
      mkdirSync(dirname(logFile), { recursive: true })
    } catch {
      /* 忽略 */
    }
  }
  return logFile
}

function stamp(): string {
  const now = new Date()
  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`)
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

/**
 * 启动阶段出问题时终端日志可能因为进程被强杀而丢缓冲，
 * 所以关键节点同步写盘一份，方便事后定位。
 */
export function log(message: string, error?: unknown): void {
  const line = `[${stamp()}] ${message}${error ? ` :: ${describe(error)}` : ''}`
  console.log('[kairos]', line)
  try {
    appendFileSync(file(), `${line}\n`, 'utf8')
  } catch {
    /* 写不进去就算了，不能因为日志把主流程搞挂 */
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}\n${error.stack ?? ''}`
  return String(error)
}

export function installCrashHandlers(): void {
  process.on('uncaughtException', (error) => {
    log('未捕获异常，应用即将退出', error)
  })
  process.on('unhandledRejection', (reason) => {
    log('未处理的 Promise 拒绝', reason)
  })
}

export function logFilePath(): string {
  return file()
}
