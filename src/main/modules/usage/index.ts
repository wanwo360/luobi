/**
 * usage IPC 域：用量统计（~/.ainovel/usage.json 兼容 + per-model 扩展）
 */
import { ipcMain, BrowserWindow } from 'electron'
import path from 'path'
import { IPC } from '@shared/ipc'
import type { UsageStats } from '@shared/types/rules'
import { AINOVEL, AINOVEL_DIR } from '@shared/data-layout'
import { readJson, writeJson, getProjectRoot, hasProject, toAppError } from '../shared/fs-utils'

function usageFile(): string {
  return path.join(getProjectRoot(), AINOVEL_DIR, AINOVEL.usageFile)
}

function emptyStats(): UsageStats {
  return {
    schema: 2,
    updatedAt: new Date().toISOString(),
    overall: { input: 0, output: 0, cache_read: 0, cache_write: 0, cost_usd: 0, saved_usd: 0, cache_capable: true },
    per_model: {},
    per_agent: {}
  }
}

export const usageStore = {
  async load(): Promise<UsageStats> {
    return readJson<UsageStats>(usageFile(), emptyStats())
  },
  async save(stats: UsageStats): Promise<void> {
    stats.updatedAt = new Date().toISOString()
    await writeJson(usageFile(), stats)
  },
  /** 记录一次请求用量 */
  async record(
    modelId: string,
    agentKey: string,
    usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number }
  ): Promise<void> {
    const stats = await this.load()
    stats.overall.input += usage.inputTokens
    stats.overall.output += usage.outputTokens
    stats.overall.cache_read += usage.cacheReadTokens
    stats.overall.cache_write += usage.cacheWriteTokens
    stats.overall.cost_usd += usage.costUsd

    const m = (stats.per_model[modelId] ??= { input: 0, output: 0, cache_read: 0, cache_write: 0, cost_usd: 0, requests: 0 })
    m.input += usage.inputTokens
    m.output += usage.outputTokens
    m.cache_read += usage.cacheReadTokens
    m.cache_write += usage.cacheWriteTokens
    m.cost_usd += usage.costUsd
    m.requests += 1

    const a = (stats.per_agent[agentKey] ??= { input: 0, output: 0, cache_read: 0, cache_write: 0, cost_usd: 0, requests: 0 })
    a.input += usage.inputTokens
    a.output += usage.outputTokens
    a.cache_read += usage.cacheReadTokens
    a.cache_write += usage.cacheWriteTokens
    a.cost_usd += usage.costUsd
    a.requests += 1

    await this.save(stats)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.usage.eventUpdated, stats)
    }
  }
}

export function registerUsageIpc(): void {
  ipcMain.handle(IPC.usage.get, async () => {
    try {
      // 无当前项目时返回空用量（不抛错）
      if (!hasProject()) return emptyStats()
      return await usageStore.load()
    } catch (err) {
      throw toAppError(err)
    }
  })
}
