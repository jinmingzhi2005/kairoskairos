import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, type AppSettings, type ReminderPayload } from '@shared/types'
import { playAlertSound } from '../lib/sound'

export function ReminderApp(): JSX.Element {
  const api = window.kairos
  const [payload, setPayload] = useState<ReminderPayload | null>(null)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    void api.getSettings().then(setSettings)
    void api.getReminderData().then((data) => {
      if (data) setPayload(data)
    })
    const off = api.onReminderData((data) => setPayload(data))
    playAlertSound()
    return off
  }, [api])

  // 键盘快捷键：回车=完成，Esc=稍后
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Enter') api.sendReminderAction('done')
      if (event.key === 'Escape') api.sendReminderAction('snooze')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api])

  if (!payload) {
    return <div className="reminder-wrap" />
  }

  return (
    <div className="reminder-wrap">
      <div className="reminder">
        <div className="bell">🔔</div>
        <h3>{payload.title}</h3>
        <div className="time">
          {payload.date} {payload.time}
        </div>
        <div className="desc">到点了，处理完点「我已完成」，或稍后再说。</div>
        <div className="acts">
          <button className="btn" onClick={() => api.sendReminderAction('snooze')}>
            稍后 {settings.snoozeMinutes} 分钟
          </button>
          <button className="btn primary" onClick={() => api.sendReminderAction('done')}>
            我已完成
          </button>
        </div>
      </div>
    </div>
  )
}
