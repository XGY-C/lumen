import { StreamInterruptedError } from './chat-errors'
import { normalizeEvent } from './normalize-event'
import { readSseEvents } from './sse'

/** 攒够这么久再 flush 一次，避免逐字符推送把 React 打爆 */
const FLUSH_INTERVAL_MS = 40

/**
 * 消费一条 SSE 流并产出 assistant-ui 需要的内容快照。
 *
 * 注意：每次 yield 的是「累积后的完整内容」，不是增量；收尾必须再 yield 一次，
 * 否则最后 40ms 内的 token 会丢。
 */
export async function* streamSseContent(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{
  content: (
    | { type: 'reasoning'; text: string }
    | { type: 'text'; text: string }
  )[]
}> {
  let text = ''
  let reasoning = ''
  let lastFlush = performance.now()
  /** 是否收到了「整条流结束」的标记（`[DONE]` / `{type:'done'}`） */
  let completed = false

  const build = () => ({
    content: [
      ...(reasoning
        ? [{ type: 'reasoning' as const, text: reasoning }]
        : []),
      ...(text ? [{ type: 'text' as const, text }] : []),
    ],
  })

  try {
    for await (const sse of readSseEvents(body)) {
      const delta = normalizeEvent(sse.event, sse.data)
      if (delta.done) {
        completed = true
        break
      }

      if (delta.reasoning) reasoning += delta.reasoning
      if (delta.text) text += delta.text

      const now = performance.now()
      if (now - lastFlush >= FLUSH_INTERVAL_MS) {
        lastFlush = now
        yield build()
      }
    }
  } catch (error) {
    // 超时/断流：先把最后一段内容交出去，再抛。
    // 否则用户看到的是「少了一截内容的半截回答」，而不是「断在这里的半截回答」。
    yield build()
    throw error
  }

  // 先把最后 40ms 的内容交出去，再判断这次收尾是不是正常
  yield build()

  // 没有结束标记就结束 = 连接被掐断（后端崩溃、代理超时、网络断开）。
  // 不抛的话消息会被当成「正常完成」，界面永远停在生成态：半截回答 + 闪烁光标
  // + 停止键，用户看不出发生了什么，也没法重试。
  if (!completed) throw new StreamInterruptedError()
}
