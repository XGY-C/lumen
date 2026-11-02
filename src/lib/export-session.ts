import { readThread, type SessionMeta } from '@/lib/session-store'

/**
 * 把一个会话导出成 Markdown。
 *
 * 思考过程用 `<details>` 折叠：它往往比正文长好几倍，直接摊开会把回答淹掉；
 * VSCode / Obsidian / Typora / GitHub 都支持这个标签。
 */

const pad = (value: number) => String(value).padStart(2, '0')

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${formatDate(timestamp)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function partsOf(
  message: { content: readonly { type: string; text?: string }[] },
  type: 'text' | 'reasoning',
): string {
  return message.content
    .filter((part) => part.type === type && part.text)
    .map((part) => part.text!.trim())
    .filter(Boolean)
    .join('\n\n')
}

export function sessionToMarkdown(session: SessionMeta): string {
  const thread = readThread(session.id)
  const lines: string[] = [`# ${session.title}`, '']
  lines.push(
    `> ${formatDateTime(session.createdAt)} · ${thread.messages.length} 条消息`,
    '',
  )

  for (const { message } of thread.messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue

    const reasoning = partsOf(message, 'reasoning')
    const text = partsOf(message, 'text')

    lines.push('---', '', `## ${message.role === 'user' ? '你' : 'Lumen'}`, '')

    if (reasoning) {
      lines.push(
        '<details>',
        '<summary>思考过程</summary>',
        '',
        ...reasoning.split('\n'),
        '',
        '</details>',
        '',
      )
    }

    if (text) lines.push(text, '')
  }

  // 不压缩空行：正文里的代码块可能自带连续空行，动了就改坏了原文
  return `${lines.join('\n').trimEnd()}\n`
}

function safeFilename(title: string): string {
  // Windows 文件名不能出现 \ / : * ? " < > |，控制字符也一并换掉。
  // 按码点逐个判断而不是写正则区间，免得把 `\u0000-\u001f` 这种字面量混进正则。
  const cleaned = Array.from(title.replace(/\s+/g, ' ').trim())
    .map((char) => {
      const code = char.codePointAt(0) ?? 0
      if (code < 0x20 || code === 0x7f) return '-'
      return '\\/:*?"<>|'.includes(char) ? '-' : char
    })
    .join('')
    .trim()
    .slice(0, 60)

  return cleaned || '对话'
}

export function downloadSession(session: SessionMeta) {
  const markdown = sessionToMarkdown(session)
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${formatDate(session.createdAt)}-${safeFilename(session.title)}.md`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  // Safari 需要等下载真正开始再回收
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
