// 稀疏 / 形状漂移载荷的韧性验收（2026-10-18 一轮审读后的护栏）。四条主线：
//
//   A. **顶层规格缺失、metrics 齐全**（cpu_cores / mem_total / disk_total / 累计 / 重置日都不给）：
//      卡片必须照常画读数区（不许写「还没有接入」）、规格与累计取**实时读数**、
//      也没有任何 undefined / NaN 直插（原来那版会印「累计 0 B」「流量重置：每月 undefined 日」）。
//   B. **形状漂移**（country / public_remark / remark 都是数字）：归一成「没写」，页面照常渲染，
//      不许进错误边界（原来那几个字段一坏就是渲染期 TypeError、整页「页面渲染出错」）。
//   C. **详情页容量取实时读数优先**：内存 / 硬盘的事实与 Y 轴轴顶来自 metrics —— 顶层是 0 时
//      标题写「内存 · 2.00 GB」、刻度 0 B/512 MB/1 GB/1.5 GB/2 GB，而不是 0 B + 一条被裁掉的线。
//   D. **历史接口 503 → 错误面板 + 「重试」**：点一下必须真的重发（服务端计数 ≥2）并画出图 ——
//      503 是 hub 并发上限的预期失败，不能只给一句错误话术、连重试入口都没有。
//   E. **从未接入那台**：详情页不摆「0 B / 0 B」「↓ 0 B」这类空规格格。
//
// 用法：cd <repo> && node tools/verify_sparse_payload.mjs（先 npm run build，dist/ 得是新的）
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = Number(process.env.SPARSE_PORT || 5231)
const CDP_PORT = PORT + 4400
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2' }
const GB = 1024 ** 3, MB = 1024 ** 2
const now = Math.floor(Date.now() / 1000)

// 完整读数：核心十二项 + 可选五项都在。
const metrics = (o = {}) => ({
  uptime: 318521, cpu: 31.2, load: [0.4, 0.3, 0.2],
  mem_total: 2 * GB, mem_used: 700 * MB, swap_total: 0, swap_used: 0,
  disk_total: 40 * GB, disk_used: 12 * GB,
  net_rx: 866000, net_tx: 464000, total_rx: 1000, total_tx: 2000,
  month_rx: 500, month_tx: 600, tcp: 51, udp: 12, procs: 75, ...o,
})

const nodes = [
  // ① 顶层规格 / 累计 / 重置日全缺（或为 0），metrics 齐全。
  {
    id: 1, name: '稀疏一号', sort: 1, public: true, online: true, country: 'JP',
    last_seen: now - 3, last_seen_ago: 3, metrics: metrics(),
    os: 'Debian GNU/Linux 12 (bookworm)', kernel: '6.1.0-53-cloud-amd64', arch: 'x86_64', virt: 'kvm',
    cpu_name: 'AMD EPYC Processor',                    // ★没有 cpu_cores
    mem_total: 0, swap_total: 0, disk_total: 0,        // ★顶层容量是 0
    agent_version: '1.4.0', price: 0, currency: 'CNY', billing_cycle: 'yearly', expires_at: null, expires_in: null,
    traffic_limit: 500 * GB, traffic_mode: 'sum',      // ★没有 traffic_reset_day
    month_start: '', total_rx: 0, total_tx: 0, month_rx: 0, month_tx: 0, day_rx: 0, day_tx: 0,
  },
  // ② 形状漂移：country / 两个备注字段都是数字。
  {
    id: 2, name: '漂移二号', sort: 2, public: true, online: true,
    country: 42, public_remark: 7, remark: 8,
    last_seen: now - 3, last_seen_ago: 3, metrics: metrics({ cpu: 12.5 }),
    os: 'Debian', kernel: '6.1.0', arch: 'x86_64', virt: 'kvm', cpu_name: 'AMD EPYC', cpu_cores: 2,
    mem_total: 2 * GB, swap_total: 0, disk_total: 40 * GB, agent_version: '', price: 0, currency: 'CNY',
    billing_cycle: 'monthly', expires_at: null, expires_in: null,
    traffic_limit: 0, traffic_mode: 'sum', traffic_reset_day: 1,
    month_start: '', total_rx: 0, total_tx: 0, month_rx: 0, month_tx: 0, day_rx: 0, day_tx: 0,
  },
  // ③ 从未接入：详情页不许摆空规格格。
  {
    id: 3, name: '未接入三号', sort: 3, public: true, online: false, country: 'HK',
    last_seen: 0, last_seen_ago: null, metrics: null,
    os: '', kernel: '', arch: '', virt: 'none', cpu_name: '', cpu_cores: 0,
    mem_total: 0, swap_total: 0, disk_total: 0, agent_version: '', price: 0, currency: 'CNY',
    billing_cycle: 'monthly', expires_at: null, expires_in: null,
    traffic_limit: 0, traffic_mode: 'sum', traffic_reset_day: 1,
    month_start: '', total_rx: 0, total_tx: 0, month_rx: 0, month_tx: 0, day_rx: 0, day_tx: 0,
  },
]

// 历史指标：240 点、6 分钟一桶（一天）。内存 ~700MB —— 顶层是 0 时，只有取 metrics 才画得出来。
const HISTORY = Array.from({ length: 240 }, (_, i) => ({
  ts: now - (240 - i) * 360,
  cpu: 24 + 14 * Math.sin(i / 9),
  mem_used: 700 * MB + 60 * MB * Math.sin(i / 11),
  disk_used: 12 * GB + i * MB,
  net_rx: 900000 + 300000 * Math.sin(i / 7),
  net_tx: 460000 + 120000 * Math.sin(i / 5),
  tcp: 48 + (i % 9),
  udp: 10 + (i % 4),
}))

// 历史接口的调用计数：第一条 /node/1/metrics 故意回 503（验「重试」），之后正常。
let metricCalls = 0
const stats = { nodes: 0 }

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const path = url.pathname
  const json = (b) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(b)) }
  if (path.startsWith('/api/')) {
    if (path === '/api/me') return json({ authed: false, github: false, public_page: true, site: `http://127.0.0.1:${PORT}`, site_name: '稀疏载荷验收', history_days: 30 })
    if (path === '/api/nodes') { stats.nodes += 1; return json({ nodes }) }
    if (/^\/api\/nodes\/\d+\/metrics$/.test(path)) {
      const id = Number(path.split('/')[3])
      if (id === 1) {
        metricCalls += 1
        if (metricCalls === 1) {
          res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
          return res.end('history busy')
        }
        const series = url.searchParams.get('series') || 'metrics'
        return json(series === 'ping' ? { metrics: [], ping: [], probes: {}, loss: {} } : { metrics: HISTORY, ping: [], probes: {}, loss: {} })
      }
      return json({ metrics: [], ping: [], probes: {}, loss: {} })
    }
    return json({})
  }
  const file = join('dist', normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, ''))
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(200, { 'Content-Type': TYPES['.html'] })
    return res.end(readFileSync('dist/index.html'))
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
  res.end(readFileSync(file))
})
// WS 一律 503：让列表走轮询兜底，省得这条用例还要去管推送（D 组那个场景在 verify_hub141 里）。
server.on('upgrade', (req, socket) => {
  socket.write('HTTP/1.1 503 Service Unavailable\r\ncontent-length: 0\r\nconnection: close\r\n\r\n')
  socket.destroy()
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${PORT}`

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p)) || 'chrome'
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--remote-allow-origins=*', '--no-first-run', '--disable-gpu',
  '--hide-scrollbars', '--no-proxy-server', `--user-data-dir=${join(tmpdir(), `sparse${CDP_PORT}`)}`, '--no-sandbox', 'about:blank'], { stdio: 'ignore' })
let wsUrl = null
for (let i = 0; i < 80 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl } catch { /* 等它起来 */ }
  if (!wsUrl) await sleep(250)
}
if (!wsUrl) throw new Error('Chrome 没起来')
const ws = new WebSocket(wsUrl)
await new Promise((r) => { ws.onopen = r })
let id = 0
const pending = new Map()
const errors = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? 'exception')
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args?.map((a) => a.value).join(' '))
}
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const js = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); if (ok) pass++; else fail++ }
const waitFor = async (expr, ms = 15000) => {
  for (let i = 0; i < Math.ceil(ms / 150); i++) { if (await js(expr)) return true; await sleep(150) }
  return false
}

/* ---------------------------------------------------------------- A. 列表：稀疏 + 漂移两台的卡片 */
console.log('=== A、顶层规格缺失 / 形状漂移：卡片照常画，且没有 undefined ===')
await send('Page.navigate', { url: `${BASE}/` })
await waitFor(`document.querySelectorAll('[data-node-card]').length === 3`, 15000)
await sleep(600)
const cards = JSON.parse(await js(`(() => {
  return JSON.stringify([...document.querySelectorAll('[data-node-card]')].map((c) => ({
    id: c.getAttribute('data-node-card'),
    status: c.getAttribute('data-status'),
    // 2026-10-20：整卡可点改成语义链接（role=button 的后代是 presentational，
    // 会把四行读数从可访问树里盖掉）。名字挂在铺满卡片的那枚 <a> 上。
    aria: c.querySelector('a[href^="/node/"]')?.getAttribute('aria-label') ?? null,
    link: !!c.querySelector('a[href^="/node/"]'),
    role: c.getAttribute('role'),
    text: c.innerText,
    metrics: !!c.querySelector('[data-metrics]'),
    badges: [...c.querySelectorAll('[data-slot=badge]')].map((b) => b.textContent.trim()),
  })))
})()`) ?? '[]')
const byId = (n) => cards.find((c) => c.id === String(n))
const one = byId(1), drifted = byId(2), never = byId(3)
check('三张卡片都在（页面没进错误边界）', cards.length === 3, cards.map((c) => `${c.id}:${c.aria}`).join(' / '))
check('★ 顶层规格缺失那台：照常画读数区（不写「还没有接入」）', one?.metrics === true && !/还没有接入/.test(one.text), `metrics=${one?.metrics}`)
check('★ 规格 / 累计取实时读数：累计 1000 B（rx）/ 1.95 KB（tx）、已用 1.07 KB', /累计 1000 B/.test(one?.text ?? '') && /累计 1\.95 KB/.test(one?.text ?? '') && /1\.07 KB \/ 500 GB/.test(one?.text ?? ''), one?.text?.replace(/\n/g, ' | ').slice(0, 160))
check('★ 重置日缺失写「—」而不是「每月 undefined 日」', /流量重置：—/.test(one?.text ?? ''), one?.text?.match(/流量重置：\S+/)?.[0])
check('★ 卡片文本里没有 undefined / NaN', !/undefined|NaN/.test(one?.text ?? ''), '')
check('漂移那台：country 归一成「没写」，没有旗子也没有 42 徽标', drifted?.badges.length === 0, JSON.stringify(drifted?.badges))
check('漂移那台：备注是数字＝没写，一枚小卡片都不摊', !/备注/.test(drifted?.text ?? '') && drifted?.badges.length === 0, '')
check('★ 读屏名只在「接入过 + 掉线」那档补「已离线」：在线两台＝纯名字', one?.aria === '稀疏一号' && drifted?.aria === '漂移二号', `${one?.aria} / ${drifted?.aria}`)
check('★ 从未接入那台读屏名是纯名字（不该念「已离线」）', never?.aria === '未接入三号', String(never?.aria))
check('★ 卡根不再是 role=button（后代会 presentational、吞掉读数），点击语义交给标题里的链接',
  cards.every((c) => c.link && c.role === null), JSON.stringify(cards.map((c) => `${c.link}/${c.role}`)))
check('从未接入那台：仍是那行说明、没有读数区', /还没有接入/.test(never?.text ?? '') && never?.metrics === false, '')
check('A 组控制台无异常', errors.length === 0, errors.slice(0, 2).join(' | ').slice(0, 200))

/* ---------------------------------------------------------------- B. 详情：容量取实时读数 + 重试 */
console.log('\n=== B、详情页：历史 503 → 错误面板 + 重试；容量 / 轴顶取 metrics ===')
await send('Page.navigate', { url: `${BASE}/node/1` })
const failedSeen = await waitFor(`document.body.innerText.includes('读取历史数据失败')`, 15000)
check('★ 第一次历史请求被 503 拒掉：给出错误面板', failedSeen, `metricCalls=${metricCalls}`)
const retryBtn = await js(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '重试')`)
check('★ 错误面板里有「重试」按钮（不是只有一句错误话术）', retryBtn === true, String(retryBtn))
const facts = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('dl > div')].map((d) => d.innerText.replace(/\\n/g, ' / ')))`) ?? '[]')
const factText = facts.join(' ｜ ')
check('★ 内存 / 硬盘取实时读数（2.00 GB / 40.0 GB，不是 0 B / 0 B）', /2\.00 GB \/ 40\.0 GB/.test(factText), factText)
check('★ CPU 格只有型号、没有「× undefined」', facts.some((f) => /^CPU \/ AMD EPYC$/.test(f)), facts.find((f) => f.startsWith('CPU')))
check('TCP / UDP 连接那格取实时读数（51 / 12）', /51 \/ 12/.test(factText), '')
check('详情页文本里没有 undefined / NaN', !/undefined|NaN/.test(await js('document.querySelector("main").innerText') ?? ''), '')
const beforeRetry = metricCalls
await js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '重试'); if (b) b.click(); return !!b })()`)
const chartsOk = await waitFor(`document.querySelectorAll('[data-chart]').length >= 5`, 20000)
check('★ 点「重试」真的重发了请求（服务端计数 +1）', metricCalls === beforeRetry + 1, `${beforeRetry} → ${metricCalls}`)
check('★ 重试后画出五张图、错误面板收掉', chartsOk && !(await js(`document.body.innerText.includes('读取历史数据失败')`)), `charts=${await js(`document.querySelectorAll('[data-chart]').length`)}`)
const mem = JSON.parse(await js(`(() => {
  const h = [...document.querySelectorAll('h3')].find((x) => /^内存/.test(x.textContent || ''))
  const svg = h?.parentElement?.querySelector('svg')
  return JSON.stringify({
    title: h?.textContent ?? null,
    ticks: svg ? [...svg.querySelectorAll('text')].filter((t) => t.getAttribute('text-anchor') === 'end').map((t) => t.textContent) : null,
  })
})()`) ?? '{}')
check('★ 内存面板标题 = metrics 的总量（2.00 GB）', mem.title === '内存 · 2.00 GB', String(mem.title))
check('★ 内存 Y 轴轴顶来自 metrics：0 B / 512 MB / 1 GB / 1.5 GB / 2 GB（不是 0 B×4 + 1 B）',
  JSON.stringify(mem.ticks) === JSON.stringify(['0 B', '512 MB', '1 GB', '1.5 GB', '2 GB']), JSON.stringify(mem.ticks))
check('B 组控制台无异常', errors.length === 0, errors.slice(0, 2).join(' | ').slice(0, 200))

/* ---------------------------------------------------------------- C. 从未接入：详情不摆空规格格 */
console.log('\n=== C、从未接入那台：详情页不摆「0 B / 0 B」这类空规格格 ===')
await send('Page.navigate', { url: `${BASE}/node/3` })
await waitFor(`document.querySelector('main dl') !== null`, 15000)
await sleep(500)
const neverText = (await js(`document.querySelector('main').innerText`)) ?? ''
check('★ 不摆「0 B / 0 B」', !/0 B \/ 0 B/.test(neverText), '')
check('★ 不摆「↓ 0 B」', !/↓ 0 B/.test(neverText), '')
check('★ 不摆「0 核」（CPU 格整格隐身）', !/0 核|undefined/.test(neverText), '')
check('在线时间那格仍是「未接入」', /未接入/.test(neverText), '')
check('C 组控制台无异常', errors.length === 0, errors.slice(0, 2).join(' | ').slice(0, 200))

console.log(`\n结果: PASS ${pass} / FAIL ${fail}`)
ws.close(); chrome.kill(); server.close()
process.exit(fail ? 1 : 0)
