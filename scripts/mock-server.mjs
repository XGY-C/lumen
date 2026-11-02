/**
 * 本地 mock 后端，用于在没有 Spring Boot 时演示流式效果。
 *
 *   node scripts/mock-server.mjs   # 监听 8099，配合 API_TARGET 指向它
 *
 * 刻意在帧中间断开写入（splitFrame），用来验证前端 SSE 解析器能跨 chunk 拼回事件。
 *
 * M9 起支持故障注入：POST /__mode {"mode":"error"} 切换下一批请求的行为。
 * 会在界面上发生的坏事（超时、500、流中断、超长回答）都得能被真的触发，
 * 否则「错误态」永远只是一段没被人看过的 JSX。
 *
 *   normal | slow | error | abort | long | empty
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_PORT ?? 8099)

const SAMPLE = `别急着上组件库。

先把「会话」和「渲染」拆成两层看：会话层管消息序列、分支、中断；渲染层管段落、代码块、引用。
两层的更新频率不一样，混在一个 state 里，流式一快就会整棵树重渲染。

判断标准只有一条：用户上滑看历史时，新 token 到达不能把视口拽回去。`

const LONG = Array.from(
  { length: 7 },
  (_, index) => `## 第 ${index + 1} 节 · 为什么这里要单独讨论

这一段是为了让回答长度超过两屏。真实场景里模型经常一口气输出几千字，
而「长回答」暴露的是三个完全不同的问题：滚动锚点、回到最新按钮的出现时机、
以及输入框在内容很长时是否还浮在正确的位置上。

| 位置 | 期望行为 | 备注 |
| --- | --- | --- |
| 用户停在底部 | 跟随新内容 | 不要有跳动 |
| 用户上滑 | 视口不动 | 显示回到最新 |

1. 滚动容器只有一个，不要把 body 也变成滚动上下文
2. \`sticky\` 的输入区不能有 \`transform\`，否则在某些浏览器里会失效
3. 长文本里的代码块要保持自己的横向滚动，不要传染给外层

\`\`\`ts
function pin(element: HTMLElement, threshold = 48) {
  const near = element.scrollHeight - element.scrollTop - element.clientHeight < threshold
  if (near) element.scrollTop = element.scrollHeight
}
\`\`\`

> 结论：长回答不是排版问题，是滚动所有权的问题。谁拥有滚动，谁负责锚点。`,
).join('\n\n')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const frame = (payload) => `data: ${JSON.stringify(payload)}\n\n`

/** 当前注入的故障模式；由 POST /__mode 改写 */
let MODE = 'normal'

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' }).end()
    return
  }

  // 故障注入开关（不是业务接口，只在本地 mock 里存在）
  if (req.url?.startsWith('/__mode')) {
    let body = ''
    for await (const chunk of req) body += chunk
    try {
      MODE = JSON.parse(body || '{}').mode ?? 'normal'
    } catch {
      MODE = 'normal'
    }
    res
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ mode: MODE }))
    return
  }

  if (!req.url?.startsWith('/api/chat')) {
    res.writeHead(404).end('not found')
    return
  }

  let body = ''
  for await (const chunk of req) body += chunk

  // 500：最常见的真实故障。前端会走 `!response.ok` 分支，把这段文字显示出来。
  if (MODE === 'error') {
    res
      .writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end('upstream unavailable: 连接 127.0.0.1:1235 被拒绝')
    return
  }

  // 慢首 token：用户点完发送后会有几秒钟什么都看不到，专门用来验证等待态
  if (MODE === 'slow') await sleep(4500)

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const reasoning = '用户想要一个能长期演进的对话前端，先确认边界：消息状态归 runtime，视觉归组件。'

  if (MODE !== 'long') {
    for (const char of reasoning) {
      res.write(frame({ type: 'reasoning', delta: char }))
      await sleep(12)
    }
    res.write(frame({ type: 'reasoning', done: true }))
  }

  // 流中断：写到一半直接掐掉连接，且**不发结束标记**。
  // 这是后端崩溃最常见的样子——正常关闭 TCP，但流没有收尾。
  // 前端必须据此判定「中断」，而不是当成「回答就这么短」。
  if (MODE === 'abort') {
    for (const [index, char] of [...'这条回答会在中途被切断'].entries()) {
      res.write(frame({ type: 'text', delta: char }))
      await sleep(30)
      if (index > 6) {
        res.end()
        return
      }
    }
    return
  }

  const text = MODE === 'long' ? LONG : MODE === 'empty' ? '' : SAMPLE

  for (const [index, char] of [...text].entries()) {
    const payload = frame({ type: 'text', delta: char })

    // 长回答不拆帧、不停顿：这一档要测的是「内容很多时怎么滚」，
    // 逐字慢慢吐只会让截图等半分钟，测不到东西。
    if (MODE === 'long') {
      res.write(payload)
      continue
    }

    // 每 7 个字符故意拆帧，模拟网络粘包/半包
    if (index % 7 === 3) {
      const cut = Math.floor(payload.length / 2)
      res.write(payload.slice(0, cut))
      await sleep(8)
      res.write(payload.slice(cut))
    } else {
      res.write(payload)
    }

    await sleep(18)
  }

  res.write('data: [DONE]\n\n')
  res.end()
}).listen(PORT, () => {
  console.log(`mock SSE server → http://localhost:${PORT}/api/chat`)
  console.log('故障注入：POST /__mode {"mode":"slow|error|abort|long|empty|normal"}')
})
