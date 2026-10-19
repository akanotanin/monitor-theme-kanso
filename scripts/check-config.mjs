// theme.json 不许再声明任何设置项（1.6.0 起「主题设置」整个下掉）。
//
// hub 只给**声明了 config 的**主题画后台那枚「主题设置」按钮，所以「config 为空 / 不存在」
// 就是「不提供主题设置」的判据。在这里断死它：将来有人顺手加一格时当场报错 —— 否则面板上
// 会多出一格没人读的开关（主题侧已经没有读任何配置的代码），又是那种两边都不报错的毛病。
//
// 用法：node scripts/check-config.mjs（npm run check，打包脚本与 CI 都会调）
import { existsSync, readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('theme.json', 'utf8'))
if (Array.isArray(manifest.config) && manifest.config.length) {
  const names = manifest.config.map((entry) => entry.key || entry.label).join('、')
  throw new Error(`theme.json 里声明了 ${manifest.config.length} 个设置项（${names}）——本主题不提供主题设置，config 必须为空`)
}
console.log('theme.json 没有声明任何设置项（不提供主题设置）')

// 站名那个缓存键散在三处（App 一处、早跑脚本一处、index.html 的内联脚本一处）——它们必须逐字
// 一致。不一致的症状很阴：缓存有人写、没人读（或反过来），页面照常、后台照常，只是刷新时先闪
// 一次占位值，谁也不报错。这里一次比清，顺带保住那条早跑脚本没被删。
//
// ★ 站点图标那条缓存 1.25.0 起没了：图标改由 hub 1.4.0 的面板管，
//   主题侧只留 `public/favicon.svg` + `public/favicon.ico` + `public/apple-touch-icon.png` 三份兜底文件。
// 两把缓存 key，都必须逐字一致：
//   · 站名 `kanso:site_name`：App 一处、早跑脚本一处、index.html 的内联脚本一处；
//   · 明暗 `theme`（2026-10-18 加）：App 的 useTheme 读 / 写 / 删三处 + index.html 的**首帧**
//     内联脚本一处 —— 暗色访客在入口包执行之前就靠它把 .dark 挂上去（不挂就闪一屏亮色）。
// 不一致的症状都很阴：缓存有人写、没人读（或反过来），页面照常、谁也不报错 —— 只是刷新时
// 先闪一次占位值 / 先闪一屏亮色。这里一次比清，顺带保住那两段内联脚本还在、明暗那段还赶在
// 入口包前面。
const CACHES = [
  { what: '站名', key: 'kanso:site_name', places: [
    ['src/App.tsx', /TITLE_CACHE_KEY\s*=\s*"([^"]+)"/g],
    ['public/title-probe.js', /var KEY\s*=\s*"([^"]+)"/g],
    ['index.html', /name = localStorage\.getItem\("([^"]+)"\)/g],
  ] },
  { what: '明暗', key: 'theme', places: [
    ['src/App.tsx', /localStorage\.(?:getItem|setItem|removeItem)\("(theme)"\)/g],
    ['index.html', /saved = localStorage\.getItem\("([^"]+)"\)/g],
  ] },
]
const bad = []
for (const cache of CACHES) {
  for (const [file, pattern] of cache.places) {
    const found = [...readFileSync(file, 'utf8').matchAll(pattern)].map((m) => m[1])
    if (!found.length) bad.push(`${cache.what}：${file} 里找不到缓存键（护栏的锚点没了，别当通过）`)
    for (const value of found) if (value !== cache.key) bad.push(`${cache.what}：${file} 里是 ${value}，应为 ${cache.key}`)
  }
}
const html = readFileSync('index.html', 'utf8')
// ★ 2026-10-09：探针改 async 后，写死的精确串 `<script src="/title-probe.js">` 就失配了——
//   这里匹配的是「整条标签、允许带属性」，并额外钉住 async 本身：普通脚本会阻塞解析、
//   defer 也会被文档序拖住（实测 300ms 的探针延迟 = 首绘 396 vs 132ms），它是承重的。
{
  const probeTag = html.match(/<script src="\/title-probe\.js"[^>]*>/)
  if (!probeTag) bad.push(`index.html 里没有引入 /title-probe.js（标签页的占位值就没法早点换掉）`)
  else if (!/\basync\b/.test(probeTag[0])) bad.push(`/title-probe.js 的引入没有 async：普通脚本/defer 会拖住入口与首绘（见 index.html 注释里的实测数）`)
}
// ★ 2026-10-18：首帧明暗那一段（内联）必须还在、并且赶在入口模块之前 —— 它是暗色访客
//   第一帧就是暗色的唯一保证。删掉它能过掉所有静态检查（页面照样跑），只是慢网下先闪一屏
//   亮色：慢速 3G 实测 4.5 秒。锚点用那句 classList.toggle("dark", …)。
{
  const toggleAt = html.indexOf('document.documentElement.classList.toggle("dark"')
  const moduleAt = html.indexOf('<script type="module"')
  if (toggleAt < 0) bad.push(`index.html 里没有首帧明暗的内联脚本（暗色访客会先闪一屏亮色）`)
  else {
    if (moduleAt >= 0 && toggleAt > moduleAt) bad.push(`首帧明暗那段内联脚本在入口模块之后：它必须赶在首帧之前跑（挪回 <head> 里）`)
    if (!html.includes("document.documentElement.style.colorScheme")) bad.push(`首帧明暗那段没有设 colorScheme（暗色下原生滚动条与表单控件仍是亮色）`)
  }
}
// 站点图标的两条静态引用：hub 1.4.0 认的就是这两个路径，写成别的名字等于把兜底丢了。
for (const icon of ['/favicon.svg', '/apple-touch-icon.png']) {
  if (!html.includes(`href="${icon}"`)) bad.push(`index.html 里没有引用 ${icon}（站点图标的兜底就断了）`)
}
// 主题包里必须真的带着这两份兜底文件（public/ 会被原样拷进 dist/）。
for (const file of ['public/favicon.svg', 'public/favicon.ico', 'public/apple-touch-icon.png']) {
  if (!existsSync(file)) bad.push(`缺少 ${file}`)
}
// 发版时最容易漂的是两个版本号：theme.json 给面板看、package.json 给 npm / CI 看。
// 不一致时面板显示一个版本、包里却是另一个 —— 不报错，只是谁也说不清现站跑的是哪一版。
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
if (pkg.version !== manifest.version) {
  bad.push(`版本号不一致：theme.json ${manifest.version} / package.json ${pkg.version}`)
}
// lock 文件的根版本也要跟：npm ci 不看它，下一次 npm install 却会静默改回去。
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
const lockVersions = [lock.version, lock.packages?.['']?.version].filter((v) => v !== manifest.version)
if (lockVersions.length) {
  bad.push(`package-lock.json 根版本 ${[...new Set(lockVersions)].join(' / ')} != ${manifest.version}`)
}
if (bad.length) throw new Error(`缓存键或早跑脚本对不上：\n  ${bad.join('\n  ')}`)
console.log(`缓存键一致：${CACHES.map((c) => `${c.what} ${c.key}（${c.places.length} 处）`).join('、')}；早跑脚本在 index.html 里；首帧明暗脚本在入口模块之前；站点图标两条静态引用与三份兜底文件都在`)

// theme-color 的兜底色散在两处、必须逐字一致：index.html 那两份**静态**兜底（按系统明暗挑，
// 首屏在 JS 起来之前就生效）与 src/App.tsx 里那一对运行时兜底（浏览器不认 oklch 时的退路）。
// ★2026-10-15 审出来的漂移：亮色那份在 1.3.0 换暖石色系（--background 成 stone-50 #fafaf9）时
//   只改了 App.tsx，index.html 这两行漏了 —— 差整整一个色阶，谁也不报错（真值另有运行时核对：
//   tools/verify_appearance.mjs 断「App 挂上去的那份 meta == 页面实际底色」）。
{
  const bad2 = []
  const metaColor = (scheme) => {
    const at = html.indexOf('prefers-color-scheme: ' + scheme)
    if (at < 0) return null
    const start = html.lastIndexOf('content="', at) + 9
    return start < 9 ? null : html.slice(start, html.indexOf('"', start))
  }
  const app = readFileSync('src/App.tsx', 'utf8')
  const at = app.indexOf('let color = dark ? "')
  const pick = (from) => (from < 0 ? null : app.slice(from, app.indexOf('"', from)))
  const appDark = at < 0 ? null : pick(at + 'let color = dark ? "'.length)
  const appLight = at < 0 ? null : pick(app.indexOf(': "', at) + 3)
  const pairs = [
    ['index.html 亮色', metaColor('light'), 'App.tsx 亮色', appLight],
    ['index.html 暗色', metaColor('dark'), 'App.tsx 暗色', appDark],
  ]
  for (const [nameA, a, nameB, b] of pairs) {
    if (!/^#[0-9a-f]{6}$/.test(a ?? '') || !/^#[0-9a-f]{6}$/.test(b ?? '')) {
      bad2.push(`${nameA}=${a} / ${nameB}=${b}：读不出兜底色（锚点变了？别当通过）`)
    } else if (a !== b) {
      bad2.push(`${nameA} 是 ${a}、${nameB} 是 ${b}（两边必须逐字一致）`)
    }
  }
  if (bad2.length) throw new Error(`theme-color 兜底色对不上：\n  ${bad2.join('\n  ')}`)
  if (appLight === appDark) throw new Error(`theme-color 的亮暗两份兜底不该是同一个色（都是 ${appLight}）`)
  console.log(`theme-color 兜底色一致：亮 ${appLight}、暗 ${appDark}（index.html 静态两份 = App.tsx 运行时两份）`)
}
