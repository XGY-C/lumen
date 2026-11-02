import { useAuiState } from '@assistant-ui/react'
import {
  MenuIcon,
  MoonIcon,
  PanelLeftIcon,
  SearchIcon,
  SunIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ChatRuntimeProvider } from '@/components/chat/chat-runtime-provider'
import { CommandPalette } from '@/components/chat/command-palette'
import { Sidebar } from '@/components/chat/sidebar'
import { Thread } from '@/components/chat/thread'
import { TooltipProvider } from '@/components/ui/tooltip'
import { focusComposer } from '@/lib/composer-focus'
import { chatMode } from '@/lib/config'
import { downloadSession } from '@/lib/export-session'
import { MOD_KEY } from '@/lib/platform'
import {
  createSession,
  deleteSession,
  renameSession,
  selectSession,
  useSessions,
  type SessionMeta,
} from '@/lib/session-store'
import { useActiveModel } from '@/lib/use-active-model'
import { useTheme } from '@/lib/use-theme'
import { cn } from '@/lib/utils'

const SIDEBAR_KEY = 'lumen-sidebar'

function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'collapsed'
  } catch {
    return false
  }
}

export default function App() {
  const { theme, toggle } = useTheme()
  const { sessions, activeId } = useSessions()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)

  const setCollapsedPersisted = useCallback((next: boolean) => {
    setCollapsed(next)
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded')
    } catch {
      /* ignore */
    }
  }, [])

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  const openPalette = useCallback(() => setPaletteOpen(true), [])

  // ⌘K / Ctrl K 呼出命令面板。用 window 监听而不是绑定到某个元素，
  // 保证焦点在输入框里（用户正在打字）也能触发。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      setPaletteOpen((open) => !open)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // 抽屉打开时按 Esc 关闭，并把焦点还给触发按钮。
  // 不还的话焦点会留在已经 inert 的子树里，浏览器把它扔回 body，用户得从头 Tab。
  useEffect(() => {
    if (!drawerOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setDrawerOpen(false)
      document.getElementById('drawer-trigger')?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  // 抽屉一打开就把焦点送进去。抽屉在 DOM 里排在主区之前，
  // 不主动移焦点的话 Tab 会从触发按钮继续往主区走，永远进不了侧栏。
  useEffect(() => {
    if (!drawerOpen) return
    drawerRef.current
      ?.querySelector<HTMLElement>('button, a[href], input')
      ?.focus({ preventScroll: true })
  }, [drawerOpen])

  // 视口变宽到桌面断点时收起抽屉：否则主区会因为抽屉仍在「打开」而继续 inert，
  // 但抽屉本身已被 lg:hidden 藏起来，用户会看到一个完全点不动的界面。
  useEffect(() => {
    if (!drawerOpen) return
    const query = window.matchMedia('(min-width: 1024px)')
    const onChange = () => {
      if (query.matches) setDrawerOpen(false)
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [drawerOpen])

  const handleCreate = useCallback(() => {
    createSession()
    setDrawerOpen(false)
    requestAnimationFrame(() => focusComposer())
  }, [])

  const handleSelect = useCallback((id: string) => {
    selectSession(id)
    requestAnimationFrame(() => focusComposer())
  }, [])

  const handleDelete = useCallback((id: string) => {
    deleteSession(id)
    requestAnimationFrame(() => focusComposer())
  }, [])

  const handleExport = useCallback((session: SessionMeta) => {
    downloadSession(session)
  }, [])

  const sidebarProps = {
    sessions,
    activeId,
    onCreate: handleCreate,
    onSelect: handleSelect,
    onRename: renameSession,
    onDelete: handleDelete,
    onOpenPalette: openPalette,
  }

  return (
    <ChatRuntimeProvider sessionId={activeId}>
      <TooltipProvider delayDuration={250}>
        {/* 跳转链接：DOM 里侧栏排在主区之前，没有它，键盘用户要按十几下 Tab
            穿过整条会话列表才能到达输入框。平时整条推出视口外，拿到焦点才落下来。
            不用 sr-only 组合：`not-sr-only` 和 `fixed` 抢同一个 position 属性，
            最终谁赢取决于 Tailwind 的输出顺序，不稳定。 */}
        <a
          href="#composer-input"
          onClick={(event) => {
            event.preventDefault()
            focusComposer()
          }}
          className={cn(
            'border-border bg-card text-foreground z-50 rounded-md border px-3 py-2 text-ui shadow-2',
            'fixed start-3 top-3 -translate-y-[200%] transition-transform duration-150 ease-out',
            'focus:translate-y-0',
            'focus-ring',
          )}
        >
          跳到输入框
        </a>

        <div className="bg-background flex h-dvh overflow-hidden">
          {/* 桌面：内联侧栏 */}
          {!collapsed && (
            <Sidebar
              {...sidebarProps}
              onCollapse={() => setCollapsedPersisted(true)}
              className="hidden lg:flex"
            />
          )}

          {/* 移动：抽屉。
              `inert` 是关键：只靠 aria-hidden + translate 把抽屉移出视野，
              里面的按钮仍然是可 Tab 的——实测小屏下前 7 个落点全在这个
              「看不见但能聚焦」的区域里。inert 会同时移出 Tab 序列和无障碍树。 */}
          <div
            ref={drawerRef}
            className={cn(
              'fixed inset-0 z-40 lg:hidden',
              drawerOpen ? 'pointer-events-auto' : 'pointer-events-none',
            )}
            inert={!drawerOpen}
          >
            <div
              onClick={closeDrawer}
              className={cn(
                'absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-200 ease-out dark:bg-black/60',
                drawerOpen ? 'opacity-100' : 'opacity-0',
              )}
            />
            <Sidebar
              {...sidebarProps}
              onClose={closeDrawer}
              className={cn(
                'absolute inset-y-0 left-0 shadow-3',
                'transition-transform duration-200 ease-out',
                drawerOpen ? 'translate-x-0' : '-translate-x-full',
              )}
            />
          </div>

          {/* 抽屉展开时主区一并 inert：遮罩后面的内容既不该被 Tab 到，
              也不该被读屏念出来。 */}
          <div
            className="flex min-w-0 flex-1 flex-col"
            inert={drawerOpen}
          >
            <Header
              collapsed={collapsed}
              drawerOpen={drawerOpen}
              onExpandSidebar={() => setCollapsedPersisted(false)}
              onOpenDrawer={() => setDrawerOpen(true)}
              onOpenPalette={openPalette}
              theme={theme}
              onToggleTheme={toggle}
            />
            <main
              id="thread-main"
              tabIndex={-1}
              className="min-h-0 flex-1 outline-none"
            >
              <Thread sessionId={activeId} />
            </main>
          </div>
        </div>

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          sessions={sessions}
          activeId={activeId}
          onSelectSession={handleSelect}
          onCreateSession={handleCreate}
          onExportSession={handleExport}
          onToggleTheme={toggle}
          theme={theme}
        />
      </TooltipProvider>
    </ChatRuntimeProvider>
  )
}

/* ------------------------------------------------------------------ */
/* 顶栏                                                                */
/* ------------------------------------------------------------------ */

type HeaderProps = {
  collapsed: boolean
  drawerOpen: boolean
  onExpandSidebar: () => void
  onOpenDrawer: () => void
  onOpenPalette: () => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

function Header({
  collapsed,
  drawerOpen,
  onExpandSidebar,
  onOpenDrawer,
  onOpenPalette,
  theme,
  onToggleTheme,
}: HeaderProps) {
  const title = useThreadTitle()

  // 页面标题跟着会话走。多开标签页时，「Lumen · AI Chat」× 6 个谁也分不清；
  // 读屏用户切换标签页听到的也是同一句话。留 20 字够认出是哪一轮对话。
  useEffect(() => {
    const short = title ? (title.length > 20 ? `${title.slice(0, 20)}…` : title) : null
    document.title = short ? `${short} — Lumen` : 'Lumen · AI Chat'
  }, [title])

  return (
    <header
      className={cn(
        'border-border/60 bg-background flex h-(--header-height) shrink-0 items-center gap-1.5 border-b px-2.5 md:px-3.5',
      )}
    >
      <button
        type="button"
        id="drawer-trigger"
        onClick={onOpenDrawer}
        aria-label="打开侧栏"
        aria-expanded={drawerOpen}
        className="focus-ring text-muted-foreground hover:bg-accent hover:text-foreground flex size-9 items-center justify-center rounded-md transition-colors lg:size-8 lg:hidden"
      >
        <MenuIcon className="size-4" strokeWidth={1.75} />
      </button>

      {collapsed && (
        <button
          type="button"
          onClick={onExpandSidebar}
          aria-label="展开侧栏"
          title="展开侧栏"
          className="focus-ring text-muted-foreground hover:bg-accent hover:text-foreground hidden size-9 items-center justify-center rounded-md transition-colors lg:size-8 lg:flex"
        >
          <PanelLeftIcon className="size-4" strokeWidth={1.75} />
        </button>
      )}

      {/* 不用 h1：这是「当前在哪」的位置标签，不是页面的主标题。
          页面上唯一的主标题留给空状态那句「今天想聊点什么？」——
          两个 h1 会让读屏的标题导航列表出现两条同级项。 */}
      <p
        className={cn(
          'min-w-0 truncate text-ui font-medium tracking-tight',
          title ? 'text-foreground' : 'text-muted-foreground/70',
        )}
      >
        {title ?? '新对话'}
      </p>

      <div className="ms-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="搜索对话"
          title={`搜索对话（${MOD_KEY} K）`}
          className="focus-ring text-muted-foreground hover:bg-accent hover:text-foreground flex size-9 items-center justify-center rounded-md transition-colors lg:size-8"
        >
          <SearchIcon className="size-4" strokeWidth={1.75} />
        </button>

        <TransportChip floating={collapsed} />

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          title={theme === 'dark' ? '浅色模式' : '深色模式'}
          className="focus-ring text-muted-foreground hover:bg-accent hover:text-foreground flex size-9 items-center justify-center rounded-md transition-colors lg:size-8"
        >
          {theme === 'dark' ? (
            <SunIcon className="size-4" strokeWidth={1.75} />
          ) : (
            <MoonIcon className="size-4" strokeWidth={1.75} />
          )}
        </button>
      </div>
    </header>
  )
}

/** 侧栏收起时才在顶栏补一个状态位，避免和侧栏底部重复 */
function TransportChip({ floating }: { floating: boolean }) {
  const model = useActiveModel()
  const label =
    chatMode === 'model' ? (model ? `本地 · ${model}` : '本地模型') : 'Spring Boot'

  return (
    <span
      className={cn(
        'text-muted-foreground/70 border-border/70 me-1 hidden max-w-[16rem] items-center gap-1.5 truncate rounded-full border px-2 py-[3px] font-mono text-meta sm:inline-flex',
        floating ? 'lg:inline-flex' : 'lg:hidden',
      )}
      title={label}
    >
      <span className="bg-muted-foreground/40 size-1.5 shrink-0 rounded-full" />
      <span className="truncate">{label}</span>
    </span>
  )
}

/** 会话标题取自第一条用户消息，没有就回到「新对话」 */
function useThreadTitle(): string | null {
  return useAuiState((s) => {
    for (const message of s.thread.messages) {
      if (message.role !== 'user') continue
      const text = message.content
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (!text) continue
      return text.length > 30 ? `${text.slice(0, 30)}…` : text
    }
    return null
  })
}
