import * as React from "react"

import { cn } from "@/lib/utils"

// The shell only. shadcn's card ships a header, title, description, action,
// content and footer alongside it; this theme lays out its cards itself, so all
// six were unused from the moment they were vendored. Restore one from upstream
// if a card ever needs it.
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        // 卡片这个「壳」：`rounded-2xl border bg-card`（16px 圆角 —— 与参考站一致）；
        // ★**带一层柔光阴影**（2026-10-15 起）：草稿期那版是「不带阴影、只靠描边」，
        //   但参考站的卡片是**浮**在页面上的（shadow-lg 的几何 + stone-200 的影色），
        //   那层影才是「小清新」的一半 —— 硬描边读起来是「格子」，软阴影读起来是「卡片」。
        //   暗色下不加影（黑影落在暖暗底上只会糊成一块），仍是描边当家。
        "flex flex-col gap-6 rounded-2xl border bg-card py-6 text-card-foreground shadow-lg shadow-border/60 dark:shadow-none",
        className
      )}
      {...props}
    />
  )
}

export { Card }
