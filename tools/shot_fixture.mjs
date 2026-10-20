// 夹具有卡片的对照裁图（改版前后同一份数据、同一机位）。
// 用法：node tools/shot_fixture.mjs <out-dir> [姓名关键词] [theme=light|dark]
// 产出：<out-dir>/card-<名字>.png（2 倍），以及 <out-dir>/all.png（六张卡整列）。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { tmpdir } from 'node:os'

const OUT = process.argv[2] || 'shots/fixture'
const WANT = process.argv[3] || ''
const THEME = process.argv[4] || 'light'
const W = Number(process.env.SHOT_W || 1440)
const PORT = 5290
const CDP_PORT = 9290
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2' }
const GB = 1024 ** 3

const metrics = (o) => ({
  uptime: 318521, cpu: 3.2, load: [0.08, 0.03, 0.01],
  mem_total: 2 * GB, mem_used: 431800320, swap_total: 0, swap_used: 0,
  disk_total: 40 * GB, disk_used: 9214510720,
  net_rx: 866000, net_tx: 464000, total_rx: 5707805336, total_tx: 5203609923,
  month_rx: 4650258264, month_tx: 4351673970, tcp: 16, udp: 3, procs: 75, ...o,
})
const base = (id, name, o) => ({
  id, name, sort: id, public: true, online: true, country: 'JP', group: '',
  last_seen: Math.floor(Date.now() / 1000) - 3, last_seen_ago: 3,
  metrics: metrics({}), os: 'Debian GNU/Linux 12 (bookworm)', kernel: '6.1.0-53-cloud-amd64', arch: 'x86_64', virt: 'kvm',
  cpu_name: 'AMD EPYC Processor', cpu_cores: 2, mem_total: 2 * GB, swap_total: 0, disk_total: 40 * GB, agent_version: '1.4.0',
  price: 349, currency: 'CNY', billing_cycle: 'yearly', expires_at: '2027-07-21', expires_in: 299,
  traffic_limit: 500 * GB, traffic_mode: 'sum', traffic_reset_day: 21, month_start: '2026-09-21',
  day_rx: 2140585887, day_tx: 2191393745, month_rx: 4650258264, month_tx: 4351673970,
  total_rx: 5707805336, total_tx: 5203609923,
  ...o,
})
const nodes = [
  base(1, '样品一号', { public_remark: '优化线路' }),
  base(2, '掉线二号', { traffic_mode: 'max', online: false, metrics: null, last_seen_ago: 7200, country: 'HK', public_remark: '优化线路', price: 0, expires_at: null, expires_in: null }),
  base(3, '从未接入三号', { online: false, metrics: null, last_seen: 0, last_seen_ago: null, cpu_cores: 0, mem_total: 0, os: '' }),
  base(4, '刚连上四号', { online: true, metrics: null, last_seen: 0, last_seen_ago: null }),
  base(5, '备注五号', { traffic_mode: 'up', public_remark: '测试1, 测试2, 测试1' }),
  base(6, '不限量六号', { traffic_mode: 'down', traffic_limit: 0, price: 0, expires_at: null, expires_in: null }),
]

const server = createServer((req, res) => {
  const path = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname
  const json = (b) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(b)) }
  if (path.startsWith('/api/')) {
    if (path === '/api/me') return json({ authed: true, github: false, public_page: true, site: `http://127.0.0.1:${PORT}`, site_name: '卡片形态校验', history_days: 30, theme: THEME })
    if (path === '/api/nodes') return json({ nodes })
    if (path.endsWith('/config')) return json({})
    if (path.includes('/metrics')) return json({ metrics: [], ping: [], probes: {}, loss: {} })
    return json({})
  }
  const file = join('dist', normalize(path === '/' ? '/index.html' : path).replace(/(\.[/\\])+/, ''))
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' })
    return res.end(readFileSync('dist/index.html'))
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
  res.end(readFileSync(file))
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p)) || 'chrome'
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--remote-allow-origins=*', '--no-first-run', '--disable-gpu',
  '--hide-scrollbars', '--no-proxy-server', `--user-data-dir=${join(tmpdir(), `shotfix${CDP_PORT}`)}`, '--no-sandbox', 'about:blank'], { stdio: 'ignore' })
let wsUrl = null
for (let i = 0; i < 80 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl } catch { /* 等 */ }
  if (!wsUrl) await sleep(250)
}
if (!wsUrl) throw new Error('Chrome 没起来')
const ws = new WebSocket(wsUrl)
await new Promise((r) => { ws.onopen = r })
let id = 0
const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const js = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
const shot = async (box, file) => {
  const res = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 2 } })
  writeFileSync(file, Buffer.from(res.result.data, 'base64'))
  console.log('->', file, JSON.stringify(box))
}

await send('Runtime.enable'); await send('Page.enable')
// 明暗：访客覆盖存在 localStorage 里（index.html 首帧脚本同源），导航前先钉进去
// （不钉的话，同一个 user-data-dir 上一次跑留下的 dark 会带过来）。
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('theme','${THEME}')}catch(e){}` })
await send('Emulation.setDeviceMetricsOverride', { width: W, height: 1800, deviceScaleFactor: 1, mobile: W < 500 })
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` })
for (let i = 0; i < 60; i++) { await sleep(200); if (await js(`document.querySelectorAll('[data-node-card]').length === 6`)) break }
await sleep(1200)
mkdirSync(OUT, { recursive: true })

// 单卡：按名字裁（关键词为空就取第一张）
const list = JSON.parse(await js(`(() => {
  const kw = ${JSON.stringify(WANT)}
  const cards = [...document.querySelectorAll('[data-node-card]')].filter((c) => !kw || c.textContent.includes(kw))
  return JSON.stringify(cards.map((c) => { const r = c.getBoundingClientRect(); return { x: Math.round(r.left) - 6, y: Math.round(r.top) + window.scrollY - 6, w: Math.round(r.width) + 12, h: Math.round(r.height) + 12, name: c.querySelector('h2').textContent } }))
})()`))
for (const [i, b] of list.entries()) {
  await shot({ x: b.x, y: b.y, w: b.w, h: b.h }, join(OUT, `${i === 0 && !WANT ? 'card' : 'card-' + i}.png`))
  console.log('  ', b.name, `${b.w - 12}x${b.h - 12}`)
}
// 整列
const all = JSON.parse(await js(`(() => {
  const cards = [...document.querySelectorAll('[data-node-card]')]
  const grid = cards[0].parentElement.getBoundingClientRect()
  const tops = cards.map((c) => c.getBoundingClientRect().top)
  const bottoms = cards.map((c) => c.getBoundingClientRect().bottom)
  const top = Math.min(...tops), bottom = Math.max(...bottoms)
  // 三列之后要按整个网格的宽度裁，只按第一张卡算会丢右边两列（2026-10-20 修）
  return JSON.stringify({ x: Math.round(grid.left) - 6, y: Math.round(top + window.scrollY) - 6, w: Math.round(grid.width) + 12, h: Math.round(bottom - top) + 12 })
})()`))
await shot(all, join(OUT, 'all.png'))
// 整页（看卡片网格在页面里占多宽、两侧留白多少）
const vp = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
writeFileSync(join(OUT, 'page.png'), Buffer.from(vp.result.data, 'base64'))
console.log('整页 ->', join(OUT, 'page.png'))
ws.close(); chrome.kill(); server.close()
