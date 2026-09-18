import type {
  AppSettings,
  DisplayInfo,
  Rect,
  ReminderPayload,
  RuntimeState,
  SyncState,
  SyncedEvent,
  TodoInput,
  TodoItem,
  TodoPatch,
  WindowBounds
} from './types'

export type Unsubscribe = () => void

export type ReminderAction = 'snooze' | 'done'

/** 添加同步源的结果：用户取消、参数有问题、或成功 */
export interface SyncAddResult {
  state?: SyncState
  error?: string
  canceled?: boolean
}

export interface KairosApi {
  getSettings(): Promise<AppSettings>
  patchSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  getRuntime(): Promise<RuntimeState>
  onRuntimeChanged(cb: (state: RuntimeState) => void): Unsubscribe
  setAutoStart(on: boolean): Promise<boolean>

  listTodos(): Promise<TodoItem[]>
  addTodo(input: TodoInput): Promise<TodoItem>
  toggleTodo(id: string): Promise<TodoItem[]>
  removeTodo(id: string): Promise<TodoItem[]>
  snoozeTodo(id: string, minutes: number): Promise<TodoItem[]>
  updateTodo(id: string, patch: TodoPatch): Promise<TodoItem[]>

  onReminder(cb: (payload: ReminderPayload) => void): Unsubscribe
  /** 主进程侧待办数据变了（例如强提醒窗口里点了完成） */
  onTodosChanged(cb: () => void): Unsubscribe
  testReminder(): void

  /** 强提醒窗口侧 */
  getReminderData(): Promise<ReminderPayload | null>
  onReminderData(cb: (payload: ReminderPayload) => void): Unsubscribe
  sendReminderAction(action: ReminderAction): void

  /** 日历窗侧 */
  getWindowBounds(): Promise<WindowBounds>
  setWindowBounds(bounds: Partial<Rect>): void
  onDisplaysChanged(cb: (displays: DisplayInfo[]) => void): Unsubscribe
  hideWindow(): void

  /* ---------- 电脑日历同步 ---------- */
  getSyncState(): Promise<SyncState>
  onSyncChanged(cb: (state: SyncState) => void): Unsubscribe
  /** 弹文件对话框选一个 .ics 加入 */
  addIcsFile(): Promise<SyncAddResult>
  addIcsUrl(url: string, label?: string): Promise<SyncAddResult>
  /** 探测并用本机 Outlook 日历 */
  addOutlook(): Promise<SyncAddResult>
  toggleSyncSource(id: string, enabled: boolean): Promise<SyncState>
  removeSyncSource(id: string): Promise<SyncState>
  /** 不传 id 表示刷新全部 */
  refreshSync(id?: string): Promise<SyncState>
  eventsInRange(from: string, to: string): Promise<SyncedEvent[]>

  quit(): void
  onToast(cb: (message: string) => void): Unsubscribe
}
