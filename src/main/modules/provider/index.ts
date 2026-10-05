/**
 * provider IPC 域：模型库管理（自定义 OpenAI 兼容供应商）
 */
import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { IPC } from '@shared/ipc'
import type { ProviderConfig, ProviderModel } from '@shared/types/chat'
import type { ProviderState } from '@shared/types/provider'
import { readJson, writeJson, homePath, toAppError, AppError } from '../shared/fs-utils'
import { detectApiStyle } from '../../ai/api-style'

const SETTINGS_FILE = 'provider-config.json'

export type { ProviderState }

export const providerStore = {
  filePath(): string {
    return path.join(homePath(), '.luobi', SETTINGS_FILE)
  },
  async load(): Promise<ProviderState> {
    return readJson<ProviderState>(this.filePath(), {
      providers: [],
      activeProviderId: '',
      activeModelId: '',
      writingModelId: 'inherit'
    })
  },
  async save(state: ProviderState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath()), { recursive: true })
    await writeJson(this.filePath(), state)
  }
}

export function registerProviderIpc(): void {
  ipcMain.handle(IPC.provider.getSummary, async () => {
    try {
      return await providerStore.load()
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(
    IPC.provider.save,
    async (_e, config: { id?: string; name: string; baseUrl: string; apiKey: string; apiStyle: ProviderConfig['apiStyle']; models: ProviderModel[] }) => {
      try {
        const state = await providerStore.load()
        if (config.id) {
          // 更新已有
          const idx = state.providers.findIndex((p) => p.id === config.id)
          if (idx >= 0) {
            state.providers[idx] = {
              ...state.providers[idx],
              ...config,
              updatedAt: new Date().toISOString()
            }
            await providerStore.save(state)
            return state.providers[idx]
          }
        }
        const provider: ProviderConfig = {
          ...config,
          id: `p-${Date.now().toString(36)}`,
          updatedAt: new Date().toISOString()
        }
        state.providers.push(provider)
        if (!state.activeProviderId) {
          state.activeProviderId = provider.id
          state.activeModelId = provider.models[0]?.id ?? ''
        }
        await providerStore.save(state)
        return provider
      } catch (err) {
        throw toAppError(err)
      }
    }
  )

  ipcMain.handle(IPC.provider.remove, async (_e, id: string) => {
    try {
      const state = await providerStore.load()
      state.providers = state.providers.filter((p) => p.id !== id)
      if (state.activeProviderId === id) {
        state.activeProviderId = state.providers[0]?.id ?? ''
        state.activeModelId = state.providers[0]?.models[0]?.id ?? ''
      }
      await providerStore.save(state)
      return true
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.provider.select, async (_e, providerId: string, modelId: string) => {
    try {
      const state = await providerStore.load()
      const provider = state.providers.find((p) => p.id === providerId)
      if (!provider) throw new AppError('not_found', '供应商不存在', true)
      if (!provider.models.some((m) => m.id === modelId)) {
        throw new AppError('not_found', '模型不存在于该供应商', true)
      }
      state.activeProviderId = providerId
      state.activeModelId = modelId
      await providerStore.save(state)
      return state
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.provider.listModels, async () => {
    try {
      const state = await providerStore.load()
      return state.providers.flatMap((p) =>
        p.models.map((m) => ({ provider: p, model: m }))
      )
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.provider.test, async (_e, baseUrl: string, apiKey: string) => {
    try {
      const style = detectApiStyle(baseUrl, '')
      // 简单连通性测试：拉取模型列表
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000)
      })
      if (!res.ok) {
        return { ok: false, message: `HTTP ${res.status}` }
      }
      const data = (await res.json()) as { data?: { id: string }[] }
      const models = (data.data ?? []).map((m) => m.id)
      return { ok: true, style, models }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })
}
