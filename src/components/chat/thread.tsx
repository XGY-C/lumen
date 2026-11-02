import {
  AuiIf,
  ThreadPrimitive,
  useAui,
  useAuiState,
  type AssistantState,
} from '@assistant-ui/react'
import { ArrowDownIcon } from 'lucide-react'
import { useEffect, useRef, type FC } from 'react'

import { Composer } from '@/components/chat/composer'
import { LiveStatus } from '@/components/chat/live-status'
import { ThinkingDots, ThreadMessage } from '@/components/chat/messages'
import { Welcome } from '@/components/chat/welcome'
import { cn } from '@/lib/utils'

const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 && !s.thread.isRunning && !s.thread.isLoading

/**
 * 首 token 到达前，assistant 消息可能还没进入消息列表。
 * 这种情况下在列表末尾补一个等待态，避免「点了发送却毫无反应」。
 */
const needsStandaloneThinking = (s: AssistantState) => {
  if (!s.thread.isRunning) return false
  const last = s.thread.messages[s.thread.messages.length - 1]
  return last?.role === 'user'
}

export function Thread({
  sessionId,
  autoFocus = true,
}: {
  /** 切换会话时把视口贴到底部 */
  sessionId?: string
  autoFocus?: boolean
}) {
  const isEmpty = useAuiState(isNewChatView)
  const viewportRef = useRef<HTMLDivElement>(null)

  // 历史是异步 load 进来的，等两帧让它进 DOM 再贴底，避免停在最上面
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const pin = () => {
      element.scrollTop = element.scrollHeight
    }
    const first = requestAnimationFrame(() => {
      pin()
      requestAnimationFrame(pin)
    })
    return () => cancelAnimationFrame(first)
  }, [sessionId])

  return (
    <ThreadPrimitive.Root className="aui-root relative flex h-full flex-col">
      <ThreadPrimitive.Viewport
        ref={viewportRef}
        data-slot="thread-viewport"
        turnAnchor="top"
        className="thin-scroll flex flex-1 flex-col overflow-y-auto overscroll-contain"
      >
        <div
          className="mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 md:px-6"
        >
          <AuiIf condition={isNewChatView}>
            <Welcome />
          </AuiIf>

          {/* 节奏分两级：轮内（用户 → 回答）24px，轮间（回答 → 下一条提问）48px。
              原来是一个统一 gap-7，导致「气泡到回答」和「回答到下一条提问」一样远，
              一轮对话读起来是平的，分不出「这是一问一答」还是「这是两轮」。
              操作栏已改为绝对定位，不再占流，所以这里的数字就是最终视觉间距。 */}
          <div
            data-slot="message-list"
            className={cn(
              'flex flex-col empty:hidden',
              '[&>*+*]:mt-6',
              '[&>[data-role="user"]:not(:first-child)]:mt-12',
              isEmpty ? 'hidden' : 'pt-6 pb-8',
            )}
          >
            <ThreadPrimitive.Messages>
              {() => <ThreadMessage />}
            </ThreadPrimitive.Messages>

            <AuiIf condition={needsStandaloneThinking}>
              <ThinkingDots />
            </AuiIf>
          </div>

          <ThreadPrimitive.ViewportFooter
            className={cn(
              'z-10 flex flex-col',
              isEmpty ? 'mb-auto' : 'sticky bottom-0 mt-auto',
            )}
          >
            <div className="relative">
              <ScrollToBottom />
              <div
                className={cn(
                  'relative flex flex-col',
                  !isEmpty && 'bg-background pt-3 pb-4',
                )}
              >
                {!isEmpty && (
                  // 内容滚到输入框下方时渐隐，避免硬边缘切割文字
                  <div
                    aria-hidden
                    className="from-background pointer-events-none absolute inset-x-0 -top-9 h-9 bg-gradient-to-t to-transparent"
                  />
                )}
                <Composer autoFocus={autoFocus} />
              </div>
            </div>
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>

      <StopOnEscape />
      <LiveStatus />
    </ThreadPrimitive.Root>
  )
}

/** Esc 停止生成：用户不必把手从键盘挪到按钮上 */
const StopOnEscape: FC = () => {
  const aui = useAui()
  const isRunning = useAuiState((s) => s.thread.isRunning)

  useEffect(() => {
    if (!isRunning) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // 有弹层（命令面板 / 删除确认）时，Esc 归弹层管，不能顺手把生成停掉
      if (document.querySelector('[data-slot="dialog-content"]')) return
      event.preventDefault()
      aui.composer.cancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [aui, isRunning])

  return null
}

const ScrollToBottom: FC = () => (
  <ThreadPrimitive.ScrollToBottom asChild>
    <button
      type="button"
      aria-label="回到最新"
      className={cn(
        'focus-ring border-border bg-card text-muted-foreground hover:text-foreground',
        'absolute -top-12 left-1/2 z-20 flex size-8 -translate-x-1/2 items-center justify-center',
        'rounded-full border shadow-sm transition-all duration-200 ease-out',
        'hover:shadow-md',
        // 已经贴底时淡出并下沉，不用 visibility:hidden 以免影响布局
        'disabled:pointer-events-none disabled:translate-y-1 disabled:opacity-0',
      )}
    >
      <ArrowDownIcon className="size-4" strokeWidth={2} />
    </button>
  </ThreadPrimitive.ScrollToBottom>
)
