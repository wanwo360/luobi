/**
 * 音乐源契约 —— 本项目【不内置】任何第三方音乐源实现
 *
 * 想启用音乐播放：按下面的 ProviderInstance 契约写一个你自己的 provider，
 * 放进 src/main/music/providers/ 并在 providers/index.ts 里登记。
 * 完整步骤见 src/main/music/providers/README.md。
 */
import type { AsyncCall, LyricResult, PlaylistDetail, SearchResult, SoundItem, TrackItem } from './types.ts'

/** 源名：由音乐源实现自定义（用于 id 前缀匹配与 UI 展示） */
export type MusicSource = string

/** provider 实例契约（与 Listen1 各源类的公开方法一致，MIT） */
export interface ProviderInstance {
  search: (url: string) => AsyncCall<SearchResult>
  show_playlist?: (url: string) => AsyncCall<SearchResult>
  get_playlist?: (url: string) => AsyncCall<PlaylistDetail> | null
  bootstrap_track: (track: TrackItem, success: (s: SoundItem) => void, failure: (s: SoundItem) => void) => void
  lyric: (url: string) => AsyncCall<LyricResult>
}

/** 注册表条目 */
export interface ProviderConfig {
  name: string
  instance: ProviderInstance
  /** 是否参与关键字搜索（播放地址接口可用的源也可能不参与搜索） */
  searchable: boolean
}
