import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { type SessionMeta } from '@/lib/session-store'
import { cn } from '@/lib/utils'

type SessionListProps = {
  sessions: SessionMeta[]
  activeId: string
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

const DAY = 86_400_000

/** 按「今天 / 昨天 / 近 7 天 / 更早」分组，比一堆等长时间戳好扫 */
function bucketOf(timestamp: number): string {
  const now = new Date()
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime()

  if (timestamp >= startOfToday) return '今天'
  if (timestamp >= startOfToday - DAY) return '昨天'
  if (timestamp >= startOfToday - 6 * DAY) return '近 7 天'
  return '更早'
}

const ORDER = ['今天', '昨天', '近 7 天', '更早'] as const

export function SessionList({
  sessions,
  activeId,
  onSelect,
  onRename,
  onDelete,
}: SessionListProps) {
  const [pendingDelete, setPendingDelete] = useState<SessionMeta | null>(null)

  const groups = useMemo(() => {
    const map = new Map<string, SessionMeta[]>()
    for (const session of sessions) {
      const key = bucketOf(session.updatedAt)
      const list = map.get(key)
      if (list) list.push(session)
      else map.set(key, [session])
    }
    return ORDER.filter((label) => map.has(label)).map((label) => ({
      label,
      items: map.get(label)!,
    }))
  }, [sessions])

  const confirmDelete = () => {
    if (!pendingDelete) return
    onDelete(pendingDelete.id)
    setPendingDelete(null)
  }

  return (
    <>
      <div className="flex flex-col gap-5">
        {groups.map(({ label, items }) => (
          <div key={label} className="flex flex-col gap-0.5">
            {/* 分组标题原来压到 55%，在浅色侧栏上只有 2.16:1 —— 分组等于不存在。
                `font-mono` 和 `uppercase` 对中文都没有作用（汉字没有等宽字形、
                也没有大小写），换成 100% 的次要色 + 常规字距。 */}
            <p className="text-muted-foreground mb-1 px-2 text-meta select-none">
              {label}
            </p>
            {items.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={session.id === activeId}
                onSelect={onSelect}
                onRename={onRename}
                onRequestDelete={() => setPendingDelete(session)}
              />
            ))}
          </div>
        ))}
      </div>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        {/* 必须带 sm: 前缀。DialogContent 自带的 sm:max-w-lg 是断点变体，
            只在 `max-w-[22rem]` 上覆盖是赢不了的——宽度会一直是 512px。 */}
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lead">删除这个对话？</DialogTitle>
            <DialogDescription className="text-ui">
              「{pendingDelete?.title}」的消息将从本机移除，无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-1">
            {/* 32px 的按钮在触摸屏上偏小；危险操作的点击区更不该省。
                取消用 outline 明确是个按钮，不是一行说明文字。 */}
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

type RowProps = {
  session: SessionMeta
  active: boolean
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onRequestDelete: () => void
}

function SessionRow({
  session,
  active,
  onSelect,
  onRename,
  onRequestDelete,
}: RowProps) {
  const [editing, setEditing] = useState(false)
  const cancelled = useRef(false)

  const commit = (value: string) => {
    setEditing(false)
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const next = value.trim()
    if (next && next !== session.title) onRename(session.id, next)
  }

  return (
    <div
      data-slot="session-row"
      className={cn(
        'group relative flex items-center rounded-md transition-colors duration-150',
        active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60',
      )}
    >
      {/* 选中指示条：`bg-sidebar-accent` 这层浅灰在白底侧栏上几乎看不出来，
          真正告诉用户「你在这一条」的是这根 2px 的竖条。 */}
      {active && (
        <span
          aria-hidden
          className="bg-brand absolute start-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full"
        />
      )}

      {editing ? (
        <input
          autoFocus
          defaultValue={session.title}
          aria-label="重命名对话"
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit(event.currentTarget.value)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancelled.current = true
              setEditing(false)
            }
          }}
          onBlur={(event) => commit(event.currentTarget.value)}
          className="text-sidebar-foreground m-1 w-full rounded-sm bg-transparent px-1.5 py-1 text-ui outline-none ring-1 ring-sidebar-ring/50 focus:ring-2 focus:ring-sidebar-ring/60"
        />
      ) : (
        <button
          type="button"
          onClick={() => onSelect(session.id)}
          onDoubleClick={() => setEditing(true)}
          aria-current={active ? 'true' : undefined}
          title={session.title}
          className={cn(
            // 不再常驻预留 52px 给两个按钮（那会白吃掉 4 个汉字）。
            // 按钮改成绝对定位浮在标题尾部，静止时标题能用满整行。
            'focus-ring flex min-w-0 flex-1 items-center rounded-md px-2 py-2.5 text-left',
            // 触摸屏 40px 行高才够点；桌面回到 36px 保持密度
            'lg:py-2',
            'transition-colors duration-150',
          )}
        >
          <span
            data-slot="session-title"
            className={cn(
              'truncate text-ui',
              // 三档色阶：分组标题 muted（4.93:1）< 普通行 80%（8.12:1）< 当前行 100%。
              // 原来普通行和分组标题同为 muted，列表读起来是一片同级的灰。
              active
                ? 'text-sidebar-foreground'
                : 'text-sidebar-foreground/80 group-hover:text-sidebar-foreground',
            )}
          >
            {session.title}
          </span>
        </button>
      )}

      {!editing && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="更多操作"
              title="更多操作"
              className={cn(
                // 一个「…」而不是并排两个图标：重命名和删除都是低频操作，
                // 常驻两个 24px 图标等于用 80px 的行宽换两个几乎不点的按钮。
                'focus-ring text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                // 触摸屏 28px 点击区、桌面 24px：和行高（40/36px）留出呼吸感，
                // 又保证触摸屏仍可轻松点中（≥ 24px 是移动端触控建议下限）。
                'absolute end-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-sm lg:size-6',
                'transition-colors duration-150',
                'data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground',
                // 按钮一旦可见就带实色背景，把从左侧透进来的标题文字盖住；
                // 否则 group-hover 显示按钮、鼠标还在标题上时，文字会从图标下透出糊成一团。
                'group-hover:bg-sidebar-accent',
                active
                  ? 'bg-sidebar-accent opacity-100'
                  : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              )}
            >
              <MoreHorizontalIcon className="size-3.5" strokeWidth={2} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            // 点了「重命名」后不能让菜单把焦点还回触发按钮——input 会和它抢。
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <DropdownMenuItem
              onSelect={() => requestAnimationFrame(() => setEditing(true))}
            >
              <PencilIcon className="size-3.5" strokeWidth={1.85} />
              重命名
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onRequestDelete}>
              <Trash2Icon className="size-3.5" strokeWidth={1.85} />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
