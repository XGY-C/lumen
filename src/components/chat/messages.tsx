import {
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  useAuiState,
  type AssistantState,
} from '@assistant-ui/react'
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  PencilIcon,
  RefreshCwIcon,
  WrenchIcon,
} from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { MarkdownText } from '@/components/assistant-ui/elements/markdown-text'
import {
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from '@/components/assistant-ui/elements/reasoning.aui'
import { Button } from '@/components/ui/button'
import { chatErrorKind } from '@/lib/chat-errors'
import { cn } from '@/lib/utils'

/** 只有 reasoning 需要成组折叠；tool-call 保持独立，避免和思考混在一起 */
const groupBy = groupPartByType({
  reasoning: ['group-reasoning'],
  'tool-call': [],
  'standalone-tool-call': [],
})

const reasoningDuration = (timing?: { startedAt: number; completedAt?: number }) =>
  timing?.completedAt === undefined
    ? undefined
    : Math.max(1, Math.round((timing.completedAt - timing.startedAt) / 1000))

/** 等待首个 token：还没有任何正文/思考/工具产出 */
const isPending = (s: AssistantState) =>
  s.message.status?.type === 'running' &&
  !s.message.parts.some(
    (part) =>
      part.type === 'text' ||
      part.type === 'reasoning' ||
      part.type === 'tool-call',
  )

/** 正文已经开始输出（此时才显示流式光标） */
const hasVisibleText = (s: AssistantState) =>
  s.message.parts.some(
    (part) => part.type === 'text' && part.text.trim().length > 0,
  )

export const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role)
  const isEditing = useAuiState((s) => s.message.composer.isEditing)

  if (isEditing) return <EditComposer />
  if (role === 'user') return <UserMessage />
  return <AssistantMessage />
}

/* ------------------------------------------------------------------ */
/* 等待态                                                              */
/* ------------------------------------------------------------------ */

export const ThinkingDots: FC = () => {
  // 等待超过几秒后换一句更具体的话。三个点在空白页上不会告诉用户
  // 「是在算，还是卡住了」；文字变化本身就是「还活着」的证据。
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const label =
    seconds >= 9 ? '这次有点慢，还在等' : seconds >= 3 ? '模型正在思考' : '正在思考'

  return (
    // 整块给 `aria-hidden`。文案每 3 秒 / 9 秒换一句，挂成 live region 会让
    // 读屏跟着念三遍，而且和正文的流式朗读互相打断。等多久的安慰信息是
    // 纯视觉的，播报统一交给 thread.tsx 里的 <LiveStatus />（只说一次「正在生成回答」）。
    <div
      data-slot="thinking"
      aria-hidden
      className="flex h-8 items-center gap-1.5"
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          // 1.5px 的点在 15px 正文旁边几乎看不见，整块空白读起来像卡住了
          className="bg-muted-foreground animate-dot size-2 rounded-full"
          style={{ animationDelay: `${index * 140}ms` }}
        />
      ))}
      <span className="text-muted-foreground ms-1.5 text-ui">{label}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 助手消息                                                            */
/* ------------------------------------------------------------------ */

const AssistantMessage: FC = () => {
  const pending = useAuiState(isPending)
  const streaming = useAuiState((s) => s.message.status?.type === 'running')
  const showCaret = useAuiState(hasVisibleText) && streaming

  return (
    <MessagePrimitive.Root
      data-slot="assistant-message"
      data-role="assistant"
      className="group/msg animate-in fade-in slide-in-from-bottom-1 fill-mode-both relative duration-200 ease-out"
    >
      <div className="text-foreground text-body text-pretty-zh">
        {pending ? <ThinkingDots /> : null}

        <MessagePrimitive.GroupedParts groupBy={groupBy}>
          {({ part, children }) => {
            switch (part.type) {
              case 'group-reasoning': {
                const running = part.status.type === 'running'
                return (
                  <ReasoningRoot streaming={running} variant="ghost">
                    <ReasoningTrigger
                      active={running}
                      duration={reasoningDuration(part.timing)}
                    />
                    <ReasoningContent aria-busy={running}>
                      <ReasoningText>{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                )
              }

              case 'reasoning':
                return (
                  <ReasoningRoot streaming={false} variant="ghost">
                    <ReasoningTrigger />
                    <ReasoningContent>
                      <ReasoningText>
                        <MarkdownText />
                      </ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                )

              case 'text':
                return <MarkdownText />

              case 'tool-call':
                return <ToolCallLine name={part.toolName} />

              default:
                return null
            }
          }}
        </MessagePrimitive.GroupedParts>

        {showCaret ? (
          <span
            aria-hidden
            data-slot="stream-caret"
            className="animate-caret bg-foreground/55 -mb-1 ms-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.16em] rounded-full align-baseline"
          />
        ) : null}

        <StoppedNote />
        <MessageError />
      </div>

      <AssistantActionBar />
    </MessagePrimitive.Root>
  )
}

/**
 * 用户按 Esc 或点停止键之后的那半截回答。
 * 不标一下的话，用户看到的只是一段戛然而止的文字，分不清是「模型就这么少」还是「被打断了」。
 */
const StoppedNote: FC = () => {
  const cancelled = useAuiState(
    (s) =>
      s.message.status?.type === 'incomplete' &&
      s.message.status.reason === 'cancelled',
  )

  if (!cancelled) return null

  return (
    <p data-slot="stopped-note" className="text-muted-foreground mt-3 text-meta">
      已停止生成
    </p>
  )
}

const ToolCallLine: FC<{ name: string }> = ({ name }) => (
  <div className="border-border/70 text-muted-foreground my-2 flex items-center gap-2 rounded-md border border-dashed px-2.5 py-1.5 text-ui">
    <WrenchIcon className="size-3.5 shrink-0" strokeWidth={1.75} />
    <span className="truncate font-mono">{name}</span>
  </div>
)

const AssistantActionBar: FC = () => (
  // 绝对定位：只在悬停/聚焦时出现，不占流。占位那 28px 曾经是「回答和下一条提问
  // 之间为什么这么空」的一半来源。不加 pointer-events-none——否则键盘 Tab 到不了。
  <div
    data-slot="msg-actions"
    className={cn(
      'absolute -bottom-6 start-0 flex h-6 items-center gap-0.5',
      'opacity-0 transition-opacity duration-150 ease-out',
      'group-hover/msg:opacity-100 focus-within:opacity-100',
    )}
  >
    <BranchPicker />

    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="text-muted-foreground flex items-center gap-0.5"
    >
      <ActionBarPrimitive.Copy asChild>
        <IconAction label="复制">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon className="size-3.5 animate-in zoom-in-50 fade-in duration-150" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon className="size-3.5" strokeWidth={1.75} />
          </AuiIf>
        </IconAction>
      </ActionBarPrimitive.Copy>

      <ActionBarPrimitive.Reload asChild>
        <IconAction label="重新生成">
          <RefreshCwIcon className="size-3.5" strokeWidth={1.75} />
        </IconAction>
      </ActionBarPrimitive.Reload>

      <ActionBarPrimitive.ExportMarkdown asChild>
        <IconAction label="导出 Markdown">
          <DownloadIcon className="size-3.5" strokeWidth={1.75} />
        </IconAction>
      </ActionBarPrimitive.ExportMarkdown>
    </ActionBarPrimitive.Root>
  </div>
)

const IconAction: FC<
  React.ComponentProps<'button'> & { label: string; children: ReactNode }
> = ({ label, children, className, ...rest }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={cn(
      'text-muted-foreground hover:bg-accent hover:text-foreground',
      'flex size-7 items-center justify-center rounded-md',
      'transition-colors duration-150',
      'focus-ring',
      className,
    )}
    {...rest}
  >
    {children}
  </button>
)

/* ------------------------------------------------------------------ */
/* 错误态                                                              */
/* ------------------------------------------------------------------ */

const MessageError: FC = () => {
  // 三种失败在界面上的分量不同：请求失败/连不上是「没拿到东西」，回答中断是
  // 「拿到半截」。都染红会夸大中断的严重性——半截内容还在，用户可以直接读。
  const kind = useAuiState((s) => {
    const status = s.message.status
    if (status?.type !== 'incomplete' || status.reason !== 'error') return null
    return chatErrorKind(status.error)
  })

  const interrupted = kind === 'interrupted'
  const title =
    kind === 'interrupted'
      ? '回答中断'
      : kind === 'network'
        ? '连不上服务'
        : '请求失败'

  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root
        data-slot="message-error"
        data-kind={kind ?? 'unknown'}
        // 错误是打断性的，错过的代价比打断高：用 alert 立刻播报整块
        // （标题 + 详情 + 重试建议），而不是等用户下次停下来才听见。
        role="alert"
        className={cn(
          'mt-5 flex items-start gap-2.5 rounded-lg border p-3',
          interrupted
            ? 'border-border bg-muted/40'
            : 'border-destructive/25 bg-destructive/[0.06]',
        )}
      >
        <AlertCircleIcon
          className={cn(
            'mt-0.5 size-4 shrink-0',
            interrupted ? 'text-muted-foreground' : 'text-destructive',
          )}
          strokeWidth={1.75}
        />
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-ui font-medium">{title}</p>
          {/* 断网时详情就是「连不上后端服务」，和标题重了；直接给操作建议更有用 */}
          {kind === 'network' ? (
            <p className="text-muted-foreground mt-0.5 text-ui leading-5">
              检查网络，或确认后端（8015）与本地模型（1235）在运行。
            </p>
          ) : (
            <ErrorPrimitive.Message className="text-muted-foreground mt-0.5 text-ui leading-5 break-words" />
          )}
          {interrupted && (
            <p className="text-muted-foreground mt-1 text-meta leading-5">
              上面的内容没有生成完，重试会整条重来。
            </p>
          )}
        </div>
        <ActionBarPrimitive.Reload asChild>
          <Button variant="outline" size="xs" className="shrink-0">
            重试
          </Button>
        </ActionBarPrimitive.Reload>
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  )
}

/* ------------------------------------------------------------------ */
/* 用户消息                                                            */
/* ------------------------------------------------------------------ */

const UserMessage: FC = () => (
  <MessagePrimitive.Root
    data-slot="user-message"
    data-role="user"
    className="group/msg animate-in fade-in slide-in-from-bottom-1 fill-mode-both relative flex flex-col items-end duration-200 ease-out"
  >
    <div
      data-slot="user-bubble"
      className="bg-secondary text-foreground max-w-[min(85%,36rem)] rounded-(--bubble-radius) px-4 py-2.5 text-body whitespace-pre-wrap wrap-break-word"
    >
      <MessagePrimitive.Parts />
    </div>

    <div
      data-slot="msg-actions"
      className={cn(
        'absolute -bottom-6 end-0 flex h-6 items-center gap-0.5',
        'opacity-0 transition-opacity duration-150 ease-out',
        'group-hover/msg:opacity-100 focus-within:opacity-100',
      )}
    >
      <BranchPicker className="me-1" />
      <ActionBarPrimitive.Root hideWhenRunning autohide="not-last">
        <ActionBarPrimitive.Copy asChild>
          <IconAction label="复制">
            <AuiIf condition={(s) => s.message.isCopied}>
              <CheckIcon className="size-3.5 animate-in zoom-in-50 fade-in duration-150" />
            </AuiIf>
            <AuiIf condition={(s) => !s.message.isCopied}>
              <CopyIcon className="size-3.5" strokeWidth={1.75} />
            </AuiIf>
          </IconAction>
        </ActionBarPrimitive.Copy>

        <ActionBarPrimitive.Edit asChild>
          <IconAction label="编辑后重新发送">
            <PencilIcon className="size-3.5" strokeWidth={1.75} />
          </IconAction>
        </ActionBarPrimitive.Edit>
      </ActionBarPrimitive.Root>
    </div>
  </MessagePrimitive.Root>
)

/* ------------------------------------------------------------------ */
/* 分支切换                                                            */
/* ------------------------------------------------------------------ */

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => (
  <BranchPickerPrimitive.Root
    hideWhenSingleBranch
    className={cn(
      'text-muted-foreground/80 me-1 inline-flex items-center gap-0.5 text-meta tabular-nums',
      className,
    )}
    {...rest}
  >
    <BranchPickerPrimitive.Previous asChild>
      <IconAction label="上一个版本">
        <ChevronLeftIcon className="size-3.5" strokeWidth={2} />
      </IconAction>
    </BranchPickerPrimitive.Previous>
    <span className="min-w-8 text-center font-medium">
      <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
    </span>
    <BranchPickerPrimitive.Next asChild>
      <IconAction label="下一个版本">
        <ChevronRightIcon className="size-3.5" strokeWidth={2} />
      </IconAction>
    </BranchPickerPrimitive.Next>
  </BranchPickerPrimitive.Root>
)

/* ------------------------------------------------------------------ */
/* 就地编辑                                                            */
/* ------------------------------------------------------------------ */

const EditComposer: FC = () => (
  <MessagePrimitive.Root className="flex flex-col">
    <ComposerPrimitive.Root className="border-border focus-within:border-brand/45 ms-auto flex w-full max-w-[min(85%,36rem)] flex-col rounded-(--bubble-radius) border bg-card shadow-1 transition-colors">
      <ComposerPrimitive.Input
        autoFocus
        rows={1}
        className="text-foreground field-sizing-content min-h-11 w-full resize-none bg-transparent px-4 pt-2.5 pb-1 text-body outline-none"
      />
      <div className="flex items-center justify-end gap-1.5 px-2 pb-2">
        <ComposerPrimitive.Cancel asChild>
          <Button variant="ghost" size="sm" className="h-7 px-2.5 text-ui">
            取消
          </Button>
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild>
          <Button size="sm" className="h-7 px-2.5 text-ui">
            重新发送
          </Button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  </MessagePrimitive.Root>
)
