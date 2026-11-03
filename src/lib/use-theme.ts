import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
export type ThemePreference = Theme | 'system'

/** 与 index.html 首帧脚本共用 */
const STORAGE_KEY = 'lumen-theme'

/** 实际渲染用的是浅色还是深色（`system` 时看系统）。 */
export function resolveTheme(pref: ThemePreference): Theme {
  if (pref !== 'system') return pref
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function readPreference(): ThemePreference {
  if (typeof document === 'undefined') return 'system'
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    /* ignore */
  }
  // 没存过 = 跟随系统
  return 'system'
}

/**
 * 主题偏好三态：light / dark / system。
 *
 * `system` 时不把偏好写死进 localStorage，只跟着系统走；用户一旦手动选了
 * light / dark 就固定下来。`resolved` 是实际渲染用的主题（system 时解析系统）。
 */
export function useTheme() {
  const [pref, setPrefState] = useState<ThemePreference>(readPreference)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  const resolved: Theme = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref

  // 把解析结果落到 <html>，并写 localStorage（system 也写，作为「跟随系统」的显式标记）
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolved === 'dark')
    root.style.colorScheme = resolved
    try {
      localStorage.setItem(STORAGE_KEY, pref)
    } catch {
      /* 隐私模式下写入失败，不影响观感 */
    }
  }, [resolved, pref])

  // 跟随系统切换（无论当前偏好是什么都监听，但只有 system 时才真的跟着变）
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const setTheme = useCallback((next: ThemePreference) => setPrefState(next), [])

  const toggle = useCallback(() => {
    setPrefState((current) => {
      const cur = current === 'system' ? (systemDark ? 'dark' : 'light') : current
      return cur === 'dark' ? 'light' : 'dark'
    })
  }, [systemDark])

  return { preference: pref, theme: resolved, setTheme, toggle }
}
