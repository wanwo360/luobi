/**
 * SSE 流式解析：OpenAI / DeepSeek 风格（data: 行 + [DONE] 终止）
 * 兼容 Anthropic（event:/data: 块）与 Gemini（candidates）
 */
import type { ApiStyle } from '@shared/types/chat'

export interface StreamDelta {
  /** 正文增量 */
  content: string
  /** 推理增量（deepseek-reasoner 等） */
  reasoning?: string
  /** 工具调用增量（OpenAI 风格累积；后续帧可能只带 index 不带 id） */
  toolCalls?: { id?: string; index?: number; name: string; arguments: string }[]
  /** 本帧 usage（末帧携带） */
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    totalTokens?: number
  }
  done: boolean
}

/** 按风格解析单个 SSE data 行的 JSON */
export function parseSseData(style: ApiStyle, data: string): StreamDelta {
  let obj: any
  try {
    obj = JSON.parse(data)
  } catch {
    return { content: '', done: false }
  }

  switch (style) {
    case 'anthropic_messages': {
      if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
        return { content: obj.delta.text ?? '', done: false }
      }
      if (obj.type === 'message_start' && obj.message?.usage) {
        return { content: '', usage: usageFromAnthropic(obj.message.usage), done: false }
      }
      if (obj.type === 'message_delta' && obj.usage) {
        return { content: '', usage: usageFromAnthropic(obj.usage), done: false }
      }
      if (obj.type === 'message_stop') {
        return { content: '', done: true }
      }
      return { content: '', done: false }
    }
    case 'gemini_generate_content': {
      const parts = obj.candidates?.[0]?.content?.parts ?? []
      const text = parts.map((p: any) => p.text ?? '').join('')
      const usage = obj.usageMetadata
        ? {
            inputTokens: obj.usageMetadata.promptTokenCount,
            outputTokens: obj.usageMetadata.candidatesTokenCount,
            cacheReadTokens: obj.usageMetadata.cachedContentTokenCount ?? 0
          }
        : undefined
      return { content: text, usage, done: false }
    }
    case 'chat_completions':
    case 'responses':
    default: {
      const choice = obj.choices?.[0]
      if (obj.choices?.some((c: any) => c.finish_reason === 'stop') && !choice?.delta) {
        return { content: '', done: true }
      }
      const delta = choice?.delta ?? {}
      const toolCalls = (delta.tool_calls ?? []).map((tc: any) => ({
        id: tc.id ?? undefined,
        index: tc.index ?? undefined,
        name: tc.function?.name ?? '',
        arguments: tc.function?.arguments ?? ''
      }))
      return {
        content: delta.content ?? '',
        reasoning: delta.reasoning_content ?? undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        usage: obj.usage ? usageFromOpenAI(obj.usage) : undefined,
        done: obj.choices?.[0]?.finish_reason === 'stop' ? true : false
      }
    }
  }
}

function usageFromOpenAI(usage: any): StreamDelta['usage'] {
  return {
    inputTokens: usage.prompt_tokens ?? usage.input_tokens,
    outputTokens: usage.completion_tokens ?? usage.output_tokens,
    cacheReadTokens: usage.prompt_cache_hit_tokens ?? usage.cached_tokens ?? 0,
    cacheWriteTokens: usage.prompt_cache_miss_tokens ?? 0,
    totalTokens: usage.total_tokens
  }
}

function usageFromAnthropic(usage: any): StreamDelta['usage'] {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0
  }
}

/** 逐行分帧解析 SSE 文本流，过滤注释行 */
export function* iterateSseLines(text: string): Generator<string> {
  const lines = text.split('\n')
  let buffer = ''
  for (const line of lines) {
    buffer += line + '\n'
    // data: 行累积；空行触发事件
    if (line.trim() === '') {
      const dataLine = buffer
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('')
      buffer = ''
      if (dataLine && dataLine !== '[DONE]') yield dataLine
      else if (dataLine === '[DONE]') yield '[DONE]'
    }
  }
}
