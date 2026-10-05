/**
 * projects IPC 域：项目 CRUD、当前指针、回收站、目录树
 */
import { ipcMain, BrowserWindow, shell } from 'electron'
import { IPC } from '@shared/ipc'
import { toProjectRelative, setProjectRoot, getProjectRoot, toAppError, rmRecursive } from '../shared/fs-utils'
import {
  getCurrentProject,
  setCurrentProjectId,
  listProjects,
  createProject,
  deleteProject,
  restoreTrash,
  listTrash,
  renameProject,
  projectDir,
  trashRoot
} from '../workspace'
import { promises as fs } from 'fs'
import path from 'path'
import { CHAPTER_FILE_RE, chapterNumberFromFile } from '@shared/data-layout'
import type { ProjectTree, ProjectTreeNode } from './tree-types'

function broadcast(channel: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, {})
  }
}

/** 构建项目目录树（用于 UI 渲染，跳过隐藏目录） */
async function buildTree(root: string): Promise<ProjectTree> {
  const node = async (dir: string): Promise<ProjectTreeNode> => {
    const name = path.basename(dir)
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const children: ProjectTreeNode[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        children.push(await node(full))
      } else {
        children.push({ name: entry.name, path: toProjectRelative(full)!, isDir: false, size: entry.name.endsWith('.txt') ? 0 : undefined })
      }
    }
    children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-CN')
    })
    return { name, path: toProjectRelative(dir) ?? '', isDir: true, children }
  }
  return (await node(root)) as ProjectTree
}

export function registerProjectsIpc(): void {
  ipcMain.handle(IPC.projects.list, async () => {
    try {
      return await listProjects()
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.projects.getCurrent, async () => {
    try {
      const p = await getCurrentProject()
      if (p) {
        setProjectRoot(projectDir(p.id))
      }
      return p
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.projects.create, async (_e, name: string) => {
    try {
      const p = await createProject(name)
      setProjectRoot(projectDir(p.id))
      // 初始化创作资料标准结构（总纲/分卷大纲/设定沉淀/重点记忆等）
      const { ensureMaterialDirs } = await import('../materials')
      await ensureMaterialDirs()
      broadcast(IPC.projects.eventChanged)
      return p
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.projects.select, async (_e, id: string) => {
    try {
      await setCurrentProjectId(id)
      setProjectRoot(projectDir(id))
      broadcast(IPC.projects.eventChanged)
      return await getCurrentProject()
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.projects.delete, async (_e, id: string) => {
    try {
      await deleteProject(id)
      broadcast(IPC.projects.eventChanged)
      broadcast(IPC.projects.eventTrashChanged)
      return true
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.projects.rename, async (_e, id: string, name: string) => {
    try {
      const meta = await renameProject(id, name)
      broadcast(IPC.projects.eventChanged)
      return meta
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.projects.listTrash, async () => {
    try {
      return await listTrash()
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.projects.restoreTrash, async (_e, id: string) => {
    try {
      await restoreTrash(id)
      broadcast(IPC.projects.eventChanged)
      broadcast(IPC.projects.eventTrashChanged)
      return true
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.projects.deleteTrash, async (_e, id: string) => {
    try {
      // 回收站内的项目在 垃圾箱/<id>，直接删该路径（deleteProject 只处理正式目录）
      await rmRecursive(path.join(trashRoot(), id))
      broadcast(IPC.projects.eventTrashChanged)
      return true
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.projects.openTrashFolder, async () => {
    await shell.openPath(path.join(path.dirname(getProjectRoot()), '垃圾箱'))
  })

  ipcMain.handle(IPC.projects.getTree, async () => {
    try {
      const root = getProjectRoot()
      const tree = await buildTree(root)
      // 附加章节统计
      const counts = await countChapters(tree)
      return { tree, counts }
    } catch (err) {
      throw toAppError(err)
    }
  })
}

async function countChapters(tree: ProjectTreeNode): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  const walk = (node: ProjectTreeNode): void => {
    if (!node.isDir && CHAPTER_FILE_RE.test(node.name)) {
      const n = chapterNumberFromFile(node.name)
      if (n !== null) counts[node.path] = n
    }
    for (const c of node.children ?? []) walk(c)
  }
  walk(tree)
  return counts
}
