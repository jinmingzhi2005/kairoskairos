/**
 * Outlook 桌面版日历读取
 *
 * 通过 PowerShell 调 Outlook 的 COM 接口（olFolderCalendar = 9）。
 * 之所以绕一层 PowerShell 而不是在 Node 里直接 COM：Electron 没有内置 COM 绑定，
 * 而 Windows 上的 PowerShell 天然支持 New-Object -ComObject。
 *
 * 容错是重点：用户环境里 Office 可能是 Click-to-Run 安装、可能没装桌面版、
 * 也可能被安全策略挡住 COM。任何一步失败都只返回 null，不抛异常、不阻塞启动。
 *
 * 脚本通过 -EncodedCommand（base64 的 UTF-16LE）传入，避免临时 .ps1 文件的
 * 编码/路径问题——中文路径下写脚本文件很容易踩坑。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { log } from '../logger'

export interface OutlookEvent {
  uid: string
  title: string
  /** 'YYYY-MM-DD' */
  start: string
  /** 'YYYY-MM-DD' */
  end: string
  allDay: boolean
  /** 'HH:mm'，全天事件为空 */
  time?: string
  location?: string
}

const TIMEOUT_MS = 25_000

/**
 * PowerShell 脚本：读指定日期区间的日历项，落成 JSON 文件。
 * 用文件而不是 stdout 传数据，避免控制台代码页把中文标题弄成乱码。
 */
const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$outFile = $env:KAIROS_OUT
$from = $env:KAIROS_FROM
$to = $env:KAIROS_TO

function Write-Json($text) {
  [System.IO.File]::WriteAllText($outFile, $text, (New-Object System.Text.UTF8Encoding($false)))
}

try {
  $outlook = New-Object -ComObject Outlook.Application
  $ns = $outlook.GetNamespace('MAPI')
  $cal = $ns.GetDefaultFolder(9)
  $items = $cal.Items
  $items.IncludeRecurrences = $true
  $items.Sort('[Start]')

  # Outlook 的 Restrict 过滤器按系统区域解析日期，这里两种常见格式都试一遍
  $restricted = $null
  foreach ($fmt in @('yyyy-MM-dd HH:mm', 'MM/dd/yyyy HH:mm')) {
    try {
      $filter = "[Start] >= '" + ([datetime]::ParseExact($from + ' 00:00', 'yyyy-MM-dd HH:mm', $null).ToString($fmt)) +
                "' AND [Start] <= '" + ([datetime]::ParseExact($to + ' 23:59', 'yyyy-MM-dd HH:mm', $null).ToString($fmt)) + "'"
      $restricted = $items.Restrict($filter)
      break
    } catch { $restricted = $null }
  }
  if ($null -eq $restricted) { $restricted = $items }

  $list = New-Object System.Collections.ArrayList
  $count = 0
  foreach ($item in $restricted) {
    $count = $count + 1
    if ($count -gt 2000) { break }
    $startDt = $item.Start
    $endDt = $item.End
    $isAllDay = [bool]$item.AllDayEvent
    $null = $list.Add([PSCustomObject]@{
      uid      = [string]$item.EntryID
      title    = [string]$item.Subject
      start    = $startDt.ToString('yyyy-MM-dd')
      end      = $endDt.ToString('yyyy-MM-dd')
      time     = $(if ($isAllDay) { '' } else { $startDt.ToString('HH:mm') })
      allDay   = $isAllDay
      location = [string]$item.Location
    })
  }

  $json = ConvertTo-Json -InputObject @($list) -Depth 3 -Compress
  if ([string]::IsNullOrWhiteSpace($json)) { $json = '[]' }
  Write-Json $json
  Write-Output 'OK'
} catch {
  Write-Json '[]'
  Write-Output ('ERR: ' + $_.Exception.Message)
}
`

function runPowerShell(from: string, to: string): Promise<{ ok: boolean; message: string; file: string }> {
  return new Promise((resolve) => {
    // 不删这个目录：受限环境的删除保护会把清理动作拦下来并报错，留着无害
    const workDir = mkdtempSync(join(tmpdir(), 'kairos-outlook-'))
    const outFile = join(workDir, 'events.json')
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {
        windowsHide: true,
        env: {
          ...process.env,
          KAIROS_OUT: outFile,
          KAIROS_FROM: from,
          KAIROS_TO: to
        }
      }
    )

    let stdout = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* 忽略 */
      }
      resolve({ ok: false, message: '读取 Outlook 超时', file: outFile })
    }, TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, message: `无法启动 PowerShell：${error.message}`, file: outFile })
    })

    child.on('close', () => {
      clearTimeout(timer)
      const trimmed = stdout.trim()
      if (trimmed.startsWith('ERR:')) {
        resolve({ ok: false, message: trimmed.slice(4).trim(), file: outFile })
        return
      }
      resolve({ ok: true, message: trimmed, file: outFile })
    })
  })
}

/**
 * 探测本机是否有可用 Outlook。
 * 故意用一个很窄的区间，探测要快。
 */
export async function isOutlookAvailable(): Promise<boolean> {
  const today = new Date()
  const iso = today.toISOString().slice(0, 10)
  const result = await runPowerShell(iso, iso)
  if (result.ok) return true
  log(`未检测到可用 Outlook：${result.message}`)
  return false
}

/** 读取指定区间的事件；失败返回 null（调用方据此保留上一次缓存） */
export async function fetchOutlookEvents(from: string, to: string): Promise<OutlookEvent[] | null> {
  const result = await runPowerShell(from, to)
  if (!result.ok) {
    log(`读取 Outlook 日历失败：${result.message}`)
    return null
  }
  if (!existsSync(result.file)) return []

  try {
    // PowerShell 的 UTF8 写入可能带 BOM，读之前先剥掉
    const text = readFileSync(result.file, 'utf8').replace(/^\uFEFF/, '')
    const raw = JSON.parse(text) as Array<Record<string, unknown>>
    if (!Array.isArray(raw)) return []

    return raw
      .filter((item) => typeof item['title'] === 'string' && item['title'] !== '')
      .map((item) => {
        const time = typeof item['time'] === 'string' ? item['time'] : ''
        return {
          uid: String(item['uid'] ?? ''),
          title: String(item['title'] ?? ''),
          start: String(item['start'] ?? ''),
          end: String(item['end'] ?? item['start'] ?? ''),
          allDay: Boolean(item['allDay']),
          time: /^\d{2}:\d{2}$/.test(time) ? time : undefined,
          location: typeof item['location'] === 'string' && item['location'] ? item['location'] : undefined
        }
      })
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.start))
  } catch (error) {
    log('解析 Outlook 日历结果失败', error)
    return null
  }
}
