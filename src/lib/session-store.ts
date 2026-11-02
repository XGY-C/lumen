import type { ExportedMessageRepositoryItem } from '@assistant-ui/react'
import { useSyncExternalStore } from 'react'

/**
 * 会话存储。
 *
 * 分两层：
 * - `lumen.sessions.v1`        会话元数据（标题、时间、当前选中），一个 JSON
 * - `lumen.thread.v1:<id>`     单个会话的消息仓库（ExportedMessageRepository 的结构）
 *
 * 消息之所以单独存，是因为历史适配器是按会话增量写入的（append / update / delete），
 * 如果全塞进一个 JSON，每写一条消息都要重排整个列表的序列化，长对话会明显卡。
 */

export type SessionMeta = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export type SessionSnapshot = {
  activeId: string
  sessions: SessionMeta[]
}

export type StoredThread = {
  headId: string | null
  messages: ExportedMessageRepositoryItem[]
}

const SESSIONS_KEY = 'lumen.sessions.v1'
const THREAD_PREFIX = 'lumen.thread.v1:'
export const UNTITLED = '新对话'

/* ------------------------------------------------------------------ */
/* 底层读写                                                            */
/* ------------------------------------------------------------------ */

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 配额满或隐私模式：宁可不持久化，也不要让对话本身挂掉
  }
}

function uid() {
  try {
    return crypto.randomUUID()
  } catch {
    return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }
}

/* ------------------------------------------------------------------ */
/* 快照与订阅                                                          */
/* ------------------------------------------------------------------ */

function newMeta(): SessionMeta {
  const now = Date.now()
  return { id: uid(), title: UNTITLED, createdAt: now, updatedAt: now }
}

function isMeta(value: unknown): value is SessionMeta {
  if (!value || typeof value !== 'object') return false
  const meta = value as SessionMeta
  return typeof meta.id === 'string' && typeof meta.title === 'string'
}

function bootstrap(): SessionSnapshot {
  const saved = readJSON<SessionSnapshot>(SESSIONS_KEY)
  const sessions = Array.isArray(saved?.sessions)
    ? saved.sessions.filter(isMeta)
    : []

  if (sessions.length > 0) {
    const activeId = sessions.some((s) => s.id === saved?.activeId)
      ? (saved!.activeId as string)
      : sessions[0]!.id
    return { activeId, sessions }
  }

  const first = newMeta()
  writeJSON(SESSIONS_KEY, { activeId: first.id, sessions: [first] })
  return { activeId: first.id, sessions: [first] }
}

let cache: SessionSnapshot = bootstrap()
const listeners = new Set<() => void>()

function commit(next: SessionSnapshot) {
  // 按最近使用排序，侧栏顺序才和「最近」一致
  const sessions = [...next.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  cache = { activeId: next.activeId, sessions }
  writeJSON(SESSIONS_KEY, cache)
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSnapshot(): SessionSnapshot {
  return cache
}

// 其它标签页改了数据时同步过来，避免两个窗口互相覆盖
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== SESSIONS_KEY || !event.newValue) return
    const parsed = readJSON<SessionSnapshot>(SESSIONS_KEY)
    if (!parsed || !Array.isArray(parsed.sessions)) return
    cache = {
      activeId: parsed.activeId,
      sessions: parsed.sessions.filter(isMeta).sort((a, b) => b.updatedAt - a.updatedAt),
    }
    for (const listener of listeners) listener()
  })
}

export function useSessions(): SessionSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/* ------------------------------------------------------------------ */
/* 消息仓库                                                            */
/* ------------------------------------------------------------------ */

const threadCache = new Map<string, StoredThread>()

export function readThread(sessionId: string): StoredThread {
  const cached = threadCache.get(sessionId)
  if (cached) return cached

  const saved = readJSON<StoredThread>(THREAD_PREFIX + sessionId)
  const thread: StoredThread =
    saved && Array.isArray(saved.messages)
      ? { headId: saved.headId ?? null, messages: saved.messages }
      : { headId: null, messages: [] }

  threadCache.set(sessionId, thread)
  return thread
}

export function saveThread(sessionId: string, thread: StoredThread) {
  writeJSON(THREAD_PREFIX + sessionId, thread)
}

function hasMessages(sessionId: string): boolean {
  return readThread(sessionId).messages.length > 0
}

/**
 * 首屏是否马上要渲染正文（当前会话已有历史消息）。
 *
 * 供 main.tsx 判断要不要在首次渲染前先等 Markdown 渲染器就位：
 * 有历史就先等，避免「先纯文本、再格式化」的重排闪烁。
 */
export function hasStoredConversation(): boolean {
  return hasMessages(cache.activeId)
}

function dropThread(sessionId: string) {
  threadCache.delete(sessionId)
  try {
    localStorage.removeItem(THREAD_PREFIX + sessionId)
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* 会话操作                                                            */
/* ------------------------------------------------------------------ */

export function selectSession(sessionId: string) {
  if (cache.activeId === sessionId) return
  if (!cache.sessions.some((s) => s.id === sessionId)) return
  commit({ ...cache, activeId: sessionId })
}

/**
 * 新建会话。
 * 当前会话还没有任何消息时直接复用，避免连点几次「新对话」堆出一串空壳。
 */
export function createSession(): string {
  const now = Date.now()

  if (!hasMessages(cache.activeId)) {
    threadCache.delete(cache.activeId)
    const sessions = cache.sessions.map((s) =>
      s.id === cache.activeId ? { ...s, title: UNTITLED, updatedAt: now } : s,
    )
    commit({ activeId: cache.activeId, sessions })
    return cache.activeId
  }

  for (const session of cache.sessions) {
    if (session.id !== cache.activeId && !hasMessages(session.id)) dropThread(session.id)
  }

  const meta = newMeta()
  const kept = cache.sessions.filter((s) => hasMessages(s.id) || s.id === cache.activeId)
  commit({ activeId: meta.id, sessions: [meta, ...kept] })
  return meta.id
}

export function deleteSession(sessionId: string): string {
  dropThread(sessionId)
  const sessions = cache.sessions.filter((s) => s.id !== sessionId)

  if (sessionId !== cache.activeId) {
    commit({ activeId: cache.activeId, sessions })
    return cache.activeId
  }

  // 删的是当前会话：优先落到最近的一条，没有就新建
  if (sessions.length > 0) {
    const next = sessions.reduce((a, b) => (a.updatedAt >= b.updatedAt ? a : b))
    commit({ activeId: next.id, sessions })
    return next.id
  }

  const fresh = newMeta()
  commit({ activeId: fresh.id, sessions: [fresh] })
  return fresh.id
}

export function renameSession(sessionId: string, title: string) {
  const clean = title.replace(/\s+/g, ' ').trim()
  if (!clean) return
  const sessions = cache.sessions.map((s) =>
    s.id === sessionId ? { ...s, title: clean.slice(0, 60) } : s,
  )
  commit({ ...cache, sessions })
}

/** 会话有真实消息后，把「新对话」替换成首句内容 */
export function autoTitle(sessionId: string, text: string) {
  const session = cache.sessions.find((s) => s.id === sessionId)
  if (!session || session.title !== UNTITLED) return

  const clean = text.replace(/[#*`>\-•\s]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!clean) return

  const title = clean.length > 30 ? `${clean.slice(0, 30)}…` : clean
  commit({
    ...cache,
    sessions: cache.sessions.map((s) => (s.id === sessionId ? { ...s, title } : s)),
  })
}

export function touchSession(sessionId: string) {
  if (!cache.sessions.some((s) => s.id === sessionId)) return
  commit({
    ...cache,
    sessions: cache.sessions.map((s) =>
      s.id === sessionId ? { ...s, updatedAt: Date.now() } : s,
    ),
  })
}

