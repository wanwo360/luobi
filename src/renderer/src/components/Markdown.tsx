import React, { useDeferredValue, useMemo } from 'react'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
})

export function Markdown({ text }: { text: string }): React.JSX.Element {
  // useDeferredValue：流式输入时 markdown 解析（千字级文本、毫秒级）走可中断的低优先级渲染，
  // 不阻塞输入/滚动等高优先级交互；文本稳定后自动收敛到最新结果
  const deferred = useDeferredValue(text)
  const html = useMemo(() => md.render(deferred ?? ''), [deferred])
  return (
    <div
      className="chat-message-markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
