// 详情页与列表页的 token 采样（用于风格一致性审计）：把每个可点的面抽一行出来。
// 用法：node probe_surface.mjs <baseUrl> [1440]
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = process.argv[2] || 'http://127.0.0.1:5182'
const W = Number(process.argv[3] || 1440)
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p)) || 'chrome'
const PORT = 9434
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', '--no-first-run',
  '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${join(tmpdir(), 'surfprobe')}`, 'about:blank'], { stdio: 'ignore' })
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
  if (r.result?.exceptionDetails) console.error('探测异常：', (r.result.exceptionDetails.exception?.description || '').slice(0, 300))
  return r.result?.result?.value
}
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: 1000, deviceScaleFactor: 1, mobile: false })

const nodes = await (await fetch(`${BASE}/api/nodes`)).json()
const withRemark = nodes.nodes.find((n) => n.public_remark)
await js("localStorage.removeItem('theme')")
await send('Page.navigate', { url: `${BASE}/node/${withRemark.id}` })
for (let i = 0; i < 60; i++) { await sleep(250); if (await js('!!document.querySelector("main h2")')) break }
await sleep(1800)

const dump = await js(`(() => {
  const paint = (under, top) => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); if (under) { x.fillStyle = under; x.fillRect(0,0,1,1) } x.fillStyle = top; x.fillRect(0,0,1,1); const d = x.getImageData(0,0,1,1).data; return 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')' }
  const bodyBg = getComputedStyle(document.body).backgroundColor
  const eff = (el) => { const cs = getComputedStyle(el); return { tag: el.tagName.toLowerCase(), cls: el.className.toString().slice(0, 70), size: cs.fontSize, weight: cs.fontWeight, color: paint(bodyBg, cs.color), bg: cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? '—' : paint(bodyBg, cs.backgroundColor), r: cs.borderRadius, border: cs.borderTopWidth + ' ' + (cs.borderTopColor === 'rgba(0, 0, 0, 0)' ? '—' : paint(bodyBg, cs.borderTopColor)), lh: cs.lineHeight, ls: cs.letterSpacing, fam: cs.fontFamily.split(',')[0] } }
  const q = (s) => document.querySelector(s)
  const out = {}
  const h2 = q('main h2'); if (h2) out['详情标题 h2'] = eff(h2)
  const dt = q('main dt'); if (dt) out['读数格 dt'] = eff(dt)
  const dd = q('main dd'); if (dd) out['读数格 dd'] = eff(dd)
  const h3 = q('main h3'); if (h3) out['小节标题 h3'] = eff(h3)
  const tab = q('main button'); if (tab) out['页签 button'] = eff(tab)
  const has = [...document.querySelectorAll('main [class*=rounded]')].slice(0, 400)
  const uniq = {}
  for (const el of has) { const cs = getComputedStyle(el); const k = cs.borderRadius + '|' + (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? paint(bodyBg, cs.backgroundColor) : '-') + '|' + cs.borderTopWidth; uniq[k] = (uniq[k] || 0) + 1 }
  out['__圆角×底色×描边 计数'] = uniq
  const remark = q('[data-remark-block] [data-slot=badge], [data-remark-block] span'); if (remark) out['备注小卡片'] = eff(remark)
  out['__页面底'] = paint(null, bodyBg)
  return JSON.stringify(out, null, 1)
})()`)
console.log(dump)
ws.close(); chrome.kill()
