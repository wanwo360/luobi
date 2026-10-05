/**
 * 工作区管理：Documents/落笔/ 布局（兼容旧版目录）、项目列表、当前指针、回收站
 * 磁盘布局严格对齐旧版布局（见 shared/data-layout.ts）
 */
import { promises as fs } from 'fs'
import fsSync from 'fs'
import path from 'path'
import { app } from 'electron'
import {
  WORKSPACE_DIR_NAME,
  WORKSPACE_ENV_OVERRIDE,
  LEGACY_WORKSPACE_NAMES,
  PROJECTS_DIR,
  CURRENT_POINTER_FILE,
  TRASH_DIR_NAME,
  PROJECT_META_FILE,
  defaultProjectMeta,
  type ProjectMeta,
  type ProjectSummary
} from '@shared/data-layout'
import { atomicWrite, readJson, writeJson, rmRecursive, AppError, setProjectRoot } from '../shared/fs-utils'

let workspaceRoot: string | null = null

/** 计算工作区根（Documents/落笔，兼容旧目录名，环境变量可覆盖） */
export function getWorkspaceRoot(): string {
  if (workspaceRoot) return workspaceRoot
  const override = process.env[WORKSPACE_ENV_OVERRIDE]
  if (override) {
    workspaceRoot = override
    return workspaceRoot
  }
  const docs = app.getPath('documents')
  // 优先新目录名，其次旧目录名
  const direct = path.join(docs, WORKSPACE_DIR_NAME)
  for (const legacy of [WORKSPACE_DIR_NAME, ...LEGACY_WORKSPACE_NAMES]) {
    const p = path.join(docs, legacy)
    if (p === direct) continue
    if (fsSync.existsSync(p)) {
      // 存在旧目录且新目录不存在 → 用旧目录（旧版兼容逻辑）
      if (!fsSync.existsSync(direct)) {
        workspaceRoot = p
        return workspaceRoot
      }
    }
  }
  workspaceRoot = direct
  return workspaceRoot
}

export function projectsRoot(): string {
  return path.join(getWorkspaceRoot(), PROJECTS_DIR)
}

export function trashRoot(): string {
  return path.join(projectsRoot(), TRASH_DIR_NAME)
}

export function projectDir(projectId: string): string {
  return path.join(projectsRoot(), projectId)
}

export function projectMetaFile(projectId: string): string {
  return path.join(projectDir(projectId), PROJECT_META_FILE)
}

/** 列出全部项目（跳过指针文件与回收站） */
export async function listProjects(): Promise<ProjectSummary[]> {
  const root = projectsRoot()
  await fs.mkdir(root, { recursive: true })
  const entries = await fs.readdir(root, { withFileTypes: true })
  // 各项目 meta 读取互相独立，并行加速（书多时的列表首屏）
  const results = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && e.name !== TRASH_DIR_NAME)
      .map(async (entry) => {
        // 跳过删除残留的空壳目录（无 project.json 的残缺项目）
        const metaFile = projectMetaFile(entry.name)
        try {
          await fs.access(metaFile)
        } catch {
          return null
        }
        const meta = await readJson<ProjectMeta>(
          metaFile,
          defaultProjectMeta(entry.name, entry.name)
        )
        // 兼容旧版 GBK 编码文件（UTF-8 解码产生替换字符时显示 id）
        const cleanName = meta.name?.includes('�') ? entry.name : meta.name
        return {
          id: entry.name,
          name: cleanName || entry.name,
          path: projectDir(entry.name),
          meta,
          chapterCount: 0,
          totalChars: 0,
          updatedAt: meta.updatedAt || ''
        } satisfies ProjectSummary
      })
  )
  return results.filter((r): r is ProjectSummary => r !== null)
}

/** 读取当前项目指针 */
export async function getCurrentProjectId(): Promise<string | null> {
  const pointer = path.join(projectsRoot(), CURRENT_POINTER_FILE)
  try {
    const raw = await fs.readFile(pointer, 'utf8')
    const id = raw.trim().replace(/^"|"$/g, '')
    return id || null
  } catch {
    return null
  }
}

export async function setCurrentProjectId(id: string): Promise<void> {
  const pointer = path.join(projectsRoot(), CURRENT_POINTER_FILE)
  await atomicWrite(pointer, JSON.stringify(id))
}

export async function getCurrentProject(): Promise<ProjectSummary | null> {
  const id = await getCurrentProjectId()
  if (!id) return null
  const list = await listProjects()
  return list.find((p) => p.id === id) ?? null
}

/** 新建项目 */
export async function createProject(name: string): Promise<ProjectSummary> {
  const safeName = name.trim() || '未命名'
  // 生成唯一 id：拼音/日期混合
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const dir = projectDir(id)
  await fs.mkdir(path.join(dir, '正文'), { recursive: true })
  await fs.mkdir(path.join(dir, '创作资料'), { recursive: true })
  await fs.mkdir(path.join(dir, '.novelforge'), { recursive: true })
  const meta = defaultProjectMeta(id, safeName)
  await writeJson(projectMetaFile(id), meta)
  await setCurrentProjectId(id)
  return {
    id,
    name: safeName,
    path: dir,
    meta,
    chapterCount: 0,
    totalChars: 0,
    updatedAt: meta.updatedAt
  }
}

export async function deleteProject(id: string, permanent = false): Promise<void> {
  const dir = projectDir(id)
  const trashDir = trashRoot()
  if (permanent) {
    await rmRecursive(dir)
    return
  }
  // 先入垃圾箱（旧版同语义：移入 垃圾箱/<id>）
  await fs.mkdir(trashDir, { recursive: true })
  const trashTarget = path.join(trashDir, id)
  await fs.rename(dir, trashTarget).catch(async () => {
    // 跨盘/占用等失败时复制再删（先清可能存在的旧目标，防 cp 报错）
    await rmRecursive(trashTarget)
    await fs.cp(dir, trashTarget, { recursive: true })
    await rmRecursive(dir)
  })
  const current = await getCurrentProjectId()
  if (current === id) {
    await setCurrentProjectId('')
    // 清空项目根缓存，后续操作（聊天/资料等）按"无项目"处理而非指向已删除目录
    setProjectRoot('')
  }
}

export async function restoreTrash(id: string): Promise<void> {
  const src = path.join(trashRoot(), id)
  try {
    await fs.access(src)
  } catch {
    throw new AppError('not_found', '回收站中不存在该项目', true)
  }
  await fs.rename(src, projectDir(id)).catch(async () => {
    await fs.cp(src, projectDir(id), { recursive: true })
    await rmRecursive(src)
  })
}

export async function listTrash(): Promise<ProjectSummary[]> {
  const root = trashRoot()
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    const results: ProjectSummary[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      // 注意：回收站项目的 project.json 在回收站目录内，不是 projects 原目录
      const metaFile = path.join(root, entry.name, PROJECT_META_FILE)
      // 跳过残缺目录（删除残留）
      try {
        await fs.access(metaFile)
      } catch {
        continue
      }
      const meta = await readJson<ProjectMeta>(
        metaFile,
        defaultProjectMeta(entry.name, entry.name)
      )
      const cleanName = meta.name?.includes('�') ? entry.name : meta.name
      results.push({
        id: entry.name,
        name: cleanName || entry.name,
        path: path.join(root, entry.name),
        meta,
        chapterCount: 0,
        totalChars: 0,
        updatedAt: meta.updatedAt || ''
      })
    }
    return results
  } catch {
    return []
  }
}

export async function renameProject(id: string, newName: string): Promise<ProjectMeta> {
  const file = projectMetaFile(id)
  const meta = await readJson<ProjectMeta>(file, defaultProjectMeta(id, id))
  meta.name = newName.trim() || meta.name
  meta.updatedAt = new Date().toISOString()
  await writeJson(file, meta)
  return meta
}
