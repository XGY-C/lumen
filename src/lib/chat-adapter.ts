import type { ChatModelAdapter } from '@assistant-ui/react'

import { ChatHttpError, ChatNetworkError } from './chat-errors'
import { CHAT_ENDPOINT } from './config'
import { streamSseContent } from './stream-sse'

const asString = (value: unknown) =>
  typeof value === 'string' ? value : undefined

/**
 * Spring Boot 适配器。
 *
 * 请求： POST {CHAT_ENDPOINT}
 * { messages: [{ role, content }] }
 *
 * 响应： text/event-stream（帧格式见 normalizeEvent），或普通 JSON 一次性返回。
 */
export function createSpringChatAdapter(): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const payload = {
        messages: messages
          .map((message) => ({
            role: message.role,
            content: message.content
              .filter((part) => part.type === 'text')
              .map((part) => (part as { text: string }).text)
              .join('\n'),
          }))
          .filter((message) => message.content.trim().length > 0),
      }

      let response: Response
      try {
        response = await fetch(CHAT_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify(payload),
          signal: abortSignal,
        })
      } catch (error) {
        // 用户主动取消时 fetch 也会抛，别把它说成「连不上」
        if (abortSignal.aborted) throw error
        throw new ChatNetworkError()
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new ChatHttpError(response.status, detail.trim().slice(0, 200))
      }

      const contentType = response.headers.get('content-type') ?? ''

      // 后端返回普通 JSON（非流式），直接落地
      if (!contentType.includes('text/event-stream') || !response.body) {
        const data = await response.json().catch(() => null)
        const text =
          asString(data?.content) ??
          asString(data?.text) ??
          asString(data?.answer) ??
          asString(data?.data) ??
          ''
        yield { content: [{ type: 'text', text }] }
        return
      }

      // 用户按 Esc / 切会话时会 abort，这条流被主动打断不该显示成错误。
      // 其余情况（含未收到结束标记的断流）原样抛出，交给错误态处理。
      try {
        yield* streamSseContent(response.body)
      } catch (error) {
        if (abortSignal.aborted) return
        throw error
      }
    },
  }
}
