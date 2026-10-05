import React from 'react'
import { useMusicStore } from '../stores/musicStore'

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * 全局迷你播放条：右侧音乐面板收起时仍可听歌/切歌/收藏/看歌词
 * 点击封面/标题区 → 切回音乐面板（onOpen）
 */
export function MiniPlayer({ onOpen }: { onOpen: () => void }): React.JSX.Element | null {
  const {
    tracks,
    currentIndex,
    playing,
    position,
    duration,
    loadingUrl,
    favorites,
    togglePlay,
    next,
    prev,
    seek,
    toggleFullLyric,
    toggleFavorite
  } = useMusicStore()

  const current = tracks[currentIndex] ?? null
  if (!current) return null
  const isFav = favorites.some((f) => f.id === current.id)

  return (
    <div style={{ position: 'fixed', right: 14, bottom: 14, zIndex: 60 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 10px',
          borderRadius: 12,
          background: 'var(--nf-surface)',
          border: '1px solid var(--nf-line)',
          boxShadow: 'var(--nf-shadow)',
          width: 308
        }}
      >
        <button
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            background: 'var(--nf-bg-3)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 10,
            color: 'var(--nf-muted)',
            overflow: 'hidden',
            flex: 'none',
            cursor: 'pointer',
            border: 'none',
            padding: 0
          }}
          title="打开音乐面板"
          onClick={onOpen}
        >
          {current.img_url ? <img src={current.img_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🎵'}
        </button>
        <button
          className="nf-btn nf-btn--small"
          style={{ flex: 1, minWidth: 0, display: 'block', textAlign: 'left' }}
          title="打开音乐面板"
          onClick={onOpen}
        >
          <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.title}</div>
          <div style={{ fontSize: 11, color: 'var(--nf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {current.artist}
          </div>
        </button>
        <button
          className="nf-btn nf-btn--small"
          title={isFav ? '取消收藏' : '收藏'}
          style={{
            flex: 'none',
            border: 'none',
            background: isFav ? 'var(--nf-accent-soft)' : 'transparent',
            color: isFav ? 'var(--nf-accent)' : 'var(--nf-muted)'
          }}
          onClick={() => void toggleFavorite(current)}
        >
          {isFav ? '♥' : '♡'}
        </button>
        <button className="nf-btn nf-btn--small" title="全屏歌词" onClick={toggleFullLyric} style={{ flex: 'none' }}>
          📜
        </button>
        <span style={{ flex: 'none', display: 'flex', gap: 4 }}>
          <button className="nf-btn nf-btn--small" onClick={() => void prev()} title="上一首">
            ⏮
          </button>
          <button className="nf-btn nf-btn--small nf-btn--primary" style={{ minWidth: 48 }} onClick={togglePlay} disabled={loadingUrl} title="播放/暂停">
            {loadingUrl ? '…' : playing ? '⏸' : '▶'}
          </button>
          <button className="nf-btn nf-btn--small" onClick={() => void next()} title="下一首">
            ⏭
          </button>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
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
      </div>
    </div>
  )
}
