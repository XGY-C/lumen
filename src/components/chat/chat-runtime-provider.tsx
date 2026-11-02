import type { ReactNode } from 'react'
import { useMemo } from 'react'

import { AssistantRuntimeProvider, useLocalRuntime } from '@assistant-ui/react'

import { createSpringChatAdapter } from '@/lib/chat-adapter'
import { chatMode } from '@/lib/config'
import { createHistoryAdapter } from '@/lib/history-adapter'
import { createModelAdapter } from '@/lib/model-adapter'

/**
 * 每个会话一个 runtime 作用域。
 * `sessionId` 变化时 LocalRuntime 会把 `scopeId` 视为新作用域，清空并从存储重载，
 * 所以这里不需要 `key` 重建组件（重建会丢掉滚动位置和输入焦点）。
 */
export function ChatRuntimeProvider({
  sessionId,
  children,
}: {
  sessionId: string
  children: ReactNode
}) {
  const chatModel = useMemo(
    () => (chatMode === 'model' ? createModelAdapter() : createSpringChatAdapter()),
    [],
  )
  const history = useMemo(() => createHistoryAdapter(sessionId), [sessionId])
  const runtime = useLocalRuntime(chatModel, {
    scopeId: sessionId,
    adapters: { history },
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
  )
}
