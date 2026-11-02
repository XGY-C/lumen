import type {
  ExportedMessageRepositoryItem,
  ThreadHistoryAdapter,
  ThreadMessage,
} from '@assistant-ui/react'

import {
  autoTitle,
  readThread,
  saveThread,
  touchSession,
  type StoredThread,
} from '@/lib/session-store'

/**
 * 把 LocalRuntime 的历史读写接到 localStorage。
 *
 * 关键点：`scopeId` 必须等于会话 id。LocalRuntime 发现 scopeId 变了会清空当前
 * 仓库并重新 `load()`，所以切换会话不需要重建 runtime，也不会把两条会话的消息搅在一起。
 */

function upsert(
  thread: StoredThread,
  item: ExportedMessageRepositoryItem,
): StoredThread {
  const index = thread.messages.findIndex((m) => m.message.id === item.message.id)
  const next = { ...item }

  if (index >= 0) {
    thread.messages[index] = next
  } else {
    thread.messages.push(next)
  }
  return thread
}

function messageText(message: ThreadMessage): string {
  return message.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join(' ')
}

export function createHistoryAdapter(sessionId: string): ThreadHistoryAdapter {
  return {
    scopeId: sessionId,

    async load() {
      const thread = readThread(sessionId)
      if (thread.messages.length === 0) return { headId: null, messages: [] }
      return { headId: thread.headId, messages: thread.messages }
    },

    async append(item) {
      const thread = readThread(sessionId)
      thread.messages = thread.messages.filter(
        (m) => m.message.id !== item.message.id,
      )
      thread.messages.push(item)
      thread.headId = item.message.id
      saveThread(sessionId, thread)

      // 首句用户消息决定会话标题，之后不再覆盖（用户手动重命名也保留）
      if (item.message.role === 'user') autoTitle(sessionId, messageText(item.message))
      touchSession(sessionId)
    },

    async update(item) {
      // 原地改写：不能动 headId，否则会把当前分支截断到这条消息
      const thread = readThread(sessionId)
      upsert(thread, item)
      saveThread(sessionId, thread)
    },

    async delete(items) {
      const removed = new Set(items.map((item) => item.message.id))
      const thread = readThread(sessionId)
      thread.messages = thread.messages.filter((m) => !removed.has(m.message.id))

      if (thread.headId && removed.has(thread.headId)) {
        const last = thread.messages[thread.messages.length - 1]
        thread.headId = last?.message.id ?? null
      }
      saveThread(sessionId, thread)
    },
  }
}
