import { app } from 'electron'

/**
 * 开机自启。默认开启：这是日历提醒可靠性的前提——应用不常驻，到点就不会弹。
 * 开发模式下不写系统登录项，避免把 electron.exe 注册进去。
 *
 * 注意：写入和读取的参数必须完全一致。
 * `getLoginItemSettings` 在 Windows 上会把 options.args 拿去和登录项比对，
 * 不传时按「空数组」比较。早前写入带了 args: ['--autostart']（但代码里没人处理这个参数），
 * 读取时不带 → 永远匹配不上 → 明明注册成功却读回 false，
 * 表现为「勾了开机自启，下次打开发现勾没了」。
 */
export function setAutoStart(on: boolean): boolean {
  if (!app.isPackaged) {
    console.log('[kairos] 开发模式：跳过写系统登录项，仅记录开关状态 ->', on)
    return false
  }
  try {
    app.setLoginItemSettings({
      openAtLogin: on,
      openAsHidden: false,
      path: process.execPath
    })
    return true
  } catch (err) {
    console.error('[kairos] 写入开机自启失败', err)
    return false
  }
}

export function getAutoStart(): boolean {
  if (!app.isPackaged) return false
  try {
    return app.getLoginItemSettings({ path: process.execPath }).openAtLogin
  } catch {
    return false
  }
}
