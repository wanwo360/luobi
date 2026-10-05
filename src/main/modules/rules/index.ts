/**
 * rules IPC 域：ainovel 融合层
 *  - 全局规则：~/.ainovel/rules/*.md（原路径使用）
 *  - 书级规则：<project>/.ainovel/rules/*.md（优先级高于全局）
 *  - 内置基线：AI 套句 / 疲劳词
 *  - 提交自检：<project>/.ainovel/reviews/*.md
 */
import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { IPC } from '@shared/ipc'
import type { RuleFile, CompiledRules, SelfCheckReport } from '@shared/types/rules'
import { AINOVEL, AINOVEL_DIR, GLOBAL_AINOVEL_HOME } from '@shared/data-layout'
import { BUILTIN_CLICHES, BUILTIN_FATIGUE, runMechanicalCheck } from './engine.ts'
import { readText, writeJson, atomicWrite, homePath, getProjectRoot, toAppError, AppError } from '../shared/fs-utils'

// ============ 规则加载 ============

export async function listRuleFiles(): Promise<RuleFile[]> {
  const results: RuleFile[] = []
  const globalDir = path.join(homePath(), GLOBAL_AINOVEL_HOME, AINOVEL.rulesDir)
  const projectDir = path.join(getProjectRoot(), AINOVEL_DIR, AINOVEL.rulesDir)
  for (const [dir, scope] of [
    [globalDir, 'global'],
    [projectDir, 'project']
  ] as const) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) continue
        if (entry.name.startsWith('.')) continue
        if (!entry.name.toLowerCase().endsWith('.md')) continue
        const abs = path.join(dir, entry.name)
        results.push({
          name: entry.name,
          path: abs,
          absPath: abs,
          content: await readText(abs),
          scope
        })
      }
    } catch {
      /* 目录不存在 */
    }
  }
  return results
}

/** 组装规则文本（项目 > 全局 > 内置基线），供提示词注入 */
export async function buildRulesText(): Promise<string> {
  const rules = await listRuleFiles()
  const sections: string[] = []
  for (const rule of rules) {
    sections.push(`# ${rule.name}（${rule.scope === 'project' ? '本书' : '全局'}规则）\n${rule.content}`)
  }
  // 内置基线
  sections.push(
    `# 内置基线\n- 禁用 AI 套句：${BUILTIN_CLICHES.join('、')}\n- 疲劳词每章上限：${BUILTIN_FATIGUE.map((f) => `${f.word}≤${f.max}次`).join('，')}`
  )
  return sections.join('\n\n')
}

/** 归一化：自然语言规则 → 结构化约束（缓存到 .novelforge/compiled-rules.json） */
export async function compileRules(): Promise<CompiledRules> {
  const rules = await listRuleFiles()
  const rawText = rules.map((r) => `# ${r.name}\n${r.content}`).join('\n\n')
  const compiled: CompiledRules = {
    version: 1,
    compiledAt: new Date().toISOString(),
    wordCount: { min: null, max: null },
    bannedWords: [],
    fatigueWords: [],
    aiCliches: [...BUILTIN_CLICHES],
    styleRequirements: [],
    other: [],
    rawText
  }
  // 从自然语言中机械提取可结构化约束
  for (const rule of rules) {
    const text = rule.content
    // 字数：提取 "XX字" / "3000 字左右"
    const wc = text.match(/(\d{3,5})\s*(?:至|到|~|-)\s*(\d{3,5})\s*字/u) ?? text.match(/(\d{3,5})\s*字(?:左右)?/u)
    if (wc && wc[2]) {
      compiled.wordCount = { min: parseInt(wc[1], 10), max: parseInt(wc[2], 10) }
    } else if (wc && wc[1]) {
      const v = parseInt(wc[1], 10)
      compiled.wordCount = { min: Math.floor(v * 0.85), max: Math.ceil(v * 1.15) }
    }
    // 禁用词：包含 "不要" "禁用" "禁止" "避免" "别" 的行中的词
    const banned = text.match(/[^\n]*(?:不要|禁用|禁止|避免|别(?:用|出现|写)|不能(?:用|出现|写))[^\n]*/g) ?? []
    for (const line of banned) {
      const words = line.match(/["「『“]([^"」』”]{1,20})["」』”]/g) ?? []
      for (const w of words) {
        compiled.bannedWords.push(w.replace(/["「『“」』”]/g, ''))
      }
    }
    // 疲劳词："X 每章不超过 N 次"
    const fatigue = text.matchAll(/([一-鿿]{2,6})\s*(?:每章)?(?:最多|不超过|不能超过|≤|少于)\s*(\d+)\s*次/g)
    for (const m of fatigue) {
      compiled.fatigueWords.push({ word: m[1], maxPerChapter: parseInt(m[2], 10) })
    }
    // 风格要求：非指令性段落视为风格
    const styleLines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^[-#*\d]/.test(l) && l.length < 80)
    if (styleLines.length) compiled.styleRequirements.push(...styleLines)
  }
  await writeJson(path.join(getProjectRoot(), '.novelforge', 'compiled-rules.json'), compiled)
  return compiled
}

// ============ 自检引擎 ============

export async function runSelfCheck(text: string): Promise<SelfCheckReport> {
  const compiled = await compileRules()
  const issues = runMechanicalCheck(text, compiled)
  const chars = text.replace(/\s/g, '').length
  const targetRange = compiled.wordCount.min
    ? `${compiled.wordCount.min}~${compiled.wordCount.max ?? '不限'}字`
    : '未配置'
  const report: SelfCheckReport = {
    chapterNumber: 0,
    checkedAt: new Date().toISOString(),
    wordCount: chars,
    targetRange,
    issues,
    passed: !issues.some((i) => i.severity === 'error'),
    summary:
      issues.length === 0
        ? '未检测到问题，本章符合规则。'
        : `检测到 ${issues.filter((i) => i.severity === 'error').length} 个问题、${issues.filter((i) => i.severity === 'warning').length} 个警告、${issues.filter((i) => i.severity === 'info').length} 条提示。`
  }
  return report
}

/** 保存自检报告到 .ainovel/reviews/ */
export async function saveReview(report: SelfCheckReport, chapterNumber: number, chapterTitle: string): Promise<string> {
  const dir = path.join(getProjectRoot(), AINOVEL_DIR, AINOVEL.reviewsDir)
  await fs.mkdir(dir, { recursive: true })
  // 毫秒精度：同秒内两次保存的自检报告文件名不冲突（此前 14 位秒级会互相覆盖）
  const stamp = new Date().toISOString().replace(/[-:.T]/g, '').slice(0, 17)
  const name = `第${String(chapterNumber).padStart(3, '0')}章_${stamp}.md`
  const md = renderReviewMarkdown(report, chapterTitle)
  await atomicWrite(path.join(dir, name), md)
  return name
}

function renderReviewMarkdown(report: SelfCheckReport, chapterTitle: string): string {
  const lines = [
    `# 自检报告：${chapterTitle}`,
    '',
    `- 检查时间：${report.checkedAt}`,
    `- 字数：${report.wordCount}（目标 ${report.targetRange}）`,
    `- 结论：${report.passed ? '✅ 通过' : '⚠️ 存在问题'}`,
    '',
    report.summary,
    ''
  ]
  for (const issue of report.issues) {
    const badge = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : '💡'
    lines.push(`### ${badge} ${issue.message}`)
    lines.push(`- 行号：${issue.line}`)
    if (issue.quote) lines.push(`- 原文：\`${issue.quote}\``)
    if (issue.suggestion) lines.push(`- 建议：${issue.suggestion}`)
    lines.push('')
  }
  return lines.join('\n')
}

// ============ IPC ============

export function registerRulesIpc(): void {
  ipcMain.handle(IPC.rules.list, async () => {
    try {
      return await listRuleFiles()
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.rules.read, async (_e, absPath: string) => {
    try {
      // 只允许读 ~/.ainovel/rules 或 <project>/.ainovel/rules（与 write/delete 同级的白名单）
      const abs = path.resolve(absPath)
      const globalDir = path.resolve(homePath(), GLOBAL_AINOVEL_HOME, AINOVEL.rulesDir)
      const projectRules = path.resolve(getProjectRoot(), AINOVEL_DIR, AINOVEL.rulesDir)
      if (!abs.startsWith(globalDir + path.sep) && !abs.startsWith(projectRules + path.sep)) {
        throw new AppError('invalid_path', '只能读取规则目录内的文件', true)
      }
      const text = await readText(abs)
      return { path: abs, content: text }
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.rules.write, async (_e, absPath: string, content: string) => {
    try {
      // 只允许写 ~/.ainovel/rules 或 <project>/.ainovel/rules
      const globalDir = path.resolve(homePath(), GLOBAL_AINOVEL_HOME, AINOVEL.rulesDir)
      const projectRules = path.resolve(getProjectRoot(), AINOVEL_DIR, AINOVEL.rulesDir)
      const abs = path.resolve(absPath)
      if (!abs.startsWith(globalDir + path.sep) && !abs.startsWith(projectRules + path.sep)) {
        throw new AppError('invalid_path', '只能写入规则目录', true)
      }
      await atomicWrite(abs, content)
      return true
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.rules.delete, async (_e, absPath: string) => {
    try {
      const abs = path.resolve(absPath)
      const globalDir = path.resolve(homePath(), GLOBAL_AINOVEL_HOME, AINOVEL.rulesDir)
      const projectRules = path.resolve(getProjectRoot(), AINOVEL_DIR, AINOVEL.rulesDir)
      if (!abs.startsWith(globalDir + path.sep) && !abs.startsWith(projectRules + path.sep)) {
        throw new AppError('invalid_path', '只能删除规则目录内的文件', true)
      }
      await fs.rm(abs, { force: true })
      return true
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.rules.getDirs, () => {
    try {
      return {
        globalDir: path.join(homePath(), GLOBAL_AINOVEL_HOME, AINOVEL.rulesDir),
        projectDir: path.join(getProjectRoot(), AINOVEL_DIR, AINOVEL.rulesDir)
      }
    } catch {
      // 无当前项目：仍给出全局目录，项目目录置空（renderer 新建全局规则用）
      return { globalDir: path.join(homePath(), GLOBAL_AINOVEL_HOME, AINOVEL.rulesDir), projectDir: '' }
    }
  })

  ipcMain.handle(IPC.rules.selfCheck, async (_e, text: string) => {
    try {
      return await runSelfCheck(text)
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.rules.listReviews, async () => {
    try {
      const dir = path.join(getProjectRoot(), AINOVEL_DIR, AINOVEL.reviewsDir)
      const entries = await fs.readdir(dir).catch(() => [] as string[])
      const reviews = []
      for (const name of entries) {
        if (!name.endsWith('.md')) continue
        const stat = await fs.stat(path.join(dir, name))
        reviews.push({ name, updatedAt: stat.mtime.toISOString() })
      }
      return reviews.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.rules.readReview, async (_e, name: string) => {
    try {
      const dir = path.join(getProjectRoot(), AINOVEL_DIR, AINOVEL.reviewsDir)
      return await readText(path.join(dir, name))
    } catch (err) {
      throw toAppError(err)
    }
  })
}
