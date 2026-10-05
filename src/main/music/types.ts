/**
 * 音乐源合同类型（移植自 Listen1 的 provider 数据形状，MIT）
 */

/** 一首歌（多平台统一结构，id 带源前缀如 netrack_/qqtrack_） */
export interface TrackItem {
  id: string
  title: string
  artist: string
  artist_id?: string
  album?: string
  album_id?: string
  /** 源名：netease / qq / kugou / kuwo ... */
  source: string
  source_url?: string
  img_url?: string
  /** 可播放标记（不可播放的曲目为空字符串/undefined） */
  url?: string
  count?: number
  author?: string
  disable?: boolean
}

/** 一个歌单（搜索结果/榜单/推荐） */
export interface PlaylistItem {
  id: string
  title: string
  source?: string
  source_url?: string
  img_url?: string
  cover_img_url?: string
  count?: number
  author?: string
  url?: string
}

/** provider 统一的 { success(fn) } 回调式接口（保留 Listen1 原契约，service 层转 Promise） */
export interface AsyncCall<T> {
  success: (fn: (result: T) => void) => void
}

/** 播放地址结果（bootstrap_track 产出） */
export interface SoundItem {
  url: string
  bitrate: string
  platform: string
}

/** provider 搜索返回 */
export interface SearchResult {
  result: TrackItem[] | PlaylistItem[]
  total?: number
  type?: string
}

/** provider 歌单详情返回 */
export interface PlaylistDetail {
  tracks?: TrackItem[]
  info?: PlaylistItem
  result?: CallbackSearchType[]
}

export interface CallbackSearchType {
  cover_img_url?: string
  id: string
  source_url?: string
  title: string
  img_url?: string
}

/** 歌词返回 */
export interface LyricResult {
  lyric: string
  tlyric?: string
}

/** 搜索参数（service 层对象化，内部拼 url 传给 provider 原接口） */
export interface SearchOptions {
  keywords: string
  /** 0 = 歌曲，1 = 歌单 */
  type: number
  curpage: number
}

/** cookie 条目（chrome cookies API 语义子集） */
export interface CookieItem {
  url: string
  name: string
  value: string
}
