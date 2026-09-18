/**
 * 图标生成
 *
 * 设计：一个**缺口的时间环 + 环上的一点**。
 * 环代表时间的循环，缺口处那颗点代表「恰当时机」——正是 Kairos 的本意。
 * 深靛蓝渐变底 + 纯白几何元素，刻意保持极简，缩到 16px 也不糊。
 *
 * 全程手写 PNG 编码（zlib deflate + PNG chunk），不引任何图形依赖，
 * 这样 npm install 之后就能直接出图，CI 里也不用装图形库。
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'resources', 'icons')

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const clamp01 = (v) => Math.max(0, Math.min(1, v))
const lerp = (a, b, t) => a + (b - a) * t

/** 距离场边缘的 1.6px 羽化，用来做抗锯齿 */
function smooth(distance) {
  return clamp01(distance / 1.6 + 0.5)
}

/** 圆角矩形的覆盖率 */
function roundRectAlpha(px, py, x, y, w, h, r) {
  const cx = Math.max(x + r, Math.min(px, x + w - r))
  const cy = Math.max(y + r, Math.min(py, y + h - r))
  const dist = Math.hypot(px - cx, py - cy)
  if (px < x || px > x + w || py < y || py > y + h) {
    if (dist > r) return 0
  }
  return smooth(r - dist)
}

/**
 * @param size    画布边长
 * @param variant 'app' 完整图标；'tray' 托盘专用（线更粗、点更大，小尺寸下才看得清）
 */
function makeIcon(size, variant = 'app') {
  const tray = variant === 'tray'
  const rgba = Buffer.alloc(size * size * 4)

  // 留一点外边距，避免贴边
  const pad = size * 0.055
  const box = { x: pad, y: pad, w: size - pad * 2, h: size - pad * 2, r: size * 0.235 }

  const cx = size / 2
  const cy = size / 2
  const radius = size * 0.255

  // 托盘版整体加粗，否则 16/32px 下环会糊成一团
  const stroke = size * (tray ? 0.104 : 0.062)
  const dotRadius = size * (tray ? 0.082 : 0.070)
  const gapHalf = tray ? 23 : 15

  // 缺口方向：视觉上的 1 点钟位置。屏幕 y 轴朝下，所以数学角度用 60°
  const dotAngle = 60
  const dotRad = (dotAngle * Math.PI) / 180
  const dotX = cx + radius * Math.cos(dotRad)
  const dotY = cy - radius * Math.sin(dotRad)

  const from = [86, 110, 248]
  const to = [36, 26, 104]

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5
      const py = y + 0.5
      const base = roundRectAlpha(px, py, box.x, box.y, box.w, box.h, box.r)
      if (base <= 0) continue

      // 底色：左上到右下的线性渐变
      const t = clamp01((px + py) / (size * 2))
      let r = lerp(from[0], to[0], t)
      let g = lerp(from[1], to[1], t)
      let b = lerp(from[2], to[2], t)

      // 时间环（带缺口）
      const dist = Math.hypot(px - cx, py - cy)
      let ring = smooth(stroke / 2 - Math.abs(dist - radius))
      if (ring > 0) {
        let angle = (Math.atan2(-(py - cy), px - cx) * 180) / Math.PI
        if (angle < 0) angle += 360
        let diff = Math.abs(angle - dotAngle)
        if (diff > 180) diff = 360 - diff
        // 缺口边缘同样羽化，避免出现硬边
        ring *= 1 - smooth(gapHalf - diff)
      }

      // 恰当时刻：环上那颗实心点
      const dot = smooth(dotRadius - Math.hypot(px - dotX, py - dotY))

      const mark = clamp01(ring + dot)
      if (mark > 0) {
        const mix = mark * 0.97
        r = lerp(r, 255, mix)
        g = lerp(g, 255, mix)
        b = lerp(b, 255, mix)
      }

      const offset = (y * size + x) * 4
      rgba[offset] = Math.round(r)
      rgba[offset + 1] = Math.round(g)
      rgba[offset + 2] = Math.round(b)
      rgba[offset + 3] = Math.round(255 * base)
    }
  }

  return encodePng(size, size, rgba)
}

mkdirSync(outDir, { recursive: true })

// 多尺寸：Windows 各处会按需取用
for (const size of [16, 24, 32, 48, 64, 128, 256]) {
  writeFileSync(join(outDir, `icon-${size}.png`), makeIcon(size))
}
// electron-builder 读取的主图标，给大一点保证转 ico 后清晰
writeFileSync(join(outDir, 'icon.png'), makeIcon(512))
// 托盘图标单独出加粗版
writeFileSync(join(outDir, 'tray.png'), makeIcon(32, 'tray'))

console.log('[kairos] 图标已生成到', outDir)
