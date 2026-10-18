import { useEffect, useMemo, useState } from "react"


import { TimeChart } from "@/components/Chart"
import { PingTooltip } from "@/components/ChartTooltip"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Country, deployed, offlineSeconds } from "@/components/NodeCard"
import { api, type Node } from "@/lib/api"
import {
  axisBytes, axisTop, bytes, despike, cpuName, osName, rate, uptime,
} from "@/lib/format"
import { rangesFor } from "@/lib/ranges"

type Point = {
  ts: number
  cpu: number
  mem_used: number
  disk_used: number
  net_rx: number
  net_tx: number
  /** 连接条数（hub 的历史桶里带着 `tcp / udp`；老 hub 的桶可能没有这个键——图会自行留白）。 */
  tcp?: number | null
  udp?: number | null
}
// `latency` is the bucket's median round trip, null when every probe in it timed
// out. `band` is the range its answers spanned, absent when they spanned nothing.
// `loss` is the percentage that timed out, absent when none did.
type PingPoint = {
  task_id: number
  ts: number
  latency: number | null
  band?: [number, number]
  loss?: number
}
/** Probe names by id, sent alongside the samples they label. */
type Probes = Record<string, string>
/**
 * Proportion of the whole window each probe lost, by id, absent for probes that
 * lost nothing. Sent because it cannot be derived here: every bucket's `loss` is
 * already a percentage of that bucket, so the sample counts it was divided by are
 * unavailable. Averaging them would weight a bucket holding one sample equally
 * with one holding twelve, and the window's first and last buckets are partial
 * regardless of what the probe does.
 */
type Loss = Record<string, number>

// 时间范围那排按钮由 hub 的保留天数生成（见 @/lib/ranges）：hub 1.3.2 起 `hours` 的上限就是
// 保留天数本身（登录与匿名相同），1.15.x 那排写死的 1/6/24 小时 + 7 天只对老 hub 成立。
// 两个页签共用同一组窗口——延迟页签原先停在上面的 24 小时，理由是「一周宽的桶会把抖动与丢包
// 摊平」；但那是替访客做判断：想看一周走势的人只能在资源页签里看，而延迟恰恰是资源页签给不了的
// 那条。窗口拉长不会让点数变多，hub 只会把桶放得更宽（168 小时 ≈ 9 分钟一桶，30 天以上走
// 小时汇总），所以更长的探测史仍画得下、也仍看得见趋势。
// 延迟图最多同时画四条线路，所以这里备九个色相、每个再配一版短虚线：前九条走实线，
// 第十条起色相重复、换线型。色相表是 index.css 里的 --chart-1..9，深浅两套只差亮度，
// 同一台机器在两种主题下是同一种颜色。
const COLORS = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `var(--chart-${n})`)
const PALETTE = [
  ...COLORS.map((stroke) => ({ stroke, dash: undefined })),
  ...COLORS.map((stroke) => ({ stroke, dash: "6 3" })),
]

const TABS = [
  { key: "resources", label: "资源" },
  { key: "latency", label: "网络延迟" },
] as const

/**
 * 一块面板：小标题在上、图表在下 —— 详情页里每一块都用它。
 *
 * ★ 2026-10-15 起它是**一张白卡**（`rounded-2xl border bg-card` ＋ 柔光阴影），与列表页的卡片同一副壳。
 *   从前详情页是「整页平铺、块与块靠一条硬边线分隔」—— 那是旧身份（硬描边 = 格子、白卡 = 卡片）；
 *   而参考站的详情页也正是这套白卡（它的图表块就是白卡）。列表与详情从此共用同一种面。
 *   ★上了卡壳之后每块多 26px（上下 padding 12×2 + 描边 2），**骨架屏必须同源**：
 *   `App.tsx` 的 `DetailSkeleton` 按同样的壳摆，否则点开时「先塌再撑」（verify_detail_preload 会照出来）。
 *
 * `fill`：图那一层改成「吃掉卡里剩下的高度」（网络延迟那一块：整卡被钉在一屏以内，图 `flex-1`），
 * 默认那档仍是写死的 `h-40`（Recharts 的 ResponsiveContainer 需要一个有尺寸的父亲，别让它自己去猜）。
 */
function Panel({ title, children, fill = false }: { title: string; children: React.ReactNode; fill?: boolean }) {
  return (
    <section
      className={
        "rounded-2xl border bg-card px-4 py-3 text-card-foreground shadow-lg shadow-border/60 dark:shadow-none" +
        // `h-full` 不能少：外层那层钉的是像素高度，卡不吃满它，里面的 `flex-1` 就没有可分配的高度
        // ——Recharts 量到 0 会干脆不画（2026-10-15 踩过：延迟图整个不出现，护栏三连红）。
        (fill ? " flex h-full min-h-0 flex-col" : "")
      }
    >
      <h4 className="mb-2 shrink-0 text-xs font-medium text-muted-foreground">{title}</h4>
      <div className={fill ? "min-h-0 w-full flex-1 text-muted-foreground" : "h-40 w-full text-muted-foreground"}>
        {children}
      </div>
    </section>
  )
}

/**
 * 空 / 错状态：**同一副白卡壳**，里面一行居中的话。
 *
 * 从前这几处是光秃秃一行字落在页面上（py-8 的 `<p>`）—— 与图表块的白卡面不统一，页面显得"未完成"。
 * 卡壳与 Panel 一致（2026-10-15 起），`tone` 用来把"读失败了"那一句换成 destructive。
 */
function EmptyPanel({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "error" }) {
  return (
    <div className="rounded-2xl border bg-card px-4 py-3 text-card-foreground shadow-lg shadow-border/60 dark:shadow-none">
      <p
        className={`py-8 text-center text-sm ${tone === "error" ? "text-destructive" : "text-muted-foreground"}`}
        role={tone === "error" ? "alert" : undefined}
      >
        {children}
      </p>
    </div>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      // 选中态原来只有视觉（白胶囊）：读屏听不出哪一档／哪个页签是当前选中的（2026-10-18 审出）。
      aria-pressed={active}
      className={`tap tap-y-6 rounded-full px-2.5 py-1 text-xs transition-colors ${
        // 选中态＝**白胶囊 + 轻阴影 + 加粗深字**（参考站的页签就是这样），不靠填深色或描边 ——
        // 深色实心块在暖白底上是一块黑补丁，是旧身份里最重的那个东西（2026-10-15 换掉）。
        active
          ? "bg-card font-medium text-foreground shadow-sm ring-1 ring-border"
          : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  )
}

/**
 * How many samples of a probe's own series make up seven minutes of neighbours.
 *
 * The window the filter judges against has to be a duration, not a count: the
 * hub buckets a window to the `points` asked for below, so the same day arrives
 * as one-minute buckets on a desktop and two-minute ones on a phone, and a fixed
 * count would clip a five-minute stall on the first while keeping it on the
 * second. The smallest gap is the bucket interval; a longer one is the node
 * being offline. Odd, so the window has a middle, and bounded so a sparse probe
 * still has neighbours and a dense one does not pay for a wide sort.
 */
function despikeWindow(points: { ts: number }[]): number {
  let step = Infinity
  for (let i = 1; i < points.length; i++) step = Math.min(step, points[i].ts - points[i - 1].ts)
  return Math.min(15, Math.max(3, Math.round(420 / step) | 1))
}

/**
 * 在线时间：与卡片上原先那枚状态徽章同一个时长，只是搬进信息项里——徽章占的是
 * 标题行，而标题行在手机上本来就窄。没接入（探针从没上报过）与离线是两回事：
 * 前者没有时长可言，后者写清楚已经离线多久（不足一分钟就不报数）。
 */
function onlineFor(node: Node) {
  if (node.online) return node.metrics ? uptime(node.metrics.uptime) : "—"
  if (!deployed(node)) return "未接入"
  const down = offlineSeconds(node)
  return down >= 60 ? `离线 ${uptime(down)}` : "离线"
}

/**
 * CPU 那格：`型号 × 核数`。型号或核数缺一个时只写有的那截，两个都缺就整格隐身
 * —— 旧版在这种形状下会印出「AMD EPYC × undefined」（2026-10-18 审出）。
 */
function cpuLine(node: Node): string {
  const cores = node.cpu_cores || 0
  const name = cpuName(node.cpu_name || "")
  if (name && cores > 0) return `${name} × ${cores}`
  return name || (cores > 0 ? `${cores} 核` : "")
}

function Fact({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === "") return null
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      {/* title：值都被 `truncate` 截断了（手机上 CPU 型号 / 内核名最先被截），悬停至少要能看到全文。 */}
      <dd className="truncate text-sm" title={typeof value === "string" ? value : undefined}>{value}</dd>
    </div>
  )
}

export function NodeDetail({ node, historyDays }: {
  node: Node
  /** hub 的历史保留天数（`/api/me` 的 `history_days`）；老 hub 不给，按 7 天算（见 @/lib/ranges）。 */
  historyDays?: number
}) {
  // 页签听地址栏的：`?tab=latency` 时直接落在「网络延迟」；其余一概落「资源」，与从前一致。
  // 刷新同理：URL 里带着哪个页签，落哪个。
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>(
    new URLSearchParams(location.search).get("tab") === "latency" ? "latency" : "resources",
  )
  /**
   * 切页签：顺手把 `?tab=` 同步进地址栏（replace，不往历史里塞条目）——
   * 刷一下还落在同一个页签，分享出去的链接也指得准。
   */
  const chooseTab = (key: (typeof TABS)[number]["key"]) => {
    setTab(key)
    const url = new URL(location.href)
    if (key === "latency") url.searchParams.set("tab", "latency")
    else url.searchParams.delete("tab")
    history.replaceState({}, "", url)
  }
  // Each tab keeps its own range: a 7-day trend and a 1-hour trace answer
  // different questions.
  const [ranges, setRanges] = useState({ resources: 6, latency: 6 })
  // 可选窗口按保留天数生成（老 hub 按 7 天，结果与 1.15.x 那排逐字相同）。
  const RANGES = rangesFor(historyDays)
  const RANGES_FOR = { resources: RANGES, latency: RANGES }
  const hours = ranges[tab]
  const [smooth, setSmooth] = useState(false)
  // Probes switched off. Hiding a slow one is what makes the fast ones readable,
  // as the axis rescales to what remains.
  const [hiddenProbes, setHiddenProbes] = useState<number[]>([])
  const [data, setData] = useState<{ metrics: Point[]; ping: PingPoint[]; probes: Probes; loss?: Loss } | null>(null)
  // Retained rather than folded into an empty result: a refused request and an
  // empty window are different answers, and the hub has reason to refuse this one
  // -- it caps how many history windows it builds concurrently, since each holds
  // the connection the agents report through. Rendered as an empty window, a 503
  // would misdirect the reader.
  const [failed, setFailed] = useState("")
    // Where the chart begins on screen, so its height can occupy the remainder.
  const [chartTop, setChartTop] = useState(0)
  // ★「重试」（2026-10-18）：失败后点一下就是一次真重发 —— 计数进 effect 依赖。换页签也能
  //   重发，但那是碰巧；而 503 是 hub 并发上限的**预期**失败（见下面 fetch 的注释），得有一枚
  //   明说的按钮。
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    // The charts must not continue drawing the old range while the new one is in
    // flight.
    // oxlint-disable-next-line react/set-state-in-effect
    setData(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setFailed("")
    // What this screen can resolve, in device pixels, which is the unit the line
    // is drawn in: a 1280-wide retina panel has 2560 of them for a day of minutes.
    // Read here rather than from a ref, since the hub only thins further, an
    // approximate figure suffices, and the viewport is known before layout. A
    // rotation keeps whatever it fetched with.
    //
    // The tab determines which half is requested; the other accounted for a third
    // to two thirds of every response and was never drawn.
    const points = Math.round(globalThis.innerWidth * (globalThis.devicePixelRatio || 1))
    const series = tab === "latency" ? "ping" : "metrics"
    api<{ metrics: Point[]; ping: PingPoint[]; probes: Probes; loss?: Loss }>(
      `/nodes/${node.id}/metrics?hours=${hours}&points=${points}&series=${series}`,
    )
      .then((next) => { if (active) setData(next) })
      .catch((e: Error) => {
        // `|| "..."` as in App.tsx: HTTP/2 dropped statusText, so a bodiless
        // failure from a proxy arrives as the empty string and renders as no
        // error.
        if (active) { setFailed(e.message || "网络错误"); setData({ metrics: [], ping: [], probes: {} }) }
      })
    return () => { active = false }
  }, [node.id, hours, tab, attempt])

  const m = node.metrics
  // ★2026-10-18：容量一律**实时读数优先**。顶层 mem_total / disk_total 缺失或滞后时，原来
  //   标题写「内存 · 0 B」、Y 轴只剩 0~1 B，把 600MB 的线整条裁到框外 —— 而 metrics 里同一份
  //   值就在那儿（卡片侧的口径本来就是读 metrics 的）。
  const memTotal = m?.mem_total ?? node.mem_total ?? 0
  const diskTotal = m?.disk_total ?? node.disk_total ?? 0
  // One series per probe that reported, labelled from the names the samples
  // arrived with. Memoised, as are the two below: the node prop changes every few
  // seconds as live metrics arrive, and rebuilding the chart's data array on those
  // renders would reset the brush.
  const pingSeries = useMemo(
    () =>
      [...new Set((data?.ping ?? []).map((p) => p.task_id))]
        .map((id) => {
          // Timeouts are retained: dropping them would draw a probe losing half
          // its packets as an unbroken line, and one that never answered not at
          // all.
          const points = (data?.ping ?? []).filter((p) => p.task_id === id)
          // Taken from the hub rather than summed from the buckets above, each of
          // which is already a percentage of its own bucket, so averaging them
          // would report one lost round in thirteen as 50%. Left unrounded, since
          // `Math.round` would render 0.28% and 0.00% as the same badge, and the
          // absence of a badge denotes no loss.
          const loss = data?.loss?.[id] ?? 0
          return { id, name: data?.probes?.[id] ?? `探测 ${id}`, points, loss }
        })
        .filter((s) => s.points.length > 0),
    [data],
  )

  // The hub answers in seconds; the time axis requires milliseconds.
  const metricRows = useMemo(
    () => (data?.metrics ?? []).map((m) => ({ ...m, ts: m.ts * 1_000 })),
    [data],
  )

  // Axis tops for the two panels with no capacity to measure against. CPU and a
  // transfer rate do not express fullness: against a fixed 0-100, a machine
  // sitting at 0.4% draws as a line along the panel's floor. Memory and disk keep
  // their totals as tops, where fullness is the entire question.
  const tops = useMemo(() => {
    const max = (pick: (m: Point) => number) =>
      metricRows.reduce((hi, m) => Math.max(hi, pick(m)), 0)
    const connTop = axisTop(max((m) => Math.max(m.tcp ?? 0, m.udp ?? 0)), 4, 10)
    return {
      // A floor of 4%, or a machine that never exceeds 0.4% would get an axis of
      // 0-0.4 and render every scheduler blip as a peak. Capped at 100.
      cpu: axisTop(max((m) => m.cpu), 4, 10, 100),
      // Base 1024, so the steps are round in the unit `axisBytes` prints.
      rate: axisTop(max((m) => Math.max(m.net_rx, m.net_tx)), 1024, 1024),
      // ★2026-10-16（TCP / UDP 面板）：连接条数没有容量可比 —— 取窗口里两条线的最大值为准；
      //   下限 4（空窗 / 老 hub 缺键时轴也站得住），不封顶（流量大的机器 tcp 上千是常态）。
      // ★（同轮审出）连接数是计数，四分刻度不能带 x.5：axisTop 的阶梯含 1.5 / 2.5 / 7.5，
      //   峰值落在 (4,6] / (8,10] / (20,30] 时轴顶会是 6 / 10 / 30。把轴顶补到 4 的倍数
      //   （6→8、10→12、30→32），任何峰值下四分刻度都是整数。
      conn: connTop + ((4 - (connTop % 4)) % 4),
    }
  }, [metricRows])

  const shownProbes = useMemo(
    () => pingSeries.filter((s) => !hiddenProbes.includes(s.id)),
    [pingSeries, hiddenProbes],
  )
  // Keyed on the full list, so a line keeps its shade when others are hidden.
  const style = (id: number) => PALETTE[pingSeries.findIndex((p) => p.id === id) % PALETTE.length]

  // The hub stamps every sample with its bucket rather than the second the probe
  // finished, so probes reporting at the bucket's rate share rows instead of each
  // contributing its own: a day of four probes is 717 rows rather than 2,868. A
  // slower probe leaves gaps in its own column, which is what `connectNulls`
  // addresses.
  //
  // Every probe and both versions of every sample are held here whether or not
  // they are on screen: recharts resets the brush when the data array changes
  // identity, and re-reads a controlled selection only when the index props
  // change, which they do not. Hiding a probe or enabling despiking therefore
  // selects a `dataKey` rather than rebuilding the array.
  const pingRows = useMemo(() => {
    const rows = new Map<
      number,
      { ts: number } & Record<string, number | [number, number] | null>
    >()
    for (const s of pingSeries) {
      const windowSize = despikeWindow(s.points)
      const smoothed = despike(s.points.map((p) => p.latency), windowSize)
      // The band spans the same outliers as the line, and with one probe on
      // screen it is what the axis is fitted to, so it is clipped alongside it
      // rather than left to pull the axis back open. The latency fills the
      // buckets that carry no band, keeping each filter's window dense.
      const lo = despike(s.points.map((p) => p.band?.[0] ?? p.latency), windowSize)
      const hi = despike(s.points.map((p) => p.band?.[1] ?? p.latency), windowSize)
      s.points.forEach((p, i) => {
        const row = rows.get(p.ts) ?? { ts: p.ts * 1_000 }
        row[`t${s.id}`] = p.latency
        row[`s${s.id}`] = smoothed[i]
        row[`l${s.id}`] = p.loss ?? 0
        // A bucket with a single answer carries no band and spans only that
        // answer. Left null, `connectNulls` would bridge the hours between the
        // few buckets that have one: 2 to 10 of 1,440 in a day, the widest gap
        // 803 minutes, drawn as one large wedge.
        row[`b${s.id}`] = p.band ?? (p.latency === null ? null : [p.latency, p.latency])
        // Taken as the span of three filtered series rather than a pair: the two
        // edges are filtered independently, so a bucket that answered slightly
        // faster than usual can trip the low edge alone and come back above the
        // high one -- [180, 178] against a line of 176, drawn backwards with the
        // line outside it.
        const [low, high] = [lo[i], hi[i]]
        row[`c${s.id}`] =
          low === null || high === null
            ? null
            : [Math.min(low, high, smoothed[i] ?? low), Math.max(low, high, smoothed[i] ?? high)]
        rows.set(p.ts, row)
      })
    }
    return [...rows.values()].sort((a, b) => a.ts - b.ts)
  }, [pingSeries])

  // 延迟 tooltip 要按时间戳回查整行：recharts 只把光标下那几条曲线交给它，而丢包率
  // 挂在同一行的另一列上（`l<id>`），得连行一起拿到。
  const rowByTs = useMemo(() => new Map(pingRows.map((row) => [row.ts, row])), [pingRows])

  return (
    <div className="space-y-4">
      {/* 旗子在前、名字在后，与卡片上的次序一致。状态徽章与 agent 版本不在这行：
          在线时长已经并进下面的信息项，agent 版本对访客没有意义。
          ★名字后那枚「复制机器名」2026-10-15 按站长要求去掉（连同剪贴板那段逻辑一起）：
            详情页标题行只留旗子与名字。 */}
      <div className="flex items-center gap-2">
        <Country node={node} />
        <h2 className="truncate text-lg font-semibold tracking-tight">{node.name}</h2>
      </div>

      {/* One flat row of facts: what is left after the traffic figures moved
          out is one machine's spec sheet, and a box around a single topic is
          just a box. Three across at lg, two at md, one on a phone -- a kernel
          version or a CPU model needs about 270px to stay whole.
          ★2026-10-16 站长定的次序：系统 → 架构 → TCP / UDP 连接打头（一台机器的「身份」），
            再是 CPU / 内存 / 今日流量，在线时间收尾。 */}
      <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2 lg:grid-cols-3">
        <Fact label="系统" value={[osName(node.os), node.kernel].filter(Boolean).join(" · ")} />
        <Fact
          label="架构"
          value={[node.arch, node.virt !== "none" ? node.virt : "", m && m.procs !== null ? `${m.procs} 进程` : ""]
            .filter(Boolean)
            .join(" · ")}
        />
        {/* 连接数：hub 的实时上报里带着 TCP / UDP 连接条数（`metrics.tcp / udp`）。
            ★2026-10-15 站长要求合成**一格**、写法照「内存 / 硬盘」那格：标签 `TCP / UDP 连接`、
            值 `17 / 3`。离线机器 `metrics` 是 null，这一格随 Fact 的既有口径一起隐身
            ——「没有这个值」本来就不该占格子。 */}
        {/* 连接数只在这一帧真的带着两个数时出现（老 hub / 形状漂移都是 null）。 */}
        <Fact label="TCP / UDP 连接" value={m && m.tcp !== null && m.udp !== null ? `${m.tcp} / ${m.udp}` : null} />
        <Fact label="CPU" value={cpuLine(node)} />
        {/* 两个容量都是 0（从未接入、或顶层缺失又没读数）= 整格隐身，不摆一格「0 B / 0 B」。 */}
        <Fact label="内存 / 硬盘" value={memTotal > 0 || diskTotal > 0 ? `${bytes(memTotal)} / ${bytes(diskTotal)}` : null} />
        <Fact label="今日流量" value={node.day_rx || node.day_tx || m ? `↓ ${bytes(node.day_rx)} · ↑ ${bytes(node.day_tx)}` : null} />
        {/* 最后一格是「在线时间」：取代原先标题行上那枚状态徽章。它顶掉的是「续费」
            那一格——公开页的访客关心这台机器还活着多久，价格与到期在后台看。 */}
        <Fact label="在线时间" value={onlineFor(node)} />
      </dl>

      <div className="space-y-2 border-t border-border/70 pt-4">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <Tab key={t.key} active={tab === t.key} onClick={() => chooseTab(t.key)}>
              {t.label}
            </Tab>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex gap-1">
            {RANGES_FOR[tab].map((r) => (
              <Tab
                key={r.hours}
                active={hours === r.hours}
                onClick={() => setRanges((all) => ({ ...all, [tab]: r.hours }))}
              >
                {r.label}
              </Tab>
            ))}
          </div>
          {tab === "latency" && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={smooth}
                onChange={(e) => setSmooth(e.target.checked)}
                className="accent-foreground"
              />
              削峰
            </label>
          )}
        </div>
      </div>

      {/* 读 `metricRows.length` 而不是 `data.metrics.length`：真 hub 五个键每次都带齐
          （没要的那半是空数组），但响应一旦少 `metrics` 这个键（老 hub / 形状漂移 / 桩），
          **切回本页签的那一帧** —— effect 把 data 清空之前 —— 就会抛 TypeError、整棵树被
          React 卸载，整页空白。2026-10-09 在演示站实测到；metricRows 已经兜过底
          （`data?.metrics ?? []`），长度口径一致。回归哨兵见 tools/verify_detail_charts.mjs 的「三」。 */}
      {!data ? (
        <div className="rounded-2xl border bg-card px-4 py-3 shadow-lg shadow-border/60 dark:shadow-none">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : failed ? (
        <EmptyPanel tone="error">
          读取历史数据失败：{failed}
          <span className="mt-3 block">
            <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>重试</Button>
          </span>
        </EmptyPanel>
      ) : tab === "latency" ? (
        pingSeries.length === 0 ? (
          <EmptyPanel>这段时间没有延迟数据</EmptyPanel>
        ) : (
          // An explicit pixel height on the column, so the chart can be `flex-1`
          // within it while the legend takes what it needs: four probes are one row
          // of chips on a desktop and two on a phone, so any fixed reservation is
          // wrong on one of them.
          // 高度仍钉在**这一层**（`100svh - 顶 - 1rem`），白卡 `h-full` 填进来 —— 卡壳的 26px 在
          // 这一层之内，所以「一屏放得下、不滚动」的性质与从前完全一样（verify_detail_charts 断它）。
          <div
            // `+ scrollY`, because getBoundingClientRect is measured from the
            // viewport and this callback runs on every render; a live node
            // re-renders every two seconds, so a scrolled page would re-derive the
            // height from a top that has moved.
            ref={(el) => { if (el) setChartTop(el.getBoundingClientRect().top + scrollY) }}
            style={chartTop ? { height: `calc(100svh - ${Math.round(chartTop)}px - 1rem)` } : undefined}
            className="h-full min-h-72">
            <Panel fill title="网络延迟">
            <div className="flex h-full min-h-0 flex-col gap-3">
            {/* `min-h-0` is what makes `flex-1` a real number rather than the
                content's own height: ResponsiveContainer reads its parent, and
                a flex child not told it may shrink reports whatever the SVG
                last was. The column above has a height in pixels, so this
                resolves at layout instead of coming back 0. */}
            <div className="min-h-0 w-full flex-1 text-muted-foreground">
              {shownProbes.length === 0 ? (
                <p className="py-8 text-center text-sm">没有选中任何探测</p>
              ) : (
                <TimeChart
                  wheelZoom
                  rows={pingRows}
                  series={[
                    // 区间（band）只在屏上只有一个探测时画：四个叠在一起会糊成一片，还会把轴拉宽
                    // （原注释那段「四个的 band 会互相叠成雾」）。
                    ...(shownProbes.length === 1
                      ? shownProbes.map((s) => ({
                          key: `${smooth ? "c" : "b"}${s.id}`,
                          name: s.name,
                          color: style(s.id).stroke,
                          band: true,
                        }))
                      : []),
                    ...shownProbes.map((s) => ({
                      key: `${smooth ? "s" : "t"}${s.id}`,
                      name: s.name,
                      color: style(s.id).stroke,
                      dash: style(s.id).dash,
                    })),
                  ]}
                  hours={hours}
                  // 延迟轴不从 0 起：这些线路活在一条窄带里，锚到 0 会把起伏压平。
                  domain="auto"
                  unit="ms"
                  left={52}
                  // 缩放与对位都归图表自己管（滚轮纵向缩放 + 左键拖着线平移，见 Chart 的
                  // `wheelZoom`）：原来那套「横向拖选一段放大」2026-10-15 按站长的要求去掉了。
                  label="节点延迟走势"
                  renderTooltip={(row) => (
                    <PingTooltip active label={row.ts} rowByTs={rowByTs} probes={shownProbes} smooth={smooth} style={style} />
                  )}
                />
              )}
            </div>

            {/* Under the chart: what it covers is picked at the top, what is
                drawn in it is picked here. Recharts paints the brush into the
                same SVG as the axis, so this is as close beneath as HTML
                sits. */}
            {(pingSeries.length > 1 || pingSeries.some((s) => s.loss > 0)) && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {pingSeries.map((s) => {
                const shown = !hiddenProbes.includes(s.id)
                return (
                  <button
                    key={s.id}
                    aria-pressed={shown}
                    onClick={() =>
                      setHiddenProbes((h) => (shown ? [...h, s.id] : h.filter((id) => id !== s.id)))
                    }
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-opacity ${
                      shown ? "" : "opacity-40"
                    }`}
                  >
                    {/* The swatch carries the same shade and dash as the line. */}
                    <svg width="14" height="6" className="shrink-0" aria-hidden>
                      <line
                        x1="0"
                        y1="3"
                        x2="14"
                        y2="3"
                        stroke={style(s.id).stroke}
                        strokeDasharray={style(s.id).dash}
                        strokeWidth="2"
                      />
                    </svg>
                    {s.name}
                    {/* The line is only what answered, so a probe dropping
                        half its packets draws like a healthy one. */}
                    {s.loss > 0 && (
                      <span className="tabular-nums opacity-60">
                        丢 {s.loss < 1 ? "<1" : Math.round(s.loss)}%
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            )}
            </div>
            </Panel>
          </div>
        )
      ) : metricRows.length === 0 ? (
        <EmptyPanel>这段时间没有历史数据</EmptyPanel>
      ) : (
        <div className="space-y-5">
          {/* ★2026-10-16 站长定稿的次序：网络速率与 TCP / UDP 连接打头（在 CPU 之前），
              其后 CPU / 内存 / 硬盘。 */}
          {/* A rate has no total to be a fraction of, so this one climbs the
              ladder like CPU rather than pinning to a capacity. */}
          <Panel title="网络速率">
            <TimeChart
              rows={metricRows}
              series={[
                { key: "net_rx", name: "下行", color: "var(--ok)" },
                { key: "net_tx", name: "上行", color: "var(--chart-2)" },
              ]}
              hours={hours}
              top={tops.rate}
              unit="/s"
              yFormat={axisBytes}
              format={(v) => rate(v)}
              label="网络速率走势"
            />
          </Panel>

          {/* ★2026-10-16 站长要求新增：TCP / UDP 连接的条数走势，两条线各一个色相
              （TCP 蓝 / UDP 粉）。数据就在同一次历史指标（metrics）响应的 `tcp / udp` 两列里
              （hub 1.4.x 的 metrics 桶实测带这两个键）。口径与其余几张同款、
              只是不填面积：连接数是计数，不是「占了多少容量」。 */}
          <Panel title="TCP / UDP 连接">
            <TimeChart
              rows={metricRows}
              series={[
                { key: "tcp", name: "TCP", color: "var(--chart-1)" },
                { key: "udp", name: "UDP", color: "var(--chart-9)" },
              ]}
              hours={hours}
              top={tops.conn}
              label="TCP / UDP 连接数走势"
            />
          </Panel>

          <Panel title="CPU">
            <TimeChart
              rows={metricRows}
              series={[{ key: "cpu", name: "CPU", color: "var(--chart-1)", area: true }]}
              hours={hours}
              top={tops.cpu}
              unit="%"
              format={(v) => `${v.toFixed(1)}%`}
              label="CPU 使用率走势"
            />
          </Panel>

          {/* The axis top is the machine's memory, so the line's height is the
              fraction in use whatever range is picked. Tracking the window's
              own maximum, which is what an area chart does by default, puts
              127 MB of a 457 MB box at the top of the panel. The size is in the
              title because the axis top is claiming it. */}
          <Panel title={`内存 · ${bytes(memTotal)}`}>
            <TimeChart
              rows={metricRows}
              series={[{ key: "mem_used", name: "内存", color: "var(--chart-4)", area: true }]}
              hours={hours}
              top={memTotal}
              yFormat={axisBytes}
              format={(v) => bytes(v)}
              label="内存使用量走势"
            />
          </Panel>

          {/* The disk it is filling, for the same reason as memory: a node
              using 2.7% of its disk draws along the top of the panel when the
              axis tracks the window's own maximum. */}
          <Panel title={`硬盘 · ${bytes(diskTotal)}`}>
            <TimeChart
              rows={metricRows}
              series={[{ key: "disk_used", name: "硬盘", color: "var(--chart-3)", area: true }]}
              hours={hours}
              top={diskTotal}
              yFormat={axisBytes}
              format={(v) => bytes(v)}
              label="硬盘使用量走势"
            />
          </Panel>
        </div>
      )}
    </div>
  )
}
