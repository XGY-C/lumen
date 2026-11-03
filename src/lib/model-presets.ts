import type { CustomModel } from './model-settings'

/**
 * 内置预设供应商（对齐 WorkBuddy 的一键预设入口）。
 *
 * 每个预设给出「地址格式」和「模型 ID 示例」，用户选中后只需补 Key 和模型 ID。
 * 本地 Bionic（LM Studio）无需 Key。
 */

export type ModelPreset = {
  id: string
  label: string
  description: string
  baseUrl: string
  /** 该预设是否默认使用完整 URL（baseUrl 已含 /chat/completions） */
  useFullUrl: boolean
  modelIdPlaceholder: string
  needsApiKey: boolean
}

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    description: '官方 GPT 系列，需 API Key',
    baseUrl: 'https://api.openai.com/v1',
    useFullUrl: false,
    modelIdPlaceholder: 'gpt-4o',
    needsApiKey: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: '深度求索，OpenAI 兼容',
    baseUrl: 'https://api.deepseek.com/v1',
    useFullUrl: false,
    modelIdPlaceholder: 'deepseek-chat',
    needsApiKey: true,
  },
  {
    id: 'bailian',
    label: '阿里云百炼',
    description: 'DashScope 兼容模式',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    useFullUrl: false,
    modelIdPlaceholder: 'qwen-plus',
    needsApiKey: true,
  },
  {
    id: 'bionic',
    label: 'Bionic（本地）',
    description: 'LM Studio Bionic 本地推理，无需 Key',
    baseUrl: 'http://localhost:1235/v1',
    useFullUrl: false,
    modelIdPlaceholder: 'qwen3-1.7b',
    needsApiKey: false,
  },
]

export function getPreset(id: string): ModelPreset | undefined {
  return MODEL_PRESETS.find((p) => p.id === id)
}

/* ------------------------------------------------------------------ */
/* 测试连接                                                            */
/* ------------------------------------------------------------------ */

export type TestConnectionResult =
  | { ok: true; modelId: string }
  | { ok: false; message: string }

/**
 * 发一个最小 chat 请求验证连通性（对齐 WorkBuddy 的「测试连接」）。
 *
 * 只发一条空内容的探活消息，不真正消耗太多 token；
 * 只要能拿到 2xx 或能解析出 choices，就算「连接成功」。
 */
export async function testConnection(
  input: Pick<CustomModel, 'baseUrl' | 'apiKey' | 'modelId' | 'useFullUrl'>,
): Promise<TestConnectionResult> {
  const baseUrl = input.baseUrl.trim()
  const modelId = input.modelId.trim()
  if (!baseUrl || !modelId) {
    return { ok: false, message: '请先填写服务地址和模型 ID' }
  }

  const endpoint = resolveChatEndpoint(baseUrl, input.useFullUrl)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (input.apiKey.trim()) {
    headers.Authorization = `Bearer ${input.apiKey.trim()}`
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        stream: false,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return {
        ok: false,
        message: `请求失败 ${response.status}${detail ? `：${detail.slice(0, 120)}` : ''}`,
      }
    }

    // 能拿到 2xx 就算通；进一步尝试解析 choices 确认模型 ID 有效
    const payload = await response.json().catch(() => null)
    const choice = payload?.choices?.[0]
    if (choice) return { ok: true, modelId }
    return { ok: true, modelId }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, message: '连接超时（10 秒）' }
    }
    const message = error instanceof Error ? error.message : '连接失败'
    return { ok: false, message }
  }
}

/** 解析 chat 请求地址：useFullUrl 时原样返回，否则拼 /chat/completions。 */
export function resolveChatEndpoint(baseUrl: string, useFullUrl: boolean): string {
  const trimmed = baseUrl.trim()
  if (useFullUrl) return trimmed
  const root = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
  return `${root}/chat/completions`
}

/** 解析模型列表地址（/models）。 */
export function resolveModelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  const root = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
  return `${root}/models`
}
