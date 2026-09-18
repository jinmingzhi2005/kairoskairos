import type { KairosApi } from '@shared/api'

declare global {
  interface Window {
    kairos: KairosApi
  }
}

export {}
