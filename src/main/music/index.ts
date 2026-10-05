/**
 * music IPC 域：音乐源调度（移植自 Listen1，MIT）
 *
 * 本项目【不内置】任何第三方音乐源实现 —— 见 providers/README.md。
 * 未安装音乐源时 PROVIDERS 为空：搜索类接口返回空结果，UI 据此显示空状态。
 */
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { searchMusic, showPlaylist, getPlaylist, getTrackUrl, getLyric } from './service.ts'
import { getLibrary, toggleFavorite, recordPlay } from './library.ts'
import { PROVIDERS } from './providers/index.ts'
import type { TrackItem } from './types.ts'
import { toAppError } from '../modules/shared/fs-utils.ts'

export function registerMusicIpc(): void {
  /** 已安装的音乐源名（空数组 = 未安装任何音乐源） */
  ipcMain.handle(IPC.music.sources, () => PROVIDERS.map((p) => p.name))

  ipcMain.handle(IPC.music.getLibrary, () => {
    try {
      return getLibrary()
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.music.toggleFavorite, (_e, track: TrackItem) => {
    try {
      return toggleFavorite(track)
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.music.recordPlay, (_e, track: TrackItem) => {
    try {
      return recordPlay(track)
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(
    IPC.music.search,
    async (_e, keywords: string, opts?: { source?: string; type?: number; curpage?: number }) => {
      try {
        return await searchMusic(String(opts?.source ?? 'all'), {
          keywords: String(keywords ?? ''),
          type: opts?.type ?? 0,
          curpage: opts?.curpage ?? 1
        })
      } catch (err) {
        throw toAppError(err)
      }
    }
  )

  ipcMain.handle(IPC.music.getPlaylist, async (_e, listId: string) => {
    try {
      return await getPlaylist(String(listId ?? ''))
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.music.showPlaylists, async (_e, source: string, offset: number, filterId: string) => {
    try {
      return await showPlaylist(String(source ?? ''), Number(offset) || 0, String(filterId ?? ''))
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.music.getTrackUrl, async (_e, track: TrackItem) => {
    try {
      return await getTrackUrl(track)
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.music.lyric, async (_e, track: TrackItem) => {
    try {
      return await getLyric(track ?? ({} as TrackItem))
    } catch (err) {
      throw toAppError(err)
    }
  })
}
