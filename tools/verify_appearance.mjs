// 明暗的验收（1.6.0 起没有任何主题设置，页面固定「跟访客的系统走」）：
//   · 默认：跟访客系统的 prefers-color-scheme 走（两档各验一次）
//   · 访客自己的选择优先：localStorage 里记着 theme=dark / light 时压过系统
//   · 顶栏那枚图标：点一下切到与当前相反的一档并记下；点成与系统一致时删掉记录
//   · theme-color（手机浏览器那一圈）：App 起来后只剩一份没有 media 的，值 == 页面实际底色；
//     访客的覆盖与系统相反时也跟**页面**走（不是系统）
//   · 进度条填色：亮 / 暗两套各断一遍（清新的绿 + 有效对比 2–8:1）
//   · 暗色：卡片/底、卡缘线/底分得开（2026-10-17 口径；防「卡面调回去」的回退）
//
// 用法：node tools/verify_appearance.mjs（先 npm run build，dist/ 得是新的）
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = Number(process.env.APPEAR_PORT || 5203)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }
const NODES = { nodes: [{ id: 'a', name: '演示节点', country: 'JP', group: '亚太', os: 'Debian 12', cpu_name: 'EPYC', cpu_cores: 2, mem_total: 2147483648, disk_total: 42949672960, virt: 'kvm', arch: 'x86_64', last_seen: 1, public: true, online: true }] }

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const path = url.pathname
  if (path.startsWith('/api/')) {
    const body = path === '/api/me' ? { authed: false, github: false, public_page: true, site: `http://127.0.0.1:${PORT}`, site_name: '外观验收' }
      : path === '/api/nodes' ? NODES : {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    return res.end(JSON.stringify(body))
  }
  const file = join('dist', normalize(path === '/' ? '/index.html' : path).replace(/^(\.[/\\])+/, ''))
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(200, { 'Content-Type': TYPES['.html'] })
    return res.end(readFileSync('dist/index.html'))
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
  res.end(readFileSync(file))
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${PORT}`

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p)) || 'chrome'
const dbg = 9995 + Math.floor(Math.random() * 10)
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, '--remote-allow-origins=*', '--no-first-run', '--disable-gpu',
  '--hide-scrollbars', '--window-size=1280,900', '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/appearance-' + dbg, 'about:blank'], { stdio: 'ignore' })
let wsUrl = null
for (let i = 0; i < 100 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl } catch { }
  if (!wsUrl) await sleep(300)
}
if (!wsUrl) throw new Error('Chrome 起不来')
let id = 0
const pending = new Map()
const ws = new WebSocket(wsUrl)
await new Promise((r) => { ws.onopen = r })
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const js = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
  // 页面里那段表达式一旦抛异常，CDP 不会报错、只会少一个 value —— 之前踩过（模板串里正则被吃成 /d+/），
  // 结果是一句没头没脑的 "undefined is not valid JSON"。这里把异常原样打出来。
  if (r.result?.exceptionDetails) console.error('页面探测抛异常：', (r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails)).slice(0, 800))
  return r.result?.result?.value
}
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
await send('Runtime.enable'); await send('Page.enable')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); if (ok) pass++; else fail++ }

/** 读当前页面的明暗、访客记录、theme-color、卡片进度条与卡面/卡缘线的合成有效色。 */
async function probe() {
  return JSON.parse(await js(`(() => {
    // token 是 oklch()，正则抠数字会得到垃圾，颜色一律经 canvas 合成（卡片底还常常是透明的，
    // 先合成到页面底上，才是访客看到的那一层）。
    const paint = (under, top) => {
      const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d')
      if (under) { x.fillStyle = under; x.fillRect(0, 0, 1, 1) }
      if (top) { x.fillStyle = top; x.fillRect(0, 0, 1, 1) }
      const d = x.getImageData(0, 0, 1, 1).data
      return { rgb: 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')', alpha: +(d[3] / 255).toFixed(3) }
    }
    const bodyRaw = getComputedStyle(document.body).backgroundColor
    return JSON.stringify({
    dark: document.documentElement.classList.contains('dark'),
    ls: (() => { const o = {}; try { for (let i = 0; i < localStorage.length; i += 1) { const k = localStorage.key(i); o[k] = localStorage.getItem(k) } } catch {} return o })(),
    // theme-color（手机浏览器那一圈）：App 起来之后应当只剩一份没有 media 的，值等于页面实际底色。
    themeColors: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => ({ content: m.content, media: m.getAttribute('media') })),
    // 进度条填色：合成后取「绿 + 有效对比」。
    meter: (() => {
      const card = [...document.querySelectorAll('[data-slot=card]')].find((c) => c.querySelector('div.overflow-hidden.rounded-full'))
      if (!card) return null
      const bar = card.querySelector('div.overflow-hidden.rounded-full')
      const fill = bar.firstElementChild
      if (!fill) return null
      const cardEff = paint(bodyRaw, getComputedStyle(card).backgroundColor).rgb
      const text = card.querySelector('h3')
      const fillRaw = getComputedStyle(fill).backgroundColor
      const fillRgb = paint(cardEff, fillRaw).rgb
      // 别在这段（模板串）里写正则：模板转义会吃掉一层反斜杠，匹配不上还是小事，
      // 真踩过的是匹配成 null 再 .map() —— 整个探测抛异常、CDP 只回一个 undefined。
      const [fr, fg, fb] = fillRgb.slice(4, -1).split(',').map(Number)
      return {
        // 「绿」＝ g 明显高于 r / b；ods 是那份 2026-10-15 定的口径（细 + 绿）。
        green: fg > fr + 30 && fg > fb + 20,
        alpha: paint(null, fillRaw).alpha,
        fill: fillRgb,
        text: text ? paint(cardEff, getComputedStyle(text).color).rgb : null,
        card: cardEff,
      }
    })(),
    // 卡面与卡缘线（2026-10-17「暗色下卡片与页面底分得开」那条判据用）：同样取**合成后**的有效色。
    surface: (() => {
      const card = document.querySelector('main [data-node-card], [data-slot=card]')
      if (!card) return null
      const cardEff = paint(bodyRaw, getComputedStyle(card).backgroundColor).rgb
      return { card: cardEff, line: paint(cardEff, getComputedStyle(card).borderTopColor).rgb }
    })(),
    bodyBg: (() => {
      const c = document.createElement('canvas'); c.width = c.height = 1
      const x = c.getContext('2d'); if (!x) return null
      x.fillStyle = getComputedStyle(document.body).backgroundColor
      x.fillRect(0, 0, 1, 1)
      const d = x.getImageData(0, 0, 1, 1).data
      return 'rgb(' + d[0] + ', ' + d[1] + ', ' + d[2] + ')'
    })(),
    })
  })()`))
}

async function load({ systemDark = false, visitor = null }) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: systemDark ? 'dark' : 'light' }] })
  await send('Page.navigate', { url: `${BASE}/` })
  for (let i = 0; i < 60; i++) { await sleep(200); if (await js('!!document.querySelector("header")')) break }
  await sleep(1200)
  // ★ 访客那一项要**显式清掉**才算「没记过」：同一个 profile 里上一次场景写下的 theme 会留着，
  //   不清理就会把「跟着系统走」验成一个带残留值的状态（看着通过、其实没验到）。
  if (visitor === null) await js("localStorage.removeItem('theme')")
  else if (visitor !== undefined) await js(`localStorage.setItem('theme', ${JSON.stringify(visitor)})`)
  if (visitor !== undefined) { await send('Page.reload'); await sleep(1500) }
  return probe()
}

console.log('=== 默认：跟访客系统的明暗走 ===')
let s = await load({ systemDark: true })
check('系统暗 → 页面暗', s.dark === true, `dark=${s.dark}`)
s = await load({ systemDark: false })
check('系统亮 → 页面亮', s.dark === false, `dark=${s.dark}`)

console.log('\n=== 首帧明暗：暗色访客不该先闪一屏亮色（2026-10-18）===')
/**
 * 判据：从 **document 起点**采样 body 的底色变化 —— 修复前（index.html 里没有那段内联脚本）
 * 慢速网络下会先记到一帧亮色（实测亮屏 4.5 秒），修好后**第一条采样就必须已经是暗色**。
 * 采样器用 addScriptToEvaluateOnNewDocument 注入，跑在页面任何脚本之前。
 */
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
window.__bgLog = [];
(function tick() {
  if (document.body) {
    var bg = getComputedStyle(document.body).backgroundColor;
    var dark = document.documentElement.classList.contains('dark');
    var last = window.__bgLog[window.__bgLog.length - 1];
    if (!last || last.bg !== bg || last.dark !== dark) window.__bgLog.push({ t: Math.round(performance.now()), bg: bg, dark: dark });
  }
  if (performance.now() < 8000) requestAnimationFrame(tick);
})();
`,
})
const bgOf = async () => JSON.parse(await js('JSON.stringify(window.__bgLog || [])'))
s = await load({ systemDark: true })
let bg = await bgOf()
check('★ 系统暗：第一帧就已经是暗色（没有先闪亮色）', bg.length > 0 && bg[0].dark === true, JSON.stringify(bg.slice(0, 3)))
s = await load({ systemDark: false, visitor: 'dark' })
bg = await bgOf()
check('★ 系统亮、访客记着暗：第一帧就已经是暗色', bg.length > 0 && bg[0].dark === true, JSON.stringify(bg.slice(0, 3)))
s = await load({ systemDark: true, visitor: 'light' })
bg = await bgOf()
check('★ 系统暗、访客记着亮：第一帧就是亮色（也不许反向闪）', bg.length > 0 && bg[0].dark === false, JSON.stringify(bg.slice(0, 3)))

console.log('\n=== 访客自己的选择优先 ===')
s = await load({ systemDark: false, visitor: 'dark' })
check('系统亮、访客记着暗 → 页面暗', s.dark === true, `dark=${s.dark}`)
s = await load({ systemDark: true, visitor: 'light' })
check('系统暗、访客记着亮 → 页面亮', s.dark === false, `dark=${s.dark}`)
s = await load({ systemDark: false, visitor: null })
check('访客没记过 → 回到跟系统（亮）', s.dark === false && !('theme' in s.ls), `dark=${s.dark} ls=${JSON.stringify(s.ls)}`)

console.log('\n=== 顶栏那枚图标：点一下切换并记下；点回与系统一致＝删记录 ===')
s = await load({ systemDark: false, visitor: null })
await js(`document.querySelector('button[title="切换主题"]')?.click()`)
await sleep(400)
let a = await probe()
check('点一下（系统亮）→ 页面切暗、记录 theme=dark', a.dark === true && a.ls.theme === 'dark', `dark=${a.dark} ls=${JSON.stringify(a.ls)}`)
await js(`document.querySelector('button[title="切换主题"]')?.click()`)
await sleep(400)
a = await probe()
check('再点一下（回到与系统一致）→ 记录被删、页面变亮', a.dark === false && !('theme' in a.ls), `dark=${a.dark} ls=${JSON.stringify(a.ls)}`)

console.log('\n=== theme-color（手机浏览器那一圈）===')
// 判据：跟着**页面实际用的**档走（不是系统的）—— 访客的覆盖与系统相反时，只有这一步才对得上；
// index.html 那两份带 media 的静态兜底应当被摘掉。
const LIGHT_BG = 'rgb(250, 250, 249)'  // stone-50（2026-10-15 换暖石色系）
const tcOf = (x) => ({ live: (x.themeColors || []).filter((m) => !m.media), all: x.themeColors, bg: x.bodyBg })
s = await load({ systemDark: true })
let tc = tcOf(s)
check('theme-color：只剩一份（App 起来后把 index.html 那两份静态兜底摘掉了）', tc.live.length === 1, JSON.stringify(tc.all))
check('theme-color：系统暗 → 取页面的暗底色', tc.live[0]?.content === tc.bg && tc.bg !== LIGHT_BG, `meta=${tc.live[0]?.content} 底色=${tc.bg}`)
s = await load({ systemDark: false })
tc = tcOf(s)
check('theme-color：系统亮 → 取页面的亮底色', tc.live[0]?.content === tc.bg && tc.bg === LIGHT_BG, `meta=${tc.live[0]?.content} 底色=${tc.bg}`)
s = await load({ systemDark: true, visitor: 'light' })
tc = tcOf(s)
check('theme-color：访客覆盖成亮（与系统相反）→ 跟着页面的亮底色走', tc.live[0]?.content === tc.bg && tc.bg === LIGHT_BG, `meta=${tc.live[0]?.content} 底色=${tc.bg}`)

console.log('\n=== 进度条填色（亮 / 暗各断一遍）===')
/**
 * 进度条填色的判据。2026-10-08 站长反馈「进度条有些突兀」判的是「填色＝正文本色太重」；
 * 2026-10-15 起口径换成参考站那套：**细一档（3px）+ 清新的绿（--ok）**，同样不压人、还更透气。
 * 判据因此从「半透明前景色」改成「绿、且合成后的有效对比度落在 2–8:1」：
 * 下限 2 是**点缀型图形**的口径（条只有 3px、读数就在它正上方，值不靠它读；WCAG 的非文本
 * 3:1 针对「理解内容所必需」的图形，这一根不是），8:1 封顶（必须明显轻于站名）。
 * 暗色单独断一遍——同一个 token 在暗底上的有效对比度与亮色不是一回事。
 */
const lumOf = (s) => {
  const [r, g, b] = s.match(/\d+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => { const [x, y] = [lumOf(a), lumOf(b)].sort((m, n) => n - m); return +((x + 0.05) / (y + 0.05)).toFixed(2) }
s = await load({ systemDark: false })
check('亮色：进度条是清新的绿，且有效对比 2–8:1、明显轻于站名',
  s.meter && s.meter.green && contrast(s.meter.fill, s.meter.card) >= 2 && contrast(s.meter.fill, s.meter.card) <= 8 &&
  contrast(s.meter.fill, s.meter.card) < contrast(s.meter.text, s.meter.card),
  JSON.stringify(s.meter) + ` 填色 ${s.meter && contrast(s.meter.fill, s.meter.card)}:1 / 站名 ${s.meter && contrast(s.meter.text, s.meter.card)}:1`)
s = await load({ systemDark: true })
check('暗色：同上（暗底上的有效对比度与亮色不是一回事，单独断）',
  s.meter && s.meter.green && contrast(s.meter.fill, s.meter.card) >= 2 && contrast(s.meter.fill, s.meter.card) <= 8 &&
  contrast(s.meter.fill, s.meter.card) < contrast(s.meter.text, s.meter.card),
  JSON.stringify(s.meter) + ` 填色 ${s.meter && contrast(s.meter.fill, s.meter.card)}:1 / 站名 ${s.meter && contrast(s.meter.text, s.meter.card)}:1`)

console.log('\n=== 暗色：卡片与页面底分得开（2026-10-17 口径）===')
/**
 * 「暗色下卡片与页面底区分不明显」的反馈后的口径：卡片面 --card 0.21→0.23、描边 13%→15%。
 * 判据只针对暗色（亮色那套没动）：卡/底、卡缘线/底都要立得住，又都不许过界 ——
 *   · 卡片/底 合成对比 ≥ 1.14（抬升前 1.10 就是「分不开」的那一档；现在实测 1.16），封顶 1.35
 *     （再往上卡片开始"浮灰"）；
 *   · 卡缘线/底 ≥ 1.62（抬升前 1.49；卡面 0.23 配旧 13% 描边只有 1.60 —— 两档必须一起抬，
 *     现在 1.67），封顶 2.2（线再亮就变成"画框"）。
 */
s = await load({ systemDark: true })
const sf = s.surface
check('暗色：卡/底 ≥ 1.14 且 ≤ 1.35、卡缘线/底 ≥ 1.62 且 ≤ 2.2',
  !!(sf && contrast(sf.card, s.bodyBg) >= 1.14 && contrast(sf.card, s.bodyBg) <= 1.35 &&
    contrast(sf.line, s.bodyBg) >= 1.62 && contrast(sf.line, s.bodyBg) <= 2.2),
  sf ? `卡/底 ${contrast(sf.card, s.bodyBg)} 线/底 ${contrast(sf.line, s.bodyBg)}（卡 ${sf.card} 线 ${sf.line} 底 ${s.bodyBg}）` : '没找到卡片')

console.log(`\n结果: PASS ${pass} / FAIL ${fail}`)
ws.close(); chrome.kill(); server.close()
process.exit(fail ? 1 : 0)
