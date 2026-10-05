/** 智能体（agents.json）类型 —— 与旧版语义一致 */

export type AgentKind = 'write' | 'condition'

export type AgentProviderMode = 'inherit' | 'own'

export interface AgentChatProvider {
  baseUrl?: string
  apiKey?: string
  model?: string
  apiStyle?: 'chat_completions' | 'responses' | 'anthropic_messages' | 'gemini_generate_content'
}

export interface AgentRejection {
  enabled?: boolean
  target?: string
  description?: string
}

export interface Agent {
  id: string
  name: string
  kind: AgentKind
  description: string
  /** 项目相对路径（正斜杠），读入上下文 */
  readFiles: string[]
  /** 固定白名单来源 id */
  readSources: string[]
  /** 输出文件模板（{{agentName}} 占位） */
  outputFiles: string[]
  systemPromptPath: string
  userPromptPath: string
  publishesFinalText: boolean
  enabled: boolean
  source: 'custom' | 'built-in'
  providerMode: AgentProviderMode
  chatProvider?: AgentChatProvider
  rejection?: AgentRejection
  locked?: boolean
  createdAt: string
  updatedAt: string
}

export interface AgentsFile {
  version: 1
  agents: Agent[]
}

export interface AgentRunRequest {
  agentId: string
  /** 目标章节号（write agent） */
  chapterNumber?: number
  /** 附加指令 */
  instruction?: string
}

export interface AgentRunEvent {
  type: 'run_state' | 'delta' | 'tool' | 'done' | 'error'
  runId: string
  agentId: string
  text?: string
  state?: string
  error?: string
  /** write agent 完成后写入的章节号 */
  chapterNumber?: number
}
