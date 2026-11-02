import { useSyncExternalStore } from 'react'

import { chatMode } from './config'
import { getActiveModelName, subscribeActiveModel } from './model-adapter'

const noopSubscribe = () => () => {}
const serverSnapshot = () => null

/**
 * 当前实际使用的模型名。
 *
 * 模型名是第一次请求 `/v1/models` 之后才知道的，所以这里用外部 store 订阅，
 * 而不是在渲染时读一个模块变量（那样更新不会触发重渲染）。
 */
export function useActiveModel(): string | null {
  return useSyncExternalStore(
    chatMode === 'model' ? subscribeActiveModel : noopSubscribe,
    chatMode === 'model' ? getActiveModelName : serverSnapshot,
    serverSnapshot,
  )
}
