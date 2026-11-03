/**
 * API Key 的轻量混淆（obfuscation，非加密）。
 *
 * 目的：避免 Key 以明文直接躺在 localStorage 里被人一眼看到 / 被简单 grep 抓走。
 * 纯前端没有可安全保管的密钥，任何「真加密」的密钥也得存在前端，等于没加密，
 * 所以这里只做「防君子不防小人」的混淆。
 *
 * 做法：用一个「站点 origin + 固定 salt」派生的同步散列作为 XOR key，
 * 对 Key 逐字节混淆后转 base64。同源同机可还原，跨机器/换浏览器则还原失败。
 *
 * 全程同步（不依赖 async 的 crypto.subtle），这样 store 的读写仍是同步的，
 * 不会引入异步竞态。安全等级：混淆级，非密码学加密。
 */

const SALT = 'lumen.api-key.v1'

/** 同步散列：把字符串转成固定 32 字节的伪随机字节流（FNV-1a + 简单扩散） */
function hashToBytes(input: string): Uint8Array {
  const out = new Uint8Array(32)
  const data = new TextEncoder().encode(input)

  // FNV-1a 32-bit 播种
  let h = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]
    h = Math.imul(h, 0x01000193)
  }

  // 用 h 扩散出 32 字节
  for (let i = 0; i < out.length; i++) {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
    h ^= h >>> 12
    out[i] = (h >>> 24) & 0xff
    h = Math.imul(h, 0x01000193)
  }
  return out
}

function deriveKey(): Uint8Array {
  // 用当前站点 origin 做材料，同源稳定、跨源失效
  const origin = typeof location !== 'undefined' ? location.origin : 'local'
  return hashToBytes(`${origin}:${SALT}`)
}

/** 混淆：明文 Key → 可存入 localStorage 的字符串。空串原样返回。 */
export function obfuscateApiKey(plain: string): string {
  if (!plain) return ''
  const key = deriveKey()
  const data = new TextEncoder().encode(plain)
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ^ key[i % key.length]
  }
  // 转 base64，避免二进制字符直接进 JSON
  let binary = ''
  for (let i = 0; i < out.length; i++) {
    binary += String.fromCharCode(out[i])
  }
  return btoa(binary)
}

/** 反混淆：存储字符串 → 明文 Key。空串原样返回；还原失败返回原值（视为明文）。 */
export function deobfuscateApiKey(encoded: string): string {
  if (!encoded) return ''
  const key = deriveKey()
  try {
    const binary = atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i) ^ key[i % key.length]
    }
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return decoded
  } catch {
    // atob 失败（非 base64）或还原结果不是合法 UTF-8 → 说明本来就是明文，
    // 直接返回原值，兼容混淆功能上线前存的明文 Key。
    return encoded
  }
}
