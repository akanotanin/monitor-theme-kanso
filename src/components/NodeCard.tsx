import { useState } from "react"
import { Lock } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { TextHighlight } from "@/components/TextHighlight"
import { Meter } from "@/components/Meter"
import type { Node } from "@/lib/api"
import { FOREVER, bytes, pair, percent, rate } from "@/lib/format"
import type { RemarkChip } from "@/lib/notes"

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
 * 列表里的那张卡片：「简约」一档（本主题唯一的一档）。
 *
 * 结构 = 一行身份（旗子 + 名字）＋ 2×2 四个用量格 ＋ 底部一行网络。
 * 不含延迟、不摊备注、不写在线时长与到期——那些在整页详情里看（点卡片进去）。
 * 版式按「简约」那一档定死：名字加粗一档、标签用前景色、进度条 4px 更细、
 * 底注 11px、格子间距收紧（见 Meter 与下面各处）。
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
      className={`min-w-0 cursor-pointer gap-0 p-4 transition-colors hover:border-foreground/25 ${selected ? "outline-2 outline-offset-1 outline-ring" : ""}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
    >
      {/* 一行身份：旗子在前、名字在后。列表页一眼要看的是哪台机器、还剩多少余量；
          系统与到期在详情页写得更全，挤在卡片上只会把名字推到省略号。
          名字加粗一档（参考站是 600）。搜索命中处描色（Highlight：mark 不改变 textContent，
          既有文案断言照旧；没在搜时它原样返回，零影响）。 */}
      <div className="flex min-w-0 items-center gap-2">
        <Country node={node} />
        <h3 className="min-w-0 truncate font-semibold"><TextHighlight text={node.name} terms={terms} /></h3>
      </div>

      {/* One layout for both states: a disconnected node still knows its
          cores, memory, disk size and traffic totals, and showing those with
          the live figures blank beats a stretched card with one line in it. */}
      {deployed(node) ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
            {/* The core count belongs beside the word CPU: it is what the
                percentage and the load averages are both measured against. */}
            <Meter
              label={<>CPU <span className="text-muted-foreground">{node.cpu_cores} 核</span></>}
              pct={m ? m.cpu : null}
              foot={m ? m.load.map((n) => n.toFixed(2)).join(" ") : "—"}
            />
            <Meter
              label="内存"
              pct={m ? percent(m.mem_used, m.mem_total) : null}
              foot={m ? pair(m.mem_used, m.mem_total) : bytes(node.mem_total)}
            />
            <Meter
              label="硬盘"
              pct={m ? percent(m.disk_used, m.disk_total) : null}
              foot={m ? pair(m.disk_used, m.disk_total) : bytes(node.disk_total)}
            />
            <Meter
              label="流量"
              pct={node.traffic_limit > 0 ? percent(monthUsage(node), node.traffic_limit) : null}
              empty={FOREVER}
              foot={trafficFoot(node)}
            />
          </div>

          {/* 卡片底部那一行网络：一行两段——左边实时速率（前景色）、右边累计总量
              （弱化灰），上面一条分隔线；箭头用文字 ↓ ↑ 而不是图标，这样整段能原样
              复制成「↓ 88 B/s ↑ 312 B/s」。`data-net` 是给护栏认这一行的锚点。 */}
          <div data-net="row" className="tnum mt-3 flex items-center justify-between gap-2 border-t pt-2.5 text-xs">
            <span className="truncate">{m ? `↓ ${rate(m.net_rx)} ↑ ${rate(m.net_tx)}` : "—"}</span>
            <span className="truncate text-muted-foreground">
              {`↓ ${bytes(node.total_rx)} ↑ ${bytes(node.total_tx)}`}
            </span>
          </div>
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
