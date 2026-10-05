import React, { useEffect, useRef, useState } from 'react'
import type { GeneratedImage, ImageServiceConfig } from '@shared/types/image'

/** 风格预设：风格块用英文（SDXL/FLUX/智谱均吃英文，效果最稳；显示名照旧中文） */
const STYLES: { id: string; label: string; add: string }[] = [
  {
    id: 'cover',
    label: '📖 小说封面',
    add: 'book cover illustration, cinematic lighting, rich color hierarchy, refined flat illustration style, generous empty space at top and bottom for title typography, 8k'
  },
  {
    id: 'manga',
    label: '🎨 日系漫画',
    add: 'Japanese manga style, clean ink lines, cel shading, dynamic panel composition, shonen manga volume cover composition'
  },
  {
    id: 'uscomic',
    label: '🔥 美式漫画',
    add: 'American comic book style, bold ink lines, halftone dots, high contrast vibrant colors, comic book cover composition'
  },
  {
    id: 'ink',
    label: '🖌 水墨国风',
    add: 'traditional Chinese ink wash painting style, expressive brush strokes, negative space, light watercolor, rice paper texture'
  },
  {
    id: 'hanfu',
    label: '🏮 古风仙侠',
    add: 'Chinese xianxia fantasy illustration, intricate gongbi details, elegant hanfu character, cloud palaces, iridescent glow'
  },
  {
    id: 'fantasy',
    label: '🧙 奇幻史诗',
    add: 'epic fantasy illustration, dragons and magic, volumetric light, intricate details, epic composition, concept art'
  },
  {
    id: 'scifi',
    label: '🌌 科幻赛博',
    add: 'sci-fi concept art, cyberpunk neon city, rainy night mood, character silhouette, cinematic composition'
  },
  {
    id: 'film',
    label: '🎬 电影海报',
    add: 'movie poster style, dramatic lighting, shallow depth of field, film grain, character with storytelling eyes, poster composition'
  },
  {
    id: 'cute',
    label: '🎀 少女治愈',
    add: 'healing cute illustration, macaron pastel palette, soft light, adorable characters, picture book quality'
  },
  { id: 'flat', label: '🖼 扁平插画', add: 'modern flat illustration, clean geometric shapes, soft gradients, minimal composition, brand feel' }
]

type Mode = 'free' | 'cover' | 'comic'

/**
 * AI 图片工作台：
 * 1. 自由生成：描述 + 风格预设
 * 2. 小说封面：书名/作者 → 4 张候选 → 选一张 → 自动排版文字合成真封面
 * 3. 漫画分镜：4 张拼 2×2 分镜页
 */
export function ImageGenDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('free')
  const [prompt, setPrompt] = useState('')
  const [styleId, setStyleId] = useState('cover')
  const [count, setCount] = useState(1)
  const [size, setSize] = useState('1024x1024')
  const [generating, setGenerating] = useState(false)
  const [images, setImages] = useState<GeneratedImage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [configured, setConfigured] = useState(true)
  // 本地 ComfyUI 服务状态（仅本地模式显示；启动中/就绪/失败经事件实时刷新）
  const [comfy, setComfy] = useState<{ isLocal: boolean; ready: boolean; starting: boolean; error: string | null } | null>(null)
  // 封面工作流
  const [bookTitle, setBookTitle] = useState('')
  const [bookAuthor, setBookAuthor] = useState('')
  const [coverLayout, setCoverLayout] = useState<'h' | 'v'>('h')
  const [coverSrc, setCoverSrc] = useState<string | null>(null)
  const [coverDone, setCoverDone] = useState<GeneratedImage | null>(null)
  // 分镜
  const [stripDone, setStripDone] = useState<GeneratedImage | null>(null)

  useEffect(() => {
    window.luobi.image
      .getConfig()
      .then((cfg: { service?: ImageServiceConfig | null }) => {
        const enabled = !!cfg?.service?.enabled
        setConfigured(enabled)
        if (enabled) {
          return window.luobi.image.comfyStatus().then(setComfy).catch(() => {})
        }
      })
      .catch(() => {})
    // 主进程启动服务时推送状态（starting → ready / failed）
    const off = window.luobi.image.onComfyStatus((p) => {
      setComfy((cur) => ({
        isLocal: cur?.isLocal ?? true,
        ready: p.status === 'ready',
        starting: p.status === 'starting',
        error: p.status === 'failed' ? (p.message ?? '启动失败') : null
      }))
    })
    // 默认书名：当前项目名（仅初值，不覆盖用户修改）
    window.luobi.projects
      .getCurrent()
      .then((p: any) => {
        if (p?.name && !bookTitleRef.current) setBookTitle(p.name)
      })
      .catch(() => {})
    return () => {
      off()
    }
  }, [])

  const bookTitleRef = useRef('')
  useEffect(() => {
    bookTitleRef.current = bookTitle
  }, [bookTitle])

  const builtPrompt = (): string => {
    // 统一负向约束（英文——本地 SDXL 直接吃；清除图内文字/水印）
    const NEG = 'clean image, no text, no watermark, no logo, no signature, no AI labels'
    const style = STYLES.find((s) => s.id === styleId) ?? STYLES[0]
    const base = prompt.trim() || '主角在月光下的山巅，冷色调，史诗氛围'
    if (mode === 'cover') {
      const desc = prompt.trim() || '主角立于月下山巅，书卷气与史诗感交织'
      return `${style.add}. Subject: ${desc}. As a novel cover: main subject placed in the middle-lower area, large empty space at top for title typography, epic composition, unified color palette, refined details. ${NEG}`
    }
    if (mode === 'comic') {
      return `${style.add}. Dynamic manga single-panel scene with energetic action, clear linework, distinct character design, complete single-frame composition (this will be one panel of a comic page). ${NEG}`
    }
    return `${style.add}. ${base} ${NEG}`
  }

  const generate = async (): Promise<void> => {
    if (generating) return
    setGenerating(true)
    setError(null)
    setCoverDone(null)
    setStripDone(null)
    const useCount = mode === 'free' ? count : 4
    const useSize = mode === 'free' ? size : mode === 'cover' ? '768x1344' : '1024x1024'
    try {
      // 本地 ComfyUI 未就绪：先推进一次自动启动（幂等；即使跳过，主进程生成前也会兜底确保）
      if (comfy?.isLocal && !comfy.ready && !comfy.starting) {
        await window.luobi.image.comfyStart()
        setComfy((c) => (c ? { ...c, ready: true, starting: false } : c))
      }
      const result = await window.luobi.image.generate(builtPrompt(), { size: useSize, count: useCount })
      setImages(result)
      setCoverSrc(null)
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setGenerating(false)
    }
  }

  const pickCover = async (img: GeneratedImage): Promise<void> => {
    try {
      const src: string = await window.luobi.image.readFile(img.filePath)
      setCoverSrc(src)
    } catch {
      /* 读取失败 */
    }
  }

  /** 封面文字合成：canvas 排版（渐变遮罩 + 标题 + 作者行 + 顶部装饰） */
  const composeCover = async (): Promise<void> => {
    if (!coverSrc) return
    try {
      const img = await loadImage(coverSrc)
      const W = 1024
      const H = 1536
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')!
      // 底图（生成图铺满）
      const scale = Math.max(W / img.width, H / img.height)
      const sw = img.width * scale
      const sh = img.height * scale
      ctx.drawImage(img, (W - sw) / 2, (H - sh) / 2, sw, sh)
      // 顶部轻微提亮 + 底部渐暗遮罩（文字可读性）
      const g = ctx.createLinearGradient(0, H * 0.34, 0, H)
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(0.28, 'rgba(0,0,0,0.18)')
      g.addColorStop(1, 'rgba(0,0,0,0.78)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
      const title = bookTitle.trim() || '未命名作品'
      const author = bookAuthor.trim()
      const serif = '"STKaiti","KaiTi","STSong","SimSun",serif'
      ctx.textAlign = 'center'
      ctx.shadowColor = 'rgba(0,0,0,0.75)'
      ctx.shadowBlur = 16
      ctx.shadowOffsetY = 4
      if (coverLayout === 'v') {
        // 标题竖排（右上，传统卷轴感）：每字一行，最多 8 字
        const chars = Array.from(title).slice(0, 8)
        const fs = 78
        ctx.font = `bold ${fs}px ${serif}`
        ctx.fillStyle = '#fdf8ef'
        const x = W - 130
        let y = 150
        for (const ch of chars) {
          ctx.fillText(ch, x, y)
          y += fs + 26
        }
        // 副题：作者在左下
        if (author) {
          ctx.font = '30px serif'
          ctx.fillStyle = 'rgba(253,248,239,0.82)'
          ctx.textAlign = 'left'
          ctx.fillText(`${author} 著`, 70, H - 80)
        }
      } else {
        // 标题横排（顶部居中，自动缩字号）
        let fs = title.length <= 6 ? 104 : title.length <= 9 ? 84 : 64
        ctx.font = `bold ${fs}px ${serif}`
        ctx.fillStyle = '#fdf8ef'
        ctx.fillText(title, W / 2, 210, W - 150)
        if (author) {
          ctx.font = '32px serif'
          ctx.fillStyle = 'rgba(253,248,239,0.82)'
          ctx.fillText(`${author} 著`, W / 2, H - 74)
        }
      }
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0
      // 顶部装饰：细线 + 菱形（书卷气）
      ctx.strokeStyle = 'rgba(253,248,239,0.6)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(W / 2 - 110, 92)
      ctx.lineTo(W / 2 - 20, 92)
      ctx.moveTo(W / 2 + 20, 92)
      ctx.lineTo(W / 2 + 110, 92)
      ctx.stroke()
      ctx.fillStyle = '#c8a36a'
      ctx.save()
      ctx.translate(W / 2, 92)
      ctx.rotate(Math.PI / 4)
      ctx.fillRect(-7, -7, 14, 14)
      ctx.restore()

      const out = canvas.toDataURL('image/png', 0.94)
      setComposing(true)
      const record = await window.luobi.image.saveDerived(out, `封面-${title}`)
      setCoverDone(record)
    } catch (err: any) {
      setError(`合成失败：${err?.message ?? String(err)}`)
    } finally {
      setComposing(false)
    }
  }
  const [composing, setComposing] = useState(false)

  /** 漫画分镜：4 张拼成 2×2（白缝 16px，格内居中裁切） */
  const composeStrip = async (): Promise<void> => {
    if (images.length < 4) {
      setError('需要 4 张图才能拼接分镜（已限制本次生成 4 张）')
      return
    }
    try {
      const srcs: string[] = []
      for (const img of images.slice(0, 4)) {
        srcs.push(await window.luobi.image.readFile(img.filePath))
      }
      const CELL = 560
      const GAP = 18
      const M = 18
      const W = CELL * 2 + GAP * 3
      const H = CELL * 2 + GAP * 3
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)
      for (let i = 0; i < 4; i += 1) {
        const img = await loadImage(srcs[i])
        const x = M + (i % 2) * (CELL + GAP)
        const y = M + Math.floor(i / 2) * (CELL + GAP)
        const scale = Math.max(CELL / img.width, CELL / img.height)
        const sw = img.width * scale
        const sh = img.height * scale
        ctx.save()
        ctx.beginPath()
        ctx.rect(x, y, CELL, CELL)
        ctx.clip()
        ctx.drawImage(img, x - (sw - CELL) / 2, y - (sh - CELL) / 2, sw, sh)
        ctx.restore()
        // 格线微阴影
        ctx.strokeStyle = 'rgba(0,0,0,0.12)'
        ctx.strokeRect(x, y, CELL, CELL)
      }
      const out = canvas.toDataURL('image/png', 0.94)
      const record = await window.luobi.image.saveDerived(out, '漫画分镜页')
      setStripDone(record)
    } catch (err: any) {
      setError(`拼贴失败：${err?.message ?? String(err)}`)
    }
  }

  const styleLabel = (id: string): string => STYLES.find((s) => s.id === id)?.label ?? id

  return (
    <div className="nf-modal-overlay" onClick={onClose}>
      <div className="nf-modal" style={{ width: 'min(820px, 94vw)', height: 'auto', maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span>🎨 图片工作台</span>
          <button className="nf-btn nf-btn--small" onClick={onClose}>
            ✕
          </button>
        </div>
        <div style={{ padding: 16, overflowY: 'auto' }}>
          {/* 模式切换 */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {(
              [
                ['free', '🖼 自由生成'],
                ['cover', '📕 小说封面'],
                ['comic', '🎴 漫画分镜']
              ] as [Mode, string][]
            ).map(([m, label]) => (
              <button
                key={m}
                className="nf-btn nf-btn--small"
                style={{ background: mode === m ? 'var(--nf-accent-soft)' : 'transparent', color: mode === m ? 'var(--nf-accent)' : 'var(--nf-muted)', fontWeight: mode === m ? 600 : 400, border: 'none' }}
                onClick={() => {
                  setMode(m)
                  setError(null)
                  setCoverSrc(null)
                  setCoverDone(null)
                  setStripDone(null)
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {!configured && (
            <div className="selfcheck-issue selfcheck-issue--warning" style={{ marginBottom: 12 }}>
              ⚠️ 尚未配置图片生成服务。到 <strong>设置 → 模型 → 图片生成</strong> 填入 API 信息（智谱 CogView / SiliconFlow 等）。
            </div>
          )}

          {/* 本地 ComfyUI 服务状态条（自动启动/就绪/失败） */}
          {comfy?.isLocal && (
            <div
              className="selfcheck-issue"
              style={{
                marginBottom: 12,
                background: comfy.ready && !comfy.starting ? 'rgba(94,196,125,0.10)' : 'rgba(200,163,106,0.12)',
                color: comfy.ready && !comfy.starting ? 'var(--nf-success)' : 'var(--nf-warning)'
              }}
            >
              {comfy.ready && !comfy.starting ? (
                '🟢 本地 ComfyUI 已就绪（出图零费用，无需联网）· 漫画/JOJO 类风格自动用 SDXL，写实封面用 FLUX'
              ) : comfy.starting ? (
                '🟡 本地 ComfyUI 启动中…（首次约 1-3 分钟，可观察黑色窗口的加载日志）'
              ) : (
                <>🟡 本地 ComfyUI 未运行{comfy.error ? `（${comfy.error}）` : '，点击下方按钮一键启动'}</>
              )}
              {!comfy.ready && !comfy.starting && (
                <button
                  className="nf-btn nf-btn--small"
                  style={{ marginLeft: 8 }}
                  onClick={() =>
                    void window.luobi.image
                      .comfyStart()
                      .catch((e: any) => setError(e?.message ?? String(e)))
                  }
                >
                  🚀 启动本地服务
                </button>
              )}
            </div>
          )}

          {/* 风格预设 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--nf-muted)' }}>风格</span>
            {STYLES.map((s) => (
              <button
                key={s.id}
                className="nf-btn nf-btn--small"
                title={s.add}
                style={{
                  padding: '2px 8px',
                  border: 'none',
                  background: styleId === s.id ? 'var(--nf-accent-soft)' : 'transparent',
                  color: styleId === s.id ? 'var(--nf-accent)' : 'var(--nf-muted)'
                }}
                onClick={() => setStyleId(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* 封面模式：书名/作者/版式 */}
          {mode === 'cover' && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <input
                className="nf-input"
                style={{ flex: '2 1 200px', padding: '6px 10px' }}
                placeholder="书名（自动填入项目名）"
                value={bookTitle}
                onChange={(e) => setBookTitle(e.target.value)}
              />
              <input
                className="nf-input"
                style={{ flex: '1 1 140px', padding: '6px 10px' }}
                placeholder="作者名（可选）"
                value={bookAuthor}
                onChange={(e) => setBookAuthor(e.target.value)}
              />
              <select className="nf-input" style={{ padding: '6px 8px' }} value={coverLayout} onChange={(e) => setCoverLayout(e.target.value as 'h' | 'v')}>
                <option value="h">横排标题</option>
                <option value="v">竖排标题（书卷）</option>
              </select>
            </div>
          )}

          <textarea
            className="nf-textarea"
            style={{ minHeight: mode === 'free' ? 90 : 64 }}
            placeholder={
              mode === 'cover'
                ? '画面内容（如：主角立于月下山巅，长袍猎猎，身后群峰如墨，星光点点）…'
                : mode === 'comic'
                  ? '爽漫场面描述（如：男主角拳风爆裂冲破黑暗，热血顶点，配角震惊分镜）…'
                  : '描述你想生成的画面…（如：男主角在月光下的城堡前，冷色调，电影感）'
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            spellCheck={false}
          />

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '10px 0', flexWrap: 'wrap' }}>
            {mode === 'free' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--nf-muted)' }}>数量</span>
                  <select className="nf-input" style={{ width: 70, padding: '5px 8px' }} value={count} onChange={(e) => setCount(parseInt(e.target.value, 10))}>
                    <option value={1}>1 张</option>
                    <option value={2}>2 张</option>
                    <option value={4}>4 张</option>
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--nf-muted)' }}>尺寸</span>
                  <select className="nf-input" style={{ width: 140, padding: '5px 8px' }} value={size} onChange={(e) => setSize(e.target.value)}>
                    <option value="1024x1024">1024×1024</option>
                    <option value="768x1344">768×1344（竖版）</option>
                    <option value="1344x768">1344×768（横版）</option>
                  </select>
                </div>
              </>
            )}
            {mode !== 'free' && (
              <span style={{ fontSize: 12, color: 'var(--nf-muted)' }}>
                {mode === 'cover' ? '自动生成 4 张 768×1344 竖版候选（顶部已留标题排版空间）' : '自动生成 4 张 1024×1024（一格一张）'}
              </span>
            )}
            <div className="titlebar-spacer" />
            <button className="nf-btn nf-btn--primary" onClick={generate} disabled={generating}>
              {generating ? '生成中…' : '✦ 生成'}
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--nf-muted)', marginBottom: 4 }}>
            风格「{styleLabel(styleId)}」已注入提示词头部
          </div>

          {error && <div className="selfcheck-issue selfcheck-issue--error" style={{ marginBottom: 10 }}>❌ {error}</div>}

          {images.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: 'var(--nf-success)', marginBottom: 8 }}>
                ✅ 已生成并保存到 创作资料/生成图片/
                {mode === 'cover' && ' —— 点选一张作为封面底图'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                {images.map((img) => (
                  <div
                    key={img.id}
                    onClick={mode === 'cover' ? () => void pickCover(img) : undefined}
                    style={{
                      border: coverSrc && images.find((x) => x.id === img.id) ? 'none' : '1px solid var(--nf-line)',
                      borderRadius: 10,
                      overflow: 'hidden',
                      background: 'var(--nf-surface)',
                      cursor: mode === 'cover' ? 'pointer' : 'default',
                      outline: mode === 'cover' ? (coverSrc ? '2px solid var(--nf-accent)' : 'none') : 'none'
                    }}
                  >
                    <Preview filePath={img.filePath} alt={img.prompt.slice(0, 20)} />
                    <div style={{ fontSize: 10, color: 'var(--nf-muted)', padding: '4px 8px' }}>{img.filePath.split('/').pop()}</div>
                  </div>
                ))}
              </div>

              {/* 封面合成区 */}
              {mode === 'cover' && coverSrc && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 14,
                    border: '1px solid var(--nf-line)',
                    borderRadius: 12,
                    background: 'var(--nf-bg-2)',
                    display: 'flex',
                    gap: 14,
                    alignItems: 'center'
                  }}
                >
                  <img src={coverSrc} alt="封面底图" style={{ width: 70, height: 105, objectFit: 'cover', borderRadius: 8, flex: 'none' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                      合成封面：《{bookTitle.trim() || '未命名作品'}》
                      {bookAuthor.trim() ? ` · ${bookAuthor.trim()} 著` : ''}
                    </div>
                    <button className="nf-btn nf-btn--primary" onClick={() => void composeCover()} disabled={composing}>
                      {composing ? '合成中…' : '✦ 合成封面文字'}
                    </button>
                    {coverDone && (
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--nf-success)' }}>
                        ✅ 封面已保存：{coverDone.filePath.split('/').pop()}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 分镜拼接区 */}
              {mode === 'comic' && images.length >= 4 && (
                <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button className="nf-btn nf-btn--primary" onClick={() => void composeStrip()}>
                    🎴 拼接成 2×2 漫画分镜页
                  </button>
                  {stripDone && (
                    <span style={{ fontSize: 12, color: 'var(--nf-success)' }}>✅ 分镜页已保存：{stripDone.filePath.split('/').pop()}</span>
                  )}
                </div>
              )}

              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <button className="nf-btn nf-btn--small" onClick={() => window.luobi.materials.openFolder('创作资料/生成图片')}>
                  📂 打开生成图片目录
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** 通过 IPC 读取图片转 data URL（CSP 限制 file:// 直读）。
 * 必须定义在组件外：组件内定义会导致每次渲染都是新组件类型，预览反复卸载重挂、重复读盘 */
function Preview({ filePath, alt }: { filePath: string; alt: string }): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    window.luobi.image
      .readFile(filePath)
      .then((url: string) => {
        if (alive) setSrc(url)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [filePath])
  return src ? (
    <img src={src} alt={alt} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', background: 'var(--nf-bg-3)' }} />
  ) : (
    <div style={{ width: '100%', aspectRatio: '1', display: 'grid', placeItems: 'center', background: 'var(--nf-bg-3)', color: 'var(--nf-muted)', fontSize: 12 }}>
      加载中…
    </div>
  )
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}
