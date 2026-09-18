import type { ToastItem } from '../hooks/useToasts'

export function Toasts({ items }: { items: ToastItem[] }): JSX.Element {
  return (
    <div className="toasts">
      {items.map((item) => (
        <div className="toast" key={item.id}>
          {item.text}
        </div>
      ))}
    </div>
  )
}
