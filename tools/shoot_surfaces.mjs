// 把主题的各个「面」逐个拍下来（明/暗 × 桌面/手机），用于整站风格一致性审计。
// 用法：node shoot_surfaces.mjs <baseUrl> <outDir>
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = process.argv[2] || 'http://127.0.0.1:5182'
const OUT = process.argv[3] || 'shots/surfaces'
mkdirSync(OUT, { recursive: true })
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p)) || 'chrome'

const nodes = await (await fetch(`${BASE}/api/nodes`)).json()
const withRemark = nodes.nodes.find((n) => n.public_remark) || nodes.nodes[0]
const plain = nodes.nodes.find((n) => !n.public_remark && n.metrics) || nodes.nodes[0]
const offline = nodes.nodes.find((n) => !n.metrics)
console.log('节点：备注机', withRemark.name, '| 普通机', plain.name, '| 离线机', offline?.name)

const PORT = 9433
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', '--no-first-run',
  '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${join(tmpdir(), 'surfaces')}`, 'about:blank'], { stdio: 'ignore' })
let wsUrl = null
for (let i = 0; i < 80 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl } catch { }
  if (!wsUrl) await sleep(250)
}
const ws = new WebSocket(wsUrl)
await new Promise((r) => { ws.onopen = r })
let id = 0
const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
const js = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable')

const shot = async (name, url, w, h, dark) => {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 })
  await js(`localStorage.setItem('theme', ${JSON.stringify(dark ? 'dark' : 'light')})`)
  await send('Page.navigate', { url })
  for (let i = 0; i < 60; i++) { await sleep(250); if (await js('!!document.querySelector("main")')) break }
  // 详情页要**等图真的画出来**：Chart 是自绘 SVG（锚点 svg[role=img]，2026-10-15 踩过用 .recharts-surface 的坑），
  // 早截那一帧画布还空着，视觉核对会误判成「图画不出来」。
  if (url.includes('/node/')) {
    for (let i = 0; i < 40; i++) { await sleep(300); if (await js('!!document.querySelector("main svg[role=img]")')) break }
  }
  await sleep(dark ? 1800 : 1500)
  const res = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(res.result.data, 'base64'))
  const geo = await js(`(() => { const m = document.querySelector('main'); const cards = [...document.querySelectorAll('[data-node-card],[data-slot=card]')]; return JSON.stringify({ mainW: m ? Math.round(m.getBoundingClientRect().width) : 0, cards: cards.length, card0: cards[0] ? [Math.round(cards[0].getBoundingClientRect().width), Math.round(cards[0].getBoundingClientRect().height)] : null, overflowX: document.documentElement.scrollWidth > window.innerWidth }) })()`)
  console.log(`  ${name}  ${w}×${h} ${dark ? '暗' : '亮'}  ${geo}`)
}

await shot('list-1440-light', `${BASE}/`, 1440, 900, false)
await shot('list-390-light', `${BASE}/`, 390, 844, false)
await shot('list-1440-dark', `${BASE}/`, 1440, 900, true)
await shot('detail-1440-light', `${BASE}/node/${plain.id}`, 1440, 980, false)
await shot('detail-390-light', `${BASE}/node/${plain.id}`, 390, 1100, false)
await shot('detail-1440-dark', `${BASE}/node/${plain.id}`, 1440, 980, true)
await shot('detail-remark-1440-light', `${BASE}/node/${withRemark.id}`, 1440, 980, false)
if (offline) await shot('detail-offline-1440-light', `${BASE}/node/${offline.id}`, 1440, 980, false)

ws.close(); chrome.kill()
console.log('八张就位 ->', OUT)
