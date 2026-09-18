import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { KairosApi, ReminderAction, SyncAddResult, Unsubscribe } from '@shared/api'
import {
  IPC,
  type AppSettings,
  type DisplayInfo,
  type ReminderPayload,
  type RuntimeState,
  type SyncState,
  type SyncedEvent,
  type TodoItem,
  type WindowBounds
} from '@shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: KairosApi = {
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<AppSettings>,
  patchSettings: (patch) => ipcRenderer.invoke(IPC.settingsPatch, patch) as Promise<AppSettings>,
  getRuntime: () => ipcRenderer.invoke(IPC.runtimeGet) as Promise<RuntimeState>,
  onRuntimeChanged: (cb) => subscribe<RuntimeState>(IPC.runtimeChanged, cb),
  setAutoStart: (on) => ipcRenderer.invoke(IPC.autostartSet, on) as Promise<boolean>,

  listTodos: () => ipcRenderer.invoke(IPC.todoList) as Promise<TodoItem[]>,
  addTodo: (input) => ipcRenderer.invoke(IPC.todoAdd, input) as Promise<TodoItem>,
  toggleTodo: (id) => ipcRenderer.invoke(IPC.todoToggle, id) as Promise<TodoItem[]>,
  removeTodo: (id) => ipcRenderer.invoke(IPC.todoRemove, id) as Promise<TodoItem[]>,
  snoozeTodo: (id, minutes) => ipcRenderer.invoke(IPC.todoSnooze, id, minutes) as Promise<TodoItem[]>,
  updateTodo: (id, patch) => ipcRenderer.invoke(IPC.todoUpdate, id, patch) as Promise<TodoItem[]>,

  onReminder: (cb) => subscribe<ReminderPayload>(IPC.reminderFired, cb),
  onTodosChanged: (cb) => subscribe<void>(IPC.todosChanged, () => cb()),
  testReminder: () => ipcRenderer.send(IPC.reminderTest),

  getReminderData: () => ipcRenderer.invoke(IPC.reminderData) as Promise<ReminderPayload | null>,
  onReminderData: (cb) => subscribe<ReminderPayload>(IPC.reminderData, cb),
  sendReminderAction: (action: ReminderAction) => ipcRenderer.send(IPC.reminderAction, action),

  getSyncState: () => ipcRenderer.invoke(IPC.syncState) as Promise<SyncState>,
  onSyncChanged: (cb) => subscribe<SyncState>(IPC.syncChanged, cb),
  addIcsFile: () => ipcRenderer.invoke(IPC.syncAddFile) as Promise<SyncAddResult>,
  addIcsUrl: (url, label) => ipcRenderer.invoke(IPC.syncAddUrl, url, label) as Promise<SyncAddResult>,
  addOutlook: () => ipcRenderer.invoke(IPC.syncAddOutlook) as Promise<SyncAddResult>,
  toggleSyncSource: (id, enabled) =>
    ipcRenderer.invoke(IPC.syncToggle, id, enabled) as Promise<SyncState>,
  removeSyncSource: (id) => ipcRenderer.invoke(IPC.syncRemove, id) as Promise<SyncState>,
  refreshSync: (id) => ipcRenderer.invoke(IPC.syncRefresh, id) as Promise<SyncState>,
  eventsInRange: (from, to) =>
    ipcRenderer.invoke(IPC.syncEvents, from, to) as Promise<SyncedEvent[]>,

  getWindowBounds: () => ipcRenderer.invoke(IPC.windowBounds) as Promise<WindowBounds>,
  setWindowBounds: (bounds) => ipcRenderer.send(IPC.windowSetBounds, bounds),
  onDisplaysChanged: (cb) => subscribe<DisplayInfo[]>(IPC.displaysChanged, cb),
  hideWindow: () => ipcRenderer.send(IPC.windowHide),

  quit: () => ipcRenderer.send(IPC.appQuit),
  onToast: (cb) => subscribe<string>(IPC.uiToast, cb)
}

contextBridge.exposeInMainWorld('kairos', api)
