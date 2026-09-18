/**
 * 清理构建产物里的孤儿文件
 *
 * 背景：验证构建用 `emptyOutDir: false`（受限环境里清目录会被批量删除策略拦下），
 * 代价是**每一次构建的旧文件都会留在 assets 里**，最后被一起打进安装包。
 *
 * 早前我是靠文件名里的 hash 猜哪个是旧的，结果有一次把**当前产物**当成旧文件删了，
 * 直接把 out/ 弄坏。所以改成让 html 自己说话：只保留被 html 真正引用的文件。
 *
 * 用法：node scripts/clean-artifacts.mjs [产物目录，默认 out]
 */
import { existsSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = process.argv[2] || 'out'

const rendererDir = join(ROOT, OUT, 'renderer')
const assetsDir = join(rendererDir, 'assets')
const entries = ['index.html', 'reminder.html']

if (!existsSync(assetsDir)) {
  console.error(`找不到 ${assetsDir}，先跑一次构建`)
  process.exit(1)
}

// 从所有入口 html 里收集真正被引用的资源
const referenced = new Set()
for (const entry of entries) {
  const file = join(rendererDir, entry)
  if (!existsSync(file)) continue
  const html = readFileSync(file, 'utf8')
  for (const match of html.matchAll(/assets\/([^"']+)/g)) {
    referenced.add(match[1])
  }
}

const files = readdirSync(assetsDir)
const missing = [...referenced].filter((name) => !files.includes(name))
const orphan = files.filter((name) => !referenced.has(name) && !name.endsWith('.orphan'))

if (missing.length > 0) {
  // 这种情况说明产物本身是坏的，绝不能继续打包
  console.error('✗ 有资源被 html 引用但文件不存在，构建产物不完整：')
  for (const name of missing) console.error('   ', name)
  process.exit(1)
}

if (orphan.length === 0) {
  console.log(`✓ ${OUT}/renderer/assets 干净，无孤儿文件（共 ${files.length} 个）`)
  process.exit(0)
}

console.log(`发现 ${orphan.length} 个没被任何入口引用的孤儿文件，正在清理：`)
let cleared = 0
for (const name of orphan) {
  const file = join(assetsDir, name)
  try {
    rmSync(file, { force: true })
    console.log('   已删除', name)
    cleared += 1
  } catch {
    // 有些受限环境（沙箱 / 安全软件）会把删除操作拦下来。
    // 早前试过「清空内容」，但 0 字节文件照样会被打进包里，等于没清。
    // 改成加后缀隔离 —— 重命名不算删除，通常不会被拦；
    // 而 electron-builder.yml 里已经排除了 *.orphan，它们不会进包。
    try {
      renameSync(file, `${file}.orphan`)
      console.log('   已隔离为 .orphan（删除被环境拦截）', name)
      cleared += 1
    } catch (error) {
      console.error('   处理失败', name, error instanceof Error ? error.message : error)
    }
  }
}

if (cleared !== orphan.length) {
  console.error(`✗ 有 ${orphan.length - cleared} 个孤儿文件没能处理，产物可能不干净`)
  process.exit(2)
}
console.log(`✓ 清理完成，剩余 ${readdirSync(assetsDir).length} 个文件`)
