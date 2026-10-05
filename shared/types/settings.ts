/** 应用设置（全局 + 项目） */

export interface AppSettings {
  /** 界面主题 */
  theme: 'light' | 'dark'
  /** 界面缩放 */
  interfaceScale: 'normal' | 'medium' | 'large'
  /** 布局：面板宽度 / 折叠态 */
  layout: {
    leftWidth: number
    rightWidth: number
    rightTab: string
    collapsed: boolean
  }
  /** 上次打开的项目 id */
  lastProjectId?: string
  /** 混合模式：写作分身使用独立（免费）模型，主编用主模型；关闭则全部跟随主编模型 */
  hybridMode: boolean
  /** 上下文：注入最近章节数（0 = 不注入） */
  contextChapters: number
  /** 上下文：注入总纲 */
  injectMasterOutline: boolean
  /** 上下文：注入剧情概要 */
  injectStorySummary: boolean
  /** 上下文：注入上限 token（近似字符数，粗估 1 token ≈ 1.2 字） */
  contextCharLimit: number
}

export interface WritingPreferences {
  /** 写作技法（自然语言，注入规则） */
  technique: string
  /** 文风偏好 / 风格例文（自然语言，注入规则） */
  style: string
  /** 高质量审稿重点 */
  reviewFocus: string
}

export interface ProjectSettings {
  /** 主编（主聊天）模型 id */
  chiefModelId: string
  /** 写作分身模型：inherit | 具体模型 id */
  writingModelId: string | 'inherit'
  /** 温度 */
  temperature: number
  /** 是否启用提交自检 */
  selfCheckOnCommit: boolean
  /** 总编系统提示词（项目级覆盖） */
  chiefSystemPrompt?: string
  /** 严格模式：规则严格遵循 */
  strictMode: boolean
  /** 高质量审稿：正文落盘前自动自检并生成报告 */
  highQualityReview: boolean
  /** 写作偏好（技法/文风/审稿重点） */
  writingPreferences: WritingPreferences
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'light',
  interfaceScale: 'normal',
  layout: { leftWidth: 240, rightWidth: 300, rightTab: 'outline', collapsed: false },
  contextChapters: 3,
  injectMasterOutline: true,
  injectStorySummary: true,
  contextCharLimit: 20000,
  hybridMode: true
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  chiefModelId: '',
  writingModelId: 'inherit',
  temperature: 0.8,
  selfCheckOnCommit: true,
  strictMode: false,
  highQualityReview: false,
  writingPreferences: {
    technique: '',
    style: '',
    reviewFocus: ''
  }
}
