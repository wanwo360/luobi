/**
 * 音乐源调度层（移植自 Listen1 js/loweb.js 的 MediaService 核心，MIT）
 * 差异：Angular/localStorage 剥离；{ success(fn) } → Promise；axios → util.http*；仅注册 netease/qq
 * 支持：多源并行搜索（交错合并）、源级失败自动换源（同歌曲名匹配）
 * 本文件零 electron 依赖 → 可被纯 Node 脚本直接导入联调
 */
import { asyncParallel } from './util.ts'
import type {
  AsyncCall,
  LyricResult,
  PlaylistDetail,
  PlaylistItem,
  SearchOptions,
  SearchResult,
  SoundItem,
  TrackItem
} from './types.ts'
import { PROVIDERS } from './providers/index.ts'
import type { MusicSource, ProviderConfig, ProviderInstance } from './provider-contract.ts'

export type { MusicSource, ProviderConfig, ProviderInstance }
export { PROVIDERS }

function getProviderByName(sourceName: string): ProviderConfig | undefined {
  return PROVIDERS.find((i) => i.name === sourceName)
}

/** 按 id 前缀（netrack_/qqtrack_/kgtrack_ 等）找到源 */
function getProviderByItemId(itemId: string): ProviderConfig | undefined {
  if (/^ne(track|playlist|album|artist)_/.test(itemId)) return getProviderByName('netease')
  if (/^kg(track|playlist|album|artist)_/.test(itemId)) return getProviderByName('kugou')
  if (/^kw(track|playlist|album|artist)_/.test(itemId)) return getProviderByName('kuwo')
  if (/^th(track|playlist|album|artist)_/.test(itemId)) return getProviderByName('taihe')
  if (/^qq(track|playlist|album|artist|toplist)_/.test(itemId)) return getProviderByName('qq')
  return undefined
}

function queryStringify(options: Record<string, string>): string {
  return new URLSearchParams(options).toString()
}

function toPromise<T>(call: AsyncCall<T>): Promise<T> {
  return new Promise((resolve) => call.success(resolve))
}

function searchUrl(options: SearchOptions): string {
  return `/search?${queryStringify({
    keywords: options.keywords,
    curpage: String(options.curpage),
    type: String(options.type)
  })}`
}

export async function searchMusic(
  source: MusicSource,
  options: SearchOptions
): Promise<SearchResult> {
  if (source === 'all') {
    // 先在全部可搜索源并行搜索，再按平台轮流交错合并（原 Listen1 交互方式）
    const callbackArray = PROVIDERS.filter((p) => p.searchable).map((p) => (cb: (err: unknown, result?: SearchResult) => void) => {
      toPromise(p.instance.search(searchUrl(options))).then((r) => cb(null, r))
    })
    const platformResultArray = await new Promise<SearchResult[]>((resolve, reject) => {
      asyncParallel(callbackArray, (err, results) => {
        if (err) return reject(err)
        resolve(results.filter(Boolean))
      })
    })
    const result: (TrackItem | PlaylistItem)[] = []
    const maxLength = Math.max(...platformResultArray.map((elem) => elem.result.length))
    for (let i = 0; i < maxLength; i += 1) {
      platformResultArray.forEach((elem) => {
        if (i < elem.result.length) {
          result.push(elem.result[i])
        }
      })
    }
    return { result, total: 1000, type: String(options.type) }
  }
  const provider = getProviderByName(source)
  if (!provider) return { result: [], total: 0, type: String(options.type) }
  return toPromise(provider.instance.search(searchUrl(options)))
}

/** 分类歌单/榜单（netease 榜单 JSON 版；qq 分类列表 + 排行榜） */
export async function showPlaylist(source: string, offset: number, filterId: string): Promise<SearchResult> {
  if (source === 'netease') {
    const ne = getProviderByName('netease')?.instance as any
    if (ne?.ne_show_toplist) return toPromise(ne.ne_show_toplist(offset))
    return { result: [], total: 0 }
  }
  const provider = getProviderByName(source)
  if (!provider) return { result: [], total: 0 }
  const url = `/show_playlist?${queryStringify({ offset: String(offset), filter_id: filterId })}`
  return toPromise((provider.instance as any).show_playlist(url))
}

export async function getPlaylist(listId: string): Promise<PlaylistDetail> {
  const provider = getProviderByItemId(listId)
  if (!provider) return { tracks: [], info: undefined }
  const url = `/playlist?list_id=${listId}`
  return toPromise((provider.instance as any).get_playlist(url))
}

function bootstrapToPromise(provider: ProviderConfig, track: TrackItem): Promise<SoundItem> {
  return new Promise<SoundItem>((resolve, reject) => {
    provider.instance.bootstrap_track(track, (s) => resolve(s), () => reject(new Error('no_play_url')))
  })
}

/** 码率数字提取：'320kbps' → 320；无法识别 → 0 */
function bitrateOf(s: SoundItem): number {
  const m = /(\d+)/.exec(String(s.bitrate ?? ''))
  return m ? Number(m[1]) : 0
}

/** 歌手名归一化：各平台尾部标差异（尾标/下划线等）→ 匹配用 */
function normArtist(a: string): string {
  return String(a ?? '')
    .trim()
    .toLowerCase()
    .replace(/[-–—·丶._\s]+$/g, '')
}

/** 标题归一化：去掉尾部括号注释（"(Live)"/"(Cover)"/"【完整版】"等版本后缀）→ 同曲不同版本可互认 */
function normTitle(t: string): string {
  return String(t ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s*[\[（(][^\]）)]*[\]）)]\s*$/g, '')
}

function sameTrack(candidate: TrackItem, track: TrackItem): boolean {
  return !candidate.disable && normTitle(candidate.title) === normTitle(track.title) && normArtist(candidate.artist) === normArtist(track.artist)
}

/** 在某源搜索同曲（标题/歌手归一匹配；关键词分句变体提升命中率） */
async function searchSameTrack(name: MusicSource, track: TrackItem): Promise<TrackItem | undefined> {
  const variants = [
    `${track.title} ${track.artist}`,
    `${track.artist} ${track.title}`,
    track.title
  ]
  for (const kw of variants) {
    try {
      const found = await searchMusic(name, { keywords: kw, type: 0, curpage: 1 })
      const same = found.result.find((t) => sameTrack(t as TrackItem, track)) as TrackItem | undefined
      if (same) return same
    } catch {
      /* 下一个变体 */
    }
  }
  return undefined
}

/**
 * 音质升级：当前源只给低码率（<200k，试听流 128k）时，尝试取同曲更高码率版本
 */
async function tryUpgradeToNetease(track: TrackItem): Promise<SoundItem | null> {
  const ne = getProviderByName('netease')
  if (!ne) return null
  try {
    const same = await searchSameTrack('netease', track)
    if (!same) return null
    const s = await bootstrapToPromise(ne, same)
    return s?.url && bitrateOf(s) >= 300 ? s : null
  } catch {
    return null
  }
}

/**
 * 换源：按注册顺序逐源搜索同曲并取播放地址
 * 背景：部分源只返回 10s 级试听片段（无全曲通道）——
 *       片段源播放即「沙哑断续」体验，必须换源到全曲
 */
async function tryFallbackSources(track: TrackItem): Promise<SoundItem | null> {
  for (const name of ['netease', 'kugou', 'kuwo', 'taihe'] as MusicSource[]) {
    if (name === track.source) continue
    try {
      const same = await searchSameTrack(name, track)
      if (!same) continue
      const s = await bootstrapToPromise(getProviderByName(name)!, same)
      if (s?.url) return s
    } catch {
      /* 尝试下一个源 */
    }
  }
  return null
}

/**
 * 取播放地址：当前源优先；低码率（128k 试听流）先尝试升级到更高码率；
 * 试听片段源升级失败 → 逐源换全曲，绝不让碎片进耳朵；
 * 全部失败才抛错（renderer 静默处理）
 */
export async function getTrackUrl(track: TrackItem): Promise<SoundItem> {
  const current = getProviderByName(track.source)
  if (current) {
    try {
      const s = await bootstrapToPromise(current, track)
      if (s?.url) {
        const br = bitrateOf(s)
        const isClipSource = track.source === 'kuwo' // anti.svc 片段源
        if (br > 0 && br < 200 && track.source !== 'netease') {
          const hq = await tryUpgradeToNetease(track)
          if (hq) return hq
        }
        if (isClipSource && br < 200) {
          const full = await tryFallbackSources(track)
          if (full) return full
          throw new Error('该曲目暂无真源可用于播放')
        }
        return s
      }
    } catch {
      /* 当前源无播放地址 → 走换源 */
    }
  }
  const full = await tryFallbackSources(track)
  if (full) return full
  throw new Error('该曲目暂无真源可用于播放')
}

/**
 * 歌词：当前源优先；为空/失败时跨源兜底（按同名搜索取歌词）
 * 背景：各源歌词接口稳定性不一 → 优先取最可靠的一路
 */
export async function getLyric(track: TrackItem): Promise<LyricResult> {
  if (track?.id) {
    const provider = getProviderByItemId(track.id)
    if (provider) {
      try {
        const url = `/lyric?${queryStringify({ track_id: track.id, album_id: '', lyric_url: '', tlyric_url: '' })}`
        const r = await toPromise<LyricResult>((provider.instance as any).lyric(url))
        if (r?.lyric) return r
      } catch {
        /* 当前源歌词失败 → 走兜底 */
      }
    }
  }
  try {
    const found = await searchMusic('netease', { keywords: `${track.title} ${track.artist}`, type: 0, curpage: 1 })
    const same = found.result.find((t) => sameTrack(t as TrackItem, track)) as TrackItem | undefined
    if (same) {
      const ne = getProviderByName('netease')?.instance as any
      if (ne) {
        const r = await toPromise<LyricResult>(ne.lyric(`/lyric?track_id=${same.id}&album_id=&lyric_url=&tlyric_url=`))
        if (r?.lyric) return r
      }
    }
  } catch {
    /* 兜底失败：无声返回 */
  }
  return { lyric: '', tlyric: '' }
}
