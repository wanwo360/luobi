/**
 * system IPC 域：窗口控制、缩放、主题、外部链接、章节编辑器浮动窗口
 */
import { ipcMain, BrowserWindow, shell, dialog } from 'electron'
import { IPC } from '@shared/ipc'
import { toAppError } from '../shared/fs-utils'
import { createChapterEditorWindow } from '../../windows/chapter-editor'

/** 渲染进程上报的未保存标签数（用于关闭窗口前拦截确认） */
let dirtyCount = 0
/** 用户已确认丢弃（真正的擦除动作可用 force close 跳过拦截） */
let forcedClose = false

/** 为主窗口安装关闭拦截：有未保存标签时弹系统对话框询问（防误关窗口丢正文/资料） */
export function installCloseGuard(win: BrowserWindow): void {
  win.on('close', (e) => {
    if (dirtyCount <= 0 || forcedClose) return
    e.preventDefault()
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        title: '有未保存的内容',
        message: `有 ${dirtyCount} 个标签页包含未保存的修改`,
        detail: '现在退出将丢失这些修改。确定要放弃并退出吗？',
        buttons: ['放弃修改并退出', '取消'],
        defaultId: 1,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response === 0) {
          forcedClose = true
          win.close()
        }
      })
  })
}

export function registerSystemIpc(): void {
  ipcMain.handle(IPC.system.info, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return {
      platform: process.platform,
      versions: process.versions,
      isMaximized: win?.isMaximized() ?? false,
      isFullScreen: win?.isFullScreen() ?? false
    }
  })

  ipcMain.handle(IPC.system.openExternal, async (_e, url: string) => {
    if (/^https?:\/\//.test(url)) {
      await shell.openExternal(url)
      return true
    }
    throw toAppError(new Error('仅支持 http/https 链接'))
  })

  ipcMain.handle(IPC.system.setZoom, async (e, factor: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    const allowed = [1, 1.1, 1.3]
    const clamped = allowed.includes(factor) ? factor : 1
    win.webContents.setZoomFactor(clamped)
    return true
  })

  ipcMain.handle(IPC.system.setTheme, async (e, theme: 'light' | 'dark') => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    win.webContents.send(IPC.system.eventThemeChanged, { theme })
    return true
  })

  ipcMain.handle(IPC.system.windowAction, async (e, action: 'minimize' | 'maximize' | 'close') => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize') {
      win.isMaximized() ? win.unmaximize() : win.maximize()
    } else win.close()
    return true
  })

  ipcMain.handle(IPC.system.setDirtyCount, (_e, count: number) => {
    dirtyCount = Math.max(0, Number(count) || 0)
    return true
  })

  ipcMain.handle(IPC.system.openChapterEditor, async (e, opts: { chapterNumber?: number; text?: string; title?: string } = {}) => {
    const parent = BrowserWindow.fromWebContents(e.sender)
    const win = await createChapterEditorWindow(parent, opts)
    return win ? true : false
  })

  ipcMain.handle(IPC.system.closeChapterEditor, async () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.getTitle() === '落笔 · 章节编辑器') win.close()
    }
    return true
  })
}
