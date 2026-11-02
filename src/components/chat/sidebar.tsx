import { useAui } from '@assistant-ui/react'
import {
  ChevronRightIcon,
  CodeIcon,
  CompassIcon,
  PanelLeftCloseIcon,
  PenLineIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'

import { LumenMark } from '@/components/brand/lumen-mark'
import { SessionList } from '@/components/chat/session-list'
import { focusComposer } from '@/lib/composer-focus'
import { MOD_KEY } from '@/lib/platform'
import { type SessionMeta } from '@/lib/session-store'
import { cn } from '@/lib/utils'

type QuickPrompt = { icon: LucideIcon; label: string; prompt: string }

const QUICK_PROMPTS: QuickPrompt[] = [
  {
    icon: CodeIcon,
    label: '把需求拆成任务清单',
    prompt: '把下面这段需求拆成可执行的任务清单，标注优先级和依赖关系：\n\n',
  },
  {
    icon: PenLineIcon,
    label: '审一遍接口设计',
    prompt: '帮我审一遍下面这份接口设计，重点看命名、错误处理和边界情况：\n\n',
  },
  {
    icon: CompassIcon,
    label: '用三句话总结长文',
    prompt: '用三句话总结下面这篇长文的核心结论：\n\n',
  },
]

type SidebarProps = {
  sessions: SessionMeta[]
  activeId: string
  onSelect: (id: string) => void
  onCreate: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onOpenPalette: () => void
  /** 桌面端收起 */
  onCollapse?: () => void
  /** 移动端抽屉关闭 */
  onClose?: () => void
  className?: string
}

export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onOpenPalette,
  onCollapse,
  onClose,
  className,
}: SidebarProps) {
  const aui = useAui()
  const [quickOpen, setQuickOpen] = useState(false)

  const applyQuickPrompt = (prompt: string) => {
    aui.composer.setText(prompt)
    onClose?.()
    requestAnimationFrame(() => focusComposer())
  }

  return (
    <aside
      aria-label="对话列表"
      className={cn(
        // 宽度只走 token，不要再写 w-[17rem]：那会和 --sidebar-width 两个数各说各话
        'bg-sidebar text-sidebar-foreground border-sidebar-border flex w-(--sidebar-width) shrink-0 flex-col border-r',
        className,
      )}
    >
      {/* 品牌 */}
      <div className="flex h-(--header-height) shrink-0 items-center gap-2 px-3">
        <LumenMark className="text-brand size-[26px]" />
        <span className="text-body font-medium tracking-tight">Lumen</span>

        <div className="ms-auto flex items-center gap-0.5">
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              aria-label="收起侧栏"
              title="收起侧栏"
              className="focus-ring text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-7 items-center justify-center rounded-md transition-colors"
            >
              <PanelLeftCloseIcon className="size-4" strokeWidth={1.75} />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭侧栏"
              title="关闭侧栏"
              className="focus-ring text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-7 items-center justify-center rounded-md transition-colors"
            >
              <XIcon className="size-4" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      {/* 主操作 */}
      <div className="shrink-0 px-3 pt-1">
        <button
          type="button"
          onClick={onCreate}
          className={cn(
            // 不用品牌色：这是导航级操作，真正的「主 CTA」是发送键。
            // 侧栏顶部一大块实心蓝会把视觉重心从对话内容上拽走。
            'bg-secondary text-foreground flex h-9 w-full items-center gap-2 rounded-md px-3',
            'text-ui font-medium',
            'transition-[background-color,transform] duration-150 ease-out',
            'hover:bg-accent active:scale-[0.985]',
            'focus-ring',
          )}
        >
          <PlusIcon className="size-4" strokeWidth={2.25} />
          新对话
        </button>

        <button
          type="button"
          onClick={onOpenPalette}
          aria-label={`搜索对话（${MOD_KEY} K）`}
          className={cn(
            // 不再用边框：带边框的搜索框看起来比「新对话」还重，
            // 而它只是次要入口。改成一行可点区域，hover 才浮出底色。
            'text-muted-foreground mt-1 flex h-8 w-full items-center gap-2 rounded-md px-2.5',
            'hover:bg-sidebar-accent hover:text-sidebar-foreground focus-ring',
            'text-ui transition-colors duration-150',
          )}
        >
          <SearchIcon className="size-3.5 shrink-0" strokeWidth={1.9} />
          <span className="truncate">搜索对话</span>
          <kbd className="text-muted-foreground/70 ms-auto shrink-0 font-sans text-meta">
            {MOD_KEY} K
          </kbd>
        </button>
      </div>

      {/* 会话列表 */}
      <div className="thin-scroll mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        <SessionList
          sessions={sessions}
          activeId={activeId}
          onSelect={(id) => {
            onSelect(id)
            onClose?.()
          }}
          onRename={onRename}
          onDelete={onDelete}
        />
      </div>

      {/* 快捷提问：默认收起。
          它常驻占了 129px（整条侧栏的 14%），但空状态里已经有同一组建议，
          有会话在聊的时候它只是噪音。收成一行，需要时再展开。 */}
      <nav
        data-slot="sidebar-quick"
        aria-label="快捷提问"
        className="border-sidebar-border shrink-0 border-t px-3 py-1.5"
      >
        <button
          type="button"
          onClick={() => setQuickOpen((open) => !open)}
          aria-expanded={quickOpen}
          className={cn(
            'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
            'focus-ring flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-ui',
            'transition-colors duration-150',
          )}
        >
          <ChevronRightIcon
            className={cn(
              'size-3.5 shrink-0 transition-transform duration-150 ease-out',
              quickOpen && 'rotate-90',
            )}
            strokeWidth={2}
          />
          <span>快捷提问</span>
        </button>

        {quickOpen && (
          <div className="mt-0.5 flex flex-col">
            {QUICK_PROMPTS.map(({ icon: Icon, label, prompt }) => (
              <button
                key={label}
                type="button"
                onClick={() => applyQuickPrompt(prompt)}
                className={cn(
                  'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  'group focus-ring flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-ui',
                  'transition-colors duration-150',
                )}
              >
                <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>
        )}
      </nav>
    </aside>
  )
}
