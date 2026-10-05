/**
 * materials IPC 域：创作资料整树（大纲/剧情概要/重点记忆/设定沉淀/资料等）
 * 通用文件树服务：list/read/write/delete/rename/createFolder/import
 */
import { ipcMain, dialog, shell } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { IPC } from '@shared/ipc'
import {
  MATERIALS_ROOT,
  TEXT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  AUDIO_EXTENSIONS,
  VIDEO_EXTENSIONS,
  MEMORY_CATEGORIES,
  CANON_CATEGORIES,
  MEMORY_INDEX_FILE,
  OUTLINE,
  STORY_SUMMARY_FILE
} from '@shared/data-layout'
import { atomicWrite, readText, resolveProjectPath, getProjectRoot, hasProject, toProjectRelative, rmRecursive, toAppError, AppError } from '../shared/fs-utils'

export interface MaterialNode {
  name: string
  /** 项目相对路径（正斜杠） */
  path: string
  isDir: boolean
  size?: number
  kind?: 'text' | 'image' | 'audio' | 'video' | 'other'
  updatedAt?: string
  children?: MaterialNode[]
}

const MEDIA_KIND = (ext: string): MaterialNode['kind'] => {
  const e = ext.toLowerCase()
  if ((TEXT_EXTENSIONS as readonly string[]).includes(e)) return 'text'
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(e)) return 'image'
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(e)) return 'audio'
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(e)) return 'video'
  return 'other'
}

/** 确保创作资料标准目录存在 */
export async function ensureMaterialDirs(): Promise<void> {
  const root = path.join(getProjectRoot(), MATERIALS_ROOT)
  const subdirs = [
    path.join(root, OUTLINE.master),
    path.join(root, OUTLINE.volumeDir),
    path.join(root, OUTLINE.chapterDir),
    path.join(root, OUTLINE.revisionDir),
    path.join(root, STORY_SUMMARY_FILE),
    ...MEMORY_CATEGORIES.map((c) => path.join(root, '重点记忆', c)),
    ...CANON_CATEGORIES.map((c) => path.join(root, '设定沉淀', c)),
    path.join(root, '资料'),
    path.join(root, '生成图片'),
    path.join(root, '章节摘要')
  ]
  for (const dir of subdirs) {
    if (dir.endsWith('.md')) continue // 文件不需要创建
    await fs.mkdir(dir, { recursive: true }).catch(() => {})
  }
  // 文件类（不存在时创建空占位）
  const files = [
    path.join(root, OUTLINE.master),
    path.join(root, STORY_SUMMARY_FILE),
    path.join(root, '重点记忆', MEMORY_INDEX_FILE)
  ]
  for (const f of files) {
    try {
      await fs.access(f)
    } catch {
      await atomicWrite(f, f.endsWith('INDEX.md') ? '# 重点记忆索引\n' : '# 空\n')
    }
  }
}

/** 扫描目录树（过滤隐藏文件） */
async function scanTree(absDir: string, relDir: string, depth: number): Promise<MaterialNode[]> {
  if (depth > 6) return []
  let entries
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true })
  } catch {
    return []
  }
  const nodes: MaterialNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = path.join(absDir, entry.name)
    const rel = `${relDir}/${entry.name}`.replace(/^\/+/, '')
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: rel,
        isDir: true,
        children: await scanTree(abs, rel, depth + 1)
      })
    } else {
      const stat = await fs.stat(abs)
      nodes.push({
        name: entry.name,
        path: rel,
        isDir: false,
        size: stat.size,
        kind: MEDIA_KIND(path.extname(entry.name)),
        updatedAt: stat.mtime.toISOString()
      })
    }
  }
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  return nodes
}

async function listTree(): Promise<MaterialNode[]> {
  const root = path.join(getProjectRoot(), MATERIALS_ROOT)
  return scanTree(root, MATERIALS_ROOT, 0)
}

function requireText(relPath: string): void {
  const ext = path.extname(relPath).toLowerCase()
  if (!(TEXT_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new AppError('invalid_type', '仅支持读写文本文件 (.md/.markdown/.txt)', true)
  }
}

export function registerMaterialsIpc(): void {
  ipcMain.handle(IPC.materials.list, async () => {
    try {
      // 无当前项目时返回空树（删除当前项目后资料面板挂载会请求此接口）
      if (!hasProject()) return []
      await ensureMaterialDirs()
      return await listTree()
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.materials.read, async (_e, relPath: string) => {
    try {
      requireText(relPath)
      const abs = resolveProjectPath(relPath)
      return { content: await readText(abs), path: relPath }
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.materials.write, async (_e, relPath: string, content: string) => {
    try {
      requireText(relPath)
      const abs = resolveProjectPath(relPath)
      // 只允许写创作资料与 .ainovel 内的文件
      const rel = toProjectRelative(abs)
      if (!rel || (!rel.startsWith(MATERIALS_ROOT + '/') && !rel.startsWith('.ainovel/'))) {
        throw new AppError('invalid_path', '只能写入创作资料目录', true)
      }
      await atomicWrite(abs, content)
      return true
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.materials.delete, async (_e, relPath: string) => {
    try {
      const abs = resolveProjectPath(relPath)
      const rel = toProjectRelative(abs)
      if (!rel || !rel.startsWith(MATERIALS_ROOT + '/')) {
        throw new AppError('invalid_path', '只能删除创作资料目录内的内容', true)
      }
      await rmRecursive(abs)
      return true
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.materials.rename, async (_e, relPath: string, newName: string) => {
    try {
      const abs = resolveProjectPath(relPath)
      const clean = newName.replace(/[\\/:*?"<>|]/g, '').trim()
      if (!clean) throw new AppError('invalid_name', '文件名不合法', true)
      const target = path.join(path.dirname(abs), clean)
      await fs.rename(abs, target)
      return true
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.materials.createFolder, async (_e, parentRel: string, folderName: string) => {
    try {
      const parent = parentRel ? resolveProjectPath(parentRel) : path.join(getProjectRoot(), MATERIALS_ROOT)
      const clean = folderName.replace(/[\\/:*?"<>|]/g, '').trim()
      if (!clean) throw new AppError('invalid_name', '文件夹名不合法', true)
      await fs.mkdir(path.join(parent, clean), { recursive: true })
      return true
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.materials.importFiles, async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections', 'openDirectory'],
        title: '导入资料'
      })
      if (result.canceled) return 0
      const root = path.join(getProjectRoot(), MATERIALS_ROOT, '资料')
      await fs.mkdir(root, { recursive: true })
      let count = 0
      for (const src of result.filePaths) {
        const name = path.basename(src)
        const target = path.join(root, name)
        const stat = await fs.stat(src)
        if (stat.isDirectory()) {
          await fs.cp(src, target, { recursive: true })
        } else {
          await fs.copyFile(src, target)
        }
        count++
      }
      return count
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.materials.openFile, async (_e, relPath: string) => {
    const abs = resolveProjectPath(relPath)
    await shell.openPath(abs)
  })

  ipcMain.handle(IPC.materials.openFolder, async (_e, relPath?: string) => {
    const dir = relPath ? resolveProjectPath(relPath) : path.join(getProjectRoot(), MATERIALS_ROOT)
    await shell.openPath(dir)
  })
}

/** 供 outline/memory/deposition 域复用的基础服务 */
export const materialService = {
  scanTree,
  requireText,
  ensureMaterialDirs,
  listTree
}
