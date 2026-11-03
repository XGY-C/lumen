import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 拉取本地模型列表（OpenAI 兼容 /v1/models）。
 *
 * 过滤掉 embedding / rerank 类模型，只留下能做对话的。
 * 探测地址固定走前端同源代理的 /v1/models（backend 与 model 两种模式都指向本地
 * 模型服务，默认 1235），不依赖激活模型的 baseUrl——本地服务是环境级的，
 * 跟「当前选中的自定义模型」没有关系。
 * 依赖本地服务（Bionic / LM Studio 等）已启动，失败时给出可重试的错误态，
 * 而不是静默返回空列表——用户至少知道「为什么这里没东西可选」。
 *
 * 返回 `load` 供组件在「打开下拉」这类用户动作里调用（而非 effect 自动触发），
 * 既避免应用一启动就发请求，也不触发「effect 里同步 setState」这类告警。
 */

export type ModelListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; models: string[] }

const EMBEDDING_PATTERN = /embed|rerank|re-?rank/i

export function useModelList(): {
  state: ModelListState
  load: () => void
} {
  const [state, setState] = useState<ModelListState>({ status: 'loading' })
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState({ status: 'loading' })

    // 本地模型服务是环境级的：固定经 vite 代理打 /v1/models（backend / model 同源）。
    fetch('/v1/models', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`读取模型列表失败 ${response.status}`)
        return response.json().catch(() => null)
      })
      .then((payload) => {
        const list: { id?: string }[] = Array.isArray(payload?.data)
          ? payload.data
          : []
        const models = list
          .map((item) => item.id)
          .filter((id): id is string => !!id)
          .filter((id) => !EMBEDDING_PATTERN.test(id))

        if (controller.signal.aborted) return
        setState({ status: 'ready', models })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message =
          error instanceof Error ? error.message : '读取模型列表失败'
        setState({ status: 'error', message })
      })
  }, [])

  // 组件卸载时中止在途请求
  useEffect(() => () => abortRef.current?.abort(), [])

  return { state, load }
}
