/** ainovel 规则 / 自检 / 用量类型 */

/** 自然语言规则文件（rules/*.md） */
export interface RuleFile {
  name: string
  path: string
  /** 绝对路径 */
  absPath: string
  content: string
  scope: 'global' | 'project' | 'builtin'
}

/** 模型归一化后的结构化约束（compiled-rules.json） */
export interface CompiledRules {
  version: 1
  compiledAt: string
  /** 字数范围 */
  wordCount: { min: number | null; max: number | null }
  /** 禁用词 */
  bannedWords: string[]
  /** 疲劳词阈值 */
  fatigueWords: { word: string; maxPerChapter: number }[]
  /** AI 套句检测特征 */
  aiCliches: string[]
  /** 风格要求（原始自然语言，注入提示词） */
  styleRequirements: string[]
  /** 其他约束原文 */
  other: string[]
  rawText: string
}

export interface SelfCheckRequest {
  chapterNumber: number
  text: string
}

export interface SelfCheckIssue {
  severity: 'error' | 'warning' | 'info'
  category: 'banned_word' | 'fatigue' | 'ai_cliche' | 'word_count' | 'style' | 'other'
  message: string
  line: number
  quote: string
  suggestion: string
}

export interface SelfCheckReport {
  chapterNumber: number
  checkedAt: string
  wordCount: number
  targetRange: string
  issues: SelfCheckIssue[]
  passed: boolean
  summary: string
}

/** 用量统计（~/.ainovel/usage.json 兼容 + 扩展） */
export interface UsageStats {
  schema: 2
  updatedAt: string
  overall: {
    input: number
    output: number
    cache_read: number
    cache_write: number
    cost_usd: number
    saved_usd: number
    cache_capable: boolean
  }
  per_model: Record<string, ModelUsage>
  per_agent: Record<string, ModelUsage>
}

export interface ModelUsage {
  input: number
  output: number
  cache_read: number
  cache_write: number
  cost_usd: number
  requests: number
}
