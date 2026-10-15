// 详情页备注的验收（站点设置 → 节点信息 → 「详情页显示备注」）：
//   · detailRemarks=true：有备注的机器点进详情，那一行小卡片出来（公开备注拆枚、正字面）
//   · detailRemarks=false：整块不渲染（不占位）
//   · 没写备注的机器：两种设置下都不占位
//   · ★ 卡片那一侧一处都不摊（「简约」档口径）：列表页所有卡片的文本里「不出现」备注正字面
//   · 老 hub（没有 `public_remark` 这个 key）：按「这台没写备注」处理，不占位
//
// 匿名视图只下发**公开备注**（私有备注仅登录管理员可见、hub 侧决定，这里不模拟登录态），
//   所以本项目验的是公开备注那一路；私有那几手的拆分逻辑在 notes.test.ts 里由单测守住。
// 用法：cd <repo> && node tools/verify_detail_remarks.mjs（先 npm run build，dist/ 得是新的）
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = Number(process.env.REMARK_PORT || 5261)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

// 三台：① 有公开备注（两枚）② 没写任何备注 ③ 老 hub（连 public_remark 这个 key 都没有）
const node = (id, name, extra) => ({
  id, name, sort: id, public: true, online: true, country: 'JP', group: '东京', last_seen: Math.floor(Date.now() / 1000),
  os: 'Debian GNU/Linux 12 (bookworm)', virt: 'kvm', arch: 'x86_64', cpu_name: 'AMD EPYC Processor', cpu_cores: 1,
  kernel: '6.1.0-53-cloud-amd64', agent_version: '1.0.0', mem_total: 1020526592, swap_total: 0, disk_total: 10485864448,
  traffic_limit: 536870912000, traffic_mode: 'sum', billing_cycle: 'yearly', currency: 'CNY', price: 349,
  expires_at: '2027-07-21', expires_in: 299, month_start: '2026-09-21', traffic_reset_day: 21,
  metrics: { cpu: 3, load: [0, 0, 0], mem_used: 431800320, mem_total: 1020526592, swap_used: 0, swap_total: 0, disk_used: 1524510720, disk_total: 10485864448, net_rx: 867, net_tx: 465, procs: 75, tcp: 16, udp: 3, uptime: 318521 },
  ...extra,
})
const NODES = {
  nodes: [
    node(1, '有备注机', { public_remark: 'MANAGED, 直连优化' }),
    node(2, '干净机', { public_remark: '' }),
    node(3, '老Hub机', {}),   // 没有 public_remark 这个 key
  ],
}
let CONFIG = { detailRemarks: true }

const serveFile = (res, path) => {
  const file = join('dist', normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, ''))
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' })
    return res.end(readFileSync('dist/index.html'))
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
  res.end(readFileSync(file))
}
const server = createServer((req, res) => {
  const path = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname
  if (path.startsWith('/api/')) {
    const body = path === '/api/me' ? { authed: false, github: false, public_page: true, site: `http://127.0.0.1:${PORT}`, site_name: '备注验收', history_days: 30 }
      : path === '/api/nodes' ? NODES
        : path.endsWith('/config') ? CONFIG
          : path.includes('/metrics') ? { metrics: [], probes: [], loss: {} } : {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    return res.end(JSON.stringify(body))
  }
  serveFile(res, path)
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${PORT}`

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p)) || 'chrome'
const dbg = 9995 + Math.floor(Math.random() * 10)
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, '--remote-allow-origins=*', '--no-first-run', '--disable-gpu',
  '--hide-scrollbars', '--window-size=1280,900', '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/kanso-remarks-' + dbg, 'about:blank'], { stdio: 'ignore' })
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
const js = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value
const errors = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params?.exceptionDetails?.text || 'exception')
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push((m.params.args || []).map((a) => a.value).join(' '))
}
await send('Runtime.enable'); await send('Page.enable')

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); if (ok) pass++; else fail++ }

const goto = async (path) => {
  await send('Page.navigate', { url: `${BASE}${path}` })
  for (let i = 0; i < 60; i++) { await sleep(250); if (await js("!!document.querySelector('header')")) break }
  await sleep(900)
}
const detail = async (nid) => {
  await goto(`/node/${nid}`)
  return JSON.parse(await js(`JSON.stringify({
    block: (() => { const el = document.querySelector('[data-remark-block]'); if (!el) return null
      return { text: el.innerText.replace(/\\s+/g, ' ').trim(), h: Math.round(el.getBoundingClientRect().height) } })(),
    chips: [...document.querySelectorAll('[data-remark-block] [data-slot="badge"]')].map((el) => el.innerText.trim()),
  })`))
}
const listChips = async () => {
  await goto('/')
  return JSON.parse(await js(`JSON.stringify({
    cards: [...document.querySelectorAll('[data-node-card]')].map((el) => el.innerText),
    chips: document.querySelectorAll('[data-node-card] [data-remark-block], [data-node-card] [data-slot="badge"]').length,
  })`))
}

console.log('\n详情页备注（夹具：有备注机＝「MANAGED, 直连优化」两枚；干净机 / 老Hub机没有）:')

// ① 开着：有备注的机器 → 两枚、正字面；干净机与老 Hub 机 → 不占位
CONFIG = { detailRemarks: true }
let m = await detail(1)
check('① detailRemarks=true：详情页那行小卡片渲染出来了', !!m.block, JSON.stringify(m))
check('① 备注拆成两枚：MANAGED / 直连优化', m.chips.length === 2 && m.chips[0] === 'MANAGED' && m.chips[1] === '直连优化', JSON.stringify(m.chips))
m = await detail(2)
check('① 没写备注的机器（public_remark 空串）：整块不占位', m.block === null, JSON.stringify(m.block))
m = await detail(3)
check('① 老 hub（没有 public_remark 这个 key）：按没写处理，不占位', m.block === null, JSON.stringify(m.block))

// ② 关着：有备注的机器也不渲染（不占位）
CONFIG = { detailRemarks: false }
m = await detail(1)
check('② detailRemarks=false：有备注也不渲染（不占位）', m.block === null, JSON.stringify(m.block))

// ③ 卡片那一侧一处都不摊（简约档口径）
CONFIG = { detailRemarks: true }
const lt = await listChips()
check('③ 卡片一处不摊：卡片上既没有备注块也没有备注字（开着也一样）', lt.chips === 0 && lt.cards.every((t) => !t.includes('MANAGED') && !t.includes('直连优化')), `块 ${lt.chips} 个；卡片 ${lt.cards.length} 张`)

check('没有控制台异常', errors.length === 0, errors.slice(0, 2).join(' | '))

console.log(`\n${pass} PASS / ${fail} FAIL`)
ws.close(); chrome.kill()
process.exit(fail ? 1 : 0)
