let audioCtx: AudioContext | null = null

/**
 * 强提醒提示音。
 * Windows 的系统默认声没法从应用里编程触发，这里用 WebAudio 合成三声短铃代替；
 * 普通级别走系统通知，那个会自带系统提示音。
 */
export function playAlertSound(): void {
  try {
    audioCtx = audioCtx ?? new AudioContext()
    const ctx = audioCtx
    ;[0, 0.18, 0.36].forEach((delay, index) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880 + index * 160
      const at = ctx.currentTime + delay
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(at)
      osc.stop(at + 0.16)
    })
  } catch (err) {
    console.warn('[kairos] 提示音播放失败', err)
  }
}
