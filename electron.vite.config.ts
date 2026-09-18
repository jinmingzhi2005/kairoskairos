import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, 'src/shared')

// 默认产物目录 out/；可用 KAIROS_OUT_DIR 指定其它目录，
// 便于在受限环境（构建产物清理被拦截）里做一次独立验证构建
const outRoot = process.env.KAIROS_OUT_DIR || 'out'
// 指定了自定义产物目录（验证构建）时不清空目录，避免触发受限环境的批量删除拦截
const emptyOutDir = !process.env.KAIROS_OUT_DIR

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: { outDir: `${outRoot}/main`, emptyOutDir }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: { outDir: `${outRoot}/preload`, emptyOutDir }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': shared
      }
    },
    plugins: [react()],
    build: {
      outDir: `${outRoot}/renderer`,
      emptyOutDir,
      rollupOptions: {
        input: {
          // 日历主窗口
          index: resolve(__dirname, 'src/renderer/index.html'),
          // 强提醒弹窗（独立小窗口）
          reminder: resolve(__dirname, 'src/renderer/reminder.html')
        }
      }
    }
  }
})
