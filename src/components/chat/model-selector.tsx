import {
  AlertCircleIcon,
  BotIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  PlusIcon,
  RefreshCwIcon,
} from 'lucide-react'
import { useCallback, useState } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  activateModel,
  addModel,
  useModelSettings,
} from '@/lib/model-settings'
import { useModelList } from '@/lib/use-model-list'
import { cn } from '@/lib/utils'

/**
 * 输入框旁的模型选择器。
 *
 * 会话级切换：点选后写进 model-settings（localStorage 持久化），
 * 之后的每一条消息都走这个模型，已经生成的回答不变。
 *
 * 选项优先来自「本地模型」（经前端同源代理 /v1/models 自动探测本地服务）；
 * 此外还有「自定义模型」——自己在设置里配置的模型。两组用标签区分：
 * 本地模型在上、自定义模型在下。底部有「管理模型…」入口，
 * 通过 window 事件通知 App 打开设置面板。
 */

export const OPEN_MODEL_MANAGER_EVENT = 'lumen:open-model-manager'

export function ModelSelector() {
  const [open, setOpen] = useState(false)
  const { state: list, load } = useModelList()
  const { models, activeModelId } = useModelSettings()

  const active = models.find((m) => m.id === activeModelId)

  // 真·自定义模型：有 baseUrl 或 apiKey。baseUrl 为空的记录是「本地模型」点选时
  // 自动落库的快捷项，应归入「本地模型」分组，不能重复出现在「自定义模型」里。
  const customModels = models.filter((m) => m.baseUrl || m.apiKey)

  // 打开下拉时才拉列表，并把「打开」与「拉取」绑在同一次动作里
  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (next) load()
    },
    [load],
  )

  const label = active?.name ?? '选择模型'

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="选择模型"
          title="选择模型"
          className={cn(
            'text-muted-foreground hover:bg-accent hover:text-foreground',
            'flex h-7 max-w-[11rem] items-center gap-1.5 rounded-md px-2',
            'text-ui transition-colors duration-150',
            'focus-ring',
            open && 'bg-accent text-foreground',
          )}
        >
          <BotIcon className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{label}</span>
          <ChevronsUpDownIcon
            className="size-3 shrink-0 opacity-60"
            strokeWidth={2}
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="min-w-48 max-w-[16rem]"
      >
        {/* 本地模型：直接来自本地服务 /v1/models，展示全部（含已配置的） */}
        {list.status === 'ready' && list.models.length > 0 && (
          <>
            <GroupLabel>本地模型</GroupLabel>
            {list.models.map((id) => {
              const configured = models.find((m) => m.modelId === id)
              const selected = configured?.id === activeModelId
              return (
                <DropdownMenuItem
                  key={id}
                  onSelect={() => {
                    if (configured) activateModel(configured.id)
                    else {
                      const created = addModel({
                        name: id,
                        modelId: id,
                        baseUrl: '',
                        apiKey: '',
                        useFullUrl: false,
                      })
                      activateModel(created.id)
                    }
                  }}
                  className="gap-2.5"
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center">
                    {selected && <CheckIcon className="size-3.5" strokeWidth={2.5} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{id}</span>
                  {selected && (
                    <span className="text-muted-foreground text-meta">当前</span>
                  )}
                </DropdownMenuItem>
              )
            })}
          </>
        )}

        {list.status === 'loading' && (
          <div className="text-muted-foreground flex items-center gap-2 px-2 py-2 text-meta">
            <RefreshCwIcon className="size-3.5 animate-spin" strokeWidth={1.75} />
            正在读取模型列表…
          </div>
        )}

        {list.status === 'error' && (
          <div className="px-2 py-2">
            <div className="text-destructive flex items-center gap-2 text-meta">
              <AlertCircleIcon className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span className="min-w-0">{list.message}</span>
            </div>
            <button
              type="button"
              onClick={load}
              className="text-muted-foreground hover:text-foreground mt-1 text-meta underline-offset-2 hover:underline"
            >
              重试
            </button>
          </div>
        )}

        {/* 自定义模型：自己在设置里配置的（有 baseUrl / apiKey 才算） */}
        {customModels.length > 0 && (
          <>
            {list.status === 'ready' && list.models.length > 0 && (
              <DropdownMenuSeparator />
            )}
            <GroupLabel>自定义模型</GroupLabel>
            {customModels.map((model) => {
              const selected = model.id === activeModelId
              return (
                <DropdownMenuItem
                  key={model.id}
                  onSelect={() => activateModel(model.id)}
                  className="gap-2.5"
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center">
                    {selected && <CheckIcon className="size-3.5" strokeWidth={2.5} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{model.name}</span>
                  {selected && (
                    <span className="text-muted-foreground text-meta">当前</span>
                  )}
                </DropdownMenuItem>
              )
            })}
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => window.dispatchEvent(new Event(OPEN_MODEL_MANAGER_EVENT))}
          className="gap-2.5"
        >
          <PlusIcon className="size-3.5 shrink-0" strokeWidth={2} />
          <span className="truncate">管理模型…</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 分组标签：浅灰小字，把下拉里的模型按来源分组 */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground/80 px-2 py-1 text-meta">{children}</div>
  )
}
