/**
 * 节点备注：hub 后台按节点填的两个字段，随 `/api/nodes` 一起下发；**合并成一份**后摊在卡片
 * 底注那一行（私有在前、公有在后，见 `remarkChips`）——最多 3 枚（见 NodeCard 的 CARD_CHIPS）。
 * 1.6.0 起备注**只显示在卡片上**：整页详情不再摊备注，也没有任何设置开关。
 *
 *   · **公开备注**（`public_remark`）——站长写给访客的一行说明（hub 1.3.2 起）：单行、≤100 字、
 *     留空就是没写；hub 存的时候就 trim 过，换行与控制字符直接拒收，所以这边拿到的一定是一行
 *     文本。它随**公开视图**下发，匿名也拿得到；老 hub 没有这个字段，按「这台没写备注」处理。
 *   · **私有备注**（`remark`）——站长写给自己的那个（面板里的 placeholder 就是「仅管理员可见」），
 *     **只在登录态下发**，匿名视图里根本没有这个键。hub 对它不做长度与控制字符校验（面板虽是
 *     单行输入框，历史数据与接口写入都可能带换行）。
 *
 * **两边的写法一致**：逗号（半角 `,` 与全角 `，`）分隔＝多枚小卡片；私有那条多一手「按换行也
 * 拆」（hub 对它没有单行约束，站长常把几件事分行写）。与 1.15.x 那份「服务器备注」清单逐字相同，
 * 从旧版迁过来不用改写。
 *
 * 放在这里（而不是组件里）是因为它们是纯函数：能脱开 React 单测，改起来不怕漏。
 */
export function publicRemark(node: { public_remark?: string | null }): string {
  // 再削一次空白：旧数据、手工改库都可能带空白，而「只有空白」应当与「没写」等价，
  // 否则会渲染出一个空的备注位（零占位的结论就假了）。
  // ★类型漂移（数字 / 对象）也按「没写」处理（2026-10-18 审出）：原来直接 `.trim()`，
  //   hub 的形状一坏就在渲染期抛 TypeError。safeNodes 也会归一，但这里是纯函数、能脱开
  //   React 单测 —— 兜住更便宜，渲染路径永远拿到字符串。
  return typeof node.public_remark === "string" ? node.public_remark.trim() : ""
}

/** 备注值 → 小卡片列表：逗号（半角 / 全角）分隔，削首尾空白、丢掉空片段。 */
export function splitTags(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

/** hub 那条公开备注 → 一枚枚小卡片。 */
export function hubTags(node: { public_remark?: string | null }): string[] {
  return splitTags(publicRemark(node))
}

/** 私有备注 → 一枚枚小卡片：**先按换行分段、段内再按逗号拆**（hub 对它没有单行约束）。 */
export function ownTags(node: { remark?: string | null }): string[] {
  // 与 publicRemark 同一道闸：类型漂移（数字 / 对象）＝没写，不让 `.split` 抛出去。
  return (typeof node.remark === "string" ? node.remark : "")
    // 换行口径：`\n` / `\r\n` 之外，裸 `\r`（接口写入与历史数据都可能带）
    // 以及 `\u000b\f\u2028\u2029` 这些「也算换行」的控制符一并拆开 ——
    // splitTags 认全角逗号的细致程度摆在那儿，只认 `\n` 会漏掉一整段（2026-10-15 审出来）。
    // eslint-disable-next-line no-control-regex -- 这些控制符本身就是「也算换行」的那一档，是有意匹配的
    .split(/[\r\n\u000b\f\u2028\u2029]+/)
    .flatMap((line) => splitTags(line))
}

/** 一枚备注小卡片：`own` 为真 = 私有（仅自己可见，版式层用描边 + 锁图标标出来）。 */
export type RemarkChip = { text: string; own: boolean }

/**
 * 卡片底注那一行用的那一份备注：**私有在前、公有在后**，都拆成一枚枚小卡片。
 *
 * 合并的好处是「一处写、处处看得到」：站长给自己标的那些（私有）与写给访客的那些（公开）排在同
 * 一处。而 hub 只把私有备注下发给**登录的管理员**，所以同一个函数在访客那边拿到的就只有公有
 * 那几枚——不需要两套分支，也不会漏泄。
 *
 * 两个字段都没有（或只有空白）→ 空数组，卡片上不摊任何小卡片
 * （1.6.0 起备注只显示在卡片上；详情页那一块已经不存在了）。
 */

export function remarkChips(node: { public_remark?: string | null; remark?: string | null }): RemarkChip[] {
  const own = ownTags(node).map((text) => ({ text, own: true }))
  const pub = hubTags(node).map((text) => ({ text, own: false }))
  return [...own, ...pub]
}
