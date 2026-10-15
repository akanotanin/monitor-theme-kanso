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
// 运行时缺了会让 osName()/cpuName()/money() 抛 TypeError，而整页没有错误边界（2026-10-15 审出来）。
for (const field of ["os", "cpu_name", "currency"] as const) {
  const broken = { ...node, [field]: 123 } as unknown as Node
  assert.equal(safeNodes([broken])[0][field], "", `${field} 不是字符串时要收成空串`)
  const missing = { ...node } as Record<string, unknown>
  delete missing[field]
  assert.equal(safeNodes([missing as unknown as Node])[0][field], "", `${field} 缺失时也要收成空串`)
  // 归一顶层字段不该顺手把 metrics 丢掉。
  assert.notEqual(safeNodes([broken])[0].metrics, null)
}
console.log("invalid live reports are isolated")
