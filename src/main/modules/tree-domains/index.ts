/**
 * outline / memory / deposition IPC 域
 * 三者共享"创作资料"下的文件树服务，只是入口目录不同：
 *  - outline:    创作资料/大纲
 *  - memory:     创作资料/重点记忆
 *  - deposition: 创作资料/设定沉淀
 */
import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { IPC } from '@shared/ipc'
import {
  MATERIALS_ROOT,
  OUTLINE,
  MEMORY_CATEGORIES,
  MEMORY_INDEX_FILE,
  CANON_CATEGORIES,
  VOLUME_FILE_RE,
  CHAPTER_FILE_RE
} from '@shared/data-layout'
import { readText, atomicWrite, resolveProjectPath, getProjectRoot, hasProject, toProjectRelative, rmRecursive, toAppError, AppError } from '../shared/fs-utils'
import { materialService } from '../materials'

type Domain = 'outline' | 'memory' | 'deposition'

function domainRoot(domain: Domain): string {
  const root = path.join(getProjectRoot(), MATERIALS_ROOT)
  switch (domain) {
    case 'outline':
      // 真实旧版布局：大纲文件平铺在创作资料根下（总纲.md / 分卷大纲 / 章节细纲 / 大纲修订记录）
      return root
    case 'memory':
      return path.join(root, '重点记忆')
    case 'deposition':
      return path.join(root, '设定沉淀')
  }
}

/** 大纲相关条目名（真实旧版布局 + 兼容旧的"大纲/"子目录） */
const OUTLINE_ENTRY_NAMES = new Set([
  OUTLINE.master, // 总纲.md
  OUTLINE.volumeDir, // 分卷大纲
  OUTLINE.chapterDir, // 章节细纲
  OUTLINE.revisionDir, // 大纲修订记录
  '大纲'
])

async function listDomain(domain: Domain) {
  // 无当前项目（如当前项目被删除）→ 返回空树，不抛错
  if (!hasProject()) return []
  const dir = domainRoot(domain)
  const relBase = toProjectRelative(dir)!
  if (domain === 'outline') {
    // 只展示大纲相关条目（创作资料根下）
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const nodes = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (!OUTLINE_ENTRY_NAMES.has(entry.name)) continue
      const abs = path.join(dir, entry.name)
      const rel = `${relBase}/${entry.name}`
      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: rel,
          isDir: true,
          children: await materialService.scanTree(abs, rel, 1)
        })
      } else {
        nodes.push({
          name: entry.name,
          path: rel,
          isDir: false,
          kind: 'text'
        })
      }
    }
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-CN')
    })
    return nodes
  }
  return materialService.scanTree(dir, relBase, 0)
}

async function readDomain(domain: Domain, relPath: string) {
  materialService.requireText(relPath)
  const abs = resolveProjectPath(relPath)
  const rel = toProjectRelative(abs)
  if (!rel || !rel.startsWith(`${MATERIALS_ROOT}/`)) {
    throw new AppError('invalid_path', '非法路径', true)
  }
  return { content: await readText(abs), path: rel }
}

async function writeDomain(domain: Domain, relPath: string, content: string) {
  materialService.requireText(relPath)
  const abs = resolveProjectPath(relPath)
  const rel = toProjectRelative(abs)
  if (!rel || !rel.startsWith(`${MATERIALS_ROOT}/`)) {
    throw new AppError('invalid_path', '非法路径', true)
  }
  await atomicWrite(abs, content)
  return true
}

/** 大纲专用：创建分卷大纲/章纲（自动编号） */
async function createOutline(kind: 'volume' | 'chapter', number: number, title?: string): Promise<string> {
  const root = getProjectRoot()
  const dir =
    kind === 'volume'
      ? path.join(root, MATERIALS_ROOT, OUTLINE.volumeDir)
      : path.join(root, MATERIALS_ROOT, OUTLINE.chapterDir)
  await fs.mkdir(dir, { recursive: true })
  const name =
    kind === 'volume'
      ? `第${String(number).padStart(3, '0')}卷.md`
      : `第${String(number).padStart(3, '0')}章.md`
  const full = path.join(dir, name)
  const heading = title ? `# ${title}\n\n` : `# ${name.replace('.md', '')}\n\n`
  await atomicWrite(full, heading)
  return `${MATERIALS_ROOT}/${OUTLINE.volumeDir}/${name}`
}

async function deleteDomain(domain: Domain, relPath: string) {
  const abs = resolveProjectPath(relPath)
  await rmRecursive(abs)
  return true
}

export function registerTreeDomainsIpc(): void {
  // ===== outline =====
  ipcMain.handle(IPC.outline.list, async () => {
    try {
      // 无项目时返回空树（删除当前项目后右面板挂载会请求此接口）
      if (!hasProject()) return []
      // 确保大纲标准结构存在（新项目首次打开时创建总纲.md 等）
      await materialService.ensureMaterialDirs()
      return await listDomain('outline')
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.outline.read, async (_e, p: string) => {
    try {
      return await readDomain('outline', p)
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.outline.write, async (_e, p: string, c: string) => {
    try {
      return await writeDomain('outline', p, c)
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.outline.create, async (_e, kind: 'volume' | 'chapter', number: number, title?: string) => {
    try {
      return await createOutline(kind, number, title ?? undefined)
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.outline.delete, async (_e, p: string) => {
    try {
      return await deleteDomain('outline', p)
    } catch (err) {
      throw toAppError(err)
    }
  })

  // ===== memory =====
  ipcMain.handle(IPC.memory.list, async () => {
    try {
      return await listDomain('memory')
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.memory.read, async (_e, p: string) => {
    try {
      return await readDomain('memory', p)
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.memory.write, async (_e, p: string, c: string) => {
    try {
      return await writeDomain('memory', p, c)
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.memory.delete, async (_e, p: string) => {
    try {
      return await deleteDomain('memory', p)
    } catch (err) {
      throw toAppError(err)
    }
  })

  // ===== deposition =====
  ipcMain.handle(IPC.deposition.list, async () => {
    try {
      return await listDomain('deposition')
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.deposition.read, async (_e, p: string) => {
    try {
      return await readDomain('deposition', p)
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.deposition.write, async (_e, p: string, c: string) => {
    try {
      return await writeDomain('deposition', p, c)
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.deposition.delete, async (_e, p: string) => {
    try {
      return await deleteDomain('deposition', p)
    } catch (err) {
      throw toAppError(err)
    }
  })
}

export const treeDomainHelpers = {
  MEMORY_CATEGORIES,
  MEMORY_INDEX_FILE,
  CANON_CATEGORIES,
  OUTLINE,
  VOLUME_FILE_RE,
  CHAPTER_FILE_RE
}
