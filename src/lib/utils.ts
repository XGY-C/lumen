import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge 不认识自定义的字号 / 海拔刻度，会把 `text-ui`、`text-body`
 * 当成「文字颜色」类。结果 `cn('text-ui', 'text-muted-foreground')` 会判定为
 * 同组冲突，把字号整条丢掉。这里把 token 名字注册进去，冲突判定才正确。
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['display', 'title', 'lead', 'body', 'ui', 'meta', 'code'] },
      ],
      shadow: [{ shadow: ['1', '2', '3'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
