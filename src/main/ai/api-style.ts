/**
 * API 风格探测：chat_completions | responses | anthropic_messages | gemini_generate_content
 * 优先配置显式指定，否则按 baseUrl + model 规则匹配
 */
import type { ApiStyle } from '@shared/types/chat'

export function detectApiStyle(baseUrl: string, model: string): ApiStyle {
  const url = baseUrl.toLowerCase()
  const m = model.toLowerCase()

  if (url.includes('anthropic') || url.includes('claude')) return 'anthropic_messages'
  if (url.includes('generativelanguage') || url.includes('gemini')) return 'gemini_generate_content'
  if (m.startsWith('claude')) return 'anthropic_messages'
  if (m.startsWith('gemini')) return 'gemini_generate_content'

  // OpenAI 兼容默认
  return 'chat_completions'
}
