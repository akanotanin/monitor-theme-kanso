import type { ReactNode } from "react"

type Props = {
  label: string
  value: ReactNode
  pct: number | null
  /** 悬停说明：核数、已用/总量这类挤不进一格、又不该丢的附加信息。 */
  title?: string
}

/**
 * 一个读数格：表名在上、读数在中、条在下 —— 卡片上四个格子（CPU / 内存 / 存储 / 负载）都是它。
 *
 * 版式是 2026-10-15 按站长给的参考站定的：表名是弱化灰的小字，读数加粗、比表名大一档（它是这一格
 * 的重心），条紧压在读数下缘、铺满整格宽 —— 与从前那套「表名与百分比同一行、条居中、底注在下」
 * 正好转了个向。
 *
 * ★ 百分比不再另外写在文字里：**读数本身就是它**（`0.75%`）。核数、已用/总量这类信息挪进
 * `title`（悬停可见），整页详情里仍然写全。
 *
 * ★ 填色是**前景色的 70%**，不是纯前景色（2026-10-08 站长反馈「进度条有些突兀，尤其服务器多的
 * 时候」）：纯前景色与正文字色相同（亮 18.7:1 / 暗 12.6:1），那是卡片上最重的一笔，一页
 * 4×N 根条（30 台就是 120 根）排下来会把读数与标签都压住。70% 合成到卡片底之后实测
 * 亮 7.0:1 / 暗 6.7:1 —— 明显轻于正文，又远高于图形判读的下限（WCAG 非文本 3:1），
 * 低百分比的短条也还认得出来。
 *
 * `pct` 为 null（这台没上报 / 这一项没有上限）时轨道留空、不画填色，读数由调用方写成「—」或
 * 「∞」：一条 0% 的实心条会被读成「用得很少」，而真相是「不知道」。
 */
export function Meter({ label, value, pct, title }: Props) {
  const filled = pct === null ? 0 : Math.min(100, Math.max(0, pct))
  return (
    <div className="min-w-0" title={title}>
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="tnum mt-0.5 truncate text-sm font-semibold leading-[18px]">{value}</div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground/70 transition-[width] duration-500" style={{ width: `${filled}%` }} />
      </div>
    </div>
  )
}
