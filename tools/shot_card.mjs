// 裁一张卡片（2 倍）——卡片级改动的对照取证用。
// 用法：node tools/shot_card.mjs <baseUrl> <out.png> [第几张=0] [可选：节点名关键词]
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = process.argv[2]
const OUT = process.argv[3]
const IDX = Number(process.argv[4] || 0)
const NAME = process.argv[5] || ''
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p)) || 'chrome'
const PORT = 9445
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', '--no-first-run',
  '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${join(tmpdir(), 'shotcard')}`, 'about:blank'], { stdio: 'ignore' })
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
const js = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) console.error('页面抛异常：', (r.result.exceptionDetails.exception?.description || '').slice(0, 300))
  return r.result?.result?.value
}
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BASE })
for (let i = 0; i < 60; i++) { await sleep(250); if (await js("document.querySelectorAll('[data-node-card]').length > 0")) break }
await sleep(2000)
const box = JSON.parse(await js(`(() => {
  let cards = [...document.querySelectorAll('[data-node-card]')]
  const kw = ${JSON.stringify(NAME)}
  if (kw) cards = cards.filter((c) => c.textContent.includes(kw))
  const el = cards[${IDX}]
  if (!el) return 'null'
  const r = el.getBoundingClientRect()
  el.scrollIntoView({ block: 'center' })
  const r2 = el.getBoundingClientRect()
  return JSON.stringify({ x: Math.round(r2.left) - 4, y: Math.round(r2.top) - 4, w: Math.round(r2.width) + 8, h: Math.round(r2.height) + 8 })
})()`))
console.log('盒子:', JSON.stringify(box))
if (!box || Number.isNaN(box.x)) { console.error('没找到卡片，先把页面状态打出来：'); console.error(await js('document.body.innerText.slice(0,300)')); process.exit(2) }
const res = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 2 } })
writeFileSync(OUT, Buffer.from(res.result.data, 'base64'))
console.log('卡片裁图 ->', OUT, JSON.stringify(box))
ws.close(); chrome.kill()
