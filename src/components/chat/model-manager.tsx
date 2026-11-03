import {
  AlertCircleIcon,
  BotIcon,
  CheckIcon,
  CheckCircle2Icon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  MODEL_PRESETS,
  getPreset,
  testConnection,
  type TestConnectionResult,
} from '@/lib/model-presets'
import {
  activateModel,
  addModel,
  removeModel,
  updateModel,
  useModelSettings,
  type CustomModel,
} from '@/lib/model-settings'
import { cn } from '@/lib/utils'

/**
 * 模型管理（对齐 WorkBuddy 的「供应商 + 三件套」模型）。
 *
 * 上半部分：已配置的模型列表（激活 / 编辑 / 删除）。
 * 下半部分：添加模型表单，支持「预设供应商」或「自定义」两种入口，
 * 每条 = 展示名 + 模型 ID + 服务地址 + API Key（可选）+ 完整 URL 开关，
 * 保存前可「测试连接」。
 */

export function ModelManager() {
  const { models, activeModelId } = useModelSettings()
  const [editing, setEditing] = useState<CustomModel | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      {/* 已配置模型列表 */}
      <div className="flex flex-col gap-2">
        <div className="text-ui text-muted-foreground flex items-center justify-between gap-2">
          <span className="shrink-0">已配置模型</span>
          {models.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setEditing(null)
                setAdding(true)
              }}
            >
              <PlusIcon className="size-3" strokeWidth={2} />
              添加
            </Button>
          )}
        </div>

        {models.length === 0 ? (
          <div className="border-border text-muted-foreground rounded-lg border border-dashed p-4 text-center text-meta">
            还没有配置模型。点击下方「添加模型」接入本地或云端服务。
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {models.map((model) => {
              const active = model.id === activeModelId
              return (
                <li
                  key={model.id}
                  className={cn(
                    'border-border flex items-center gap-2 rounded-lg border p-2.5 transition-colors',
                    active && 'border-brand/50 bg-accent',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => activateModel(model.id)}
                    aria-label={active ? '当前使用' : '设为当前'}
                    title={active ? '当前使用' : '点击设为当前'}
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-full border',
                      active ? 'border-brand bg-brand text-white' : 'border-border',
                    )}
                  >
                    {active && <CheckIcon className="size-2.5" strokeWidth={3} />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ui font-medium">{model.name}</p>
                    <p className="text-muted-foreground truncate text-meta">
                      {model.modelId}
                      {model.baseUrl ? ` · ${model.baseUrl}` : ''}
                    </p>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="编辑"
                    title="编辑"
                    onClick={() => {
                      setEditing(model)
                      setAdding(false)
                    }}
                  >
                    <PencilIcon className="size-3" strokeWidth={1.75} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="删除"
                    title="删除"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeModel(model.id)}
                  >
                    <Trash2Icon className="size-3" strokeWidth={1.75} />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* 添加 / 编辑模型表单 */}
      {(adding || editing) && (
        <ModelForm
          initial={editing}
          onDone={() => {
            setAdding(false)
            setEditing(null)
          }}
        />
      )}

      {!adding && !editing && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setAdding(true)}
        >
          <PlusIcon className="size-3.5" strokeWidth={2} />
          添加模型
        </Button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 添加 / 编辑表单                                                       */
/* ------------------------------------------------------------------ */

function ModelForm({
  initial,
  onDone,
}: {
  initial: CustomModel | null
  onDone: () => void
}) {
  const [presetId, setPresetId] = useState<string>('custom')
  const [name, setName] = useState(initial?.name ?? '')
  const [modelId, setModelId] = useState(initial?.modelId ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '')
  const [useFullUrl, setUseFullUrl] = useState(initial?.useFullUrl ?? false)
  const [test, setTest] = useState<TestConnectionResult | null>(null)
  const [testing, setTesting] = useState(false)

  const applyPreset = (id: string) => {
    setPresetId(id)
    const preset = getPreset(id)
    if (preset) {
      setBaseUrl(preset.baseUrl)
      setUseFullUrl(preset.useFullUrl)
    }
  }

  const runTest = async () => {
    setTesting(true)
    setTest(null)
    const result = await testConnection({ baseUrl, apiKey, modelId, useFullUrl })
    setTest(result)
    setTesting(false)
  }

  const save = () => {
    const payload = {
      name: name.trim() || modelId.trim(),
      modelId: modelId.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      useFullUrl,
    }
    if (!payload.modelId) return

    if (initial) updateModel(initial.id, payload)
    else addModel(payload)
    onDone()
  }

  return (
    <div className="border-border flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <span className="text-ui font-medium">
          {initial ? '编辑模型' : '添加模型'}
        </span>
        <button
          type="button"
          onClick={onDone}
          className="text-muted-foreground hover:text-foreground text-meta underline-offset-2 hover:underline"
        >
          取消
        </button>
      </div>

      {/* 预设供应商（仅添加时可选） */}
      {!initial && (
        <div className="flex flex-col gap-2">
          <FieldLabel>预设供应商</FieldLabel>
          <Select value={presetId} onValueChange={applyPreset}>
            <SelectTrigger className="w-full">
              <span>{getPreset(presetId)?.label ?? '自定义'}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="custom">自定义</SelectItem>
              {MODEL_PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <FieldLabel>展示名称</FieldLabel>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="可选，默认用模型 ID"
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div className="flex flex-col gap-2">
        <FieldLabel>模型 ID</FieldLabel>
        <Input
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder={getPreset(presetId)?.modelIdPlaceholder ?? '如 qwen3-1.7b'}
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div className="flex flex-col gap-2">
        <FieldLabel>服务地址（Base URL）</FieldLabel>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="http://localhost:1235/v1"
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div className="flex flex-col gap-2">
        <FieldLabel>API Key（可选）</FieldLabel>
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="本地模型可留空"
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <label className="flex items-center gap-2 text-ui">
        <input
          type="checkbox"
          checked={useFullUrl}
          onChange={(e) => setUseFullUrl(e.target.checked)}
          className="size-3.5 accent-[var(--brand)]"
        />
        <span className="text-muted-foreground">
          使用完整 URL（不再自动拼接 /chat/completions）
        </span>
      </label>

      {/* 测试连接结果 */}
      {test && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-md px-2 py-1.5 text-meta',
            test.ok
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-destructive/10 text-destructive',
          )}
        >
          {test.ok ? (
            <CheckCircle2Icon className="size-3.5 shrink-0" strokeWidth={2} />
          ) : (
            <AlertCircleIcon className="size-3.5 shrink-0" strokeWidth={2} />
          )}
          <span className="min-w-0 break-all">
            {test.ok ? `连接成功：${test.modelId}` : test.message}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={runTest}
          disabled={testing || !modelId.trim() || !baseUrl.trim()}
        >
          {testing ? (
            <Loader2Icon className="size-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <BotIcon className="size-3.5" strokeWidth={1.75} />
          )}
          测试连接
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={!modelId.trim()}
          className="ml-auto"
        >
          保存
        </Button>
      </div>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-ui text-muted-foreground">{children}</span>
}

// 保持 LucideIcon 导入被使用（类型兜底）
export type { LucideIcon }
