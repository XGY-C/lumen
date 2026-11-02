import {
  DownloadIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SunIcon,
  type LucideIcon,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { searchSessions, type SearchHit } from '@/lib/search'
import { type SessionMeta } from '@/lib/session-store'
import { cn } from '@/lib/utils'

/**
 * 命令面板（⌘K / Ctrl K）。
 *
 * 会话多了以后，侧栏是按时间翻的，找「上次聊 SSE 那次」会很累。这里把
 * **找会话**和**零散操作**放在同一个入口：输入就搜，不输入就给最近会话 + 常用操作。
 *
 * 键盘约定：↑↓ 移动、↵ 执行、Esc 关闭。中文输入法组字期间的 ↵ 不算提交，
 * 否则打完拼音回车会误触发第一条。
 *
 * 状态放在 `PaletteBody` 里：Dialog 关闭时不渲染内容，body 随之卸载，
 * 下次打开自然是干净的，不需要用 effect 去重置。
 */

type ActionItem = {
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  run: () => void
}

type Row =
  | { kind: 'session'; key: string; session: SessionMeta; hit: Partial<SearchHit> }
  | { kind: 'action'; key: string; action: ActionItem }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessions: SessionMeta[]
  activeId: string
  onSelectSession: (id: string) => void
  onCreateSession: () => void
  onExportSession: (session: SessionMeta) => void
  onToggleTheme: () => void
  theme: 'light' | 'dark'
}

export function CommandPalette(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className={cn(
          'top-[12%] translate-y-0 gap-0 overflow-hidden rounded-xl p-0',
          'border-border/70 shadow-3',
          'sm:max-w-[34rem]',
        )}
      >
        <DialogTitle className="sr-only">搜索对话与操作</DialogTitle>
        <PaletteBody {...props} />
      </DialogContent>
    </Dialog>
  )
}

function PaletteBody({
  onOpenChange,
  sessions,
  activeId,
  onSelectSession,
  onCreateSession,
  onExportSession,
  onToggleTheme,
  theme,
}: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const current = sessions.find((s) => s.id === activeId)

  const actions = useMemo<ActionItem[]>(() => {
    const items: ActionItem[] = [
      {
        id: 'new',
        label: '新建对话',
        hint: '另起一轮',
        icon: PlusIcon,
        run: () => {
          onCreateSession()
          onOpenChange(false)
        },
      },
    ]

    if (current) {
      items.push({
        id: 'export',
        label: '导出当前对话',
        hint: 'Markdown',
        icon: DownloadIcon,
        run: () => {
          onExportSession(current)
          onOpenChange(false)
        },
      })
    }

    items.push({
      id: 'theme',
      label: theme === 'dark' ? '切换到浅色模式' : '切换到深色模式',
      hint: '外观',
      icon: theme === 'dark' ? SunIcon : MoonIcon,
      run: () => {
        onToggleTheme()
        onOpenChange(false)
      },
    })

    return items
  }, [current, onCreateSession, onExportSession, onOpenChange, onToggleTheme, theme])

  const rows = useMemo<Row[]>(() => {
    const trimmed = query.trim()

    const sessionRows: Row[] = (
      trimmed
        ? searchSessions(sessions, trimmed, 8)
        : sessions.slice(0, 6).map((session) => ({ session }))
    ).map((hit) => ({
      kind: 'session',
      key: `s:${hit.session.id}`,
      session: hit.session,
      hit,
    }))

    const matchedActions = trimmed
      ? actions.filter((action) =>
          action.label.toLowerCase().includes(trimmed.toLowerCase()),
        )
      : actions

    return [
      ...sessionRows,
      ...matchedActions.map<Row>((action) => ({
        kind: 'action',
        key: `a:${action.id}`,
        action,
      })),
    ]
  }, [actions, query, sessions])

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    node?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const runRow = (row: Row) => {
    if (row.kind === 'action') {
      row.action.run()
      return
    }
    onSelectSession(row.session.id)
    onOpenChange(false)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (rows.length === 0) return
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActive((index) => (index + delta + rows.length) % rows.length)
      return
    }

    if (event.key === 'Enter') {
      // 输入法组字中的回车是在确认候选词，不是提交
      if (event.nativeEvent.isComposing) return
      event.preventDefault()
      const row = rows[active]
      if (row) runRow(row)
    }
  }

  const sessionCount = rows.filter((row) => row.kind === 'session').length
  const dividerAt = sessionCount > 0 && sessionCount < rows.length ? sessionCount : -1

  return (
    <>
      {/* 输入行 */}
      <div className="border-border/60 flex h-[52px] items-center gap-2.5 border-b px-4">
        <SearchIcon
          className="text-muted-foreground size-4 shrink-0"
          strokeWidth={1.9}
        />
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            // 结果集变了，高亮必须回到第一条，否则会停在已消失的位置上
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="搜索对话，或执行操作…"
          aria-label="搜索对话"
          aria-controls="palette-list"
          aria-activedescendant={rows[active] ? `palette-${rows[active].key}` : undefined}
          className="text-foreground placeholder:text-muted-foreground h-full w-full bg-transparent text-body outline-none"
        />
        <kbd className="border-border bg-muted/60 text-muted-foreground hidden shrink-0 rounded-sm border px-1.5 py-[1px] font-sans text-meta sm:block">
          Esc
        </kbd>
      </div>

      {/* 结果 */}
      <div
        id="palette-list"
        role="listbox"
        aria-label="搜索结果"
        ref={listRef}
        className="thin-scroll max-h-[min(58vh,24rem)] overflow-y-auto overscroll-contain p-1.5"
      >
        {rows.length === 0 && (
          <div className="px-3 py-8 text-center">
            <p className="text-ui">没有找到「{query.trim()}」</p>
            <p className="text-muted-foreground mt-1.5 text-meta">
              试试更短的关键词，或者搜标题里的字
            </p>
          </div>
        )}

        {rows.map((row, index) => (
          <div key={row.key}>
            {/* 两个分组都要有标题。原来只有「操作」有，上面那组会话直接开始，
                读起来像是漏了一行。 */}
            {index === 0 && row.kind === 'session' && (
              <p
                role="presentation"
                className="text-muted-foreground mt-1 mb-0.5 px-2.5 pt-1.5 tracking-[0.12em] select-none"
              >
                {query.trim() ? '对话' : '最近对话'}
              </p>
            )}
            {index === dividerAt && (
              <p
                role="presentation"
                className="text-muted-foreground mt-1 mb-0.5 px-2.5 pt-1.5 tracking-[0.12em] select-none"
              >
                操作
              </p>
            )}
            <RowButton
              id={`palette-${row.key}`}
              row={row}
              active={index === active}
              isCurrent={row.kind === 'session' && row.session.id === activeId}
              onHover={() => setActive(index)}
              onRun={() => runRow(row)}
            />
          </div>
        ))}
      </div>

      {/* 底部提示 */}
      {/* 底部提示。没有结果时 ↑↓ / ↵ 都是空操作，留着只会误导 */}
      <div className="border-border/60 text-muted-foreground flex items-center gap-3 border-t px-4 py-2 text-meta">
        {rows.length > 0 && (
          <>
            <span className="inline-flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              选择
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>↵</Kbd>
              打开
            </span>
          </>
        )}
        <span className="ms-auto font-mono tabular-nums">
          {sessionCount > 0 ? `${sessionCount} 个对话` : 'Esc 关闭'}
        </span>
      </div>
    </>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="border-border bg-muted/60 text-muted-foreground rounded-sm border px-1 py-[1px] font-sans text-meta">
      {children}
    </kbd>
  )
}

function RowButton({
  id,
  row,
  active,
  isCurrent,
  onHover,
  onRun,
}: {
  id: string
  row: Row
  active: boolean
  isCurrent: boolean
  onHover: () => void
  onRun: () => void
}) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={active}
      // listbox 用的是 aria-activedescendant 模式：焦点必须一直留在搜索框上，
      // 由 ↑↓ 移动「虚拟焦点」。这几个 option 如果能被 Tab 到，就会变成
      // 输入框和选项各有一个焦点，两次 Tab 之间状态是错位的。
      tabIndex={-1}
      data-active={active ? 'true' : undefined}
      onMouseMove={onHover}
      onClick={onRun}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-100',
        active ? 'bg-accent text-accent-foreground' : 'text-foreground/90',
      )}
    >
      {row.kind === 'action' ? (
        <>
          <row.action.icon
            className="text-muted-foreground size-4 shrink-0"
            strokeWidth={1.85}
          />
          <span className="truncate text-ui">{row.action.label}</span>
          {row.action.hint && (
            <span className="text-muted-foreground ms-auto shrink-0 text-meta">
              {row.action.hint}
            </span>
          )}
        </>
      ) : (
        <>
          <span
            className={cn(
              'mt-[6px] size-1.5 shrink-0 self-start rounded-full',
              isCurrent ? 'bg-brand' : 'bg-transparent',
            )}
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-ui">
              <Highlight text={row.session.title} range={row.hit.titleRange ?? null} />
            </span>
            {row.hit.snippet && (
              <span className="text-muted-foreground truncate text-meta">
                <Highlight text={row.hit.snippet} range={row.hit.snippetRange ?? null} />
              </span>
            )}
          </span>
          {isCurrent && (
            <span className="text-muted-foreground ms-auto shrink-0 text-meta">
              当前
            </span>
          )}
        </>
      )}
    </button>
  )
}

function Highlight({
  text,
  range,
}: {
  text: string
  range: [number, number] | null
}) {
  if (!range) return <>{text}</>
  const [start, end] = range
  if (start < 0 || end > text.length || start >= end) return <>{text}</>

  return (
    <>
      {text.slice(0, start)}
      <mark className="bg-brand/12 text-foreground rounded-sm px-[1px]">
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  )
}
