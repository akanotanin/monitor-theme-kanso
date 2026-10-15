import { useEffect, useState } from "react"

/**
 * 顶栏那枚农场入口的探测：本站约定的位置（`/chicken/`）上有没有装那座小鸡农场。
 * 装了就把入口指过去，没装就什么都不显示——「装主题」与「部署小鸡农场」是两件事，
 * 不能因为装了主题就多出一枚点不到东西的图标。
 *
 * 没有设置项：探测就是唯一的来源，挂载即探一次（1.25.0 起如此；1.6.0 起本主题连
 * 「主题设置」都不存在，这是唯一的运行期自动发现）。
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
