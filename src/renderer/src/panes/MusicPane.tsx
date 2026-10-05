import React, { useEffect, useMemo, useState } from 'react'
import { useMusicStore } from '../stores/musicStore'
import type { MusicTrack, MusicView } from '../stores/musicStore'

/**
 * 源下拉框选项：固定「全部」+ 已安装的音乐源（由主进程注册表提供）。
 * 本项目不内置任何第三方音乐源实现；未安装时面板显示空状态，此处不会被渲染。
 */
function buildSourceOptions(installed: string[]): [string, string][] {
  return [['all', '全部'], ...installed.map((n) => [n, SOURCE_LABELS[n] ?? n] as [string, string])]
}

/** 源名 → 显示名（曲目行标签） */
const SOURCE_LABELS: Record<string, string> = {
  netease: '网易',
  kugou: '酷狗',
  kuwo: '酷我',
  taihe: '太合',
  qq: 'QQ'
}

const TABS: { value: MusicView; label: string }[] = [
  { value: 'search', label: '🔍 搜索' },
  { value: 'discover', label: '🧭 发现' },
  { value: 'mylib', label: '📚 我的' }
]

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 更新时间显示：今日 HH:mm / 昨日 HH:mm / M月D日 HH:mm */
function fmtUpdateTime(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `今日 ${hm}`
  if (d.toDateString() === new Date(now.getTime() - 86400000).toDateString()) return `昨日 ${hm}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
}

/** 通用曲目行列表：队列 / 榜单详情 / 我的收藏 / 最近播放 共用 */
interface TrackListProps {
  tracks: MusicTrack[]
  currentIndex: number
  playing: boolean
  favSet: Set<string>
  onPlay: (index: number) => void
  onFavToggle?: (index: number) => void
  emptyHint?: string
}

function TrackList(props: TrackListProps): React.JSX.Element {
  const { tracks, currentIndex, playing, favSet, onPlay, onFavToggle, emptyHint } = props
  if (tracks.length === 0 && emptyHint) {
    return <div className="empty-hint" style={{ padding: 12 }}>{emptyHint}</div>
  }
  return (
    <div className="filetree" style={{ flex: 1, overflowY: 'auto', padding: '4px 6px' }}>
      {tracks.map((t, i) => {
        const fav = favSet.has(t.id)
        return (
          <div
            key={t.id}
            className={`filetree-item${i === currentIndex ? ' filetree-item--active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
            onClick={() => onPlay(i)}
          >
            <span style={{ width: 14, textAlign: 'center', fontSize: 11, flex: 'none' }}>
              {i === currentIndex ? (playing ? '▶' : '⏸') : '♪'}
            </span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.title}
            </span>
            <span style={{ fontSize: 11, color: 'var(--nf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>
              {t.artist}
            </span>
            <span className="kind" style={{ flex: 'none' }}>
              {SOURCE_LABELS[t.source] ?? t.source}
            </span>
            {onFavToggle && (
              <button
                className="nf-btn nf-btn--small"
                style={{
                  flex: 'none',
                  padding: '2px 5px',
                  fontSize: 12,
                  lineHeight: 1,
                  border: 'none',
                  background: fav ? 'var(--nf-accent-soft)' : 'transparent',
                  color: fav ? 'var(--nf-accent)' : 'var(--nf-muted)'
                }}
                title={fav ? '取消收藏' : '加入收藏'}
                onClick={(e) => {
                  e.stopPropagation()
                  onFavToggle(i)
                }}
              >
                {fav ? '♥' : '♡'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** 🎵 音乐面板：搜索 / 发现（榜单）/ 我的（收藏+最近播放），底部播放条 */
export function MusicPane(): React.JSX.Element {
  const {
    view,
    setView,
    tracks,
    currentIndex,
    playing,
    position,
    duration,
    loadingSearch,
    loadingUrl,
    searchError,
    currentBitrate,
    favorites,
    recent,
    discoverCards,
    discoverLoading,
    discoverError,
    discoverLoadedAt,
    playlistTitle,
    search,
    playAt,
    playCollection,
    toggleFavorite,
    toggleFavoriteAt,
    closePlaylist,
    loadMore,
    canLoadMore,
    loadLibrary,
    loadDiscover,
    openPlaylist,
    togglePlay,
    next,
    prev,
    seek,
    toggleFullLyric,
    mode,
    setMode,
    volume,
    setVolume
  } = useMusicStore()
  const [kw, setKw] = useState('')
  const [source, setSource] = useState('all')
  /** 已安装的音乐源名（来自主进程注册表）；空 = 未安装 → 显示空状态 */
  const [sources, setSources] = useState<string[] | null>(null)

  // 读取已安装的音乐源：本项目不内置任何第三方音乐源实现（见 src/main/music/providers/README.md）
  useEffect(() => {
    void window.luobi.music.sources().then((list: string[]) => setSources(Array.isArray(list) ? list : []))
  }, [])

  // 音频单例由 store 保证（不随本面板卸载销毁 → 切换面板音乐继续）；挂载时确保创建
  useEffect(() => {
    useMusicStore.getState().ensureAudio()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 挂载时加载收藏/最近播放
  useEffect(() => {
    void loadLibrary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 进入发现页时加载榜单（20h 内缓存有效）；挂机跨天则 30 分钟一次检查自动重拉
  useEffect(() => {
    if (view !== 'discover') return
    void loadDiscover()
    const timer = setInterval(() => {
      const st = useMusicStore.getState()
      if (st.discoverCards.length && st.discoverLoadedAt && new Date(st.discoverLoadedAt).toDateString() !== new Date().toDateString()) {
        void st.loadDiscover(true)
      }
    }, 30 * 60 * 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  // 搜索/发现错误提示自动消失（平台频控/接口波动不必常驻扰人，6 秒后静默）
  useEffect(() => {
    if (!searchError && !discoverError) return
    const t = setTimeout(() => {
      const st = useMusicStore.getState()
      if (st.searchError) useMusicStore.setState({ searchError: null })
      if (st.discoverError) useMusicStore.setState({ discoverError: null })
    }, 6000)
    return () => clearTimeout(t)
  }, [searchError, discoverError])

  const favSet = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites])
  const current = tracks[currentIndex] ?? null

  const doSearch = (): void => {
    void search(kw, source)
  }

  const tabs = (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--nf-line)', flex: 'none' }}>
      {TABS.map((t) => (
        <button
          key={t.value}
          className="nf-btn nf-btn--small"
          style={{
            flex: 1,
            borderRadius: 0,
            border: 'none',
            borderBottom: view === t.value ? '2px solid var(--nf-accent)' : '2px solid transparent',
            background: 'var(--nf-bg)',
            color: view === t.value ? 'var(--nf-accent)' : 'var(--nf-muted)',
            fontWeight: view === t.value ? 600 : 400
          }}
          onClick={() => setView(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )

  const errorBanners = (
    <>
      {searchError && (
        <div className="selfcheck-issue selfcheck-issue--error" style={{ margin: 8, fontSize: 12 }}>
          ❌ {searchError}
        </div>
      )}
    </>
  )

  // 本项目不内置任何第三方音乐源实现：未安装时显示空状态
  if (sources === null) {
    return (
      <div className="empty-hint" style={{ padding: 16, fontSize: 12 }}>
        正在检查音乐源…
      </div>
    )
  }
  if (sources.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <div className="panel-header">
          <span>🎵 音乐</span>
        </div>
        <div className="empty-hint" style={{ padding: '18px 14px', fontSize: 12, lineHeight: 1.9 }}>
          <div style={{ marginBottom: 6 }}>未安装音乐源</div>
          <div style={{ opacity: 0.75 }}>
            本项目不内置第三方音乐服务实现。想启用音乐播放，请按
            <code style={{ margin: '0 3px' }}>src/main/music/providers/README.md</code>
            接入你自己的音乐源，并在 <code>providers/index.ts</code> 中登记。
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}>
      <div className="panel-header">
        <span>🎵 音乐</span>
      </div>
      {tabs}
      {errorBanners}

      {/* ===== 搜索 ===== */}
      {view === 'search' && (
        <>
          <div style={{ padding: '8px 10px', display: 'flex', gap: 6, borderBottom: '1px solid var(--nf-line)', flex: 'none' }}>
            <input
              className="nf-input"
              style={{ flex: 1, padding: '5px 8px', fontSize: 12 }}
              placeholder="搜索歌曲（如 晴天 周杰伦）…"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            />
            <select
              className="nf-input"
              style={{ width: 66, padding: '5px 4px', fontSize: 12 }}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              title="曲库源"
            >
              {buildSourceOptions(sources ?? []).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <button className="nf-btn nf-btn--small nf-btn--primary" onClick={doSearch} disabled={loadingSearch || !kw.trim()}>
              {loadingSearch ? '…' : '搜索'}
            </button>
          </div>
          <TrackList
            tracks={tracks}
            currentIndex={currentIndex}
            playing={playing}
            favSet={favSet}
            onPlay={(i) => void playAt(i)}
            onFavToggle={(i) => void toggleFavoriteAt(i)}
            emptyHint={
              loadingSearch
                ? '搜索中…'
                : '搜点什么吧——写小说时可以放首歌\n小提示：点「播放」就把整份结果当作队列，点 ♡ 收藏'
            }
          />
          {tracks.length > 0 && (
            <div style={{ flex: 'none', padding: '6px 10px', borderTop: '1px solid var(--nf-line)' }}>
              <button
                className="nf-btn nf-btn--small"
                style={{ width: '100%' }}
                onClick={() => void loadMore()}
                disabled={loadingSearch || !canLoadMore}
              >
                {loadingSearch ? '…' : canLoadMore ? '加载更多…' : `已加载全部（${tracks.length} 首）`}
              </button>
            </div>
          )}
        </>
      )}

      {/* ===== 发现 ===== */}
      {view === 'discover' &&
        (playlistTitle ? (
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--nf-line)', flex: 'none' }}>
              <button className="nf-btn nf-btn--small" onClick={closePlaylist}>
                ← 榜单
              </button>
              <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {playlistTitle}
              </span>
              <span className="kind" style={{ flex: 'none' }}>
                点击即播
              </span>
            </div>
            {discoverLoading ? (
              <div className="empty-hint" style={{ padding: 12 }}>
                加载曲目…
              </div>
            ) : (
              <TrackList
                tracks={tracks}
                currentIndex={currentIndex}
                playing={playing}
                favSet={favSet}
                onPlay={(i) => void playAt(i)}
                onFavToggle={(i) => void toggleFavoriteAt(i)}
              />
            )}
          </div>
        ) : (
          <div className="filetree" style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {discoverError && (
              <div className="selfcheck-issue selfcheck-issue--error" style={{ margin: 8, fontSize: 12 }}>
                ❌ {discoverError}
              </div>
            )}
            {discoverLoading && !discoverCards.length && (
              <div className="empty-hint" style={{ padding: 12 }}>
                加载榜单…
              </div>
            )}
            {discoverCards.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', fontSize: 10, color: 'var(--nf-muted)', padding: '0 4px 6px' }}>
                <span style={{ flex: 1 }}>网易云榜单（每日自动更新）</span>
                <span title="榜单卡片每日跨天自动重拉；点击榜单时曲目实时取最新">
                  🕘 更新于 {fmtUpdateTime(discoverLoadedAt)}
                </span>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {discoverCards.map((c) => (
                <button
                  key={c.id}
                  className="nf-btn nf-btn--small"
                  style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 6, borderRadius: 10, textAlign: 'left' }}
                  title={c.title}
                  onClick={() => void openPlaylist(c)}
                >
                  <img
                    src={c.cover ?? ''}
                    alt=""
                    style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flex: 'none', background: 'var(--nf-bg-3)' }}
                    onError={(e) => {
                      ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'normal', lineHeight: 1.4 }}>
                    {c.title}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}

      {/* ===== 我的 ===== */}
      {view === 'mylib' && (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
          <div style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600, color: 'var(--nf-muted)', flex: 'none' }}>
            ♥ 我的收藏（{favorites.length}）
          </div>
          <TrackList
            tracks={favorites}
            currentIndex={currentIndex}
            playing={playing}
            favSet={favSet}
            onPlay={(i) => void playCollection(favorites, i)}
            onFavToggle={(i) => void toggleFavorite(favorites[i]!)}
            emptyHint="在「搜索」里点歌曲右侧的 ♡ 收藏心仪的歌"
          />
          <div style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600, color: 'var(--nf-muted)', flex: 'none', borderTop: '1px solid var(--nf-line)' }}>
            🕘 最近播放（{recent.length}）
          </div>
          <TrackList
            tracks={recent}
            currentIndex={currentIndex}
            playing={playing}
            favSet={favSet}
            onPlay={(i) => void playCollection(recent, i)}
            emptyHint="播放过的歌会出现在这里"
          />
        </div>
      )}

      {/* 播放条 */}
      <div style={{ flex: '0 0 auto', borderTop: '1px solid var(--nf-line)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5, background: 'var(--nf-bg-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 34, height: 34, borderRadius: 6, background: 'var(--nf-bg-3)', display: 'grid', placeItems: 'center', fontSize: 10, color: 'var(--nf-muted)', overflow: 'hidden', flex: 'none' }}>
            {current?.img_url ? <img src={current.img_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🎵'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {current ? current.title : '未播放'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--nf-muted)', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{current ? current.artist : '—'}</span>
              {currentBitrate && <span className="kind" style={{ flex: 'none', fontSize: 10 }}>{currentBitrate}</span>}
            </div>
          </div>
          <button className="nf-btn nf-btn--small" title="全屏歌词" onClick={toggleFullLyric} disabled={!current}>
            📜
          </button>
        </div>
        {/* 进度 + 播放模式（循环点击切换：列表循环 → 单曲循环 → 随机） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--nf-muted)', width: 30, textAlign: 'right' }}>{fmtTime(position)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.5}
            value={Math.min(position, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            style={{ flex: 1, margin: 0 }}
          />
          <span style={{ fontSize: 10, color: 'var(--nf-muted)', width: 30 }}>{fmtTime(duration)}</span>
          <button
            className="nf-btn nf-btn--small"
            style={{ flex: 'none', padding: '2px 4px', border: 'none', background: 'var(--nf-accent-soft)', color: 'var(--nf-accent)', fontWeight: 600 }}
            title={
              mode === 'list'
                ? '当前：列表循环（旧歌播完接下一首，尾首循环）。点击切换单曲循环'
                : mode === 'one'
                  ? '当前：单曲循环（一支歌无限循环）。点击切换随机播放'
                  : '当前：随机播放。点击切换列表循环'
            }
            onClick={() => {
              const nextMode = mode === 'list' ? 'one' : mode === 'one' ? 'shuffle' : 'list'
              setMode(nextMode)
            }}
          >
            {mode === 'list' ? '🔁 列表' : mode === 'one' ? '🔂 单曲' : '🔀 随机'}
          </button>
        </div>
        {/* 控制 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, flex: 'none' }}>
            <span style={{ fontSize: 10, color: 'var(--nf-muted)' }}>🔊</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              title="音量"
              style={{ width: 40, margin: 0 }}
            />
          </span>
          <button className="nf-btn nf-btn--small" onClick={() => void prev()} disabled={!tracks.length} title="上一首">
            ⏮
          </button>
          <button
            className="nf-btn nf-btn--small nf-btn--primary"
            style={{ minWidth: 42 }}
            onClick={togglePlay}
            disabled={!current || loadingUrl}
            title={playing ? '暂停' : '播放'}
          >
            {loadingUrl ? '…' : playing ? '⏸' : '▶'}
          </button>
          <button className="nf-btn nf-btn--small" onClick={() => void next()} disabled={!tracks.length} title="下一首">
            ⏭
          </button>
        </div>
      </div>
    </div>
  )
}
