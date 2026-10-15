// 预览图三件套一次生成（公开仓库用，中性数据）：
//   ① preview.png         列表页 1440×810 @2x（亮）
//   ② preview-dark.png    同一机位的深色版（按系统暗色拍，见 shot_preview.mjs 的第 7 参数）
//   ③ preview-mobile.png  手机 390×844 @3x（单列）
// 自起桩服务（tools/preview-nodes.json 的中性节点）→ 逐张调用 shot_preview.mjs → 关服务。
// 数据来源必须中性：这三张会公开发在 GitHub 上，不许带真实机器名 / 金额（见 shot_preview.mjs 头部）。
// 用法：cd <repo> && node tools/shot_preview_set.mjs（先 npm run build）
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = Number(process.env.PREVIEW_PORT || 5180)
const serve = spawn('node', ['tools/serve.mjs', String(PORT), 'tools/preview-nodes.json'], { stdio: 'ignore' })
let up = false
for (let i = 0; i < 80 && !up; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/api/me`); up = r.ok } catch { /* 等它起 */ }
  if (!up) await sleep(250)
}
if (!up) { serve.kill(); throw new Error(`桩服务没起来（端口 ${PORT} 被占？）`) }
console.log(`桩服务在 ${PORT}（tools/preview-nodes.json）`)

const run = (args) => new Promise((res, rej) => {
  const p = spawn('node', ['tools/shot_preview.mjs', ...args], { stdio: 'inherit' })
  p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`shot_preview 退出码 ${code}（${args.join(' ')}）`))))
})

const BASE = `http://127.0.0.1:${PORT}`
await run([BASE, 'preview.png', '1440', '810', '2'])
await run([BASE, 'preview-dark.png', '1440', '810', '2', 'dark'])
await run([BASE, 'preview-mobile.png', '390', '844', '3'])

serve.kill()
console.log('三张就位：preview.png / preview-dark.png / preview-mobile.png')
