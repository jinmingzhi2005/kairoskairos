import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 启动包装：清理会把 Electron 拉成纯 Node 模式的环境变量后再执行真实命令。
 *
 * 背景：某些终端/IDE 环境会注入
 *   ELECTRON_RUN_AS_NODE=1        -> electron.exe 退化成 node，require('electron') 变成路径字符串
 *   NODE_OPTIONS=--require=...    -> 额外 shim 会被加载进主进程
 * 两者都会让桌面层起不来，这里统一剔除。
 */
const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('[kairos] 用法: node scripts/run.mjs <command> [...args]')
  process.exit(1)
}

const [command, ...rest] = args
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS

// 直接 node 调用时不会带上 node_modules/.bin，这里补上，保证 electron / electron-vite 可解析
const localBin = join(process.cwd(), 'node_modules', '.bin')
if (existsSync(localBin)) {
  const sep = process.platform === 'win32' ? ';' : ':'
  env.PATH = `${localBin}${sep}${env.PATH ?? ''}`
}

// 虚拟机 / 远程桌面 / CI 等拿不到 GPU 的环境：KAIROS_NO_GPU=1 走软件渲染
const noGpu = env.KAIROS_NO_GPU === '1' || env.KAIROS_NO_GPU === 'true'
const extra = noGpu && /electron(\.exe)?$/i.test(command)
  ? ['--no-sandbox', '--disable-gpu', '--disable-gpu-compositing', '--disable-gpu-sandbox']
  : []

const child = spawn(command, [...rest, ...extra], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32'
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
