import { createRoot } from 'react-dom/client'
import { ReminderApp } from './ReminderApp'
import '../styles/glass.css'

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(<ReminderApp />)
}
