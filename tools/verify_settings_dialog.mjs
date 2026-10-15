// 不用登录密码，验证「后台 → 主题 → 主题设置」里到底画出了哪些设置项。
//
// 原理：hub 后台是 SPA，设置对话框完全按 `GET /api/themes` 返回的 manifest.config 现画；
// 所以这里用 CDP 拦 /api/* 发假数据（config 就喂目标主题真实的 theme.json），跑的是真 React 组件。
//
// 对照组用法：先拿**改动前**的 theme.json 跑一遍，断言必须 FAIL（证明这个护栏真看得见设置项的增删），
// 再拿改动后的跑，断言必须全 PASS。只验「正确时通过」等于没验。
//
// ★Hub 1.3.0 的两条布局规则（从前端 bundle 里挖出来的，判据就是**非标题字段的个数**）：
//     o = 非标题字段 > 6  → 栅格变**两列**（每格半宽）
//     s = o && 分组数 > 1 → 再加**左侧分组导航、只挂当前那一组**
//   本主题只有 2 个字段 → 单列平铺、无导航；下面那批排版断言走**没有导航**的那一支。
//
// 用法: node tools/verify_settings_dialog.mjs <theme.json> <截图前缀> [baseUrl=http://127.0.0.1:28081]
//   baseUrl 通常是 ssh -L 隧道到 hub 的本地端口。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const MANIFEST = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const PREFIX = process.argv[3] || 'shots/settings-dialog';
const BASE = (process.argv[4] || 'http://127.0.0.1:28081').replace(/\/$/, '');
// 本站的主题设置只有两格：节点信息 → 详情页显示备注；外观 → 主题模式。
// 名字与 theme.json 的 label 逐字对应。
// ★历史上那些键（站点图标、农场入口、服务器备注、备注显示位置、卡片形态、列表页顶部、延迟线路、
//   节点地球…）这个主题一个都不声明——下面有一组断言专门断「旧键不许冒出来」。
const WANTED = ['详情页显示备注', '主题模式']
const PORT = 9780 + Math.floor(Math.random() * 20);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find((p) => existsSync(p)) || 'chrome';

const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
  '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,900',
  '--user-data-dir=' + (process.env.TEMP || '.') + '/settingsdlg-' + PORT + '-' + Date.now(), 'about:blank'], { stdio: 'ignore' });

let id = 0; const pend = new Map();
async function connect() {
  for (let i = 0; i < 40; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; } catch {}
    await sleep(300);
  }
  throw new Error('Chrome 没起来');
}
const ws = new WebSocket(await connect());
await new Promise((r) => { ws.onopen = r; });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
// 站点配置喂 `{}` = 从没保存过：面板的初值是 `saved[key] ?? default`，
// 所以截图里应当看到主题自带的默认值（下拉选中的那一档、地址留空）。
// 「保存过非默认值」那一态不用这里验——线上真机的 PUT/匿名读回才是判据。
const saved = {};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params; const u = request.url;
    const json = (o) => send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(o)).toString('base64') });
    if (/\/api\/ws/.test(u)) return send('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
    if (/\/api\/themes\/[^/]+\/config/.test(u)) return json(saved);
    if (/\/api\/themes(\?|$)/.test(u)) return json({ themes: [
      { name: MANIFEST.name, short: MANIFEST.short, description: MANIFEST.description, version: MANIFEST.version, author: MANIFEST.author, url: MANIFEST.url, selected: true, builtin: false, config: MANIFEST.config },
      { name: '默认主题', short: 'default', description: '', version: '1.0.0', author: 'Monitor', url: '', selected: false, builtin: true, config: [] },
    ] });
    if (/\/api\/me(\?|$)/.test(u)) return json({ authed: true, admin: true, github: false, public_page: true, site: BASE, site_name: 'Komari Monitor' });
    if (/\/api\/nodes/.test(u)) return json({ nodes: [] });
    if (/\/api\/ping-tasks/.test(u)) return json({ tasks: [] });
    if (/\/api\/version/.test(u)) return json({ version: '1.3.0' });
    return send('Fetch.continueRequest', { requestId });
  }
};
const js = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? ' — ' + extra : ''}`); if (ok) pass++; else fail++; };

await send('Runtime.enable'); await send('Page.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/admin/themes` });

// 先把「主题页本身起来了」和「卡片上有设置按钮」分开断言：
// Hub 只给**声明了 config 的**主题画那枚「主题设置」按钮，所以没有 config 时
// 等它出现会一直等不到——那是被测对象的状态，不是页面没起来，别混成一句失败。
let pageOk = false;
for (let i = 0; i < 60; i++) {
  await sleep(500);
  pageOk = await js(`document.body.innerText.includes('安装主题')`);
  if (pageOk) break;
}
check('后台主题页渲染出来了', pageOk);
if (!pageOk) console.log('⚠ 页面没起来（曾遇到一次性空白页假失败）——同样的桩重跑一次再判定，不要当代码问题');

let btn = false;
if (pageOk) {
  for (let i = 0; i < 20; i++) {
    btn = await js(`!!document.querySelector('button[title="主题设置"]')`);
    if (btn) break;
    await sleep(300);
  }
}
check('主题卡片上有「主题设置」按钮（Hub 只给声明了 config 的主题画）', btn);

let dlg = false;
if (btn) {
  await js(`document.querySelector('button[title="主题设置"]')?.click()`);
  for (let i = 0; i < 40; i++) { await sleep(400); dlg = await js(`!!document.querySelector('[role="dialog"]')`); if (dlg) break; }
  check('设置对话框已打开', dlg);
  await sleep(800);
}

const entries = MANIFEST.config || [];
// theme.json 里 type=title 的项就是面板上的小节标题，也是分组导航上的项名。
const groups = [];
for (const entry of entries) {
  if (entry.type === 'title') groups.push({ label: entry.label, fields: [] });
  else if (groups.length) groups[groups.length - 1].fields.push(entry);
  else groups.push({ label: '', fields: [entry] });
}

const dialogText = async () => (await js(`(document.querySelector('[role="dialog"]')?.innerText || '')`)) || '';
// 分组导航：对话框左侧那排按钮。实测面板给它们发的是 `aria-current`（true/false），不是
// `aria-selected`（后者要 `[role=tab]` 才成立）——写错的那版返回空数组，于是「没导航」这段
// 分支被当成常态，断言全落在第一组上。别拿 [role=dialog] nav 找，那是另一个对话框的结构。
const nav = (await js(`[...document.querySelectorAll('[role="dialog"] button[aria-current]')].map((b) => b.innerText.trim())`)) || [];
const hasNav = nav.length > 1;
console.log(`对话框布局：${hasNav ? `分组导航 ${nav.join(' / ')}` : '一页平铺（字段数 ≤ 6，无导航）'}\n`);

async function openGroup(label) {
  if (!hasNav) return true;
  const clicked = await js(`(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button[aria-current]')].find((x) => x.innerText.trim() === ${JSON.stringify(label)})
    if (!b) return false
    b.click()
    return true
  })()`);
  if (clicked) await sleep(500);
  return clicked;
}

// 「面板画出来了没」：按组点开再读文本。有导航时只挂载当前那一组，
// 没导航（小表单）时整页就是全部字段——两种布局共用同一批断言。
const texts = {};
for (const group of groups) {
  const opened = await openGroup(group.label);
  const text = await dialogText();
  texts[group.label] = text;
  const where = hasNav ? `「${group.label}」组` : '对话框';
  console.log(`—— ${where}: ${text.replace(/\n+/g, ' | ').slice(0, 400)}\n`);
  check(`${where}读到了内容`, opened && text.includes('取消'));
  for (const field of group.fields) check(`${where}里画出了「${field.label}」`, text.includes(field.label));
  check(`${where}每一项的说明文案都画出来了`,
    group.fields.every((f) => !f.help || text.includes(f.help)), group.fields.map((f) => f.label).join('、'));
}
const everyText = Object.values(texts).join('\n');
// 分组名（= 小节标题）也要能看到：有导航时在导航栏上，没有时在正文里。
// ★别只拿 everyText 当判据——导航栏本身就属于对话框正文，组名永远在里面，那样断言恒真。
check('theme.json 里的每个分组都有对应的导航项 / 小节标题',
  groups.length > 0 && groups.every((g) => g.label === '' || nav.includes(g.label) || everyText.includes(g.label)),
  groups.map((g) => g.label).join('、') || '（一个都没有）');
const declaredKeys = entries.filter((e) => e.type !== 'title').map((e) => e.key);
console.log(`声明的设置项: ${declaredKeys.join('、') || '（无）'}  分组: ${groups.map((g) => g.label).join('、') || '（无）'}  version=${MANIFEST.version}`);

// 两个方向都断：manifest 声明了没（我们的表单写对了没），面板画出来了没（Hub 认不认这个声明）。
for (const label of WANTED) {
  const owner = groups.find((g) => g.fields.some((f) => f.label === label));
  check(`对话框里画出了「${label}」`, !!owner && (texts[owner.label] || '').includes(label));
  check(`theme.json 声明了「${label}」`, entries.some((e) => e.label === label));
}

// ── 旧键护栏：精简掉的东西不许从面板上冒出来 ─────────────────────────
// 旧键读到一律丢弃（见 src/lib/site-settings.ts 的键白名单）；它们出现在面板上 = 站长会对着
// 一格里白填（看着像开关、其实没人在读）。两个方向都断：manifest 不许声明、对话框不许画出来。
const GONE_KEYS = ['siteIcon', 'farmUrl', 'showFarmEntry', 'serverNotes', 'remarkPlacement',
  'cardStyle', 'listTop', 'pingLines', 'pingLine1', 'pingLine2', 'globeOn', 'showGroupTabs']
const GONE_LABELS = ['站点图标', '农场入口', '服务器备注', '备注显示位置', '卡片形态', '列表页顶部', '显示的延迟线路', '节点地球']
check('manifest 里没有已删掉的旧键', !entries.some((e) => GONE_KEYS.includes(e.key)),
  JSON.stringify(entries.filter((e) => e.type !== 'title').map((e) => e.key)))
check('对话框里也没画出这些旧键的格子', !GONE_LABELS.some((t) => everyText.includes(t)),
  GONE_LABELS.filter((t) => everyText.includes(t)).join('、') || '一个都没有')
// 「过时指引」类转场文案（历史上出现过的「备注已移到…」）不许残留。
check('没有过时指引文案', !everyText.includes('备注已移到探针后台')
  && !entries.some((e) => String(e.label).includes('备注已移到探针后台')))
// 小节标题就那两节，顺序也钉住（hub 丢掉「没有字段跟进的标题」，顺序错=有一节被静默丢了）。
check('小节标题逐字同序：节点信息 / 外观',
  JSON.stringify(entries.filter((e) => e.type === 'title').map((e) => e.label)) === JSON.stringify(['节点信息', '外观']),
  JSON.stringify(entries.filter((e) => e.type === 'title').map((e) => e.label)))
// 「详情页显示备注」的灰色说明要讲清它只管整页详情、卡片侧不摊。
const REMARK_HELP = (entries.find((e) => e.key === 'detailRemarks') || {}).help || ''
check('「详情页显示备注」的说明讲清了只影响整页详情', /详情/.test(REMARK_HELP), REMARK_HELP)
// 「主题模式」的说明要讲清四档与北京时间口径。
const MODE_HELP = (entries.find((e) => e.key === 'themeMode') || {}).help || ''
check('「主题模式」的说明讲清了自动档的北京时间口径', /北京时间/.test(MODE_HELP) && /19:00/.test(MODE_HELP), MODE_HELP)

// ── 下拉框（type: select）的选项文案 ──────────────────────────────────
// 面板对 select 画的是「真 <select> 一份 + Radix combobox 一份」，两侧的选项文案都来自 manifest.config。
// 之前这里只断过「字段名画出来了」——选项文案是盲区：改了 theme.json 里某个 option 的 label，
// 面板上没变（或改错一处）照样全绿。所以按「打开那个下拉、读 [role=option]」的路径断，
// 且逐字**同序**对照 theme.json 的 options：顺序换了也是站长看得见的改动，不该漏。
async function openSelect(field) {
  const owner = groups.find((g) => g.fields.includes(field))
  await openGroup(owner?.label ?? '')
  return await js(`(() => {
    const dlg = document.querySelector('[role="dialog"]')
    const lab = [...dlg.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent.trim() === ${JSON.stringify(field.label)})
    if (!lab) return 'no-label'
    let box = lab
    for (let i = 0; i < 4 && box && box !== dlg; i++) {
      const c = box.querySelector('[data-slot="select-trigger"], button[role="combobox"]')
      if (c) { c.click(); return 'clicked' }
      box = box.parentElement
    }
    return 'no-control'
  })()`)
}
const esc = async () => {
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(300)
}
for (const field of entries.filter((e) => e.type === 'select' && Array.isArray(e.options))) {
  const where = groups.find((g) => g.fields.includes(field))?.label ?? ''
  const how = await openSelect(field)
  await sleep(600)
  const seen = (await js(`[...document.querySelectorAll('[role="option"]')].map((o) => o.innerText.trim())`)) || []
  const want = field.options.map((o) => o.label)
  check(`${where ? `「${where}」组里` : ''}「${field.label}」的选项文案与 theme.json 逐字同序一致`,
    how === 'clicked' && seen.length === want.length && seen.every((t, i) => t === want[i]),
    `${how}｜面板 ${JSON.stringify(seen)} ｜manifest ${JSON.stringify(want)}`)
  // 「主题模式」留一张下拉展开的档（选项是站长看得见的东西，改档位时能一眼对照）。
  if (field.key === 'themeMode' && how === 'clicked') {
    const png = await send('Page.captureScreenshot', { format: 'png' })
    if (png?.result?.data) writeFileSync(`${PREFIX}-theme-options.png`, Buffer.from(png.result.data, 'base64'))
  }
  await esc()
}

// 开关初值 = `saved[key] ?? default`（站点配置喂的是 `{}`，所以看到的就是主题自带的默认值）。
// 面板对 boolean 用的是 Radix Switch：`button[role=switch][aria-checked]`，所以按开关读状态，
// 别去猜它内部的 DOM 结构。找不到开关要报 FAIL，不能静默通过。
async function switchState(label) {
  return await js(`(() => {
    const dlg = document.querySelector('[role="dialog"]')
    if (!dlg) return 'no-dialog'
    const node = [...dlg.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent.trim() === ${JSON.stringify(label)})
    if (!node) return 'no-label'
    let box = node
    for (let i = 0; i < 5 && box && box !== dlg; i++) {
      const sw = box.querySelector('[role="switch"], input[type=checkbox]')
      if (sw) return sw.getAttribute('aria-checked') ?? String(sw.checked)
      box = box.parentElement
    }
    return 'no-switch'
  })()`)
}
for (const entry of entries.filter((e) => e.type === 'boolean')) {
  // 有导航时开关在其它组里，得先点开那一组（面板只挂载当前组）。
  const owner = groups.find((g) => g.fields.includes(entry));
  await openGroup(owner?.label ?? '');
  const state = await switchState(entry.label);
  check(`开关「${entry.label}」的初值 = theme.json 的 default（${entry.default}）`, state === String(entry.default), `面板读到 ${state}`);
}

// ── 排版护栏：字段数 ≤ 6 时必须是单列平铺 ──────────────────────────────
// 这一条正是 1.5.0 的来由：7 个设置项会让 Hub 切成两列 + 分组导航，而两列里每格只有半宽，
// 长说明折成四五行、并排两项高矮不齐、每组最后一行空半格。以后真想回到两列，先来这里改断言。
const layout = await js(`(() => {
  const dlg = document.querySelector('[role="dialog"]')
  if (!dlg) return null
  const grids = [...dlg.querySelectorAll('div[class*="grid"]')].map((g) => String(g.className))
  const twoCol = grids.filter((c) => c.includes('grid-cols-2'))
  // 设置项容器：字段那张栅格里除小节标题（h3）以外的直接子元素。
  const pane = [...dlg.querySelectorAll('div[class*="grid"]')].find((g) => g.querySelector('input, textarea, button[role=switch]'))
  const items = pane ? [...pane.children].filter((el) => el.tagName !== 'H3') : []
  const widths = [...new Set(items.map((el) => Math.round(el.getBoundingClientRect().width)))]
  const heights = [...new Set(items.map((el) => Math.round(el.getBoundingClientRect().height)))]
  return { twoCol: twoCol.length, nav: dlg.querySelectorAll('button[aria-current]').length, items: items.length, widths, heights }
})()`)
// 两种版式各有各的预期，判据跟着版式走：
//   · 非标题字段 ≤6：一页平铺、单列、全部挂载（1.5.0 起一直是这一支）；
//   · >6：hub 自己换成「左导航 + 右侧两列」、一次只挂当前那一组
//     （hub 1.4.0 源码：`large = fields.length > 6`，`paged = large && sections.length > 1`）。
// 2026-10-07 站长要求加「节点地球」与「主题模式」，于是走的是后一支 —— 别把「有导航」当成排版坏了。
const paged = hasNav
check(paged ? '排版：>6 项时按 hub 的设计切成两列 + 分组导航' : '排版：≤6 项时一页平铺、单列、无导航',
  !!layout && (paged ? layout.twoCol > 0 && layout.nav === groups.length : layout.twoCol === 0 && layout.nav <= 1),
  layout ? `两列容器 ${layout.twoCol} 个、导航项 ${layout.nav} 个（分组 ${groups.length} 个）` : '量不到')
check(paged ? '排版：一次只挂当前那一组' : '排版：设置项全部挂载',
  !!layout && (paged ? layout.items > 0 && layout.items < declaredKeys.length : layout.items === declaredKeys.length),
  `挂载 ${layout?.items} 项 / 声明 ${declaredKeys.length} 项`)
check('排版：当前挂载的那些项同宽（没有半格）',
  !!layout && layout.widths.length === 1, `宽度 ${JSON.stringify(layout?.widths ?? [])}`)
// 说明文案占几行才是这次的病根：两列时半宽，四五行的说明既折得碎又把并排两项拉得一高一矮。
// 逐项按 theme.json 里 help 的**原文**定位那个元素（文本完全相等），量它的高度 / 行高。
async function helpLines(help) {
  return await js(`(() => {
    const dlg = document.querySelector('[role="dialog"]')
    if (!dlg) return -1
    const el = [...dlg.querySelectorAll('*')].find((x) => x.children.length === 0 && x.textContent.trim() === ${JSON.stringify(help)})
    if (!el) return -1
    const cs = getComputedStyle(el)
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5 || 16
    return Math.round(el.getBoundingClientRect().height / lh)
  })()`)
}
// 说明占几行才是这条护栏的病根：两列时每格只有 309px（实测），四五行既折得碎又把并排两项拉得一高一矮。
// 单列（462px）按 ≤2 行断；两列版式放宽到 ≤3 行 —— 站长 2026-10-03 明确要「备注怎么用」写进面板，
// 那段话在 309px 里正好 3 行，属于有意为之。
const maxLines = paged ? 3 : 2
const wrapped = []
for (const field of entries.filter((e) => e.type !== 'title' && e.help)) {
  const owner = groups.find((g) => g.fields.includes(field))
  await openGroup(owner?.label ?? '')
  const n = await helpLines(field.help)
  if (n > maxLines || n < 1) wrapped.push(`${field.label}=${n < 0 ? '没找到' : n + ' 行'}`)
}
// 病根是**两列半宽**下的四五行，不是「说明必须恰好一行」：单列 462px 里说明折成两行是正常的。
check(`排版：每项说明至多 ${maxLines} 行（没有折成四五行的）`, wrapped.length === 0, wrapped.join('、') || `全部 ≤${maxLines} 行`)

// 留档截图前回到第一组：上面的检查会一组组点过去，停在哪一组取决于断言顺序，
// 截图要的是「稳定可复现的那一屏」而不是「最后一个被点到的那一屏」。
if (hasNav && groups.length) await openGroup(groups[0].label)
await sleep(300)

mkdirSync(PREFIX.split('/').slice(0, -1).join('/') || '.', { recursive: true });
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${PREFIX}.png`, Buffer.from(shot.result.data, 'base64'));
console.log(`\n结果: PASS ${pass} / FAIL ${fail}  截图 -> ${PREFIX}.png`);
ws.close(); proc.kill();
process.exit(fail ? 1 : 0);
