/**
 * 无障碍审计：真键盘走一遍，把「Tab 到哪儿了」变成可核对的数据。
 *
 * 和 shoot.mjs 的分工：那个拍照量几何，这个只关心「键盘和读屏能不能用」。
 *
 * 用法（dev server 需另开，建议 --mode mock）：
 *   node .tools/a11y.mjs                     # 默认视口 1440 与 390，走 45 步 Tab
 *   node .tools/a11y.mjs --widths 1440
 *   node .tools/a11y.mjs --steps 60
 *   node .tools/a11y.mjs --motion            # 这次不模拟 reduced-motion，看动画真身
 *
 * 环境变量：CHROME_PATH / BASE_URL / CDP_PORT
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 本机有 http_proxy=127.0.0.1:60949（系统代理）。node 的全局 fetch 会读它，
// 于是 `fetch('http://127.0.0.1:8099/__mode')` 被代理截获 → ECONNREFUSED。
// 必须在任何 fetch 之前把 NO_PROXY 置上，否则 mock 模式切换直接失败。
if (!process.env.NO_PROXY || !process.env.NO_PROXY.includes('127.0.0.1')) {
  process.env.NO_PROXY = [process.env.NO_PROXY, 'localhost', '127.0.0.1']
    .filter(Boolean)
    .join(',')
}

const CHROME =
  process.env.CHROME_PATH ??
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.env.BASE_URL ?? 'http://localhost:5185'
const MOCK_ORIGIN = process.env.MOCK_URL ?? 'http://127.0.0.1:8099'
const CDP_PORT = Number(process.env.CDP_PORT ?? 9334)
const PROFILE = join(tmpdir(), 'lumen-a11y-profile')
const OUT = '.shots'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')
    ? argv[i + 1]
    : fallback
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ */
/* 极简 CDP                                                            */
/* ------------------------------------------------------------------ */

class Cdp {
  #ws
  #id = 0
  #pending = new Map()
  #listeners = new Map()

  static async launch() {
    if (!existsSync(CHROME)) throw new Error(`找不到浏览器：${CHROME}`)
    await rm(PROFILE, { recursive: true, force: true })
    const child = spawn(
      CHROME,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        // 本机系统代理会把 localhost:5185 的请求转发出去，Chrome 里看到的
        // 是「无法访问此网站」的代理错误页。审计必须直连。
        '--no-proxy-server',
        `--user-data-dir=${PROFILE}`,
        `--remote-debugging-port=${CDP_PORT}`,
        'about:blank',
      ],
      { stdio: 'ignore', detached: false },
    )

    let version
    for (let i = 0; i < 100; i++) {
      try {
        version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()
        break
      } catch {
        await sleep(120)
      }
    }
    if (!version) throw new Error('CDP 端口没起来')

    const ws = new WebSocket(version.webSocketDebuggerUrl)
    const cdp = new Cdp()
    cdp.#ws = ws
    cdp.#child = child
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && cdp.#pending.has(msg.id)) {
        const { resolve, reject } = cdp.#pending.get(msg.id)
        cdp.#pending.delete(msg.id)
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
        return
      }
      for (const fn of cdp.#listeners.get(msg.method) ?? []) fn(msg.params)
    })
    return cdp
  }

  #child

  send(method, params = {}, sessionId) {
    const id = ++this.#id
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    this.#ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.#pending.delete(id)) reject(new Error(`CDP 超时：${method}`))
      }, 20_000)
    })
  }

  waitFor(method) {
    return new Promise((resolve) => {
      const list = this.#listeners.get(method) ?? []
      const fn = (params) => {
        this.#listeners.set(
          method,
          (this.#listeners.get(method) ?? []).filter((f) => f !== fn),
        )
        resolve(params)
      }
      list.push(fn)
      this.#listeners.set(method, list)
    })
  }

  close() {
    try {
      this.#ws.close()
    } catch {
      /* ignore */
    }
    this.#child?.kill()
  }
}

/* ------------------------------------------------------------------ */
/* 页面                                                                */
/* ------------------------------------------------------------------ */

async function openPage(cdp, { width, height, reducedMotion, dark = false }) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const s = (method, params) => cdp.send(method, params, sessionId)

  await s('Page.enable')
  await s('Runtime.enable')
  await s('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  })
  await s('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' },
      {
        name: 'prefers-reduced-motion',
        value: reducedMotion ? 'reduce' : 'no-preference',
      },
    ],
  })
  return { s }
}

async function evaluate(s, expression) {
  const { result, exceptionDetails } = await s('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (exceptionDetails) {
    const detail =
      exceptionDetails.exception?.description ?? exceptionDetails.text ?? '未知异常'
    throw new Error(`页面内执行失败：${detail.split('\n')[0]}`)
  }
  return result.value
}

async function goto(s, cdp, url) {
  const loaded = cdp.waitFor('Page.loadEventFired')
  await s('Page.navigate', { url })
  await loaded
  for (let i = 0; i < 100; i++) {
    if (await evaluate(s, `!!document.querySelector('[data-slot="composer-shell"]')`)) break
    await sleep(100)
  }
  await evaluate(s, 'document.fonts.ready.then(() => true)')
  await sleep(300)
}

async function pressTab(s, shift = false) {
  const modifiers = shift ? 8 : 0
  for (const type of ['rawKeyDown', 'keyUp']) {
    await s('Input.dispatchKeyEvent', {
      type,
      modifiers,
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    })
  }
  await sleep(70)
}

async function clickEl(s, selector) {
  const point = await evaluate(
    s,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`,
  )
  if (!point) return false
  await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await sleep(120)
  await s('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  })
  await s('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  })
  return true
}

async function setMockMode(mode) {
  const res = await fetch(`${MOCK_ORIGIN}/__mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  })
  if (!res.ok) throw new Error(`切模式失败：${res.status}`)
}

/* ------------------------------------------------------------------ */
/* 探测脚本                                                            */
/* ------------------------------------------------------------------ */

/** 读当前焦点元素的全貌：它是什么、可访问名叫什么、有没有焦点指示、是否藏在 aria-hidden 里 */
const PROBE = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) {
    return { tag: 'BODY', name: '（焦点在文档根）', hidden: false, ring: false, offscreen: false };
  }
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();

  // 焦点指示：outline 有宽度，或 outline-offset 生效，或 box-shadow 有环
  const ring =
    (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
    (cs.boxShadow && cs.boxShadow !== 'none' && /rgb/.test(cs.boxShadow));

  // 输入框把指示交给容器边框（focus-within）：这不算缺失，但要单独标出来，
  // 否则「看不出焦点在哪」和「设计上就这么做」会混成同一类问题。
  // 必须从父级开始找：元素自己聚焦时也匹配 :focus-within。
  const host = !ring ? el.parentElement?.closest(':focus-within') : null;
  const hostRing = !!host;

  // 祖先链上有没有 aria-hidden / inert / display:none
  let hidden = false;
  let hiddenBy = null;
  for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
    if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') {
      hidden = true; hiddenBy = 'aria-hidden'; break;
    }
    if (node.hasAttribute && node.hasAttribute('inert')) {
      hidden = true; hiddenBy = 'inert'; break;
    }
  }

  // 视觉上是否被 opacity:0 藏起来（Tab 得到但看不见）
  let faded = false;
  for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
    if (parseFloat(getComputedStyle(node).opacity) < 0.05) { faded = true; break; }
  }

  const label =
    el.getAttribute('aria-label') ||
    (el.getAttribute('aria-labelledby') &&
      document.getElementById(el.getAttribute('aria-labelledby'))?.textContent?.trim()) ||
    el.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 30) ||
    el.getAttribute('placeholder') ||
    '';

  return {
    tag: el.tagName.toLowerCase(),
    slot: el.getAttribute('data-slot') || '',
    type: el.getAttribute('type') || '',
    role: el.getAttribute('role') || '',
    name: label,
    ring,
    hostRing,
    hidden,
    hiddenBy,
    faded,
    offscreen: r.width === 0 && r.height === 0,
    outOfView: r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight,
    outline: cs.outlineStyle === 'none' ? null : cs.outlineWidth + ' ' + cs.outlineStyle,
  };
})()`

/** 页面宏观结构：landmark、标题、跳转链接、live region */
const STRUCTURE = `(() => {
  const q = (sel) => [...document.querySelectorAll(sel)];
  return {
    lang: document.documentElement.lang,
    title: document.title,
    // inert 子树在无障碍树里是整体消失的，统计 landmark 时要一并剔掉，
    // 否则「桌面侧栏 + 移动抽屉」会被数成两个导航区。
    landmarks: q('main, [role=main], nav, aside, header, footer, [role=navigation], [role=landmark]')
      .filter((el) => {
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
          if (n.hasAttribute?.('inert')) return false;
        }
        return true;
      })
      .map((el) => el.tagName.toLowerCase() + (el.getAttribute('aria-label') ? '[' + el.getAttribute('aria-label') + ']' : '')),
    headings: q('h1,h2,h3').map((el) => el.tagName + ':' + el.textContent.trim().slice(0, 18)),
    skipLinks: q('a[href^="#"]').map((el) => el.textContent.trim()),
    liveRegions: q('[aria-live], [role=status], [role=alert]').map((el) => ({
      role: el.getAttribute('role') || '',
      live: el.getAttribute('aria-live') || '',
      slot: el.getAttribute('data-slot') || '',
      text: el.textContent.replace(/\\s+/g, ' ').trim().slice(0, 24),
    })),
    hiddenFocusables: q('button, a[href], input, textarea, [tabindex]').flatMap((el) => {
      // tabindex=-1、visibility:hidden 的元素本来就不参与 Tab（assistant-ui 会用
      // 一个隐藏的影子 textarea 量高度），别把它们也算成「藏起来的可聚焦元素」。
      if (el.tabIndex < 0) return [];
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return [];
      let n = el;
      while (n && n !== document.documentElement) {
        if (n.hasAttribute?.('inert')) return [];           // inert 已从无障碍树移除，正常
        if (n.getAttribute?.('aria-hidden') === 'true') {
          const host = n.getAttribute('data-slot') || n.className.toString().split(' ')[0] || n.tagName.toLowerCase();
          return [el.tagName.toLowerCase() + '「' + (el.getAttribute('aria-label') || el.textContent.trim().slice(0, 14) || el.id) + '」← aria-hidden 于 ' + host];
        }
        n = n.parentElement;
      }
      return [];
    }),
    // 只数真正在无障碍树里、且能 Tab 到的
    tabbable: q('button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])')
      .filter((el) => {
        if (el.tabIndex < 0 || el.offsetParent === null) return false;
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
          if (n.hasAttribute?.('inert')) return false;
        }
        return true;
      }).length,
    inertSupported: 'inert' in HTMLElement.prototype,
    inertSubtrees: q('[inert]').map((el) => el.tagName.toLowerCase() + (el.getAttribute('data-slot') ? '{' + el.getAttribute('data-slot') + '}' : '')),
  };
})()`

/* ------------------------------------------------------------------ */
/* 审查                                                                */
/* ------------------------------------------------------------------ */

const pad = (n, w = 2) => String(n).padStart(w, ' ')

async function auditWidth(cdp, width, steps, reducedMotion) {
  const height = width < 600 ? 844 : 900
  const page = await openPage(cdp, { width, height, reducedMotion })
  await goto(page.s, cdp, BASE)

  const structure = await evaluate(page.s, STRUCTURE)

  // 从文档开头 Tab：先把焦点挪到 body，保证起点一致
  await evaluate(page.s, `document.activeElement?.blur(); true`)
  await sleep(120)

  const trail = []
  for (let i = 0; i < steps; i++) {
    await pressTab(page.s)
    const info = await evaluate(page.s, PROBE)
    // 焦点回到根说明走完一圈
    if (info.tag === 'BODY' && trail.length > 0) {
      trail.push({ step: i + 1, ...info, looped: true })
      break
    }
    trail.push({ step: i + 1, ...info })
  }

  return { width, structure, trail }
}

function report(result) {
  const { width, structure, trail } = result
  console.log(`\n${'='.repeat(72)}`)
  console.log(`视口 ${width}px`)
  console.log('='.repeat(72))

  console.log(`\n[结构] lang=${structure.lang}  h1=${structure.headings.filter((h) => h.startsWith('H1')).length}`)
  console.log(`  landmarks : ${structure.landmarks.join(' | ') || '（无）'}`)
  console.log(`  标题      : ${structure.headings.join(' / ') || '（无）'}`)
  console.log(`  跳转链接  : ${structure.skipLinks.join(' | ') || '（无）'}`)
  console.log(`  可 Tab 元素: ${structure.tabbable}   藏在 aria-hidden 里仍可聚焦: ${structure.hiddenFocusables.length}${structure.hiddenFocusables.length ? ' → ' + structure.hiddenFocusables.join(', ') : ''}`)
  console.log(`  inert 子树 : ${structure.inertSubtrees.length ? structure.inertSubtrees.join(', ') : '（无）'}`)
  console.log(`  inert 支持 : ${structure.inertSupported}`)
  console.log(`  live 区域  : ${structure.liveRegions.length} 个`)
  for (const r of structure.liveRegions) {
    console.log(`    - role=${r.role || '-'} live=${r.live || '-'} slot=${r.slot || '-'} 「${r.text}」`)
  }

  console.log(`\n[Tab 顺序]`)
  for (const step of trail) {
    if (step.looped) {
      console.log(`  ${pad(step.step)}. ← 回到文档根，共 ${step.step - 1} 个落点`)
      break
    }
    // 起点是 document.body：焦点还没进页面，不是缺陷
    if (step.tag === 'BODY') {
      console.log(`  ${pad(step.step)}. （起点·焦点尚未进入页面）`)
      continue
    }
    const flags = []
    if (step.hidden) flags.push(`✗${step.hiddenBy}`)
    if (step.faded) flags.push('✗透明')
    if (!step.ring && !step.hostRing) flags.push('✗无焦点环')
    if (step.outOfView) flags.push('✗视口外')
    if (step.offscreen) flags.push('✗零尺寸')
    const mark = flags.length
      ? ' ⚠ ' + flags.join(' ')
      : step.hostRing
        ? ' · 容器描边'
        : ''
    const who = `${step.tag}${step.role ? `[role=${step.role}]` : ''}${step.slot ? `{${step.slot}}` : ''}`
    console.log(`  ${pad(step.step)}. ${who.padEnd(34)} 「${step.name}」${mark}`)
  }

  const problems = trail.filter(
    (t) =>
      !t.looped &&
      t.tag !== 'BODY' &&
      (t.hidden || t.faded || (!t.ring && !t.hostRing) || t.outOfView || t.offscreen),
  )
  const counted = trail.filter((t) => !t.looped && t.tag !== 'BODY').length
  console.log(`\n  问题落点 ${problems.length} / ${counted}`)
  return problems
}

/** 只盯两个装饰性循环动画：等待态的三个点、生成中的打字光标 */
const MOTION = `(() => {
  const probe = (el, label) => {
    const cs = getComputedStyle(el);
    return {
      sel: label,
      name: cs.animationName,
      dur: cs.animationDuration,
      iter: cs.animationIterationCount,
      opacity: cs.opacity,
    };
  };
  const out = [];
  for (const el of document.querySelectorAll('[data-slot="thinking"] span')) out.push(probe(el, 'dot'));
  const caret = document.querySelector('[data-slot="stream-caret"]');
  if (caret) out.push(probe(caret, 'caret'));
  return out;
})()`

async function motionAudit(cdp) {
  console.log(`\n${'='.repeat(72)}`)
  console.log('动效（等待态的三点 + 生成态的光标）')
  console.log('='.repeat(72))

  await setMockMode('slow')

  for (const reduced of [true, false]) {
    const page = await openPage(cdp, { width: 1440, height: 900, reducedMotion: reduced })
    await goto(page.s, cdp, BASE)
    await evaluate(page.s, 'localStorage.clear(); true')
    await goto(page.s, cdp, BASE)

    await clickEl(page.s, '[data-slot="starter-list"] button')
    await sleep(250)
    await clickEl(page.s, 'button[aria-label="发送消息"]')

    // slow 模式首 token 要等 4.5s：1.2s 时是纯等待态（三点），6.5s 时正文已在流
    await sleep(1200)
    const waiting = await evaluate(page.s, MOTION)
    await sleep(5300)
    const streaming = await evaluate(page.s, MOTION)

    console.log(`\n  prefers-reduced-motion: ${reduced ? 'reduce' : 'no-preference'}`)
    for (const [phase, list] of [
      ['等待态', waiting],
      ['生成态', streaming],
    ]) {
      if (list.length === 0) {
        console.log(`    ${phase}：（没有在跑的动画）`)
        continue
      }
      for (const a of list) {
        console.log(`    ${phase}  ${a.sel.padEnd(26)} ${a.name.padEnd(18)} ${a.dur} × ${a.iter}   opacity=${a.opacity}`)
      }
    }
  }

  await setMockMode('normal')
}

/* ------------------------------------------------------------------ */

/** 动态播报：真发一条消息，记录 live region 的文本流和 alert 出现的时机 */
async function flowAudit(cdp) {
  console.log(`\n${'='.repeat(72)}`)
  console.log('播报（发一条消息，看读屏会听到什么）')
  console.log('='.repeat(72))

  const SNAP = `(() => ({
    live: document.querySelector('[data-slot="live-status"]')?.textContent ?? '',
    thinking: document.querySelectorAll('[data-slot="thinking"]').length,
    thinkingHidden: [...document.querySelectorAll('[data-slot="thinking"]')].every((e) => e.getAttribute('aria-hidden') === 'true'),
    alerts: [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent.replace(/\\s+/g, ' ').trim().slice(0, 50)),
    // 停止键只在 thread.isRunning 时存在——这是「还在生成」唯一可靠的信号。
    // 不能用 caret / thinking：思考阶段有内容但没有正文，两者都不存在。
    running: !!document.querySelector('button[aria-label="停止生成"]'),
    error: !!document.querySelector('[data-slot="message-error"]'),
    stopped: !!document.querySelector('[data-slot="stopped-note"]'),
  }))()`

  for (const mode of ['normal', 'error', 'abort']) {
    await setMockMode(mode)
    const page = await openPage(cdp, { width: 1440, height: 900, reducedMotion: true })
    // 三个场景共用一个浏览器 profile，localStorage 是共享的：
    // 上一个场景发出去的消息会被下一个页面恢复成会话，空状态和 starter 列表都不在了，
    // 后面的点击就全部落空（表现为「什么都没发生」）。所以每轮都清干净再来。
    await goto(page.s, cdp, BASE)
    await evaluate(page.s, 'localStorage.clear(); true')
    await goto(page.s, cdp, BASE)
    await clickEl(page.s, '[data-slot="starter-list"] button')
    await sleep(250)
    await clickEl(page.s, 'button[aria-label="发送消息"]')

    const seen = []
    let lastLive = null
    let lastAlert = ''
    let thinkingHidden = null
    let final = null

    for (let i = 0; i < 70; i++) {
      const snap = await evaluate(page.s, SNAP)
      final = snap
      if (snap.thinking > 0 && thinkingHidden === null) thinkingHidden = snap.thinkingHidden

      const alertKey = snap.alerts.join('|')
      if (snap.live !== lastLive || alertKey !== lastAlert) {
        seen.push({ at: i * 150, live: snap.live, alerts: snap.alerts })
        lastLive = snap.live
        lastAlert = alertKey
      }

      // 结束条件：已经跑过一会儿，并且停止键消失
      if (i > 2 && !snap.running) {
        await sleep(500) // 收尾那一拍（播报有 80ms 的两次写入）
        const settled = await evaluate(page.s, SNAP)
        final = settled
        const settledAlert = settled.alerts.join('|')
        if (settled.live !== lastLive || settledAlert !== lastAlert) {
          seen.push({ at: i * 150 + 500, live: settled.live, alerts: settled.alerts })
        }
        break
      }
      await sleep(150)
    }

    console.log(`\n  mock 模式 ${mode}`)
    for (const s of seen) {
      const alert = s.alerts.length ? `  alert=${JSON.stringify(s.alerts)}` : ''
      console.log(`    ${String(s.at).padStart(5)}ms  live=「${s.live}」${alert}`)
    }
    console.log(
      `    终态：error=${final?.error ? '是' : '否'} stopped=${final?.stopped ? '是' : '否'} 停止键残留=${final?.running ? '是 ✗' : '否 ✓'}`,
    )
    if (process.env.A11Y_DEBUG) console.log('    ' + JSON.stringify(final))
    if (thinkingHidden !== null) {
      console.log(`    等待态对读屏隐藏：${thinkingHidden ? '是 ✓' : '否 ✗（每 3 秒会念一遍）'}`)
    }
  }

  // 用户主动停止：生成到一半点停止键，验证播报的是「已停止生成」而不是「已完成」
  await setMockMode('normal')
  {
    const page = await openPage(cdp, { width: 1440, height: 900, reducedMotion: true })
    await goto(page.s, cdp, BASE)
    await evaluate(page.s, 'localStorage.clear(); true')
    await goto(page.s, cdp, BASE)
    await clickEl(page.s, '[data-slot="starter-list"] button')
    await sleep(250)
    await clickEl(page.s, 'button[aria-label="发送消息"]')
    await sleep(1400)
    await clickEl(page.s, 'button[aria-label="停止生成"]')
    await sleep(900)
    const snap = await evaluate(page.s, SNAP)
    console.log(`\n  mock 模式 normal（1.4s 后手动停止）`)
    console.log(`    live=「${snap.live}」 stopped=${snap.stopped ? '是' : '否'} 停止键残留=${snap.running ? '是 ✗' : '否 ✓'}`)
    console.log(`    alert=${JSON.stringify(snap.alerts)}`)
  }

  await setMockMode('normal')
}

/** Tab 到第 N 个落点后截图：焦点指示长什么样，数据说不清，得看 */
async function focusShot(cdp, stops, width, dark = false) {
  const height = width < 600 ? 844 : 900
  const page = await openPage(cdp, { width, height, reducedMotion: true, dark })
  await goto(page.s, cdp, BASE)
  for (let i = 0; i < stops; i++) await pressTab(page.s)

  const info = await evaluate(
    page.s,
    `(() => {
      const el = document.activeElement;
      if (!el) return '(none)';
      return el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20) || el.tagName;
    })()`,
  )
  const { data } = await page.s('Page.captureScreenshot', { format: 'png' })
  await mkdir(OUT, { recursive: true })
  const suffix = dark ? '-dark' : ''
  const file = join(OUT, `focus-${stops}-${width}${suffix}.png`)
  await writeFile(file, Buffer.from(data, 'base64'))

  // 再拍一张 3 倍局部：焦点环这种东西，缩到 1080 宽之后就看不出对比度够不够了
  const rect = await evaluate(
    page.s,
    `(() => {
      const r = document.activeElement.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })()`,
  )
  const zoom = await page.s('Page.captureScreenshot', {
    format: 'png',
    clip: {
      x: Math.max(0, rect.x - 36),
      y: Math.max(0, rect.y - 26),
      width: Math.min(rect.w + 72, 520),
      height: Math.min(rect.h + 52, 260),
      scale: 3,
    },
  })
  const zoomFile = join(OUT, `focus-${stops}-${width}${suffix}-zoom.png`)
  await writeFile(zoomFile, Buffer.from(zoom.data, 'base64'))
  console.log(`  Tab×${String(stops).padStart(2)} → 「${info}」 → ${zoomFile}`)
}

/** 命令面板：listbox 是 aria-activedescendant 模式，Tab 不该进到选项里 */async function paletteAudit(cdp) {
  console.log(`\n${'='.repeat(72)}`)
  console.log('命令面板（Ctrl K）')
  console.log('='.repeat(72))

  const page = await openPage(cdp, { width: 1440, height: 900, reducedMotion: true })
  await goto(page.s, cdp, BASE)

  for (const type of ['rawKeyDown', 'keyUp']) {
    await page.s('Input.dispatchKeyEvent', {
      type,
      modifiers: 2,
      key: 'k',
      code: 'KeyK',
      windowsVirtualKeyCode: 75,
      nativeVirtualKeyCode: 75,
    })
  }
  await sleep(400)

  const state = await evaluate(
    page.s,
    `(() => {
      const input = document.querySelector('[data-slot="dialog-content"] input');
      const options = [...document.querySelectorAll('[role="option"]')];
      return {
        opened: !!document.querySelector('[data-slot="dialog-content"]'),
        focusInInput: document.activeElement === input,
        options: options.length,
        tabbableOptions: options.filter((o) => o.tabIndex >= 0).length,
        activeDescendant: input?.getAttribute('aria-activedescendant') ?? null,
      };
    })()`,
  )

  console.log(`  弹层已开：${state.opened ? '是' : '否'}`)
  console.log(`  焦点在搜索框：${state.focusInInput ? '是 ✓' : '否 ✗'}`)
  console.log(`  选项数 ${state.options}，其中可 Tab 到 ${state.tabbableOptions} 个 ${state.tabbableOptions === 0 ? '✓' : '✗（会和输入框抢焦点）'}`)
  console.log(`  aria-activedescendant：${state.activeDescendant ?? '（无）'}`)
}

/* ------------------------------------------------------------------ */

async function main() {
  const widths = value('widths', '1440,390').split(',').map(Number)
  const steps = Number(value('steps', 45))
  const cdp = await Cdp.launch()
  let total = 0

  try {
    // 临时探查：在页面里跑一段表达式并打印结果
    if (value('eval')) {
      const page = await openPage(cdp, {
        width: Number(value('width', 1440)),
        height: 900,
        reducedMotion: true,
      })
      await goto(page.s, cdp, BASE)
      console.log(JSON.stringify(await evaluate(page.s, value('eval')), null, 2))
      return
    }

    // 只截焦点态：--shot 1,3,15（加 --dark 走深色）
    if (value('shot')) {
      for (const width of widths) {
        for (const stops of value('shot').split(',').map(Number)) {
          await focusShot(cdp, stops, width, flag('dark'))
        }
      }
      return
    }

    for (const width of widths) {
      const result = await auditWidth(cdp, width, steps, true)
      const problems = report(result)
      total += problems.length
    }
    if (flag('motion')) await motionAudit(cdp)
    if (flag('flow')) await flowAudit(cdp)
    if (flag('palette')) await paletteAudit(cdp)
  } finally {
    cdp.close()
  }

  console.log(`\n合计问题落点：${total}`)
  process.exit(total > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
