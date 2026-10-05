/**
 * 章节编辑器浮动窗口
 */
import { BrowserWindow } from 'electron'
import path from 'path'

export async function createChapterEditorWindow(
  parent: BrowserWindow | null,
  opts: { chapterNumber?: number; text?: string; title?: string } = {}
): Promise<BrowserWindow | null> {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    title: '落笔 · 章节编辑器',
    parent: parent ?? undefined,
    frame: false,
    backgroundColor: '#f8f3eb',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  win.setMenuBarVisibility(false)

  if (process.env.ELECTRON_RENDERER_URL) {
    // dev：加载渲染进程 URL + 章节编辑器 surface
    await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?luobiSurface=chapter-editor`)
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { luobiSurface: 'chapter-editor' }
    })
  }
  return win
}
