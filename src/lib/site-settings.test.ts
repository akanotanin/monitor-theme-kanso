// 站点设置的取值与收窄：旧版本存过的值必须还能读出来，旧键一律不再透传。
// 跑法同另外几个：`npm test`（Node 自己剥类型，不需要 runner）。没有任何东西 import 它，不进 bundle。
//
// 本主题只有两个设置项（detailRemarks / themeMode）。下面双向断「theme.json 声明了没 /
// DEFAULTS 兜底了没」——半截状态（字段删了、对话框还画着一格）最难发现；同时断上一代主题的
// 旧键（cardStyle / listTop / pingLines / remarkPlacement / globeOn …）不再冒出多余字段——
// 旧键对应的那一格已经不在面板上，读取它等于留了一个站长关不掉的暗开关。
import { readFileSync } from "node:fs"

import { beijingHour, DEFAULTS, isBeijingNight, normalizeConfig, resolveDark } from "./site-settings.ts"

let failed = 0
function eq(got: unknown, want: unknown, what: string) {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)]
  if (a !== b) {
    failed++
    console.error(`✗ ${what}\n    得到 ${a}\n    期望 ${b}`)
  }
}

// ── normalizeConfig：逐项收窄 ────────────────────────────────────────
// 整对象比较按 key 排序，免得属性书写顺序不同被当成不一致。
const sorted = (o: unknown) => JSON.stringify(Object.fromEntries(Object.entries(o as Record<string, unknown>).sort()))
eq(sorted(normalizeConfig(null)), sorted(DEFAULTS), "什么都没存 → 全默认")
eq(sorted(normalizeConfig({})), sorted(DEFAULTS), "空对象 → 全默认")
eq(normalizeConfig({ detailRemarks: false }).detailRemarks, false, "关掉详情页备注：原样读回")
eq(normalizeConfig({ detailRemarks: "false" }).detailRemarks, true, "字符串 false 不算数 → 默认显示")
eq(normalizeConfig({ detailRemarks: null }).detailRemarks, true, "null → 默认显示")
eq(normalizeConfig({ themeMode: "dark" }).themeMode, "dark", "明暗四档原样读回")
eq(normalizeConfig({ themeMode: "auto" }).themeMode, "auto", "auto（按北京时间）也原样读回")
eq(normalizeConfig({ themeMode: "nope" }).themeMode, "system", "认不出的明暗 → 回落默认")

// ── 旧键不再进配置 ──────────────────────────────────────────────────
// 这些键来自上一代主题或更早的版本（五档卡片形态、列表页顶部、延迟线路、备注位置、节点地球、
// 农场入口、站点图标、服务器备注…）。两个方向都断：不许出现在 normalizeConfig 的输出里，
// 也不许带来多余字段——只断一边会漏掉「字段删了、页面还听着」这种半截状态。
const oldKeys = [
  "cardStyle", "listTop", "pingLines", "remarkPlacement", "globeOn",
  "farmUrl", "showFarmEntry", "showSummary", "showGroupTabs", "siteIcon", "serverNotes",
]
for (const key of oldKeys) {
  const got = normalizeConfig({ [key]: "x", themeMode: "dark" })
  eq(Object.keys(got).includes(key), false, `老键 ${key} 不再进主题配置`)
  eq(Object.keys(got).sort(), ["detailRemarks", "themeMode"], `老键 ${key} 不带来多余字段`)
  eq(got.themeMode, "dark", `老键 ${key} 不影响新键的取值`)
}

// ── auto 档：北京时间夜里那三个纯函数（2026-10-15 审出来：此前零覆盖）─────────
// 边界就是 `h >= 19 || h < 7` 与 `(getUTCHours() + 8) % 24`：把 `>=` 写成 `>`、或 %24 写错，
// 选 auto 的站点会整晚不切换，而别的断言照旧全绿。
{
  const utc = (h: number, m = 0) => new Date(Date.UTC(2026, 0, 1, h, m))
  eq(beijingHour(utc(10, 59)), 18, "UTC 10:59 → 北京 18 点")
  eq(beijingHour(utc(16)), 0, "UTC 16:00 → 北京 0 点（% 24 回绕）")
  eq(isBeijingNight(utc(10, 59)), false, "北京 18:59 还不是夜里")
  eq(isBeijingNight(utc(11)), true, "北京 19:00 就是夜里（含下界）")
  eq(isBeijingNight(utc(22, 59)), true, "北京 06:59 仍在夜里")
  eq(isBeijingNight(utc(23)), false, "北京 07:00 已经不是夜里（不含上界）")
  eq(resolveDark("light", true, utc(14)), false, "light 档不看系统也不看钟点")
  eq(resolveDark("dark", false, utc(2)), true, "dark 档不看系统也不看钟点")
  eq(resolveDark("system", true, utc(2)), true, "system 档跟系统（哪怕是北京的白天）")
  eq(resolveDark("system", false, utc(14)), false, "system 档跟系统")
}

// ── 护栏：theme.json 的字段与 DEFAULTS 必须一一对上 ──────────────────
const manifest = JSON.parse(readFileSync(new URL("../../theme.json", import.meta.url), "utf8"))
const fields = manifest.config.filter((f: { type: string }) => f.type !== "title")
const keys = fields.map((f: { key: string }) => f.key).sort()
eq(keys, Object.keys(DEFAULTS).sort(), "theme.json 的字段与 DEFAULTS 的键一致")
eq(fields.length, 2, "就是 2 个设置项（面板一页平铺的单列版式）")

if (failed) {
  console.error(`\n站点设置：${failed} 条不通过`)
  process.exit(1)
}
console.log(`站点设置：全部通过（含 ${fields.length} 个设置项的护栏）`)
