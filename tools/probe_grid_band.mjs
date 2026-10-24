// 卡片网格「宽度带」探针：在若干视口宽度上量列数、卡片宽高、四格读数被压窄/被截的情况，
// 顺手把每个宽度拍一张整页图。用途是给「宽卡太散 / 窄卡截字」这类版式问题留对照证据。
//
// 用法：cd <repo> && node tools/probe_grid_band.mjs <标签>   （标签进文件名，如 before / after）
//   产物：shots/grid-<标签>-<宽度>.png + 终端一张表
//
// 为什么不用断点去推：列数现在由 **容器可用宽度** 决定（auto-fit），视口与容器之间隔着
// max-w-[1080px] 与内边距、还有滚动条那 15px —— 只有真量一遍才知道哪一档落在哪。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { join } from 'node:path'

const LABEL = process.argv[2] || 'probe'
// 给了 BASE 就量真站（本机 dist 不参与）；不给就起 tools/serve.mjs 伺服本地 dist。
const BASE = (process.env.BASE || '').replace(/\/$/, '')
const OUT = 'shots'
const WIDTHS = (process.env.WIDTHS || '1440,1280,1200,1100,1024,960,900,800,768,700,600,430,390').split(',').map(Number)
const PORT = 5288
const CDP = 9440
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => existsSync(p)) || 'chrome'

mkdirSync(OUT, { recursive: true })

const server = BASE ? null : spawn(process.execPath, ['tools/serve.mjs', String(PORT), 'tools/preview-nodes.json'], { stdio: 'ignore' })
await sleep(600)

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, '--remote-allow-origins=*', '--no-first-run',
  '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${join(process.env.LOCALAPPDATA || '.', 'Temp', 'probe-grid-' + CDP)}`,
  'about:blank'], { stdio: 'ignore' })

let wsUrl = null
for (let i = 0; i < 80 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl } catch { }
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

const probe = `(() => {
  const cards = [...document.querySelectorAll('[data-node-card]')]
  if (!cards.length) return 'null'
  const grid = cards[0].parentElement
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
  const r = cards[0].getBoundingClientRect()
  const m = cards[0].querySelector('[data-metrics]')
  const net = cards[0].querySelector('[data-net="cell"]')
  const cells = m ? [...m.children].filter((el) => !el.hasAttribute('data-net')).map((el) => {
    const b = el.getBoundingClientRect()
    return { left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width) }
  }) : []
  const nr = net ? net.getBoundingClientRect() : null
  const cut = [...(m ? m.querySelectorAll('div') : [])].filter((el) => el.scrollWidth > el.clientWidth + 1).length
  const pageCut = document.documentElement.scrollWidth - document.documentElement.clientWidth
  return JSON.stringify({
    cards: cards.length, cols,
    card: { w: Math.round(r.width), h: Math.round(r.height) },
    client: document.documentElement.clientWidth,
    content: Math.round(grid.getBoundingClientRect().width),
    cellW: cells.map((c) => c.w),
    gap3toNet: nr && cells.length ? Math.round(nr.left - cells[cells.length - 1].right) : null,
    cut, pageCut,
  })
})()`

const rows = []
for (const w of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1000, deviceScaleFactor: 1, mobile: w < 600 })
  await send('Page.navigate', { url: BASE || `http://127.0.0.1:${PORT}/` })
  for (let i = 0; i < 60; i++) { await sleep(150); if (await js("document.querySelectorAll('[data-node-card]').length > 0")) break }
  await sleep(500)
  const m = JSON.parse((await js(probe)) ?? 'null')
  rows.push({ w, ...m })
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true })
  writeFileSync(join(OUT, `grid-${LABEL}-${w}.png`), Buffer.from(shot.result.data, 'base64'))
}

console.log('标签:', LABEL)
console.log('视口 | 列 | 卡宽×高 | 内容宽 | 四格宽 | 第3格→速率格空隙 | 截字数 | 页横向溢出')
for (const r of rows) {
  console.log([r.w, r.cols, `${r.card?.w}×${r.card?.h}`, r.content, (r.cellW || []).join('/'), r.gap3toNet, r.cut, r.pageCut].join(' | '))
}

ws.close(); chrome.kill(); server?.kill()
