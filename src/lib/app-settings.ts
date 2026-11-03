import { useSyncExternalStore } from 'react'

import { getModels } from './model-settings'

/**
 * 应用级设置（模型配置之外的部分）。
 *
 * 模型配置已收敛到 model-settings.ts（多条自定义模型 + 激活项），
 * 这里只保留「导出 / 导入」能力，把模型 + 主题等所有可配置项打包。
 *
 * 保留一个空设置对象占位，方便日后扩展其它全局配置项。
 */

const STORAGE_KEY = 'lumen.app-settings'

export type AppSettings = Record<string, never>

const DEFAULTS: AppSettings = {}

function readStored(): AppSettings {
  return { ...DEFAULTS }
}

let cache: AppSettings = readStored()
const listeners = new Set<() => void>()

function commit(next: AppSettings) {
  cache = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* 隐私模式 / 配额满：不影响使用 */
  }
  for (const listener of listeners) listener()
}

export function getAppSettings(): AppSettings {
  return cache
}

export function subscribeAppSettings(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAppSettings(): AppSettings {
  return useSyncExternalStore(subscribeAppSettings, getAppSettings, getAppSettings)
}

/* ------------------------------------------------------------------ */
/* 导出 / 导入                                                          */
/* ------------------------------------------------------------------ */

/** 把当前所有可配置项打包成一个 JSON 字符串，供用户下载 / 备份。 */
export function exportSettings(): string {
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    // API Key 敏感：导出时剔除，避免备份文件明文泄露；导入后需重新填 Key。
    models: getModels().map((m) => ({ ...m, apiKey: '' })),
    activeModelId: (() => {
      try {
        return localStorage.getItem('lumen.models.v1')
          ? JSON.parse(localStorage.getItem('lumen.models.v1')!).activeModelId ?? null
          : null
      } catch {
        return null
      }
    })(),
    theme: (() => {
      try {
        return localStorage.getItem('lumen-theme') ?? 'system'
      } catch {
        return 'system'
      }
    })(),
  }
  return JSON.stringify(payload, null, 2)
}

/**
 * 从导出的 JSON 字符串恢复设置。返回是否成功。
 * 只接受我们认识的字段，未知字段忽略，避免把脏数据写进去。
 *
 * 只做写入，不主动刷新：模型 / 主题的 store 各自缓存了内存副本，
 * 调用方在成功后应 `location.reload()` 让首帧脚本与各 store 重新读 localStorage。
 */
export function importSettings(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>

    // 兼容 v1（modelName 字符串）与 v2（models 数组）两种备份
    if (Array.isArray(parsed.models)) {
      try {
        const state = {
          models: parsed.models,
          activeModelId:
            typeof parsed.activeModelId === 'string' ? parsed.activeModelId : null,
        }
        localStorage.setItem('lumen.models.v1', JSON.stringify(state))
      } catch {
        /* ignore */
      }
    } else if (typeof parsed.modelName === 'string' && parsed.modelName) {
      // 旧版单条模型名 → 迁移为一条模型
      try {
        const model = {
          id: crypto.randomUUID(),
          name: parsed.modelName,
          modelId: parsed.modelName,
          baseUrl: '',
          apiKey: '',
          useFullUrl: false,
        }
        localStorage.setItem(
          'lumen.models.v1',
          JSON.stringify({ models: [model], activeModelId: model.id }),
        )
      } catch {
        /* ignore */
      }
    }

    if (
      parsed.theme === 'light' ||
      parsed.theme === 'dark' ||
      parsed.theme === 'system'
    ) {
      try {
        localStorage.setItem('lumen-theme', parsed.theme)
      } catch {
        /* ignore */
      }
    }

    commit(cache)
    return true
  } catch {
    return false
  }
}
