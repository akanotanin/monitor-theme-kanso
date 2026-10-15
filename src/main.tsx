import { Component, StrictMode, type ReactNode } from "react"
import { createRoot } from "react-dom/client"

import App from "./App.tsx"
import "./index.css"

/**
 * 最外层错误边界：一帧脏数据（hub 换了形状、某个字段缺失、某处拼装炸了）不该把整页变成白屏。
 *
 * ★2026-10-15 加：此前全仓没有错误边界，而 `safeNodes` 只校验 `metrics` —— 顶层字段
 *   （`os` / `cpu_name` / `currency` / 备注）形状漂移时会在渲染期抛 TypeError，React 直接卸载
 *   整棵树，访客看到的是一片白。顶层字段的归一已在 safeNodes 里补上，这里再加一层兜底：
 *   真漏了一个字段，也只是这一屏给出可读提示 + 一个重新加载。
 *
 * 类组件是错误边界**唯一**的写法（React 没有 hooks 版），所以这个文件里留这一处 class。
 */
class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state: { err: Error | null } = { err: null }
  static getDerivedStateFromError(err: Error) {
    return { err }
  }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="grid min-h-svh place-items-center p-6 text-sm text-muted-foreground">
        <div className="space-y-3 text-center">
          <p role="alert">页面渲染出错：{this.state.err.message}</p>
          <button className="underline" onClick={() => location.reload()}>重新加载</button>
        </div>
      </div>
    )
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
)
