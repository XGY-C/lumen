import { useAuiState } from '@assistant-ui/react'
import { useEffect, useRef } from 'react'

/**
 * 生成状态的读屏播报。
 *
 * 为什么不是给现成的提示文案加个 `role="status"` 就完事：
 * - `ThinkingDots` 的文案每过 3 秒、9 秒都会换一句（「正在思考」→「模型正在思考」
 *   →「这次有点慢」）。挂成 live region 的话读屏会跟着念三遍，而且和正文的
 *   流式朗读互相打断。所以那里改成 `aria-hidden`，播报统一收到这里。
 * - live region 只在**内容变化**时朗读。同一条消息连续生成两次都结束，
 *   如果两次都写「回答已完成」，React 认为文本没变、不重渲染，第二次就哑了。
 *   所以先清空、下一拍再写入，保证每次都是一次真实的文本变化。
 *
 * 只播报「事件」，不播报「状态」：开始、结束、被用户叫停。
 * 失败态交给错误卡片自己的 `role="alert"`，避免同一个事故被念两遍。
 *
 * 内容直接写 DOM 而不是走 state：这块文本是给无障碍树看的，不是渲染结果。
 * 走 state 要多一次渲染，而且「先清空再写入」在同一个 effect 里做，
 * React 会把两次 setState 批处理掉，反而制造不出变化。
 */
export function LiveStatus() {
  // 签名里同时包含「是否在跑」和「最后一条消息的终态」：
  // 两者可能分两次渲染更新，合成一个字符串能让 effect 只对真正的状态迁移反应。
  const signature = useAuiState((s) => {
    const last = s.thread.messages[s.thread.messages.length - 1]
    const status = last?.status
    const reason = status?.type === 'incomplete' ? status.reason : ''
    return [s.thread.isRunning ? 'run' : 'stop', status?.type ?? 'none', reason].join('|')
  })

  const nodeRef = useRef<HTMLDivElement>(null)
  const previous = useRef<string | null>(null)

  useEffect(() => {
    const prev = previous.current
    previous.current = signature

    // 首次挂载（含切会话后重建）不播报：用户没做任何操作
    if (prev === null || prev === signature) return

    const [now, type, reason] = signature.split('|')
    const [before] = prev.split('|')

    // 只对「开始」和「结束」这两个迁移出声，中途其它状态变化一律忽略
    let next: string | null = null
    if (now === 'run' && before === 'stop') {
      next = '正在生成回答'
    } else if (now === 'stop' && before === 'run') {
      next =
        type === 'incomplete'
          ? reason === 'cancelled'
            ? '已停止生成'
            : // 失败由错误卡片自己的 role="alert" 播报，这里必须**清空**。
              // 留成上一句「正在生成回答」的话，读屏用户回头查 live 区会以为还在生成
              // ——中断态最忌讳这个。
              ''
          : '回答已完成'
    }
    if (next === null) return

    const node = nodeRef.current
    if (!node) return

    node.textContent = ''
    const timer = setTimeout(() => {
      node.textContent = next
    }, 80)

    return () => clearTimeout(timer)
  }, [signature])

  return (
    <div
      ref={nodeRef}
      data-slot="live-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    />
  )
}
