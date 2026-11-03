export type ChatMode = 'backend' | 'model'

export const chatMode: ChatMode =
  import.meta.env.VITE_CHAT_MODE === 'model' ? 'model' : 'backend'

/** Spring Boot：POST /api/chat（开发期经 Vite 代理到 8015） */
export const CHAT_ENDPOINT = import.meta.env.VITE_CHAT_ENDPOINT ?? '/api/chat'

/** 留空则自动从 /v1/models 里挑第一个非 embedding 模型 */
export const MODEL_NAME: string = import.meta.env.VITE_MODEL_NAME ?? ''
