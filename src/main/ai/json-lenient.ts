/**
 * AI 输出 JSON 容错解析（从 maintenance 抽出，零运行时依赖 → 可被纯 Node 冒烟测试导入）
 * 常见问题：尾逗号、缺逗号、**输出被 token 上限截断**（glm-4-flash 长 JSON 常发生）
 */

/** 从 AI 输出中提取 JSON（取首个 { 到最后一个 } 的区间） */
export function extractJson(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  const end = text.lastIndexOf('}')
  // 无闭合 }（输出被 token 截断，如 `{"a":"x","b":"y"`）：取 { 到末尾，
  // 交给 parseJsonLenient 的截断恢复（逐字段提取已闭合的键值）
  if (end < start) return text.slice(start)
  return text.slice(start, end + 1)
}

/**
 * 容错解析 AI 输出的 JSON：依次尝试 原样 → 修尾逗号 → 修缺逗号 → 截断恢复（逐字段提取）
 */
export function parseJsonLenient(text: string): unknown | null {
  const raw = extractJson(text)
  if (!raw) return null
  // 标准 JSON 解析尝试
  const attempts: (() => string | null)[] = [
    () => raw,
    // 修尾逗号：,} 或 ,] 前不能有逗号
    () => raw.replace(/,\s*([}\]])/g, '$1'),
    // 修缺逗号：仅闭合符（} ]）后跟开括号（{ [）时补逗号。
    // 注意：不能匹配"空白+["——会把合法 JSON 的 `: [[`（数组值开头的 [ 前是空白）误改为 `: ,[[`
    () =>
      raw
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/([}\]])\s*(\{|\[)/g, '$1,$2')
  ]
  for (const make of attempts) {
    try {
      const s = make()
      if (!s) continue
      const parsed = JSON.parse(s)
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      /* 尝试下一种 */
    }
  }
  // 截断恢复：逐个提取已完整闭合的顶层字段（截断处之后丢失的字段由兜底补齐）
  const out: Record<string, unknown> = {}
  for (const m of raw.matchAll(/"([A-Za-z_]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    out[m[1]] = m[2]
  }
  for (const m of raw.matchAll(/"([A-Za-z_]+)"\s*:\s*(\[[\s\S]*?\])/g)) {
    try {
      out[m[1]] = JSON.parse(m[2])
    } catch {
      /* 忽略坏数组 */
    }
  }
  return Object.keys(out).length ? out : null
}
