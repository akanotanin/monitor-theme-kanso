import { useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, Lock } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
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
  // ★实时读数里的本月用量与顶层同源，但顶层缺失 / 滞后时（形状漂移、老 hub）它还在
  //   （2026-10-18）：取得到就用它，两边都没有才按 0 算。
  const m = node.metrics
  const rx = m?.month_rx ?? node.month_rx ?? 0
  const tx = m?.month_tx ?? node.month_tx ?? 0
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
  // ★2026-10-18：`metrics` 也算「已接入」—— 顶层规格（cores / mem / disk）缺失、而实时读数
  //   好好的时候，原来会把一台活着的机器整张卡写成「还没有接入」；metrics 在就等于它报过到。
  return node.cpu_cores > 0 || node.mem_total > 0 || node.metrics !== null
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
// ★2026-10-20：卡片从 510 收到 336 之后一行塞不下三枚（三枚长备注会把「剩余 N 天」整个挤掉），
//   收到两枚；README 的「关于备注」也跟着改成最多 2 枚。
const CARD_CHIPS = 2

/**
 * 流量计费方式（hub 的 `traffic_mode`）→ 一枚 12px 的图标 + 悬停说明。
 *
 * ★2026-10-20 站长指出：原来那枚 `↕` 一直不变，看不出这台是按哪种方式计流量 ——
 *   四种方式（上下行相加 / 取较大值 / 仅上行 / 仅下行）在卡面上长得一模一样。
 *   现在四种方式各一枚 12px 线性图标：↕ 相加、≥ 取较大、↑ 仅上行、↓ 仅下行（同一支笔、同一线宽；
 *   `≥` 是自绘的，线宽按 16 视口折成 1.4，显示出来与 lucide 的 2.0/24 视口等粗）；
 *   老 hub 没有这个字段时按 `sum` 处理（与 monthUsage 的 default 同一口径）。
 */
const TRAFFIC_MODE_LABEL: Record<string, string> = {
  sum: "上下行相加",
  max: "取较大值",
  up: "仅上行",
  down: "仅下行",
}

function TrafficModeIcon({ mode }: { mode: string }) {
  const cls = "size-3 shrink-0"
  switch (mode) {
    case "max":
      // lucide 这套没有比较符号，`≥` 按同一支笔自己画：两条斜线 + 一条底横线。
      return (
        <svg viewBox="0 0 16 16" className={cls} fill="none" stroke="currentColor" strokeWidth={1.4}
          strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 2.8 13 6.6 3 10.4" />
          <path d="M3 13.4h10" />
        </svg>
      )
    case "up":
      return <ArrowUp className={cls} aria-hidden />
    case "down":
      return <ArrowDown className={cls} aria-hidden />
    default:
      // 上下行相加：回到最早那枚 lucide ArrowUpDown（站长说文本 `↑↓` 没它好看）。
      return <ArrowUpDown className={cls} aria-hidden />
  }
}

/**
 * 这台机器此刻有没有实时数据（= 读数格写实时值；卡上没有状态点，见下面 ① 的说明）。
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
 * 速率拆成「数值 / 单位」两截：第四格里数值走 13px（与左边读数同档）、单位压到 10px 灰。
 * `rate()` 的输出固定是「数字 空格 单位」（含 `B/s`、`MB/s` 这类带斜杠的单位），按最后一个空格切。
 */
function rateParts(n: number): [string, string] {
  const s = rate(n)
  const i = s.lastIndexOf(" ")
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)]
}

/**
 * 底注那行小字：`价格 ¥47.00/年 · 剩余 179 天`（有哪截写哪截；都没有就留空 ——
 * 那一行**照样占位**，卡片高度不能因为有没有这段字而变，见下面 ⑥ 的 ★）。
 *
 * · 价格 0 不写：hub 后台那一格写着「留空或 0 为免费」，把「没填」也印成「免费」是在替站长断言。
 * · 到期优先用 hub 算好的 `expires_in`（按 hub 的时区算、在线机器还会顺延），只有旧 hub 没这个
 *   key 时才退回按 `expires_at` 自己数（见 @/lib/format 的 daysUntil）。
 */
function noteText(node: Node): string {
  // ★`CYCLE_SHORT` 是普通对象：`billing_cycle = "constructor"` 会取到 Object 构造函数，
  //   模板字符串把函数源码印到卡片上。`Object.hasOwn` 是零成本的闸（2026-10-20 审出）。
  const cycle = Object.hasOwn(CYCLE_SHORT, node.billing_cycle) ? CYCLE_SHORT[node.billing_cycle] : ""
  // ★价格只认数字：字符串 "349" 会让 `> 0` 为真、随后 moneyAmount 退成 ¥0.00
  //   （有价格却显示 0，2026-10-20 审出）。
  const price = typeof node.price === "number" && Number.isFinite(node.price) && node.price > 0
    ? `价格 ${money(node.price, node.currency)}${cycle ? `/${cycle}` : ""}`
    : ""
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
  const raw = (node.country || "").trim().toUpperCase()
  // 只认两位 ISO 码：长串 / 中文 / `../` 之类会让 `<img>` 去请求一个意外路径，
  // 回退的徽标也会把名字行撑开（2026-10-20 审出）。形状不对就当没填。
  const code = /^[A-Z]{2}$/.test(raw) ? raw : ""
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
 * 备注小卡片：**私有那几枚带锁 + 描边**（仅自己可见），公有那几枚实心 `secondary`
 * （1.6.0 起备注只显示在卡片上，整页详情那一块已撤）。
 * 卡片底注那一行摊「私有 + 公有」合并后的那一串（最多 CARD_CHIPS 枚）；次序（私有在前、
 * 公有在后）由 `@/lib/notes` 的 `remarkChips` 一处决定。
 */
export function RemarkChips({ chips }: { chips: RemarkChip[] }) {
  return (
    <>
      {chips.map((c, i) => (
        <Badge
          key={i + "-" + c.text}
          variant={c.own ? "outline" : "secondary"}
          // 卡片底注那一行的口径（11px 字 + 行盒 14px + 无内边距 = 16px 高，正好塞满底注那行；
          // 2026-10-15 站长要求「备注缩小一些、且不改变卡片大小」）。
          // ★行盒给到 14px（leading-3.5）而不是 11px：11px 的行盒会把中文字形上下各裁掉半像素
          //   （Inter 11px 的字体框 ascent+descent ≈ 13.3px）；py 用 [0px] 这种任意值压掉基类的
          //   py-0.5（Tailwind 把任意值排在后面，可靠）。两者一凑，高度还是 16px。
          className={"min-w-0 shrink font-normal " + (c.own ? "gap-1 text-muted-foreground " : "") + "px-1.5 py-[0px] text-[11px] leading-3.5"}
          title={c.own ? "仅自己可见：" + c.text : c.text}
        >
          {/* 锁图标尺寸交给 Badge 基类的 `[&>svg]:size-3`（0,1,1）—— 挂在图标上的 size-2.5
              是单类选择器（0,1,0），永远输、是死类（2026-10-15 审出来），别再写。 */}
          {c.own && <Lock className="shrink-0" aria-hidden />}
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
 * 从上到下五块（行距、字号按参考站校准过：整卡 ~336×186（1440 三列）/ 358×186（手机单列））。
 *   ① 身份行：旗子 + 名字（离线时右端一枚「已离线」徽章）；
 *   ② 一行灰字：系统 · 运行时间（四种处境的口径见 metaLine）；
 *   ③ 三格读数 CPU / 内存 / 存储 ＋ 第四格：上行 / 下行两行速率（没有表名，2026-10-20 站长
 *      第二轮要求去掉「网络」二字 —— 箭头已经说明了方向；累计总量在悬停说明里）；
 *   ④ 总流量：左「流量 ↕ 每月 N 日 ⇄」、右「已用 / 额度」，下面一条全宽进度条；
 *   ⑤ 底注：价格 / 到期（左）＋ 备注小卡片（最多 CARD_CHIPS 枚，右）——**恒定占位**，
 *      有备注没备注、有价格没价格，卡片都一样高（2026-10-15 站长定的）。
 *
 * 不含延迟那一块——那在整页详情里看（点卡片进去）。
 */
export function NodeCard({ node, onOpen, onWarm }: {
  node: Node
  onOpen: () => void
  /** 指针或键盘刚落到这张卡片上：先把手头这块 chunk（详情页的图表）取回来。 */
  onWarm?: () => void
}) {
  const m = node.metrics
  // 有实时数据才点绿（与沉底同一判据，见 live）。
  const on = live(node)
  // ★2026-10-18：规格 / 累计一律**实时读数优先** —— 顶层字段缺失或滞后时，原来会印
  //   「累计 0 B」「流量重置：每月 undefined 日」；metrics 里同一份值就在那儿。
  const cores = node.cpu_cores || 0
  const totalTx = m?.total_tx ?? node.total_tx ?? 0
  const totalRx = m?.total_rx ?? node.total_rx ?? 0
  const resetDay = node.traffic_reset_day > 0 ? node.traffic_reset_day : 0
  // 备注小卡片：私有在前、公有在后（与整页详情同一份，见 @/lib/notes）；访客那边 hub 只下发
  // 公有那几枚，所以同一个位置他们看到的就是公有。卡片这一侧只取前 CARD_CHIPS 枚。
  const chips = remarkChips(node).slice(0, CARD_CHIPS)
  const note = noteText(node)
  // 「已用 / 额度」的整串（分色渲染用：前半深、后半灰）。
  const traffic = trafficFoot(node)
  // 第四格的两行速率（数值 / 单位分开渲染，见 rateParts）。
  const upRate = m ? rateParts(m.net_tx) : null
  const downRate = m ? rateParts(m.net_rx) : null
  // 可访问名：名字 + 离线状态；空名字给一句兜底，别让链接没有名字。
  const label = `${node.name || "未命名节点"}${deployed(node) && !node.online ? "（已离线）" : ""}`
  return (
    <Card
      // 摸到卡片（悬停 / 键盘 Tab 到它 / 手指按下）就先取详情那块 chunk：真要打开的人，
      // 鼠标按下去之前多半已经碰过这张卡了。见 App 的 warmDetail。
      onPointerOver={onWarm}
      onFocus={onWarm}
      onTouchStart={onWarm}
      // min-w-0: a grid item sizes to its content unless told otherwise, and the
      // name line below does not wrap, so on a phone the card would grow past its
      // column and scroll the page sideways. The truncate inside only takes effect
      // once the card is allowed to be narrower.
      // data-node-card 是护栏共用的锚点（卡片网格的定位）。
      // （2026-10-16 搜索删掉后，这里不再有「键盘选中」那圈 outline 与 data-selected。）
      data-node-card={node.id}
      data-status={on ? "on" : "off"}
      // ★整卡可点，但**语义控件是标题里的链接**（2026-10-20）：role="button" 的后代按 ARIA
      //   是 presentational，会把四行读数从可访问树里盖掉；而铺满卡片的透明链接又会挡住卡内
      //   各处的 title 悬停（核数 / 已用·总量 / 上传下载累计 / 计费方式 / 国旗 / 备注全文）与文字选择。
      //   现在 h2 里是一枚真链接（Ctrl/⌘、中键、右键、Enter 都成立），卡根只兜住其余区域的
      //   左键点击 —— 点击范围不变，读数、title、选区都还在。
      onClick={(e) => {
        if (e.target instanceof Element && e.target.closest("a")) return
        onOpen()
      }}
      className="min-w-0 cursor-pointer gap-0 px-4 py-3 transition-colors hover:border-foreground/25"
    >
      {/* ① 身份行：旗子 + 名字（+ 离线徽章）。**没有状态点**。
          ★那枚 8px 的绿 / 红点 2026-10-15 按站长的要求去掉了（「卡片上的国旗旁边的小圆点去掉」）：
            在线与否现在只由**离线徽章**表达 —— 在线什么都不带、掉线才盖一枚「已离线」，
            与原来「绿色点＝正常」相比少一处颜色噪音（一页 30 张卡就是 30 个绿点）。
          ★`data-status`（on / off）改挂在**卡根**上（见下面那个 div）：它是护栏的锚点，
            别再去卡里找那枚点（点没了，`querySelector('[data-status]')` 会返回 null）。
          名字加粗一档（参考站是 600）。 */}
      {/* ★定高 22px：名字行本身 20px（text-sm / leading-5），而「已离线」徽章 22px（text-xs 16 + py-0.5 4
          + border 2）—— 不定高的话，掉线那台就比邻居高 2px。定高之后徽章照旧居中，
          有/无徽章一律 22px（2026-10-15 站长要求「卡片大小与备注无关」时顺手一起钉平）。 */}
      <div className="flex h-[22px] min-w-0 items-center gap-2">
        <Country node={node} />
        <h2 className="min-w-0 flex-1 text-sm font-semibold leading-5 tracking-tight">
          {/* 链接只包住名字；`after` 把命中区上下各撑 3px（20 → 26px，过 WCAG 2.2 的 24px），
              只罩住名字这一段，不挡旗子 / 徽章 / 读数格的 title。 */}
          <a
            href={`/node/${node.id}`}
            aria-label={label}
            className="relative block min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-foreground after:absolute after:inset-x-0 after:-inset-y-[3px] after:content-['']"
            onClick={(e) => {
              // 修饰键 / 中键交还给浏览器（新标签页能直接打开 /node/:id）。
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
              e.preventDefault()
              onOpen()
            }}
          >
            <span className="block truncate">{node.name}</span>
          </a>
        </h2>
        {/* 徽章只给「接入过、现在掉线」的机器：从未接入的卡片下面那行说明已经说清了，
            连上但还没上报的更不该被盖上「已离线」。 */}
        {deployed(node) && !node.online && (
          <Badge className="shrink-0 bg-down/12 font-normal text-down">已离线</Badge>
        )}
      </div>

      {/* ② 系统 · 运行时间：与名字左对齐的一行灰字（@/lib/format 的 osName 去掉代号那截）。 */}
      <p className="mt-1 truncate text-[11px] leading-4 text-muted-foreground">{metaLine(node)}</p>

      {/* One layout for both states: a disconnected node still knows its
          cores, memory, disk size and traffic totals, and showing those with
          the live figures blank beats a stretched card with one line in it. */}
      {deployed(node) ? (
        <>
          {/* ③ 三格读数（CPU / 内存 / 存储）＋ 第四格两行速率：参考站的口径是「表名 / 读数 / 条」
              一列到底，上面一条分隔线把头部与读数区隔开。格子里只剩百分比：核数、已用 / 总量
              挪进各自的悬停说明（Meter 的 title），整页详情里仍然写全。
              ★第四格 2026-10-20 站长两轮要求：① 负载撤掉、上传 / 下载挪进这一格；② 连「网络」
                这个表名也不要 —— 只剩两行速率（`↑` / `↓` 用 --ok 区分方向）。没有表名，两行就
                顶到别的格表名那一行上，第二行正好与它们的读数行齐平；累计总量在悬停说明里
                （110px 的格子塞不下「累计 4.85 GB」）。 */}
          <div data-metrics="" className="mt-2 grid grid-cols-[1fr_1fr_1fr_1.35fr] gap-x-3 border-t pt-2">
            <Meter
              label="CPU"
              title={cores > 0 ? `${cores} 核` : undefined}
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
            <div
              data-net="cell"
              role="group"
              aria-label="上传 / 下载"
              className="min-w-0"
              title={m
                ? `上传 ${rate(m.net_tx)} · 累计 ${bytes(totalTx)}\n下载 ${rate(m.net_rx)} · 累计 ${bytes(totalRx)}`
                : `累计 ${bytes(totalTx)} / ${bytes(totalRx)}`}
            >
              {/* 数值 13px（与左边读数同档）+ 单位 10px 灰：这格没有表名、也没有条，靠这一档
                  把「649 B/s」拉回读数区那一层，而不是读成两行备注；行高 16 / 18 分别对住
                  左边「表名行 / 读数行」的基线。 */}
              <div className="tnum truncate text-right text-[13px] font-semibold leading-4">
                <span className="mr-0.5 text-[11px] font-normal text-ok-ink">↑</span>
                {upRate ? (<>{upRate[0]}{" "}<span className="text-[10px] font-normal text-muted-foreground">{upRate[1]}</span></>) : "—"}
              </div>
              <div className="tnum truncate text-right text-[13px] font-semibold leading-[18px]">
                <span className="mr-0.5 text-[11px] font-normal text-ok-ink">↓</span>
                {downRate ? (<>{downRate[0]}{" "}<span className="text-[10px] font-normal text-muted-foreground">{downRate[1]}</span></>) : "—"}
              </div>
            </div>
          </div>

          {/* ④ 总流量（2026-10-21 重排）：左「流量 · 每月 N 日 ⇄」、右「[计费方式] 已用 / 额度」。
              ★计费方式图标从「流量」旁边挪到**用量数字前面** —— 它说明的是「这个用量按哪种方式算出来的」，
                贴着数字才对；左边因此从「文字-图标-文字-图标」的三明治变成「标签 · 周期 ⇄」，一行只剩两枚
                图标且分居两端，中间不再被夹住。重置图标仍是 lucide Repeat（12px、1.8 线宽）。 */}
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
              流量
              <span aria-hidden className="size-[2px] shrink-0 rounded-full bg-current opacity-40" />
              <span data-reset className="tnum truncate">
                {/* 重置日缺失（形状漂移）写「—」而不是「每月 undefined 日」；不限量仍是 N/A。
                    2026-10-21：末尾那枚 ⇄ 去掉，直接写「重置」—— 两个字的语义比一个循环图标清楚，
                    这一行也不再是「文字-图标-文字-图标」的夹心。 */}
                {node.traffic_limit > 0 ? (resetDay > 0 ? `${resetDay} 日重置` : "—") : "N/A"}
              </span>
            </span>
            {/* 右侧：计费方式 + 用量分色（已用 13px 加粗、额度 11px 灰）—— 一行里先读到「用了多少」，
                再看是按合计 / 取大 / 单向上行算的。 */}
            <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold leading-[18px]">
              <span
                data-net-mode={node.traffic_mode || "sum"}
                title={`计费方式：${Object.hasOwn(TRAFFIC_MODE_LABEL, node.traffic_mode) ? TRAFFIC_MODE_LABEL[node.traffic_mode] : TRAFFIC_MODE_LABEL.sum}`}
                className="flex shrink-0 items-center text-muted-foreground"
              >
                <TrafficModeIcon mode={node.traffic_mode} />
              </span>
              <span className="tnum">
                {traffic.split(" / ")[0]}
                {traffic.includes(" / ") && (
                  <span className="text-[11px] font-normal text-muted-foreground">{" / "}{traffic.split(" / ").slice(1).join(" / ")}</span>
                )}
              </span>
            </span>
          </div>
          <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-ok transition-[width] duration-500"
              style={{ width: `${node.traffic_limit > 0 ? percent(monthUsage(node), node.traffic_limit) : 0}%` }}
            />
          </div>

          {/* ⑤ 底注：价格 / 到期在左、备注小卡片在右。★这一行**恒定占位**（见下面那条 ★ 注释）。
              `data-remark="card"` 是护栏的锚点（与整页详情那一块的 `data-remark-block` 区分开）。 */}
          {/* ★这一行**恒定占位**（h-4 = 16px）：有没有备注、有没有价格，卡片都一样高
              —— 2026-10-15 站长要求「无备注 / 有备注两种情况下卡片大小相同」。
              小卡片也收成紧凑档（15px），塞得进这 16px，不再把整卡撑高 6px。 */}
          <div className="mt-2 flex h-4 min-w-0 items-center justify-between gap-2 overflow-hidden">
            <span className="tnum min-w-0 truncate text-[11px] leading-4 text-muted-foreground">{note}</span>
            <span data-remark="card" className="flex min-w-0 max-w-[62%] shrink items-center justify-end gap-1 overflow-hidden">
              <RemarkChips chips={chips} />
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
