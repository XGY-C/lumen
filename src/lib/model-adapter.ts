import type { ChatModelAdapter } from '@assistant-ui/react'

import { MODEL_ENDPOINT, MODEL_NAME } from './config'
import { streamSseContent } from './stream-sse'

const asString = (value: unknown) =>
  typeof value === 'string' ? value : undefined

let resolvedModel: string | null = null

/* ------------------------------------------------------------------ */
/* 让 UI 能显示「实际在用哪个模型」                                      */
/* ------------------------------------------------------------------ */

const modelListeners = new Set<() => void>()

export function getActiveModelName(): string | null {
  return MODEL_NAME || resolvedModel
}

export function subscribeActiveModel(listener: () => void) {
  modelListeners.add(listener)
  return () => {
    modelListeners.delete(listener)
  }
}

function setActiveModel(name: string) {
  if (resolvedModel === name) return
  resolvedModel = name
  for (const listener of modelListeners) listener()
}

/** 本地服务通常会同时挂 embedding 模型，自动跳过 */
async function resolveModelName(abortSignal: AbortSignal): Promise<string> {
  if (MODEL_NAME) return MODEL_NAME
  if (resolvedModel) return resolvedModel

  const response = await fetch('/v1/models', { signal: abortSignal })
  if (!response.ok) throw new Error(`读取模型列表失败 ${response.status}`)

  const payload = await response.json().catch(() => null)
  const list: { id?: string }[] = Array.isArray(payload?.data) ? payload.data : []
  const chat = list.find((item) => item.id && !/embed/i.test(item.id)) ?? list[0]

  if (!chat?.id) throw new Error('本地没有可用模型，请检查 /v1/models')
  setActiveModel(chat.id)
  return chat.id
}

/**
 * 直连本地模型的适配器（OpenAI 兼容协议）。
 *
 * 请求： POST /v1/chat/completions，stream: true
 * 只在 VITE_CHAT_MODE=model 时启用，开发期由 Vite 把 /v1 代理到 1235。
 */
export function createModelAdapter(): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const model = await resolveModelName(abortSignal)

      const payload = {
        model,
        stream: true,
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

      const response = await fetch(MODEL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(payload),
        signal: abortSignal,
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(
          `模型请求失败 ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`,
        )
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('text/event-stream') || !response.body) {
        const data = await response.json().catch(() => null)
        const text =
          asString(data?.choices?.[0]?.message?.content) ??
          asString(data?.content) ??
          ''
        yield { content: [{ type: 'text', text }] }
        return
      }

      yield* streamSseContent(response.body)
    },
  }
}
