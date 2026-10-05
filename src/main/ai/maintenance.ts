/**
 * 章节保存后的 AI 整理工作流：
 * 读取最新章节 → 自动更新 前文剧情概要 / 设定沉淀 / 重点记忆
 * 触发：writeChapter 落盘后（防抖 5 秒）
 */
import { promises as fs } from 'fs'
import path from 'path'
import { BrowserWindow } from 'electron'
import { providerStore } from '../modules/provider'
import { chatOnce } from './chat-engine'
import { readText, atomicWrite, getProjectRoot, readJson, writeJson } from '../modules/shared/fs-utils.ts'
import { parseJsonLenient } from './json-lenient.ts'
import { MATERIALS_ROOT, STORY_SUMMARY_FILE, DRAFT_DIR, CHAPTER_FILE_RE, chapterNumberFromFile } from '@shared/data-layout'

/** 防抖定时器 */
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let lastChapterNumber = -1
let lastContentHash = ''
/** 整理是否执行中（防止并发重复整理） */
let maintenanceBusy = false

function simpleHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return String(h)
}

/** 状态台账路径 */
const STATE_LEDGER_PATH = '创作资料/重点记忆/小说规划/世界状态台账.md'

/** 待整理队列文件（持久化：保存后退出应用也不丢，启动时补跑） */
function pendingFile(): string {
  return path.join(getProjectRoot(), '.novelforge', 'maintenance-pending.json')
}

async function persistPending(chapterNumber: number, text: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(pendingFile()), { recursive: true })
    await writeJson(pendingFile(), { chapterNumber, text, queuedAt: Date.now() })
  } catch {
    /* 持久化失败不阻塞主流程 */
  }
}

async function clearPending(): Promise<void> {
  try {
    await fs.rm(pendingFile(), { force: true })
  } catch {
    /* 忽略 */
  }
}

/** 章节保存后调度整理（防抖 + 去重 + 持久化待整理） */
export function scheduleMaintenance(chapterNumber: number, text: string): void {
  const hash = simpleHash(text)
  // 同一章节同一内容只处理一次
  if (chapterNumber === lastChapterNumber && hash === lastContentHash) return
  lastChapterNumber = chapterNumber
  lastContentHash = hash

  // 持久化待整理：即使应用在防抖期内退出，下次启动也会补跑
  void persistPending(chapterNumber, text)

  if (debounceTimer) clearTimeout(debounceTimer)
  // 立即显示排队进度（防抖 5 秒）
  emitMaintenanceProgress(`🔄 第${chapterNumber}章已保存，5 秒后自动整理（概要/台账/设定/大纲）…`)
  debounceTimer = setTimeout(() => {
    void runMaintenance(chapterNumber, text)
  }, 5000)
}

/** 应用启动时补跑积压的整理（上次退出前未完成的） */
export async function runPendingMaintenance(): Promise<boolean> {
  try {
    const data = await readJson<{ chapterNumber?: number; text?: string } | null>(pendingFile(), null)
    if (!data?.chapterNumber || !data?.text) return false
    console.log(`[整理工作流] 补跑积压整理：第${data.chapterNumber}章`)
    await runMaintenance(data.chapterNumber, data.text)
    return true
  } catch {
    return false
  }
}

/** 执行整理工作流（导出供一次性补跑/调试） */
export async function runMaintenance(chapterNumber: number, chapterText: string, isRetry = false): Promise<void> {
  // 并发保护：一次只跑一个整理（防抖已合并快速连续保存）；isRetry（解析失败递归重试）跳过
  if (maintenanceBusy && !isRetry) return
  maintenanceBusy = true
  try {
    let root: string
    try {
      root = getProjectRoot()
    } catch {
      // 当前项目已被删除 → 静默跳过整理
      return
    }
    // 进度：开始分析
    emitMaintenanceProgress(`🔍 正在整理第${chapterNumber}章：读取大纲/设定/台账…`)

    // 已更新文件计数（兜底分支也会用到，须先于使用声明）
    let updatedCount = 0

    const summaryFile = path.join(root, MATERIALS_ROOT, STORY_SUMMARY_FILE)

    // 读取现有概要
    let existingSummary = ''
    try {
      existingSummary = await readText(summaryFile)
    } catch {
      /* 无概要 */
    }

    // 读取设定沉淀与重点记忆的文件清单（名字 + 前 200 字）
    const canonFiles = await collectFiles(path.join(root, MATERIALS_ROOT, '设定沉淀'))
    const memoryFiles = await collectFiles(path.join(root, MATERIALS_ROOT, '重点记忆'))

    // 读取现有世界状态台账
    const ledgerFile = path.join(root, STATE_LEDGER_PATH)
    let existingLedger = ''
    try {
      existingLedger = await readText(ledgerFile)
    } catch {
      /* 无台账 */
    }

    // 分卷大纲全文（AI 更新时须保留原文，不能只给预览）
    const volumeFiles: string[] = []
    try {
      const files = (await fs.readdir(path.join(root, MATERIALS_ROOT, '分卷大纲'))).filter((f) => f.endsWith('.md'))
      for (const f of files.slice(0, 3)) {
        volumeFiles.push(`### ${f}\n${(await readText(path.join(root, MATERIALS_ROOT, '分卷大纲', f))).slice(0, 3000)}`)
      }
    } catch {
      /* 无分卷大纲 */
    }
    // 章节细纲清单（文件名 + 预览，用于判断是否需补建细纲）
    const outlineFiles = await collectFiles(path.join(root, MATERIALS_ROOT, '章节细纲'))

    const context = [
      `【最新保存的章节】第${chapterNumber}章：`,
      chapterText.slice(0, 8000),
      '',
      '【现有前文剧情概要】',
      existingSummary.slice(0, 4000) || '（暂无）',
      '',
      '【现有世界状态台账】',
      existingLedger.slice(0, 4000) || '（暂无）',
      '',
      '【所属分卷大纲（用于同步更新，须保留原文并标记本章已写）】',
      volumeFiles.length ? volumeFiles.slice(0, 4).join('\n') : '（暂无）',
      '',
      '【章节细纲清单（用于补建本章细纲）】',
      outlineFiles.length ? outlineFiles.slice(0, 20).join('\n') : '（暂无）',
      '',
      '【设定沉淀文件清单】',
      canonFiles.length ? canonFiles.slice(0, 15).join('\n') : '（暂无）',
      '',
      '【重点记忆文件清单】',
      memoryFiles.length ? memoryFiles.slice(0, 10).join('\n') : '（暂无）'
    ].join('\n')

    const prompt = `${context}

请分析最新章节，更新本书的创作资料与世界状态台账。只输出一个 JSON 对象（不要其他任何文字），格式：
{
  "chapter_summary": "本章摘要（150-250 字，独立成章：本章关键事件/出场人物/悬念钩子，供后续章节创作参考）",
  "summary_update": "更新后的前文剧情概要全文（Markdown，把本章关键事件并入，保持简洁 300 字内）",
  "state_update": "更新后的《世界状态台账》全文（Markdown），必须包含并逐项更新：主角当前状态（资产/实力/等级/所在地点/持有物品/人际关系）、**持续状态（伤病/体力/装备损耗/临时效果——哪一章受的伤、部位、严重程度、是否愈合；未痊愈的伤必须持续存在）**、重要配角状态、势力格局变化、关键时间线（第几章发生了什么）。新增本章导致的状态变化。若某状态无变化则保留原值。",
  "state_conflicts": [
    {"item": "资产数量", "chapter_value": "正文中出现的数值", "ledger_value": "台账记录的数值", "suggestion": "建议如何修正（保持正文或更新台账）"}
  ],
  "canon_updates": [
    {"action": "update|create", "path": "创作资料/设定沉淀/人物设定/主角.md", "content": "文件新内容（Markdown，若 update 则保留原文要点并补充新信息）"}
  ],
  "memory_updates": [
    {"action": "update|create", "path": "创作资料/重点记忆/小说规划/新剧情.md", "content": "值得记住的剧情要点（伏笔/关键转折/人物关系变化）"}
  ],
  "outline_updates": [
    {"action": "mark_done", "path": "创作资料/分卷大纲/第一卷·xxx.md", "chapter_marker": "### 第3章 能源舱室", "note": "本章已写，情节与规划一致"},
    {"action": "create", "path": "创作资料/章节细纲/第003章.md", "content": "细纲内容（记录本章实际情节）"},
    {"action": "append", "path": "创作资料/大纲修订记录/大纲完善记录.md", "content": "追加内容（第N章完成说明）"}
  ]
}
规则：
- chapter_summary 必须输出（本章浓缩摘要，供后续章节创作参考，防止前后矛盾）
- summary_update 必须输出（更新概要）
- state_update 必须输出（更新世界状态台账，这是防止前后矛盾的关键：确保如"主角第10章没钱、第20章突然暴富"这种无交代跳跃不会发生）
- state_conflicts：**一致性核对**——把正文中出现的具体数值/状态（金额、数量、等级、地点）与台账对比，若有冲突（如正文说资产 5000 但台账是 999，且正文没有交代变化过程）必须列出；无冲突则空数组
- canon_updates：**必须输出**（设定同步是硬性要求）——检查本章出现的 人物/实体/地点/伏笔/时间线 是否已有对应设定文件：①已有文件则 update（保留原文要点，补充本章新信息，如角色新状态、实体新用途、伏笔新线索）；②本章出现的新人物/新实体/新地点/新伏笔则 create 对应分类文件；③时间线必须更新：把第N章关键事件写入 创作资料/设定沉淀/时间线/ 下对应时间线文件（已有则更新，没有则创建 主线时间线.md）。禁止空数组（至少要有时间线更新）
- memory_updates：仅当有值得记住的伏笔/转折/关键信息时输出；没有则空数组
- outline_updates：**必须输出**（大纲同步是硬性要求，使用结构化增量，禁止全文重写分卷大纲）——
  ①本章所属分卷大纲：用 mark_done（chapter_marker 必须与文件中的章节标题完全一致，如「### 第3章 能源舱室」；正文与规划有出入时在 note 中说明差异与后续建议，主进程负责记录）
  ②本章若无对应章节细纲文件（见【章节细纲清单】）：用 create 创建 创作资料/章节细纲/第NNN章.md（NNN 三位章节号）记录本章实际情节
  ③大纲修订记录：用 append 追加 创作资料/大纲修订记录/大纲完善记录.md（只追加，不重写）
- 路径必须使用现有分类目录（人物设定/世界设定/实体/关系/伏笔/时间线；重点记忆的 用户偏好/写作思路/小说规划/文风偏好/作品禁忌/反复纠错/其他；大纲的 分卷大纲/章节细纲/大纲修订记录）
- 保持与已有内容一致，不要臆造`

    // 调用 AI（主编模型）
    const state = await providerStore.load()
    const provider = state.providers.find((p) => p.id === state.activeProviderId)
    if (!provider) return
    const modelId = state.activeModelId

    // 进度：AI 分析中
    emitMaintenanceProgress(`🤖 AI 正在分析第${chapterNumber}章并更新概要/台账/设定/大纲…`)

    const result = await chatOnce({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      apiStyle: provider.apiStyle,
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    })

    // 解析 JSON（容错：提取 + 修尾逗号/缺逗号）
    const data = parseJsonLenient(result.content) as {
      chapter_summary?: string
      summary_update?: string
      state_update?: string
      state_conflicts?: { item: string; chapter_value: string; ledger_value: string; suggestion: string }[]
      canon_updates?: UpdateItem[]
      memory_updates?: UpdateItem[]
      outline_updates?: UpdateItem[]
    } | null

    // 解析失败：重试一次完整整理；仍失败则降级（至少补大纲标记/时间线）
    if (!data) {
      console.error('[整理] AI 输出解析失败，原始输出前 400 字:', JSON.stringify((result.content ?? '').slice(0, 400)))
      if (!isRetry) {
        emitMaintenanceProgress('⚠️ AI 输出解析失败，正在重试…')
        await runMaintenance(chapterNumber, chapterText, true)
        return
      }
      const n = await backfillGaps(root, chapterNumber)
      emitMaintenanceProgress(
        `⚠️ 章节整理未完成（AI 输出解析失败，已重试）：已降级同步 ${n} 项大纲/时间线；下次保存章节会重新完整整理`
      )
      return
    }

    // 诊断日志：AI 输出各字段长度
    console.log(
      `[整理] 第${chapterNumber}章 AI 输出: 摘要=${(data.chapter_summary ?? '').length} 概要=${(data.summary_update ?? '').length} 台账=${(data.state_update ?? '').length} 设定=${(data.canon_updates ?? []).length} 记忆=${(data.memory_updates ?? []).length} 大纲=${(data.outline_updates ?? []).length}`
    )

    // 概要兜底：AI 未输出概要更新时，把本章摘要并入概要（保证概要不缺章）
    if (!(data.summary_update ?? '').trim() && (data.chapter_summary ?? '').trim()) {
      let existing = ''
      try {
        existing = await readText(summaryFile)
      } catch {
        /* 无概要 */
      }
      const line = `\n\n第${chapterNumber}章：${(data.chapter_summary ?? '').trim().replace(/\n+/g, ' ')}`
      await atomicWrite(summaryFile, `${existing}${existing ? line : data.chapter_summary}`)
      updatedCount++
    }

    // 写概要
    if (data.summary_update?.trim()) {
      await atomicWrite(summaryFile, data.summary_update.trim())
    }

    // 写章节摘要（每章浓缩记录，供后续章节创作参考，防止前后矛盾）
    if (data.chapter_summary?.trim()) {
      const chapterSummaryFile = path.join(
        root,
        MATERIALS_ROOT,
        '章节摘要',
        `第${String(chapterNumber).padStart(3, '0')}章.md`
      )
      await fs.mkdir(path.dirname(chapterSummaryFile), { recursive: true })
      await atomicWrite(chapterSummaryFile, data.chapter_summary.trim())
    }

    // 台账兜底：AI 未输出台账更新时，把本章摘要追加为时间线补充（保证台账不缺章）
    if (!(data.state_update ?? '').trim() && (data.chapter_summary ?? '').trim()) {
      try {
        let existing = ''
        try {
          existing = await readText(ledgerFile)
        } catch {
          /* 无台账 */
        }
        const line = `\n- 第${chapterNumber}章：${(data.chapter_summary ?? '').trim().replace(/\n+/g, ' ').slice(0, 200)}`
        await fs.mkdir(path.dirname(ledgerFile), { recursive: true })
        await atomicWrite(ledgerFile, `${existing}${existing ? line : (data.chapter_summary ?? '')}`)
        updatedCount++
      } catch {
        /* 忽略 */
      }
    }

    // 写世界状态台账
    if (data.state_update?.trim()) {
      await fs.mkdir(path.dirname(ledgerFile), { recursive: true })
      await atomicWrite(ledgerFile, data.state_update.trim())
    }

    // 写设定/记忆/大纲（路径校验：必须在创作资料下 + 记忆归入七分类 + 设定归入六分类）
    for (const item of [
      ...(data.canon_updates ?? []),
      ...(data.memory_updates ?? []),
      ...(data.outline_updates ?? [])
    ]) {
      if (!item?.path || !item.content) continue
      if (!item.path.startsWith('创作资料/')) continue
      let p = item.path
      // 记忆更新自动归入正确分类文件夹（防写到重点记忆根目录）
      if (p.startsWith('创作资料/重点记忆/')) {
        const { normalizeMemoryPath } = await import('./tools')
        p = normalizeMemoryPath(p)
      } else if (p.startsWith('创作资料/设定沉淀/')) {
        // 设定沉淀自动归入六分类（防 AI 写"物品"等臆造目录）
        const { normalizeDepositionPath } = await import('./tools')
        p = normalizeDepositionPath(p)
      }
      const abs = path.resolve(root, p)
      if (!abs.startsWith(path.join(root, MATERIALS_ROOT) + path.sep)) continue
      await fs.mkdir(path.dirname(abs), { recursive: true })
      // 分卷大纲永远不允许覆盖写（防 AI 压缩/丢失内容）：任何 action 都转为"提取章节标题 → 标记原文"
      if (p.startsWith('创作资料/分卷大纲/')) {
        let orig = ''
        try {
          orig = await readText(abs)
        } catch {
          orig = item.content?.trim() ?? ''
        }
        const extract = item.chapter_marker ?? item.content ?? ''
        const markers = extract.match(/第\s*\d+\s*章[^\n]*/g) ?? []
        let updated = orig
        for (const m of markers) {
          const title = m.replace(/✅.*$/, '').trim()
          if (!title) continue
          if (orig.includes(`${title} ✅`)) continue
          if (orig.includes(title)) updated = updated.replace(title, `${title} ✅（已写）`)
        }
        if (updated !== orig) {
          await atomicWrite(abs, updated)
          updatedCount++
        }
        continue
      }
      // 大纲修订记录防覆盖：update/create 一律转为追加
      if (p.startsWith('创作资料/大纲修订记录/') && (item.action === 'update' || item.action === 'create')) {
        let orig = ''
        try {
          orig = await readText(abs)
        } catch {
          /* 文件不存在则新建 */
        }
        const content = (item.content ?? '').trim()
        if (content) {
          await atomicWrite(abs, `${orig}${orig && !orig.endsWith('\n') ? '\n' : ''}${content}`)
          updatedCount++
        }
        continue
      }
      // 结构化增量更新：mark_done 只标记章节行（保留原文），append 只追加，其余覆盖写
      if (item.action === 'mark_done') {
        let orig = ''
        try {
          orig = await readText(abs)
        } catch {
          /* 文件不存在则新建 */
        }
        const marker = (item.chapter_marker ?? '').trim()
        let updated = orig
        if (marker) {
          if (orig.includes(`${marker} ✅`)) {
            updated = orig // 已标记过，跳过
          } else if (orig.includes(marker)) {
            updated = orig.replace(marker, `${marker} ✅（已写）`)
          } else {
            const m = marker.match(/第\s*\d+\s*章/)
            if (m && orig.includes(m[0])) {
              updated = orig.replace(m[0], `${m[0]} ✅（已写）`)
            } else {
              updated = `${orig}${orig && !orig.endsWith('\n') ? '\n' : ''}${marker} ✅（已写）`
            }
          }
        }
        if (updated !== orig) await atomicWrite(abs, updated)
        updatedCount++
      } else if (item.action === 'append') {
        let orig = ''
        try {
          orig = await readText(abs)
        } catch {
          /* 文件不存在则新建 */
        }
        const content = (item.content ?? '').trim()
        if (content) {
          await atomicWrite(abs, `${orig}${orig && !orig.endsWith('\n') ? '\n' : ''}${content}`)
          updatedCount++
        }
      } else {
        if (!item.content) continue
        await atomicWrite(abs, item.content.trim())
        updatedCount++
      }
    }

    // 兜底：补齐所有已写章节的缺口（大纲标记 + 修订记录），不限于本章——历史错过的不丢
    updatedCount += await backfillGaps(root, chapterNumber)

    // 一致性冲突提醒：AI 检测 + 机械检测（数值暴涨无来源交代）
    const conflicts = [
      ...(data.state_conflicts ?? []),
      ...mechanicalConflictCheck(chapterText, existingLedger)
    ]
    const conflictMsg =
      conflicts.length > 0
        ? `\n⚠️ 检测到 ${conflicts.length} 处状态冲突：${conflicts
            .slice(0, 3)
            .map((c) => `${c.item}（正文「${c.chapter_value}」vs 台账「${c.ledger_value}」）`)
            .join('；')}`
        : ''

    emitMaintenanceProgress(
      `✅ 第${chapterNumber}章整理完成：概要/台账/设定/大纲/细纲/修订记录已全部同步，${updatedCount} 个文件已更新${conflictMsg}`
    )
    // 清理待整理队列
    await clearPending()
  } catch (err) {
    console.error('[整理工作流] 失败:', err)
    // 失败重试一次（AI 偶发限流/网络抖动）
    try {
      await new Promise((r) => setTimeout(r, 3000))
      const rootTry = getProjectRoot()
      const retrySummaryFile = path.join(rootTry, MATERIALS_ROOT, STORY_SUMMARY_FILE)
      let existingSummary = ''
      try {
        existingSummary = await readText(retrySummaryFile)
      } catch {
        /* 无概要 */
      }
      const retryCtx = [
        `【最新保存的章节】第${chapterNumber}章：`,
        chapterText.slice(0, 8000),
        '',
        '【现有前文剧情概要】',
        existingSummary.slice(0, 4000) || '（暂无）'
      ].join('\n')
      const state = await providerStore.load()
      const provider = state.providers.find((p) => p.id === state.activeProviderId)
      if (provider) {
        const retry = await chatOnce({
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          apiStyle: provider.apiStyle,
          model: state.activeModelId,
          messages: [{ role: 'user', content: `${retryCtx}\n\n请总结这一章的内容，输出 150 字以内的章节摘要。` }],
          temperature: 0.3
        })
        const summary = (retry.content ?? '').trim().slice(0, 300)
        if (summary) {
          const chapterSummaryFile = path.join(
            rootTry,
            MATERIALS_ROOT,
            '章节摘要',
            `第${String(chapterNumber).padStart(3, '0')}章.md`
          )
          await fs.mkdir(path.dirname(chapterSummaryFile), { recursive: true })
          await atomicWrite(chapterSummaryFile, summary)
        }
      }
    } catch {
      /* 重试失败 */
    }
    emitMaintenanceProgress('⚠️ 章节整理未完成（AI 调用失败已重试）：' + (err instanceof Error ? err.message : String(err)))
    await clearPending().catch(() => {})
  } finally {
    maintenanceBusy = false
  }
}

/**
 * 机械冲突检测：正文出现远超台账的数值且无来源交代 → 标记冲突
 * 覆盖"第10章没钱、第20章突然暴富"型无交代跳跃
 */
function mechanicalConflictCheck(chapterText: string, ledgerText: string): { item: string; chapter_value: string; ledger_value: string; suggestion: string }[] {
  if (!ledgerText || !chapterText) return []
  const conflicts: { item: string; chapter_value: string; ledger_value: string; suggestion: string }[] = []
  // 从台账提取资产/金钱类数值
  const moneyPatterns = [
    /(?:信用点|元|金币|存款|余额|资产|资金)[：: ]+([\d,]{3,})/g,
    /(?:信用点|元|金币|存款|余额|资产|资金)[：: ]+约\s*([\d,]{3,})/g
  ]
  const ledgerNums: { label: string; value: number }[] = []
  for (const re of moneyPatterns) {
    let m
    while ((m = re.exec(ledgerText)) !== null) {
      ledgerNums.push({ label: m[0].slice(0, 12), value: parseInt(m[1].replace(/,/g, ''), 10) })
    }
  }
  if (!ledgerNums.length) return []
  // 正文中的来源词（说明数值变化有交代）
  const hasSource = /获得|赚|挣|继承|奖励|捡到|卖出|卖了|收入|报酬|发了笔财|赏金|佣金|交易|收到/.test(chapterText)
  // 正文中的大额数字
  const chapterNums = chapterText.match(/\d[\d,]{3,}/g) ?? []
  for (const numStr of chapterNums) {
    const num = parseInt(numStr.replace(/,/g, ''), 10)
    for (const l of ledgerNums) {
      // 正文数值远超台账（5 倍以上）且无来源交代 → 冲突
      if (num > l.value * 5 && l.value > 0 && !hasSource) {
        conflicts.push({
          item: l.label,
          chapter_value: numStr,
          ledger_value: String(l.value),
          suggestion: `正文出现 ${numStr}，台账记录 ${l.value}，且正文未交代来源（获得/赚取等）。请补写获得过程，或核对数值是否笔误。`
        })
        return conflicts
      }
    }
  }
  return conflicts
}

/** 收集目录下 md 文件（路径 + 前 400 字） */
async function collectFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 3) return []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(full, depth + 1)))
    } else if (entry.name.endsWith('.md')) {
      let preview = ''
      try {
        preview = (await readText(full)).slice(0, 200).replace(/\n/g, ' ')
      } catch {
        /* 忽略 */
      }
      out.push(`${full.replace(/\\/g, '/')}：${preview}`)
    }
  }
  return out
}

/** AI 输出的文件更新指令（设定/记忆/大纲共用结构，chapter_marker 供 mark_done 用） */
interface UpdateItem {
  action: string
  path: string
  content: string
  chapter_marker?: string
}

/**
 * 写后一致性校验网关：正文生成后（待确认前），逐条核对 台账/章节摘要/前文，
 * 发现冲突（数值、人物状态、物品、地点、伤病连续性、剧情重复）返回清单
 * 这是"像真人写书"的关键环节：写完回头检查，而不是写完就交差
 */
export async function verifyChapterConsistency(chapterText: string): Promise<
  { item: string; detail: string; suggestion: string }[]
> {
  const root = getProjectRoot()
  const parts: string[] = []
  // 台账
  try {
    const ledger = await readText(path.join(root, MATERIALS_ROOT, '重点记忆', '小说规划', '世界状态台账.md'))
    parts.push(`【世界状态台账】\n${ledger.slice(0, 6000)}`)
  } catch { /* 无台账 */ }
  // 章节摘要（全部，每章 300 字）
  try {
    const dir = path.join(root, MATERIALS_ROOT, '章节摘要')
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md'))
    files.sort((a, b) => (chapterNumberFromFile(a) ?? 0) - (chapterNumberFromFile(b) ?? 0))
    const lines: string[] = []
    for (const f of files.slice(-15)) {
      lines.push(`- ${f.replace('.md', '')}：${(await readText(path.join(dir, f))).slice(0, 300).replace(/\n+/g, ' ')}`)
    }
    if (lines.length) parts.push(`【全书章节摘要】\n${lines.join('\n')}`)
  } catch { /* 无摘要 */ }
  // 前文概要
  try {
    const s = await readText(path.join(root, MATERIALS_ROOT, STORY_SUMMARY_FILE))
    parts.push(`【前文剧情概要】\n${s.slice(0, 2000)}`)
  } catch { /* 无概要 */ }

  const prompt = `${parts.join('\n\n')}

【新写的章节正文】
${chapterText.slice(0, 8000)}

请作为严谨的编辑，逐条核对本章正文与上述前文资料（台账/章节摘要/概要），找出**与前文矛盾或脱节**的问题：
1. 数值（资产/金额/数量/等级）与前文冲突
2. 角色持续状态（伤病/体力/装备损耗）凭空消失或凭空出现
3. 人物/物品/地点状态前后不一致（拥有/丢失/在场/离开）
4. 与已写章节剧情重复（同一事件写两遍）
5. 正文中出现创作层信息（"第N章""台账"等元叙述）

只输出 JSON 数组（不要其他文字）：
[{"item": "问题类别", "detail": "具体问题描述（引用正文与前文依据）", "suggestion": "修复建议"}]
没有问题则输出 []`

  try {
    const state = await providerStore.load()
    const provider = state.providers.find((p) => p.id === state.activeProviderId)
    if (!provider) return []
    const result = await chatOnce({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      apiStyle: provider.apiStyle,
      model: state.activeModelId,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2
    })
    // AI 输出为 JSON 数组（[...]），提取首个 [ 到最后一个 ]
    const text = result.content ?? ''
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    const jsonText = start >= 0 && end > start ? text.slice(start, end + 1) : null
    if (!jsonText) {
      console.error('[校验] AI 输出无数组，前 200 字:', JSON.stringify(text.slice(0, 200)))
      return []
    }
    const parsed = JSON.parse(jsonText)
    if (!Array.isArray(parsed)) {
      console.error('[校验] AI 输出非数组:', jsonText.slice(0, 200))
      return []
    }
    return parsed.slice(0, 6) as { item: string; detail: string; suggestion: string }[]
  } catch (err) {
    console.error('[校验] 失败:', err instanceof Error ? err.message : String(err))
    return []
  }
}

/**
 * 补齐缺口：遍历所有已写章节，把缺失的大纲标记/修订记录/时间线/章节细纲补齐
 * （不限于当前章——历史整理错过的不丢；幂等，已补齐的跳过）
 * @returns 本次补了几项
 */
export async function backfillGaps(root: string, currentChapter?: number): Promise<number> {
  let count = 0
  // 已写章节号列表
  let nums: number[] = []
  try {
    nums = (await fs.readdir(path.join(root, DRAFT_DIR)))
      .filter((f) => CHAPTER_FILE_RE.test(f))
      .map((f) => chapterNumberFromFile(f))
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b)
  } catch {
    return 0
  }
  if (!nums.length) return 0

  // 章节摘要缓存（补记录用）
  const summaryFor = async (n: number): Promise<string | null> => {
    try {
      const t = await readText(path.join(root, MATERIALS_ROOT, '章节摘要', `第${String(n).padStart(3, '0')}章.md`))
      return t.trim() || null
    } catch {
      return null
    }
  }

  // ① 分卷大纲标记：所有卷文件里把已写章节标 ✅（已写）
  try {
    const vols = (await fs.readdir(path.join(root, MATERIALS_ROOT, '分卷大纲'))).filter((f) => f.endsWith('.md'))
    for (const v of vols) {
      const vf = path.join(root, MATERIALS_ROOT, '分卷大纲', v)
      let orig = ''
      try {
        orig = await readText(vf)
      } catch {
        continue
      }
      let updated = orig
      for (const n of nums) {
        const titleRe = new RegExp(`第\\s*${n}\\s*章[^\\n✅]*`)
        const m = updated.match(titleRe)
        if (m) {
          // 去掉"（待写）"残留，避免与"已写"矛盾
          const title = m[0].trim().replace('（待写）', '').replace('(待写)', '').trim()
          if (!updated.includes(`${title} ✅`)) {
            updated = updated.replace(m[0], `${title} ✅（已写）`)
          }
        }
      }
      // 清理历史残留的矛盾/重复格式
      updated = updated
        .replace(/（待写）\s*✅（已写）/g, '✅（已写）')
        .replace(/\(待写\)\s*✅（已写）/g, '✅（已写）')
        .replace(/✅（已写）\s*✅（已写）/g, '✅（已写）')
      if (updated !== orig) {
        await atomicWrite(vf, updated)
        count++
      }
    }
  } catch {
    /* 无分卷大纲 */
  }

  // ② 修订记录：每个已写章节应有"第N章完成"段落，缺则用摘要追加
  try {
    const revDir = path.join(root, MATERIALS_ROOT, '大纲修订记录')
    const revFiles = (await fs.readdir(revDir)).filter((f) => f.endsWith('.md'))
    const revTarget = revFiles.length ? path.join(revDir, revFiles[0]) : path.join(revDir, '大纲完善记录.md')
    let orig = ''
    try {
      orig = await readText(revTarget)
    } catch {
      /* 新建 */
    }
    let updated = orig
    let changed = false
    for (const n of nums) {
      // 段落级判断：存在"第N章完成/完成说明"段落才视为已记录（避免"提到第N章"误判）
      if (updated.includes(`第${n}章完成`) || updated.includes(`第${String(n).padStart(3, '0')}章完成`)) {
        continue
      }
      const summary = await summaryFor(n)
      if (!summary) continue
      const line = `## 第${n}章完成\n${summary.replace(/\n+/g, ' ')}`
      updated = `${updated}${updated && !updated.endsWith('\n') ? '\n' : ''}${line}`
      changed = true
    }
    if (changed) {
      await fs.mkdir(path.dirname(revTarget), { recursive: true })
      await atomicWrite(revTarget, updated)
      count++
    }
  } catch {
    /* 无修订记录目录 */
  }

  // ③ 时间线：每个已写章节有时间线记录，缺则用摘要追加
  try {
    const tlDir = path.join(root, MATERIALS_ROOT, '设定沉淀', '时间线')
    const tlFiles = (await fs.readdir(tlDir)).filter((f) => f.endsWith('.md'))
    const mainFile = path.join(tlDir, '主线时间线.md')
    const target = tlFiles.length ? path.join(tlDir, tlFiles[0]) : mainFile
    let orig = ''
    try {
      orig = await readText(target)
    } catch {
      /* 新建 */
    }
    let updated = orig
    let changed = false
    for (const n of nums) {
      if (orig.includes(`第${n}章`) || orig.includes(`第${String(n).padStart(3, '0')}章`)) continue
      const summary = await summaryFor(n)
      if (!summary) continue
      updated = `${updated}${updated && !updated.endsWith('\n') ? '\n' : ''}- 第${n}章：${summary.replace(/\n+/g, ' ').slice(0, 200)}`
      changed = true
    }
    if (changed) {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await atomicWrite(target, updated)
      count++
    }
  } catch {
    /* 无时间线目录 */
  }

  // ④ 章节细纲：已写章节缺细纲 → 用摘要创建
  try {
    for (const n of nums) {
      const outlineFile = path.join(root, MATERIALS_ROOT, '章节细纲', `第${String(n).padStart(3, '0')}章.md`)
      try {
        await fs.access(outlineFile)
        continue
      } catch {
        /* 需创建 */
      }
      const summary = await summaryFor(n)
      if (!summary) continue
      await fs.mkdir(path.dirname(outlineFile), { recursive: true })
      await atomicWrite(outlineFile, `# 第${n}章 章节细纲（已写章节记录）\n\n${summary}`)
      count++
    }
  } catch {
    /* 忽略 */
  }

  return count
}

/**
 * 为已写章节补生成章节摘要（一次性补跑，跳过已有摘要）
 * 用于老项目升级：正文已有章节但 章节摘要/ 为空时调用
 */
export async function backfillChapterSummaries(maxChapters = 50): Promise<number> {
  const root = getProjectRoot()
  let entries: string[] = []
  try {
    entries = (await fs.readdir(path.join(root, DRAFT_DIR))).filter((f) => CHAPTER_FILE_RE.test(f))
  } catch {
    return 0
  }
  entries.sort((a, b) => (chapterNumberFromFile(a) ?? 0) - (chapterNumberFromFile(b) ?? 0))
  const state = await providerStore.load()
  const provider = state.providers.find((p) => p.id === state.activeProviderId)
  if (!provider) return 0

  let count = 0
  for (const name of entries.slice(0, maxChapters)) {
    const n = chapterNumberFromFile(name)
    if (n === null) continue
    const summaryFile = path.join(root, MATERIALS_ROOT, '章节摘要', `第${String(n).padStart(3, '0')}章.md`)
    try {
      await fs.access(summaryFile)
      continue // 已有摘要
    } catch {
      /* 需要生成 */
    }
    const text = await readText(path.join(root, DRAFT_DIR, name))
    const result = await chatOnce({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      apiStyle: provider.apiStyle,
      model: state.activeModelId,
      messages: [
        {
          role: 'user',
          content: `请为以下章节生成 150-250 字的浓缩摘要（只输出摘要正文，不要标题）：关键事件/出场人物/悬念钩子。\n\n${text.slice(0, 6000)}`
        }
      ],
      temperature: 0.3
    })
    const summary = (result.content ?? '').trim().slice(0, 300)
    if (!summary) continue
    await fs.mkdir(path.dirname(summaryFile), { recursive: true })
    await atomicWrite(summaryFile, summary)
    count++
  }
  return count
}

/** 推送整理进度到前端（聊天事件，固定 tool.id → 前端同一卡片实时更新文本） */
function emitMaintenanceProgress(message: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('luobi:chat:event', {
      type: 'tool_end',
      runId: 'maintenance',
      messageId: `maintenance-progress`,
      tool: { id: 'maintenance', name: '章节自动整理', arguments: '' },
      toolResult: { ok: true, summary: message }
    })
  }
}
