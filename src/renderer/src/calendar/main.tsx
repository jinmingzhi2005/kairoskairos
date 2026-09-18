import { createRoot } from 'react-dom/client'
import { CalendarApp } from './CalendarApp'
import '../styles/glass.css'

const container = document.getElementById('root')
if (container) {
  // 不用 StrictMode：避免开发模式下重复挂载导致 IPC 监听重复注册
  createRoot(container).render(<CalendarApp />)
}
