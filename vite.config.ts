import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Spring Boot 后端 / 本地模型（OpenAI 兼容）的 origin
  const apiTarget = env.API_TARGET || 'http://localhost:8015'
  const modelOrigin = env.MODEL_ORIGIN || 'http://localhost:1235'
  // ⚠️ shell 里 `API_TARGET=... npx vite` 不生效：loadEnv 读过 .env.local 之后
  // 才轮到 process.env，文件值优先。要换目标就加一个 mode（见 .env.mock.local）。
  if (process.env.SHOOT_DEBUG) console.log('[vite] apiTarget =', apiTarget)

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5185,
      strictPort: true,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/v1': { target: modelOrigin, changeOrigin: true },
      },
    },
    preview: {
      port: 5185,
      strictPort: true,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/v1': { target: modelOrigin, changeOrigin: true },
      },
    },
    build: {
      // assistant-ui 运行时本身就有 520 kB（绝大多数是它的 store / remote 实现），
      // 已经按包拆过了，超过默认 500 kB 属预期，不必再报警。
      chunkSizeWarningLimit: 600,
      // 首屏拆包：见下方 groups 注释
      rolldownOptions: {
        output: {
          codeSplitting: {
            // 关掉「递归捕获依赖」：默认开启时，分组会把它命中模块的全部依赖一起吞下去。
            // 那样 markdown 组会把 react-markdown 依赖的 react 也抓进自己的 chunk，
            // 入口随后不得不静态 import 这个 chunk，懒加载就被彻底破坏（首屏反而更大）。
            // 关掉之后每个模块只看自己的 test，归属完全可预测。
            includeDependenciesRecursively: false,
            groups: [
              // Markdown 渲染链路只被懒加载的 markdown-text.impl 引用。
              // 必须排在所有「会被首屏静态 import」的分组之前，否则这些模块会被合并进
              // assistant / vendor，反过来变成首屏同步加载。
              // ⚠️ @assistant-ui/react-markdown 也在这一组：它本身属于 assistant 的
              // 命名空间，但只有懒加载的渲染器才用得到，留在 assistant 组会把它拖回首屏。
              {
                name: 'markdown',
                priority: 40,
                test: /node_modules[\\/](@assistant-ui[\\/]react-markdown|react-markdown|remark-[^\\/]+|micromark[^\\/]*|mdast-[^\\/]+|hast-[^\\/]+|unist-[^\\/]+|vfile[^\\/]*|unified|bail|trough|devlop|property-information|ccount|character-entities[^\\/]*|decode-named-character-reference|zwitch|longest-streak|markdown-table|escape-string-regexp|is-plain-obj|trim-lines|space-separated-tokens|comma-separated-tokens|html-url-attributes|style-to-object|style-to-js|inline-style-parser|is-decimal|is-hexadecimal|is-alphanumerical|is-alphabetical)[\\/]/,
              },
              // React 运行时单独一块：它的 hash 只在升级 React 时变化
              {
                name: 'react',
                priority: 30,
                test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              },
              // 界面基座（Radix / 浮层 / 图标 / class 合并）
              {
                name: 'ui',
                priority: 20,
                test: /node_modules[\\/](radix-ui|@radix-ui[\\/][^\\/]+|@floating-ui[\\/][^\\/]+|lucide-react|class-variance-authority|clsx|tailwind-merge|react-remove-scroll[^\\/]*|react-style-singleton|aria-hidden|use-callback-ref|use-sidecar|get-nonce|detect-node-es)[\\/]/,
              },
              // assistant-ui 运行时（store / stream / cloud）
              {
                name: 'assistant',
                priority: 10,
                test: /node_modules[\\/](@assistant-ui[\\/][^\\/]+|assistant-stream|assistant-cloud|zustand|@assistant-ui[\\/]tap)[\\/]/,
              },
              // 兜底：其余三方依赖合并成一块，避免碎成很多小文件
              { name: 'vendor', priority: 0, test: /node_modules[\\/]/, minSize: 4096 },
            ],
          },
        },
      },
    },
  }
})
