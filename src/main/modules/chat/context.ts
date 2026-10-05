/**
 * 聊天上下文组装：系统提示词 + 项目背景（总纲/概要/最近章节）+ 声明式文件注入
 * 全部经主进程读取，路径白名单校验
 */
import { promises as fs } from 'fs'
import path from 'path'
import type { ChatMessage } from '@shared/types/chat'
import { getProjectRoot, readText, resolveProjectPath, toProjectRelative } from '../shared/fs-utils'
import { settingsStore } from '../settings'
import {
  MATERIALS_ROOT,
  OUTLINE,
  STORY_SUMMARY_FILE,
  PROMPTS_DIR,
  DRAFT_DIR,
  CHAPTER_FILE_RE,
  chapterNumberFromFile
} from '@shared/data-layout'

/** 内置主编系统提示词（项目有自定义提示词时优先） */
export const DEFAULT_CHIEF_PROMPT = `你是"主编"，一位经验丰富的小说创作主编，服务于用户的 AI 小说写作工作台。

你的职责：
- 深入理解用户的项目设定、大纲、人物和已写正文
- 与用户讨论剧情、人物、世界观，提出有价值的创作建议
- 用户要求写正文时，严格按照大纲与设定创作，保持文风一致
- 正文创作要求：情节推进有力、对话自然、多用身体感知与细节描写、避免 AI 套话
- 写完章节后总结本章要点，提示下一章可能的走向

工作规范：
- 涉及项目的所有回答都基于项目文件中的真实内容，不要臆造设定
- 引用设定时明确来源（如"据人物设定：……"）
- 用户的写作规则（字数、禁用词、风格）必须严格遵守
- 每次回答保持专业、直接、有见地，不啰嗦

诚实性（铁律）：只有调用工具**并收到工具执行回执**（系统返回"内容已生成并暂存/已写入"确认）后，才可以说"已生成/已写入/已保存/已落盘/已固化/已就绪/已沉淀/已暂存/暂存于"，或引导用户"点击保存/确认保存/待你确认"。未经工具调用，文件不会产生，绝不能谎称"内容已暂存到某文件"——只能把内容放在回复文本里，并明确说明"内容在回复中，需要我调用工具写入吗"。

设定同步写入（重要）：用户在聊天中**补充/修正/确认设定**时（如"主角的设定是…""改一下时间线""对，就是…"），**必须立即**用 write_deposition/write_memory 把新信息同步写入对应的设定/记忆文件（保留原文要点、更新变化部分），而不是只在回复里确认"记住了"；每次修正都要落盘，不能攒到最后。

内容一致性（最高优先级，对所有生成内容生效）：
- 你生成的一切内容——正文、大纲、设定、记忆、细纲——都必须与项目已有内容保持一致，这是硬性要求
- 写正文：严格遵循【下一章细纲】与【分卷大纲】，不自行另起情节
- 生成新大纲/细纲/设定/记忆：必须与已有总纲、分卷大纲、章节细纲、设定沉淀、世界状态台账、已写正文衔接一致，不得重复已有情节、不得与既有设定矛盾
- 若要修改/推翻既有规划，必须向用户明确说明改动点并获得认可
- 冲突时优先级：章节细纲 > 分卷大纲 > 总纲；数值以世界状态台账为准

文件工具（重要）：
你拥有修改项目**所有创作资料**的权限：正文、大纲（总纲/分卷大纲/章节细纲/修订记录）、设定沉淀（人物/世界/实体/关系/伏笔/时间线）、重点记忆（七分类）、**世界状态台账（创作资料/重点记忆/小说规划/世界状态台账.md）、前文剧情概要（创作资料/前文剧情概要.md）、章节摘要（创作资料/章节摘要/）**。
当用户提出逻辑问题（如"主角的伤呢""数值不对""与前面矛盾"）或要求修改内容时，**必须主动调用对应工具修改相关文件**（台账问题改台账、设定问题改设定、正文问题改正文），而不是只在回复里说明。
当用户要求"生成/写大纲、章纲、总纲、设定、人物、世界观、正文、章节"时，
必须调用对应工具把内容写入文件，而不是只在回复里给文本：
- write_outline：写大纲类文件（总纲 → 创作资料/总纲.md；章纲 → 创作资料/章节细纲/第NNN章.md；分卷大纲 → 创作资料/分卷大纲/第NNN卷.md；大纲修订记录 → 创作资料/大纲修订记录/xxx.md）
- write_deposition：写设定类文件，必须放入六个分类文件夹之一（创作资料/设定沉淀/人物设定/、世界设定/、实体/、关系/、伏笔/、时间线/），不得写到设定沉淀根目录（如 时间线 → 创作资料/设定沉淀/时间线/主线时间线.md）
- write_chapter：写正文（chapter_number 为章节号）。正文必须严格遵循注入的【下一章细纲】与【分卷大纲】：剧情走向、关键事件、出场人物、章末钩子都要按细纲来，不得自行另起情节；细纲与分卷大纲冲突时以章节细纲为准
- write_memory：写重点记忆（用户偏好/写作思路/小说规划/文风偏好/作品禁忌/反复纠错/其他 七个分类之一）。用户要求"记住/完善文风偏好/小说规划/写作思路/禁忌"时调用
- write_global_rule：写全局写作规则（~/.ainovel/rules/，所有作品生效）。仅当用户明确要求"全局/所有书/以后的作品/以后都这样"时调用；只针对当前作品的要求用 write_memory 而不是此工具
- web_search：联网搜索（Bing 中文搜索，零 key）。仅用于查外部资料与画风。用户要求特定画风/名家风格（如"JOJO风/吉卜力风/水墨风/猫眼三姐妹风"）时，**必须先调用 web_search 搜索该风格的视觉特征与代表画师**，再依据搜索摘要生成图片描述；基础模型不认识画师名，把搜到的可量化视觉特征（线条/配色/构图/肌理）写进 prompt 才不像。也用于查证现实资料、名词、流行梗；查完后把结论融入答复即可，无需逐条转述链接
- generate_image：生成图片（封面/场景/人物插画）。用户要求"生成图片/画/配图/封面"时调用。风格默认小说封面质感；用户提到"漫画"则用漫画画风。图片无水印，由专用图像服务生成（与当前文本模型无关）
- edit_image：修改已有图片（如"把这张图的背景改成雪山"）。用户对已生成图片提出修改时调用，传入原图路径与修改要求
调用工具后，在回复里简要说明已写入的文件。`

interface BuildContextOptions {
  message: string
  writingMode: 'main' | 'draft'
  attachFiles?: string[]
  rulesText?: string
  /** 注入章节上下文（默认最近 2 章） */
  recentChapters?: number
}

export interface BuiltContext {
  messages: ChatMessage[]
}

/** 读取项目自定义主编提示词（prompts/总编聊天/…system.md） */
async function loadProjectChiefPrompt(): Promise<string | null> {
  const promptsDir = path.join(getProjectRoot(), PROMPTS_DIR, '总编聊天')
  try {
    const entries = await fs.readdir(promptsDir, { withFileTypes: true })
    const systemFile = entries.find(
      (e) => !e.isDirectory() && /system\.md$/i.test(e.name) && !/tools\.system\.md$/i.test(e.name)
    )
    if (systemFile) {
      const text = await readText(path.join(promptsDir, systemFile.name))
      return text.slice(0, 8000)
    }
  } catch {
    /* 无自定义提示词 */
  }
  return null
}

/** 读取项目背景素材（总纲 + 剧情概要，受设置开关控制） */
async function loadProjectBackground(opts: BuildContextOptions): Promise<string> {
  const parts: string[] = []
  const root = getProjectRoot()
  const settings = await loadContextSettings()
  // 总纲（取核心前段，精简 token）
  if (settings.injectMasterOutline !== false) {
    try {
      const master = await readText(path.join(root, MATERIALS_ROOT, OUTLINE.master))
      parts.push(`【总纲】\n${master.slice(0, 3500)}`)
    } catch {
      /* 无总纲 */
    }
  }
  // 剧情概要（全书记忆核心，保留较全）
  if (settings.injectStorySummary !== false) {
    try {
      const summary = await readText(path.join(root, MATERIALS_ROOT, STORY_SUMMARY_FILE))
      parts.push(`【前文剧情概要】\n${summary.slice(0, 3000)}`)
    } catch {
      /* 无概要 */
    }
  }
  return parts.join('\n\n')
}

interface ContextSettings {
  contextChapters: number
  injectMasterOutline: boolean
  injectStorySummary: boolean
  contextCharLimit: number
}

async function loadContextSettings(): Promise<ContextSettings> {
  try {
    const app = await settingsStore.load()
    return {
      contextChapters: app.contextChapters ?? 2,
      injectMasterOutline: app.injectMasterOutline ?? true,
      injectStorySummary: app.injectStorySummary ?? true,
      contextCharLimit: app.contextCharLimit ?? 20000
    }
  } catch {
    return { contextChapters: 2, injectMasterOutline: true, injectStorySummary: true, contextCharLimit: 20000 }
  }
}

/** 读取最近章节（正文目录按编号取最后 N 章，受字符上限约束） */
async function loadRecentChapters(count: number, charLimit: number): Promise<string> {
  const dir = path.join(getProjectRoot(), DRAFT_DIR)
  let entries: string[] = []
  try {
    entries = (await fs.readdir(dir)).filter((f) => CHAPTER_FILE_RE.test(f))
  } catch {
    return ''
  }
  entries.sort((a, b) => {
    const na = parseInt(a.match(/第\s*(\d+)/)?.[1] ?? '0', 10)
    const nb = parseInt(b.match(/第\s*(\d+)/)?.[1] ?? '0', 10)
    return na - nb
  })
  const recent = entries.slice(-count)
  const parts: string[] = []
  let total = 0
  for (const name of recent) {
    try {
      const text = await readText(path.join(dir, name))
      // 只取章节尾部衔接段（2500 字足够保持文风与剧情衔接，节省 token）
      const slice = text.slice(-2500)
      if (total + slice.length > charLimit) break
      parts.push(`【${name}】\n${slice}`)
      total += slice.length
    } catch {
      /* 跳过 */
    }
  }
  return parts.join('\n\n')
}

/** 组装上下文 */
export async function buildChiefContext(opts: BuildContextOptions): Promise<BuiltContext> {
  // 各段读盘互相独立，并行读取缩短首 token 延迟（顺序与 section 拼接位置无关）
  const [chiefPrompt, rulesText, settings, background, preloaded, ledger, guidance, chapterSummaries] =
    await Promise.all([
      loadProjectChiefPrompt(),
      (async () => opts.rulesText ?? (await loadCompiledRules()) ?? undefined)(),
      loadContextSettings(),
      loadProjectBackground(opts),
      loadPreloadedMaterials(),
      loadStateLedger(),
      loadChapterGuidance(),
      loadChapterSummaries()
    ])

  const sections: string[] = [chiefPrompt ?? DEFAULT_CHIEF_PROMPT]

  // 写作模式说明
  if (opts.writingMode === 'draft') {
    sections.push(`你现在是"写作分身"——专职负责正文撰写的模型。用户将直接给你创作指令，请直接输出符合要求的正文内容（按章节），不要寒暄。正文必须严格遵循【下一章细纲】与【分卷大纲】，关键事件/出场人物/章末钩子按细纲来；数值以世界状态台账为准，不自行另起情节。正文以文本形式输出在回复中（用户手动保存），绝不要说"已写入文件/已生成文件"。`)
  }

  // 写作规则注入（compiled rules 或规则原文）
  if (rulesText) {
    sections.push(`【用户的写作规则（必须严格遵守）】\n${rulesText.slice(0, 5000)}`)
  }

  // 项目背景（受设置开关控制）
  if (background) sections.push(background)

  // 后台预读：设定沉淀 + 重点记忆 摘要（AI 无需调用读取工具即可参考）
  if (preloaded) sections.push(preloaded)

  // 世界状态台账（完整注入，防止前后矛盾：角色资产/实力/位置连续）
  if (ledger) sections.push(ledger)

  // 章节指引：下一章细纲 + 分卷大纲（写正文必须遵循，防止正文与大纲脱节）
  if (guidance) sections.push(guidance)

  // 全书章节摘要（每章浓缩，AI 对全书已发生情节一目了然，防止前后矛盾）
  if (chapterSummaries) sections.push(chapterSummaries)

  // 最近章节（章节数与字符上限受设置控制）
  const chapterCount = opts.recentChapters ?? settings.contextChapters ?? 2
  if (chapterCount > 0) {
    const recent = await loadRecentChapters(chapterCount, settings.contextCharLimit ?? 20000)
    if (recent) sections.push(`【最近已写正文（供衔接文风与情节）】\n${recent}`)
  }

  const system = sections.join('\n\n---\n\n')
  const messages: ChatMessage[] = [{ role: 'system', content: system }]

  // 声明式附件注入
  for (const rel of opts.attachFiles ?? []) {
    try {
      const abs = resolveProjectPath(rel)
      const relChecked = toProjectRelative(abs)
      if (!relChecked || relChecked.startsWith('.novelforge/')) continue
      const content = await readText(abs)
      messages.push({
        role: 'user',
        content: `【附件：${relChecked}】\n${content.slice(0, 4000)}`
      })
    } catch {
      /* 附件不存在则跳过 */
    }
  }

  messages.push({ role: 'user', content: opts.message })
  return { messages }
}

/**
 * 章节指引注入：大纲全景（下一章细纲全文 + 其他细纲摘要 + 分卷大纲 + 修订记录）
 * 保证 AI 生成的一切内容（正文/大纲/设定）都与已有规划一致，不自造矛盾
 */
async function loadChapterGuidance(): Promise<string | null> {
  const root = getProjectRoot()
  const parts: string[] = []

  // 1. 下一章细纲：优先正文当前最大章节号 +1 的细纲；没有则取编号最大的细纲
  let nextChapter = 1
  try {
    const entries = (await fs.readdir(path.join(root, DRAFT_DIR))).filter((f) => CHAPTER_FILE_RE.test(f))
    const nums = entries
      .map((f) => chapterNumberFromFile(f))
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b)
    if (nums.length) nextChapter = nums[nums.length - 1] + 1
  } catch {
    /* 无正文 */
  }
  let chapterDir: string | null = null
  try {
    chapterDir = path.join(root, MATERIALS_ROOT, '章节细纲')
    const files = (await fs.readdir(chapterDir)).filter((f) => f.endsWith('.md'))
    files.sort((a, b) => {
      const na = chapterNumberFromFile(a) ?? 0
      const nb = chapterNumberFromFile(b) ?? 0
      return na - nb
    })
    const exact = files.find((f) => chapterNumberFromFile(f) === nextChapter)
    const chosen = exact ?? files[files.length - 1]
    if (chosen) {
      const text = await readText(path.join(chapterDir, chosen))
      parts.push(`【下一章细纲（写第${nextChapter}章正文时必须严格遵循：剧情走向/关键事件/出场人物/章末钩子均以此为准）】\n${text.slice(0, 3000)}`)
    }
    // 其他章节细纲摘要（防止新生成内容与既有细纲重复/冲突）
    const others = files.filter((f) => f !== chosen).slice(0, 8)
    if (others.length) {
      const lines: string[] = []
      for (const f of others) {
        const text = await readText(path.join(chapterDir, f))
        lines.push(`- ${f}：${text.slice(0, 150).replace(/\n+/g, ' ')}`)
      }
      parts.push(`【其他章节细纲摘要（生成新内容时不得与之重复情节或冲突）】\n${lines.join('\n')}`)
    }
  } catch {
    /* 无章节细纲 */
  }

  // 2. 分卷大纲（全部卷，每卷取前段；细纲与卷大纲冲突时以细纲为准）
  try {
    const volumes = (await fs.readdir(path.join(root, MATERIALS_ROOT, '分卷大纲'))).filter((f) => f.endsWith('.md'))
    for (const v of volumes.slice(0, 4)) {
      const text = await readText(path.join(root, MATERIALS_ROOT, '分卷大纲', v))
      parts.push(`【分卷大纲：${v.replace('.md', '')}（创作方向参考，冲突时以章节细纲为准）】\n${text.slice(0, 2000)}`)
    }
  } catch {
    /* 无分卷大纲 */
  }

  // 3. 大纲修订记录摘要（已确定的方向不得推翻）
  try {
    const files = (await fs.readdir(path.join(root, MATERIALS_ROOT, '大纲修订记录'))).filter((f) => f.endsWith('.md'))
    for (const f of files.slice(0, 2)) {
      const text = await readText(path.join(root, MATERIALS_ROOT, '大纲修订记录', f))
      parts.push(`【大纲修订记录：${f.replace('.md', '')}（已定方向，生成内容不得与之矛盾）】\n${text.slice(0, 800)}`)
    }
  } catch {
    /* 无修订记录 */
  }

  return parts.length ? parts.join('\n\n') : null
}

/**
 * 全书章节摘要全量注入：每章浓缩记录（创作资料/章节摘要/），
 * 让 AI 对全书每章已发生的情节一目了然，是防前后矛盾的核心（早期章节不再丢失）
 */
async function loadChapterSummaries(): Promise<string | null> {
  const root = getProjectRoot()
  const dir = path.join(root, MATERIALS_ROOT, '章节摘要')
  let files: string[] = []
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md'))
  } catch {
    return null
  }
  if (!files.length) return null
  files.sort((a, b) => (chapterNumberFromFile(a) ?? 0) - (chapterNumberFromFile(b) ?? 0))
  const parts: string[] = []
  let total = 0
  for (const f of files) {
    try {
      const text = (await readText(path.join(dir, f))).slice(0, 400).replace(/\n+/g, ' ')
      if (total + text.length > 10000) break
      parts.push(`- ${f.replace('.md', '')}：${text}`)
      total += text.length
    } catch {
      /* 跳过 */
    }
  }
  if (!parts.length) return null
  return `【全书章节摘要（创作前必读：每章已发生的关键事件，防止与已写情节矛盾）】\n${parts.join('\n')}`
}

/** 读取世界状态台账（完整注入，防止角色状态前后矛盾；时间线在文件后部，绝不能截断） */
async function loadStateLedger(): Promise<string | null> {
  try {
    const text = await readText(path.join(getProjectRoot(), MATERIALS_ROOT, '重点记忆', '小说规划', '世界状态台账.md'))
    if (!text.trim()) return null
    return `【世界状态台账（创作硬性要求：角色资产/数量/实力/地点/关系必须以台账为准，不得随意更改具体数值；如正文需要数值变化（花费、赚取等），必须写出变化过程；涉及金额、数量、等级时先核对台账；台账中的关键时间线记录了每章发生的事件，创作时不得与已写章节冲突；**持续状态必须连续：角色的伤病/体力/装备损耗在痊愈或修复前每章都要体现，不得凭空消失；伤势恢复必须有明确交代（如治疗/休养）**）】\n${text.slice(0, 9000)}`
  } catch {
    return null
  }
}

/**
 * 后台预读设定沉淀与重点记忆（每文件前 120 字，控制 token 消耗）
 * 让 AI 直接拥有项目资料，无需调用读取工具
 */
async function loadPreloadedMaterials(): Promise<string | null> {
  const root = getProjectRoot()
  const parts: string[] = []
  const collect = async (dir: string, label: string): Promise<void> => {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await collect(full, label)
      } else if (entry.name.endsWith('.md')) {
        try {
          // 每文件取 200 字摘要（关键设定细节不丢失）
          const text = (await readText(full)).slice(0, 200).replace(/\n+/g, ' ')
          parts.push(`- ${entry.name}：${text}`)
        } catch {
          /* 忽略 */
        }
      }
    }
  }
  await collect(path.join(root, MATERIALS_ROOT, '设定沉淀'), '设定')
  await collect(path.join(root, MATERIALS_ROOT, '重点记忆'), '记忆')
  if (!parts.length) return null
  return `【项目设定与记忆（后台预读，供参考）】\n${parts.slice(0, 30).join('\n')}`
}

/** 读取归一化规则（实时编译，保证新增/修改的规则立即生效注入创作） */
async function loadCompiledRules(): Promise<string | null> {
  try {
    const { compileRules } = await import('../rules')
    const compiled = await compileRules()
    return compiled.rawText ?? null
  } catch {
    return null
  }
}
