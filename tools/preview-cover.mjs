// 生成主题预览图（preview.png = 面板卡片上那张）——「角色 + 主题名」封面版。
//
// 用法：node tools/preview-cover.mjs [输出路径] [形态]
//   node tools/preview-cover.mjs                       # 默认 → preview.png，纯封面（发版用这张）
//   node tools/preview-cover.mjs shots/x.png pure-big  # 角色与文字各放大一档
//   node tools/preview-cover.mjs shots/x.png band      # 下方带一条现网实拍长条
//   形态：pure（默认） | pure-big | band
//
// 为什么这么做（而不是直接 Page.captureScreenshot 拍站点）：
//   1. 面板卡片上只有约 300px 宽，一张缩到那个尺寸还看得清「这是哪个主题」的图，
//      靠的是大字 + 角色，而不是站点截图里的数字。
//   2. 配色不靠感觉调，全部取自主题自己的 token（src/index.css 实值，暖石色系）：
//      底 #fafaf9（stone-50）· 主字 #1c1917（stone-900）· 次要 #78716c（stone-500）
//      · 中间调 #a8a29e（stone-400）· 分隔线 #e7e5e4（stone-200）。
//   3. 角色图（preview-src/mascot-peace.png）本身就是「右边与下边被切」的构图，所以贴到
//      画布右下角（right: -4 / bottom: -10），硬切边正好落在画布边界上，看不出被裁。
//   4. 大标题走**主题自带的那份 Inter**（public/fonts 里那份 woff2 内嵌），字形与页面里
//      逐字一致；中文回落到系统 CJK。
//
// 尺寸：1440x810 CSS @ DPR 2 = 2880x1620，与历史上那几张预览图同机位（换图不该改观感）。
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const OUT = process.argv[2] || 'preview.png'
const FORM = process.argv[3] || 'pure'
const W = 1440, H = 810, DPR = 2
const MASCOT = 'preview-src/mascot-peace.png'
const INTER = 'public/fonts/inter-latin-var.woff2'

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p)) || 'chrome'

if (!existsSync(MASCOT)) {
  throw new Error(`缺少 ${MASCOT}（角色图）。用 tools/mascot-cutout.py 从白底原图抠出来，或者把已有的透明 PNG 放到这个路径。`)
}

// 角色与文案的尺寸：改这里就能重新出图，数字都是按「文字右沿 ↔ 角色左轮廓」实测空档定的。
// 角色图 1024×1024，左轮廓在 ~8%（内容从 8% 处开始），右/下是切边；ch 是贴在画布上的 CSS 高。
const PURE = { ch: 700, h1: 200, kicker: 18, sub: 36, feats: 25, block: 700 }
const PURE_BIG = { ch: 760, h1: 216, kicker: 19, sub: 38, feats: 26, block: 720 }
// 带长条的形态：长条高度 = 截图的自然比例，角色底边压在长条上沿
const BANDS = {
  // 长条内容：顶栏 + 第一行卡片完整 + 第二行露头（height 360 = 100 起卡片 + 218 卡高 + 12 缝 + 30 露头）
  // overlap：角色底边伸进长条多少 px（>0 才有「站在界面后面」的层次；0 = 齐平相接）
  band: { file: 'preview.png', top: 0, height: 360, ch: 345, right: 128, overlap: 22 },
}

const uri = (f, mime) => `data:${mime};base64,${readFileSync(f).toString('base64')}`
const head = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
@font-face{font-family:"Inter";font-style:normal;font-weight:400 700;src:url(${uri(INTER, 'font/woff2')}) format("woff2")}
:root{--ink:#1c1917;--mid:#78716c;--soft:#a8a29e;--line:#e7e5e4}
*{box-sizing:border-box;margin:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:#fafaf9;color:var(--ink);
  font-family:"Inter","Segoe UI",system-ui,-apple-system,"Microsoft YaHei",sans-serif;
  -webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
body{position:relative}
.kicker{letter-spacing:.22em;color:var(--soft);text-transform:uppercase}
h1{font-weight:700;letter-spacing:-.022em;line-height:1}
.sub{color:var(--mid)}
.rule{height:1px;background:var(--line)}
.feats{color:var(--mid)}
.mascot{filter:drop-shadow(0 18px 32px rgba(28,25,23,.10))}
</style></head><body>`

const copy = (feats) => `<div class="copy">
  <div class="kicker">Monitor Theme</div>
  <h1>kanso</h1>
  <div class="sub">自家制の极简探针（Monitor）主题</div>
  <div class="rule"></div>
  <div class="feats">${feats}</div>
</div>`
const FEATS2 = '单档宽卡 · 整页详情 · 图表交互<br>备注标签 · 搜索筛选 · 明暗双色'
const FEATS1 = '单档宽卡 · 整页详情 · 图表交互 · 备注标签 · 明暗双色'

let html
if (FORM === 'pure' || FORM === 'pure-big') {
  const { ch, h1, kicker, sub, feats, block } = FORM === 'pure' ? PURE : PURE_BIG
  html = `${head}
<img class="mascot" src="${uri(MASCOT, 'image/png')}">
${copy(FEATS2)}
<style>
.copy{position:absolute;left:96px;top:50%;transform:translateY(-50%);width:${block}px}
.kicker{font-size:${kicker}px}
h1{font-size:${h1}px;margin-top:${Math.round(h1 * 0.2)}px}
.sub{font-size:${sub}px;margin-top:${sub}px}
.rule{width:${Math.round(h1 * 1.7)}px;margin:${sub}px 0}
.feats{font-size:${feats}px;line-height:1.95}
.mascot{position:absolute;right:-4px;bottom:-10px;height:${ch}px}
</style></body></html>`
} else if (FORM === 'band') {
  const band = BANDS[FORM]
  if (!existsSync(band.file)) throw new Error(`缺少 ${band.file}（band 形态的站点截图）`)
  // 长条用「溢出裁切 + 负偏移」取截图的一段落，不引入图像处理依赖。
  // ★角色画在长条**下层**、底边伸进长条 overlap px —— 头顶带切边的半身贴纸直接与长条上沿
  //   齐平相接时，切口像一刀切平（视觉复核对过）；伸进去一截，读成「角色站在界面后面」。
  //   引线（--line 那条 1px）随之只在角色两侧出现：左段到角色左轮廓（内容从图左沿 ~9% 处起）、
  //   右段是角色到画布右边的留白区 —— 角色处自然断开，不穿人。
  const overlap = band.overlap ?? 0
  const M_PAD = Math.round(band.ch * 0.09)  // 角色图左 ~9% 是透明留白（抠图轮廓实测）
  html = `${head}
<img class="mascot" src="${uri(MASCOT, 'image/png')}">
<div class="band"><img src="${uri(band.file, 'image/png')}"></div>
${copy(FEATS1)}
<style>
.band{position:absolute;left:0;right:0;bottom:0;height:${band.height}px;overflow:hidden;box-shadow:0 -16px 32px -20px rgba(28,25,23,.14)}
.band::before{content:"";position:absolute;top:0;left:0;width:${W - band.right - band.ch + M_PAD}px;height:1px;background:var(--line)}
.band::after{content:"";position:absolute;top:0;right:0;width:${band.right}px;height:1px;background:var(--line)}
.band img{position:absolute;left:0;top:${-band.top}px;display:block;width:${W}px}
.copy{position:absolute;left:96px;top:52px;width:760px}
.kicker{font-size:13px}
h1{font-size:72px;margin-top:14px}
.sub{font-size:19px;margin-top:14px}
.rule{width:180px;margin:20px 0}
.feats{font-size:16px}
.mascot{position:absolute;right:${band.right}px;bottom:${band.height - overlap}px;height:${band.ch}px}
</style></body></html>`
} else {
  throw new Error(`未知形态 ${FORM}（可选：pure / pure-big / band）`)
}

const dir = mkdtempSync(join(tmpdir(), 'preview-cover-'))
const page = join(dir, 'cover.html')
writeFileSync(page, html)
execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--force-device-scale-factor=${DPR}`, `--window-size=${W},${H}`,
  `--user-data-dir=${join(dir, 'prof')}`, `--screenshot=${resolve(OUT)}`, `file:///${page}`,
], { stdio: 'pipe' })

// 自检：尺寸必须对、不能是空白页（空白页体积会小得离谱）
const buf = readFileSync(OUT)
const size = `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`
if (size !== `${W * DPR}x${H * DPR}`) throw new Error(`输出尺寸 ${size}，应为 ${W * DPR}x${H * DPR}`)
if (buf.length < 20000) throw new Error(`输出只有 ${buf.length} 字节，像是空白页`)
console.log(`${OUT}  ${size}  ${(buf.length / 1024).toFixed(0)}KB  形态=${FORM}`)
