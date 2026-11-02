/**
 * Markdown 渲染器的加载器。
 *
 * 单独成一个模块，而不是塞进 `markdown-text.tsx`：
 * - 那个文件只导出组件，Fast Refresh 才能正常热更新；
 * - `main.tsx` 要基于「有没有历史会话」决定是否阻塞首屏，
 *   它只该依赖这个加载器，不必把组件模块（以及它的 props 类型）拉进来。
 */

export const loadMarkdownImpl = () =>
  import('@/components/assistant-ui/elements/markdown-text.impl')

/** chunk 只会真正下载一次，缓存 promise 让重复调用零成本 */
let pending: Promise<unknown> | null = null

/** 预取 Markdown 渲染器；不阻塞、不抛错，失败时静默降级 */
export function preloadMarkdown(): Promise<unknown> {
  pending ??= loadMarkdownImpl().catch((error: unknown) => {
    // 失败后允许下次重试（例如断网恢复）
    pending = null
    if (import.meta.env.DEV) console.warn('[markdown] 预加载失败', error)
  })
  return pending
}
