// 验证「不提供主题设置」这个承诺：后台「主题」页上，本主题的卡片**没有**「主题设置」按钮、
// 也没有任何设置对话框。
//
// 原理：hub 后台是 SPA，那枚按钮只给**声明了 config 的**主题画（按 GET /api/themes 返回的
// manifest.config 现判）；这里用 CDP 拦 /api/* 发假数据（themes 列表喂目标主题真实的
// theme.json），跑的是真 React 组件 —— 「面板会不会多出一格」的判据就落在这份 manifest 上。
//
// 对照组用法（证明这个护栏真看得见配置的增删）：拿**改动前**带 config 的 theme.json 跑一遍，
// 「没有设置入口」那条必须 FAIL（那枚按钮会出现）；再拿当前这份跑，必须全 PASS。
// 只验「正确时通过」等于没验。
//
// 用法: node tools/verify_settings_dialog.mjs <theme.json> <截图前缀> [baseUrl=http://127.0.0.1:28081]
//   baseUrl 通常是 ssh -L 隧道到 hub 的本地端口。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const MANIFEST = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const PREFIX = process.argv[3] || 'shots/settings-dialog';
const BASE = (process.argv[4] || 'http://127.0.0.1:28081').replace(/\/$/, '');
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
// 站点配置喂 `{}`（有没有旧数据都无所谓——主题不再读它；喂空＝「从没保存过」的样子）。
// themes 列表喂 MANIFEST 本身：config 就是从 theme.json 读的，面板画不画那枚按钮全看它。
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
      { name: MANIFEST.name, short: MANIFEST.short, description: MANIFEST.description, version: MANIFEST.version, author: MANIFEST.author, url: MANIFEST.url, selected: true, builtin: false, config: MANIFEST.config ?? [] },
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

// ① 先断 theme.json 本身：不声明任何设置项（config 为空 / 不存在）。
const declared = (Array.isArray(MANIFEST.config) ? MANIFEST.config : []).filter((e) => e.type !== 'title' && e.key);
check('theme.json 不声明任何设置项（config 为空 / 不存在）', declared.length === 0,
  declared.length ? `声明了 ${declared.map((e) => e.key).join('、')}` : '（无）');

// ② 后台主题页渲染出来（等「安装主题」出现——这是页面本身的健康度，与按钮无关）。
// Hub 只给**声明了 config 的**主题画那枚「主题设置」按钮，所以没有 config 时等它出现会一直等不到——
// 那是被测对象的状态，不是页面没起来，别混成一句失败。
let pageOk = false;
for (let i = 0; i < 60; i++) {
  await sleep(500);
  pageOk = await js(`document.body.innerText.includes('安装主题')`);
  if (pageOk) break;
}
check('后台主题页渲染出来了', pageOk);
if (!pageOk) console.log('⚠ 页面没起来（曾遇到一次性空白页假失败）——同样的桩重跑一次再判定，不要当代码问题');

// ③ 等主题卡片真画出来（卡片标题就是 manifest 的名字），再判「有没有那枚入口」。
let cardOk = false;
for (let i = 0; i < 40 && pageOk; i++) {
  cardOk = await js(`document.body.innerText.includes(${JSON.stringify(MANIFEST.name)})`);
  if (cardOk) break;
  await sleep(400);
}
check(`主题卡片（${MANIFEST.name}）画出来了`, cardOk);

// ④ 按钮若存在，会随卡片同一批渲染出来 —— 卡片在了再等一拍，然后连查 3 次。
let btn = false;
if (cardOk) {
  await sleep(1000);
  for (let i = 0; i < 3; i++) {
    btn = btn || !!(await js(`!!document.querySelector('button[title="主题设置"]')`));
    await sleep(400);
  }
}
check('主题卡片上没有「主题设置」入口（Hub 只给声明了 config 的主题画）', !btn);
const dlg = await js(`document.querySelectorAll('[role="dialog"]').length`);
check('页面上没有设置对话框', dlg === 0, `${dlg} 个`);

mkdirSync(PREFIX.split('/').slice(0, -1).join('/') || '.', { recursive: true });
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${PREFIX}.png`, Buffer.from(shot.result.data, 'base64'));
console.log(`\n结果: PASS ${pass} / FAIL ${fail}  截图 -> ${PREFIX}.png`);
ws.close(); proc.kill();
process.exit(fail ? 1 : 0);
