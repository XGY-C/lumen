# Lumen · AI Chat

基于 assistant-ui 的对话前端。两条链路可切换：Spring Boot（`/api/chat`）或直连本地模型
（OpenAI 兼容 `/v1/chat/completions`）。

## 端口

| 服务 | 端口 |
| --- | --- |
| 前端（Vite） | **5185** |
| Spring Boot 后端 | **8015**（本仓库 `backend/`） |
| 本地模型（OpenAI 兼容） | **1235** |

`/api` 与 `/v1` 都走 Vite 代理，前端始终同源请求，不需要处理 CORS。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 构建 | Vite 8 + React 19 + TypeScript 6 |
| 样式 | Tailwind CSS v4（`@tailwindcss/vite`）+ tw-animate-css |
| 组件 | shadcn/ui（new-york / Radix）+ `radix-ui` |
| 对话 | `@assistant-ui/react` + `@assistant-ui/react-markdown` |
| 运行时 | `useLocalRuntime` + 自定义 `ChatModelAdapter` |
| 图标 | lucide-react |

组件源码位于 `src/components/assistant-ui/`，可直接改。

## 开发

一键启动（前后端一起，Ctrl+C 同时停）：

```bash
npm install
npm start            # Windows 也可以双击 start.cmd；Git Bash 用 ./start.sh
```

它按顺序做五件事：查工具链（node / java）→ 查端口（5185 / 8015 / 1235）→
确认后端 jar（缺了才 build）→ 起 Spring Boot 并**等 8015 真的能连**→ 起 Vite
并等 5185 就绪。两个进程的日志带 `[api]` / `[web]` 前缀，退出时按进程树 kill
（Windows 上 Vite 的 esbuild 和 JVM 的子进程不会被 `kill` 带走，会留下占着端口的孤儿）。

| 参数 | 作用 |
| --- | --- |
| `--rebuild` | 先强制重新打包后端 |
| `--web-only` | 只起前端（后端已单独跑着时用） |
| `--help` | 用法 |

启动器会自动复用已经在 8015 上的 API（重启前端时不用先关后端），
但如果 5185 被占会直接报错并给出 `netstat` / `taskkill` 的具体命令。

分开起也可以：

```bash
npm run dev          # 只起前端 http://localhost:5185

# 只起后端（另开终端）
cd backend
mvn -o -DskipTests package
./run.sh             # 或 PowerShell: .\run.ps1
#   等价于 java -jar target/ai-chat-backend-0.1.0.jar

npm run build
```

> **不要从 Git Bash 直接 `java -jar`。** 本机用户目录是中文（`C:\Users\谢光益`），
> Git Bash 传进 JVM 的 `TEMP` 会按 GBK 解码成 `C:\Users\Ð»¹âÒæ\...`（不存在的路径），
> Spring Boot 建不了 Tomcat 工作目录，启动直接失败。`application.yml` 里的
> `server.tomcat.basedir: ./target/tomcat` 已经绕开 `java.io.tmpdir`，所以
> `npm start` / `run.sh` / `run.ps1` / IDEA 都安全。

> **前端报「连不上服务」= 8015 没起来。** 这条错误来自 `chat-adapter.ts` 的
> fetch 失败，不是模型的问题——模型在 1235 上有没有跑，看
> `curl --noproxy '*' http://127.0.0.1:1235/v1/models`。
> 排查顺序：`netstat -ano | grep -E ":(1235|8015|5185) "` → 缺哪个起哪个。
> 注意 curl 要加 `--noproxy '*'`，这台机器走 `http_proxy=127.0.0.1:60949`，
> 不加的话 localhost 请求会被代理截获并返回一个假的 502。

```bash
# 视觉审查：不需要真后端，用 mock SSE 跑「生成中 / 长回答」这些状态
npm run mock         # 终端 A：mock 服务 8099
npm run dev:mock     # 终端 B：前端 5185，/api 指向 mock
node .tools/shoot.mjs --only composer --stream   # 截图 + 量测
node .tools/contrast.mjs --table                 # 对比度实测
node .tools/a11y.mjs --flow                      # 无障碍 / 播报流程
```

> `npm run dev:mock` 读的是 `.env.mock.local`（已被 git 忽略）。
> 直接 `API_TARGET=... npm run dev` **不生效**：`loadEnv` 先读 `.env.local`
> 再读 process.env，文件值优先。要换代理目标就用 mode。

## 两种模式

`.env.local` 里 `VITE_CHAT_MODE` 决定走哪条链路：

| 值 | 请求路径 | 说明 |
| --- | --- | --- |
| `backend` | `POST /api/chat` → 8015 | 生产形态，走 Spring Boot |
| `model` | `POST /v1/chat/completions` → 1235 | 本地演示，直连模型 |

`model` 模式下模型名留空会自动从 `/v1/models` 挑第一个非 embedding 模型。

**只想聊天、不想起 Java**：把 `.env.local` 改成 `VITE_CHAT_MODE=model`，
前端直接经 `/v1` 代理打 LM Studio（1235），和 8015 完全无关。改完要重启 dev server。
代价是拿不到 Spring Boot 那层（后续要加会话落库、限流、鉴权都得回到 `backend` 模式）。

## 后端（backend/）

极简 Spring Boot 3.5 + Java 21，只做一件事：把前端请求转给本地模型，再把
`reasoning_content` / `content` 两种增量包成前端认识的 SSE 帧。

```
backend/
├── src/main/resources/application.yml   # server.port 8015，模型地址/模型名
└── src/main/java/com/aichat/
    ├── AiChatApplication.java
    └── chat/
        ├── ChatController.java          # POST /api/chat → SseEmitter
        ├── ModelClient.java             # JDK HttpClient 读 /v1/chat/completions 流
        └── ChatRequest.java
```

改模型只要动 `application.yml`：

```yaml
server:
  port: 8015
app:
  model:
    base-url: http://localhost:1235/v1
    name: qwen3-1.7b
    temperature: 0.7
```

## Spring Boot 契约

```
POST /api/chat
{ "messages": [{ "role": "user", "content": "..." }] }

→ text/event-stream
data: {"type":"reasoning","delta":"思"}
data: {"type":"text","delta":"你"}
data: [DONE]
```

已兼容的帧格式（无需改前端）：

```jsonc
{"type":"text","delta":"你"}                  // 自定义增量
{"type":"reasoning","delta":"思考中"}          // 思考通道，渲染为可折叠 reasoning
{"choices":[{"delta":{"content":"你"}}]}      // OpenAI 兼容
{"content":"整段文本"}                         // 一次性
data: 纯文本                                   // 裸文本
```

也支持 `event: reasoning` 命名事件；返回普通 JSON 时自动降级为一次性输出。
接本地模型时建议在 Spring Boot 里透传上游的 `reasoning_content`，前端会拆成思考区。

## 界面结构

```
src/
├── App.tsx                      外壳：侧栏（可收起 / 移动端抽屉）+ 顶栏 + 会话
├── components/chat/
│   ├── thread.tsx               滚动区、贴底输入区、Esc 停止、回到最新
│   ├── messages.tsx             消息渲染（思考折叠 / 流式光标 / 错误重试 / 分支）
│   ├── composer.tsx             输入框：自动增高、空输入禁用、发送⇄停止同位替换
│   ├── sidebar.tsx              品牌、新对话、会话列表、快捷提问、状态
│   ├── session-list.tsx         会话列表：日期分组、就地重命名、删除确认
│   ├── command-palette.tsx      ⌘K 命令面板：搜索会话 + 新建 / 导出 / 切主题
│   └── welcome.tsx              空状态：四个引导卡片
├── components/assistant-ui/     从 registry 拉的源码（Markdown、reasoning、工具卡片…）
├── lib/session-store.ts         会话元数据 + 消息仓库（localStorage）+ 订阅
├── lib/history-adapter.ts       LocalRuntime 的 history 适配器
├── lib/search.ts                会话检索（标题 + 正文，带命中片段与高亮区间）
├── lib/export-session.ts        会话导出 Markdown（思考过程折叠）
└── index.css                    设计令牌 + 基础层 + 自定义工具类
```

## 多会话与持久化

消息存在浏览器 localStorage，刷新、关标签、重启浏览器都还在。

| key | 内容 |
| --- | --- |
| `lumen.sessions.v1` | 会话列表（id / 标题 / 时间）+ 当前选中 |
| `lumen.thread.v1:<id>` | 单个会话的消息仓库（`{ headId, messages[] }`，带 `parentId` 链） |

会话标题首次对话后自动取首句前 30 字；手动重命名后不再被覆盖。
「新对话」不会删除旧会话，空壳会话在下次新建时自动清理。

实现要点：`LocalRuntime` 的 `scopeId` 必须等于会话 id。切换会话时 runtime 发现
scopeId 变化会清空当前仓库并重新 `load()`，所以切会话不需要重建 runtime，
也不会把两条会话的消息搅在一起。

写时机：用户消息在发送时写入，助手消息在本次生成结束时写入。**中途刷新会丢掉
正在生成的那半段回答**（这是 `LocalRuntime` 的写入时机，不是前端漏写）。

设计约定，改样式前先看这几条：

| 项 | 规则 |
| --- | --- |
| 令牌 | 颜色/圆角/字体只在 `src/index.css` 定义，组件里不写死色值 |
| 字号 | 正文 15px，UI 标签 12.5–13.5px，meta 10.5–11px，代码 12.5px |
| 节奏 | 消息之间 28px；块内 8–12px |
| 焦点 | 用 `.focus-ring`（outline 环），不使用 box-shadow ring |
| 动效 | 统一 `--ease-out-quint` / `--ease-spring`；尊重 `prefers-reduced-motion` |
| 反馈 | 可点元素必须有 hover / active / focus 三态；破坏性操作要二次确认 |

## 前端改动点

- `src/lib/chat-adapter.ts`：Spring Boot 请求体、鉴权头、错误文案
- `src/lib/model-adapter.ts`：本地模型请求参数（temperature、max_tokens 等）
- `src/lib/normalize-event.ts`：SSE 帧 → `{ text | reasoning | done }` 的映射
- `src/lib/sse.ts`：SSE 分帧（已处理跨 chunk 切断、`\r\n`、多行 data）
- `src/components/chat/*`：外壳、会话列表、空状态、快捷提问
- `src/index.css`：设计 token（颜色 / 圆角 / 字体）

`src/components/assistant-ui/elements/` 下还有 `thread.aui.tsx`、`tool-fallback.aui.tsx` 等
registry 原始组件，当前没有被引用（本项目用 `components/chat/` 里的定制版替代），
保留是为了以后要接工具调用/附件时可以直接取用。

## 检索与导出

`⌘K` / `Ctrl K` 呼出命令面板。侧栏和顶栏都有入口，键盘与鼠标都能用。

| 按键 | 行为 |
| --- | --- |
| `⌘K` / `Ctrl K` | 打开 / 关闭命令面板 |
| `↑` `↓` | 在结果间移动 |
| `↵` | 打开选中的会话 / 执行操作 |
| `Esc` | 关闭面板（生成中按 Esc 仍是停止生成，有弹层时让位给弹层） |

面板里能做的事：搜会话（标题优先，正文其次，命中处给一行上下文并高亮）、
新建对话、导出当前对话、切换深浅色。

**搜索**只做子串匹配 + 加权。会话量级在几十到几百时，模糊匹配对中文反而更难命中；
用户通常是记得某个词，直接找更准。命中用户自己说的话比命中模型回答权重更高。
索引按会话缓存，用 `updatedAt` 做版本号，只有新消息的会话会重建。

**导出**为 Markdown：标题、时间、逐条消息，思考过程用 `<details>` 折叠——
它往往比正文长几倍，摊开会把回答淹掉。代码块里的连续空行原样保留，不做压缩。

## 首屏拆包

`vite build` 后不是一个大文件，首屏只拉这 6 个：

| 产物 | gzip |
| --- | --- |
| `assistant-*.js`（assistant-ui 运行时） | 152 kB |
| `react-*.js`（react / react-dom / scheduler） | 68 kB |
| `ui-*.js`（Radix、floating-ui、图标、tailwind-merge） | 39 kB |
| `index-*.js`（业务代码） | 18 kB |
| `vendor-*.js` | 4 kB |
| `index-*.css` | 17 kB |

合计约 **282 kB gzip**（拆包前是单块 328 kB）。Markdown 渲染链路
（`react-markdown` + `remark-gfm` + micromark 全家桶，157 kB / 47 kB gzip）
改成了动态 import，空对话首屏根本不会下载它。

三个要点，改配置时别踩回去：

1. **`includeDependenciesRecursively: false`**。默认开启时，分组会把它命中模块的
   依赖一并吞下——`markdown` 组会把 `react-markdown` 依赖的 `react` 也抓走，
   入口随后不得不静态 import 这个 chunk，懒加载当场失效（首屏反而更大）。
2. **`@assistant-ui/react-markdown` 归到 `markdown` 组**。它虽然属于
   `@assistant-ui/*` 命名空间，但只有懒加载的渲染器用得到；留在 `assistant` 组
   会把整条 markdown 链路拖回首屏。
3. **`dot.css`（流式光标）跟着 `.impl` 一起懒加载**。它如果在「首屏 wrapper」里
   import，Vite 会把 CSS 归属的 JS chunk 一起 preload 进 `index.html`。

预取时机（`src/main.tsx`）：

- 有历史会话 → 先 `await` 渲染器（最多 800ms）再挂载，避免「先纯文本、再格式化」的重排闪烁；
- 空对话 → 先渲染，首屏绘制后的空闲时段再预取，等第一条回答开始输出时已就绪；
- 拿不到就降级成纯文本（`whitespace-pre-wrap`，行高与 `.aui-md` 对齐），
  错误边界兜住 chunk 加载失败，不会白屏。

## 已知限制

- 会话只存在本机 localStorage，换浏览器 / 清缓存即消失；要多端同步得换成后端存储
  （实现一个 `history` 适配器指向接口即可，UI 不用动）
- 存储没有总量上限控制，超长对话可能触发浏览器的配额上限（写入失败时静默降级，
  对话本身不受影响，只是不再落盘）
- 首屏 282 kB gzip 里 assistant-ui 运行时占 152 kB，这部分是库自身的体积，
  要用就得付；再往下抠只能换更轻的对话运行时

