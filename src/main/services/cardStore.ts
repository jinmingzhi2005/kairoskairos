import { CARD_DEFAULT_H, CARD_DEFAULT_W, CARD_MIN_H, CARD_MIN_W, type CardState, type DisplayInfo } from '@shared/types'
import { readJson, writeJson } from '../store'
import { clampToWorkArea, displayById, primaryDisplay } from './displayService'

const FILE = 'calendar'
const GAP = 24

interface CardStore {
  card: CardState | null
}

export function defaultCardState(displays: DisplayInfo[]): CardState {
  const display = primaryDisplay(displays)
  const wa = display.workArea
  const h = Math.min(CARD_DEFAULT_H, wa.height - GAP * 2)
  return {
    displayId: display.id,
    x: wa.x + wa.width - CARD_DEFAULT_W - GAP,
    y: wa.y + GAP,
    w: CARD_DEFAULT_W,
    h,
    collapsed: false
  }
}

/** 显示器拔掉或分辨率变了，把跑到屏幕外的日历窗拉回来 */
export function healCardState(
  state: CardState,
  displays: DisplayInfo[]
): { state: CardState; healed: boolean } {
  const display = displayById(displays, state.displayId) ?? primaryDisplay(displays)
  const wa = display.workArea

  const width = Math.max(CARD_MIN_W, Math.min(state.w, wa.width))
  const height = Math.max(CARD_MIN_H, Math.min(state.h, wa.height))

  const outside =
    !displayById(displays, state.displayId) ||
    state.x > wa.x + wa.width - 40 ||
    state.x + width < wa.x + 40 ||
    state.y > wa.y + wa.height - 40 ||
    state.y + 40 < wa.y ||
    width !== state.w ||
    height !== state.h

  const clamped = clampToWorkArea(display, { ...state, width, height })

  if (!outside) return { state, healed: false }

  return {
    state: { ...state, displayId: display.id, x: clamped.x, y: clamped.y, w: width, h: height },
    healed: true
  }
}

export function getCardState(displays: DisplayInfo[]): CardState {
  const stored = readJson<CardStore>(FILE, { card: null }).card
  if (!stored) {
    const created = defaultCardState(displays)
    saveCardState(created)
    return created
  }
  const { state, healed } = healCardState(stored, displays)
  if (healed) saveCardState(state)
  return state
}

export function saveCardState(state: CardState): CardState {
  writeJson<CardStore>(FILE, { card: state })
  return state
}
