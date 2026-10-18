import { useEffect, useState } from "react"

/**
 * 一次上报的实时读数。前十二个是**核心**（列表页的四个读数格、上传下载与总流量都靠它们）；
 * `swap_* / tcp / udp / procs` 只在详情页露面，而且是 hub 1.4.1 才补齐的 —— 老 hub 缺了这几个
 * 键时归一成 `null`（见 safeNodes），不该把整份读数丢掉（2026-10-18）。
 */
export type Metrics = {
  uptime: number
  cpu: number
  load: [number, number, number]
  mem_total: number
  mem_used: number
  disk_total: number
  disk_used: number
  net_rx: number
  net_tx: number
  total_rx: number
  total_tx: number
  month_rx: number
  month_tx: number
  /** 可选读数：老 hub 没有这些键，或形状漂移时归一成 null。 */
  swap_total: number | null
  swap_used: number | null
  tcp: number | null
  udp: number | null
  procs: number | null
}

export type Node = {
  id: number
  name: string
  sort: number
  public: boolean
  online: boolean
  /** ISO 3166-1 alpha-2, or empty when the hub could not locate the address. */
  country: string
  /**
   * 站长在后台写给访客的一行说明（单行、≤100 字，留空是空串）。hub 1.3.2 起随**公开视图**
   * 一起下发，所以匿名也拿得到——与最下面那个私有的 `remark` 不是一回事。老 hub 没有这个 key。
   * 这是访客可见的那条备注（见 `@/lib/notes`）：主题这边没有备注设置项，只读 hub 下发的字段。
   */
  public_remark?: string | null
  last_seen: number
  /**
   * 距上次上报的秒数，按 **hub 的时钟**算（hub 1.4.0 起随公开视图一起下发；从未上报为 `null`，
   * 老 hub 没有这个 key）。显示「离线 N」要用它——拿 `last_seen` 减访客浏览器的时钟，在
   * 访客时钟偏了的时候会报出错误的时长（快 8 小时就显示成离线 8 小时）。
   */
  last_seen_ago?: number | null
  metrics: Metrics | null
  os: string
  kernel: string
  arch: string
  virt: string
  cpu_name: string
  cpu_cores: number
  mem_total: number
  swap_total: number
  disk_total: number
  agent_version: string
  price: number
  currency: string
  billing_cycle: string
  expires_at: string | null
  /**
   * Days until `expires_at` on the hub's calendar, negative once past, null
   * without a date. Absent on older hubs.
   */
  expires_in?: number | null
  traffic_limit: number
  traffic_mode: string
  traffic_reset_day: number
  total_rx: number
  total_tx: number
  month_rx: number
  month_tx: number
  /** This period's usage as the plan meters it (`traffic_mode`). Absent on older hubs. */
  month_used?: number
  month_start: string
  day_rx: number
  day_tx: number
  /** Panel only. */
  hostname?: string
  ip?: string
  remark?: string
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init?.headers } : init?.headers,
  })
  if (!res.ok) throw new ApiError(res.status, (await res.text()) || res.statusText)
  return res.status === 204 ? (undefined as T) : res.json()
}

/** A malformed report must not remove every other node from the page. */
export function safeNodes(nodes: Node[]): Node[] {
  const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0
  /** 核心读数：缺一个就整份不认 —— 形状坏掉的报告不可信（原来的口径不变）。 */
  const core = ["uptime", "cpu", "mem_total", "mem_used", "disk_total", "disk_used",
    "net_rx", "net_tx", "total_rx", "total_tx", "month_rx", "month_tx"] as const
  /**
   * ★可选读数（2026-10-18 审出）：`swap_* / tcp / udp / procs` 是 hub 1.4.1 才补上的、只在详情页
   * 露面。原来它们和核心读数一起被 `every()` 卡着 —— 老 hub 少任何一个键，**整份实时数据**就被
   * 丢掉（卡片读数全是「—」、还全部沉底），代价完全不成比例。现在在场且是数字就留，否则归一成
   * null，核心读数照常显示。
   */
  const optional = ["swap_total", "swap_used", "tcp", "udp", "procs"] as const
  // ★顶层那几个**会被 UI 直接读**的字段也在这里归一（2026-10-15 审出来）：原来只验 metrics，
  //   `os` / `cpu_name` / `currency` 形状漂移时一路透传到 osName()/cpuName()/money() 里抛 TypeError。
  //   ★2026-10-18 补上渲染路径同样直接读的另外几个：旗子（country 要 .trim/.toUpperCase）、
  //   备注（public_remark / remark 要 .trim/.split）、名字与系统行那一串 join 的字段 ——
  //   形状一坏就是渲染期 TypeError、整页进错误边界。
  const str = (v: unknown) => (typeof v === "string" ? v : "")
  /** 可选字符串：**缺失 / null 都算「没写」**，只有在场且类型不对时才归一（缺失仍走身份不变式）。 */
  const optionalStr = (v: unknown) => v === undefined || v === null || typeof v === "string"
  const requiredStrings = ["os", "cpu_name", "currency"] as const
  const optionalStrings = ["name", "country", "kernel", "arch", "virt", "billing_cycle", "traffic_mode",
    "agent_version", "month_start", "hostname", "ip", "public_remark", "remark"] as const
  const cleanStrings = (node: Node) =>
    requiredStrings.every((k) => typeof node[k] === "string") && optionalStrings.every((k) => optionalStr(node[k]))
  const fixStrings = (node: Node): Node => {
    const next = { ...node } as Record<string, unknown>
    for (const key of [...requiredStrings, ...optionalStrings]) if (typeof next[key] !== "string") next[key] = str(next[key])
    return next as unknown as Node
  }
  const hasOptional = (m: Metrics) => optional.every((key) => number(m[key]))
  const normalizeMetrics = (m: Metrics): Metrics => {
    const next = { ...m } as Record<string, unknown>
    for (const key of optional) if (!number(next[key])) next[key] = null
    return next as unknown as Metrics
  }
  return nodes.map((node) => {
    // 没病的节点**原样透传**（不 clone）：api.test.ts 钉着这条不变式，别为了统一写法把它改成每次 spread。
    const safe = cleanStrings(node) ? node : fixStrings(node)
    const m = safe.metrics
    if (!m) return safe
    if (!(core.every((key) => number(m[key])) && Array.isArray(m.load) && m.load.length === 3 && m.load.every(number))) {
      return { ...safe, metrics: null }
    }
    return hasOptional(m) ? safe : { ...safe, metrics: normalizeMetrics(m) }
  })
}

/**
 * Live node list. Uses the WebSocket the hub pushes every two seconds, falling
 * back to polling if it cannot be established.
 *
 * ★ 后台标签页不再养着这条连接（2026-10-09 起，hub 1.4.0 那轮适配清单里的「切回前台」一项）：
 *   藏起来就关掉 WS、停掉兜底轮询（每 2 秒一帧、每帧一次 React 重渲染，后台里白烧电）；
 *   回到前台立刻补一次 /api/nodes 再重连。另一头是**连接数**：反代按 IP 限并发 WS，
 *   同一个访客开着的一堆标签页会互相挤（那台的 limit_conn 就是被自己的浏览器打满过）。
 */
export function useNodes() {
  const [nodes, setNodes] = useState<Node[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Set when the hub answers 401: the status page has been closed to anonymous
  // callers since this tab loaded. The hub also ends the stream, so this surfaces
  // on the fallback fetch the reconnect starts; a close allows a client to
  // re-query its state but cannot compel it.
  const [closed, setClosed] = useState(false)

  useEffect(() => {
    let socket: WebSocket | null = null
    let poll: ReturnType<typeof setInterval> | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let beat: ReturnType<typeof setInterval> | null = null
    let disposed = false
    let visible = document.visibilityState !== "hidden"
    /** 最后一帧**节点数据**到达的时刻（看门狗用，见下面的 checkStale）。 */
    let lastFrame = 0

    /** hub 每 2 秒推一帧：连着 15 秒一帧都没有，就当这条连接已经死了（≈ 丢 7 帧）。 */
    const STALE_MS = 15000

    /**
     * ★非数组一律**忽略**（2026-10-18 审出）：原来写成 `Array.isArray(list) ? list : []`，
     * 于是**一帧心跳**（`{"type":"pong"}`）、一句 hello、或者 /api/nodes 被网关换成 `{}` 200，
     * 都会把整张列表清成「还没有节点」，下一帧才恢复。返回 false 交给调用方决定怎么办：
     * WS 那边丢帧不管，HTTP 那边报一句可读的错（保留上一份数据，绝不空屏）。
     */
    const receive = (list: unknown): boolean => {
      if (!Array.isArray(list)) return false
      setNodes(safeNodes(list))
      setError(null)
      setClosed(false)
      return true
    }

    const fetchOnce = () =>
      api<{ nodes?: unknown }>("/nodes")
        .then((d) => {
          if (!receive(d?.nodes)) throw new Error("节点数据格式不对")
        })
        .catch((e: Error) => {
          setError(e.message)
          if (e instanceof ApiError && e.status === 401) setClosed(true)
        })

    /**
     * 兜底：**立刻补一次数**，然后轮询 + 5 秒后重连。两条路都会调它 —— 连接自己关掉（onclose）、
     * 以及看门狗判定装死。写法是幂等的（poll / retry 各自 `??=`，重试回调里把 retry 清掉），
     * 免得两条路撞在一起时挂出两份定时器。
     */
    const startFallback = () => {
      if (!poll) {
        void fetchOnce()
        poll = setInterval(fetchOnce, 5000)
      }
      retry ??= setTimeout(() => { retry = null; connect() }, 5000)
    }

    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`
    // A hub restart closes every stream. Without reconnecting, a page that
    // outlives a deploy would remain on the fallback poll for the rest of its
    // life, refreshing at a fifth of the live rate with no indication.
    const connect = () => {
      // 三条路（掉线重连 / 回前台 / 看门狗）可能凑到一起：换连接前先把上一条收掉，
      // 别把它留成一条没人管、还在推帧的孤儿连接。
      if (socket && typeof WebSocket !== "undefined" && socket.readyState !== WebSocket.CLOSED) {
        try { socket.close() } catch { /* 无所谓 */ }
      }
      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch {
        startFallback()
        return
      }
      socket = ws
      lastFrame = Date.now()
      ws.onmessage = (event) => {
        // 重连换代之后，旧连接迟到的帧不算数。
        if (socket !== ws) return
        // 解析失败就补一次 HTTP 取数（原来只有 onclose 才挂兜底轮询，于是连接活着、
        // 页面却停在最后一帧上 —— 2026-10-15 审出来）。
        let frame: { nodes?: unknown } | null = null
        try {
          frame = JSON.parse(event.data)
        } catch {
          fetchOnce()
          return
        }
        // 不是节点帧（心跳 / hello / 形状不对）：忽略。它也不证明这条流是活的。
        if (!receive(frame?.nodes)) return
        lastFrame = Date.now()
        // The stream has returned; the poll was only covering for it.
        if (poll) {
          clearInterval(poll)
          poll = null
        }
      }
      ws.onerror = () => ws.close()
      ws.onclose = () => {
        // 隐藏时我们自己关的连接（以及它随后报的死）都不该把轮询/重连挂回去 —— 那是回前台的事。
        if (disposed || socket !== ws || !visible) return
        startFallback()
      }
    }

    /**
     * ★看门狗（2026-10-18 审出）：只看 onclose / onerror 是不够的 —— 反代把升级接受下来、
     * 后端却再也不推帧（或移动网络半开）时，浏览器既不会报错也不会关闭，页面就一直停在第一帧
     * 上：不刷新、也不重连。关掉它，走上面那条既有路径（轮询 + 5 秒后重试）。
     */
    const checkStale = () => {
      if (disposed || !visible) return
      if (typeof WebSocket === "undefined") return
      if (!socket || socket.readyState !== WebSocket.OPEN) return
      if (Date.now() - lastFrame <= STALE_MS) return
      // 关掉它 —— 但**不指望 onclose**：对面若是「接受升级之后装死」的代理，close 握手同样等不到
      // 回应，readyState 会一直卡在 CLOSING（2026-10-18 实测：40 秒都没有 close 事件）。
      // 所以这里自己把兜底扶起来，并把这条连接从 socket 上摘掉（它的迟到事件不再算数）。
      socket.close()
      socket = null
      startFallback()
    }

    const onVisibility = () => {
      const next = document.visibilityState !== "hidden"
      if (next === visible) return
      visible = next
      if (visible) {
        // 回前台：先把数据补上（藏起来那段一帧都没收），再把连接接回去。
        fetchOnce()
        if (!socket || socket.readyState > WebSocket.OPEN) connect()
      } else {
        // 藏起来：连接让出去（它自己那条 onclose 见 visible=false，不会挂上轮询/重连）。
        socket?.close()
        if (poll) { clearInterval(poll); poll = null }
        if (retry) { clearTimeout(retry); retry = null }
      }
    }
    document.addEventListener("visibilitychange", onVisibility)

    // 看门狗常驻：隐藏 / 没连接 / 刚收到帧时它都空转，5 秒一次，可以忽略不计。
    beat = setInterval(checkStale, 5000)

    // 后台打开的标签页（中键/⌘+点击一堆链接）连第一条都不建：等它真的露脸再补。
    if (visible) {
      fetchOnce()
      connect()
    }

    return () => {
      disposed = true
      document.removeEventListener("visibilitychange", onVisibility)
      socket?.close()
      if (poll) clearInterval(poll)
      if (retry) clearTimeout(retry)
      if (beat) clearInterval(beat)
    }
  }, [])

  return { nodes, error, closed }
}
