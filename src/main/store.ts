import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const cache = new Map<string, unknown>()

function fileOf(name: string): string {
  return join(app.getPath('userData'), `${name}.json`)
}

function load(name: string): unknown {
  try {
    const file = fileOf(name)
    if (!existsSync(file)) return undefined
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    console.error('[kairos] 读取配置失败，回退到默认值：', name, err)
    return undefined
  }
}

/** 读取对象型配置：与默认值浅合并，保证新增字段有默认值 */
export function readJson<T extends object>(name: string, fallback: T): T {
  if (cache.has(name)) return cache.get(name) as T
  const raw = load(name)
  const value =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? ({ ...fallback, ...(raw as object) } as T)
      : fallback
  cache.set(name, value)
  return value
}

/** 读取数组型配置 */
export function readArray<T>(name: string, fallback: T[]): T[] {
  if (cache.has(name)) return cache.get(name) as T[]
  const raw = load(name)
  const value = Array.isArray(raw) ? (raw as T[]) : fallback
  cache.set(name, value)
  return value
}

export function writeJson<T>(name: string, value: T): T {
  cache.set(name, value)
  try {
    const file = fileOf(name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
  } catch (err) {
    console.error('[kairos] 写入配置失败：', name, err)
  }
  return value
}
