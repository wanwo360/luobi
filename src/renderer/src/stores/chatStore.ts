import { create } from 'zustand'
import type { ChatSession, ChatSessionSummary } from '@shared/types/chat'

export interface PendingWriteInfo {
  key: string
  kind: 'outline' | 'deposition' | 'chapter' | 'global_rule'
  path: string
  content: string
}

export interface ChatMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  streaming?: boolean
  tool?: { name: string; summary?: string }
  /** 待确认写入卡片 */
  pending?: PendingWriteInfo
  /** 卡片状态：pending | saved | replaced */
  pendingState?: 'pending' | 'saved' | 'replaced'
  /** 生成的图片路径 */
  images?: string[]
}

interface ChatState {
  messages: ChatMsg[]
  input: string
  streaming: boolean
  runId: string | null
  sessionId: string | null
  writingMode: 'main' | 'draft'
  history: ChatSessionSummary[]
  error: string | null

  setInput: (v: string) => void
  setWritingMode: (m: 'main' | 'draft') => void
  send: () => Promise<void>
  stop: () => void
  confirmPending: (key: string) => Promise<boolean>
  rewritePending: (pending: PendingWriteInfo) => Promise<void>
  loadHistory: () => Promise<void>
  loadSession: (sessionId: string) => Promise<void>
  clearHistory: () => Promise<void>
  /** 当前项目被删除时重置聊天状态（仅本地，不触主进程） */
  resetProject: () => void
}

export const useChatStore = create<ChatState>((set, get) => {
  let msgCounter = 0
  const nextId = (): string => `m${++msgCounter}-${Date.now().toString(36)}`

  return {
    messages: [],
    input: '',
    streaming: false,
    runId: null,
    sessionId: null,
    writingMode: 'main',
    history: [],
    error: null,

    setInput: (v) => set({ input: v }),
    setWritingMode: (m) => set({ writingMode: m }),

    send: async () => {
      const { input, writingMode, sessionId, messages, streaming } = get()
      if (!input.trim() || streaming) return
      const userMsg: ChatMsg = { id: nextId(), role: 'user', content: input.trim() }
      set({
        messages: [...messages, userMsg],
        input: '',
        streaming: true,
        error: null
      })
      const assistantMsg: ChatMsg = { id: nextId(), role: 'assistant', content: '', streaming: true }
      set({ messages: [...get().messages, assistantMsg] })

      try {
        const result: { runId: string; sessionId: string } = await window.luobi.chat.chat({
          sessionId,
          message: userMsg.content,
          writingMode
        })
        set({ runId: result.runId, sessionId: result.sessionId })
      } catch (err: any) {
        set({
          streaming: false,
          error: err?.message ?? String(err),
          messages: get().messages.map((m) =>
            m.id === assistantMsg.id ? { ...m, streaming: false } : m
          )
        })
      }
    },

    stop: () => {
      const { runId } = get()
      if (runId) window.luobi.chat.stop(runId)
    },

    confirmPending: async (key) => {
      try {
        const result = await window.luobi.chat.confirmWrite(key)
        const ok = result?.ok
        useChatStore.setState({
          messages: useChatStore.getState().messages.map((m) =>
            m.pending?.key === key ? { ...m, pendingState: ok ? 'saved' : 'pending' } : m
          )
        })
        return ok
      } catch {
        return false
      }
    },

    rewritePending: async (pending) => {
      const { sessionId, send: _s } = get()
      const kindLabel = pending.kind === 'outline' ? '大纲' : pending.kind === 'deposition' ? '设定' : pending.kind === 'global_rule' ? '全局规则' : '正文'
      // 标记旧卡片为已重写
      useChatStore.setState({
        messages: useChatStore.getState().messages.map((m) =>
          m.pending?.path === pending.path && m.pendingState === 'pending' ? { ...m, pendingState: 'replaced' } : m
        )
      })
      // 发送重写指令（AI 重新生成并再次调用工具）
      await window.luobi.chat.chat({
        sessionId,
        message: `用户对生成的${kindLabel}内容不满意，请重新生成${kindLabel}内容（目标文件：${pending.path}），生成后调用对应工具写入，等待用户确认。`,
        writingMode: 'main'
      })
    },

    loadHistory: async () => {
      const history = await window.luobi.chat.getHistory()
      set({ history })
    },

    loadSession: async (sid) => {
      const session = (await window.luobi.chat.getSession(sid)) as ChatSession | null
      if (session) {
        const messages: ChatMsg[] = session.messages.map((m: any, i: number) => ({
          id: `h${i}-${sid.slice(0, 6)}`,
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content ?? '',
          reasoning: m.reasoning
        }))
        set({ messages, sessionId: sid })
      }
    },

    clearHistory: async () => {
      await window.luobi.chat.clearHistory()
      set({ messages: [], sessionId: null, history: [] })
    },

    resetProject: () => {
      // 当前项目被删除：旧对话/运行/错误全部清空，回到未选作品状态
      set({ messages: [], input: '', streaming: false, runId: null, sessionId: null, history: [], error: null })
    }
  }
})

/** 聊天事件订阅（在 App 挂载时调用） */
export function subscribeChatEvents(): () => void {
  const offEvent = window.luobi.chat.onEvent((payload: any) => {
    if (!payload || typeof payload !== 'object') return
    const { type, text, state, error } = payload
    const s = useChatStore.getState()
    switch (type) {
      case 'delta':
        if (text) {
          // 只重建流式中的那条消息，其余消息引用不变 → 配合 React.memo 其余消息行跳过渲染
          const idx = s.messages.findIndex((m) => m.streaming)
          if (idx >= 0) {
            useChatStore.setState({
              messages: s.messages.map((m, i) => (i === idx ? { ...m, content: m.content + text } : m))
            })
          }
        }
        break
      case 'message_end':
        useChatStore.setState({
          messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
          streaming: false,
          runId: null
        })
        break
      case 'tool_start': {
        const tool = payload.tool
        if (tool) {
          useChatStore.setState({
            messages: [
              ...s.messages,
              {
                id: `tool-${tool.id}`,
                role: 'assistant',
                content: '',
                tool: { name: tool.name, summary: '执行中…' }
              }
            ]
          })
        }
        break
      }
      case 'tool_end': {
        const tool = payload.tool
        const result = payload.toolResult
        const pw = payload.pendingWrite
        const imgs = payload.images
        if (tool) {
          const existing = s.messages.find((m) => m.id === `tool-${tool.id}`)
          const base = {
            tool: { name: tool.name, summary: result?.summary ?? (result?.ok ? '完成' : '失败') },
            images: imgs
          }
          if (existing) {
            useChatStore.setState({
              messages: s.messages.map((m) =>
                m.id === `tool-${tool.id}`
                  ? {
                      ...m,
                      ...base,
                      pending: pw
                        ? { key: pw.key, kind: pw.kind, path: pw.path, content: pw.content }
                        : m.pending,
                      pendingState: pw ? 'pending' : m.pendingState
                    }
                  : m
              )
            })
          } else {
            // 独立通知（如章节自动整理工作流）
            useChatStore.setState({
              messages: [
                ...s.messages,
                {
                  id: `tool-${tool.id}`,
                  role: 'assistant',
                  content: '',
                  ...base
                }
              ]
            })
          }
        }
        break
      }
      case 'run_state':
        if (state === 'stopped' || state === 'failed' || state === 'completed') {
          useChatStore.setState({
            streaming: false,
            runId: null,
            messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m))
          })
        }
        break
      case 'error':
        useChatStore.setState({
          streaming: false,
          runId: null,
          error: error?.message ?? '发生错误',
          messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m))
        })
        break
    }
  })
  const offHistory = window.luobi.chat.onHistoryChanged(() => {
    useChatStore.getState().loadHistory()
  })
  return () => {
    offEvent()
    offHistory()
  }
}
