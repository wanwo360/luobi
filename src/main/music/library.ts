/**
 * 音乐库持久化：我的收藏 + 最近播放
 * 存于 ~/.luobi/music-library.json（全局跨项目，重启保留）
 * 单进程串行写 + 内存缓存 + 原子写（tmp+rename），损坏时静默回退空库
 * LUOBI_MUSIC_LIB_DIR 可覆盖目录（e2e 隔离用）
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import path from 'path'
import { homePath } from '../modules/shared/fs-utils.ts'
import type { TrackItem } from './types.ts'

const RECENT_MAX = 50

export interface MusicLibrary {
  favorites: TrackItem[]
  recent: TrackItem[]
}

function libraryDir(): string {
  return process.env.LUOBI_MUSIC_LIB_DIR || homePath('.luobi')
}

function libraryFile(): string {
  return path.join(libraryDir(), 'music-library.json')
}

let cache: MusicLibrary | null = null

/** 收藏/最近播放中保存元信息即可：播放地址每次现取（链接会过期） */
function stripUrl(track: TrackItem): TrackItem {
  const { url: _url, ...rest } = track
  return rest as TrackItem
}

function load(): MusicLibrary {
  if (cache) return cache
  try {
    const raw = readFileSync(libraryFile(), 'utf8')
    const data = JSON.parse(raw) as Partial<MusicLibrary>
    cache = {
      favorites: Array.isArray(data.favorites) ? data.favorites.filter((t) => t?.id) : [],
      recent: Array.isArray(data.recent) ? data.recent.filter((t) => t?.id).slice(0, RECENT_MAX) : []
    }
  } catch {
    // 首次运行 / 文件损坏 → 空库
    cache = { favorites: [], recent: [] }
  }
  return cache
}

function persist(next: MusicLibrary): void {
  cache = next
  try {
    mkdirSync(libraryDir(), { recursive: true })
    const tmp = `${libraryFile()}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(tmp, libraryFile())
  } catch {
    // 写入失败不影响播放：音乐库为非关键数据，下次启动从旧文件恢复
  }
}

export function getLibrary(): MusicLibrary {
  return load()
}

/** 收藏/取消收藏（返回最新数据，renderer 直接同步状态） */
export function toggleFavorite(track: TrackItem): MusicLibrary {
  const lib = load()
  const idx = lib.favorites.findIndex((t) => t.id === track.id)
  if (idx >= 0) lib.favorites.splice(idx, 1)
  else lib.favorites.unshift(stripUrl(track))
  persist(lib)
  return lib
}

/** 记录一次播放（去重置顶，上限 RECENT_MAX） */
export function recordPlay(track: TrackItem): MusicLibrary {
  const lib = load()
  lib.recent = [stripUrl(track), ...lib.recent.filter((t) => t.id !== track.id)].slice(0, RECENT_MAX)
  persist(lib)
  return lib
}
