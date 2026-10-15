import { useState } from "react"
import { Lock } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { TextHighlight } from "@/components/TextHighlight"
import { Meter } from "@/components/Meter"
import type { Node } from "@/lib/api"
import { CYCLE_SHORT, FOREVER, bytes, daysUntil, money, osName, pair, percent, rate, uptime } from "@/lib/format"
import { remarkChips, type RemarkChip } from "@/lib/notes"

/**
 * This period's usage as the plan meters it. The hub computes it; the switch
 * below serves only a hub from before `month_used`.
 */
function monthUsage(node: Node): number {
  if (typeof node.month_used === "number") return node.month_used
  const { month_rx: rx, month_tx: tx } = node
  switch (node.traffic_mode) {
    case "up":
      return tx
    case "down":
      return rx
    case "max":
      return Math.max(rx, tx)
    default:
      return rx + tx
  }
}

// A node that has reported once has told the hub its shape -- cores, memory,
// disk -- and the hub retains its traffic totals whether connected or not. A node
// that never connected is the only case with nothing to show.
export function deployed(node: Node) {
  return node.cpu_cores > 0 || node.mem_total > 0
}

/**
 * 离线了多久（秒）。优先用 hub 算好的 `last_seen_ago`——它按 **hub 的时钟**算，而拿
 * `last_seen` 减访客浏览器的时钟会在访客时钟偏了时报出错误的时长（快 8 小时就显示成
 * 「离线 8 小时」，hub 1.4.0 起专门下发这个字段就是为了替掉那种算法）。老 hub（1.4.0
 * 之前）没有这个 key，退回按 `last_seen` 自己算；从未上报（last_seen 为 0）得 0，
 * 调用方按「不足一分钟」处理。
 */
export function offlineSeconds(node: Node): number {
  if (typeof node.last_seen_ago === "number") return Math.max(0, node.last_seen_ago)
  return node.last_seen ? Math.max(0, Date.now() / 1000 - node.last_seen) : 0
}

/**
 * 底注那一行最多摊几枚备注小卡片。底注只有一行：贪多就会把「价格 / 剩余」挤到看不见，
 * 而那个恰恰是访客问「这台还剩多久」时先找的那一句。
 */
const CARD_CHIPS = 3

/**
 * 这台机器此刻有没有实时数据（= 状态点点绿、四个读数格写实时值）。
 * 与列表沉底是**同一判据**（`online && metrics`，见 App.tsx）：hub 对一个连上但还没上报的
 * agent 答的是 `online: true` + `metrics: null`，那时读数全是「—」，点不该是绿的。
 */
export function live(node: Node): boolean {
  return Boolean(node.online && node.metrics)
}

/**
 * 名字下面那行灰字：`系统 · 运行时间 34 天`（参考站的口径）。离线写「已离线」、从未接入写
 * 「未接入」、连上但还没上报写「在线」—— 四种处境在卡面上各自说得清，不都塞成「离线」。
 */
export function metaLine(node: Node): string {
  const state = node.metrics
    ? `运行时间 ${uptime(node.metrics.uptime)}`
    : node.online ? "在线" : deployed(node) ? "已离线" : "未接入"
  return [osName(node.os), state].filter(Boolean).join(" · ")
}

/**
 * 负载那一格的条：`load[0] / 核数` —— 1 核机上 0.20 的负载 = 20%（条读的是「满载的几成」，
 * 而不是把 1 分钟均值直接当百分比）。核数取不到时按 1 核算，免得除零。
 */
function loadPct(node: Node): number | null {
  const m = node.metrics
  return m ? percent(m.load[0], Math.max(1, node.cpu_cores || 1)) : null
}

/**
 * 底注那行小字：`价格 ¥47.00/年 · 剩余 179 天`（有哪截写哪截，都没有就整条不占位）。
 *
 * · 价格 0 不写：hub 后台那一格写着「留空或 0 为免费」，把「没填」也印成「免费」是在替站长断言。
 * · 到期优先用 hub 算好的 `expires_in`（按 hub 的时区算、在线机器还会顺延），只有旧 hub 没这个
 *   key 时才退回按 `expires_at` 自己数（见 @/lib/format 的 daysUntil）。
 */
function noteText(node: Node): string {
  const cycle = CYCLE_SHORT[node.billing_cycle]
  const price = node.price > 0 ? `价格 ${money(node.price, node.currency)}${cycle ? `/${cycle}` : ""}` : ""
  const days = node.expires_in !== undefined ? node.expires_in : daysUntil(node.expires_at)
  const left = days === null || days === undefined ? ""
    : days < 0 ? `已过期 ${-days} 天` : days === 0 ? "今天到期" : `剩余 ${days} 天`
  return [price, left].filter(Boolean).join(" · ")
}

/**
 * Where the machine is: its flag, or the bare code for one the set lacks.
 *
 * 旗子是主题自带的静态文件（`/flags/<CC>.svg`，258 面，按 ISO 3166-1 alpha-2
 * 命名，36×36 圆角方形画布、图案画在中间的 36×26 里），按国家码现取一张：访客
 * 只会下载页面上真正出现的那几面旗，不必把整套打进 bundle。
 *
 * 取不到就退回文字徽标——国家码不在这 258 面里（hub 偶尔给出 XA 这类非 ISO 码）、
 * 或者旗子文件没被装上，都走这一条，不留一枚破图。
 */
export function Country({ node }: { node: Node }) {
  const [missing, setMissing] = useState(false)
  const code = (node.country || "").trim().toUpperCase()
  if (!code) return null
  if (missing) {
    return (
      <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
        {code}
      </Badge>
    )
  }
  return (
    <img
      src={`/flags/${code}.svg`}
      alt={code}
      title={code}
      width={24}
      height={18}
      loading="lazy"
      // 24×18（4:3）：比一行 12px 的字高一档才看得清，1px 描边让日本、波兰这类
      // 白底旗在卡片上仍有边界。画布是正方形，`object-cover` 正好裁掉上下留白，
      // `-translate-y-px` 抵消行盒与图标基线之间的 1px 落差。
      className="h-[18px] w-6 shrink-0 -translate-y-px rounded-[3px] object-cover ring-1 ring-border/70"
      onError={() => setMissing(true)}
    />
  )
}

/**
 * 备注小卡片：**私有那几枚带锁 + 描边**（仅自己可见），公有那几枚实心 `secondary`。
 * 整页详情那一块（见 NodeDetail）用它摊「私有 + 公有」合并后的那一串；次序（私有在前、
 * 公有在后）由 `@/lib/notes` 的 `remarkChips` 一处决定。
 *
 * ★卡片那一侧一处都不摊备注——「简约」这一档的口径（2026-10-03 站长定的），
 * 所以这个组件现在只被整页详情使用。
 */
export function RemarkChips({ chips }: { chips: RemarkChip[] }) {
  return (
    <>
      {chips.map((c, i) => (
        <Badge
          key={i + "-" + c.text}
          variant={c.own ? "outline" : "secondary"}
          className={"min-w-0 shrink font-normal " + (c.own ? "gap-1 text-muted-foreground" : "")}
          title={c.own ? "仅自己可见：" + c.text : c.text}
        >
          {c.own && <Lock className="size-3 shrink-0" aria-hidden />}
          <span className="min-w-0 truncate">{c.text}</span>
        </Badge>
      ))}
    </>
  )
}

// Traffic uses the plan's own counting rule, so the bar matches the quota the
// node is billed against.
function trafficFoot(node: Node) {
  return node.traffic_limit > 0
    ? pair(monthUsage(node), node.traffic_limit)
    : `${bytes(monthUsage(node))} / ${FOREVER}`
}

/**
 * 列表里的那张卡片（本主题唯一的一档，2026-10-15 照站长给的参考站重排）。
 *
 * 从上到下六块（行距、字号按参考站校准过：整卡 ~510×214，那边是 508×209）：
 *   ① 身份行：状态点 + 旗子 + 名字（离线时右端一枚「已离线」徽章）；
 *   ② 一行灰字：系统 · 运行时间（四种处境的口径见 metaLine）；
 *   ③ 四个读数格：CPU / 内存 / 存储 / 负载（上面一条分隔线，见 Meter）；
 *   ④ 上传 / 下载：左右两栏，各带累计总量与实时速率，中间一道竖线；
 *   ⑤ 总流量：左边「已用 / 额度」、右边「流量重置」，下面一条全宽进度条；
 *   ⑥ 底注：价格 / 到期（左）＋ 备注小卡片（最多 CARD_CHIPS 枚，右）。
 *
 * 不含延迟那一块——那在整页详情里看（点卡片进去）。
 */
export function NodeCard({ node, onOpen, onWarm, terms, selected }: {
  node: Node
  onOpen: () => void
  /** 指针或键盘刚落到这张卡片上：先把手头这块 chunk（详情页的图表）取回来。 */
  onWarm?: () => void
  /** 搜索命中词：名字里描色（见 Highlight）。没在搜时是空数组。 */
  terms?: string[]
  /** 键盘光标（↑↓）停在这张卡上：加一圈描边。 */
  selected?: boolean
}) {
  const m = node.metrics
  // 有实时数据才点绿（与沉底同一判据，见 live）。
  const on = live(node)
  // 备注小卡片：私有在前、公有在后（与整页详情同一份，见 @/lib/notes）；访客那边 hub 只下发
  // 公有那几枚，所以同一个位置他们看到的就是公有。卡片这一侧只取前 CARD_CHIPS 枚。
  const chips = remarkChips(node).slice(0, CARD_CHIPS)
  const note = noteText(node)
  return (
    <Card
      onClick={onOpen}
      // 摸到卡片（悬停 / 键盘 Tab 到它 / 手指按下）就先取详情那块 chunk：真要打开的人，
      // 鼠标按下去之前多半已经碰过这张卡了。见 App 的 warmDetail。
      onPointerOver={onWarm}
      onFocus={onWarm}
      onTouchStart={onWarm}
      // min-w-0: a grid item sizes to its content unless told otherwise, and the
      // name line below does not wrap, so on a phone the card would grow past its
      // column and scroll the page sideways. The truncate inside only takes effect
      // once the card is allowed to be narrower.
      // 键盘光标（搜索框里 ↑↓ 选中的那台）停在上面时加一圈 2px 描边：用 outline 而不是
      // border/ring —— 不占盒宽、不改网格（用 border 会让这张卡大一圈、把邻居挤动）。
      // data-node-card 是滚动定位（见 App 的 NodeList）与护栏共用的锚点；
      // data-selected 是「当前被键盘选中」的标记（护栏读它，不用去解析类名）。
      data-node-card={node.id}
      data-selected={selected ? "1" : undefined}
      className={`min-w-0 cursor-pointer gap-0 px-4 py-3 transition-colors hover:border-foreground/25 ${selected ? "outline-2 outline-offset-1 outline-ring" : ""}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
    >
      {/* ① 身份行：状态点 + 旗子 + 名字（+ 离线徽章）。
          `data-status` 是护栏的锚点（on / off）；点自己不上文字，悬停说明给的是「在线 / 离线」。
          名字加粗一档（参考站是 600）。搜索命中处描色（Highlight：mark 不改变 textContent，
          既有文案断言照旧；没在搜时它原样返回，零影响）。 */}
      <div className="flex min-w-0 items-center gap-2">
        <span
          data-status={on ? "on" : "off"}
          title={on ? "在线" : "离线"}
          className={"size-2 shrink-0 rounded-full " + (on ? "bg-ok" : "bg-down")}
        />
        <Country node={node} />
        <h3 className="min-w-0 flex-1 truncate font-semibold leading-5"><TextHighlight text={node.name} terms={terms} /></h3>
        {/* 徽章只给「接入过、现在掉线」的机器：从未接入的卡片下面那行说明已经说清了，
            连上但还没上报的更不该被盖上「已离线」。 */}
        {deployed(node) && !node.online && (
          <Badge className="shrink-0 bg-down/12 font-normal text-down">已离线</Badge>
        )}
      </div>

      {/* ② 系统 · 运行时间：与名字左对齐的一行灰字（@/lib/format 的 osName 去掉代号那截）。 */}
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{metaLine(node)}</p>

      {/* One layout for both states: a disconnected node still knows its
          cores, memory, disk size and traffic totals, and showing those with
          the live figures blank beats a stretched card with one line in it. */}
      {deployed(node) ? (
        <>
          {/* ③ 四个读数格：参考站的口径是「表名 / 读数 / 条」一列到底，上面一条分隔线把头部
              与读数区隔开。格子里只剩百分比：核数、已用 / 总量挪进各自的悬停说明（Meter 的
              title），整页详情里仍然写全。 */}
          <div data-metrics="" className="mt-1.5 grid grid-cols-4 gap-x-3 border-t pt-1.5">
            <Meter
              label="CPU"
              title={`${node.cpu_cores} 核`}
              pct={m ? m.cpu : null}
              value={m ? `${m.cpu.toFixed(2)}%` : "—"}
            />
            <Meter
              label="内存"
              title={m ? pair(m.mem_used, m.mem_total) : bytes(node.mem_total)}
              pct={m ? percent(m.mem_used, m.mem_total) : null}
              value={m ? `${percent(m.mem_used, m.mem_total).toFixed(2)}%` : "—"}
            />
            <Meter
              label="存储"
              title={m ? pair(m.disk_used, m.disk_total) : bytes(node.disk_total)}
              pct={m ? percent(m.disk_used, m.disk_total) : null}
              value={m ? `${percent(m.disk_used, m.disk_total).toFixed(2)}%` : "—"}
            />
            {/* 负载：读数是 1 分钟均值，条按「满载的几成」上色（见 loadPct），三条均值在悬停说明里。 */}
            <Meter
              label="负载"
              title={m ? `1 / 5 / 15 分钟：${m.load.map((n) => n.toFixed(2)).join(" ")}` : undefined}
              pct={loadPct(node)}
              value={m ? m.load[0].toFixed(2) : "—"}
            />
          </div>

          {/* ④ 上传 / 下载：左上传、右下载，中间一道竖线把两栏分开（参考站如此）。
              速率是这一块的重心（大字加粗）；累计总量弱化成灰字跟在标签那一行的右端。
              箭头保留 ↑ / ↓（可以整段复制），颜色用 --ok —— 卡片上唯一的彩色笔画。
              `data-net` 是给护栏认这一块用的锚点。 */}
          <div data-net="row" className="mt-1.5 grid grid-cols-2">
            <div className="min-w-0 pr-3">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="shrink-0"><span className="text-ok">↑</span> 上传</span>
                <span className="tnum min-w-0 truncate text-muted-foreground">累计 {bytes(node.total_tx)}</span>
              </div>
              <div className="tnum mt-0.5 truncate text-base font-semibold leading-[18px]">{m ? rate(m.net_tx) : "—"}</div>
            </div>
            <div className="min-w-0 border-l pl-3">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="shrink-0"><span className="text-ok">↓</span> 下载</span>
                <span className="tnum min-w-0 truncate text-muted-foreground">累计 {bytes(node.total_rx)}</span>
              </div>
              <div className="tnum mt-0.5 truncate text-base font-semibold leading-[18px]">{m ? rate(m.net_rx) : "—"}</div>
            </div>
          </div>

          {/* ⑤ 总流量：数字行（左：已用 / 额度，右：重置日；没有额度就写 N/A，与参考站一致），
              再下面一条全宽进度条 —— 用量按套餐的计流量方式算（trafficFoot / monthUsage）。 */}
          <div className="tnum mt-1.5 flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate">{trafficFoot(node)}</span>
            <span className="shrink-0">
              流量重置：{node.traffic_limit > 0 ? `每月 ${node.traffic_reset_day} 日` : "N/A"}
            </span>
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground/70 transition-[width] duration-500"
              style={{ width: `${node.traffic_limit > 0 ? percent(monthUsage(node), node.traffic_limit) : 0}%` }}
            />
          </div>

          {/* ⑥ 底注：价格 / 到期在左、备注小卡片在右；两截都没有就整行不占位。
              `data-remark="card"` 是护栏的锚点（与整页详情那一块的 `data-remark-block` 区分开）。 */}
          {(note || chips.length > 0) && (
            <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2">
              <span className="tnum min-w-0 truncate text-[11px] leading-4 text-muted-foreground">{note}</span>
              {chips.length > 0 && (
                <span data-remark="card" className="flex min-w-0 shrink items-center justify-end gap-1">
                  <RemarkChips chips={chips} />
                </span>
              )}
            </div>
          )}
        </>
      ) : (
        /* Never connected: nothing to plot, so the card stays short rather than
           padding out to match its neighbours. */
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          还没有接入。在后台生成安装命令并执行一次。
        </p>
      )}
    </Card>
  )
}
