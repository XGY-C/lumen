import type { ThreadMessage } from '@assistant-ui/react'

import { readThread, type SessionMeta } from '@/lib/session-store'

/**
 * 会话检索。
 *
 * 只做「子串匹配 + 加权」——对几十到几百条会话的量级，模糊匹配（fuzzy）反而更难命中
 * 中文；用户通常是记得某句话里的词，直接按子串找更准。
 *
 * 索引按会话缓存，用 updatedAt 做版本号，只有新消息的会话会重建。
 */

export type SearchHit = {
  session: SessionMeta
  /** 标题命中区间，用于高亮 */
  titleRange: [number, number] | null
  snippet: string | null
  snippetRange: [number, number] | null
  score: number
}

type IndexedMessage = { role: 'user' | 'assistant'; text: string }

type IndexEntry = {
  stamp: number
  messages: IndexedMessage[]
}

const cache = new Map<string, IndexEntry>()

function messageText(message: ThreadMessage): string {
  return message.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n')
    .trim()
}

function entryFor(session: SessionMeta): IndexEntry {
  const cached = cache.get(session.id)
  if (cached && cached.stamp === session.updatedAt) return cached

  const messages = readThread(session.id).messages.map((item) => ({
    role: item.message.role === 'user' ? ('user' as const) : ('assistant' as const),
    text: messageText(item.message),
  }))

  const entry = { stamp: session.updatedAt, messages }
  cache.set(session.id, entry)
  return entry
}

const SNIPPET_PAD = 28

function snippetOf(text: string, index: number, length: number) {
  const start = Math.max(0, index - SNIPPET_PAD)
  const end = Math.min(text.length, index + length + SNIPPET_PAD)

  // 换行换成等长空格，长度必须 1:1，否则高亮区间会错位
  const segment = text.slice(start, end).replace(/[\n\r\t]/g, ' ')

  // 前后被截断时补省略号，用户才知道这是片段
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''

  const offset = prefix.length + (index - start)
  return {
    body: `${prefix}${segment}${suffix}`,
    range: [offset, offset + length] as [number, number],
  }
}

export function searchSessions(
  sessions: SessionMeta[],
  query: string,
  limit = 8,
): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const hits: SearchHit[] = []

  for (const session of sessions) {
    const title = session.title.toLowerCase()
    const titleIndex = title.indexOf(needle)
    let score = 0
    let titleRange: [number, number] | null = null
    let snippet: string | null = null
    let snippetRange: [number, number] | null = null

    if (titleIndex >= 0) {
      score += titleIndex === 0 ? 120 : 80
      titleRange = [titleIndex, titleIndex + needle.length]
    }

    const entry = entryFor(session)
    let messageHits = 0

    for (const message of entry.messages) {
      const lower = message.text.toLowerCase()
      const at = lower.indexOf(needle)
      if (at < 0) continue

      messageHits++
      // 命中用户自己说的话比命中模型回答更可能是「我想找的那次对话」
      score += message.role === 'user' ? 12 : 6

      if (snippet === null) {
        const found = snippetOf(message.text, at, needle.length)
        snippet = found.body
        snippetRange = found.range
      }
      if (messageHits >= 3) break
    }

    if (score === 0) continue
    hits.push({ session, titleRange, snippet, snippetRange, score })
  }

  return hits
    .sort((a, b) =>
      b.score === a.score
        ? b.session.updatedAt - a.session.updatedAt
        : b.score - a.score,
    )
    .slice(0, limit)
}
