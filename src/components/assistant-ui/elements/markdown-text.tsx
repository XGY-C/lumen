import { useAuiState } from '@assistant-ui/react'
import { Component, lazy, Suspense, type FC, type ReactNode } from 'react'

import type { MarkdownTextProps } from '@/components/assistant-ui/elements/markdown-text.impl'
import { loadMarkdownImpl } from '@/lib/markdown-loader'

/**
 * Markdown 渲染器（react-markdown + remark-gfm + micromark 全家桶，约 100 kB）
 * 走动态 import，不进首屏 chunk：
 *
 * - 空对话直接首屏渲染，不下载这段代码；
 * - `preloadMarkdown()`（见 lib/markdown-loader）在首屏绘制后的空闲时段把 chunk
 *   拉下来，等第一条回答开始输出时通常已就绪，用户看不到降级态；
 * - 恢复已有会话时 main.tsx 会先 await 一次再渲染，避免「先纯文本后格式化」的重排闪烁；
 * - 万一 chunk 加载失败，错误边界兜底成纯文本，不让整页白屏。
 */
const MarkdownTextImpl = lazy(loadMarkdownImpl)

export const MarkdownText: FC<MarkdownTextProps> = (props) => (
  <MarkdownBoundary>
    <Suspense fallback={<PlainTextFallback />}>
      <MarkdownTextImpl {...props} />
    </Suspense>
  </MarkdownBoundary>
)

/* ------------------------------------------------------------------ */
/* 降级态                                                              */
/* ------------------------------------------------------------------ */

/** 从当前 part 上取纯文本；取不到就什么都不渲染 */
function useFallbackText(): string | null {
  return useAuiState((s) => {
    const part = s.part
    if (!part) return null
    if (part.type === 'text' || part.type === 'reasoning') {
      return part.text.trim().length > 0 ? part.text : null
    }
    return null
  })
}

/**
 * 渲染器还没到位时先把文字摆出来。样式刻意贴近 `.aui-md`：
 * 同样的行高与段落间距，切换过去时只有格式变、高度基本不变。
 */
const PlainTextFallback: FC = () => {
  const text = useFallbackText()
  if (!text) return null
  return (
    <div
      className="aui-md text-pretty-zh whitespace-pre-wrap"
      data-markdown-fallback=""
    >
      {text}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 错误边界                                                            */
/* ------------------------------------------------------------------ */

type BoundaryState = { failed: boolean }

/**
 * 只兜 chunk 加载失败这一种情况（网络抖动、部署换了 hash、离线打开）。
 * React 19 仍然需要类组件来捕获渲染错误。
 */
class MarkdownBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    if (import.meta.env.DEV)
      console.warn('[markdown] 渲染失败，降级为纯文本', error)
  }

  render() {
    return this.state.failed ? <PlainTextFallback /> : this.props.children
  }
}
