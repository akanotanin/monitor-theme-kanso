// 大列表重渲开销实测：100 台夹具 + 每 2 秒一次数据更新下的长任务/挂载耗时。
// 用法：node probe_render_cost.mjs <baseUrl>
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = process.argv[2]
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p)) || 'chrome'
const PORT = 9449
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', '--no-first-run',
  '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${join(tmpdir(), 'rendercost')}`, 'about:blank'], { stdio: 'ignore' })
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
  if (r.result?.exceptionDetails) console.error('异常：', (r.result.exceptionDetails.exception?.description || '').slice(0, 200))
  return r.result?.result?.value
}
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

// 挂长任务观察器（在首次导航之前）
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)) }).observe({ entryTypes: ['longtask'] })
           window.__t0 = performance.now(); window.__firstCards = 0`,
})
await send('Page.navigate', { url: BASE })
for (let i = 0; i < 80; i++) { await sleep(250); if (await js("document.querySelectorAll('[data-node-card]').length > 0")) break }
const mount = await js('Math.round(performance.now() - window.__t0)')
const cards = await js("document.querySelectorAll('[data-node-card]').length")
console.log(`首屏：${cards} 张卡片，首张出现耗时 ${mount}ms`)
// 观察 12 秒（≈6 次 2 秒推送）
await js('window.__long.length = 0')
await sleep(12000)
const res = await js(`JSON.stringify({
  长任务次数: window.__long.length,
  长任务时长: window.__long.slice(0, 10),
  卡片数: document.querySelectorAll('[data-node-card]').length,
  DOM节点数: document.getElementsByTagName('*').length,
  WS连通: !!window.__wsAlive,
})`)
console.log('12 秒观测：', res)
// 滚动一屏（测量滚动时的帧成本代理：长任务增量）
await js('window.__long.length = 0')
await js('window.scrollTo({top: 2400, behavior: "instant"})')
await sleep(1500)
console.log('滚动一次：', await js('JSON.stringify({长任务: window.__long.length, 时长: window.__long})'))
ws.close(); chrome.kill()
