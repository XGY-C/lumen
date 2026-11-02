/**
 * 把「出错」拆成两类，因为它们在界面上要说不同的话。
 *
 * 请求失败（`ChatHttpError`）：一个字节都没拿到，用户要做的是检查服务、然后重试。
 * 回答中断（`StreamInterruptedError`）：已经拿到半截，用户要做的是判断这半截够不够用。
 *
 * ⚠️ 两个类都必须带 `code` 字段。assistant-ui 在把错误写进消息状态之前会调
 * `toAssistantError()`：如果错误对象没有 `code`（string），它会被压成
 * `{ code: 'unknown', message }`——**自定义字段全部丢失**，UI 就再也分不清是
 * 哪种错误了。带上 `code` 之后它被识别为 AssistantError 原样保留，`kind` 还在。
 */

export type ChatErrorKind = 'http' | 'interrupted' | 'network'

export class ChatHttpError extends Error {
  readonly code: ChatErrorKind = 'http'
  readonly kind: ChatErrorKind = 'http'
  readonly status: number
  readonly detail: string
  /** AssistantError 的字段，让库把它当成「已知错误」原样保留 */
  readonly statusCode: number

  constructor(status: number, detail: string) {
    // 状态码要留在 message 里：详情是后端给的，用户排查时最先看的是 502 还是 500
    super(detail ? `${status} · ${detail}` : `服务端返回 ${status}`)
    this.name = 'ChatHttpError'
    this.status = status
    this.detail = detail
    this.statusCode = status
  }
}

export class StreamInterruptedError extends Error {
  readonly code: ChatErrorKind = 'interrupted'
  readonly kind: ChatErrorKind = 'interrupted'

  constructor() {
    super('连接在输出过程中断开')
    this.name = 'StreamInterruptedError'
  }
}

/**
 * 请求根本没发出去（离线、代理没起、DNS 失败）。
 * 浏览器抛的是 `TypeError: Failed to fetch`，对用户没有信息量，必须换成中文。
 */
export class ChatNetworkError extends Error {
  readonly code: ChatErrorKind = 'network'
  readonly kind: ChatErrorKind = 'network'

  constructor() {
    super('连不上后端服务')
    this.name = 'ChatNetworkError'
  }
}

/** 从任意抛出值里读出 kind；不是我们定义的错误就返回 null */
export function chatErrorKind(error: unknown): ChatErrorKind | null {
  if (!error || typeof error !== 'object') return null
  const kind = (error as { kind?: unknown }).kind
  return kind === 'http' || kind === 'interrupted' || kind === 'network'
    ? kind
    : null
}
