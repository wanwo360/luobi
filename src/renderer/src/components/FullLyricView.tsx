import React, { useEffect, useMemo, useRef } from 'react'
import { useMusicStore } from '../stores/musicStore'
import { parseLrc } from '../stores/lrc'

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * 全屏大歌词页（参照手机播放器歌词页）：
 * 当前句大号高亮居中、前后句小字淡色，自动滚动跟随，点击任意句跳转；
 * 顶部封面/歌名/控制，底部进度+音量+播放模式
 * 进度条拖动时当前句即时切换——"下一句是哪句"一目了然
 */
export function FullLyricView(): React.JSX.Element | null {
  const {
    tracks,
    currentIndex,
    playing,
    position,
    duration,
    loadingUrl,
    lyric,
    mode,
    volume,
    togglePlay,
    next,
    prev,
    seek,
    fullLyric,
    toggleFullLyric,
    setMode,
    setVolume
  } = useMusicStore()
  const current = tracks[currentIndex] ?? null

  const lines = useMemo(() => parseLrc(lyric), [lyric])
  const active = useMemo(() => {
    let a = -1
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].time <= position + 0.5) a = i
      else break
    }
    return a
  }, [lines, position])

  const activeRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (active >= 0) activeRef.current?.scrollIntoView({ block: 'center' })
  }, [active])

  // Esc 关闭全屏歌词
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && useMusicStore.getState().fullLyric) {
        useMusicStore.getState().toggleFullLyric()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!current || !fullLyric) return null

  const modeBtns: [typeof mode, string, string][] = [
    ['list', '🔁', '列表循环'],
    ['one', '🔂', '单曲循环'],
    ['shuffle', '🔀', '随机播放']
  ]

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1050,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#101014',
        // 关键：标题栏是 -webkit-app-region: drag 热区，Electron 中拖拽热区优先消耗鼠标事件
        //（与 z-index 无关）→ 全屏层必须宣告 no-drag 否则顶部按钮点不了
        WebkitAppRegion: 'no-drag'
      } as React.CSSProperties}
    >
      {/* 沉浸式壁纸：封面模糊放大 + 深色遮罩（网页/App 播放页风格；无封面回退纯色） */}
      {current.img_url && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
          <img
            src={current.img_url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(56px) brightness(0.42)', transform: 'scale(1.25)' }}
          />
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(180deg, rgba(8,8,12,0.35), rgba(8,8,12,0.25) 30%, rgba(8,8,12,0.5) 70%, rgba(8,8,12,0.7))' }} />

      {/* 顶栏：返回 + 封面/歌名 + 控制（半透玻璃条） */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          flex: 'none',
          background: 'rgba(0,0,0,0.28)',
          backdropFilter: 'blur(8px)'
        }}
      >
        <button className="nf-btn nf-btn--small" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', border: 'none' }} onClick={toggleFullLyric} title="返回（Esc 也可）">
          ←
        </button>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: 'rgba(255,255,255,0.1)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 16,
            color: '#fff',
            overflow: 'hidden',
            flex: 'none',
            boxShadow: '0 4px 14px rgba(0,0,0,0.4)'
          }}
        >
          {current.img_url ? <img src={current.img_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🎵'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.title}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.artist} · 歌词</div>
        </div>
        <button className="nf-btn nf-btn--small" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none' }} onClick={() => void prev()} title="上一首">
          ⏮
        </button>
        <button
          className="nf-btn nf-btn--small"
          style={{ minWidth: 46, background: 'rgba(255,255,255,0.16)', color: '#fff', border: 'none' }}
          onClick={togglePlay}
          disabled={loadingUrl}
          title={playing ? '暂停' : '播放'}
        >
          {loadingUrl ? '…' : playing ? '⏸' : '▶'}
        </button>
        <button className="nf-btn nf-btn--small" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none' }} onClick={() => void next()} title="下一首">
          ⏭
        </button>
      </div>

      {/* 歌词主体：当前句大号白亮居中，前后句渐隐缩小（手机歌词页样式） */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, minHeight: 0, overflowY: 'auto', padding: '38vh 3vw 44vh', textAlign: 'center' }}>
        {lines.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>暂无歌词，可拖动下方进度条收听</div>
        ) : (
          lines.map((l, i) => {
            const act = i === active
            const isPast = i < active
            return (
              <div
                key={i}
                ref={act ? activeRef : undefined}
                onClick={() => seek(l.time)}
                title="点击跳转到这一句"
                style={{
                  cursor: 'pointer',
                  padding: '7px 14px',
                  borderRadius: 12,
                  fontSize: act ? 24 : isPast ? 13 : 15,
                  fontWeight: act ? 700 : 400,
                  lineHeight: 1.6,
                  color: act ? '#ffffff' : isPast ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.66)',
                  opacity: act ? 1 : isPast ? 0.6 : 1,
                  maxWidth: 860,
                  margin: '0 auto',
                  textShadow: act ? '0 2px 20px rgba(255,255,255,0.35)' : 'none',
                  transition: 'font-size 0.25s, color 0.25s'
                }}
              >
                {l.text || '♪'}
              </div>
            )
          })
        )}
      </div>

      {/* 底部：进度 + 时间 + 模式 + 音量（半透玻璃条） */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          flex: 'none',
          padding: '10px 20px 16px',
          background: 'rgba(0,0,0,0.3)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', width: 34, textAlign: 'right' }}>{fmtTime(position)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.5}
            value={Math.min(position, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            style={{ flex: 1, margin: 0 }}
          />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', width: 34 }}>{fmtTime(duration)}</span>
          {modeBtns.map(([m, icon, label]) => (
            <button
              key={m}
              className="nf-btn nf-btn--small"
              style={{
                flex: 'none',
                padding: '2px 5px',
                border: 'none',
                background: mode === m ? 'rgba(255,255,255,0.18)' : 'transparent',
                color: mode === m ? '#fff' : 'rgba(255,255,255,0.55)',
                fontWeight: mode === m ? 600 : 400
              }}
              title={label}
              onClick={() => setMode(m)}
            >
              {icon}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 320, margin: '0 auto' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>🔊</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            style={{ flex: 1, margin: 0 }}
          />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', width: 32, textAlign: 'right' }}>{Math.round(volume * 100)}%</span>
        </div>
      </div>
    </div>
  )
}
