/**
 * 文件系统工具：原子写、UTF-8 编解码、项目路径白名单校验、错误编解码
 */
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

/** 项目根路径（启动时由 workspace 模块设置） */
let projectRootCache: string | null = null
export function setProjectRoot(root: string): void {
  projectRootCache = root
}
export function getProjectRoot(): string {
  if (!projectRootCache) throw new AppError('no_project', '项目尚未初始化', true)
  return projectRootCache
}

/** 是否有当前项目（供"无项目时返回空结果"的容错判断） */
export function hasProject(): boolean {
  return !!projectRootCache
}

/** 原子写：写 tmp + rename 覆盖 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`)
  await fs.writeFile(tmp, content, { encoding: 'utf8' })
  try {
    await fs.rename(tmp, filePath)
  } catch (err) {
    // Windows: rename 到已存在文件可能失败，尝试先删除再重命名
    try {
      await fs.rm(filePath, { force: true })
      await fs.rename(tmp, filePath)
    } catch {
      await fs.rm(tmp, { force: true })
      throw err
    }
  }
}

/**
 * 健壮递归删除（Windows 上 fs.rm recursive 偶发 ENOTEMPTY，需重试）
 */
export async function rmRecursive(target: string): Promise<void> {
  // 多轮重试：Windows 上被短暂占用的文件（读取句柄未释放）会导致删除失败
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  // 兜底：逐项删除后删目录
  try {
    const entries = await fs.readdir(target)
    for (const entry of entries) {
      await rmRecursive(path.join(target, entry))
    }
    await fs.rmdir(target)
  } catch {
    /* 残留忽略 */
  }
}

/** 读文本（容忍 BOM） */
export async function readText(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath)
  // 去掉 UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8')
  }
  return buf.toString('utf8')
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const text = await readText(filePath)
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await atomicWrite(filePath, JSON.stringify(value, null, 2))
}

/** 项目相对路径 → 绝对路径（白名单校验：拒绝 ..、绝对路径、符号链接逃逸） */
export function resolveProjectPath(relPath: string): string {
  const root = getProjectRoot()
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  const abs = path.resolve(root, normalized)
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new AppError('invalid_path', `非法路径: ${relPath}`, true)
  }
  return abs
}

/** 绝对路径 → 项目相对路径（正斜杠），不在项目内返回 null */
export function toProjectRelative(absPath: string): string | null {
  const root = getProjectRoot()
  const rel = path.relative(root, absPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}

/** 用户主目录下路径 */
export function homePath(...segments: string[]): string {
  return path.join(os.homedir(), ...segments)
}

export interface AppErrorShape {
  code: string
  message: string
  recoverable: boolean
  details?: unknown
}

export class AppError extends Error {
  code: string
  recoverable: boolean
  details?: unknown
  constructor(code: string, message: string, recoverable: boolean, details?: unknown) {
    super(message)
    this.code = code
    this.recoverable = recoverable
    this.details = details
  }
}

/** 转为可跨 IPC 抛出的 Error（Electron 只序列化 Error 的 message 与自有可枚举属性） */
export function toAppError(err: unknown): Error & Partial<AppErrorShape> {
  let shape: AppErrorShape
  if (err instanceof AppError) {
    shape = { code: err.code, message: err.message, recoverable: err.recoverable, details: err.details }
  } else {
    const e = err as NodeJS.ErrnoException
    if (e && e.code === 'ENOENT') {
      shape = { code: 'not_found', message: '文件或目录不存在', recoverable: true }
    } else if (e && e.code === 'EACCES') {
      shape = { code: 'permission', message: '没有访问权限', recoverable: true }
    } else if (e && e.code === 'ENOSPC') {
      shape = { code: 'disk_full', message: '磁盘空间不足', recoverable: true }
    } else {
      shape = {
        code: 'unknown',
        message: err instanceof Error ? err.message : String(err),
        recoverable: true
      }
    }
  }
  const e = new Error(shape.message) as Error & Partial<AppErrorShape>
  e.code = shape.code
  e.recoverable = shape.recoverable
  if (shape.details !== undefined) e.details = shape.details
  return e
}

/** 去除路径中的符号链接（避免穿越），返回 null 表示危险路径 */
export async function isPathInside(root: string, target: string): Promise<boolean> {
  const realRoot = await fs.realpath(root)
  const realTarget = await fs.realpath(target)
  const rel = path.relative(realRoot, realTarget)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}
