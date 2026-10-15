// 详情页逐项核实：白卡、两种选中态、顶栏右缘对齐、图表是否真画出来。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = process.argv[2] || 'http://127.0.0.1:5183'
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p)) || 'chrome'
const PORT = 9441
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', '--no-first-run',
  '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${join(tmpdir(), 'detailcheck')}`, 'about:blank'], { stdio: 'ignore' })
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
  if (r.result?.exceptionDetails) console.error('异常：', (r.result.exceptionDetails.exception?.description || '').slice(0, 240))
  return r.result?.result?.value
}
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false })

const nodes = await (await fetch(`${BASE}/api/nodes`)).json()
const n = nodes.nodes.find((x) => x.metrics) || nodes.nodes[0]
await send('Page.navigate', { url: `${BASE}/node/${n.id}` })
for (let i = 0; i < 80; i++) {
  await sleep(400)
  const ready = await js("!!document.querySelector('main h2') && document.querySelectorAll('main svg[role=img]').length > 0")
  if (ready) break
}
await sleep(2500)

console.log(await js(`(() => {
  const paint = (under, top) => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); if (under) { x.fillStyle = under; x.fillRect(0,0,1,1) } x.fillStyle = top; x.fillRect(0,0,1,1); const d = x.getImageData(0,0,1,1).data; return 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')' }
  const bodyBg = getComputedStyle(document.body).backgroundColor
  const eff = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return { txt: (el.textContent || '').trim().slice(0, 10), size: cs.fontSize, weight: cs.fontWeight, color: paint(bodyBg, cs.color), bg: paint(bodyBg, cs.backgroundColor), r: cs.borderRadius, ring: cs.boxShadow.slice(0, 60), border: cs.borderTopWidth + ' ' + paint(bodyBg, cs.borderTopColor), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), left: Math.round(r.left) } }
  const out = {}
  // ① 白卡（Panel）
  const secs = [...document.querySelectorAll('main section')]
  out['Panel 数'] = secs.length
  if (secs[0]) out['Panel 样本'] = eff(secs[0])
  // ② 页签 vs 时间按钮（应当同款）
  const btns = [...document.querySelectorAll('main button')]
  const tabs = btns.filter((b) => ['资源', '网络延迟'].includes(b.textContent.trim()))
  const ranges = btns.filter((b) => /小时|天$/.test(b.textContent.trim()))
  out['页签(未选)'] = tabs[0] ? eff(tabs[0]) : null
  out['页签(选中)'] = tabs[1] ? eff(tabs[1]) : null
  out['时间(未选)'] = ranges[0] ? eff(ranges[0]) : null
  out['时间(选中)'] = ranges[1] ? eff(ranges[1]) : null
  // ③ 图表真的画出来了吗
  const svgs = [...document.querySelectorAll('main svg[role=img]')]
  out['图表数'] = svgs.length
  out['图表尺寸'] = svgs.slice(0, 4).map((s) => Math.round(s.getBoundingClientRect().width) + 'x' + Math.round(s.getBoundingClientRect().height))
  out['图内路径数'] = svgs.slice(0, 4).map((s) => s.querySelectorAll('path,rect,line').length)
  // 图表容器（视觉模型说的"内嵌更浅灰块"是不是它）
  const chartBox = document.querySelector('main section > div:last-child')
  if (chartBox) out['Panel 图容器'] = eff(chartBox)
  // ④ 顶栏右缘 vs 内容右缘
  const header = document.querySelector('header > div') || document.querySelector('header')
  const tools = document.querySelector('.header-tools')
  const main = document.querySelector('main')
  const lastBtn = tools ? [...tools.children].filter((c) => c.getBoundingClientRect().width > 0).pop() : null
  out['对齐'] = {
    内容右缘: main ? Math.round(main.getBoundingClientRect().right - parseFloat(getComputedStyle(main).paddingRight)) : null,
    header容器右缘: header ? Math.round(header.getBoundingClientRect().right - parseFloat(getComputedStyle(header).paddingRight)) : null,
    tools右缘: tools ? Math.round(tools.getBoundingClientRect().right) : null,
    最后一枚图标右缘: lastBtn ? Math.round(lastBtn.getBoundingClientRect().right) : null,
    图标: lastBtn ? lastBtn.getAttribute('aria-label') || lastBtn.title || lastBtn.className.toString().slice(0, 40) : null,
  }
  return JSON.stringify(out, null, 1)
})()`))
ws.close(); chrome.kill()
