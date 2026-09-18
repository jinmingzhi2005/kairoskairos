import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { CARD_MIN_H, CARD_MIN_W, type WindowBounds } from '@shared/types'

export type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const RESIZE_DIRS: ResizeDir[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']

interface ResizeStart {
  dir: ResizeDir
  sx: number
  sy: number
  bounds: WindowBounds
}

interface Target {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 拖拽窗口边缘缩放。
 *
 * 关键点：用 event.screenX/screenY（屏幕绝对坐标）算位移，而不是 clientX。
 * 因为拖动「左/上」把手时窗口自己也在移动，clientX 会跟着变，形成正反馈把窗口甩飞。
 */
export function useWindowResize(): {
  resizing: ResizeDir | null
  onResizeStart: (event: ReactPointerEvent<HTMLElement>, dir: ResizeDir) => void
} {
  const [resizing, setResizing] = useState<ResizeDir | null>(null)
  const start = useRef<ResizeStart | null>(null)
  const pending = useRef<Target | null>(null)
  const raf = useRef<number | null>(null)

  const flush = useCallback(() => {
    raf.current = null
    const next = pending.current
    pending.current = null
    if (next) window.kairos.setWindowBounds(next)
  }, [])

  useEffect(() => {
    function move(event: PointerEvent): void {
      const current = start.current
      if (!current) return

      const dx = event.screenX - current.sx
      const dy = event.screenY - current.sy
      const base = current.bounds

      let width = base.width
      let height = base.height
      let x = base.x
      let y = base.y

      if (current.dir.includes('e')) width = base.width + dx
      if (current.dir.includes('s')) height = base.height + dy
      if (current.dir.includes('w')) {
        width = Math.max(CARD_MIN_W, base.width - dx)
        x = base.x + (base.width - width) // 右边缘保持不动
      }
      if (current.dir.includes('n')) {
        height = Math.max(CARD_MIN_H, base.height - dy)
        y = base.y + (base.height - height) // 下边缘保持不动
      }

      pending.current = {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.max(CARD_MIN_W, Math.round(width)),
        height: Math.max(CARD_MIN_H, Math.round(height))
      }
      if (raf.current === null) raf.current = requestAnimationFrame(flush)
    }

    function up(): void {
      if (!start.current) return
      start.current = null
      setResizing(null)
      if (raf.current !== null) {
        cancelAnimationFrame(raf.current)
        raf.current = null
      }
      const next = pending.current
      pending.current = null
      if (next) window.kairos.setWindowBounds(next)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [flush])

  const onResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLElement>, dir: ResizeDir) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      void window.kairos.getWindowBounds().then((bounds) => {
        start.current = { dir, sx: event.screenX, sy: event.screenY, bounds }
      })
      setResizing(dir)
    },
    []
  )

  return { resizing, onResizeStart }
}
