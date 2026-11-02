// 流式光标的脉动小圆点。跟着实现一起懒加载：它只在「正文正在流式输出」时才有意义，
// 那时渲染器必然已经就位，不会出现未加样式的窗口。
// 放在 wrapper 里反而会让 Vite 把整个 markdown chunk 关联到首屏（CSS 归属的 JS chunk 会被预加载）。
import '@assistant-ui/react-markdown/styles/dot.css'

import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  type MarkdownTextPrimitiveProps,
  memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from '@assistant-ui/react-markdown'
import type { TextMessagePartProps } from '@assistant-ui/react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { type FC, memo, useMemo, useRef } from 'react'
import remarkGfm from 'remark-gfm'

import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { cn } from '@/lib/utils'

/**
 * 真正的 Markdown 渲染器。
 *
 * 这个模块（连同 react-markdown / remark-gfm / micromark 全家桶）由
 * `markdown-text.tsx` 动态 import 加载，不进首屏 chunk。
 * 它被单独拆出来的唯一目的就是「可以懒加载」，因此不要在这里
 * 静态 import 任何首屏已加载的组件（那些都在 wrapper 里）。
 */

export type MarkdownTextProps = Partial<TextMessagePartProps> & {
  components?: Parameters<typeof memoizeMarkdownComponents>[0]
  componentsByLanguage?: MarkdownTextPrimitiveProps['componentsByLanguage']
}

const useShallowStable = <T extends Record<string, unknown> | undefined>(
  value: T,
): T => {
  const ref = useRef(value)
  if (value !== ref.current) {
    const prev = ref.current
    const stable =
      value !== undefined &&
      prev !== undefined &&
      Object.keys(prev).length === Object.keys(value).length &&
      Object.keys(value).every((key) => prev[key] === value[key])
    if (!stable) ref.current = value
  }
  return ref.current
}

const MarkdownTextImpl: FC<MarkdownTextProps> = ({
  components,
  componentsByLanguage,
}) => {
  const stableComponents = useShallowStable(components)
  const stableComponentsByLanguage = useShallowStable(componentsByLanguage)
  const markdownComponents = useMemo(() => {
    if (!stableComponents) return defaultComponents
    return {
      ...defaultComponents,
      ...memoizeMarkdownComponents(stableComponents),
    }
  }, [stableComponents])

  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm]}
      className="aui-md"
      components={markdownComponents}
      componentsByLanguage={stableComponentsByLanguage}
      defer
    />
  )
}

const MarkdownText = memo(MarkdownTextImpl)

export default MarkdownText

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard()
  const onCopy = () => {
    if (!code || isCopied) return
    copyToClipboard(code)
  }

  return (
    <div className="aui-code-header-root border-border/60 bg-muted/60 mt-5 flex items-center justify-between rounded-t-xl border px-3 py-1.5">
      <span className="aui-code-header-language text-muted-foreground font-mono text-meta font-medium lowercase">
        {language}
      </span>
      <TooltipIconButton tooltip={isCopied ? '已复制' : '复制代码'} onClick={onCopy} className="size-6">
        {!isCopied && (
          <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
        )}
        {isCopied && (
          <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
        )}
      </TooltipIconButton>
    </div>
  )
}

const defaultComponents = memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <h1
      className={cn(
        "aui-md-h1 mt-8 mb-3 scroll-m-20 text-title font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "aui-md-h2 mt-8 mb-3 scroll-m-20 text-title font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        "aui-md-h3 mt-6 mb-2 scroll-m-20 text-lead font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        "aui-md-h4 mt-5 mb-1.5 scroll-m-20 text-body font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }) => (
    <h5
      className={cn(
        "aui-md-h5 mt-4 mb-1 text-body font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h6: ({ className, ...props }) => (
    <h6
      className={cn(
        "aui-md-h6 mt-4 mb-1 text-body text-muted-foreground font-semibold first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p
      className={cn(
        "aui-md-p my-5 first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn(
        "aui-md-a text-foreground decoration-foreground/50 hover:decoration-foreground underline underline-offset-2 transition-colors",
        className,
      )}
      target="_blank"
      rel="noreferrer noopener"
      {...props}
    />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "aui-md-blockquote border-foreground/20 text-foreground/80 my-5 border-s-2 ps-4",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn(
        "aui-md-ul marker:text-muted-foreground my-5 ms-5 list-disc [&>li]:mt-1.5",
        className,
      )}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        "aui-md-ol marker:text-muted-foreground my-5 ms-5 list-decimal [&>li]:mt-1.5",
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr
      className={cn("aui-md-hr border-muted-foreground/20 my-8", className)}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="aui-md-table-wrapper my-5 overflow-x-auto">
      <table
        className={cn(
          "aui-md-table min-w-full border-separate border-spacing-0",
          className,
        )}
        {...props}
      />
    </div>
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "aui-md-th bg-muted/70 text-foreground border-border/70 border-t px-3 py-2 text-start text-ui font-medium first:rounded-ss-lg last:rounded-se-lg [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        "aui-md-td border-border/70 border-s border-b px-3 py-2 align-top text-start text-ui last:border-e [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  tr: ({ className, ...props }) => (
    <tr
      className={cn(
        "aui-md-tr m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-es-lg [&:last-child>td:last-child]:rounded-ee-lg",
        className,
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("aui-md-li", className)} {...props} />
  ),
  em: ({ className, ...props }) => (
    <em className={cn("aui-md-em", className)} {...props} />
  ),
  strong: ({ className, ...props }) => (
    <strong
      className={cn("aui-md-strong font-semibold", className)}
      {...props}
    />
  ),
  sup: ({ className, ...props }) => (
    <sup
      className={cn("aui-md-sup [&>a]:text-meta [&>a]:no-underline", className)}
      {...props}
    />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "aui-md-pre thin-scroll border-border/60 bg-muted/30 overflow-x-auto rounded-t-none rounded-b-xl border border-t-0 p-3.5 font-mono text-code mb-5",
        className,
      )}
      {...props}
    />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={cn(
          !isCodeBlock &&
            "aui-md-inline-code bg-muted/60 text-foreground/90 rounded-sm px-1.5 py-0.5 font-mono text-ui font-normal",
          className,
        )}
        {...props}
      />
    );
  },
  CodeHeader,
});
