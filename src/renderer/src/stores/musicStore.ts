import { create } from 'zustand'

/** 音乐面板状态：搜索 → 队列 → 播放（audio 元素由 MusicPane 创建并回注，action 直接驱动） */

export interface MusicTrack {
  id: string
  title: string
  artist: string
  album?: string
  img_url?: string
  source: string
  url?: string
}

/** 发现页榜单卡片 */
export interface DiscoverCard {
  id: string
  title: string
  cover?: string
  count?: number
  source: string
}

export type MusicView = 'search' | 'discover' | 'mylib'

interface MusicState {
  tracks: MusicTrack[]
  currentIndex: number
  playing: boolean
  position: number
  duration: number
  loadingSearch: boolean
  loadingUrl: boolean
  searchError: string | null
  playError: string | null
  lyric: string
  showLyric: boolean
  /** 全屏大歌词页（参照手机播放器歌词页：当前句居中放大高亮） */
  fullLyric: boolean
  audioEl: HTMLAudioElement | null
  /** 当前播放 URL（重试切换通道用） */
  currentUrl: string | null
  /** 当前音质角标（如 320K / 128K / FLAC） */
  currentBitrate: string
  /** 页签视图 */
  view: MusicView
  /** 我的收藏（~/.luobi/music-library.json） */
  favorites: MusicTrack[]
  /** 最近播放（去重置顶，上限 50） */
  recent: MusicTrack[]
  /** 发现页：榜单卡片与当前打开的榜单 */
  discoverCards: DiscoverCard[]
  discoverLoading: boolean
  discoverError: string | null
  /** 榜单加载成功时间戳（每日自动刷新判定 + 更新时间显示） */
  discoverLoadedAt: number
  playlistTitle: string | null
  /** 搜索翻页状态（搜索词/源/当前页/是否还有更多） */
  searchKeyword: string
  searchSource: string
  searchPage: number
  searchTotal: number
  canLoadMore: boolean
  /** 播放模式：list=列表循环 / one=单曲循环 / shuffle=随机 */
  mode: 'list' | 'one' | 'shuffle'
  /** 音量 0..1（持久化在内存，会话内有效） */
  volume: number

  setView: (v: MusicView) => void
  setAudio: (el: HTMLAudioElement | null) => void
  /** 全局音频单例：首次创建并绑定全部事件（幂等）——不随面板开关而销毁 */
  ensureAudio: () => void
  search: (keywords: string, source: string) => Promise<void>
  loadMore: () => Promise<void>
  loadLibrary: () => Promise<void>
  toggleFavorite: (track: MusicTrack) => Promise<void>
  toggleFavoriteAt: (index: number) => Promise<void>
  recordPlay: (track: MusicTrack) => Promise<void>
  /** force=true 强制重拉（跨天刷新用）；默认 20 小时内缓存有效 */
  loadDiscover: (force?: boolean) => Promise<void>
  openPlaylist: (card: DiscoverCard) => Promise<void>
  closePlaylist: () => void
  playCollection: (list: MusicTrack[], index: number) => Promise<void>
  playAt: (index: number) => Promise<void>
  retryWithProxy: () => void
  togglePlay: () => void
  next: () => Promise<void>
  prev: () => Promise<void>
  handleEnded: () => void
  setMode: (m: 'list' | 'one' | 'shuffle') => void
  setVolume: (v: number) => void
  seek: (t: number) => void
  syncProgress: (position: number, duration: number) => void
  setPlaying: (p: boolean) => void
  loadLyric: (index: number) => Promise<void>
  toggleLyric: () => void
  toggleFullLyric: () => void
}

/** 封面能直连的走 CDN，其余走 music:// 代理（主进程转发 + 防盗链头） */
function directPlayableUrl(u: string): boolean {
  return /^https?:\/\/([\w-]+\.)*music\.126\.net\//i.test(u)
}

const trackFromAny = (t: any): MusicTrack => ({
  id: t.id,
  title: t.title ?? '',
  artist: t.artist ?? '',
  album: t.album,
  img_url: t.img_url,
  source: t.source,
  url: t.url
})

export const useMusicStore = create<MusicState>((set, get) => ({
  tracks: [],
  currentIndex: -1,
  playing: false,
  position: 0,
  duration: 0,
  loadingSearch: false,
  loadingUrl: false,
  searchError: null,
  playError: null,
  lyric: '',
  showLyric: false,
  fullLyric: false,
  audioEl: null,
  currentUrl: null,
  currentBitrate: '',
  view: 'search',
  favorites: [],
  recent: [],
  discoverCards: [],
  discoverLoading: false,
  discoverError: null,
  discoverLoadedAt: 0,
  playlistTitle: null,
  searchKeyword: '',
  searchSource: 'all',
  searchPage: 1,
  searchTotal: 0,
  canLoadMore: false,
  mode: 'list',
  volume: 0.8,

  setView: (v) => set({ view: v }),

  setAudio: (el) => {
    if (el) el.volume = get().volume
    set({ audioEl: el })
  },

  /**
   * 音频单例提升：audio 元素挂在 store 上（而非 MusicPane 生命周期）。
   * 之前实现放 MusicPane effect 内清理，切面板即卸载 → el.pause()+src='' → 无法再播放；
   * 现在首次创建一次常驻，切到写大纲/聊天/资料时音乐继续（MiniPlayer 仍可控）
   */
  ensureAudio: () => {
    const { audioEl } = get()
    if (audioEl) return
    const el = new Audio()
    el.preload = 'auto'
    el.volume = get().volume
    el.onplay = () => get().setPlaying(true)
    el.onpause = () => get().setPlaying(false)
    el.onended = () => get().handleEnded()
    el.ontimeupdate = () => get().syncProgress(el.currentTime, el.duration)
    el.onloadedmetadata = () => get().syncProgress(0, get().duration)
    el.onerror = () => {
      // 直连失败（链接过期/被 CSP/CDN 拒）→ 静默切 music:// 代理通道重试一次；
      // 通道也失败则放弃（不打断用户，仅留控制台日志）
      get().setPlaying(false)
      const st = useMusicStore.getState()
      const curSrc = st.audioEl?.src ?? ''
      if (curSrc && !curSrc.startsWith('music://')) {
        st.retryWithProxy()
      } else {
        console.warn('[music] 播放失败（切换通道后仍不可用）:', curSrc)
      }
    }
    get().setAudio(el)
  },

  search: async (keywords, source) => {
    if (!keywords.trim()) return
    set({ loadingSearch: true, searchError: null })
    try {
      const r: any = await window.luobi.music.search(keywords.trim(), { source, type: 0, curpage: 1 })
      const tracks = (r?.result ?? []).filter((t: any) => t && t.id && t.title).map(trackFromAny)
      const total = Number(r?.total) || 0
      set({
        tracks,
        currentIndex: -1,
        playError: null,
        searchKeyword: keywords.trim(),
        searchSource: source,
        searchPage: 1,
        searchTotal: total,
        canLoadMore: tracks.length < total
      })
    } catch (err: any) {
      set({ searchError: err?.message ?? String(err) })
    } finally {
      set({ loadingSearch: false })
    }
  },

  /** 搜索翻页：加载下一页并追加到队列（按 id 去重） */
  loadMore: async () => {
    const { searchKeyword, searchSource, searchPage, canLoadMore, loadingSearch } = get()
    if (!searchKeyword || !canLoadMore || loadingSearch) return
    set({ loadingSearch: true })
    try {
      const r: any = await window.luobi.music.search(searchKeyword, { source: searchSource, type: 0, curpage: searchPage + 1 })
      const known = new Set(get().tracks.map((t) => t.id))
      const more = ((r?.result ?? []) as any[]).filter((t) => t && t.id && t.title && !known.has(t.id)).map(trackFromAny)
      const merged = [...get().tracks, ...more]
      set({ tracks: merged, searchPage: searchPage + 1, canLoadMore: merged.length < get().searchTotal })
    } catch {
      /* 翻页失败保持现状 */
    } finally {
      set({ loadingSearch: false })
    }
  },

  /** 加载我的收藏 + 最近播放（面板挂载时调用一次） */
  loadLibrary: async () => {
    try {
      const lib: any = await window.luobi.music.getLibrary()
      set({
        favorites: (lib?.favorites ?? []).map(trackFromAny),
        recent: (lib?.recent ?? []).map(trackFromAny)
      })
    } catch {
      /* 读失败保持空 */
    }
  },

  toggleFavorite: async (track) => {
    try {
      const lib: any = await window.luobi.music.toggleFavorite(track)
      set({
        favorites: (lib?.favorites ?? []).map(trackFromAny),
        recent: (lib?.recent ?? []).map(trackFromAny)
      })
    } catch {
      /* 收藏失败静默（非关键操作） */
    }
  },

  recordPlay: async (track) => {
    try {
      const lib: any = await window.luobi.music.recordPlay(track)
      set({ recent: (lib?.recent ?? []).map(trackFromAny) })
    } catch {
      /* 记录失败静默 */
    }
  },

  /** 当前队列第 index 首收藏/取消 */
  toggleFavoriteAt: async (index) => {
    const track = get().tracks[index]
    if (track) await get().toggleFavorite(track)
  },

  /** 发现页：拉取榜单卡片（20 小时内缓存有效；force 强制重拉用于每日刷新） */
  loadDiscover: async (force) => {
    const { discoverCards, discoverLoading, discoverLoadedAt } = get()
    if (!force && discoverLoading) return
    if (!force && discoverCards.length && Date.now() - discoverLoadedAt < 20 * 3600 * 1000) return
    set({ discoverLoading: true, discoverError: null })
    try {
      const r: any = await window.luobi.music.showPlaylists('netease', 0, '')
      const cards: DiscoverCard[] = (r?.result ?? [])
        .filter((p: any) => p && p.id && p.title)
        .map((p: any) => ({
          id: p.id,
          title: p.title,
          cover: p.cover_img_url ?? p.img_url,
          count: p.count,
          source: p.source ?? 'netease'
        }))
      set({ discoverCards: cards, discoverLoadedAt: Date.now() })
    } catch (err: any) {
      set({ discoverError: err?.message ?? String(err) })
    } finally {
      set({ discoverLoading: false })
    }
  },

  /** 打开榜单 → 整榜曲目成为当前队列 */
  openPlaylist: async (card) => {
    set({ discoverLoading: true, playlistTitle: card.title, playError: null })
    try {
      const d: any = await window.luobi.music.getPlaylist(card.id)
      const tracks = ((d?.tracks ?? []) as any[]).filter((t: any) => t && t.id && t.title).map(trackFromAny)
      set({ tracks, currentIndex: -1, canLoadMore: false })
    } catch (err: any) {
      set({ discoverError: err?.message ?? String(err), playlistTitle: null })
    } finally {
      set({ discoverLoading: false })
    }
  },

  /** 关闭榜单详情 → 回到发现网格 */
  closePlaylist: () => set({ playlistTitle: null }),

  /** 以任意列表为队列播放（收藏/最近点播用；index 相对于 list） */
  playCollection: async (list, index) => {
    if (!list[index]) return
    set({ tracks: list, currentIndex: -1, playError: null, canLoadMore: false })
    await get().playAt(index)
  },

  playAt: async (index) => {
    const { tracks, audioEl } = get()
    const track = tracks[index]
    if (!track || !audioEl) return
    set({ currentIndex: index, loadingUrl: true, playError: null })
    try {
      // 先换源取播放地址（含主进程自动换源），经自定义协议 music:// 流式代理播放
      // （直连 http 会被 CSP media-src 'self' 拦截，主进程代理同时支持 Range seek）
      const sound: any = await window.luobi.music.getTrackUrl(track)
      // 部分源封面可直连；音频统一走 music:// 代理（带防盗链 Referer + Range）
      set({ currentUrl: sound.url, currentBitrate: sound.bitrate ? String(sound.bitrate).replace(/kbps$/i, 'K') : '' })
      audioEl.src = directPlayableUrl(sound.url) ? sound.url : `music://play?u=${encodeURIComponent(sound.url)}`
      audioEl.currentTime = 0
      await audioEl.play()
      set({ playing: true, loadingUrl: false })
      void get().recordPlay(track)
      void get().loadLyric(index)
    } catch (err: any) {
      set({ loadingUrl: false, playing: false, playError: err?.message ?? '该曲目暂无可用播放源' })
    }
  },

  /** 直连失败后切换 music:// 主进程代理通道重试（仅一次） */
  retryWithProxy: () => {
    const { audioEl, currentUrl } = get()
    if (!audioEl || !currentUrl) return
    audioEl.src = `music://play?u=${encodeURIComponent(currentUrl)}`
    void audioEl.play()
  },

  togglePlay: () => {
    const { audioEl, playing } = get()
    if (!audioEl || !audioEl.src) return
    if (playing) audioEl.pause()
    else void audioEl.play()
  },

  next: async () => {
    const { tracks, currentIndex, mode } = get()
    if (!tracks.length) return
    // 随机模式下 ⏭ 也随机（避免手动切歌变"顺序")
    if (mode === 'shuffle' && tracks.length > 1) {
      let idx = Math.floor(Math.random() * tracks.length)
      if (idx === currentIndex) idx = (idx + 1) % tracks.length
      await get().playAt(idx)
      return
    }
    await get().playAt(currentIndex + 1 >= tracks.length ? 0 : currentIndex + 1)
  },

  prev: async () => {
    const { tracks, currentIndex } = get()
    if (!tracks.length) return
    await get().playAt(currentIndex - 1 < 0 ? tracks.length - 1 : currentIndex - 1)
  },

  /** 播放结束：按模式分流（单曲重播 / 随机下一首 / 列表循环下一首） */
  handleEnded: () => {
    const { mode, tracks, currentIndex, audioEl } = get()
    if (mode === 'one' && audioEl) {
      audioEl.currentTime = 0
      void audioEl.play()
      return
    }
    if (mode === 'shuffle' && tracks.length > 1) {
      let idx = Math.floor(Math.random() * tracks.length)
      if (idx === currentIndex) idx = (idx + 1) % tracks.length
      void get().playAt(idx)
      return
    }
    void get().playAt(currentIndex + 1 >= tracks.length ? 0 : currentIndex + 1)
  },

  setMode: (m) => set({ mode: m }),

  /** 音量：同步 audio 元素 */
  setVolume: (v) => {
    const clamped = Math.min(Math.max(Number(v) || 0, 0), 1)
    const { audioEl } = get()
    if (audioEl) audioEl.volume = clamped
    set({ volume: clamped })
  },

  seek: (t) => {
    const { audioEl } = get()
    if (audioEl) audioEl.currentTime = t
  },

  syncProgress: (position, duration) => set({ position, duration }),

  setPlaying: (p) => set({ playing: p, loadingUrl: false }),

  loadLyric: async (index) => {
    const track = get().tracks[index]
    if (!track) return
    try {
      // 主进程内做跨源歌词兜底（当前源为空 → 按同名取词）
      const r: any = await window.luobi.music.lyric(track)
      set({ lyric: r?.lyric ?? '' })
    } catch {
      set({ lyric: '' })
    }
  },

  toggleLyric: () => set({ showLyric: !get().showLyric }),

  toggleFullLyric: () => set({ fullLyric: !get().fullLyric })
}))
