/**
 * chapters IPC 域：章节列表/读写/历史版本/回滚
 * 磁盘布局：正文/第001章.txt、正文/历史版本/第001章_时间戳.md
 */
import { ipcMain, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { IPC } from '@shared/ipc'
import type { HistoryVersion } from '@shared/types/chapter'
import {
  DRAFT_DIR,
  HISTORY_DIR,
  chapterFileName,
  chapterNumberFromFile,
  PROJECT_META_FILE,
  defaultProjectMeta,
  type ProjectMeta
} from '@shared/data-layout'
import { atomicWrite, readText, writeJson, resolveProjectPath, getProjectRoot, readJson, toAppError, AppError } from '../shared/fs-utils'
import { settingsStore } from '../settings'
import { runSelfCheck, saveReview } from '../rules'
import { scheduleMaintenance } from '../../ai/maintenance'

export interface ChapterInfo {
  number: number
  name: string
  path: string
  size: number
  chars: number
  updatedAt: string
}

export type { HistoryVersion }

function broadcast(channel: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, {})
  }
}

/** 章节字数缓存（mtime+size 不变则复用，避免列表刷新时每章全文重读） */
const chapterCharsCache = new Map<string, { mtimeMs: number; size: number; chars: number }>()

/** 列出全部章节（按编号排序） */
async function listChapters(): Promise<ChapterInfo[]> {
  const dir = path.join(getProjectRoot(), DRAFT_DIR)
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const chapters: ChapterInfo[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) continue
    const n = chapterNumberFromFile(entry.name)
    if (n === null) continue
    const full = path.join(dir, entry.name)
    const stat = await fs.stat(full)
    let cached = chapterCharsCache.get(entry.name)
    if (!cached || cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
      const text = await readText(full)
      cached = { mtimeMs: stat.mtimeMs, size: stat.size, chars: countChars(text) }
      chapterCharsCache.set(entry.name, cached)
      if (chapterCharsCache.size > 500) chapterCharsCache.clear() // 防极端情况无限增长
    }
    chapters.push({
      number: n,
      name: entry.name,
      path: `${DRAFT_DIR}/${entry.name}`,
      size: stat.size,
      chars: cached.chars,
      updatedAt: stat.mtime.toISOString()
    })
  }
  chapters.sort((a, b) => a.number - b.number)
  return chapters
}

function countChars(text: string): number {
  return text.replace(/\s/g, '').length
}

/** 读取章节内容 */
async function readChapter(number: number): Promise<{ text: string; name: string }> {
  const dir = path.join(getProjectRoot(), DRAFT_DIR)
  const name = chapterFileName(number)
  const full = path.join(dir, name)
  try {
    const text = await readText(full)
    return { text, name }
  } catch {
    throw new AppError('not_found', `第${number}章不存在`, true)
  }
}

/** 写入章节：原子写 + 历史快照（去重）+ 推进 chapterProgress */
export async function writeChapter(number: number, text: string): Promise<ChapterInfo> {
  const root = getProjectRoot()
  const dir = path.join(root, DRAFT_DIR)
  const name = chapterFileName(number)
  const full = path.join(dir, name)

  // 历史快照：与当前内容不同才快照
  try {
    const existing = await readText(full)
    if (existing !== text) {
      const historyDir = path.join(dir, HISTORY_DIR)
      await fs.mkdir(historyDir, { recursive: true })
      // 毫秒精度（14 位秒级在同秒内两次保存会覆盖同一快照，丢失一个版本）
      const stamp = new Date().toISOString().replace(/[-:.T]/g, '').slice(0, 17)
      const historyName = `${name.replace(/\.(txt|md|markdown)$/i, '')}_${stamp}.md`
      await atomicWrite(path.join(historyDir, historyName), existing)
      // 保留最近 30 个版本
      await trimHistory(number, 30)
    }
  } catch {
    /* 首次写入无历史 */
  }

  await atomicWrite(full, text)
  await updateProgress(number)

  // 高质量审稿：正文落盘后自动自检并保存报告
  try {
    const projectSettings = await settingsStore.loadProject()
    if (projectSettings.highQualityReview && text.trim().length > 50) {
      const report = await runSelfCheck(text)
      report.chapterNumber = number
      await saveReview(report, number, `第${number}章`)
    }
  } catch {
    /* 审稿失败不阻断保存 */
  }

  // 章节整理工作流：读取最新章节，自动更新概要/设定/记忆（防抖 5 秒）
  if (text.trim().length > 20) {
    scheduleMaintenance(number, text)
  }

  broadcast(IPC.chapters.eventChanged)
  const stat = await fs.stat(full)
  return {
    number,
    name,
    path: `${DRAFT_DIR}/${name}`,
    size: stat.size,
    chars: countChars(text),
    updatedAt: stat.mtime.toISOString()
  }
}

async function trimHistory(number: number, keep: number): Promise<void> {
  const historyDir = path.join(getProjectRoot(), DRAFT_DIR, HISTORY_DIR)
  try {
    const entries = await fs.readdir(historyDir, { withFileTypes: true })
    const prefix = chapterFileName(number).replace(/\.(txt|md|markdown)$/i, '') + '_'
    const mine = entries
      .filter((e) => !e.isDirectory() && e.name.startsWith(prefix))
      .sort()
    for (let i = 0; i < mine.length - keep; i++) {
      await fs.rm(path.join(historyDir, mine[i].name), { force: true })
    }
  } catch {
    /* 忽略 */
  }
}

/** 更新 project.json 的 chapterProgress */
async function updateProgress(number: number): Promise<ProjectMeta> {
  const metaFile = path.join(getProjectRoot(), PROJECT_META_FILE)
  const meta = await readJson<ProjectMeta>(metaFile, defaultProjectMeta('default', '未命名'))
  meta.chapterProgress = {
    currentChapterNumber: Math.max(meta.chapterProgress.currentChapterNumber, number + 1),
    lastCompletedChapterNumber: Math.max(meta.chapterProgress.lastCompletedChapterNumber, number),
    updatedAt: new Date().toISOString()
  }
  meta.updatedAt = new Date().toISOString()
  await writeJson(metaFile, meta)
  broadcast(IPC.chapters.eventProgress)
  return meta
}

/** 列出某章历史版本 */
async function listHistory(number: number): Promise<HistoryVersion[]> {
  const historyDir = path.join(getProjectRoot(), DRAFT_DIR, HISTORY_DIR)
  const prefix = chapterFileName(number).replace(/\.(txt|md|markdown)$/i, '') + '_'
  try {
    const entries = await fs.readdir(historyDir, { withFileTypes: true })
    const versions: HistoryVersion[] = []
    for (const entry of entries) {
      if (entry.isDirectory() || !entry.name.startsWith(prefix)) continue
      const full = path.join(historyDir, entry.name)
      const stat = await fs.stat(full)
      const text = await readText(full)
      versions.push({
        name: entry.name,
        path: `${DRAFT_DIR}/${HISTORY_DIR}/${entry.name}`,
        timestamp: stat.mtime.toISOString(),
        chars: countChars(text)
      })
    }
    versions.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    return versions
  } catch {
    return []
  }
}

async function readHistory(relPath: string): Promise<string> {
  const abs = resolveProjectPath(relPath)
  // 校验在历史版本目录内
  const historyAbs = path.join(getProjectRoot(), DRAFT_DIR, HISTORY_DIR)
  if (!abs.startsWith(historyAbs + path.sep)) {
    throw new AppError('invalid_path', '非法历史版本路径', true)
  }
  return readText(abs)
}

async function revertHistory(number: number, relPath: string): Promise<ChapterInfo> {
  const content = await readHistory(relPath)
  return writeChapter(number, content)
}

/** 删除章节（保留历史版本，可从历史恢复） */
async function deleteChapter(number: number): Promise<boolean> {
  const dir = path.join(getProjectRoot(), DRAFT_DIR)
  const name = chapterFileName(number)
  try {
    await fs.rm(path.join(dir, name), { force: true })
  } catch {
    throw new AppError('not_found', `第${number}章不存在`, true)
  }
  broadcast(IPC.chapters.eventChanged)
  return true
}

export function registerChaptersIpc(): void {
  ipcMain.handle(IPC.chapters.list, async () => {
    try {
      return await listChapters()
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.chapters.read, async (_e, number: number) => {
    try {
      return await readChapter(number)
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.chapters.write, async (_e, number: number, text: string) => {
    try {
      return await writeChapter(number, text)
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.chapters.listHistory, async (_e, number: number) => {
    try {
      return await listHistory(number)
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.chapters.readHistory, async (_e, relPath: string) => {
    try {
      return await readHistory(relPath)
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.chapters.revertHistory, async (_e, number: number, relPath: string) => {
    try {
      return await revertHistory(number, relPath)
    } catch (err) {
      throw toAppError(err)
    }
  })
  ipcMain.handle(IPC.chapters.delete, async (_e, number: number) => {
    try {
      return await deleteChapter(number)
    } catch (err) {
      throw toAppError(err)
    }
  })
}
