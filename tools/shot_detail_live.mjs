// 真站详情页的信息格裁图（2 倍）：看线上九格的次序与「负载 / 架构（含进程）」。
// 用法：node tools/shot_detail_live.mjs <baseUrl> <out.png>
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = process.argv[2]
const OUT = process.argv[3]
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p)) || 'chrome'
const PORT = 9446
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', '--no-first-run',
  '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${join(tmpdir(), 'shotdetaillive')}`, 'about:blank'], { stdio: 'ignore' })
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BASE })
for (let i = 0; i < 80; i++) { await sleep(250); if (await js(`document.querySelector('[data-node-card] a[href^="/node/"]') !== null`)) break }
await sleep(800)
const href = await js(`document.querySelector('[data-node-card] a[href^="/node/"]')?.getAttribute('href') ?? ''`)
if (!href) { console.error('没拿到卡片链接'); process.exit(2) }
await send('Page.navigate', { url: BASE.replace(/\/$/, '') + href })
for (let i = 0; i < 80; i++) { await sleep(250); if (await js(`document.querySelector('main dl') !== null`)) break }
await sleep(1500)
const box = JSON.parse(await js(`(() => {
  const dl = document.querySelector('main dl'), h2 = document.querySelector('main h2')
  if (!dl || !h2) return 'null'
  const a = h2.getBoundingClientRect(), z = dl.getBoundingClientRect()
  const x = Math.min(a.left, z.left), right = Math.max(a.right, z.right)
  return JSON.stringify({ x: Math.round(x) - 8, y: Math.round(a.top + window.scrollY) - 8, w: Math.round(right - x) + 16, h: Math.round(z.bottom - a.top) + 16 })
})()`))
if (!box) { console.error('没找到信息格'); process.exit(2) }
const res = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 2 } })
writeFileSync(OUT, Buffer.from(res.result.data, 'base64'))
console.log('信息格：', await js(`[...document.querySelectorAll('main dt')].map((d) => d.textContent + '=' + (d.nextElementSibling?.textContent ?? '')).join(' | ')`))
console.log('->', OUT, JSON.stringify(box))
ws.close(); chrome.kill()
