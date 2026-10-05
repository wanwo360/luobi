import React, { useEffect, useState } from 'react'

export interface TreeNode {
  name: string
  path: string
  isDir: boolean
  size?: number
  kind?: 'text' | 'image' | 'audio' | 'video' | 'other'
  updatedAt?: string
  children?: TreeNode[]
}

interface Props {
  nodes: TreeNode[]
  /** 点击文本文件：在中间标签页打开编辑 */
  onOpenFile?: (relPath: string, name: string) => void
  /** 点击文件夹（打开文件管理器） */
  onOpenDir?: (relPath: string) => void
  /** 新建文件夹 */
  onCreate?: (parentRel: string, name: string) => Promise<boolean>
  /** 新建文件（名字带扩展名创建文件，否则文件夹） */
  onCreateFile?: (parentRel: string, name: string) => Promise<boolean>
  onDelete?: (relPath: string) => Promise<boolean>
  onRename?: (relPath: string, newName: string) => Promise<boolean>
  emptyHint?: string
}

/** 通用文件树：点击文件在中间标签页打开，支持新建/删除/重命名 */
export function FileTree({
  nodes,
  onOpenFile,
  onOpenDir,
  onCreate,
  onCreateFile,
  onDelete,
  onRename,
  emptyHint
}: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['创作资料']))
  const [creating, setCreating] = useState<{ parent: string; name: string } | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ relPath: string; name: string; x: number; y: number; isDir?: boolean } | null>(null)
  /** 当前选中项（文件或目录），新建时跟随 */
  const [selected, setSelected] = useState<{ path: string; isDir: boolean } | null>(null)
  /** 图片预览 */
  const [previewImage, setPreviewImage] = useState<{ path: string; name: string } | null>(null)

  const toggle = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  /** 新建时自动展开目标目录，确保输入框可见 */
  const startCreating = (parent: string): void => {
    setCreating({ parent, name: '' })
    if (parent) {
      setExpanded((prev) => new Set(prev).add(parent))
    }
  }

  /** 新建目标目录：优先当前选中项（目录用自身，文件用父目录），否则用第一个目录 */
  const createTargetDir = (): string => {
    if (selected) {
      if (selected.isDir) return selected.path
      const idx = selected.path.lastIndexOf('/')
      return idx > 0 ? selected.path.slice(0, idx) : ''
    }
    return nodes[0]?.path ?? ''
  }

  /** 收集树中所有文件名（用于生成不重名的文件名） */
  const collectNames = (list: TreeNode[], acc: Set<string>): void => {
    for (const n of list) {
      acc.add(n.name)
      if (n.children) collectNames(n.children, acc)
    }
  }

  /** "＋ 添加"：直接创建内容文件并打开编辑器（不经过文件名输入） */
  const handleAdd = async (): Promise<void> => {
    if (!onCreateFile) return
    const parent = createTargetDir()
    const existing = new Set<string>()
    collectNames(nodes, existing)
    let name = '新内容.md'
    let i = 1
    while (existing.has(name)) {
      name = `新内容-${i++}.md`
    }
    const ok = await onCreateFile(parent, name)
    if (ok && onOpenFile) {
      const full = `${parent}/${name}`.replace(/^\/+/, '')
      onOpenFile(full, name)
    }
  }

  const handleClick = (node: TreeNode): void => {
    if (node.isDir) {
      setSelected({ path: node.path, isDir: true })
      toggle(node.path)
    } else if (node.kind === 'text' || node.name.endsWith('.md') || node.name.endsWith('.txt')) {
      setSelected({ path: node.path, isDir: false })
      onOpenFile?.(node.path, node.name)
    } else if (node.kind === 'image') {
      setSelected({ path: node.path, isDir: false })
      setPreviewImage({ path: node.path, name: node.name })
    }
  }

  const renderNode = (node: TreeNode, depth: number): React.JSX.Element => {
    const indent = { paddingLeft: 8 + depth * 14 }
    if (node.isDir) {
      const isOpen = expanded.has(node.path)
      const isActive = selected?.path === node.path
      return (
        <div key={node.path}>
          <div
            className={`filetree-item${isActive ? ' filetree-item--active' : ''}`}
            style={indent}
            onClick={() => handleClick(node)}
            onContextMenu={(e) => {
              e.preventDefault()
              setCtxMenu({ relPath: node.path, name: node.name, x: e.clientX, y: e.clientY, isDir: true })
            }}
          >
            <span>{isOpen ? '▾' : '▸'}</span>
            <span>📁 {node.name}</span>
          </div>
          {isOpen && (
            <div className="filetree-indent">
              {node.children?.map((c) => renderNode(c, depth + 1))}
              {creating?.parent === node.path && (
                <div style={{ display: 'flex', gap: 4, padding: '4px 8px' }}>
                  <input
                    className="nf-input"
                    style={{ padding: '3px 8px', fontSize: 12 }}
                    placeholder="新文件名/文件夹"
                    autoFocus
                    value={creating.name}
                    onChange={(e) => setCreating({ ...creating, name: e.target.value })}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter' && creating.name) {
                        if (onCreate) await onCreate(node.path, creating.name)
                        else if (onCreateFile) await onCreateFile(node.path, creating.name)
                        setCreating(null)
                      }
                      if (e.key === 'Escape') setCreating(null)
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )
    }
    const isActive = selected?.path === node.path
    return (
      <div
        key={node.path}
        className={`filetree-item${isActive ? ' filetree-item--active' : ''}`}
        style={indent}
        onClick={() => handleClick(node)}
        onContextMenu={(e) => {
          e.preventDefault()
          setCtxMenu({ relPath: node.path, name: node.name, x: e.clientX, y: e.clientY })
        }}
      >
        <span>{node.kind === 'text' ? '📄' : node.kind === 'image' ? '🖼' : node.kind === 'audio' ? '🎵' : node.kind === 'video' ? '🎬' : '📦'}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-body filetree" style={{ flex: 1, overflowY: 'auto' }}>
        {nodes.length === 0 && <div className="empty-hint">{emptyHint ?? '暂无内容'}</div>}
        {nodes.map((n) => renderNode(n, 0))}
        {(onCreate || onCreateFile) && (
          <div style={{ padding: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
            {onCreate && (
              <button className="nf-btn nf-btn--small nf-btn--ghost" onClick={() => startCreating(createTargetDir())}>
                ＋ 新建文件夹
              </button>
            )}
            {onCreateFile && (
              <button className="nf-btn nf-btn--small nf-btn--primary" onClick={handleAdd}>
                ＋ 添加内容
              </button>
            )}
            {selected && (
              <span style={{ fontSize: 11, color: 'var(--nf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                到：{selected.path.split('/').pop()}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 右键菜单：删除 / 重命名 */}
      {ctxMenu && (
        <div
          style={{
            position: 'fixed',
            left: ctxMenu.x,
            top: ctxMenu.y,
            zIndex: 800,
            background: 'var(--nf-surface)',
            border: '1px solid var(--nf-line)',
            borderRadius: 8,
            boxShadow: 'var(--nf-shadow)',
            padding: 4,
            minWidth: 140
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="filetree-item"
            onClick={async () => {
              const name = prompt('重命名为：', ctxMenu.name)
              if (name && onRename) {
                await onRename(ctxMenu.relPath, name)
              }
              setCtxMenu(null)
            }}
          >
            ✏️ 重命名
          </div>
          <div
            className="filetree-item"
            style={{ color: 'var(--nf-error)' }}
            onClick={async () => {
              const target = ctxMenu.isDir ? '文件夹' : '文件'
              if (onDelete && confirm(`删除${target}「${ctxMenu.name}」？${ctxMenu.isDir ? '\n文件夹内的所有内容将一并删除！' : ''}`)) {
                await onDelete(ctxMenu.relPath)
              }
              setCtxMenu(null)
            }}
          >
            🗑 删除{ctxMenu.isDir ? '文件夹' : ''}
          </div>
        </div>
      )}
      {/* 点击空白处关闭右键菜单 */}
      {ctxMenu && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 790 }}
          onClick={() => setCtxMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault()
            setCtxMenu(null)
          }}
        />
      )}

      {/* 图片预览浮层 */}
      {previewImage && (
        <ImagePreview
          path={previewImage.path}
          name={previewImage.name}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </div>
  )
}

/** 图片预览浮层（点击资料面板的图片打开） */
function ImagePreview({ path, name, onClose }: { path: string; name: string; onClose: () => void }): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setSrc(null)
    window.luobi.image
      .readFile(path)
      .then((url: string) => {
        if (alive) setSrc(url)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [path])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 900,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        ...({ WebkitAppRegion: 'no-drag' } as React.CSSProperties)
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--nf-surface)',
          borderRadius: 12,
          padding: 14,
          maxWidth: '86vw',
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          boxShadow: 'var(--nf-shadow)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <strong style={{ fontSize: 13 }}>{name}</strong>
          <div className="titlebar-spacer" />
          <button className="nf-btn nf-btn--small" onClick={() => window.luobi.materials.openFolder(path.replace(/\/[^/]+$/, ''))}>
            📂 打开所在文件夹
          </button>
          <button className="nf-btn nf-btn--small" onClick={onClose}>
            ✕ 关闭
          </button>
        </div>
        {src ? (
          <img src={src} alt={name} style={{ maxWidth: '82vw', maxHeight: '74vh', objectFit: 'contain', borderRadius: 8 }} />
        ) : (
          <div style={{ width: 320, height: 240, display: 'grid', placeItems: 'center', color: 'var(--nf-muted)', fontSize: 13 }}>
            加载中…
          </div>
        )}
      </div>
    </div>
  )
}
