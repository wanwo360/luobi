/**
 * 主进程入口：应用生命周期、主窗口、模块注册
 */
import { app, BrowserWindow } from 'electron'
import { cpSync, existsSync } from 'fs'
import os from 'os'
import path from 'path'
import { registerProjectsIpc } from './modules/projects'
import { registerChaptersIpc } from './modules/chapters'
import { registerMaterialsIpc } from './modules/materials'
import { registerTreeDomainsIpc } from './modules/tree-domains'
import { registerChatIpc } from './modules/chat'
import { registerAgentsIpc } from './modules/agents'
import { registerProviderIpc } from './modules/provider'
import { registerRulesIpc } from './modules/rules'
import { registerUsageIpc } from './modules/usage'
import { registerSettingsIpc } from './modules/settings'
import { registerSystemIpc, installCloseGuard } from './modules/system'
import { registerImageIpc } from './modules/image'
import { registerMusicIpc } from './music'
import { registerMusicSchemePrivileged, handleMusicScheme } from './music/stream'
import { getWorkspaceRoot } from './modules/workspace'
import { setProjectRoot } from './modules/shared/fs-utils'
import { getCurrentProject, projectDir } from './modules/workspace'
import { runMaintenance, backfillChapterSummaries, runPendingMaintenance, backfillGaps, verifyChapterConsistency } from './ai/maintenance'

// 调试/一次性补跑接口（e2e 测试用）
export const maintenanceApi = {
  runMaintenance,
  backfillChapterSummaries,
  runPendingMaintenance,
  backfillGaps,
  verifyChapterConsistency
}

// 单实例锁
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // 自定义协议特权声明必须在 app ready 前
  registerMusicSchemePrivileged()
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    // 初始化工作区与当前项目
    const workspace = getWorkspaceRoot()
    console.log(`[落笔] 工作区: ${workspace}`)
    const current = await getCurrentProject()
    if (current) {
      setProjectRoot(projectDir(current.id))
    }

    migrateLegacyConfigDir()
    registerAllIpc()
    handleMusicScheme()
    createMainWindow()
    // 补跑上次退出前未完成的章节整理（防抖期内退出不丢）
    if (current) {
      void runPendingMaintenance()
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

/**
 * 一次性迁移：把旧版配置目录（~/.xinglu-open）复制到 ~/.luobi-open。
 * 采用「复制」而非「移动」—— 失败也不会丢原数据，用户可自行手动拷贝后重试。
 */
function migrateLegacyConfigDir(): void {
  try {
    const home = os.homedir()
    const legacy = path.join(home, '.xinglu-open')
    const next = path.join(home, '.luobi-open')
    if (!existsSync(next) && existsSync(legacy)) {
      cpSync(legacy, next, { recursive: true })
      console.log('[落笔] 已迁移旧配置目录 → ~/.luobi-open')
    }
  } catch (err) {
    console.warn('[落笔] 旧配置目录迁移失败（可手动把 ~/.xinglu-open 复制为 ~/.luobi-open）:', err)
  }
}

function registerAllIpc(): void {
  registerProjectsIpc()
  registerChaptersIpc()
  registerMaterialsIpc()
  registerTreeDomainsIpc()
  registerChatIpc()
  registerAgentsIpc()
  registerProviderIpc()
  registerRulesIpc()
  registerUsageIpc()
  registerSettingsIpc()
  registerSystemIpc()
  registerImageIpc()
  registerMusicIpc()
}

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    title: '落笔 - 万象文新',
    frame: false,
    backgroundColor: '#f8f3eb',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  win.setMenuBarVisibility(false)
  installCloseGuard(win)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}
