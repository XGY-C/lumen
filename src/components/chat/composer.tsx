import { ComposerPrimitive, useAuiState } from '@assistant-ui/react'
import { ArrowUpIcon, SquareIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * 输入区。
 *
 * 设计意图：
 * - 唯一的主 CTA 是右下角的圆形按钮，空输入时降级为不可点（不是隐藏），
 *   这样按钮位置永远稳定，视线不用重新找。
 * - 生成中同一个位置变成停止键，形状从「箭头」变「方块」，不做位移。
 * - 不提供附件入口：当前后端没有附件通道，放了就是假入口。
 * - 按钮绝对定位在容器右下角，而不是单占一行：单行输入时整框 52px，
 *   多行时按钮跟随底部。文本区的 padding-right 保证任何一行都不会被按钮压住。
 * - 不再常驻「Enter 发送 · Shift + Enter 换行」：聊天产品的键位是通用约定，
 *   而为它单开一行让空态从 52px 涨到 86px。停止键的 title 里保留了 Esc 提示。
 */
export function Composer({ autoFocus = true }: { autoFocus?: boolean }) {
  const isRunning = useAuiState((s) => s.thread.isRunning)
  const canSend = useAuiState((s) => s.composer.canSend)

  return (
    <ComposerPrimitive.Root className="relative flex w-full flex-col">
      <div
        data-slot="composer-shell"
        className={cn(
          'border-border bg-card relative w-full',
          'rounded-(--composer-radius) border',
          'shadow-1',
          'transition-[border-color,box-shadow] duration-200 ease-out',
          // 聚焦态用品牌色的边框：深浅色下都能读出「当前在这里输入」，
          // 又不会像实心色块那样抢走消息内容的注意力。
          // 透明度是量出来的：45% 在白底上只有 1.80:1，低于 WCAG 2.4.11 要求的 3:1，
          // 键盘用户看不出框在哪。85% 是 3.36:1，刚好达标又不像实线那样重。
          'focus-within:border-brand/85',
          'focus-within:shadow-2',
        )}
      >
        <ComposerPrimitive.Input
          id="composer-input"
          data-slot="composer-input"
          placeholder="给 Lumen 发消息…"
          aria-label="消息输入框"
          rows={1}
          autoFocus={autoFocus}
          enterKeyHint="send"
          spellCheck={false}
          className={cn(
            'aui-composer-input text-foreground caret-brand text-body block',
            'placeholder:text-muted-foreground',
            // 52px = 12 上下内边距 + 26.25 行高 + 2 边框。单行时按钮正好垂直居中。
            'field-sizing-content max-h-[min(40vh,18rem)] min-h-13 w-full resize-none',
            'bg-transparent ps-4 pe-14 pt-3 pb-3 outline-none',
            'thin-scroll',
          )}
        />

        <div className="absolute end-2 bottom-2 flex items-center">
          {isRunning ? (
            <ComposerPrimitive.Cancel asChild>
              <button
                type="button"
                aria-label="停止生成"
                title="停止生成（Esc）"
                className={cn(
                  'bg-brand text-brand-foreground flex size-9 items-center justify-center rounded-full',
                  'transition-[background-color,transform] duration-150 ease-out',
                  'hover:bg-brand/90 active:scale-90',
                  'focus-ring',
                )}
              >
                <SquareIcon className="size-3 fill-current" />
              </button>
            </ComposerPrimitive.Cancel>
          ) : (
            <ComposerPrimitive.Send asChild>
              <button
                type="button"
                disabled={!canSend}
                aria-label="发送消息"
                className={cn(
                  'flex size-9 items-center justify-center rounded-full',
                  'transition-[background-color,color,transform] duration-150 ease-out',
                  'focus-ring',
                  canSend
                    ? 'bg-brand text-brand-foreground hover:bg-brand/90 active:scale-90'
                    : 'bg-muted text-muted-foreground/55 cursor-not-allowed',
                )}
              >
                <ArrowUpIcon className="size-4" strokeWidth={2.25} />
              </button>
            </ComposerPrimitive.Send>
          )}
        </div>
      </div>

      {/* 固定高度：状态切换时下方内容不位移。
          用满不透明的 muted-foreground（浅色 5.21:1）而不是 /55：
          后者实测只有 2.22:1，11px 的字等于看不见——免责声明不能做成装饰。 */}
      <p
        data-slot="composer-note"
        className={cn(
          'text-muted-foreground mt-2 flex h-4 items-center justify-center gap-1.5',
          'text-meta select-none',
        )}
      >
        {isRunning ? (
          <>
            <span className="bg-foreground/45 inline-block size-1.5 animate-pulse rounded-full" />
            正在生成 · 按 Esc 停止
          </>
        ) : (
          '内容由 AI 生成，请核查重要信息'
        )}
      </p>
    </ComposerPrimitive.Root>
  )
}
