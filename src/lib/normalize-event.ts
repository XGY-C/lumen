type Delta = {
  text?: string | undefined
  reasoning?: string | undefined
  done?: boolean
}

const asString = (value: unknown) =>
  typeof value === 'string' ? value : undefined

const DONE_TYPES = new Set(['done', 'end', 'finish', 'complete', 'completed'])

/**
 * 「通道」型事件：它的 done 只表示这一路（思考 / 正文）结束，不是整条流结束。
 * 例如 { type: 'reasoning', done: true } 后面还跟着整个正文。
 */
const CHANNEL_TYPES = new Set([
  'text',
  'content',
  'delta',
  'message',
  'answer',
  'reasoning',
  'thinking',
])

/**
 * 把各种后端约定归一化成 { text | reasoning | done }。
 * 兼容：OpenAI chunk（含 reasoning_content）/ Spring AI / 自定义 {type,delta} / 裸文本。
 */
export function normalizeEvent(event: string, data: string): Delta {
  const raw = data.trim()
  if (!raw) return {}
  if (raw === '[DONE]' || raw === 'DONE') return { done: true }

  // 非 JSON：直接当文本（event 名可区分思考通道）
  if (!raw.startsWith('{') && !raw.startsWith('[')) {
    return event === 'reasoning' || event === 'thinking'
      ? { reasoning: raw }
      : { text: raw }
  }

  let json: any
  try {
    json = JSON.parse(raw)
  } catch {
    return { text: raw }
  }

  const type = String(json.type ?? json.event ?? event).toLowerCase()
  if (DONE_TYPES.has(type)) return { done: true }

  const isChannel =
    CHANNEL_TYPES.has(type) || type.includes('reason') || type.includes('think')

  // 通道级 done 不能当流结束。踩过一次：后端发 { type: 'reasoning', done: true }
  // 表示「思考阶段结束」，被当成整条流结束之后，生成态瞬间变回空闲、正文一个
  // 字都没渲染——而思考内容却是完整的，看上去像「模型只想了没答」。
  if (!isChannel && (json.done === true || json.finished === true)) {
    return { done: true }
  }

  const choice = Array.isArray(json.choices) ? json.choices[0] : undefined
  const delta = choice?.delta ?? json.delta ?? choice?.message ?? {}

  const reasoning =
    asString(delta?.reasoning_content) ??
    asString(delta?.reasoning) ??
    asString(json.reasoning_content) ??
    asString(json.reasoning) ??
    (type.includes('reason') || type.includes('think')
      ? (asString(json.delta) ?? asString(json.content))
      : undefined)

  const text =
    asString(delta?.content) ??
    asString(json.content) ??
    asString(json.text) ??
    asString(json.answer) ??
    asString(json.delta) ??
    choice?.text

  // 思考通道的帧不能同时当正文。`{ type: 'reasoning', delta: '用' }` 会被下面的
  // `json.delta` 兜底也匹配上，于是同一句话既进了 reasoning 又进了 text——
  // 表现就是折叠条下面接着一串「思考 + 正文」拼起来的文字，看起来像模型把
  // 心里话又说了一遍。思考块和正文是两条独立的通道，只能二选一。
  if (reasoning !== undefined) return { reasoning }

  return { text, reasoning }
}
