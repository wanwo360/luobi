/**
 * AI 工具定义与执行器（函数式工具循环）
 * AI 可通过工具自动读写项目文件：写大纲/写设定/写正文/读文件
 * 所有写入经白名单校验（仅创作资料与正文目录）
 */
import { promises as fs } from 'fs'
import path from 'path'
import type { ToolCall } from '@shared/types/chat'
// .ts 扩展名导入：使本模块可被纯 Node 冒烟测试直接解析（tsconfig allowImportingTsExtensions + Vite 均支持）
import { getProjectRoot, resolveProjectPath, readText, atomicWrite, AppError, homePath } from '../modules/shared/fs-utils.ts'
import { MATERIALS_ROOT, DRAFT_DIR } from '../../../shared/data-layout.ts'

/** 全局规则目录（~/.ainovel/rules/，所有作品生效） */
const GLOBAL_RULES_DIR = () => path.join(homePath(), '.ainovel', 'rules')

/** OpenAI 风格工具定义 */
export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'write_outline',
      description:
        '写入或覆盖大纲文件（总纲/分卷大纲/章节细纲/大纲修订记录）。用户要求"生成大纲/章纲/总纲"时调用。生成内容必须与已有大纲体系（上下文中的分卷大纲/章节细纲/修订记录）衔接一致，不重复已有章节情节，不推翻已定方向；修改既有规划须在回复中说明。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '项目内相对路径，如 创作资料/大纲/章节细纲/第001章.md 或 创作资料/总纲.md'
          },
          content: { type: 'string', description: 'Markdown 内容' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_deposition',
      description:
        '写入或覆盖设定沉淀文件。分类必须使用以下六个文件夹之一（不得写到设定沉淀根目录）：人物设定（人物/角色）、世界设定（世界观/地点/国家）、实体（物品/神器/组织）、关系（人物关系）、伏笔（悬念/线索）、时间线（剧情时间线/事件顺序）。用户要求"生成设定/人物/世界观/时间线/伏笔/关系"时调用。内容必须与已有设定、正文、世界状态台账一致，不臆造矛盾信息；更新人物时保留其已有关键设定。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '项目内相对路径，必须位于六个分类文件夹之一，如 创作资料/设定沉淀/时间线/主线时间线.md'
          },
          content: { type: 'string', description: 'Markdown 内容' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_chapter',
      description:
        '写入正文章节（正文/第NNN章.txt）。用户要求"写正文/写第X章"时调用。正文必须严格遵循上下文中的【下一章细纲】与【分卷大纲】：剧情走向/关键事件/出场人物/章末钩子按细纲来，不自行另起情节；细纲与卷大纲冲突时以细纲为准。正文中的资产/数量/等级/地点等状态必须以世界状态台账为准，数值变化要有交代；**角色持续状态（伤病/体力/装备损耗）必须连续：前面章节受的伤在痊愈前每章都要体现，不得凭空消失；伤势恢复必须写明过程**。',
      parameters: {
        type: 'object',
        properties: {
          chapter_number: { type: 'number', description: '章节号，如 1 表示第1章' },
          content: { type: 'string', description: '正文内容' }
        },
        required: ['chapter_number', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        '联网搜索（Bing 中文搜索，零 key、真实网络）。用户要求特定画风/风格（如"JOJO风/吉卜力风/水墨风/猫眼三姐妹风"）或生成图片前想确认风格细节时，先调用本工具搜索该风格的视觉特征、代表画师与具体描述，将搜索得到的描述写进 generate_image 的 prompt；也适用于查证资料/名词/流行梗。调用后搜索摘要会直接回填给你，引用时无需把链接全部复述给用户。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词，风格类查询建议带"风格/画风"限定，如：JOJO 荒木飞吕彦 画风 视觉特征'
          },
          count: { type: 'number', description: '返回结果数 1-8，默认 5' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description:
        '生成图片（小说封面/场景/人物插画等）。用户要求"生成图片/画一张/配图/封面"时调用。风格默认为小说封面质感（构图完整、光影层次、适合书籍封面）；用户提到"漫画"时用日系/国漫漫画画风。图片由专用图像服务生成（无水印），保存到 创作资料/生成图片/。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '图片描述（画面内容、风格、氛围），如：男主角在月光下的城堡前，冷色调，电影感，写实风格' },
          count: { type: 'number', description: '生成数量，1-4，默认 1' },
          size: { type: 'string', description: '尺寸：1024x1024（方）/ 768x1344（竖版·封面）/ 1344x768（横版），默认 1024x1024' }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_memory',
      description:
        '写入或更新重点记忆文件。分类必须使用以下七个文件夹之一（不得写到重点记忆根目录）：用户偏好（用户创作习惯/喜好）、写作思路（创作想法）、小说规划（剧情规划/大纲思路/章节计划）、文风偏好（文风/风格/例文）、作品禁忌（不能写的内容）、反复纠错（反复纠正过的问题）、其他。也可更新 世界状态台账（创作资料/重点记忆/小说规划/世界状态台账.md：角色资产/伤病/状态连续性，用户指出"主角的伤呢/数值不对/状态矛盾"时调用）、前文剧情概要（创作资料/前文剧情概要.md）、章节摘要（创作资料/章节摘要/第NNN章.md）。用户要求"记住/完善文风偏好/小说规划/写作思路"或指出逻辑矛盾时调用。内容必须与已有规划/记忆一致，更新小说规划时保留既有方向，不推翻已定剧情。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '项目内相对路径，必须位于七个分类文件夹之一，如 创作资料/重点记忆/文风偏好/文风要求.md'
          },
          content: { type: 'string', description: 'Markdown 内容' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_global_rule',
      description:
        '写入或更新全局写作规则（~/.ainovel/rules/ 下的 .md 文件，对所有作品生效）。仅当用户明确要求"全局/所有书/以后的作品/以后都..."时调用；只针对当前作品的要求用 write_memory。写入前先参考已有全局规则，避免覆盖冲突；内容用 Markdown 自然语言要求。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '规则文件名（仅文件名，如 my-style.md，自动存入 ~/.ainovel/rules/）'
          },
          content: { type: 'string', description: '规则内容（Markdown）' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_image',
      description:
        '修改已生成的图片（重绘方案：保留原图要素 + 应用修改要求重新生成）。用户要求"修改/改一下这张图/把图里的xx改成yy"时调用。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '原图相对路径，如 创作资料/生成图片/xxx.png' },
          modification: { type: 'string', description: '修改要求，如：把背景改为雪山，主角换成红色大衣，保持人物姿势和构图' }
        },
        required: ['path', 'modification']
      }
    }
  }
]

export interface PendingWrite {
  kind: 'outline' | 'deposition' | 'chapter' | 'global_rule'
  path: string
  content: string
}

export interface ToolResult {
  ok: boolean
  /** 回填给 AI 的内容（可含完整文件内容） */
  summary: string
  /** 显示给用户的简短卡片文本（默认用 summary） */
  cardText?: string
  /** 待确认写入（用户确认后才落盘） */
  pending?: PendingWrite
  /** 生成的图片相对路径列表 */
  images?: string[]
}

/** 大纲路径规范化：兼容 AI 可能写的"创作资料/大纲/xxx"，映射到真实旧版布局 */
function normalizeOutlinePath(rel: string): string {
  if (rel.startsWith('创作资料/大纲/')) {
    const rest = rel.slice('创作资料/大纲/'.length)
    if (rest === '总纲.md') return '创作资料/总纲.md'
    if (rest.startsWith('章节细纲/') || rest.startsWith('分卷大纲/') || rest.startsWith('大纲修订记录/')) {
      return '创作资料/' + rest
    }
  }
  return rel
}

/** 设定沉淀六分类 */
const DEPOSITION_CATEGORIES = ['人物设定', '世界设定', '实体', '关系', '伏笔', '时间线'] as const

/** 重点记忆七分类 */
const MEMORY_CATEGORIES = ['用户偏好', '写作思路', '小说规划', '文风偏好', '作品禁忌', '反复纠错', '其他'] as const

/** 记忆路径规范化：确保写入七个分类文件夹内（AI 写到根目录时自动归入分类） */
export function normalizeMemoryPath(rel: string): string {
  const prefix = '创作资料/重点记忆/'
  if (!rel.startsWith(prefix)) return rel
  const rest = rel.slice(prefix.length)
  if (MEMORY_CATEGORIES.some((c) => rest.startsWith(`${c}/`))) return rel
  // 散在根目录的文件 → 按文件名归入分类
  const fileName = rest.split('/').pop() ?? ''
  const matched = MEMORY_CATEGORIES.find((c) => fileName.includes(c))
  if (matched) return `${prefix}${matched}/${fileName}`
  return rel
}

/** 设定路径规范化：确保写入六个分类文件夹内（AI 写到根目录或臆造目录时自动归入正确分类） */
export function normalizeDepositionPath(rel: string): string {
  const prefix = '创作资料/设定沉淀/'
  if (!rel.startsWith(prefix)) return rel
  const rest = rel.slice(prefix.length)
  // 已在分类文件夹内 → 原样
  if (DEPOSITION_CATEGORIES.some((c) => rest.startsWith(`${c}/`))) return rel
  // 散在根目录或臆造目录的文件（如 设定沉淀/时间线.md、设定沉淀/物品/xxx.md）→ 按文件名归入分类
  const fileName = rest.split('/').pop() ?? ''
  const matched = DEPOSITION_CATEGORIES.find(
    (c) =>
      fileName.includes(c) ||
      (c === '人物设定' && /人物|角色/.test(fileName)) ||
      (c === '世界设定' && /世界|星球|地理/.test(fileName)) ||
      (c === '实体' && /物品|神器|装备|道具|青铜/.test(fileName)) ||
      (c === '伏笔' && /伏笔|悬念/.test(fileName)) ||
      (c === '时间线' && /时间线|剧情时间线/.test(fileName))
  )
  if (matched) return `${prefix}${matched}/${fileName}`
  return rel
}

/** 校验路径允许写（仅创作资料与正文） */
function assertWritable(rel: string): string {
  const abs = resolveProjectPath(rel)
  const root = getProjectRoot()
  const relNorm = path.relative(root, abs).split(path.sep).join('/')
  if (!relNorm.startsWith(`${MATERIALS_ROOT}/`) && !relNorm.startsWith(`${DRAFT_DIR}/`)) {
    throw new AppError('invalid_path', `不允许写入该路径: ${rel}`, true)
  }
  return abs
}

/** 用户确认后落盘 */
export async function confirmWrite(pending: PendingWrite): Promise<ToolResult> {
  switch (pending.kind) {
    case 'outline':
    case 'deposition': {
      const abs = assertWritable(pending.path)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await atomicWrite(abs, pending.content)
      return { ok: true, summary: `已写入 ${pending.path}（${pending.content.length} 字）` }
    }
    case 'chapter': {
      const abs = assertWritable(pending.path)
      await atomicWrite(abs, pending.content)
      const m = pending.path.match(/第(\d+)章/)
      const n = m ? parseInt(m[1], 10) : 1
      try {
        const { writeChapter } = await import('../modules/chapters')
        await writeChapter(n, pending.content)
      } catch {
        /* writeChapter 内部已写入 */
      }
      return { ok: true, summary: `已写入第${n}章正文（${pending.content.length} 字）` }
    }
    case 'global_rule': {
      // 全局规则：~/.ainovel/rules/<文件名>（所有作品生效）
      const name = pending.path.replace(/\\/g, '/').split('/').pop() ?? ''
      if (!/^[\w一-龥-]+\.md$/i.test(name)) {
        throw new AppError('invalid_path', '全局规则文件名不合法', true)
      }
      const abs = path.join(GLOBAL_RULES_DIR(), name)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await atomicWrite(abs, pending.content)
      return { ok: true, summary: `已写入全局规则 ${name}（所有作品生效，${pending.content.length} 字）` }
    }
  }
}

/** 宽容解析 AI 工具参数（容忍尾逗号/多余文本/不完整 JSON） */
function parseArgs(raw: string): Record<string, unknown> {
  const text = (raw ?? '').trim()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    // 提取首个 { ... } 块再解析
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      let block = text.slice(start, end + 1)
      // 去除尾逗号
      block = block.replace(/,\s*}/g, '}')
      try {
        const parsed = JSON.parse(block)
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
      } catch {
        return {}
      }
    }
    return {}
  }
}

/** 执行单个工具调用 */
export async function executeTool(tool: ToolCall): Promise<ToolResult> {
  try {
    const args = parseArgs(tool.arguments)
    switch (tool.name) {
      case 'write_outline': {
        let p = String(args.path ?? '')
        const content = String(args.content ?? '')
        if (!p || !p.endsWith('.md')) return { ok: false, summary: 'path 必须是 .md 文件' }
        p = normalizeOutlinePath(p)
        assertWritable(p) // 仅校验，不落盘
        return {
          ok: true,
          summary: `大纲内容已生成，待用户确认后写入 ${p}`,
          pending: { kind: 'outline', path: p, content }
        }
      }
      case 'write_deposition': {
        let p = String(args.path ?? '')
        const content = String(args.content ?? '')
        if (!p || !p.endsWith('.md')) return { ok: false, summary: 'path 必须是 .md 文件' }
        // 自动归入正确分类文件夹（防 AI 写到设定沉淀根目录）
        p = normalizeDepositionPath(p)
        assertWritable(p)
        return {
          ok: true,
          summary: `设定内容已生成，待用户确认后写入 ${p}`,
          pending: { kind: 'deposition', path: p, content }
        }
      }
      case 'write_memory': {
        let p = String(args.path ?? '')
        const content = String(args.content ?? '')
        if (!p || !p.endsWith('.md')) return { ok: false, summary: 'path 必须是 .md 文件' }
        p = normalizeMemoryPath(p)
        assertWritable(p)
        return {
          ok: true,
          summary: `记忆内容已生成，待用户确认后写入 ${p}`,
          pending: { kind: 'deposition', path: p, content }
        }
      }
      case 'write_chapter': {
        const rawN = Number(args.chapter_number)
        if (!Number.isFinite(rawN) || rawN < 1) {
          return {
            ok: false,
            summary: '缺少有效的 chapter_number 参数。请重新调用 write_chapter，传入章节号（如 1 表示第1章）。'
          }
        }
        const n = Math.floor(rawN)
        const content = String(args.content ?? '')
        if (!content) return { ok: false, summary: '内容为空' }
        assertWritable(`${DRAFT_DIR}/第${String(n).padStart(3, '0')}章.txt`)
        return {
          ok: true,
          summary: `正文已生成，待用户确认后写入第${n}章`,
          pending: { kind: 'chapter', path: `${DRAFT_DIR}/第${String(n).padStart(3, '0')}章.txt`, content }
        }
      }
      case 'read_project_file': {
        const p = String(args.path ?? '').trim()
        if (!p) {
          return {
            ok: false,
            summary: '缺少 path 参数。请重新调用 read_project_file，并传入项目内相对路径（如 创作资料/总纲.md）。'
          }
        }
        const abs = resolveProjectPath(p)
        const text = await readText(abs)
        // 完整内容回填 AI；用户只看到简短提示
        return {
          ok: true,
          summary: text.slice(0, 8000),
          cardText: `已读取 ${p}（${text.length} 字）`
        }
      }
      case 'write_global_rule': {
        const name = String(args.path ?? '').trim()
        const content = String(args.content ?? '')
        const cleanName = name.replace(/\\/g, '/').split('/').pop() ?? ''
        if (!/^[\w一-龥-]+\.md$/i.test(cleanName)) {
          return { ok: false, summary: 'path 必须是规则文件名（如 my-style.md，不含路径）' }
        }
        if (!content) return { ok: false, summary: '内容为空' }
        // 回填现有全局规则清单（防覆盖冲突）
        let existing = ''
        try {
          const files = (await fs.readdir(GLOBAL_RULES_DIR())).filter((f) => f.endsWith('.md'))
          if (files.length) {
            const lines: string[] = []
            for (const f of files.slice(0, 10)) {
              const text = (await readText(path.join(GLOBAL_RULES_DIR(), f))).slice(0, 120).replace(/\n+/g, ' ')
              lines.push(`- ${f}：${text}`)
            }
            existing = `\n\n现有全局规则（避免重复/冲突）：\n${lines.join('\n')}`
          }
        } catch {
          /* 无全局规则 */
        }
        return {
          ok: true,
          summary: `全局规则内容已生成，待用户确认后写入 ~/.ainovel/rules/${cleanName}（所有作品生效）${existing}`,
          pending: { kind: 'global_rule', path: cleanName, content }
        }
      }
      case 'web_search': {
        const query = String(args.query ?? '').trim()
        if (!query) {
          return { ok: false, summary: '缺少 query 参数。请重新调用 web_search，传入搜索关键词。' }
        }
        const { webSearch, webResultsToText } = await import('./web-search.ts')
        const count = Math.min(Math.max(Number(args.count ?? 5) || 5, 1), 8)
        const results = await webSearch(query, count)
        return {
          ok: true,
          summary: `搜索结果（${query}）：\n${webResultsToText(results)}`,
          cardText: `已联网搜索：「${query}」 ${results.length} 条结果`
        }
      }
      case 'generate_image': {
        const prompt = String(args.prompt ?? '').trim()
        if (!prompt) {
          return { ok: false, summary: '缺少 prompt 参数。请重新调用 generate_image，传入图片描述。' }
        }
        // 图片生成固定使用专用图像服务（image-config.json 中的智谱 CogView 等），与文本模型无关
        const { generateImage } = await import('../modules/image')
        const count = Math.min(Math.max(Number(args.count ?? 1) || 1, 1), 4)
        const size = String(args.size ?? '1024x1024')
        const images = await generateImage(prompt, { size, count })
        const paths = images.map((i) => i.filePath)
        return {
          ok: true,
          summary: `已生成 ${images.length} 张图片，保存到 ${paths.join('、')}`,
          images: paths
        }
      }
      case 'edit_image': {
        // 重绘方案：原图 prompt + 修改要求 → 新 prompt → 重新生成
        const relPath = String(args.path ?? '').trim()
        const modification = String(args.modification ?? '').trim()
        if (!relPath || !modification) {
          return {
            ok: false,
            summary: '缺少 path 或 modification 参数。请重新调用 edit_image，传入原图路径与修改要求。'
          }
        }
        const { generateImage, findPromptByPath } = await import('../modules/image')
        const originalPrompt = await findPromptByPath(relPath)
        const basePrompt = originalPrompt
          ? `基于以下原图描述重新绘制：${originalPrompt}。`
          : `修改图片 ${relPath}（原描述不可用，请按修改要求重新绘制）。`
        const newPrompt = `${basePrompt}修改要求：${modification}。保持整体构图与风格一致，仅应用上述修改。`
        const images = await generateImage(newPrompt, { size: '1024x1024', count: 1 })
        const paths = images.map((i) => i.filePath)
        return {
          ok: true,
          summary: `已按修改要求重新生成 1 张图片，保存到 ${paths.join('、')}`,
          images: paths
        }
      }
      default:
        return { ok: false, summary: `未知工具: ${tool.name}` }
    }
  } catch (err) {
    return { ok: false, summary: err instanceof Error ? err.message : String(err) }
  }
}
