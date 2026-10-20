// 找出卡片里真正把内容撑出边界的元素（scrollWidth > clientWidth）。
// 用法：node tools/probe_overflow.mjs <baseUrl>
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = process.argv[2]
if (!BASE) { console.error('用法：node tools/probe_overflow.mjs <站点URL>'); process.exit(2) }
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p)) || 'chrome'
const PORT = 9447
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', '--no-first-run',
  '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${join(tmpdir(), 'probeoverflow')}`, 'about:blank'], { stdio: 'ignore' })
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BASE })
for (let i = 0; i < 80; i++) { await sleep(250); if (await js(`document.querySelectorAll('[data-node-card]').length > 0`)) break }
await sleep(1500)
const out = JSON.parse(await js(`(() => {
  const rows = []
  for (const card of document.querySelectorAll('[data-node-card]')) {
    const cr = card.getBoundingClientRect()
    const name = card.querySelector('h2')?.textContent ?? '?'
    for (const el of card.querySelectorAll('*')) {
      const rr = el.getBoundingClientRect()
      if (rr.right > cr.right + 1 || el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        const r = el.getBoundingClientRect()
        // 只报「真的探出卡片」或「文字被硬裁」的：自身溢出，且不是靠 text-overflow 省略的那种
        const cs = getComputedStyle(el)
        rows.push({
          card: name, w: Math.round(cr.width), tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 90),
          text: (el.textContent || '').trim().slice(0, 40),
          sw: el.scrollWidth, cw: el.clientWidth,
          right: Math.round(r.right), cardRight: Math.round(cr.right),
          ellipsis: cs.textOverflow, overflow: cs.overflowX,
        })
      }
    }
  }
  return JSON.stringify(rows)
})()`))
console.log('卡片内溢出元素：', out.length)
for (const r of out) console.log(JSON.stringify(r))
ws.close(); chrome.kill()
// 有溢出就非零退出，否则这条探针在 sweep 里永远是绿的（无参跑也会「0 溢出」）
process.exit(out.length ? 1 : 0)
