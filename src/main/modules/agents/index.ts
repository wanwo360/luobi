/**
 * agents IPC 域：智能体 CRUD + 运行（write/condition）
 * 存储：<project>/.novelforge/agents.json（旧版同语义）
 */
import { ipcMain, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { IPC } from '@shared/ipc'
import type { Agent, AgentsFile, AgentRunRequest, AgentRunEvent } from '@shared/types/agents'
import type { ChatMessage } from '@shared/types/chat'
import { META, META_DIR, WORKFLOW, MATERIALS_ROOT, MATERIALS_DIRS, OUTLINE, STORY_SUMMARY_FILE } from '@shared/data-layout'
import { readJson, writeJson, readText, resolveProjectPath, getProjectRoot, atomicWrite, AppError, toAppError } from '../shared/fs-utils'
import { runAgentOnce } from '../chat'
import { buildRulesText } from '../rules'

function agentsFile(): string {
  return path.join(getProjectRoot(), META_DIR, META.agentsFile)
}

async function loadAgents(): Promise<AgentsFile> {
  const data = await readJson<Partial<AgentsFile>>(agentsFile(), {})
  return { version: 1, agents: data.agents ?? [] }
}

async function saveAgents(file: AgentsFile): Promise<void> {
  await writeJson(agentsFile(), file)
}

function emit(agentId: string, event: Omit<AgentRunEvent, 'agentId'>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.agents.runEvent, { agentId, ...event })
  }
}

/** 读取 agent 的提示词（systemPromptPath / userPromptPath，项目相对路径） */
async function loadAgentPrompts(agent: Agent): Promise<{ system: string; user: string }> {
  let system = agent.description ? `你是 AI 智能体「${agent.name}」：${agent.description}` : `你是 AI 智能体「${agent.name}」`
  let user = ''
  if (agent.systemPromptPath) {
    try {
      system = await readText(resolveProjectPath(agent.systemPromptPath))
    } catch {
      /* 提示词文件缺失则用默认 */
    }
  }
  if (agent.userPromptPath) {
    try {
      user = await readText(resolveProjectPath(agent.userPromptPath))
    } catch {
      /* 忽略 */
    }
  }
  return { system, user }
}

/** 组装 agent 上下文：提示词 + readFiles + readSources + 规则 */
async function buildAgentMessages(agent: Agent, instruction: string): Promise<ChatMessage[]> {
  const { system, user } = await loadAgentPrompts(agent)
  const sections: string[] = [system]

  // 规则注入
  const rulesText = await buildRulesText()
  if (rulesText) sections.push(`【写作规则】\n${rulesText.slice(0, 8000)}`)

  // readFiles 声明式注入
  for (const rel of agent.readFiles) {
    try {
      const abs = resolveProjectPath(rel)
      const text = await readText(abs)
      sections.push(`【文件：${rel}】\n${text.slice(0, 6000)}`)
    } catch {
      /* 文件缺失跳过 */
    }
  }

  // readSources 固定来源注入
  for (const source of agent.readSources) {
    const rel = sourceToRelPath(source)
    if (!rel) continue
    try {
      const text = await readText(resolveProjectPath(rel))
      sections.push(`【来源：${source}】\n${text.slice(0, 6000)}`)
    } catch {
      /* 跳过 */
    }
  }

  const messages: ChatMessage[] = [{ role: 'system', content: sections.join('\n\n---\n\n') }]
  if (user) messages.push({ role: 'user', content: user })
  messages.push({ role: 'user', content: instruction })
  return messages
}

/** readSources 白名单 id → 项目相对路径（与 data-layout 真实布局一致，勿硬编码） */
function sourceToRelPath(source: string): string | null {
  switch (source) {
    case 'master_outline':
      return `${MATERIALS_ROOT}/${OUTLINE.master}`
    case 'chapter_outline':
      return `${MATERIALS_ROOT}/${OUTLINE.chapterDir}`
    case 'volume_outline':
      return `${MATERIALS_ROOT}/${OUTLINE.volumeDir}`
    case 'canon':
      return `${MATERIALS_ROOT}/${MATERIALS_DIRS.canon}`
    case 'key_memory':
      return `${MATERIALS_ROOT}/${MATERIALS_DIRS.keyMemory}`
    case 'story_summary':
      return `${MATERIALS_ROOT}/${STORY_SUMMARY_FILE}`
    case 'text_material':
      return `${MATERIALS_ROOT}/${MATERIALS_DIRS.imported}`
    default:
      return null
  }
}

/** 运行 agent（write 或 condition），事件推送 */
async function runAgent(agentId: string, req: AgentRunRequest): Promise<string> {
  const file = await loadAgents()
  const agent = file.agents.find((a) => a.id === agentId)
  if (!agent) throw new AppError('not_found', '智能体不存在', true)
  const runId = randomUUID()

  const instruction = req.instruction ?? (req.chapterNumber ? `请创作第 ${req.chapterNumber} 章的正文。` : '请执行你的任务。')
  const messages = await buildAgentMessages(agent, instruction)

  emit(agentId, { type: 'run_state', runId, state: 'running' })

  const outputFile = req.chapterNumber
    ? `${WORKFLOW.runs}/ch${String(req.chapterNumber).padStart(3, '0')}/${safeFileName(agent.name)}.md`
    : agent.outputFiles[0] ?? `${WORKFLOW.outputs}/${safeFileName(agent.name)}.md`

  try {
    const { content, usage } = await runAgentOnce({
      agent,
      messages,
      chapterNumber: req.chapterNumber,
      instruction
    })
    // 写入输出文件（原子写）
    const absOut = resolveProjectPath(outputFile)
    await writeJson(path.join(getProjectRoot(), META_DIR, 'debug', `${runId}.json`), { usage })
      .then(() => trimDebugFiles())
      .catch(() => {})
    await atomicWrite(absOut, content)
    emit(agentId, { type: 'done', runId, text: content.slice(0, 200) })
    return outputFile
  } catch (err) {
    emit(agentId, {
      type: 'error',
      runId,
      error: err instanceof Error ? err.message : String(err)
    })
    throw err
  }
}

/** 清洗 agent 名作为输出文件名的合法化（防非法字符/路径分隔符被当作子目录写入） */
function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60) || 'agent'
}

/** 清理 .novelforge/debug/ 下的运行记录（保留最近 20 个，防长期堆积） */
async function trimDebugFiles(): Promise<void> {
  try {
    const dir = path.join(getProjectRoot(), META_DIR, 'debug')
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort()
    for (const f of files.slice(0, Math.max(0, files.length - 20))) {
      await fs.rm(path.join(dir, f), { force: true }).catch(() => {})
    }
  } catch {
    /* 忽略 */
  }
}

export function registerAgentsIpc(): void {
  ipcMain.handle(IPC.agents.list, async () => {
    try {
      return await loadAgents()
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.agents.create, async (_e, input: { name: string; kind?: Agent['kind'] }) => {
    try {
      const file = await loadAgents()
      const now = new Date().toISOString()
      const agent: Agent = {
        id: `agent-${randomUUID().slice(0, 8)}`,
        name: input.name || '新智能体',
        kind: input.kind ?? 'write',
        description: '',
        readFiles: [],
        readSources: [],
        outputFiles: [],
        systemPromptPath: '',
        userPromptPath: '',
        publishesFinalText: false,
        enabled: true,
        source: 'custom',
        providerMode: 'inherit',
        createdAt: now,
        updatedAt: now
      }
      file.agents.push(agent)
      await saveAgents(file)
      return agent
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.agents.duplicate, async (_e, id: string) => {
    try {
      const file = await loadAgents()
      const src = file.agents.find((a) => a.id === id)
      if (!src) throw new AppError('not_found', '智能体不存在', true)
      const now = new Date().toISOString()
      const copy: Agent = {
        ...src,
        id: `agent-${randomUUID().slice(0, 8)}`,
        name: `${src.name} 副本`,
        createdAt: now,
        updatedAt: now
      }
      file.agents.push(copy)
      await saveAgents(file)
      return copy
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.agents.update, async (_e, id: string, patch: Partial<Agent>) => {
    try {
      const file = await loadAgents()
      const idx = file.agents.findIndex((a) => a.id === id)
      if (idx < 0) throw new AppError('not_found', '智能体不存在', true)
      file.agents[idx] = {
        ...file.agents[idx],
        ...patch,
        id,
        updatedAt: new Date().toISOString()
      }
      await saveAgents(file)
      return file.agents[idx]
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.agents.delete, async (_e, id: string) => {
    try {
      const file = await loadAgents()
      file.agents = file.agents.filter((a) => a.id !== id)
      await saveAgents(file)
      return true
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.agents.reorder, async (_e, ids: string[]) => {
    try {
      const file = await loadAgents()
      const map = new Map(file.agents.map((a) => [a.id, a]))
      file.agents = ids.map((id) => map.get(id)).filter(Boolean) as Agent[]
      await saveAgents(file)
      return true
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.agents.run, async (_e, agentId: string, req: AgentRunRequest) => {
    try {
      return await runAgent(agentId, req)
    } catch (err) {
      throw toAppError(err)
    }
  })
}
