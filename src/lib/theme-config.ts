import { useEffect, useState } from "react"

import { api } from "@/lib/api"
import { DEFAULTS, normalizeConfig, type ThemeConfig } from "@/lib/site-settings"

/**
 * 站点级设置：只存 Hub（`/api/themes/<short>/config`），一个站一份，不落访客的浏览器——
 * 访客自己的偏好（深浅色）才用 localStorage。后台「主题设置」表单按 theme.json 的
 * `config` 现画，两边靠 key 对上；默认值与收窄规则在 `site-settings.ts`（那里能单测），
 * `scripts/check-config.mjs` 在打包前兜底。
 */
const SHORT = "kanso"

/**
 * 本站约定的位置（`/chicken/`）上有没有装那座小鸡农场。装了就把入口指过去，没装就什么都不显示——
 * 「装主题」与「部署小鸡农场」是两件事，不能因为装了主题就多出一枚点不到东西的图标。
 *
 * 没有设置项：探测就是唯一的来源，挂载即探一次。
 *
 * ★ 判据是**内容**而不是状态码：hub 对未知路径会回落到当前主题的 `index.html` 并回 200，
 * 所以 `/chicken/` 在「装了」与「没装」两种情况下都是 200 —— 拿状态码探等于恒真。
 * 小鸡农场的 location 里有一条 `^~ /chicken/api/` 反代到 hub，回的是 JSON；
 * 没装时同一条路径同样落到 index.html（HTML），`res.json()` 会抛错。
 *
 * 代价是没装小鸡农场的站每次加载多一次请求（落回 index.html，约 1KB）；装了的那次拿到的
 * 就是它自己的节点列表。
 */
export function useLocalFarm(): string {
  const [found, setFound] = useState(false)
  useEffect(() => {
    let alive = true
    fetch("/chicken/api/nodes", { headers: { Accept: "application/json" } })
      .then((res) => res.json())
      .then((data) => {
        if (alive && data && Array.isArray(data.nodes)) setFound(true)
      })
      .catch(() => {
        // 没装、或装了但那台没回 JSON：都不显示入口，不报错、不占位。
      })
    return () => { alive = false }
  }, [])
  return found ? "/chicken/" : ""
}

/**
 * 读回本站的设置。任何失败都回落默认值：后台没存过（Hub 回 `{}`）、旧 hub 没这个接口、
 * 反代拦了——都不该让公开页白屏或缺一块。收窄规则见 `normalizeConfig`。
 */
export function useThemeConfig(): ThemeConfig {
  const [config, setConfig] = useState(DEFAULTS)
  useEffect(() => {
    let active = true
    api<Partial<ThemeConfig>>(`/themes/${SHORT}/config`)
      .then((saved) => {
        if (!active) return
        // 逐项收窄在 site-settings.ts（那里能单测）。
        setConfig(normalizeConfig(saved))
      })
      .catch(() => {
        // 取不到设置（旧 hub、反代拦了）就维持默认值：公开页照常渲染，不该白屏或缺一块。
      })
    return () => { active = false }
  }, [])
  return config
}
