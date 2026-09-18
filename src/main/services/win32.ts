/**
 * 少量 Win32 能力补充
 *
 * Electron 没有暴露「把窗口压到 Z 序底部」这个操作，而要让日历窗真正贴着桌面
 * （被别的程序盖住、而不是压在工作窗口上面），只能走系统 API。
 *
 * 做法延续 Outlook 那边的思路：把 P/Invoke 定义塞进一段脚本，
 * 用 `-EncodedCommand`（base64 的 UTF-16LE）传进去执行，
 * 免得为了一个函数调用去编译原生模块、把打包复杂度抬上去。
 *
 * 全部失败都静默吞掉 —— 最差的结果只是窗口保持普通层级，功能不受影响。
 */
import { spawn } from 'node:child_process'
import type { BrowserWindow } from 'electron'
import { log } from '../logger'

const TIMEOUT_MS = 8000

/** HWND_BOTTOM：压到所有普通窗口之下 */
const HWND_BOTTOM = 1
/** SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE */
const SWP_FLAGS = 0x0001 | 0x0002 | 0x0010

const SCRIPT = `$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class KairosWin32 {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);
}
"@
$hwnd = [IntPtr][long]$env:KAIROS_HWND
if ($env:KAIROS_OP -eq 'bottom') {
  $ok = [KairosWin32]::SetWindowPos($hwnd, [IntPtr]${HWND_BOTTOM}, 0, 0, 0, 0, ${SWP_FLAGS})
  if ($ok) { Write-Output 'OK' } else { Write-Output ('ERR:' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
} else {
  Write-Output 'ERR:unknown-op'
}`

/** 取窗口的原生句柄（x64 上是 8 字节指针） */
function handleOf(win: BrowserWindow): string | null {
  try {
    const buf = win.getNativeWindowHandle()
    if (buf.length >= 8) return buf.readBigInt64LE(0).toString()
    return String(buf.readInt32LE(0))
  } catch {
    return null
  }
}

export type Win32Op = 'bottom'

/**
 * 把窗口压到 Z 序底部（被所有普通窗口盖住）。
 * 失败不会抛异常，只是窗口保持原来的层级。
 */
export function pushWindowToBottom(win: BrowserWindow): void {
  if (process.platform !== 'win32') return
  const hwnd = handleOf(win)
  if (!hwnd) return

  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    {
      windowsHide: true,
      env: { ...process.env, KAIROS_HWND: hwnd, KAIROS_OP: 'bottom' satisfies Win32Op }
    }
  )

  let stdout = ''
  const timer = setTimeout(() => {
    try {
      child.kill()
    } catch {
      /* 忽略 */
    }
  }, TIMEOUT_MS)

  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })

  child.on('error', (error) => {
    clearTimeout(timer)
    log('调用系统接口失败（窗口层级不受影响）', error)
  })

  child.on('close', () => {
    clearTimeout(timer)
    const out = stdout.trim()
    if (out && !out.startsWith('OK')) {
      // 只记一次，避免用户在设置里来回切时刷屏
      log(`窗口压底未生效：${out}`)
    }
  })
}
