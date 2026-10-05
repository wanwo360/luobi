import React, { useState } from 'react'
import { useEditorStore, type FileKind } from '../stores/editorStore'
import { Markdown } from '../components/Markdown'

/** 资料文件编辑器页面（大纲/设定/记忆/资料通用，VSCode 式标签页） */
export function FileEditorPage({ filePath, kind }: { filePath: string; kind: FileKind }): React.JSX.Element {
  const { fileText, setFileText, markFileSaved, fileDirty } = useEditorStore()
  const [saving, setSaving] = useState(false)
  const [savedHint, setSavedHint] = useState(false)
  const [preview, setPreview] = useState(false)

  const writers: Record<FileKind, (p: string, c: string) => Promise<unknown>> = {
    outline: (p, c) => window.luobi.outline.write(p, c),
    deposition: (p, c) => window.luobi.deposition.write(p, c),
    memory: (p, c) => window.luobi.memory.write(p, c),
    materials: (p, c) => window.luobi.materials.write(p, c)
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      await writers[kind](filePath, fileText)
      markFileSaved()
      setSavedHint(true)
      setTimeout(() => setSavedHint(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const chars = fileText.replace(/\s/g, '').length
  const fileName = filePath.split('/').pop() ?? filePath

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 工具栏 */}
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--nf-line)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--nf-bg-2)', flex: '0 0 auto' }}>
        <strong>{fileName}</strong>
        <span style={{ fontSize: 12, color: 'var(--nf-muted)' }}>{chars} 字</span>
        <span style={{ fontSize: 11, color: 'var(--nf-faint)' }}>{filePath}</span>
        <div className="titlebar-spacer" />
        <button className="nf-btn nf-btn--small" onClick={() => setPreview(!preview)}>
          {preview ? '✏️ 编辑' : '👁 预览'}
        </button>
        <button className="nf-btn nf-btn--small nf-btn--primary" onClick={handleSave} disabled={!fileDirty || saving}>
          {saving ? '保存中…' : fileDirty ? '💾 保存' : '已保存 ✓'}
        </button>
        {savedHint && <span style={{ fontSize: 12, color: 'var(--nf-success)' }}>已保存</span>}
      </div>

      {/* 内容区：编辑 / 预览切换 */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--nf-bg)' }}>
        {preview ? (
          <div style={{ padding: 18, userSelect: 'text', WebkitUserSelect: 'text' }}>
            <Markdown text={fileText} />
          </div>
        ) : (
          <textarea
            value={fileText}
            onChange={(e) => setFileText(e.target.value)}
            spellCheck={false}
            placeholder="在这里编辑内容（Markdown 语法）…"
            style={{
              width: '100%',
              height: '100%',
              minHeight: 300,
              border: 'none',
              outline: 'none',
              resize: 'none',
              padding: 18,
              fontSize: 14,
              lineHeight: 1.8,
              background: 'var(--nf-bg)',
              color: 'var(--nf-text)',
              fontFamily: 'inherit',
              userSelect: 'text',
              WebkitUserSelect: 'text'
            }}
          />
        )}
      </div>
    </div>
  )
}
