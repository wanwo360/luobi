/**
 * 模型价格表（USD / 百万 token）。
 * 用 model id 前缀匹配；未匹配的模型使用默认值。
 * 用户可在 provider 配置中覆盖。
 */

export interface ModelPrice {
  inputPerM: number
  outputPerM: number
  cacheReadPerM: number
}

export const DEFAULT_PRICE: ModelPrice = {
  inputPerM: 0.3,
  outputPerM: 1.2,
  cacheReadPerM: 0.1
}

/** 按前缀匹配的价格表（顺序优先） */
export const PRICE_TABLE: { pattern: RegExp; price: ModelPrice }[] = [
  // DeepSeek 官方（2026 参考价）
  { pattern: /^deepseek-chat/i, price: { inputPerM: 0.27, outputPerM: 1.1, cacheReadPerM: 0.07 } },
  { pattern: /^deepseek-reasoner/i, price: { inputPerM: 0.55, outputPerM: 2.19, cacheReadPerM: 0.14 } },
  { pattern: /^deepseek/i, price: { inputPerM: 0.27, outputPerM: 1.1, cacheReadPerM: 0.07 } },
  // OpenAI
  { pattern: /^gpt-4o/i, price: { inputPerM: 2.5, outputPerM: 10, cacheReadPerM: 1.25 } },
  { pattern: /^gpt-4/i, price: { inputPerM: 2.5, outputPerM: 10, cacheReadPerM: 1.25 } },
  { pattern: /^gpt-3\.5/i, price: { inputPerM: 0.5, outputPerM: 1.5, cacheReadPerM: 0.25 } },
  // Claude
  { pattern: /^claude-sonnet-4/i, price: { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3 } },
  { pattern: /^claude-opus-4/i, price: { inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.5 } },
  { pattern: /^claude-haiku-4/i, price: { inputPerM: 1, outputPerM: 5, cacheReadPerM: 0.1 } },
  { pattern: /^claude/i, price: { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3 } },
  // Gemini
  { pattern: /^gemini-2\.0-flash/i, price: { inputPerM: 0.1, outputPerM: 0.4, cacheReadPerM: 0.025 } },
  { pattern: /^gemini-2\.5/i, price: { inputPerM: 1.25, outputPerM: 10, cacheReadPerM: 0.3 } },
  { pattern: /^gemini/i, price: { inputPerM: 0.1, outputPerM: 0.4, cacheReadPerM: 0.025 } },
  // 国产（人民币换算美元近似，1 CNY ≈ 0.14 USD）
  { pattern: /^glm/i, price: { inputPerM: 0.14, outputPerM: 0.28, cacheReadPerM: 0.07 } },
  { pattern: /^qwen/i, price: { inputPerM: 0.14, outputPerM: 0.7, cacheReadPerM: 0.07 } },
  { pattern: /^moonshot|^kimi/i, price: { inputPerM: 0.84, outputPerM: 1.68, cacheReadPerM: 0.42 } },
  { pattern: /^ernie/i, price: { inputPerM: 0.14, outputPerM: 0.7, cacheReadPerM: 0.07 } },
  { pattern: /^hunyuan/i, price: { inputPerM: 0.14, outputPerM: 0.42, cacheReadPerM: 0.07 } }
]

export function priceForModel(modelId: string): ModelPrice {
  for (const entry of PRICE_TABLE) {
    if (entry.pattern.test(modelId)) return entry.price
  }
  return DEFAULT_PRICE
}

export function computeCost(
  modelId: string,
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number }
): number {
  const p = priceForModel(modelId)
  return (
    (usage.input / 1e6) * p.inputPerM +
    (usage.output / 1e6) * p.outputPerM +
    (usage.cacheRead / 1e6) * p.cacheReadPerM
  )
}
