import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { preloadMarkdown } from './lib/markdown-loader'
import { hasStoredConversation } from './lib/session-store'

const container = document.getElementById('root')!

function boot() {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

/** 首屏绘制完再干活；浏览器不支持 requestIdleCallback 时退化成短延时 */
function scheduleIdle(task: () => void) {
  const idle = (
    window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number
    }
  ).requestIdleCallback

  if (idle) idle(task, { timeout: 2000 })
  else setTimeout(task, 300)
}

if (hasStoredConversation()) {
  // 恢复的历史会话会立刻渲染正文，先把 Markdown 渲染器拿回来再挂载，
  // 免得先闪一帧纯文本再重排成格式化内容。
  // 最多等 800ms：chunk 拿不到就先渲染降级态，它到位后 React 会自动换上。
  const deadline = new Promise<void>((resolve) => setTimeout(resolve, 800))
  void Promise.race([preloadMarkdown(), deadline]).then(boot)
} else {
  // 空对话用不到 Markdown：先让首屏出来，空闲时再预取，
  // 等第一条回答开始流式输出时通常已经就绪。
  boot()
  scheduleIdle(() => void preloadMarkdown())
}
