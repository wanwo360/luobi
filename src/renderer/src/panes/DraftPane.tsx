/** 字数格式化工具（章节列表/编辑器共用） */
export function formatChars(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万字`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}千字`
  return `${n}字`
}
