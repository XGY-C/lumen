import * as React from "react"
import { cn } from "@/lib/utils"

/** 正六边形孔：外接圆 r8.6，尖顶朝上 */
const HOLE = "24,32.6 16.55,28.3 16.55,19.7 24,15.4 31.45,19.7 31.45,28.3"

/**
 * 六条光缝：每片叶片的边就是六边形的一条边，向外延长、切穿圆周，
 * 于是六片叶片等大且同向旋转。缝宽 1.3，比孔细一个量级。
 */
const GAPS =
  "M23.68 33.16L35.56 40.02L36.21 38.9L24.32 32.04Z" +
  "M15.9 28.3L15.9 42.02L17.2 42.02L17.2 28.3Z" +
  "M16.23 19.14L4.34 26L4.99 27.12L16.88 20.26Z" +
  "M24.32 14.84L12.44 7.98L11.79 9.1L23.68 15.96Z" +
  "M32.1 19.7L32.1 5.98L30.8 5.98L30.8 19.7Z" +
  "M31.77 28.86L43.66 22L43.01 20.88L31.12 27.74Z"

/**
 * Lumen 品牌标：半开的光圈。
 *
 * 外圆 r19，正中是外接圆 r8.6 的正六边形开口，六条 1.3 宽的光缝沿各顶点
 * 切向旋出，把外圈切成六片等大的叶片。缝细、孔大，所以先读到「圆里有个
 * 六边形开口」，靠近才看见叶片 —— 顺序对了，它才是光圈而不是齿轮。
 *
 * 用 currentColor 上色，跟随 `text-brand`；尺寸交给 className。
 */
export function LumenMark({ className, ...props }: React.ComponentProps<"svg">) {
  // useId 带冒号，直接塞进 url(#…) 会被 CSS 解析器截断
  const id = React.useId().replace(/:/g, "")

  return (
    <svg
      viewBox="3 3 42 42"
      fill="none"
      aria-hidden="true"
      data-slot="lumen-mark"
      className={cn("size-6 shrink-0", className)}
      {...props}
    >
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
          <circle cx="24" cy="24" r="19" fill="#fff" />
          <polygon points={HOLE} fill="#000" />
          <path d={GAPS} fill="#000" />
        </mask>
      </defs>
      <circle cx="24" cy="24" r="19" fill="currentColor" mask={`url(#${id})`} />
    </svg>
  )
}
