// 真站整页截图（1440 / 390）：看列数与留白。
// 用法：node tools/shot_live_page.mjs <baseUrl> <out.png> [宽=1440]
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = process.argv[2]
const OUT = process.argv[3]
const W = Number(process.argv[4] || 1440)
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p)) || 'chrome'
const PORT = 9448
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', '--no-first-run',
  '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${join(tmpdir(), 'shotlivepage')}`, 'about:blank'], { stdio: 'ignore' })
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
await send('Emulation.setDeviceMetricsOverride', { width: W, height: 900, deviceScaleFactor: 1, mobile: W < 500 })
await send('Page.navigate', { url: BASE })
for (let i = 0; i < 80; i++) { await sleep(250); if (await js(`document.querySelectorAll('[data-node-card]').length > 0`)) break }
await sleep(2000)
const cols = await js(`(() => { const c = document.querySelector('[data-node-card]'); return c ? getComputedStyle(c.parentElement).gridTemplateColumns.split(' ').length : 0 })()`)
const size = await js(`(() => { const c = document.querySelector('[data-node-card]'); const r = c.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) })()`)
const h = Math.min(1400, await js('document.documentElement.scrollHeight'))
await send('Emulation.setDeviceMetricsOverride', { width: W, height: h, deviceScaleFactor: 1, mobile: W < 500 })
await sleep(400)
const res = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
writeFileSync(OUT, Buffer.from(res.result.data, 'base64'))
console.log(`列数=${cols} 卡片=${size} -> ${OUT} (${W}x${h})`)
ws.close(); chrome.kill()
