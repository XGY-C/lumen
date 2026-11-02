import { useAui } from '@assistant-ui/react'
import {
  BookOpenIcon,
  CodeIcon,
  CompassIcon,
  PenLineIcon,
  type LucideIcon,
} from 'lucide-react'

import { focusComposer } from '@/lib/composer-focus'

type Starter = {
  icon: LucideIcon
  title: string
  hint: string
  /** 提示词模板，末尾的换行是留给用户粘贴内容的位置 */
  prompt: string
}

const STARTERS: Starter[] = [
  {
    icon: CodeIcon,
    title: '读懂一段代码',
    hint: '逐行解释 · 指出边界问题',
    prompt: '帮我逐行解释下面这段代码的实现思路，并指出可能的边界问题：\n\n',
  },
  {
    icon: PenLineIcon,
    title: '润色文字',
    hint: '保留原意 · 收紧表达',
    prompt: '把下面这段文字改得更简洁、更有说服力，保持原意不变：\n\n',
  },
  {
    icon: CompassIcon,
    title: '梳理方案',
    hint: '先补背景 · 再给取舍',
    prompt:
      '我在做一个技术方案选型，请先向我提问补全背景，再给出三种可选方案与各自的风险：',
  },
  {
    icon: BookOpenIcon,
    title: '讲清一个概念',
    hint: '从直觉到细节',
    prompt: '用「先建立直觉、再补细节」的顺序讲清这个概念：',
  },
]

/**
 * 空状态。
 *
 * 这一版砍掉了两样东西：
 * - 「LUMEN · 新对话」那行大写小标签。它是落地页语言，而这个界面
 *   每天要开几十次，重复出现的口号就是噪音。
 * - 技术实现说明（「消息经本地代理转发到 Spring Boot…」）。那是 README 的内容，
 *   用户在这个位置只想知道「我能做什么」。
 *
 * 建议项从 2×2 大卡片改成单列列表：608px 列宽下，两张 290px 的卡片里只放两行小字，
 * 空得厉害；单列改成一端标题、一端说明，整列宽度都被用上，扫读也更快。
 */
export function Welcome() {
  const aui = useAui()

  const applyStarter = (prompt: string) => {
    aui.composer.setText(prompt)
    focusComposer({ caret: 'end' })
  }

  return (
    <div
      data-slot="welcome"
      className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both mt-auto mb-8 duration-200 ease-out"
    >
      <h1 className="text-display text-balance">今天想聊点什么？</h1>

      <p className="text-muted-foreground mt-3 text-body">
        挑一个开始，或直接在下方输入。
      </p>

      <div
        data-slot="starter-list"
        className="border-border/70 bg-card mt-6 divide-border/60 overflow-hidden rounded-md border divide-y"
      >
        {STARTERS.map(({ icon: Icon, title, hint, prompt }) => (
          <button
            key={title}
            type="button"
            onClick={() => applyStarter(prompt)}
            className={[
              'group flex w-full items-center gap-3 px-3 py-2.5 text-left',
              'transition-colors duration-150 ease-out',
              'hover:bg-accent/60 active:bg-accent',
              'focus-ring focus-visible:-outline-offset-2',
            ].join(' ')}
          >
            <span className="bg-muted text-muted-foreground group-hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-sm transition-colors duration-150">
              <Icon className="size-3.5" strokeWidth={1.85} />
            </span>
            {/* 两行文本块：标题在上、说明紧跟在下。
                不要用 ms-auto 把它们推到行的两端——608px 的行宽下，
                中间会掏出 300px 空白，比原来的 2×2 卡片更显空。 */}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-ui truncate font-medium">{title}</span>
              <span className="text-muted-foreground truncate text-meta">
                {hint}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
