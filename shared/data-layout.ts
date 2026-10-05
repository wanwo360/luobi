/**
 * 数据布局单一事实源 —— 磁盘布局与旧版写作工具的目录结构兼容。
 * 所有路径写入必须经过这里定义的常量与工具函数。
 * 参考：Documents/星炉/projects/default/ 的真实结构
 */

/** 工作区目录名（Documents 下） */
export const WORKSPACE_DIR_NAME = '落笔'
/** 环境变量覆盖工作区根 */
export const WORKSPACE_ENV_OVERRIDE = 'LUOBI_WORKSPACE'
/**
 * 旧版工作区目录名（用于自动识别并迁移已存在的书目）
 * 注意：这些是磁盘上的历史目录名，为兼容已有数据必须原样保留。
 */
export const LEGACY_WORKSPACE_NAMES = ['星链', '星炉', '叙述炉', '上层叙述者'] as const

/** projects 子目录（工作区下） */
export const PROJECTS_DIR = 'projects'
/** 当前项目指针文件（存 projectId 字符串） */
export const CURRENT_POINTER_FILE = 'current.json'
/** 回收站目录名 */
export const TRASH_DIR_NAME = '垃圾箱'

/** 项目 meta 文件 */
export const PROJECT_META_FILE = 'project.json'

/** 正文目录 */
export const DRAFT_DIR = '正文'
/** 历史版本目录（正文下） */
export const HISTORY_DIR = '历史版本'
/** 单卷模式成品文件名 */
export const SINGLE_VOLUME_FILE = '成品.txt'
/** 章节文件名模板：第001章.txt */
export const CHAPTER_FILE_RE = /^第\s*(\d{1,6})\s*章\.(txt|md|markdown)$/i
export function chapterFileName(n: number): string {
  return `第${String(n).padStart(3, '0')}章.txt`
}
export function chapterNumberFromFile(name: string): number | null {
  const m = CHAPTER_FILE_RE.exec(name)
  return m ? parseInt(m[1], 10) : null
}

/** 创作资料根 */
export const MATERIALS_ROOT = '创作资料'
export const MATERIALS_DIRS = {
  outline: '大纲',
  storySummary: '剧情概要',
  keyMemory: '重点记忆',
  canon: '设定沉淀',
  chapterSummaries: '章节摘要',
  generatedImages: '生成图片',
  imported: '资料'
} as const

/** 大纲子结构（真实旧版布局：平铺在创作资料根下，无"大纲/"父目录） */
export const OUTLINE = {
  master: '总纲.md',
  volumeDir: '分卷大纲', // 第001卷.md
  chapterDir: '章节细纲', // 第001章.md
  revisionDir: '大纲修订记录'
} as const
export const VOLUME_FILE_RE = /^第\s*(\d{1,6})\s*卷\.md$/i
export function volumeFileName(n: number): string {
  return `第${String(n).padStart(3, '0')}卷.md`
}

/** 剧情概要 */
export const STORY_SUMMARY_FILE = '前文剧情概要.md'

/** 重点记忆分类（旧版证实：8 分类 + INDEX.md） */
export const MEMORY_CATEGORIES = [
  '用户偏好',
  '写作思路',
  '小说规划',
  '文风偏好',
  '作品禁忌',
  '反复纠错',
  '其他'
] as const
export const MEMORY_INDEX_FILE = 'INDEX.md'

/** 设定沉淀分类（旧版证实：6 分类） */
export const CANON_CATEGORIES = [
  '人物设定',
  '世界设定',
  '实体',
  '关系',
  '伏笔',
  '时间线'
] as const

/** 索引类文件（创作资料下） */
export const INDEX_FILES = [
  '人物总索引.md',
  '伏笔账本.md',
  '爽点账本.md',
  '重要事实索引.md',
  '已公开设定.md',
  '读者认知台账.md'
] as const

/** 隐藏元数据目录（旧版） */
export const META_DIR = '.novelforge'
export const META = {
  agentsFile: 'agents.json',
  branchesDir: 'branches',
  normalChat: 'normal-chat',
  chiefRuns: 'chief-editor-runs',
  migrations: 'migrations',
  debug: 'debug',
  compiledRules: 'compiled-rules.json'
} as const

/** ainovel 融合层（项目级） */
export const AINOVEL_DIR = '.ainovel'
export const AINOVEL = {
  rulesDir: 'rules',
  usageFile: 'usage.json',
  reviewsDir: 'reviews'
} as const

/** 全局 ainovel 配置（~/.ainovel） */
export const GLOBAL_AINOVEL_HOME = '.ainovel'

/** 提示词目录（项目级） */
export const PROMPTS_DIR = 'prompts'
/** 技能目录 */
export const SKILLS_DIR = 'skills'
export const SKILL_FILE = 'SKILL.md'

/** 工作流目录（旧版 agents 工作区） */
export const WORKFLOW = {
  materials: '工作流资料',
  outputs: '工作流产物',
  runs: '工作流运行'
} as const

/** 文本文件扩展名（可读写） */
export const TEXT_EXTENSIONS = ['.md', '.markdown', '.txt'] as const
/** 图片扩展名 */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'] as const
/** 音频扩展名 */
export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'] as const
/** 视频扩展名 */
export const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.mov'] as const

/** 允许进入项目的顶层条目（备份/导入白名单，含旧版已知条目） */
export const PROJECT_TOP_LEVEL_ALLOW = new Set([
  DRAFT_DIR,
  MATERIALS_ROOT,
  META_DIR,
  PROMPTS_DIR,
  SKILLS_DIR,
  WORKFLOW.materials,
  WORKFLOW.outputs,
  WORKFLOW.runs,
  AINOVEL_DIR,
  PROJECT_META_FILE,
  'chapters', // 旧版旧名（迁移保留）
  '产物' // 旧版旧名
])

/** 章节进度默认值 */
export function defaultChapterProgress(): ChapterProgress {
  return {
    currentChapterNumber: 1,
    lastCompletedChapterNumber: 0,
    updatedAt: new Date().toISOString()
  }
}

/** 分支默认值（与真实 project.json 一致） */
export function defaultBranchState(): BranchState {
  return {
    activeBranchId: 'branch_default',
    autoStrategy: 'off',
    lastAutoBranchChapterNumber: 0,
    branches: [
      {
        id: 'branch_default',
        name: '默认分支',
        createdAt: new Date().toISOString(),
        creationType: 'initial',
        chapterProgress: defaultChapterProgress()
      }
    ]
  }
}

/** 新建项目 project.json（严格对齐真实 schema） */
export function defaultProjectMeta(id: string, name: string): ProjectMeta {
  return {
    id,
    name,
    creativeDirection: 'novel',
    creationMode: 'continuous',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    workflowSettings: { storySummaryAutoUpdateMode: 'full' },
    chapterGroups: [],
    chapterProgress: defaultChapterProgress(),
    publishingBindings: {},
    branchState: defaultBranchState()
  }
}

/** 章节文件名规则：把任意章节号规范化为第NNN章.txt */
export function normalizeChapterFile(n: number): string {
  return chapterFileName(Math.max(1, n))
}

// ============ 类型（与数据布局强绑定） ============

export interface ChapterProgress {
  currentChapterNumber: number
  lastCompletedChapterNumber: number
  updatedAt: string
}

export interface BranchMeta {
  id: string
  name: string
  createdAt: string
  creationType: 'initial' | 'manual' | 'auto'
  chapterProgress: ChapterProgress
}

export interface BranchState {
  activeBranchId: string
  autoStrategy: 'off' | 'on'
  lastAutoBranchChapterNumber: number
  branches: BranchMeta[]
}

export interface ChapterGroup {
  id: string
  name: string
  chapterNumbers: number[]
}

export interface ProjectMeta {
  id: string
  name: string
  creativeDirection: string
  creationMode: string
  createdAt: string
  updatedAt: string
  workflowSettings: {
    storySummaryAutoUpdateMode: 'full' | 'off' | 'manual'
  }
  chapterGroups: ChapterGroup[]
  chapterProgress: ChapterProgress
  publishingBindings: Record<string, unknown>
  branchState: BranchState
}

export interface ProjectSummary {
  id: string
  name: string
  path: string
  meta: ProjectMeta
  chapterCount: number
  totalChars: number
  updatedAt: string
}
