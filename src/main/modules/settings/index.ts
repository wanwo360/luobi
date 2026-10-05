/**
 * settings IPC 域：全局设置 + 项目设置
 */
import { ipcMain, dialog, shell } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { IPC } from '@shared/ipc'
import { DEFAULT_APP_SETTINGS, DEFAULT_PROJECT_SETTINGS, type AppSettings, type ProjectSettings } from '@shared/types/settings'
import { atomicWrite, readJson, writeJson, homePath, getProjectRoot, toAppError, AppError } from '../shared/fs-utils'
import { AINOVEL_DIR } from '@shared/data-layout'

const APP_SETTINGS_FILE = 'app-settings.json'

export const settingsStore = {
  filePath(): string {
    return path.join(homePath(), '.luobi', APP_SETTINGS_FILE)
  },
  async load(): Promise<AppSettings> {
    const saved = await readJson<Partial<AppSettings>>(this.filePath(), {})
    return { ...DEFAULT_APP_SETTINGS, ...saved }
  },
  async save(settings: AppSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath()), { recursive: true })
    await writeJson(this.filePath(), settings)
  },
  projectFile(): string {
    return path.join(getProjectRoot(), AINOVEL_DIR, 'project-settings.json')
  },
  async loadProject(): Promise<ProjectSettings> {
    const saved = await readJson<Partial<ProjectSettings>>(this.projectFile(), {})
    return { ...DEFAULT_PROJECT_SETTINGS, ...saved }
  },
  async saveProject(settings: ProjectSettings): Promise<void> {
    await writeJson(this.projectFile(), settings)
    // 写作偏好同步到书级规则（.ainovel/rules/写作偏好.md，规则系统自动加载）
    const prefs = settings.writingPreferences
    if (prefs) {
      const lines: string[] = ['# 写作偏好（设置中心维护，自动生效）', '']
      if (prefs.technique?.trim()) lines.push('## 写作技法', prefs.technique.trim(), '')
      if (prefs.style?.trim()) lines.push('## 文风偏好', prefs.style.trim(), '')
      if (prefs.reviewFocus?.trim()) lines.push('## 审稿重点', prefs.reviewFocus.trim(), '')
      if (lines.length > 2) {
        await atomicWrite(
          path.join(getProjectRoot(), AINOVEL_DIR, 'rules', '写作偏好.md'),
          lines.join('\n')
        )
      }
    }
  },
  /** 导出当前项目（复制到用户选择目录） */
  async exportProject(): Promise<string | null> {
    const root = getProjectRoot()
    const result = await dialog.showOpenDialog({
      title: '选择备份保存位置',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled) return null
    const projectName = path.basename(root)
    const target = path.join(result.filePaths[0], `${projectName}-备份-${Date.now().toString(36)}`)
    await fs.cp(root, target, { recursive: true })
    return target
  },
  /** 打开数据目录（工作区根） */
  async openDataFolder(): Promise<void> {
    await shell.openPath(getProjectRoot())
  }
}

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settings.get, async () => {
    try {
      return await settingsStore.load()
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.settings.save, async (_e, settings: AppSettings) => {
    try {
      await settingsStore.save(settings)
      return true
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.settings.getProject, async () => {
    try {
      return await settingsStore.loadProject()
    } catch (err) {
      if (err instanceof AppError && err.code === 'no_project') {
        return { ...DEFAULT_PROJECT_SETTINGS }
      }
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.settings.saveProject, async (_e, settings: ProjectSettings) => {
    try {
      await settingsStore.saveProject(settings)
      return true
    } catch (err) {
      if (err instanceof AppError && err.code === 'no_project') {
        return true
      }
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.settings.exportProject, async () => {
    try {
      return await settingsStore.exportProject()
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.settings.openDataFolder, async () => {
    try {
      await settingsStore.openDataFolder()
      return true
    } catch (err) {
      throw toAppError(err)
    }
  })
}
