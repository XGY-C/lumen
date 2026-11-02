/**
 * 设计审查工具：无头 Chrome（CDP）+ 截图 + 元素量测。
 *
 * 为什么不用 `chrome --screenshot`：
 * - 要能注入会话数据（localStorage），否则只能拍空状态；
 * - 要能一次出「多视口 × 深浅色」，手工敲参数容易漏；
 * - 要能拿到 getBoundingClientRect / computedStyle，把「看起来偏上」变成「偏上 99px」。
 *
 * 用法（dev server 需另开）：
 *   node .tools/shoot.mjs --discover            # 发一条消息，dump localStorage 结构
 *   node .tools/shoot.mjs                       # 空状态 + 会话态，4 张图 + measure.json
 *   node .tools/shoot.mjs --only empty --widths 1440,390
 *   node .tools/shoot.mjs --full                # 长会话整页截图
 *
 * 环境变量：CHROME_PATH 覆盖浏览器路径，BASE_URL 覆盖地址。
 */
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME =
  process.env.CHROME_PATH ??
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.env.BASE_URL ?? 'http://localhost:5185'
const MOCK_ORIGIN = process.env.MOCK_URL ?? 'http://localhost:8099'
const CDP_PORT = Number(process.env.CDP_PORT ?? 9333)
const OUT = '.shots'
const PROFILE = join(tmpdir(), 'lumen-cdp-profile')

/* ------------------------------------------------------------------ */
/* 参数                                                                */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')
    ? argv[i + 1]
    : fallback
}

/* ------------------------------------------------------------------ */
/* 极简 CDP 客户端                                                      */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
        // 本机系统代理会把 localhost 请求转发出去，截图拿到的是代理错误页。
        '--no-proxy-server',
        `--user-data-dir=${PROFILE}`,
        `--remote-debugging-port=${CDP_PORT}`,
        'about:blank',
      ],
      { stdio: 'ignore', detached: false },
    )

    // 等 devtools 端口起来
    let version
    for (let i = 0; i < 100; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
        if (res.ok) {
          version = await res.json()
          break
        }
      } catch {
        /* 还没起来 */
      }
      await sleep(100)
    }
    if (!version) throw new Error('CDP 端口未就绪')

    const cdp = new Cdp()
    await cdp.#connect(version.webSocketDebuggerUrl)
    cdp.child = child
    return cdp
  }

  async #connect(url) {
    this.#ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      this.#ws.addEventListener('open', resolve, { once: true })
      this.#ws.addEventListener('error', reject, { once: true })
    })
    this.#ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.#pending.has(msg.id)) {
        const { resolve, reject } = this.#pending.get(msg.id)
        this.#pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
        return
      }
      if (msg.method) {
        for (const fn of this.#listeners.get(msg.method) ?? []) fn(msg.params)
      }
    })
  }

  send(method, params = {}, sessionId) {
    const id = ++this.#id
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    this.#ws.send(JSON.stringify(payload))
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.#pending.delete(id)) reject(new Error(`CDP 超时：${method}`))
      }, 30_000)
    })
  }

  on(method, fn) {
    const list = this.#listeners.get(method) ?? []
    list.push(fn)
    this.#listeners.set(method, list)
  }

  waitFor(method, timeout = 15_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等不到 ${method}`)), timeout)
      this.on(method, (params) => {
        clearTimeout(timer)
        resolve(params)
      })
    })
  }

  close() {
    try {
      this.#ws?.close()
    } catch {
      /* ignore */
    }
    this.child?.kill()
  }
}

/* ------------------------------------------------------------------ */
/* 页面操作                                                            */
/* ------------------------------------------------------------------ */

async function openPage(cdp, { width, height, dark }) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  })
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
      { name: 'prefers-reduced-motion', value: 'reduce' }, // 截图不要抓动画中间帧
    ],
  })
  return { s, sessionId, targetId }
}

async function evaluate(s, expression) {
  const { result, exceptionDetails } = await s('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (exceptionDetails) {
    const detail =
      exceptionDetails.exception?.description ??
      exceptionDetails.text ??
      '未知异常'
    throw new Error(`页面内执行失败：${detail.split('\n')[0]}`)
  }
  return result.value
}

/** 等到输入区挂载 + 字体就位（字体没加载完截图，字宽是错的） */
async function waitReady(s) {
  for (let i = 0; i < 100; i++) {
    const ready = await evaluate(
      s,
      `!!document.querySelector('[data-slot="composer-shell"]')`,
    )
    if (ready) break
    await sleep(100)
  }
  await evaluate(s, 'document.fonts.ready.then(() => true)')
  await sleep(250) // 让 animate-in 的入场动画走完
}

async function setStorage(s, entries) {
  const script = Object.entries(entries)
    .map(
      ([k, v]) =>
        `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(
          typeof v === 'string' ? v : JSON.stringify(v),
        )})`,
    )
    .join(';')
  await evaluate(s, `${script}; true`)
}

async function goto(s, cdp, url) {
  const loaded = cdp.waitFor('Page.loadEventFired')
  await s('Page.navigate', { url })
  await loaded
  await waitReady(s)
}

/**
 * 把消息视口滚到顶部/底部。
 * 截图必须能复现，不能靠「恰好停在用户上次的位置」。
 */
async function scrollTo(s, position) {
  const to = position === 'bottom' ? 'scroller.scrollHeight' : '0'
  const apply = () =>
    evaluate(
      s,
      `(() => {
        const scroller = document.querySelector('[data-slot="thread-viewport"]');
        if (!scroller) return false;
        scroller.scrollTo({ top: ${to}, behavior: 'instant' });
        return true;
      })()`,
    )
  // 应用挂载后会把视口贴到底部（两帧 rAF），抢在它前面滚会被覆盖。
  // 所以先等它贴完，再连续压两次，保证最终位置是我们想要的。
  await sleep(400)
  await apply()
  await sleep(200)
  await apply()
  await sleep(150)
}

async function shot(s, file, { full = false } = {}) {  let params = { format: 'png' }
  if (full) {
    const m = await s('Page.getLayoutMetrics')
    const h = Math.ceil(m.cssContentSize.height)
    params = { ...params, captureBeyondViewport: true, clip: { x: 0, y: 0, width: m.cssContentSize.width, height: h, scale: 1 } }
  }
  const { data } = await s('Page.captureScreenshot', params)
  await writeFile(file, Buffer.from(data, 'base64'))
  return file
}

/**
 * 局部放大截图：给一个选择器，截它周围一圈并放大 2 倍。
 *
 * 为什么要它：整页截图会缩到看不清 13px 的文字，而「着重号有没有画出来」
 * 「复选框有没有勾」这类判断只能靠放大看。改细节前先用它确认现状。
 */
async function shotElement(s, selector, file, { pad = 32, scale = 2 } = {}) {
  const rect = await evaluate(
    s,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })()`,
  )
  if (!rect || !rect.w) return null

  const { data } = await s('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: {
      x: Math.max(0, rect.x - pad),
      y: Math.max(0, rect.y - pad),
      width: Math.min(1440, rect.w + pad * 2),
      height: rect.h + pad * 2,
      scale,
    },
  })
  await writeFile(file, Buffer.from(data, 'base64'))
  return file
}

/** 发一次组合键（Windows 下 MOD_KEY 是 Ctrl，modifiers: 2 = Ctrl） */
async function pressCombo(s, { key, code, vk, modifiers = 2 }) {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await s('Input.dispatchKeyEvent', {
      type,
      modifiers,
      key,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
    })
  }
}

/** 单键（Esc / Enter 之类），不带修饰键 */
async function pressKey(s, key, code, vk) {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await s('Input.dispatchKeyEvent', {
      type,
      key,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
    })
  }
}

/** 真实点击某个元素：必须先移动鼠标过去，否则 hover 才出现的按钮点不到 */
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
  await sleep(180)
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

/** 只把鼠标移过去，不点。用来触发 hover 态与 tooltip */
async function hoverEl(s, selector) {
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
  return true
}

/* ------------------------------------------------------------------ */
/* 量测                                                                */
/* ------------------------------------------------------------------ */

/** 想量什么就写什么：选择器 → 需要的样式字段 */
const PROBES = [
  ['[data-slot="message-list"]', ['row-gap']],
  ['[data-slot="user-message"]', ['margin-top']],
  ['[data-slot="user-bubble"]', ['font-size', 'padding-top', 'border-radius']],
  ['[data-slot="assistant-message"]', ['margin-top']],
  ['[data-slot="msg-actions"]', ['height', 'margin-top']],
  ['[data-slot="reasoning-trigger"]', ['font-size', 'padding-top']],
  ['[data-slot="reasoning-content"]', ['font-size', 'margin-top', 'padding-inline-start', 'border-inline-start-width']],
  ['.aui-md', ['font-size', 'line-height']],
  ['.aui-md-p', ['margin-top', 'margin-bottom']],
  ['.aui-md-blockquote', ['font-style', 'border-inline-start-width']],
  ['.aui-md-pre', ['font-size', 'border-radius', 'background-color', 'margin-top', 'margin-bottom']],
  ['.aui-code-header-root', ['height', 'margin-top']],
  ['.aui-md-table-wrapper', ['margin-top', 'margin-bottom']],
  ['.aui-md-inline-code', ['font-size', 'background-color', 'padding-inline', 'border-radius']],
  ['.aui-md-a', ['color', 'text-decoration-color', 'text-underline-offset']],
  ['.aui-md-li', ['line-height', 'font-size']],
  ['.aui-md-h3', ['font-size', 'font-weight']],
  ['.aui-md-h4', ['font-size', 'font-weight']],
  ['.aui-md-strong', ['font-weight']],
  ['.aui-md-em', ['font-style']],
  ['[data-slot="message-error"]', ['margin-top', 'padding', 'border-color', 'background-color']],
  ['[role="status"]', ['height', 'font-size']],
  ['button[aria-label="回到最新"]', ['width', 'height', 'opacity', 'transform']],
  ['[data-slot="dialog-overlay"]', ['background-color', 'opacity']],
  ['[data-slot="dialog-content"]', ['background-color', 'border-radius', 'box-shadow']],
  ['#palette-list', ['max-height', 'padding-top']],
  ['[data-slot="composer-shell"]', ['height', 'border-radius', 'box-shadow']],
  ['[data-slot="composer-input"]', ['font-size', 'line-height', 'padding-top', 'padding-right', 'padding-bottom']],
  ['[data-slot="composer-shell"] button', ['background-color', 'color']],
  ['[data-slot="composer-note"]', ['height', 'font-size', 'margin-top']],
  ['[data-slot="welcome"]', ['margin-top', 'margin-bottom']],
  ['aside', ['width']],
  ['header', ['height']],
]

const MEASURE_SCRIPT = `(() => {
  const probes = ${JSON.stringify(PROBES)};
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } };
  const viewport = { w: innerWidth, h: innerHeight };

  // 找到真正的滚动容器，记录滚动位置：滚过以后「重心」就没有参考意义了
  // 用 data-slot 直接命中：靠「scrollHeight 大于 clientHeight」去猜会先命中
  // 代码块这类横向滚动元素，结果一直滚的是错误的东西。
  const scroller = document.querySelector('[data-slot="thread-viewport"]');

  const out = { viewport, scrollTop: scroller ? Math.round(scroller.scrollTop) : null, elements: {} };

  // 纵向流动序列：把主区里能识别的块按顺序排出来，相邻块的间距一目了然。
  // 「消息流的节奏」本质上就是这个数组的差分，光看单元素探针看不出来。
  const flowSel = [
    'main .aui-md-h1', 'main .aui-md-h2', 'main .aui-md-h3',
    'main .aui-md-p', 'main .aui-md-pre', 'main .aui-md-table', 'main .aui-code-header-root',
    'main .aui-md-blockquote', 'main .aui-md-ul', 'main .aui-md-ol',
    'main [data-slot="user-bubble"]', 'main [data-slot="reasoning-trigger"]',
  ].join(',')
  out.flow = [...document.querySelectorAll(flowSel)]
    .filter((el) => el.offsetParent !== null)
    // 只保留最外层：引用/列表内部的 p 会被重复计入，间距差分出现负数
    .filter((el) => !el.parentElement?.closest(flowSel))
    .map((el) => {
      const r = el.getBoundingClientRect()
      const kind =
        el.getAttribute('data-slot') ??
        [...el.classList].find((c) => c.startsWith('aui-md-')) ??
        el.tagName.toLowerCase()
      return {
        kind: kind.replace('aui-md-', '').replace('[data-slot="', '').replace('"]', ''),
        top: +r.top.toFixed(1),
        bottom: +r.bottom.toFixed(1),
      }
    })
    .sort((a, b) => a.top - b.top)
    .map((item, index, arr) => ({
      ...item,
      gapBefore: index === 0 ? null : +(item.top - arr[index - 1].bottom).toFixed(1),
    }))

  // 焦点落在哪：发送后焦点若跑到 body，用户连续输入就得重新点一次输入框。
  const cb = document.querySelector('.aui-md li input[type="checkbox"]');
  out.checkbox = cb ? { parent: cb.parentElement.tagName + '.' + cb.parentElement.className, checked: cb.checked, disabled: cb.disabled, w: getComputedStyle(cb).width, opacity: getComputedStyle(cb).opacity, accent: getComputedStyle(cb).accentColor } : null;

  const ae = document.activeElement;
  out.focus = ae ? (ae.getAttribute('data-slot') ?? ae.tagName.toLowerCase()) : null;

  // 侧栏：264px 里到底装了什么。会话标题被截断多少、行内按钮吃掉多少宽度、
  // 每个区块占多高——这几项决定了「信息密度」，也是侧栏最常被做废的地方。
  // 注意：移动端页面里有两个 aside（桌面内联的那个被 display:none 隐藏），
  // 必须取可见的那个，否则永远量到隐藏节点、整个 sidebar 段变 null。
  const aside = [...document.querySelectorAll('aside')].find(
    (el) => el.offsetParent !== null,
  );
  if (aside) {
    out.sidebar = {
      width: +aside.getBoundingClientRect().width.toFixed(1),
      blocks: [...aside.children].map((el) => ({
        tag: el.tagName.toLowerCase(),
        h: +el.getBoundingClientRect().height.toFixed(1),
      })),
    };

    const titles = [...aside.querySelectorAll('[data-slot="session-title"]')];
    out.sidebar.rows = titles.slice(0, 4).map((el) => {
      const row = el.closest('[data-slot="session-row"]');
      const btn = el.closest('button');
      const actions = row?.querySelector('button[aria-label="更多操作"]');
      const cs = getComputedStyle(el);
      // 汉字宽度 ≈ 字号，用它换算「这个宽度能显示几个字」
      const size = parseFloat(cs.fontSize);
      return {
        text: el.textContent.slice(0, 24),
        rowH: row ? +row.getBoundingClientRect().height.toFixed(1) : null,
        // scrollWidth > clientWidth 就是被截断了
        truncated: el.scrollWidth > el.clientWidth + 1,
        reservePx: btn ? +(btn.getBoundingClientRect().width - el.getBoundingClientRect().width).toFixed(1) : null,
        charsFits: el.clientWidth ? +(el.clientWidth / size).toFixed(1) : null,
        actionsW: actions ? +actions.getBoundingClientRect().width.toFixed(1) : null,
        actionBtn: actions
          ? [actions].map(
              (b) => b.getBoundingClientRect().width + '×' + b.getBoundingClientRect().height,
            )
          : null,
      };
    });

    const quick = aside.querySelector('[data-slot="sidebar-quick"]');
    if (quick) {
      const first = quick.querySelector('button');
      out.sidebar.quick = {
        h: +quick.getBoundingClientRect().height.toFixed(1),
        btnH: first ? +first.getBoundingClientRect().height.toFixed(1) : null,
      };
    }
    const footer = aside.querySelector('[data-slot="sidebar-footer"]');
    if (footer) {
      out.sidebar.footer = {
        h: +footer.getBoundingClientRect().height.toFixed(1),
        text: footer.textContent.trim().slice(0, 30),
      };
    }
  }

  // 骨架不变量：任何宽度下都不许出现横向滚动
  out.overflow = {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
    horizontal: document.documentElement.scrollWidth > innerWidth + 1,
  };
  for (const [selector, props] of probes) {
    const el = document.querySelector(selector);
    if (!el) { out.elements[selector] = null; continue; }
    const cs = getComputedStyle(el);
    const style = {};
    for (const p of props) style[p] = cs.getPropertyValue(p);
    out.elements[selector] = { rect: rect(el), style };
  }
  // 左边界对齐：排版事故里最常见、也最好量化的一类
  const ALIGN = {
    '正文容器': 'main .aui-md',
    '正文首块': 'main .aui-md > *:first-child',
    '表格': 'main .aui-md table',
    '代码块': 'main .aui-md pre',
    '引用': 'main .aui-md blockquote',
    '折叠触发器': 'main button[aria-expanded]',
    '输入框': '[data-slot="composer-shell"]',
  };
  out.alignment = {};
  for (const [label, selector] of Object.entries(ALIGN)) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    out.alignment[label] = { x: +r.x.toFixed(1), right: +(r.x + r.width).toFixed(1) };
  }
  // 行宽：正文一行大致能放多少汉字（中文排版的核心指标）
  const p = document.querySelector('main .aui-md p');
  if (p) {
    const cs = getComputedStyle(p);
    const size = parseFloat(cs.fontSize);
    out.lineLength = {
      chars: Math.round(p.getBoundingClientRect().width / size),
      availablePx: +p.getBoundingClientRect().width.toFixed(1),
      fontSize: size,
    };
  }

  // 刻度普查：字号和圆角到底有几档。
  // M1 这类「收敛 token」的改动，几何不会变，能证明成果的只有这两个计数。
  // 顺便记下每个档位的样本元素，漏网的那个一眼就能找出来。
  const countBy = (setter) => {
    const map = new Map();
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const value = setter(el);
      if (!value) continue;
      const entry = map.get(value) ?? { count: 0, samples: [] };
      entry.count += 1;
      if (entry.samples.length < 3) {
        entry.samples.push(
          el.tagName.toLowerCase() +
            (el.className && typeof el.className === 'string'
              ? '.' + el.className.split(' ').slice(0, 3).join('.')
              : ''),
        );
      }
      map.set(value, entry);
    }
    return [...map.entries()]
      .sort((a, b) => (parseFloat(a[0]) || 1e9) - (parseFloat(b[0]) || 1e9))
      .map(([value, { count, samples }]) => ({ value, count, samples }));
  };

  const normalizeRadius = (radius) => {
    const px = parseFloat(radius);
    if (!radius || !px) return null;
    return px > 1000 ? 'full' : radius; // rounded-full 的计算值是个巨大的数
  };

  out.census = {
    fontSizes: countBy((el) => {
      const hasText = [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.trim(),
      );
      return hasText ? getComputedStyle(el).fontSize : null;
    }),
    radii: countBy((el) => normalizeRadius(getComputedStyle(el).borderTopLeftRadius)),
  };

  // 取样时要挑一个「一定存在且一定上色」的强调色元素：空输入时发送键是 disabled 的灰色
  const brandEl = [...document.querySelectorAll('aside button')].find((b) =>
    b.textContent.includes('新对话'),
  );
  if (brandEl) out.brandSample = getComputedStyle(brandEl).backgroundColor;

  // 顶栏在窄屏会不会挤：把每个子元素的宽度摊开看
  const header = document.querySelector('header');
  if (header) {
    out.header = {
      rect: rect(header),
      children: [...header.children].flatMap((el) =>
        el.matches('button, h1, span')
          ? [el]
          : [...el.querySelectorAll('button, span')],
      ).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 10),
          x: +r.x.toFixed(1),
          w: +r.width.toFixed(1),
        };
      }),
    };
  }

  // 内容群的重心：把「一屏内容的整体」框准。
  // 只取 h1 + .aui-md 会漏掉欢迎区的小标题、以及输入框下方那行说明，
  // 量出来的重心就是假的（M1 曾经据此误判过一次）。
  const blocks = [
    ...document.querySelectorAll(
      [
        '[data-slot="welcome"]',
        '[data-slot="assistant-message"]',
        '[data-slot="user-message"]',
        '[data-slot="composer-shell"]',
        '[data-slot="composer-note"]',
      ].join(', '),
    ),
  ].filter((el) => el.offsetParent !== null);
  if (blocks.length) {
    const tops = blocks.map((el) => el.getBoundingClientRect().top);
    const bottoms = blocks.map((el) => el.getBoundingClientRect().bottom);
    const top = Math.min(...tops), bottom = Math.max(...bottoms);
    // 基准是「主区」的中线，不是窗口中线：内容活在 52px 顶栏之下，
    // 拿 window.innerHeight / 2 比会凭空多出 26px 偏差（M1/M2 各误判过一次）。
    const mainRect = document.querySelector('main').getBoundingClientRect();
    const frameCenter = mainRect.top + mainRect.height / 2;
    // 内容比视口高时（长对话），「重心」没有意义，只报不适用
    if (bottom - top <= mainRect.height - 8) {
      out.contentMass = {
        top: +top.toFixed(1),
        bottom: +bottom.toFixed(1),
        center: +((top + bottom) / 2).toFixed(1),
        frameCenter: +frameCenter.toFixed(1),
        offset: +(((top + bottom) / 2) - frameCenter).toFixed(1),
      };
    }
  }
  return out;
})()`

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function discover(cdp) {
  // 通过 UI 真发一条消息，拿到「应用自己写进去的」存储结构
  const page = await openPage(cdp, { width: 1440, height: 900, dark: false })
  await goto(page.s, cdp, BASE)

  if (flag('probe')) {
    console.log(
      await evaluate(
        page.s,
        `(() => {
          const shell = document.querySelector('[data-slot="composer-shell"]');
          const input = document.querySelector('[data-slot="composer-input"]');
          return JSON.stringify({
            href: location.href,
            readyState: document.readyState,
            bodyLength: document.body?.innerHTML.length ?? -1,
            bodyHead: document.body?.innerHTML.slice(0, 300) ?? null,
            rootHtml: document.getElementById('root')?.innerHTML.slice(0, 200) ?? null,
            inputTag: input?.tagName ?? null,
            shellFound: !!shell,
          }, null, 2);
        })()`,
      ),
    )
    return
  }

  await evaluate(
    page.s,
    `(() => {
      const el = document.querySelector('[data-slot="composer-input"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, '解释一下 SSE 为什么要做分帧');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  )
  await sleep(200)
  await evaluate(page.s, `document.querySelector('[aria-label="发送消息"]').click(), true`)

  // mock 后端大约 3–4 秒推完
  for (let i = 0; i < 80; i++) {
    const done = await evaluate(
      page.s,
      `!document.querySelector('[aria-label="停止生成"]')`,
    )
    if (done) break
    await sleep(250)
  }
  await sleep(600)

  const dump = await evaluate(
    page.s,
    `JSON.stringify(Object.fromEntries(Object.entries(localStorage)), null, 2)`,
  )
  console.log(dump)
  await shot(page.s, join(OUT, 'discover.png'))
}

/** 切换 mock 的故障模式（POST /__mode）。只有 mock 后端认这个接口。 */
async function setMockMode(mode) {
  const res = await fetch(`${MOCK_ORIGIN}/__mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  })
  if (!res.ok) throw new Error(`切模式失败：${res.status}（mock 起了吗？）`)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const cdp = await Cdp.launch()

  try {
    if (flag('discover')) {
      await discover(cdp)
      return
    }

    const widths = value('widths', '1440,768,390').split(',').map(Number)
    const only = value('only', 'empty,session')
    const report = {}

    for (const width of widths) {
      const height = Number(value('height', width < 600 ? 844 : 900))
      for (const dark of [false, true]) {
        const mode = dark ? 'dark' : 'light'
        const page = await openPage(cdp, { width, height, dark })

        if (only.includes('session')) {
          await goto(page.s, cdp, BASE)
          await setStorage(page.s, { ...FIXTURE, 'lumen-theme': mode })
          await goto(page.s, cdp, BASE)
          await scrollTo(page.s, value('at', 'top'))
          const name = `session-${width}-${mode}`
          report[name] = await evaluate(page.s, MEASURE_SCRIPT)
          await shot(page.s, join(OUT, `${name}.png`), { full: flag('full') })

          // 细节放大：--el "aside"
          if (value('el')) {
            await shotElement(
              page.s,
              value('el'),
              join(OUT, `detail-${width}-${mode}.png`),
            )
          }

          // --quick：展开侧栏底部的「快捷提问」，验证收起/展开两态
          if (flag('quick')) {
            await clickEl(page.s, '[data-slot="sidebar-quick"] button')
            await sleep(300)
            await shotElement(
              page.s,
              'aside',
              join(OUT, `quick-${width}-${mode}.png`),
            )
          }
        }

        // 排版细则：所有内联元素与列表形态一次看全
        if (only.includes('typography')) {
          await goto(page.s, cdp, BASE)
          await evaluate(page.s, `localStorage.clear(); true`)
          await setStorage(page.s, { ...FIXTURE_TYPO, 'lumen-theme': mode })
          await goto(page.s, cdp, BASE)
          await scrollTo(page.s, value('at', 'top'))
          const name = `typo-${width}-${mode}`
          report[name] = await evaluate(page.s, MEASURE_SCRIPT)
          await shot(page.s, join(OUT, `${name}.png`), { full: flag('full') })

          // 细节放大：--el ".aui-md-em"
          if (value('el')) {
            await shotElement(
              page.s,
              value('el'),
              join(OUT, `detail-${width}-${mode}.png`),
            )
          }
        }

        // 命令面板：默认态 / 搜到结果 / 空结果。这三种态只能靠真的按键才出得来
        if (only.includes('palette')) {
          await goto(page.s, cdp, BASE)
          await evaluate(page.s, `localStorage.clear(); true`)
          await setStorage(page.s, { ...FIXTURE, 'lumen-theme': mode })
          await goto(page.s, cdp, BASE)

          await pressCombo(page.s, { key: 'k', code: 'KeyK', vk: 75 })
          await sleep(450)
          const base = `palette-${width}-${mode}`
          report[base] = await evaluate(page.s, MEASURE_SCRIPT)
          await shot(page.s, join(OUT, `${base}.png`))

          await page.s('Input.insertText', { text: 'sse' })
          await sleep(350)
          const searched = `palette-search-${width}-${mode}`
          report[searched] = await evaluate(page.s, MEASURE_SCRIPT)
          await shot(page.s, join(OUT, `${searched}.png`))

          // 清空再输一个必然搜不到的词
          await pressCombo(page.s, { key: 'a', code: 'KeyA', vk: 65 })
          await page.s('Input.insertText', { text: '没有这个对话' })
          await sleep(350)
          const empty = `palette-empty-${width}-${mode}`
          report[empty] = await evaluate(page.s, MEASURE_SCRIPT)
          await shot(page.s, join(OUT, `${empty}.png`))
        }

        // 破坏性操作的确认框：侧栏行的删除按钮 hover 才出现，必须真点
        if (only.includes('dialog')) {
          await goto(page.s, cdp, BASE)
          await evaluate(page.s, `localStorage.clear(); true`)
          await setStorage(page.s, { ...FIXTURE, 'lumen-theme': mode })
          await goto(page.s, cdp, BASE)
          await clickEl(page.s, 'button[aria-label="删除"]')
          await sleep(450)
          const name = `dialog-${width}-${mode}`
          report[name] = await evaluate(page.s, MEASURE_SCRIPT)
          await shot(page.s, join(OUT, `${name}.png`))
        }

        // tooltip：延迟 300ms 后才出现，必须真的 hover 并等
        if (only.includes('tooltip')) {
          await goto(page.s, cdp, BASE)
          await evaluate(page.s, `localStorage.clear(); true`)
          await setStorage(page.s, { ...FIXTURE_TYPO, 'lumen-theme': mode })
          await goto(page.s, cdp, BASE)
          await hoverEl(page.s, '.aui-code-header-root button')
          await sleep(700)
          const name = `tooltip-${width}-${mode}`
          report[name] = await evaluate(page.s, MEASURE_SCRIPT)
          await shot(page.s, join(OUT, `${name}.png`))
        }

        // 会话行「…」菜单：只有点开才看得到的浮层，不能靠读代码判断
        if (only.includes('menu')) {
          await goto(page.s, cdp, BASE)
          await evaluate(page.s, `localStorage.clear(); true`)
          await setStorage(page.s, { ...FIXTURE, 'lumen-theme': mode })
          await goto(page.s, cdp, BASE)
          await hoverEl(page.s, '[data-slot="session-row"]')
          await clickEl(page.s, 'button[aria-label="更多操作"]')
          await sleep(350)
          const name = `menu-${width}-${mode}`
          report[name] = await evaluate(page.s, MEASURE_SCRIPT)
          await shot(page.s, join(OUT, `${name}.png`))

          // --rename：菜单 → 重命名 → 输入框。这条链路最容易被「菜单关闭时
          // 把焦点还给触发按钮」打断，必须真的走一遍并检查 activeElement。
          if (flag('rename')) {
            await clickEl(page.s, '[data-slot="dropdown-menu-item"]')
            await sleep(600)
            const focused = await evaluate(
              page.s,
              `(() => {
                const el = document.activeElement;
                const more = document.querySelectorAll('button[aria-label="更多操作"]').length;
                return JSON.stringify({
                  tag: el ? el.tagName : null,
                  label: el ? el.getAttribute('aria-label') : null,
                  value: el && 'value' in el ? el.value.slice(0, 20) : null,
                  selected: el && 'selectionEnd' in el ? el.selectionEnd - el.selectionStart : null,
                  moreButtons: more,
                });
              })()`,
            )
            console.log('  重命名后焦点 →', focused)
            await shotElement(
              page.s,
              'aside',
              join(OUT, `rename-${width}-${mode}.png`),
            )
          }
        }

        // 移动端抽屉：390 下侧栏是浮层，行高与触摸目标跟桌面不是一套参数，
        // 必须单独截，不能拿 1440 的图推断
        if (only.includes('drawer')) {
          await goto(page.s, cdp, BASE)
          await evaluate(page.s, `localStorage.clear(); true`)
          await setStorage(page.s, { ...FIXTURE, 'lumen-theme': mode })
          await goto(page.s, cdp, BASE)
          await clickEl(page.s, 'button[aria-label="打开侧栏"]')
          await sleep(400)
          const name = `drawer-${width}-${mode}`
          report[name] = await evaluate(page.s, MEASURE_SCRIPT)
          await shot(page.s, join(OUT, `${name}.png`))
        }

        if (only.includes('empty')) {
          await goto(page.s, cdp, BASE)
          await evaluate(page.s, `localStorage.clear(); true`)
          await setStorage(page.s, { 'lumen-theme': mode })
          await goto(page.s, cdp, BASE)
          const name = `empty-${width}-${mode}`
          report[name] = await evaluate(page.s, MEASURE_SCRIPT)
          await shot(page.s, join(OUT, `${name}.png`))
        }

        // 输入区：聚焦态 + 多行伸展。这两个态没法靠静态截图触发，必须真的往里打字。
        if (only.includes('composer')) {
          await goto(page.s, cdp, BASE)
          await evaluate(page.s, `localStorage.clear(); true`)
          await setStorage(page.s, { 'lumen-theme': mode })
          await goto(page.s, cdp, BASE)
          await evaluate(
            page.s,
            `document.querySelector('[data-slot="composer-input"]')?.focus(); true`,
          )
          await sleep(350)
          const name = `composer-${width}-${mode}`
          report[name] = await evaluate(page.s, MEASURE_SCRIPT)
          await shot(page.s, join(OUT, `${name}.png`))

          await page.s('Input.insertText', {
            text: '帮我把这段 SQL 改成窗口函数，并对每个用户取最新一笔订单。\n另外说明为什么原来的写法在数据量上来之后会慢。\n最好给出两个版本的执行计划差异。',
          })
          await sleep(350)
          const multi = `composer-multi-${width}-${mode}`
          report[multi] = await evaluate(page.s, MEASURE_SCRIPT)
          await shot(page.s, join(OUT, `${multi}.png`))

          // 生成中：发送按钮应原位变成停止键，note 行切成 Esc 提示。
          // 依赖 mock 后端（API_TARGET 指向 8099），没有 mock 时这一张没有意义。
          if (flag('stream')) {
            await evaluate(
              page.s,
              `document.querySelector('[data-slot="composer-shell"] button')?.click(); true`,
            )
            await sleep(900)
            const running = `composer-running-${width}-${mode}`
            report[running] = await evaluate(page.s, MEASURE_SCRIPT)
            await shot(page.s, join(OUT, `${running}.png`))
          }

          // 超长输入：验证 max-h 上限与内部滚动，不然输入几十行会把视口撑爆。
          if (flag('tall')) {
            await page.s('Input.insertText', {
              text: Array.from(
                { length: 22 },
                (_, i) => `第 ${i + 1} 行：验证超长输入时的滚动上限与内部滚动条。`,
              ).join('\n'),
            })
            await sleep(300)
            const tall = `composer-tall-${width}-${mode}`
            report[tall] = await evaluate(page.s, MEASURE_SCRIPT)
            await shot(page.s, join(OUT, `${tall}.png`))
          }
        }

        // 状态矩阵：坏情况不会自己发生，得往 mock 里注入故障再真发一条消息。
        // 每个场景前都清空并重载，避免上一轮的半截回答留在列表里干扰判断。
        if (only.includes('states')) {
          const scenarios = [
            ['slow', 1200, false],
            ['error', 1800, false],
            ['abort', 3200, false],
            ['long', 5000, false],
            // 用户自己按 Esc 停掉：和「后端断了」是两件事，界面不该说同一句话
            ['stop', 1100, true],
            // 真断网（CDP offline），走的是 fetch 直接 reject 那条路
            ['offline', 1500, false],
          ]

          for (const [scenario, wait, stopByEsc] of scenarios) {
            await setMockMode(scenario)
            await goto(page.s, cdp, BASE)
            await evaluate(page.s, `localStorage.clear(); true`)
            await setStorage(page.s, { 'lumen-theme': mode })
            await goto(page.s, cdp, BASE)

            await evaluate(
              page.s,
              `document.querySelector('[data-slot="composer-input"]')?.focus(); true`,
            )
            await page.s('Input.insertText', {
              text: '帮我看看这段流式渲染的代码，为什么切会话之后会丢内容',
            })
            await sleep(200)

            // 真断网：用 CDP 把网络整个关掉，而不是让 mock 返回一个假错误。
            // 只有这样才能拿到浏览器真正抛的 `TypeError: Failed to fetch`。
            if (scenario === 'offline') {
              await page.s('Network.enable', {})
              await page.s('Network.emulateNetworkConditions', {
                offline: true,
                latency: 0,
                downloadThroughput: 0,
                uploadThroughput: 0,
              })
            }

            await evaluate(
              page.s,
              `document.querySelector('[data-slot="composer-shell"] button')?.click(); true`,
            )
            await sleep(wait)

            if (scenario === 'offline') {
              await page.s('Network.emulateNetworkConditions', {
                offline: false,
                latency: 0,
                downloadThroughput: -1,
                uploadThroughput: -1,
              })
            }

            if (stopByEsc) {
              await pressKey(page.s, 'Escape', 'Escape', 27)
              await sleep(700)
            }

            const name = `state-${scenario}-${width}-${mode}`
            report[name] = await evaluate(page.s, MEASURE_SCRIPT)
            await shot(page.s, join(OUT, `${name}.png`))

            // 长回答还要看「上滑之后」：回到最新按钮应当出现，输入框不应跟着跑
            if (scenario === 'long') {
              await evaluate(
                page.s,
                `(() => {
                  const sc = document.querySelector('[data-slot="thread-viewport"]');
                  if (!sc) return false;
                  sc.scrollTop = 240;
                  return true;
                })()`,
              )
              await sleep(400)
              const scrolled = `state-long-scrolled-${width}-${mode}`
              report[scrolled] = await evaluate(page.s, MEASURE_SCRIPT)
              await shot(page.s, join(OUT, `${scrolled}.png`))
            }
          }

          await setMockMode('normal')
        }

        await cdp.send('Target.closeTarget', { targetId: page.targetId })
      }
    }

    await writeFile(join(OUT, 'measure.json'), JSON.stringify(report, null, 2))
    console.log(`\n产物 → ${OUT}/`)
    for (const [name, data] of Object.entries(report)) {
      const mass = data.contentMass
      console.log(
        `  ${name.padEnd(20)} 内容群重心偏差 ${mass ? `${mass.offset > 0 ? '+' : ''}${mass.offset}px` : 'n/a'}`,
      )
    }
  } finally {
    cdp.close()
  }
}

/* ------------------------------------------------------------------ */
/* 会话夹具：用于视觉审查的「真实长什么样」                              */
/*                                                                     */
/* 结构照抄应用自己写进 localStorage 的样子（见 --discover 的输出）。    */
/* 内容刻意覆盖：折叠的思考、多级标题、有序/无序列表、表格、代码块、      */
/* 引用、行内代码、加粗、链接 —— 视觉审查要看的细节全在里面。            */
/* ------------------------------------------------------------------ */

const SEED_ID = 'seed-visual-review'
const T = Date.now()

const part = {
  text: (text) => ({ type: 'text', text }),
  reasoning: (text, secondsAgoFrom, secondsAgoTo) => ({
    type: 'reasoning',
    text,
    timing: { startedAt: T - secondsAgoFrom * 1000, completedAt: T - secondsAgoTo * 1000 },
  }),
}

const userMessage = (id, parentId, text, secondsAgo) => ({
  parentId,
  runConfig: {},
  message: {
    id,
    createdAt: new Date(T - secondsAgo * 1000).toISOString(),
    role: 'user',
    content: [part.text(text)],
    attachments: [],
    metadata: { custom: {} },
  },
})

const assistantMessage = (id, parentId, content, secondsAgo) => ({
  parentId,
  runConfig: {},
  message: {
    id,
    role: 'assistant',
    createdAt: new Date(T - secondsAgo * 1000).toISOString(),
    status: { type: 'complete', reason: 'stop' },
    content,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  },
})

const ANSWER_ONE = `结论先说：**不要照搬登录页的字号**。对话界面的字阶只有四个层级，多一个都是噪音。

### 四个层级就够

| 层级 | 字号 | 行高 | 用在哪 |
| --- | --- | --- | --- |
| 正文 | 15px | 1.75 | 回答内容、输入框 |
| 小标题 | 17px | 1.5 | 回答内的分节 |
| 界面文字 | 13px | 1.5 | 按钮、列表、标签 |
| 辅助信息 | 11px | 1.4 | 时间、快捷键、说明 |

再把它们做成 token，组件里就不允许出现 \`text-[13.5px]\` 这种写法：

\`\`\`css
:root {
  --text-body: 0.9375rem;      /* 15px */
  --text-section: 1.0625rem;   /* 17px */
  --text-ui: 0.8125rem;        /* 13px */
  --text-meta: 0.6875rem;      /* 11px */
  --leading-body: 1.75;
}
\`\`\`

> 判断标准：把页面缩到 390 宽再看一遍。如果那时候字号层级还分得清，说明这套刻度是稳的。

另外两件事顺手一起做：行高按层级定死（正文 1.75、界面 1.5、辅助 1.4），字重只留 400 / 500 / 600 三档。`

const ANSWER_TWO = `顺手把行长也收一下。

现在正文宽度是 47rem（752px），15px 字一行能放 **50 个汉字**。中文阅读舒适区是 30–40，超过 45 眼睛就要回头找行首。收到 \`40rem\` 左右比较稳，代价是大屏左右留白变多——但那是好事，留白比塞满更有呼吸感。`

// 侧栏审查需要真实密度：4 条看不出「一屏 12 条」时的节奏，也看不出分组标题
// 是否真的能起到分组作用。注意 session-store 会清理「没有消息的非当前会话」，
// 所以每条都必须带一点内容，否则会被 store 丢弃、侧栏看起来像少了一半。
const EXTRA_SEEDS = [
  ['seed-5', '要不要给代码块上语法高亮', '先算一下首屏预算，再决定要不要引这条依赖。', T - 3 * 3_600_000],
  ['seed-6', '深色下主按钮太抢眼', '那是层级问题，不是配色问题。把它降成中性色就够了。', T - 26 * 3_600_000],
  ['seed-7', '空状态那四张卡片太通用', '稀疏不会因为换了排布就消失，得让每一行自己长出厚度。', T - 50 * 3_600_000],
  ['seed-8', '会话列表的分组规则', '按今天 / 昨天 / 近 7 天 / 更早分，比一串等长时间戳好扫。', T - 100 * 3_600_000],
  ['seed-9', '输入框多行增长的上限', '上限锁在 288px，超过就内部滚动。', T - 140 * 3_600_000],
  ['seed-10', '对比度实测工具', 'oklch 转 sRGB 自己算，不引依赖。', T - 300 * 3_600_000],
  ['seed-11', '导出 Markdown 的结构', 'reasoning 用 details 折叠，不压缩连续空行。', T - 600 * 3_600_000],
  ['seed-12', '首屏拆包值不值', '49 kB 的 markdown 链路移出首屏，换 46 kB。', T - 960 * 3_600_000],
]

const FIXTURE = {
  'lumen.sessions.v1': {
    activeId: SEED_ID,
    sessions: [
      { id: SEED_ID, title: '把对话界面的字号收敛成一套刻度', createdAt: T - 3_600_000, updatedAt: T - 120_000 },
      { id: 'seed-2', title: 'SSE 跨 chunk 截断怎么兜住', createdAt: T - 7_200_000, updatedAt: T - 5_400_000 },
      { id: 'seed-3', title: '流式渲染时视口不要被拽回去', createdAt: T - 90_000_000, updatedAt: T - 86_400_000 },
      { id: 'seed-4', title: '命令面板的键盘路径设计', createdAt: T - 260_000_000, updatedAt: T - 240_000_000 },
      ...EXTRA_SEEDS.map(([id, title, , updatedAt]) => ({
        id,
        title,
        createdAt: updatedAt - 3_600_000,
        updatedAt,
      })),
    ],
  },
  ...Object.fromEntries(
    EXTRA_SEEDS.map(([id, title, answer]) => [
      `lumen.thread.v1:${id}`,
      {
        headId: `${id}-a`,
        messages: [
          userMessage(`${id}-u`, null, title, 3600),
          assistantMessage(`${id}-a`, `${id}-u`, [part.text(answer)], 3540),
        ],
      },
    ]),
  ),
  [`lumen.thread.v1:${SEED_ID}`]: {
    headId: 'a2',
    messages: [
      userMessage('u1', null, '我想给团队的 AI 对话前端定一套字号规范，从哪儿开始收敛？', 300),
      assistantMessage(
        'a1',
        'u1',
        [
          part.reasoning(
            '用户问的是字号规范，但真实需求是「视觉层级缺少刻度」。先给结论，再给可执行的 token，最后补一个自检标准，不要展开排版史。',
            34,
            22,
          ),
          part.text(ANSWER_ONE),
        ],
        280,
      ),
      userMessage('u2', 'a1', '那正文宽度要不要一起改？', 60),
      assistantMessage('a2', 'u2', [part.text(ANSWER_TWO)], 48),
    ],
  },
  // 给另一个会话也放点内容，否则搜关键词只会命中一条，看不到「带摘要的结果行」
  'lumen.thread.v1:seed-2': {
    headId: 'c2',
    messages: [
      userMessage('c1', null, 'SSE 每条消息之间到底怎么分帧？', 5400),
      assistantMessage(
        'c2',
        'c1',
        [
          part.text(
            '网络分片不保证落在空行上。一条 1.2 KB 的 SSE 帧实测会被切成三段，所以不能逐块切分，必须先缓冲再按分隔符切。缓冲区只追加不修改，每次 flush 后把最后一个分隔符之后的部分留下来。',
          ),
        ],
        5300,
      ),
    ],
  },
}

/* ------------------------------------------------------------------ */
/* 排版全覆盖夹具：只给「块内部」的细节用                                */
/* 覆盖 h2-h4 / strong / em / del / 链接 / 行内代码 / kbd / 嵌套列表 /    */
/* 有序列表 / 任务列表 / 引用 / 表格 / 代码块 / hr                       */
/* ------------------------------------------------------------------ */

const ANSWER_TYPO = `## 流式渲染的四个约束

先说结论：**tokens 到达顺序不等于可显示顺序**，中间必须有一层缓冲区。这一层要同时处理跨 chunk 截断、多字节字符，以及 \`[/answer_hero]\` 这类闭合标记。~~逐块 split 的旧方案~~ 已经被证明不可靠。

### 跨 chunk 截断

网络分片不保证落在 \`\\n\\n\` 上。实测一条 1.2 KB 的帧会被切成 3 段：

- 缓冲区只追加，不修改
- 每次 flush 后，把最后一个分隔符之后的部分留下
- 心跳帧直接丢弃
  - 这类帧没有 event 名
  - 也没有 data 体
- 顺序不能乱

### 多字节字符

中文和 emoji 都可能被切断。用 \`TextDecoder\` 的 \`stream: true\` 就够了，*不要*自己按字节拼。快捷键 \`⌘K\` 打开命令面板。

#### 视口不能拽回去

用户上滑看历史时，新 token 到达**不得**改变 scrollTop。三条规则：

1. 只在距离底部小于 48px 时贴底
2. 用户手动上滑后暂停跟随
3. 滚回底部时恢复

| 场景 | 期望行为 | 实现 |
| --- | :---: | --- |
| 用户停在底部 | 跟随新内容 | 贴底 |
| 用户上滑 100px | 完全不动 | 不调用 scroll |
| 滚回底部 | 恢复跟随 | 距离 < 48 时贴底 |

> 判断标准：把页面缩到 390 宽再看一遍。如果那时候字阶层级还分得清，说明这套刻度是稳的。

\`\`\`ts
for await (const event of readSse(body)) {
  if (event.done) break
  buffer += event.delta
}
yield flush() // 最后一次必须再推一次，否则最后 40ms 的 token 会丢
\`\`\`

上线前逐项勾掉：

- [x] 缓冲区按分隔符切分
- [x] 最后一帧不丢
- [ ] 断线重连

---

相关实现见 \`src/lib/stream-sse.ts\`，[设计说明](https://example.com) 里有完整推导。`

const FIXTURE_TYPO = {
  'lumen.sessions.v1': {
    activeId: SEED_ID,
    sessions: [
      { id: SEED_ID, title: '流式渲染的四个约束', createdAt: T - 3_600_000, updatedAt: T - 120_000 },
    ],
  },
  [`lumen.thread.v1:${SEED_ID}`]: {
    headId: 'b2',
    messages: [
      userMessage('b1', null, '讲讲流式渲染要注意什么', 120),
      assistantMessage('b2', 'b1', [part.text(ANSWER_TYPO)], 100),
    ],
  },
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
