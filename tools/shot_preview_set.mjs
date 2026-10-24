// 预览图三件套一次生成（公开仓库用，中性数据）：
//   ① preview-light.png   列表页 1440×810 @2x（亮）
//   ② preview-dark.png    同一机位的深色版（按系统暗色拍，见 shot_preview.mjs 的第 7 参数）
//   ③ preview-mobile.png  手机档 430×1400 @2x（860×2800，单列铺满：六张卡 + 页脚都装得下）
// ★手机档口径＝430×1400@2（2026-10-25 起）：手机档的卡片是**铺满可用宽度**的，430 是常见手机宽度、
//   拍出来与真机一致。更早的 585×1500@2 是配「单列卡片也固定 336」那一版定的 —— 那一档已经被站长
//   否掉（「电脑固定、手机照旧」），585 宽现在会拍成「336 卡居中、两侧一百多像素白边」的平板相。
// ★preview.png 不在这里：1.6.1 起它是「角色封面」（tools/preview-cover.mjs 出图、随进发布包、也是
//   README 顶部大图），与本套截图分工不同 —— 这个工具不许覆写它（三件套的亮色那张叫 preview-light.png）。
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
await run([BASE, 'preview-light.png', '1440', '810', '2'])
await run([BASE, 'preview-dark.png', '1440', '810', '2', 'dark'])
await run([BASE, 'preview-mobile.png', '430', '1400', '2'])

serve.kill()
console.log('三张就位：preview-light.png / preview-dark.png / preview-mobile.png')
