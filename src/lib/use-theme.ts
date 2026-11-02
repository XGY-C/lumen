import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

/** 与 index.html 首帧脚本共用 */
const STORAGE_KEY = 'lumen-theme'

/**
 * 初始值直接从 <html> 的 class 读——那个 class 是首帧前由内联脚本写好的，
 * 所以这里读到的就是用户最终看到的主题，不会出现「先浅后深」的跳变。
 */
function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.style.colorScheme = theme
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* 隐私模式下写入会失败，不影响观感 */
    }
  }, [theme])

  // 用户没手动选过时，跟随系统切换
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => {
      let manual: string | null = null
      try {
        manual = localStorage.getItem(STORAGE_KEY)
      } catch {
        /* ignore */
      }
      if (manual === 'light' || manual === 'dark') return
      setTheme(event.matches ? 'dark' : 'light')
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const toggle = useCallback(
    () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
    [],
  )

  return { theme, toggle }
}
