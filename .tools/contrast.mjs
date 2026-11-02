#!/usr/bin/env node
/**
 * WCAG 对比度实测（零依赖）。
 *
 * 为什么需要它：`text-muted-foreground/55` 这种写法看起来「淡一点」，
 * 实际在浅色底上只有 2.9:1，11px 的字等于读不出来。眼睛看不出来，数字能。
 *
 * 用法：
 *   node .tools/contrast.mjs "oklch(0.53 0.011 270)/0.85" "oklch(0.995 0.0015 100)"
 *   node .tools/contrast.mjs --table          # 打印 DESIGN.md 里登记的组合
 */

/* ---------------- oklch → sRGB ---------------- */

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function oklchToRgb(lightness, chroma, hue) {
  const h = (hue * Math.PI) / 180
  const a = chroma * Math.cos(h)
  const b = chroma * Math.sin(h)

  // OKLab → LMS
  const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b
  const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b
  const s_ = lightness - 0.0894841775 * a - 1.291485548 * b

  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3

  // LMS → linear sRGB
  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s

  return [lr, lg, lb].map((v) => Math.min(1, Math.max(0, toSrgb(v))))
}

/** 解析 "oklch(0.53 0.011 270)" 或带 "/0.85" 透明度的写法，也接受 #rrggbb */
function parseColor(input) {
  const value = input.trim()
  // 「oklch(…) / 0.85」这种带透明度的写法：透明度在右括号之后
  const alphaSplit = value.match(/^(.*\))\s*\/\s*([\d.]+)$/)
  let alpha = 1
  let body = value
  if (alphaSplit) {
    body = alphaSplit[1]
    alpha = Number(alphaSplit[2])
  }

  const oklch = body.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i)
  if (oklch) {
    return { rgb: oklchToRgb(+oklch[1], +oklch[2], +oklch[3]), alpha }
  }

  const hex = body.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return {
      rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255),
      alpha,
    }
  }

  throw new Error(`无法解析颜色：${input}`)
}

/** 半透明前景叠在背景上的实际颜色 */
function composite(fg, bg) {
  if (fg.alpha >= 1) return fg.rgb
  return fg.rgb.map((c, i) => c * fg.alpha + bg.rgb[i] * (1 - fg.alpha))
}

const luminance = (rgb) => {
  const [r, g, b] = rgb.map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(fgInput, bgInput) {
  const fg = parseColor(fgInput)
  const bg = parseColor(bgInput)
  const fgRgb = composite(fg, bg)
  const a = luminance(fgRgb)
  const b = luminance(bg.rgb)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

/* ---------------- 登记表 ---------------- */

// 与 index.css 的 token 保持一致；改 token 时这里要同步
const LIGHT = {
  background: 'oklch(0.995 0.0015 100)',
  card: 'oklch(1 0 0)',
  foreground: 'oklch(0.225 0.012 270)',
  mutedForeground: 'oklch(0.53 0.011 270)',
  sidebar: 'oklch(0.976 0.0025 100)',
  sidebarForeground: 'oklch(0.245 0.012 270)',
}

const DARK = {
  background: 'oklch(0.172 0.006 270)',
  card: 'oklch(0.205 0.007 270)',
  foreground: 'oklch(0.965 0.002 100)',
  mutedForeground: 'oklch(0.725 0.01 270)',
  sidebar: 'oklch(0.152 0.006 270)',
  sidebarForeground: 'oklch(0.945 0.002 100)',
}

const CASES = [
  ['正文 foreground', 'foreground', 'background', 1, 4.5],
  ['引用 foreground/80', 'foreground', 'background', 0.8, 4.5],
  ['次要文字 muted 100%', 'mutedForeground', 'background', 1, 4.5],
  ['思考内容 muted 100%', 'mutedForeground', 'background', 1, 4.5],
  ['placeholder 100%', 'mutedForeground', 'card', 1, 4.5],
  ['输入框说明 100%', 'mutedForeground', 'card', 1, 4.5],
  ['侧栏分组 100%', 'mutedForeground', 'sidebar', 1, 4.5],
  ['侧栏会话行 80%', 'sidebarForeground', 'sidebar', 0.8, 4.5],
  ['侧栏当前行 100%', 'sidebarForeground', 'sidebar', 1, 4.5],
]

function runTable() {
  for (const [label, fgKey, bgKey, alpha, target] of CASES) {
    const row = []
    for (const [mode, tokens] of [
      ['浅', LIGHT],
      ['深', DARK],
    ]) {
      const ratio = contrast(`${tokens[fgKey]}/${alpha}`, tokens[bgKey])
      const pass = ratio >= target ? '✓' : '✗'
      row.push(`${mode} ${ratio.toFixed(2)} ${pass}`)
    }
    console.log(label.padEnd(24), row.join('   '), ` (≥${target})`)
  }
}

/* ---------------- CLI ---------------- */

const args = process.argv.slice(2)
if (args[0] === '--table' || args.length === 0) {
  runTable()
} else if (args.length >= 2) {
  const ratio = contrast(args[0], args[1])
  console.log(`${ratio.toFixed(2)}:1`, ratio >= 4.5 ? '✓ 正文达标' : ratio >= 3 ? '△ 仅大字号/图标达标' : '✗ 不达标')
} else {
  console.error('用法：node .tools/contrast.mjs "<前景>" "<背景>" | --table')
  process.exit(1)
}
