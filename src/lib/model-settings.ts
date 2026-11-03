import { useSyncExternalStore } from 'react'

import { deobfuscateApiKey, obfuscateApiKey } from './api-key-obfuscation'

/**
 * 自定义模型配置（对齐 WorkBuddy 的「供应商 + 三件套」模型）。
 *
 * 每个模型是一条独立记录，包含：
 * - name      展示名（列表里给用户看，默认取模型 ID）
 * - modelId   实际请求体里带的 model 字段
 * - baseUrl   服务根地址（OpenAI 兼容，如 http://localhost:1235/v1）
 * - apiKey    可选，Bearer 鉴权（本地 Bionic 可留空）
 * - useFullUrl 默认 false：自动拼 /chat/completions；true：按 baseUrl 原样发请求
 *
 * 用户可以维护多条模型，并激活其中一条；对话与「后端代理」两条链路都读激活模型。
 */

export type CustomModel = {
  id: string
  name: string
  modelId: string
  baseUrl: string
  apiKey: string
  useFullUrl: boolean
}

type ModelSettingsState = {
  models: CustomModel[]
  activeModelId: string | null
}

const STORAGE_KEY = 'lumen.models.v1'

/* ------------------------------------------------------------------ */
/* 旧数据迁移：早期只存一个「模型名」字符串，这里平滑升级               */
/* ------------------------------------------------------------------ */

const LEGACY_KEY = 'lumen.model-name'

function migrateLegacy(): ModelSettingsState {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY)?.trim()
    if (legacy) {
      const id = crypto.randomUUID()
      const state: ModelSettingsState = {
        models: [
          {
            id,
            name: legacy,
            modelId: legacy,
            baseUrl: '',
            apiKey: '',
            useFullUrl: false,
          },
        ],
        activeModelId: id,
      }
      localStorage.removeItem(LEGACY_KEY)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      return state
    }
  } catch {
    /* ignore */
  }
  return { models: [], activeModelId: null }
}

/* ------------------------------------------------------------------ */
/* 读取 / 持久化                                                        */
/* ------------------------------------------------------------------ */

function normalizeModel(raw: Partial<CustomModel>): CustomModel | null {
  const modelId = typeof raw.modelId === 'string' ? raw.modelId.trim() : ''
  if (!modelId) return null
  return {
    id:
      typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : modelId,
    modelId,
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '',
    // 存储里是混淆态，这里还原成明文供内存 / 请求使用
    apiKey: typeof raw.apiKey === 'string' ? deobfuscateApiKey(raw.apiKey) : '',
    useFullUrl: raw.useFullUrl === true,
  }
}

function readStored(): ModelSettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return migrateLegacy()

    const parsed = JSON.parse(raw) as {
      models?: unknown[]
      activeModelId?: unknown
    }
    const models = Array.isArray(parsed.models)
      ? (parsed.models
          .map((item) => normalizeModel(item as Partial<CustomModel>))
          .filter((m): m is CustomModel => m !== null))
      : []

    const activeModelId =
      typeof parsed.activeModelId === 'string' &&
      models.some((m) => m.id === parsed.activeModelId)
        ? parsed.activeModelId
        : (models[0]?.id ?? null)

    return { models, activeModelId }
  } catch {
    return migrateLegacy()
  }
}

let cache: ModelSettingsState = readStored()
const listeners = new Set<() => void>()

function commit(next: ModelSettingsState) {
  cache = next
  // 落盘前把明文 apiKey 混淆，避免明文直接躺在 localStorage
  const persisted: ModelSettingsState = {
    models: next.models.map((m) => ({ ...m, apiKey: obfuscateApiKey(m.apiKey) })),
    activeModelId: next.activeModelId,
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
  } catch {
    /* 隐私模式 / 配额满：宁可这次不持久化，也不影响对话本身 */
  }
  for (const listener of listeners) listener()
}

/* ------------------------------------------------------------------ */
/* 对外 API                                                             */
/* ------------------------------------------------------------------ */

export function getModelSettings(): ModelSettingsState {
  return cache
}

export function getModels(): CustomModel[] {
  return cache.models
}

/** 当前激活的模型；没有则返回 null（走自动探测 / 后端默认）。 */
export function getActiveModel(): CustomModel | null {
  return cache.models.find((m) => m.id === cache.activeModelId) ?? null
}

export function addModel(input: Omit<CustomModel, 'id'>): CustomModel {
  const model = normalizeModel(input)!
  commit({
    models: [...cache.models, model],
    activeModelId: cache.activeModelId ?? model.id,
  })
  return model
}

export function updateModel(id: string, patch: Partial<CustomModel>): void {
  const idx = cache.models.findIndex((m) => m.id === id)
  if (idx === -1) return
  const next = cache.models.map((m) => (m.id === id ? { ...m, ...patch } : m))
  const normalized = normalizeModel(next[idx])
  if (!normalized) return
  next[idx] = normalized
  commit({ models: next, activeModelId: cache.activeModelId })
}

export function removeModel(id: string): void {
  const models = cache.models.filter((m) => m.id !== id)
  const activeModelId =
    cache.activeModelId === id ? (models[0]?.id ?? null) : cache.activeModelId
  commit({ models, activeModelId })
}

export function activateModel(id: string): void {
  if (!cache.models.some((m) => m.id === id)) return
  if (cache.activeModelId === id) return
  commit({ models: cache.models, activeModelId: id })
}

export function subscribeModelSettings(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useModelSettings(): ModelSettingsState {
  return useSyncExternalStore(
    subscribeModelSettings,
    getModelSettings,
    getModelSettings,
  )
}

// 其它标签页改动时同步过来
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return
    cache = readStored()
    for (const listener of listeners) listener()
  })
}

/* ------------------------------------------------------------------ */
/* 向后兼容别名：既有代码（chat-adapter 等）仍用 getModelName/setModelName */
/* ------------------------------------------------------------------ */

/** 兼容旧接口：返回激活模型的 modelId（空字符串表示无）。 */
export function getModelName(): string {
  return getActiveModel()?.modelId ?? ''
}

/** 兼容旧接口：把模型 ID 设为当前模型（找不到同名则新增一条）。 */
export function setModelName(name: string) {
  const clean = name.trim()
  if (!clean) {
    if (cache.activeModelId) commit({ models: cache.models, activeModelId: null })
    return
  }
  const existing = cache.models.find((m) => m.modelId === clean)
  if (existing) {
    activateModel(existing.id)
  } else {
    addModel({ name: clean, modelId: clean, baseUrl: '', apiKey: '', useFullUrl: false })
  }
}

/** 兼容旧接口：React hook 版（供旧组件订阅激活模型名）。 */
export function useModelName(): string {
  return useSyncExternalStore(
    subscribeModelSettings,
    () => getActiveModel()?.modelId ?? '',
    () => getActiveModel()?.modelId ?? '',
  )
}
