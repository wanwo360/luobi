import React, { useState } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { useEditorStore } from '../stores/editorStore'
import { formatChars } from './DraftPane'

/** 左侧面板：作品列表 + 当前书章节树（VSCode 资源管理器风格） */
export function ProjectsPane(): React.JSX.Element {
  const { projects, currentProject, loadProjects, createProject, deleteProject, selectProject, chapters } = useProjectStore()
  const { openChapter } = useEditorStore()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [showBooks, setShowBooks] = useState(true)
  const [showTrash, setShowTrash] = useState(false)
  const [trash, setTrash] = useState<any[]>([])
  const [bookMenu, setBookMenu] = useState<{ id: string; name: string; x: number; y: number } | null>(null)
  const [chapterMenu, setChapterMenu] = useState<{ number: number; x: number; y: number } | null>(null)

  /** 删除章节（保留历史版本） */
  const deleteChapter = async (number: number): Promise<void> => {
    if (!confirm(`删除第${number}章？\n历史版本会保留，可在编辑器历史中恢复。`)) return
    await window.luobi.chapters.delete(number)
    // 关闭已打开的章节标签
    useEditorStore.getState().closeTab(`chapter-${number}`)
    setChapterMenu(null)
    useProjectStore.getState().loadChapters()
  }

  /** 删除作品（进回收站；若是当前作品则完整重置状态） */
  const deleteBook = async (id: string, name: string): Promise<void> => {
    if (!confirm(`删除作品《${name}》？\n将移入回收站，可在回收站中恢复。`)) return
    setBookMenu(null)
    await deleteProject(id)
  }

  const handleCreate = async (): Promise<void> => {
    if (!name.trim()) return
    await createProject(name.trim())
    setName('')
    setCreating(false)
  }

  const handleTrash = async (): Promise<void> => {
    if (!showTrash) {
      setTrash(await window.luobi.projects.listTrash())
    }
    setShowTrash(!showTrash)
  }

  const restore = async (id: string): Promise<void> => {
    await window.luobi.projects.restoreTrash(id)
    await loadProjects()
    setTrash(await window.luobi.projects.listTrash())
  }

  return (
    <div className="ws-left">
      <div className="panel-header">
        <span>作品</span>
        <button className="nf-btn nf-btn--small nf-btn--ghost" onClick={() => setCreating(!creating)}>
          ＋ 新建
        </button>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* 新建输入 */}
        {creating && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
            <input
              className="nf-input"
              placeholder="作品名"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="nf-btn nf-btn--small nf-btn--primary" onClick={handleCreate}>
                创建
              </button>
              <button className="nf-btn nf-btn--small" onClick={() => setCreating(false)}>
                取消
              </button>
            </div>
          </div>
        )}

        {/* 作品列表（可折叠） */}
        <div className="filetree-item" style={{ fontWeight: 600 }} onClick={() => setShowBooks(!showBooks)}>
          <span>{showBooks ? '▾' : '▸'}</span>
          <span>📚 我的作品</span>
        </div>
        {showBooks &&
          projects.map((p) => (
            <div
              key={p.id}
              className={`project-item${currentProject?.id === p.id ? ' project-item--active' : ''}`}
              onClick={() => selectProject(p.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setBookMenu({ id: p.id, name: p.name, x: e.clientX, y: e.clientY })
              }}
              style={{ paddingLeft: 24 }}
            >
              <span className="project-name">📖 {p.name}</span>
            </div>
          ))}

        {/* 当前书章节树 */}
        {currentProject && (
          <>
            <div style={{ height: 1, background: 'var(--nf-line)', margin: '8px 0' }} />
            <div className="filetree-item" style={{ fontWeight: 600 }}>
              <span>▾</span>
              <span>📄 正文</span>
            </div>
            {chapters.length === 0 && (
              <div style={{ paddingLeft: 24, fontSize: 12, color: 'var(--nf-muted)' }}>还没有章节，让主编写第一章吧</div>
            )}
            {chapters.map((c) => (
              <div
                key={c.number}
                className="filetree-item"
                style={{ paddingLeft: 24 }}
                onClick={() => openChapter(c.number, '')}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setChapterMenu({ number: c.number, x: e.clientX, y: e.clientY })
                }}
              >
                <span>📄</span>
                <span>第{c.number}章</span>
                <span className="kind">{formatChars(c.chars)}</span>
              </div>
            ))}
          </>
        )}

        {/* 作品右键菜单：删除 */}
        {bookMenu && (
          <>
            <div
              style={{
                position: 'fixed',
                left: bookMenu.x,
                top: bookMenu.y,
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
                style={{ color: 'var(--nf-error)' }}
                onClick={() => deleteBook(bookMenu.id, bookMenu.name)}
              >
                🗑 删除《{bookMenu.name}》
              </div>
            </div>
            <div style={{ position: 'fixed', inset: 0, zIndex: 790 }} onClick={() => setBookMenu(null)} onContextMenu={(e) => { e.preventDefault(); setBookMenu(null) }} />
          </>
        )}

        {/* 章节右键菜单：删除 */}
        {chapterMenu && (
          <>
            <div
              style={{
                position: 'fixed',
                left: chapterMenu.x,
                top: chapterMenu.y,
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
                style={{ color: 'var(--nf-error)' }}
                onClick={() => deleteChapter(chapterMenu.number)}
              >
                🗑 删除第{chapterMenu.number}章
              </div>
            </div>
            <div style={{ position: 'fixed', inset: 0, zIndex: 790 }} onClick={() => setChapterMenu(null)} onContextMenu={(e) => { e.preventDefault(); setChapterMenu(null) }} />
          </>
        )}

        <div style={{ height: 1, background: 'var(--nf-line)', margin: '8px 0' }} />
        <button className="nf-btn nf-btn--small nf-btn--ghost" style={{ justifyContent: 'flex-start' }} onClick={handleTrash}>
          🗑 回收站 {showTrash ? '▾' : '▸'}
        </button>
        {showTrash && (
          <div style={{ marginTop: 4 }}>
            {trash.length === 0 && <div className="empty-hint">回收站为空</div>}
            {trash.map((t) => (
              <div key={t.id} className="filetree-item">
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--nf-muted)' }}>
                  {t.name}
                </span>
                <button className="nf-btn nf-btn--small" onClick={() => restore(t.id)}>
                  恢复
                </button>
                <button
                  className="nf-btn nf-btn--small nf-btn--danger"
                  onClick={async () => {
                    await window.luobi.projects.deleteTrash(t.id)
                    setTrash(await window.luobi.projects.listTrash())
                  }}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
