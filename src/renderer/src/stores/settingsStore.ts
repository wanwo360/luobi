import { create } from 'zustand'
import type { AppSettings, ProjectSettings } from '@shared/types/settings'
import type { ProviderState } from '@shared/types/provider'
import type { UsageStats } from '@shared/types/rules'

interface SettingsState {
  theme: 'light' | 'dark'
  scale: 'normal' | 'medium' | 'large'
  appSettings: AppSettings | null
  projectSettings: ProjectSettings | null
  providerState: ProviderState | null
  usage: UsageStats | null

  load: () => Promise<void>
  toggleTheme: () => Promise<void>
  setScale: (s: 'normal' | 'medium' | 'large') => Promise<void>
  saveApp: (patch: Partial<AppSettings>) => Promise<void>
  saveProject: (patch: Partial<ProjectSettings>) => Promise<void>
  refreshProvider: () => Promise<void>
  refreshUsage: () => Promise<void>
  applyTheme: (theme: 'light' | 'dark') => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: 'light',
  scale: 'normal',
  appSettings: null,
  projectSettings: null,
  providerState: null,
  usage: null,

  load: async () => {
    const appSettings = await window.luobi.settings.get()
    const projectSettings = await window.luobi.settings.getProject()
    const providerState = await window.luobi.provider.getSummary()
    const usage = await window.luobi.usage.get()
    set({ appSettings, projectSettings, providerState, usage, theme: appSettings.theme, scale: appSettings.interfaceScale })
    get().applyTheme(appSettings.theme)
  },

  applyTheme: (theme) => {
    document.documentElement.dataset.theme = theme
    window.luobi.system.setTheme(theme)
  },

  toggleTheme: async () => {
    const theme = get().theme === 'light' ? 'dark' : 'light'
    set({ theme })
    get().applyTheme(theme)
    await get().saveApp({ theme })
  },

  setScale: async (s) => {
    set({ scale: s })
    const factor = s === 'large' ? 1.3 : s === 'medium' ? 1.1 : 1
    await window.luobi.system.setZoom(factor)
    await get().saveApp({ interfaceScale: s })
  },

  saveApp: async (patch) => {
    const current = (await window.luobi.settings.get()) ?? {}
    const next = { ...current, ...patch }
    await window.luobi.settings.save(next)
    set({ appSettings: next })
  },

  saveProject: async (patch) => {
    const current = (await window.luobi.settings.getProject()) ?? {}
    const next = { ...current, ...patch }
    await window.luobi.settings.saveProject(next)
    set({ projectSettings: next })
  },

  refreshProvider: async () => {
    const providerState = await window.luobi.provider.getSummary()
    set({ providerState })
  },

  refreshUsage: async () => {
    const usage = await window.luobi.usage.get()
    set({ usage })
  }
}))

export function subscribeSettingsEvents(): () => void {
  const offTheme = window.luobi.system.onThemeChanged((payload: any) => {
    if (payload?.theme) {
      document.documentElement.dataset.theme = payload.theme
    }
  })
  const offUsage = window.luobi.usage.onUpdated(() => {
    useSettingsStore.getState().refreshUsage()
  })
  return () => {
    offTheme()
    offUsage()
  }
}
