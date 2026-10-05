/**
 * 音乐源全员联调测试（实际网络调用）
 * 2026-08-30：网易/酷狗/酷我/太合 4 源 → 搜索 → 取播放地址 → 歌词（跨源兜底）
 * 用法：node e2e/diagnostics/music-test.mjs
 */
import { searchMusic, getTrackUrl, getLyric, getPlaylist } from '../../src/main/music/service.ts'

const show = (label, data) => console.log(`\n[${label}]`, data)

const TRACK_KEYWORDS = '晴天 周杰伦'
let needExit = false

// 1. 全源搜索（all = 4 个可搜索源并行 + 交错合并）
const songs = await searchMusic('all', { keywords: TRACK_KEYWORDS, type: 0, curpage: 1 })
const bySource = new Map()
for (const t of songs.result) bySource.set(t.source, (bySource.get(t.source) ?? 0) + 1)
show('全源搜索（all）', { total: songs.total, 各源命中: Object.fromEntries(bySource), 前6: songs.result.slice(0, 6).map((t) => `${t.source}: ${t.title} - ${t.artist}`) })
if (bySource.size < 3) {
  console.log('⚠️ 多源命源不足 3 家，检查单源搜索')
}

// 2. 各单源独立验证：搜索 → 取播放地址（太合对多词命中 0，用单词验证）
const SOURCE_KEYWORDS = { netease: TRACK_KEYWORDS, kugou: TRACK_KEYWORDS, kuwo: TRACK_KEYWORDS, taihe: '稻香' }
for (const source of ['netease', 'kugou', 'kuwo', 'taihe']) {
  const r = await searchMusic(source, { keywords: SOURCE_KEYWORDS[source], type: 0, curpage: 1 })
  const first = r.result[0]
  if (!first) {
    show(`${source} 搜索`, '❌ 空结果')
    needExit = true
    continue
  }
  try {
    const sound = await getTrackUrl(first)
    show(`${source} 全链路`, {
      '✅搜索': `${first.title} - ${first.artist}`,
      '✅播放地址': `${sound.url.slice(0, 80)}…`,
      bitrate: sound.bitrate
    })
  } catch (err) {
    show(`${source} 全链路`, `❌ 取播放地址失败: ${String(err).slice(0, 80)}`)
    needExit = true
  }
}

// 3. 歌词跨源兜底：取一首酷狗的 → 歌词（酷狗不走兜底就取酷狗源；酷我必走兜底）
const tryLyric = async (source) => {
  const r = await searchMusic(source, { keywords: '海阔天空 BEYOND', type: 0, curpage: 1 })
  const t = r.result.find((x) => x.title && x.artist)
  if (!t) return `${source} 搜索空`
  const l = await getLyric(t)
  return `${t.title} → ${l.lyric ? `✅ ${l.lyric.slice(0, 40).replace(/\n/g, ' ')}…` : '（无歌词，返回空）'}`
}
show('歌词链路', await tryLyric('kuwo'))

// 4. 歌单：网易榜单纯接口 + 展开
const pls = await searchMusic('netease', { keywords: '华语经典', type: 1, curpage: 1 })
const pl = pls.result[0]
if (pl) {
  const detail = await getPlaylist(pl.id)
  show('歌单展开', { title: detail.info?.title, 曲目数: detail.tracks?.length, 前3: detail.tracks?.slice(0, 3).map((t) => t.title) })
}

console.log(needExit ? '\n❌ 部分源联调失败（见上）' : '\n✅ 全员联调完成（网易/酷狗/酷我/太合）')
process.exit(needExit ? 1 : 0)
