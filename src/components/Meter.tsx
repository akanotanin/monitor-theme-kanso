import type { ReactNode } from "react"

type Props = {
  label: ReactNode
  pct: number | null
  foot: ReactNode
  empty?: ReactNode
}

/**
 * One metric: name and percentage on top, bar in the middle, raw numbers
 * underneath. Monochrome, since the length of the bar carries the message.
 *
 * 版式是「简约」一档的那一套（本主题唯一的档）：表名用前景色（只有附加说明留在弱化灰里）、
 * 进度条 4px、上下各留 6px、底注 11px。三处一起动才是那一档的观感——只把条调细、
 * 表名仍是灰的，整块看着像没对齐的旧版。
 *
 * ★ 填色是**前景色的 70%**，不是纯前景色（2026-10-08 站长反馈「进度条有些突兀，尤其服务器多的
 * 时候」）：纯前景色与正文字色相同（亮 18.7:1 / 暗 12.6:1），那是卡片上最重的一笔，一页
 * 4×N 根条（30 台就是 120 根）排下来会把读数与标签都压住。70% 合成到卡片底之后实测
 * 亮 7.0:1 / 暗 6.7:1 —— 明显轻于正文，又远高于图形判读的下限（WCAG 非文本 3:1），
 * 低百分比的短条也还认得出来。
 */
export function Meter({ label, pct, foot, empty = "—" }: Props) {
  // null means the metric has no ceiling to fill, so the bar stays empty rather
  // than reporting 0%. What replaces the percentage depends on the reason:
  // unknown for a node with no metrics, ∞ for a plan with no limit.
  const filled = pct === null ? 0 : Math.min(100, Math.max(0, pct))
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className="truncate">{label}</span>
        </span>
        <span className="tnum text-xs font-medium">
          {pct === null ? empty : `${filled < 10 ? filled.toFixed(1) : filled.toFixed(0)}%`}
        </span>
      </div>
      <div className="my-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground/70 transition-[width] duration-500" style={{ width: `${filled}%` }} />
      </div>
      <div className="tnum truncate text-[11px] text-muted-foreground">{foot}</div>
    </div>
  )
}
