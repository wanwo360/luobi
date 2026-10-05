/**
 * 规则引擎纯逻辑：内置基线 + 机械自检（从 index.ts 抽出，零 electron 依赖 → 可被纯 Node 冒烟测试导入）
 */
import type { CompiledRules, SelfCheckIssue } from '@shared/types/rules'

/** AI 常见套句（机械检测） */
export const BUILTIN_CLICHES = [
  '随着时间的推移',
  '总而言之',
  '综上所述',
  '不禁让人',
  '不禁感叹',
  '一种说不出的感觉',
  '仿佛时间都静止了',
  '心中涌起一股',
  '嘴角勾起一抹',
  '眼神中闪过一丝',
  '气氛变得凝重',
  '一股寒意从',
  '所谓',
  '不得不说',
  '值得一提的是',
  '在某种程度上',
  '就这样',
  '接着',
  '随后'
]

/** 疲劳词默认阈值（每章出现次数上限） */
export const BUILTIN_FATIGUE: { word: string; max: number }[] = [
  { word: '微微一笑', max: 3 },
  { word: '点了点头', max: 5 },
  { word: '皱了皱眉', max: 4 },
  { word: '目光', max: 12 },
  { word: '眼中', max: 12 },
  { word: '顿时', max: 8 },
  { word: '瞬间', max: 8 },
  { word: '仿佛', max: 8 },
  { word: '似乎', max: 8 },
  { word: '说道', max: 10 }
]

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function runMechanicalCheck(text: string, compiled: CompiledRules): SelfCheckIssue[] {
  const issues: SelfCheckIssue[] = []
  const full = text

  // 字数
  const chars = full.replace(/\s/g, '').length
  if (compiled.wordCount.min && chars < compiled.wordCount.min) {
    issues.push({
      severity: 'warning',
      category: 'word_count',
      message: `本章 ${chars} 字，低于目标下限 ${compiled.wordCount.min} 字`,
      line: 0,
      quote: '',
      suggestion: `建议补充内容至 ${compiled.wordCount.min} 字以上`
    })
  }
  if (compiled.wordCount.max && chars > compiled.wordCount.max) {
    issues.push({
      severity: 'warning',
      category: 'word_count',
      message: `本章 ${chars} 字，超过目标上限 ${compiled.wordCount.max} 字`,
      line: 0,
      quote: '',
      suggestion: `建议拆分或精简至 ${compiled.wordCount.max} 字以内`
    })
  }

  // 禁用词
  for (const word of compiled.bannedWords) {
    if (!word) continue
    const re = new RegExp(escapeRe(word), 'gi')
    let m
    while ((m = re.exec(full)) !== null) {
      const lineNo = full.slice(0, m.index).split('\n').length
      const lineStart = full.lastIndexOf('\n', m.index) + 1
      const lineEnd = full.indexOf('\n', m.index)
      const quote = full.slice(lineStart, lineEnd < 0 ? lineStart + 50 : lineEnd).slice(0, 60)
      issues.push({
        severity: 'error',
        category: 'banned_word',
        message: `出现禁用词「${word}」`,
        line: lineNo,
        quote,
        suggestion: `删除或改写「${word}」`
      })
      if (issues.length > 60) return issues
    }
  }

  // 疲劳词
  for (const { word, maxPerChapter } of compiled.fatigueWords) {
    const re = new RegExp(escapeRe(word), 'gi')
    const matches = [...full.matchAll(re)]
    if (matches.length > maxPerChapter) {
      const idx = matches[maxPerChapter].index
      const lineNo = full.slice(0, idx).split('\n').length
      const lineStart = full.lastIndexOf('\n', idx) + 1
      const lineEnd = full.indexOf('\n', idx)
      const quote = full.slice(lineStart, lineEnd < 0 ? lineStart + 50 : lineEnd).slice(0, 60)
      issues.push({
        severity: 'warning',
        category: 'fatigue',
        message: `「${word}」出现 ${matches.length} 次，超过阈值 ${maxPerChapter} 次`,
        line: lineNo,
        quote,
        suggestion: `替换其中 ${matches.length - maxPerChapter} 处为更具体的描写`
      })
    }
  }

  // AI 套句
  for (const cliche of compiled.aiCliches) {
    const re = new RegExp(escapeRe(cliche), 'g')
    let m
    while ((m = re.exec(full)) !== null) {
      const lineNo = full.slice(0, m.index).split('\n').length
      const lineStart = full.lastIndexOf('\n', m.index) + 1
      const lineEnd = full.indexOf('\n', m.index)
      const quote = full.slice(lineStart, lineEnd < 0 ? lineStart + 50 : lineEnd).slice(0, 60)
      issues.push({
        severity: 'info',
        category: 'ai_cliche',
        message: `检测到常见 AI 套句「${cliche}」`,
        line: lineNo,
        quote,
        suggestion: `改写为更具体、有信息量的表达`
      })
      if (issues.length > 60) return issues
    }
  }

  return issues
}
