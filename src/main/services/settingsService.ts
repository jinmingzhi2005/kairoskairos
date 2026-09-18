import { AppSettings, DEFAULT_SETTINGS } from '@shared/types'
import { readJson, writeJson } from '../store'

const FILE = 'settings'

export function getSettings(): AppSettings {
  return readJson<AppSettings>(FILE, DEFAULT_SETTINGS)
}

export function patchSettings(patch: Partial<AppSettings>): AppSettings {
  return writeJson(FILE, { ...getSettings(), ...patch })
}
