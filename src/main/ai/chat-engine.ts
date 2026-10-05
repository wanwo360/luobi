/**
 * 统一 AI 会话引擎：多风格流式 chat + 工具调用支持 + 用量收集
 * 全部请求在主进程 fetch（无 CORS 限制）
 */
import type { ApiStyle, ChatMessage, ToolCall, UsageInfo } from '@shared/types/chat'
import { parseSseData, type StreamDelta } from './sse-parser'
import { computeCost } from '@shared/pricing'

export interface ChatEngineRequest {
  baseUrl: string
  apiKey: string
  apiStyle?: ApiStyle
  model: string
  messages: ChatMessage[]
  temperature?: number
  tools?: unknown[]
  signal?: AbortSignal
}

export interface ChatEngineResult {
  content: string
  reasoning?: string
  toolCalls?: ToolCall[]
  usage: UsageInfo
}

function buildUrl(baseUrl: string, style: ApiStyle, model: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  switch (style) {
    case 'chat_completions':
    case 'responses':
      return `${base}/chat/completions`
    case 'anthropic_messages':
      return `${base}/v1/messages`
    case 'gemini_generate_content':
      return `${base}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
  }
}

function buildHeaders(style: ApiStyle, apiKey: string): Record<string, string> {
  if (style === 'anthropic_messages') {
    return {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }
  }
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`
  }
}

function buildBody(req: ChatEngineRequest): Record<string, unknown> {
  const { apiStyle = 'chat_completions', model, messages, temperature } = req
  switch (apiStyle) {
    case 'anthropic_messages': {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
      const msgs = messages.filter((m) => m.role !== 'system')
      return {
        model,
        system: system || undefined,
        messages: msgs.map((m) => ({ role: m.role, content: m.content })),
        temperature: temperature ?? 0.8,
        stream: true
      }
    }
    case 'gemini_generate_content': {
      const contents = messages
        .filter((m) => m.role === 'system' || m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }))
      return { contents, generationConfig: { temperature: temperature ?? 0.8 } }
    }
    default: {
      // 转换为 OpenAI 标准格式：toolCalls → tool_calls（嵌套 function）、toolCallId → tool_call_id
      const normalized = messages.map((m) => {
        const out: Record<string, unknown> = { role: m.role, content: m.content }
        if (m.reasoning) out.reasoning = m.reasoning
        if (m.toolCallId) out.tool_call_id = m.toolCallId
        if (m.toolCalls?.length) {
          out.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments }
          }))
        }
        return out
      })
      const body: Record<string, unknown> = {
        model,
        messages: normalized,
        temperature: temperature ?? 0.8,
        stream: true
      }
      if (req.tools?.length) {
        body.tools = req.tools
        body.tool_choice = 'auto'
      }
      return body
    }
  }
}

/**
 * 流式 chat。返回 AsyncGenerator<StreamDelta>；
 * 若服务端吞流（非 SSE），自动降级为整包解析。
 */
export async function* streamChat(req: ChatEngineRequest): AsyncGenerator<StreamDelta> {
  const style = req.apiStyle ?? 'chat_completions'
  const url = buildUrl(req.baseUrl, style, req.model)

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(style, req.apiKey),
    body: JSON.stringify(buildBody(req)),
    signal: req.signal
  })

  if (!res.ok) {
    let detail = ''
    try {
      const j = (await res.json()) as { error?: { message?: string } }
      detail = j?.error?.message ?? JSON.stringify(j).slice(0, 300)
    } catch {
      detail = (await res.text()).slice(0, 300)
    }
    const err = new Error(`HTTP ${res.status}: ${detail}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  const contentType = res.headers.get('content-type') ?? ''
  const isStreaming = contentType.includes('text/event-stream')

  if (!isStreaming) {
    // 降级：整包 JSON
    const json = (await res.json()) as any
    const delta = parseSseData(style, JSON.stringify(json))
    delta.done = true
    yield delta
    return
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      // 按完整行切分
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue
        if (!trimmed.startsWith('data:')) {
          // anthropic 风格可能是 event: 行，跳过，等 data:
          continue
        }
        const data = trimmed.slice(5).trim()
        if (!data) continue
        if (data === '[DONE]') {
          yield { content: '', done: true }
          return
        }
        yield parseSseData(style, data)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** 完整请求（非流式，供工具循环内部使用） */
export async function chatOnce(req: ChatEngineRequest): Promise<ChatEngineResult> {
  const chunks: StreamDelta[] = []
  for await (const delta of streamChat(req)) {
    chunks.push(delta)
    if (delta.done) break
  }
  const content = chunks.map((c) => c.content).join('')
  const reasoning = chunks.map((c) => c.reasoning ?? '').join('')
  const toolCallsMap = new Map<string, ToolCall>()
  for (const c of chunks) {
    for (const tc of c.toolCalls ?? []) {
      const key = tc.index !== undefined ? String(tc.index) : (tc.id || '')
      const prev = toolCallsMap.get(key) ?? { id: tc.id ?? '', name: '', arguments: '' }
      if (tc.name) prev.name += tc.name
      prev.arguments += tc.arguments
      toolCallsMap.set(key, prev)
    }
  }
  const toolCalls = [...toolCallsMap.values()].filter((t) => t.name)
  const usage = mergeUsage(chunks)
  return { content, reasoning, toolCalls, usage }
}

function mergeUsage(chunks: StreamDelta[]): UsageInfo {
  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheWrite = 0
  for (const c of chunks) {
    if (c.usage) {
      input = Math.max(input, c.usage.inputTokens ?? 0)
      output = Math.max(output, c.usage.outputTokens ?? 0)
      cacheRead = Math.max(cacheRead, c.usage.cacheReadTokens ?? 0)
      cacheWrite = Math.max(cacheWrite, c.usage.cacheWriteTokens ?? 0)
    }
  }
  return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, costUsd: 0 }
}

/** 估算 token（模型不返回 usage 时兜底） */
export function estimateTokens(text: string): number {
  // 中文约 1 token/字符的 0.6 系数，英文 1 token/4 字符
  const cjk = (text.match(/[一-鿿㐀-䶿]/g) ?? []).length
  const other = text.length - cjk
  return Math.ceil(cjk * 0.6 + other / 4)
}

export function computeUsageCost(modelId: string, usage: UsageInfo): number {
  return computeCost(modelId, {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: usage.cacheReadTokens,
    cacheWrite: usage.cacheWriteTokens
  })
}
