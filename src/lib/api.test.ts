/// <reference types="node" />
import assert from "node:assert/strict"
import { safeNodes, type Node } from "./api.ts"

// 一份**完整**的节点：safeNodes 对没病的节点原样透传（下面那条身份断言钉着这条不变式）。
const node = { id: 1, name: "Node 01", os: "Debian 12", cpu_name: "AMD EPYC", currency: "CNY",
  metrics: { uptime: 100, cpu: 1, load: [0.1, 0.2, 0.3],
  mem_total: 1024, mem_used: 512, swap_total: 0, swap_used: 0, disk_total: 2048, disk_used: 1024,
  net_rx: 10, net_tx: 20, total_rx: 100, total_tx: 200, month_rx: 50, month_tx: 100,
  tcp: 3, udp: 4, procs: 20 } } as unknown as Node
assert.equal(safeNodes([node])[0], node)
for (const patch of [{ load: null }, { load: [1, "bad", 3] }, { cpu: "bad" }, { net_rx: Infinity }]) {
  const bad = { ...node, metrics: { ...node.metrics, ...patch } } as unknown as Node
  const result = safeNodes([bad, node])
  assert.equal(result[0].metrics, null)
  assert.equal(result[1], node)
}
// ★顶层字段（UI 直接读 os / cpu_name / currency）形状漂移时也要归一：类型上它们是 string，
// 运行时缺了会让 osName()/cpuName()/money() 抛 TypeError —— main.tsx 的错误边界会兜住，
// 但那时访客看到的已经是「页面渲染出错」而不是状态页。
for (const field of ["os", "cpu_name", "currency"] as const) {
  const broken = { ...node, [field]: 123 } as unknown as Node
  assert.equal(safeNodes([broken])[0][field], "", `${field} 不是字符串时要收成空串`)
  const missing = { ...node } as Record<string, unknown>
  delete missing[field]
  assert.equal(safeNodes([missing as unknown as Node])[0][field], "", `${field} 缺失时也要收成空串`)
  // 归一顶层字段不该顺手把 metrics 丢掉。
  assert.notEqual(safeNodes([broken])[0].metrics, null)
}
// ★2026-10-18：渲染路径直接读的**可选**字符串字段（旗子 / 备注 / 名字 / 那一串 join 的字段）
// 在场但类型不对时同样要归一成空串 —— 它们一路透传就是渲染期 TypeError：
//   Country 里 `(country || "").trim()`、备注里 `(public_remark ?? "").trim()` / `.split()`。
for (const field of ["name", "country", "kernel", "arch", "virt", "billing_cycle", "traffic_mode", "public_remark", "remark"] as const) {
  const broken = { ...node, [field]: 42 } as unknown as Node
  assert.equal(safeNodes([broken])[0][field], "", `${field} 在场但不是字符串时要收成空串`)
  // 而**缺失**仍然是健康的：上面那条身份不变式用的就是一个没有这些字段的节点。
  const missing = { ...node } as Record<string, unknown>
  delete missing[field]
  assert.equal(safeNodes([missing as unknown as Node])[0], missing, `${field} 缺失时节点原样透传`)
}

// ★2026-10-18：可选读数（swap / tcp / udp / procs 是 hub 1.4.1 才补的）缺一个键**不许**把整份
// 实时数据丢掉 —— 归一成 null，核心读数照常显示（否则老 hub 上卡片读数全「—」、还全部沉底）。
const originalCpu = node.metrics?.cpu
for (const field of ["swap_total", "swap_used", "tcp", "udp", "procs"] as const) {
  const partial = { ...node, metrics: { ...node.metrics } } as unknown as Node
  delete (partial.metrics as unknown as Record<string, unknown>)[field]
  const got = safeNodes([partial])[0]
  assert.notEqual(got.metrics, null, `${field} 缺失时不许把整份读数丢掉`)
  assert.equal(got.metrics?.[field], null, `${field} 缺失时归一成 null`)
  assert.equal(got.metrics?.cpu, originalCpu, `${field} 缺失不影响核心读数`)
}
// 核心读数坏掉时仍然整份不认（原来的口径不变）。
assert.equal(safeNodes([{ ...node, metrics: { ...node.metrics, cpu: "bad" } } as unknown as Node])[0].metrics, null)
assert.equal(safeNodes([{ ...node, metrics: { ...node.metrics, net_rx: Infinity } } as unknown as Node])[0].metrics, null)

console.log("invalid live reports are isolated")
