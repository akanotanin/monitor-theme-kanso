import { useEffect, useState } from "react"

export type Metrics = {
  uptime: number
  cpu: number
  load: [number, number, number]
  mem_total: number
  mem_used: number
  swap_total: number
  swap_used: number
  disk_total: number
  disk_used: number
  net_rx: number
  net_tx: number
  total_rx: number
  total_tx: number
  month_rx: number
  month_tx: number
  tcp: number
  udp: number
  procs: number
}

export type Node = {
  id: number
  name: string
  sort: number
  public: boolean
  online: boolean
  /** ISO 3166-1 alpha-2, or empty when the hub could not locate the address. */
  country: string
  /** Set by the operator; empty is ungrouped. Absent from a hub predating groups. */
  group?: string
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
  const fields = ["uptime", "cpu", "mem_total", "mem_used", "swap_total", "swap_used", "disk_total", "disk_used",
    "net_rx", "net_tx", "total_rx", "total_tx", "month_rx", "month_tx", "tcp", "udp", "procs"] as const
  // ★顶层那几个**会被 UI 直接读**的字段也在这里归一（2026-10-15 审出来）：原来只验 metrics，
  //   `os` / `cpu_name` / `currency` 形状漂移时一路透传到 osName()/cpuName()/money() 里抛 TypeError
  //   （而且全仓没有错误边界 → 整页白）。类型上它们是 string，运行时按 string 兜。
  const str = (v: unknown) => (typeof v === "string" ? v : "")
  const clean = (node: Node) => typeof node.os === "string" && typeof node.cpu_name === "string" && typeof node.currency === "string"
  return nodes.map((node) => {
    const m = node.metrics
    // 没病的节点**原样透传**（不 clone）：api.test.ts 钉着这条不变式，别为了统一写法把它改成每次 spread。
    const safe = clean(node) ? node : { ...node, os: str(node.os), cpu_name: str(node.cpu_name), currency: str(node.currency) }
    return !m || (fields.every((key) => number(m[key])) && Array.isArray(m.load) && m.load.length === 3 && m.load.every(number))
      ? safe : { ...safe, metrics: null }
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
    let closed = false
    let visible = document.visibilityState !== "hidden"

    const receive = (list: Node[]) => {
      // 非数组（帧里没 nodes / 老 hub 换形状）不能让它走到 safeNodes 里 `undefined.map`。
      const safe = safeNodes(Array.isArray(list) ? list : [])
      setNodes(safe)
      setError(null)
      setClosed(false)
    }

    const fetchOnce = () =>
      api<{ nodes: Node[] }>("/nodes")
        .then((d) => receive(d.nodes))
        .catch((e: Error) => {
          setError(e.message)
          if (e instanceof ApiError && e.status === 401) setClosed(true)
        })

    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`
    // A hub restart closes every stream. Without reconnecting, a page that
    // outlives a deploy would remain on the fallback poll for the rest of its
    // life, refreshing at a fifth of the live rate with no indication.
    const connect = () => {
      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch {
        poll ??= setInterval(fetchOnce, 5000)
        return
      }
      socket = ws
      ws.onmessage = (event) => {
        // 重连换代之后，旧连接迟到的帧不算数。
        if (socket !== ws) return
        // ★一帧坏数据不该是未捕获异常、也不该让这条连接一直错下去（原来只有 onclose 才挂兜底轮询，
        //   于是连接活着、页面却停在最后一帧上）。解析失败就补一次 HTTP 取数（2026-10-15 审出来）。
        try {
          receive(JSON.parse(event.data)?.nodes)
        } catch {
          fetchOnce()
          return
        }
        // The stream has returned; the poll was only covering for it.
        if (poll) {
          clearInterval(poll)
          poll = null
        }
      }
      ws.onerror = () => ws.close()
      ws.onclose = () => {
        // 隐藏时我们自己关的连接（以及它随后报的死）都不该把轮询/重连挂回去 —— 那是回前台的事。
        if (closed || socket !== ws || !visible) return
        poll ??= setInterval(fetchOnce, 5000)
        retry = setTimeout(connect, 5000)
      }
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

    // 后台打开的标签页（中键/⌘+点击一堆链接）连第一条都不建：等它真的露脸再补。
    if (visible) {
      fetchOnce()
      connect()
    }

    return () => {
      closed = true
      document.removeEventListener("visibilitychange", onVisibility)
      socket?.close()
      if (poll) clearInterval(poll)
      if (retry) clearTimeout(retry)
    }
  }, [])

  return { nodes, error, closed }
}
