/**
 * chat IPC 域：会话管理 + 流式 AI 对话 + 运行状态机 + 声明式上下文注入
 * 持久化：.novelforge/normal-chat/{history.json, runs/}
 */
import { ipcMain, BrowserWindow } from 'electron'
import path from 'path'
import { randomUUID } from 'crypto'
import { IPC } from '@shared/ipc'
import type { ApiStyle, ChatEvent, ChatMessage, ChatRequest, ChatSession, ProviderConfig, RunState, RunStateInfo, UsageInfo } from '@shared/types/chat'
import { providerStore } from '../provider'
import { streamChat, chatOnce, computeUsageCost, estimateTokens } from '../../ai/chat-engine'
import { TOOL_DEFINITIONS, executeTool, confirmWrite, type PendingWrite } from '../../ai/tools'
import { readJson, writeJson, getProjectRoot, AppError, toAppError } from '../shared/fs-utils'
import { META, META_DIR } from '@shared/data-layout'
import { buildChiefContext, type BuiltContext } from './context'
import { usageStore } from '../usage'
import { settingsStore } from '../settings'
import type { Agent } from '@shared/types/agents'

export interface RunRecord {
  runId: string
  sessionId: string
  state: RunState
  startedAt: string
  finishedAt?: string
  messages: ChatMessage[]
  modelId: string
}

const runs = new Map<string, { controller: AbortController; record: RunRecord }>()

/** 待确认写入（用户确认后落盘）：key = `${sessionId}:${toolCallId}` */
const pendingWrites = new Map<string, PendingWrite>()

/** 存入待确认写入，超限时清理最早插入的（防"重写后不保存"的残留累积） */
function putPendingWrite(key: string, pw: PendingWrite): void {
  pendingWrites.set(key, pw)
  while (pendingWrites.size > 50) {
    const oldest = pendingWrites.keys().next().value
    if (oldest === undefined) break
    pendingWrites.delete(oldest)
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

function emitChatEvent(win: BrowserWindow | null, event: ChatEvent): void {
  const targets = win ? [win] : BrowserWindow.getAllWindows()
  for (const w of targets) w.webContents.send(IPC.chat.event, event)
}

// ============ 会话持久化 ============

function chatDir(): string {
  return path.join(getProjectRoot(), META_DIR, META.normalChat)
}
export function getChatDir(): string {
  return chatDir()
}

async function loadSessions(): Promise<ChatSession[]> {
  try {
    return await readJson<ChatSession[]>(path.join(chatDir(), 'history.json'), [])
  } catch {
    // 无当前项目（如当前项目被删除）→ 返回空历史，不报错
    return []
  }
}

/** 单会话持久化的消息上限（约 150 轮对话足够；防 history.json 无限增长、启动/切换变慢） */
const MAX_PERSISTED_MESSAGES = 300

async function saveSessions(sessions: ChatSession[]): Promise<void> {
  const capped = sessions.map((s) =>
    s.messages.length > MAX_PERSISTED_MESSAGES ? { ...s, messages: s.messages.slice(-MAX_PERSISTED_MESSAGES) } : s
  )
  await writeJson(path.join(chatDir(), 'history.json'), capped)
}

/** 解析 主编/写作分身 的 provider + model */
async function resolveModel(writingMode: 'main' | 'draft') {
  const state = await providerStore.load()
  const provider = state.providers.find((p) => p.id === state.activeProviderId)
  if (!provider) {
    throw new AppError('no_provider', '尚未配置模型供应商，请在设置中添加 API 供应商', true)
  }
  let modelId = state.activeModelId
  // 混合模式：写作分身使用独立写作模型（默认开）；关闭则写作分身跟随主编模型
  let hybridMode = true
  try {
    hybridMode = (await settingsStore.load()).hybridMode !== false
  } catch {
    /* 默认开启 */
  }
  if (writingMode === 'draft' && hybridMode && state.writingModelId !== 'inherit') {
    modelId = state.writingModelId
  }
  const model = provider.models.find((m) => m.id === modelId) ?? provider.models[0]
  return { provider, modelId: model?.id ?? modelId, modelName: model?.name ?? modelId }
}

// ============ 主对话流程 ============

/**
 * 启动聊天：立即返回 runId（流式在后台执行，事件经 IPC 推送）
 * 这样前端能立刻拿到 runId 用于停止操作
 */
async function startChat(win: BrowserWindow, req: ChatRequest): Promise<{ sessionId: string; runId: string }> {
  const runId = randomUUID()
  const sessionId = req.sessionId ?? randomUUID()
  // 提前解析模型供应商：未配置时立即拒绝返回给前端（否则后台 reject 导致前端永远"正在思考"且无法停止）
  const { provider, modelId } = await resolveModel(req.writingMode)
  void executeRun(win, req, runId, sessionId, provider, modelId)
  return { sessionId, runId }
}

async function executeRun(
  win: BrowserWindow,
  req: ChatRequest,
  runId: string,
  sessionId: string,
  provider: Pick<ProviderConfig, 'baseUrl' | 'apiKey' | 'apiStyle'>,
  modelId: string
): Promise<void> {
  const sessions = await loadSessions()
  let session = sessions.find((s) => s.id === sessionId)
  if (!session) {
    session = {
      id: sessionId,
      title: req.message.slice(0, 30),
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      modelId
    }
    sessions.unshift(session)
  }

  const controller = new AbortController()
  const record: RunRecord = {
    runId,
    sessionId,
    state: 'queued',
    startedAt: new Date().toISOString(),
    messages: [...session.messages],
    modelId
  }
  runs.set(runId, { controller, record })

  const setState = (state: RunState): void => {
    record.state = state
    emitChatEvent(win, { type: 'run_state', runId, state })
  }

  // 组装上下文（失败：如当前项目刚被删除，转 error 事件而非后台静默 reject）
  let context: BuiltContext
  try {
    context = await buildChiefContext({
      message: req.message,
      writingMode: req.writingMode,
      attachFiles: req.attachFiles ?? [],
      rulesText: req.rulesText
    })
  } catch (err) {
    setState('failed')
    emitChatEvent(win, {
      type: 'error',
      runId,
      error: {
        code: (err as Error & { status?: number }).status ? 'api_error' : 'network',
        message: err instanceof Error ? err.message : String(err),
        recoverable: true
      }
    })
    runs.delete(runId)
    return
  }
  let messages: ChatMessage[] = [...context.messages]
  // 多轮对话记忆：注入最近对话历史（每条截断控制 token），让 AI 记得之前聊过什么
  const historyMessages: ChatMessage[] = session.messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && (m.content ?? '').trim().length > 0)
    .slice(-6)
    .map((m) => ({ role: m.role, content: (m.content ?? '').slice(0, 500) }))
  if (historyMessages.length > 0) {
    // 当前消息是 context 最后一条 user 消息，历史插入它之前
    const current = messages.pop()!
    messages = [...messages, ...historyMessages, current]
  }

  setState('streaming')
  emitChatEvent(win, { type: 'message_start', runId, messageId: `m-${runId}` })

  let fullReply = ''
  let fullReasoning = ''
  let accumulatedUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 }
  let lastEmit = 0
  let buffer = ''

  // 本轮 run 中已执行过的工具（跨轮累积），用于判断生成任务是否真正完成
  const executedTools = new Set<string>()
  // 无工具口胡的强制纠正次数（最多 3 次，防死循环烧 token）
  let forceCount = 0

  try {
    // 工具调用循环（最多 8 轮）
    for (let round = 0; round < 8; round++) {
      const collectedToolCalls = new Map<string, { id: string; index?: number; name: string; arguments: string }>()
      let roundDone = false

      for await (const delta of streamChat({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        apiStyle: provider.apiStyle,
        model: modelId,
        messages,
        temperature: 0.8,
        tools: TOOL_DEFINITIONS,
        signal: controller.signal
      })) {
        if (delta.content) {
          fullReply += delta.content
          buffer += delta.content
          const now = Date.now()
          if (now - lastEmit > 50) {
            emitChatEvent(win, { type: 'delta', runId, messageId: `m-${runId}`, text: buffer })
            buffer = ''
            lastEmit = now
          }
        }
        if (delta.reasoning) {
          fullReasoning += delta.reasoning
        }
        if (delta.usage) {
          accumulatedUsage = {
            inputTokens: Math.max(accumulatedUsage.inputTokens, delta.usage.inputTokens ?? 0),
            outputTokens: Math.max(accumulatedUsage.outputTokens, delta.usage.outputTokens ?? 0),
            cacheReadTokens: Math.max(accumulatedUsage.cacheReadTokens, delta.usage.cacheReadTokens ?? 0),
            cacheWriteTokens: Math.max(accumulatedUsage.cacheWriteTokens, delta.usage.cacheWriteTokens ?? 0),
            costUsd: 0
          }
        }
        // 累积工具调用增量（DeepSeek 等后续帧可能只带 index 不带 id，用 index ?? id 作 key）
        for (const tc of delta.toolCalls ?? []) {
          const key = tc.index !== undefined ? String(tc.index) : (tc.id || '')
          const prev = collectedToolCalls.get(key) ?? { id: tc.id ?? '', index: tc.index, name: '', arguments: '' }
          if (tc.name) prev.name += tc.name
          prev.arguments += tc.arguments
          collectedToolCalls.set(key, prev)
        }
        if (delta.done) roundDone = true
      }

      const toolCalls = [...collectedToolCalls.values()].filter((t) => t.name)
      if (!toolCalls.length || controller.signal.aborted) {
        if (!roundDone && controller.signal.aborted) break
        // 生成类请求：本轮无工具调用且用户要求的工具从未执行过 → 强制纠正（每轮都查，最多 3 次）
        // 修复：此前只在首轮纠正一次，AI 第二轮继续口胡就放弃 → 正文永远写不出来
        const neededTools: string[] = []
        if (/(章|正文)/.test(req.message)) neededTools.push('write_chapter')
        if (/(大纲|总纲|章纲|细纲|分卷)/.test(req.message)) neededTools.push('write_outline')
        if (/(设定|人物|世界观|时间线|伏笔|关系)/.test(req.message)) neededTools.push('write_deposition')
        if (/(记住|记忆|规则)/.test(req.message)) neededTools.push('write_memory')
        const missingTools = neededTools.filter((t) => !executedTools.has(t))
        if (
          missingTools.length > 0 &&
          forceCount < 3 &&
          !/^(随便|聊聊|分析|评价|总结|介绍|看|读)/.test(req.message)
        ) {
          forceCount++
          messages.push({
            role: 'system',
            content:
              `注意：用户要求生成内容，但你${forceCount > 1 ? `已连续 ${forceCount} 次` : ''}回复都没有调用${missingTools.join('、')}工具，仅靠文字描述不会产生任何文件。` +
              `请立即调用工具：${missingTools
                .map((t) => (t === 'write_chapter' ? 'write_chapter（参数 chapter_number 章节号 + content 完整正文）' : `${t}（参数 path + content）`))
                .join('；')}。` +
              '工具成功执行后你才会收到"内容已暂存"的回执；收到回执之前绝不能说"已生成/已写入/已暂存/点击保存"。不要输出计划性文字，直接调用工具。'
          })
          continue
        }
        if (!toolCalls.length) break
      }

      // 执行工具调用
      for (const tc of toolCalls) {
        executedTools.add(tc.name)
        emitChatEvent(win, { type: 'tool_start', runId, messageId: `m-${runId}`, tool: tc })
        const result = await executeTool(tc)
        // 待确认写入：暂存 + 推送卡片数据给前端
        if (result.pending) {
          const key = `${sessionId}:${tc.id}`
          putPendingWrite(key, result.pending)
          // 写后一致性校验：正文生成后自动核对前文（台账/摘要/概要），发现冲突提示在卡片上
          let verifyNote = ''
          if (result.pending.kind === 'chapter') {
            try {
              const { verifyChapterConsistency } = await import('../../ai/maintenance')
              const conflicts = await verifyChapterConsistency(result.pending.content)
              if (conflicts.length) {
                verifyNote = `\n\n⚠️ 与前文核对发现 ${conflicts.length} 处问题：\n${conflicts
                  .slice(0, 3)
                  .map((c) => `【${c.item}】${c.detail}（建议：${c.suggestion}）`)
                  .join('\n')}`
              }
            } catch {
              /* 校验失败不阻塞（免费模型偶发） */
            }
          }
          emitChatEvent(win, {
            type: 'tool_end',
            runId,
            messageId: `m-${runId}`,
            tool: tc,
            toolResult: {
              ok: result.ok,
              summary: (result.summary + verifyNote).slice(0, 600)
            },
            pendingWrite: {
              key,
              kind: result.pending.kind,
              path: result.pending.path,
              content: result.pending.content
            }
          })
          // 回填 AI：告知已暂存待确认（任务实质已完成，只差用户点保存）
          messages.push({ role: 'assistant', content: '', toolCalls: [tc] })
          messages.push({
            role: 'tool',
            toolCallId: tc.id,
            content: `任务已完成：内容已生成并暂存（${result.pending.path}，${result.pending.content.length} 字）。文件尚未写入，等待用户在界面的确认卡片上点击「保存」按钮即完成落盘。请告知用户：内容已就绪，点击「保存」即可，不要说"任务未完成"。`
          })
        } else {
          emitChatEvent(win, {
            type: 'tool_end',
            runId,
            messageId: `m-${runId}`,
            tool: tc,
            // 用户看到的卡片文本：优先 cardText（简短），否则截断的 summary
            toolResult: {
              ok: result.ok,
              summary: (result.cardText ?? result.summary).slice(0, 200)
            },
            images: result.images
          })
          messages.push({ role: 'assistant', content: '', toolCalls: [tc] })
          // 回填 AI 的完整内容（含文件全文）+ 引导 AI 回答用户
          messages.push({
            role: 'tool',
            toolCallId: tc.id,
            content: `${result.summary}\n\n（工具执行完毕。请基于以上信息直接回答用户的问题，不要复述文件原文。）`
          })
        }
      }
    }
  } catch (err) {
    if (controller.signal.aborted) {
      setState('stopped')
    } else {
      setState('failed')
      emitChatEvent(win, {
        type: 'error',
        runId,
        error: {
          code: (err as Error & { status?: number }).status ? 'api_error' : 'network',
          message: err instanceof Error ? err.message : String(err),
          recoverable: true
        }
      })
    }
    runs.delete(runId)
    return
  }

  if (buffer) emitChatEvent(win, { type: 'delta', runId, messageId: `m-${runId}`, text: buffer })

  // 用量统计
  if (!accumulatedUsage.outputTokens) {
    accumulatedUsage.outputTokens = estimateTokens(fullReply)
  }
  if (!accumulatedUsage.inputTokens) {
    accumulatedUsage.inputTokens = estimateTokens(context.messages.map((m) => m.content).join(''))
  }
  accumulatedUsage.costUsd = computeUsageCost(modelId, accumulatedUsage)
  await usageStore.record(modelId, 'main', accumulatedUsage)

  // 保存会话
  session.messages.push({ role: 'user', content: req.message })
  session.messages.push({
    role: 'assistant',
    content: fullReply,
    reasoning: fullReasoning || undefined
  })
  session.updatedAt = new Date().toISOString()
  const idx = sessions.findIndex((s) => s.id === sessionId)
  if (idx >= 0) sessions[idx] = session
  await saveSessions(sessions)
  broadcast(IPC.chat.historyChanged, { sessionId })

  setState('completed')
  emitChatEvent(win, { type: 'message_end', runId, messageId: `m-${runId}` })
  record.finishedAt = new Date().toISOString()
  runs.delete(runId)
}

// ============ 代理运行（供 agents 域调用） ============

export interface AgentRunOptions {
  agent: Agent
  messages: ChatMessage[]
  onEvent?: (event: ChatEvent) => void
  chapterNumber?: number
  instruction?: string
  outputFile?: string
}

/** 运行单个 agent（完整请求 + 输出文件写入），返回内容与用量 */
export async function runAgentOnce(opts: AgentRunOptions): Promise<{ content: string; usage: UsageInfo }> {
  let provider = opts.agent.chatProvider
    ? {
        baseUrl: opts.agent.chatProvider.baseUrl!,
        apiKey: opts.agent.chatProvider.apiKey!,
        apiStyle: opts.agent.chatProvider.apiStyle ?? ('chat_completions' as ApiStyle)
      }
    : null
  let modelId = opts.agent.chatProvider?.model ?? ''
  if (!provider) {
    const resolved = await resolveModel('main')
    provider = { baseUrl: resolved.provider.baseUrl, apiKey: resolved.provider.apiKey, apiStyle: resolved.provider.apiStyle }
    modelId = resolved.modelId
  }
  const result = await chatOnce({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    apiStyle: provider.apiStyle,
    model: modelId,
    messages: opts.messages,
    temperature: 0.8
  })
  const usage = {
    inputTokens: result.usage.inputTokens || estimateTokens(opts.messages.map((m) => m.content).join('')),
    outputTokens: result.usage.outputTokens || estimateTokens(result.content),
    cacheReadTokens: result.usage.cacheReadTokens,
    cacheWriteTokens: result.usage.cacheWriteTokens,
    costUsd: computeUsageCost(modelId, result.usage)
  }
  await usageStore.record(modelId, `agent:${opts.agent.name}`, usage)
  opts.onEvent?.({
    type: 'message_end',
    runId: 'agent',
    messageId: 'agent-done',
    text: result.content
  })
  return { content: result.content, usage }
}

export function stopRun(runId: string): void {
  const entry = runs.get(runId)
  if (entry) {
    entry.controller.abort()
  }
}

export function listRunStates(): RunStateInfo[] {
  return [...runs.values()].map(({ record }) => ({
    runId: record.runId,
    state: record.state,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt
  }))
}

// ============ IPC 注册 ============

export function registerChatIpc(): void {
  ipcMain.handle(IPC.chat.chat, async (e, req: ChatRequest) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) throw new AppError('no_window', '窗口不存在', false)
      return await startChat(win, req)
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.chat.stop, (_e, runId: string) => {
    stopRun(runId)
    return true
  })

  ipcMain.handle(IPC.chat.getHistory, async () => {
    try {
      const sessions = await loadSessions()
      return sessions.map((s) => ({
        id: s.id,
        title: s.title,
        messageCount: s.messages.length,
        updatedAt: s.updatedAt,
        modelId: s.modelId
      }))
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.chat.getSession, async (_e, sessionId: string) => {
    try {
      const sessions = await loadSessions()
      return sessions.find((s) => s.id === sessionId) ?? null
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.chat.clearHistory, async () => {
    try {
      // 无当前项目（已删除）时静默成功，不抛错
      const dir = chatDir()
      await writeJson(path.join(dir, 'history.json'), [])
      broadcast(IPC.chat.historyChanged, {})
      return true
    } catch (err) {
      if (err instanceof AppError && err.code === 'no_project') return true
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.chat.listRunStates, () => listRunStates())

  // 确认写入（用户检视后点击保存）
  ipcMain.handle(IPC.chat.confirmWrite, async (_e, key: string) => {
    try {
      const pending = pendingWrites.get(key)
      if (!pending) throw new AppError('not_found', '待确认内容不存在或已过期', true)
      const result = await confirmWrite(pending)
      pendingWrites.delete(key)
      // 回填 AI 状态：确认已写入 → 后续对话 AI 知道任务已完成（不再认为"未完成"）
      try {
        const sessionId = key.split(':')[0]
        const sessions = await loadSessions()
        const session = sessions.find((s) => s.id === sessionId)
        if (session) {
          session.messages.push({
            role: 'user',
            content: `【系统】用户已确认保存：${pending.path}（${pending.content.length} 字），文件已写入磁盘，此前的待确认任务已完成。`
          })
          await saveSessions(sessions)
        }
      } catch {
        /* 会话回填失败不影响主流程 */
      }
      // 落盘后广播刷新
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send(IPC.chapters.eventChanged, {})
        w.webContents.send(IPC.projects.eventChanged, {})
      }
      return { ok: result.ok, summary: result.summary }
    } catch (err) {
      throw toAppError(err)
    }
  })
}

export const chatInternals = { chatDir, loadSessions }
