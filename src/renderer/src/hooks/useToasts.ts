import { useCallback, useRef, useState } from 'react'

export interface ToastItem {
  id: number
  text: string
}

export function useToasts(): { toasts: ToastItem[]; push: (text: string) => void } {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const push = useCallback((text: string) => {
    if (!text) return
    seq.current += 1
    const item: ToastItem = { id: seq.current, text }
    setToasts((prev) => [...prev.slice(-2), item])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== item.id))
    }, 2400)
  }, [])

  return { toasts, push }
}
