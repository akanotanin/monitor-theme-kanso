/**
 * 站点级设置的「值」这一层：类型、默认值，以及 Hub 存回来的自由 JSON 怎么收窄成它们。
 *
 * 单独一个文件是为了能脱开 React 与 `@/` 别名直接跑测试（见 site-settings.test.ts）：
 * 这边最容易悄悄错的是**收窄**——旧版本存过的值读不出来时不会报错，只会静默掉回默认，
 * 站长那边看到的是「我明明开着，怎么自己关了」。
 *
 * 两边必须逐字一致的两处：theme.json 的表单（面板画什么）、这里的 DEFAULTS（页面兜底什么），
 * `scripts/check-config.mjs` 在打包前对一遍。
 *
 * 本主题只留两项设置：
 *   · `detailRemarks`：整页详情那一行备注小卡片开不开；
 *   · `themeMode`：站点明暗那一档。
 * 上一代主题的其余设置项（五档卡片形态 / 列表页顶部 / 延迟线路 / 备注位置 / 节点地球 …）都不在了，
 * 对应的旧键读到时**一律丢掉、绝不透传**——面板上已经没有那一格，页面要是还听它的，
 * 就成了「看不见的开关」（见 normalizeConfig）。
 */

export type ThemeConfig = {
  /**
   * 整页详情那一行备注小卡片显不显示（默认显示）。
   * 卡片那一侧的底注行不受这一档影响：最多摊 3 枚（2026-10-15 卡片改版后的口径）。
   */
  detailRemarks: boolean
  /** 站点用哪一档明暗：随系统 / 随北京时间自动 / 固定亮 / 固定暗（访客自己的开关优先）。 */
  themeMode: ThemeMode
}

/** 四档明暗：`system` 随系统、`auto` 按北京时间自动、`light`/`dark` 固定。 */
export type ThemeMode = "system" | "auto" | "light" | "dark"

/** 四档的取值与顺序（后台那格下拉、`normalizeConfig` 都照它）。 */
export const THEME_MODES: ThemeMode[] = ["system", "auto", "light", "dark"]

export const DEFAULTS: ThemeConfig = {
  // 详情页备注默认摊：与从前「两边都摊」在详情页这一侧的行为一致。
  detailRemarks: true,
  // 明暗默认「随系统」：与没有这一项之前的行为一致（那时就是跟着系统走）。
  themeMode: "system",
}

/**
 * 收窄 Hub 存回来的设置。逐项收窄类型：Hub 存的是自由 JSON，站长清空输入框可能留下空串或 null，
 * 直接展开会让一个空串把默认值顶掉。
 *
 * ★只输出 ThemeConfig 里声明过的键。旧键（cardStyle / listTop / pingLines / remarkPlacement /
 * globeOn / farmUrl / showFarmEntry / showSummary / showGroupTabs / siteIcon …）一律不再读——
 * 它们对应的设置项都已经不在面板上了，读它们等于留了一个站长关不掉的暗开关。
 */
export function normalizeConfig(saved: unknown): ThemeConfig {
  const s = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>
  return {
    // 开关：只认真布尔。老站点配置里没有这个键（→ 默认显示）；写成 "false" 这种字符串不算数。
    detailRemarks: typeof s.detailRemarks === "boolean" ? s.detailRemarks : DEFAULTS.detailRemarks,
    // 四档明暗：认不出来的取值（旧版本、手改）回落默认，别让页面卡在一个不存在的档上。
    themeMode: THEME_MODES.includes(s.themeMode as ThemeMode) ? (s.themeMode as ThemeMode) : DEFAULTS.themeMode,
  }
}

/**
 * 北京时间（UTC+8）现在是几点（0–23）。
 *
 * 用固定偏移而不是 `Intl`：中国全境不实行夏令时，UTC+8 就是北京时间；`Intl` 那套在
 * 少数老浏览器/精简 ICU 上会抛，而这里要的只是一个钟点。
 */
export function beijingHour(at: Date = new Date()): number {
  return (at.getUTCHours() + 8) % 24
}

/** 「随北京时间自动切换」的夜间窗口：**19:00 起、次日 07:00 止**（用暗色）。 */
export const NIGHT_FROM = 19
export const NIGHT_TO = 7

/** 按北京时间算，现在是不是夜里（该用暗色）。 */
export function isBeijingNight(at: Date = new Date()): boolean {
  const h = beijingHour(at)
  return h >= NIGHT_FROM || h < NIGHT_TO
}

/**
 * 站点设置 + 系统的明暗偏好 → 最终该不该用暗色。
 *
 * `auto` 只按钟点走（不查日出日落：那要经纬度与天文算法，而站长要的是「白天亮、晚上暗」）；
 * 访客自己点过那枚太阳/月亮图标的话，组件会拿他的选择**压过**这里的结论。
 */
export function resolveDark(mode: ThemeMode, systemDark: boolean, at: Date = new Date()): boolean {
  if (mode === "dark") return true
  if (mode === "light") return false
  if (mode === "auto") return isBeijingNight(at)
  return systemDark
}
