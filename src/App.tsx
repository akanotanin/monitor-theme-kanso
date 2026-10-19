import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Moon, Sun, Wrench } from "lucide-react"

import { NodeCard } from "@/components/NodeCard"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { api, useNodes, type Node } from "@/lib/api"
import { useLocalFarm } from "@/lib/farm-entry"
import { FarmIcon } from "@/components/FarmIcon"

type Me = {
  authed: boolean
  github: boolean
  site_name: string
  public_page: boolean
  /** hub 的历史保留天数（1~365，1.3.2 起默认 30）。老 hub 不给：时间范围按 7 天算（@/lib/ranges）。 */
  history_days?: number
}

// The tab title cache key, shared with the inline script in index.html. Kept as the
// theme's own key so two themes on one origin cannot fight over it.
const TITLE_CACHE_KEY = "kanso:site_name"

// 页脚署名（右下角那行）里指向的源码仓库 —— 与 theme.json 的 `url` 是同一个地址
// （面板卡片上的「源码」也指这里）。三处一起改（这里 / theme.json / tools/verify_footer_credit.mjs）。
const REPO_URL = "https://github.com/akanotanin/monitor-theme-kanso"

// Split out because the list page draws no chart: the detail view (with its own
// hand-drawn charts) travels as its own chunk — 17.8 kB raw / 6.9 kB gzipped as
// of 1.26.x (the recharts era's 391 kB is long gone; the split survives because
// visitors who never open a node still shouldn't pay for it). 取它的时机见 App 里的
// warmDetail：列表画完之后空闲时取、指针落到卡片上时立刻取、开页就在详情页时立刻取。
const loadDetail = () => import("@/components/NodeDetail").then((m) => ({ default: m.NodeDetail }))
const NodeDetail = lazy(loadDetail)

/**
 * 详情页的骨架：按详情页真实的那几块摆（标题行 + 规格格 + 页签行 + 五张图），
 * 不是一枚 `h-96`。它露面的场景只有一个 —— 点开时图表 chunk 还没到（见下面 warmDetail），
 * 所以它的高度必须跟加载完的内容一样，否则那一下会「先塌再撑」。
 *
 * 尺寸不另立一套，全跟着详情页自己那几块的类走：`dt` text-xs(16) + `dd` text-sm(20)、
 * 页签 py-1 + text-xs = 24、图块 = 小标题 mb-2 + `h-40`、五张图之间 space-y-5、
 * 规格格那层用同一套 grid 断点。于是手机上（一列）与桌面上（三列）都自动对上。
 *
 * ★两处「差一块就差几十 px」的地方（都踩过，护栏 verify_detail_preload 会照出来）：
 *   ① **五张图是页签块的兄弟、不是孩子** —— 嵌进去的话，页签与图之间那 16px 变成 8px，
 *      整页少 8px；（2026-10-06 修）
 *   ② **TCP / UDP 连接那一格**（2026-10-15 修）—— 详情页 2026-10-14 加了连接数、2026-10-15
 *      合成一格（真实页 7 格），骨架还画 6 格：桌面三列多出一行（+48px）、手机一列多出两行（+96px）。
 *      判法与真实页同源（那边 `const m = node.metrics`）：`metrics` 在才画这一格（离线机器它隐身、
 *      真实页也是 6 格），所以由调用方按 `node.metrics` 传入。
 *
 * （2026-10-16：详情页删了备注块——备注只显示在卡片上——骨架里那一块也一并撤掉。）
 */
function DetailSkeleton({ hasConnections = false }: { hasConnections?: boolean }) {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex items-center gap-2">
        <Skeleton className="size-6 shrink-0 rounded-[3px]" />
        <Skeleton className="h-7 w-44" />
      </div>
      <div className="grid gap-x-6 gap-y-3 md:grid-cols-2 lg:grid-cols-3">
        {(hasConnections ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5]).map((i) => (
          <div key={i} className="min-w-0">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-5 w-28" />
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t pt-4">
        <div className="flex gap-1">
          <Skeleton className="h-6 w-12" />
          <Skeleton className="h-6 w-16" />
        </div>
        <div className="flex gap-1">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-6 w-16" />
        </div>
      </div>
      {/* 五张资源图：整页详情的默认页签就是它，所以骨架照它的高度来。
          ★它是上面那个页签块的**兄弟**（真实页里也是），别嵌进去。
          ★2026-10-16：这一层原来误用 `space-y-3`（真实页是 `space-y-5`，四张图就差 24px ——
          恰好贴着护栏 ±24 的容差边缘没被照出来）；加第五张图后差额会到 32px，一并改对。 */}
      <div className="space-y-5">
        {[0, 1, 2, 3, 4].map((i) => (
          // 每块都照**白卡**摆（正文里的 Panel 2026-10-15 起就是卡）：
          // 卡壳 = rounded-2xl + 1px 描边 + px-4 py-3，里面 h4(16+mb8) + h-40 图，
          // 合计 12+24+160+12+2 = 210px。高度不硬编码，跟着这几层自己长——改卡壳时两边一起改。
          <div key={i} className="rounded-2xl border bg-card px-4 py-3 shadow-lg shadow-border/60 dark:shadow-none">
            <Skeleton className="mb-2 h-4 w-16" />
            <Skeleton className="h-40 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

// `/node/{id}` is a real page: it survives a reload, can be linked to, and back
// leaves the detail view rather than the site. The hub serves index.html for any
// unknown path, so no server-side route is required.
//
// ★（2026-10-16）搜索整个删掉后，地址栏只剩两个地址：列表是 `/`、详情是 `/node/{id}`。
//   没有别的状态要复原，「后退 / 前进」就只是把 id 从路径里读回来。
function useNodeRoute() {
  const read = () => {
    const match = location.pathname.match(/^\/node\/(\d+)/)
    return match ? Number(match[1]) : null
  }
  const [id, setId] = useState(read)
  useEffect(() => {
    const sync = () => setId(read())
    addEventListener("popstate", sync)
    return () => removeEventListener("popstate", sync)
  }, [])
  return [
    id,
    (next: number | null) => {
      const target = next === null ? "/" : `/node/${next}`
      // ★同址不 push（2026-10-15 审出来）：站名按钮在列表页点一下也会 push 一条与当前逐字相同的
      //   记录，之后「后退」第一次看着像没反应（URL 没变、页面没动）。相同就只回到顶部。
      // ★（2026-10-16 审出）判据只看 pathname、不看查询串：搜索删掉后列表地址可能残留 `?q=…`
      //   （老书签 / 历史条目），带着查询串比会把「同一个列表」当换址、再 push 一条死记录。
      //   详情页 `?tab=` 由页签自己写，也不该参与这里的判断。
      if (target !== location.pathname) history.pushState({}, "", target)
      setId(next)
      scrollTo(0, 0)
    },
  ] as const
}

const DARK_MEDIA = matchMedia("(prefers-color-scheme: dark)")

// ★媒体查询的订阅函数放在**模块作用域**（2026-10-15 审出来）：写成组件里的内联箭头时身份每次渲染
// 都变，useSyncExternalStore 于是在每次提交都退订再订阅（实测每次数据更新多一对 add/remove）。
const subscribeSystemDark = (notify: () => void) => {
  DARK_MEDIA.addEventListener("change", notify)
  return () => DARK_MEDIA.removeEventListener("change", notify)
}
const readSystemDark = () => DARK_MEDIA.matches

/**
 * The visitor's own choice, or the system's while there is none. Only the toggle
 * writes the choice down: persisting the system's answer on load would pin it,
 * leaving a visitor who never touched the toggle in whichever mode their system
 * happened to be in that day. The panel at `/admin/` shares this key on one
 * origin, so it has to hold to the same rule -- one app writing on load pins the
 * others.
 *
 * The system's answer is subscribed to rather than copied into state: a flip
 * landing between the first render and the effect that would have attached the
 * listener is otherwise never heard, and the next one is a day away.
 */
function useTheme() {
  // ★ 必须接住异常：浏览器禁用站点数据时，连 `localStorage` 的**读取**都会抛 SecurityError ——
  //   在 `useState` 初始化器里抛 = 首次渲染炸掉、整页空白（hub 1.4.1 release note 点名的那条，
  //   官方两个主题在随附新版里修的就是它）。读不到就当「没存过」，照常跟系统。
  const [saved, setSaved] = useState(() => {
    try {
      return localStorage.getItem("theme")
    } catch {
      return null
    }
  })
  const system = useSyncExternalStore(subscribeSystemDark, readSystemDark)
  // 默认跟访客的系统走；访客点过那枚图标（localStorage 里有 `theme`）就以他的为准。
  // （1.6.0 起没有任何站点设置项，这里已经没有「站长那一档」可读。）
  const dark = saved ? saved === "dark" : system

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    // 原生滚动条 / 控件跟着页面明暗。**首帧**那份在 index.html 的内联脚本里（它必须赶在
    // 入口包之前跑，见 check-config）；这里是运行时的同一件事 —— 访客点过顶栏那枚图标之后，
    // 两边必须仍然是同一个口径。
    document.documentElement.style.colorScheme = dark ? "dark" : "light"
    /**
     * 手机浏览器那一圈（地址栏 / 状态栏）的配色（`theme-color`）跟着**页面实际用的**明暗走。
     *
     * index.html 里那两份是静态值、按**系统**明暗挑的；访客用顶栏那枚图标覆盖过之后，
     * 页面明暗可能与系统相反，两边就会打架 —— 所以这里先把那两份摘掉，再挂一份没有 media 的。
     * 颜色取 `--background` 的**实际值**（oklch 交给 canvas 读回 sRGB），不手抄 hex，免得跟 token 漂移。
     */
    const head = document.head
    for (const old of head.querySelectorAll('meta[name="theme-color"]')) old.remove()
    const meta = document.createElement("meta")
    meta.name = "theme-color"
    let color = dark ? "#0d0c0a" : "#fafaf9"
    const probe = document.createElement("canvas")
    probe.width = probe.height = 1
    const ctx = probe.getContext("2d")
    if (ctx) {
      // 先铺兜底色：老浏览器不认 oklch 时这次赋值会被忽略，留下的就是它。
      ctx.fillStyle = color
      ctx.fillStyle = getComputedStyle(document.body).backgroundColor
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      color = `rgb(${r}, ${g}, ${b})`
    }
    meta.content = color
    head.append(meta)
  }, [dark])

  return [
    dark,
    () => {
      const next = dark ? "light" : "dark"
      // 点成与系统当前一致时**删掉记录**（= 重新跟着系统走，与访客偏好同一套口径）。
      const record = (next === "dark") === system ? null : next
      try {
        if (record === null) localStorage.removeItem("theme")
        else localStorage.setItem("theme", record)
      } catch {
        // 存储被禁用（隐私模式）：这次会话照样切，只是记不住。
      }
      setSaved(record)
    },
  ] as const
}

export default function App() {
  // 明暗：默认跟访客的系统走，访客点过顶栏那枚图标就以他记下的为准（1.6.0 起没有设置项）。
  const [dark, toggleTheme] = useTheme()
  // 顶栏那枚入口图标（1.25.0 起没有设置项）：挂载即探一次本站约定的 `/chicken/`，
  // 装了那座小鸡农场才出现、没装不占位（判据是内容而不是状态码，见 useLocalFarm）。
  const farmUrl = useLocalFarm()
  const [me, setMe] = useState<Me | null>(null)
  const [meError, setMeError] = useState("")
  const { nodes, error, closed } = useNodes()
  const [open, go] = useNodeRoute()

  const loadMe = useCallback(() => {
    // `|| "..."`: 空消息读起来像「没有错误」—— api() 现在会给 HTTP 状态兜一句中文，
    // 但网络层/旧路径仍可能给空串；这一层别让重试按钮因此消失。
    return api<Me>("/me")
      .then((next) => { setMe(next); setMeError("") })
      .catch((e: Error) => setMeError(e.message || "网络错误"))
  }, [])

  useEffect(() => {
    loadMe()
  }, [loadMe])

  /**
   * 详情页那块 chunk（自绘图表，17.8KB / gzip 6.9KB——recharts 那 391KB 已换掉，
   * 见上面 loadDetail）什么时候取：三条路，谁先到听谁的。
   *
   *   ① 开页就在详情页（书签、刷新、别人分享的链接）：立刻取 —— 它就是要画的那一块。
   *   ② 列表画出来之后：交给浏览器挑空闲时机取。放在这里而不是挂载时取，是不和首屏的
   *      入口包与第一批数据抢同一条链路；列表已经在眼前了，它才没有别的事可挤。
   *   ③ 指针或键盘落到某张卡片上（悬停、聚焦、触摸）：立刻取。真要打开一台机器的人，
   *      鼠标按下去之前通常已经摸过那张卡片了，所以点开时它多半已经在本地。
   *
   * 代价写在明面上：列表出来不到一秒就点开的那一下，看到的会是骨架屏而不是空白 ——
   * 换来的是**每个访客（包括从不点开任何一台机器的人）不再为一块用不上的代码付首屏带宽**。
   */
  const warmed = useRef(false)
  const warmDetail = useCallback(() => {
    if (warmed.current) return
    warmed.current = true
    void loadDetail()
  }, [])
  const listReady = nodes !== null
  useEffect(() => {
    if (warmed.current) return
    if (open !== null) { warmDetail(); return }
    if (!listReady) return
    // 列表那一帧真的画出去之后才轮到这块 chunk：先连等两帧（第一帧的 rAF 回调还跑在
    // 「列表即将上屏」之前，第二帧才是它已经在屏幕上了），再交给浏览器的空闲回调。
    // 标签页不在前台时 rAF 会停住，切回来才补上——那时也正没人在点开任何一台机器。
    let idle = 0
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        // Safari 到 18 才补上 requestIdleCallback：没有它就直接取，效果一样。
        if (typeof requestIdleCallback === "function") idle = requestIdleCallback(warmDetail, { timeout: 2000 })
        else warmDetail()
      })
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
      if (idle) cancelIdleCallback(idle)
    }
  }, [open, listReady, warmDetail])

  // The status page was closed while this tab was open. `me` holds whatever it
  // reported at load, so it is re-queried; the effect below then directs an
  // anonymous visitor to the panel rather than leaving them on a list that
  // stopped updating with only a red line to explain it.
  useEffect(() => {
    if (closed) void loadMe()
  }, [closed, loadMe])

  useEffect(() => {
    if (me && !me.public_page && !me.authed) location.href = "/admin/"
  }, [me])

  // 沉底：**没有实时数据的机器**一律排到列表最末尾（站长 2026-10-14 的口径「离线服务器的
  // 卡片排到所有卡片的最末尾」；2026-10-15 按预览站实测扩了判据——那里「连上但从未上报」
  // 的卡片也没沉底）。判据 = `online && metrics`：hub 对一个连上但还没上报的 agent 答的是
  // `online: true` + `metrics: null`（agent_ws.rs 里「在线」与「有当前数据」是同一个事实；
  // 重连后一个上报间隔内也是这个长相）——卡面读数全是「—」，跟离线机一样不该占在线段的
  // 位置。「离线」（`online` 为假：曾接入掉线 / 从未接入）走同一条。
  // 仍按站长排序（`sort`，并列再按 `id`），所以这只是在排序键前面加了一层「有数据 0 /
  // 没有 1」——同一台机器在两次帧之间的位置是确定的，不会自己抖动。
  // ★排序记忆化（2026-10-15 审出来）：原来每 2 秒一帧数据都要重排一遍。键就是它的输入。
  const sorted = useMemo(() => [...(nodes ?? [])].sort((a, b) => {
    const hasData = (n: typeof a) => Number(!!(n.online && n.metrics))
    return hasData(b) - hasData(a) || a.sort - b.sort || a.id - b.id
  }), [nodes])
  const selected = sorted.find((n) => n.id === open)

  /** 进详情 / 回列表。 */
  const openNode = (id: number) => go(id)
  const openList = () => go(null)

  // `/node/{id}` is a page people bookmark and share, so the tab needs the node's
  // name. The site name rather than a fixed string, since the hub lets an operator
  // rename the site.
  //
  // Nothing is written until `me` is in: while it is missing the only value we could
  // write is the placeholder, and that shows up as the tab flipping through one more
  // title on every load. One write, the right one — and it is remembered so that the
  // next reload starts on the real name instead of the placeholder (index.html).
  useEffect(() => {
    if (!me) return
    const siteName = me.site_name || "Monitor"
    // Claim the tab: index.html's inline script fetches /api/me on a cold visit and may
    // answer seconds later. Once this runs, that response must not overwrite the title —
    // on `/node/{id}` it would drop the node name.
    ;(window as unknown as { __titleOwned?: boolean }).__titleOwned = true
    document.title = [selected?.name, siteName].filter(Boolean).join(" · ")
    try {
      localStorage.setItem(TITLE_CACHE_KEY, siteName)
    } catch {
      // Private mode / storage disabled: the tab still gets its title, reloads just
      // fall back to the placeholder.
    }
  }, [selected?.name, me])

  // Only while there is nothing else to show. Once `me` has loaded, a later
  // failure belongs beside the page rather than over it.
  if (!me) return (
    <div className="grid min-h-svh place-items-center p-6 text-sm text-muted-foreground">
      {meError ? <div className="space-y-3 text-center"><p role="alert">加载失败：{meError}</p><Button onClick={loadMe}>重试</Button></div> : "加载中…"}
    </div>
  )

  // The status page is closed and nobody is signed in: redirect to the panel.
  if (!me.public_page && !me.authed) return null

  return (
    // 纵向排下来、页脚吊在最后（main 吃满剩余高度）：机器少、内容比一屏短时，
    // 署名也落在屏幕的右下角，而不是紧贴在列表底下浮在半空中。
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        {/* ★ 窄屏的横向余量很紧（390 宽上这一行原本要 407px，整页因此能横向拖动）。现在按
            「**站名优先展开、图标自己滑**」分：站名那格 max-w-[55%]（正常名字完整显示，
            只有长到离谱才轮到 truncate），剩下几枚图标装进一条能横向滑动的条带里 ——
            装不下就滑，不裁字、也不把整页撑宽（「装不下就滑」这套做法最初用在分组标签行上，
            那一行随分组功能在 1.0.0 一起删了，现在只剩这条图标带）。
            ★2026-10-16 搜索整个删掉后，站名与条带之间只剩一段 flex-1 空白。 */}
        <div className="mx-auto flex max-w-[1080px] items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6">
          {/* 读屏与大纲的 h1：视觉上站点名就是那枚按钮，而 h1 包进 <button> 不合法，
              所以这里放一枚视觉隐藏的同名标题，页面标题层级从 h1 起（2026-10-18 审出）。
              `sr-only` 是绝对定位，不参与这一行的布局。 */}
          <h1 className="sr-only">{me.site_name || "Monitor"}</h1>
          {/* The site name is the way back to the list, so a node page needs
              no back button of its own. A 32px disc of the site's icon leads
              it — `/favicon.svg` is the one address that answers with the
              panel's site icon (or the theme's own when none is set). */}
          <button className="tap tap-8 flex max-w-[55%] shrink-0 items-center gap-2.5 font-semibold transition-opacity hover:opacity-70" onClick={openList}>
            <SiteIcon />
            <span className="truncate">{me.site_name || "Monitor"}</span>
          </button>
          <div className="flex-1" />
          {/* ★ 图标条带：装不下就**横向滑动**（这条做法与 1.0.0 起已删的分组标签行同源）。
              py/px 是给 .tap 那圈 ±6px 的命中区留地方 —— 被 overflow 裁掉的话命中区只剩 36
              （护栏会当场报出来）。条带里的间距固定 12px：两枚图标的命中区各向外 6px，
              正好在缝里相接，不多不少（8px 会重叠、护栏也会报）。
              滑动条藏起来（见 index.css 的 .header-tools）：它长在 sticky 顶栏里，露出来
              就是一条横杠；「还能滑」的提示由露一半的那枚图标给。 */}
          <div className="header-tools -my-1.5 -mr-1.5 flex min-w-0 items-center gap-3 overflow-x-auto px-1.5 py-1.5">
          {/* The panel is a separate app built into the hub, not part of this
              theme, so this is a navigation rather than a route. Icon only, with
              the wording in the tooltip: this row is a strip of icons, and a
              label here would push the site name aside on a phone. */}
          <Button variant="ghost" size="icon" asChild>
            <a
              href="/admin/"
              title={me.authed ? "进入后台" : "登录"}
              aria-label={me.authed ? "进入后台" : "登录"}
            >
              <Wrench />
            </a>
          </Button>
          {/* 入口图标：本站 `/chicken/` 上真装了那座小鸡农场才出现（自动探测，见 useLocalFarm）；
              同域，就在当前标签页里打开。 */}
          {farmUrl && (
            <Button variant="ghost" size="icon" asChild>
              <a href={farmUrl} title="农场入口" aria-label="农场入口">
                <FarmIcon />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            data-theme-toggle=""
            // 动态说「点下去会发生什么」：固定的「切换主题」读屏不知道当前明暗（2026-10-20 审出）。
            title={dark ? "切换到浅色主题" : "切换到深色主题"}
            aria-label={dark ? "切换到浅色主题" : "切换到深色主题"}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1080px] flex-1 space-y-5 px-4 py-4 sm:px-6">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {open !== null ? (
          !nodes ? (
            <DetailSkeleton />
          ) : selected ? (
            <Suspense fallback={<DetailSkeleton hasConnections={!!selected.metrics} />}>
              {/* 整页详情：保留天数要一起给它（时间范围那排按钮按它生成）。 */}
              <NodeDetail node={selected} historyDays={me.history_days} />
            </Suspense>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">
              节点不存在或未公开。<button className="underline" onClick={openList}>返回列表</button>
            </p>
          )
        ) : !nodes ? (
          // 还在等节点列表：骨架与卡片网格同一版式。
          // 高度跟着卡片来 —— 2026-10-15 卡片改成参考站那一套（身份行 + 系统行 + 四个读数格 +
          // 上传下载 + 总流量 + 底注）之后，六种卡片一律 510×217.5（底注行恒定占位），
          // 骨架取 218 去贴（见 tools/verify_card_form）。
          <div className="grid gap-3 md:grid-cols-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[218px] rounded-2xl" />
            ))}
          </div>
        ) : (
          <NodeList nodes={sorted} onOpen={openNode} onWarm={warmDetail} />
        )}
      </main>

      {/* 页脚署名：一行浅色小字。桌面在右下角（右对齐、比内容右沿往左收 12px）；手机上**收进一个
          带上分割线的页脚带**里居中 —— 2026-10-07 站长两轮反馈：先嫌「右下角一行孤零零的灰字
          像水印」（改居中），再说「还是得改个位置、要和谐美观不突兀」。根因是它**没有结构**：
          一行灰字悬在卡片下面，既不像页脚、也不像卡片的一部分。加一条 1px 上分割线（与顶栏的
          border-b 呼应，页面上下就都框住了），留白按「卡→线 24px、线→字 16px、字→底 20px」
          拉开，它才读成一个明确的页脚区。分割线只出现在窄屏（<640px，与署名居中的断点同一档）
          —— 为手机改的东西不落到电脑端，桌面维持原样。
          （2026-10-12：站上短暂加过一枚「更新于 N 秒前」的数据年龄行，当天按站长要求撤掉 ——
           页脚回到这一行署名的最简形态。）
          「Kanso」那截点开去本主题的源码仓库 —— 新标签页打开，别把访客从状态页带走
          （链接地址与 theme.json 的 url 是同一个，见上面的 REPO_URL）。
          样式见 index.css 的 .theme-credit。 */}
      <footer className="mx-auto mt-2 w-full max-w-[1080px] border-t px-4 pb-5 pt-4 sm:mt-0 sm:border-t-0 sm:px-6 sm:pb-5 sm:pt-1">
        <p className="theme-credit text-center sm:pr-3 sm:text-right">
          Theme:{" "}
          {/* ★REPO_URL 是常量（非空），原来那个三元里的 else 分支永远走不到 —— 2026-10-18 删。 */}
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Kanso
          </a>
        </p>
      </footer>
    </div>
  )
}

/**
 * 顶栏的圆形站标：**就是站点图标本身**，而且用的是**标签页那条 `<link rel="icon">` 的地址**。
 *
 * hub 1.4.0 起这条路径由面板「设置 → 站点图标」管（没设时回落到主题自带的同名文件），
 * 而且 hub 送 index.html 时会把它改写成 `?v=<内容摘要>` —— 所以「取哪张图」这件事在静态
 * HTML 里就定下来了，主题只要沿用同一条地址即可：
 *
 *   · 页头与标签页是**同一个 URL** → 浏览器只取一次、缓存共用一份（弱链路上尤其重要，
 *     以前两处各取一次会把页头那张挤掉）；
 *   · 站长换了图，hub 给的版本号就变了，浏览器自己会重新取，不需要任何早跑脚本。
 *
 * 取不到就不占位：不留一枚破图。
 */
function SiteIcon() {
  const [href] = useState(() => document.querySelector('link[rel~="icon"]')?.getAttribute("href") || "/favicon.svg")
  const [src, setSrc] = useState(href)
  const [broken, setBroken] = useState(false)
  return (
    <span className="size-8 shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-border/60">
      {!broken && (
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          onError={() => {
            // 站点图标取不到时先退回主题自带的那份；两份都挂时**保留这枚 32px 占位**，
            // 只把图撤掉 —— 原来直接 return null，顶栏左侧整块消失、站名跟着左移
            // （2026-10-20 复审出）。
            if (src !== "/favicon.svg") setSrc("/favicon.svg")
            else setBroken(true)
          }}
        />
      )}
    </span>
  )
}

/**
 * 列表**分批挂载**：先画一屏的量，剩下的分帧补上。
 *
 * 为什么不虚拟滚动：拿 100 台的夹具量过 —— 静置时每 5 秒一次的重渲染长任务是 **0**（卡片不多时
 * 重渲染本来就是免费的），DOM 11457 也撑得住；**唯一**真花钱的是首屏那一次 **255ms** 的长任务
 * （100 张卡片一次性挂上去）。虚拟滚动要处理变高卡片 + 响应式列数，改动大、风险高，却只为解决
 * 一个不存在的稳态开销。把首屏那次摊成十几小块，效果一样、代价小得多。
 *
 * 每块 12 张（约 30ms，短于 50ms 的长任务线），块与块之间用 `setTimeout(0)` 让浏览器先画一帧。
 * 少于一块的量（≤24 台）完全不改变行为 —— 护栏用的都是小夹具，不受影响。
 *
 * ★（2026-10-16）搜索删掉后不再有「筛选身份」可当重置键：台数变化只由 Math.min 夹一次、
 *   进度不重置 —— 线上多/少一台不会让列表整段重挂（那正是 2026-10-15 修掉的闪烁）。
 */
function useProgressive(total: number, first = 24, step = 12): number {
  const [limit, setLimit] = useState(() => Math.min(total, first))
  useEffect(() => {
    if (limit >= total) return
    const timer = setTimeout(() => setLimit((n) => Math.min(total, n + step)), 0)
    return () => clearTimeout(timer)
  }, [limit, total, step])
  // 台数变少时只夹这一次，不改状态：下一帧台数回来了，仍旧从原来的进度接着长。
  return Math.min(limit, total)
}

/**
 * 卡片网格：把这批机器摊成「简约」卡片（本主题唯一一档），只管画。
 * （2026-10-16 搜索整个删掉后，这里不再有筛选、描色与键盘光标。）
 */
function NodeList({ nodes, onOpen, onWarm }: {
  nodes: Node[]
  /** 进详情。 */
  onOpen: (id: number) => void
  /** 指针/键盘刚落到某一张卡片上：把详情那块 chunk 先取回来（见 App 的 warmDetail）。 */
  onWarm: () => void
}) {
  // 首屏先画一屏的量，剩下的分帧补上（见 useProgressive）。
  const limit = useProgressive(nodes.length)
  const list = nodes.slice(0, limit)
  return (
    <>
      {nodes.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">还没有节点</p>
      ) : (
        // ★ 一行两张宽卡（2026-10-15 照站长给的参考站定的：那边 768 起就是两列、卡片 508×209，
        //   整页容器约 1040）。本站容器同步收到 1080 → 两列即每张 510 宽，和参考站一样。
        //   原先的 2/3/4 列 + 1280 容器让卡片窄而高（299×266），形态差得远。
        <div className="grid items-start gap-3 md:grid-cols-2">
          {list.map((n) => (
            <NodeCard key={n.id} node={n} onOpen={() => onOpen(n.id)} onWarm={onWarm} />
          ))}
        </div>
      )}
    </>
  )
}
