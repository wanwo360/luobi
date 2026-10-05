/** 聊天 / 会话引擎类型 */

export type ChatMessageRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: ChatMessageRole
  content: string
  name?: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  /** 推理内容（reasoning_content，deepseek-reasoner） */
  reasoning?: string
}

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

/** 消息事件类型（渲染端消息流） */
export type ChatEventType =
  | 'delta' // 流式文本增量
  | 'reasoning_delta' // 推理增量
  | 'message_start'
  | 'message_end'
  | 'tool_start'
  | 'tool_end'
  | 'run_state' // 状态机变更
  | 'error'

export interface ChatEvent {
  type: ChatEventType
  runId: string
  messageId?: string
  text?: string
  tool?: ToolCall
  toolResult?: { ok: boolean; summary: string }
  /** 待确认写入（AI 生成内容，用户确认后落盘） */
  pendingWrite?: {
    key: string
    kind: 'outline' | 'deposition' | 'chapter' | 'global_rule'
    path: string
    content: string
  }
  /** 生成的图片相对路径列表 */
  images?: string[]
  state?: RunState
  error?: { code: string; message: string; recoverable: boolean }
}

export type RunState =
  | 'idle'
  | 'queued'
  | 'streaming'
  | 'tool_calling'
  | 'completed'
  | 'stopped'
  | 'failed'

export interface RunStateInfo {
  runId: string
  state: RunState
  startedAt?: string
  finishedAt?: string
  summary?: string
}

/** 会话记录（持久化到 .novelforge/normal-chat/history.json） */
export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
  modelId?: string
}

/** 会话列表摘要（getHistory 返回，renderer 历史下拉展示） */
export interface ChatSessionSummary {
  id: string
  title: string
  messageCount: number
  updatedAt: string
  modelId?: string
}

export interface ChatRequest {
  sessionId?: string
  message: string
  /** 写入模式：main 表示用主编模型，draft 表示写作分身 */
  writingMode: 'main' | 'draft'
  /** 附带的项目文件（相对路径），注入上下文 */
  attachFiles?: string[]
  /** 附带的用户规则正文 */
  rulesText?: string
}

export interface ChatResult {
  sessionId: string
  runId: string
  reply: string
  usage: UsageInfo
}

export interface UsageInfo {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
}

/** API 风格 */
export type ApiStyle =
  | 'chat_completions'
  | 'responses'
  | 'anthropic_messages'
  | 'gemini_generate_content'

/** Provider 配置 */
export interface ProviderConfig {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  apiStyle: ApiStyle
  models: ProviderModel[]
  updatedAt: string
}

export interface ProviderModel {
  id: string
  name: string
  contextWindow: number
  /** 用途建议：主模型 / 写作分身 / 分析 */
  roles?: string[]
}
