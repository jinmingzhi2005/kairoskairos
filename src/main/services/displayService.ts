import { screen } from 'electron'
import type { DisplayInfo, Rect } from '@shared/types'

function rectOf(rect: Electron.Rectangle): Rect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

export function listDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    label: `屏幕 ${index + 1}${display.id === primaryId ? ' · 主屏' : ''}`,
    bounds: rectOf(display.bounds),
    workArea: rectOf(display.workArea),
    scaleFactor: display.scaleFactor,
    primary: display.id === primaryId
  }))
}

export function primaryDisplay(displays: DisplayInfo[]): DisplayInfo {
  return displays.find((d) => d.primary) ?? displays[0]
}

export function displayById(displays: DisplayInfo[], id: number): DisplayInfo | undefined {
  return displays.find((d) => d.id === id)
}

/** 判断某个点落在哪块屏幕上；落在屏幕空隙时取距离最近的屏幕 */
export function displayIdAt(displays: DisplayInfo[], pointX: number, pointY: number): number {
  if (displays.length === 0) return 0
  let bestId = displays[0].id
  let bestDistance = Number.POSITIVE_INFINITY
  for (const display of displays) {
    const { x, y, width, height } = display.bounds
    const dx = pointX < x ? x - pointX : pointX > x + width ? pointX - (x + width) : 0
    const dy = pointY < y ? y - pointY : pointY > y + height ? pointY - (y + height) : 0
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      bestDistance = distance
      bestId = display.id
    }
  }
  return bestId
}

/** 把位置夹回工作区，至少露出 60px 让用户抓得到 */
export function clampToWorkArea(
  display: DisplayInfo,
  rect: { x: number; y: number; width: number; height: number }
): { x: number; y: number } {
  const wa = display.workArea
  const minVisible = 60
  const minX = wa.x - Math.max(0, rect.width - minVisible)
  const maxX = wa.x + wa.width - minVisible
  const maxY = wa.y + wa.height - minVisible
  return {
    x: Math.round(Math.min(Math.max(rect.x, minX), Math.max(minX, maxX))),
    y: Math.round(Math.min(Math.max(rect.y, wa.y), Math.max(wa.y, maxY)))
  }
}
