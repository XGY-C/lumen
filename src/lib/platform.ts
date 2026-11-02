const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent

export const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(ua)

/** 快捷键前缀：mac 用 ⌘，其它平台用 Ctrl */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl'
