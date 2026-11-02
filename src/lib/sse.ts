/**
 * 极简 SSE 解析器。
 *
 * 关键点：事件边界由「空行」决定，而一个事件可能被 TCP/HTTP 层切成多块。
 * 所以必须先累积到 buffer，再按 `\n\n` 切分，绝不能对单个 chunk 直接 split。
 */

import { StreamInterruptedError } from './chat-errors'

export type SseEvent = {
  event: string
  data: string
}

/**
 * 多久没有收到任何字节就判定连接已死。
 *
 * 为什么必须有这个：后端崩溃时，中间的代理（vite 的 http-proxy、nginx、网关）
 * 并不总会把上游的 RST 传给浏览器——实测经 vite 代理后，`reader.read()` 会
 * **永远挂起**，既不返回数据也不返回 done。没有超时的话，界面就永远停在
 * 「正在生成」，用户只能刷新页面。
 *
 * 45 秒：本地模型首个 token 最慢也就十几秒，留足余量又能让「卡死」在一次
 * 呼吸之内被发现。
 */
const IDLE_TIMEOUT_MS = 45_000

/** 给一次 read 加超时。超时即中断，不重试——SSE 是顺序的，等不到就不该继续等。 */
function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
) {
  if (timeoutMs <= 0) return reader.read()

  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StreamInterruptedError()), timeoutMs)
  })

  return Promise.race([reader.read(), timeout]).finally(() => clearTimeout(timer))
}

function parseBlock(block: string): SseEvent | null {
  let event = 'message'
  const dataLines: string[] = []
  let hasData = false

  for (const line of block.split('\n')) {
    // 空行与注释行（以 : 开头的心跳）直接跳过
    if (line.length === 0 || line.startsWith(':')) continue

    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)

    // 规范允许冒号后跟一个空格，需剥掉
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'event') {
      event = value || 'message'
    } else if (field === 'data') {
      dataLines.push(value)
      hasData = true
    }
  }

  if (!hasData) return null
  return { event, data: dataLines.join('\n') }
}

export async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
  idleTimeoutMs = IDLE_TIMEOUT_MS,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await readWithTimeout(reader, idleTimeoutMs)
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      // 统一换行，避免 Windows 后端发出 \r\n
      buffer = buffer.replace(/\r\n/g, '\n')

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)

        const parsed = parseBlock(block)
        if (parsed) yield parsed

        boundary = buffer.indexOf('\n\n')
      }
    }

    // 流结束时 buffer 里可能还有一个没有空行收尾的事件
    const tail = parseBlock(buffer + decoder.decode())
    if (tail) yield tail
  } finally {
    reader.releaseLock()
  }
}
