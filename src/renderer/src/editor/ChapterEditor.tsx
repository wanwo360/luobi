import React, { useState } from 'react'
import { useEditorStore } from '../stores/editorStore'
import { useProjectStore } from '../stores/projectStore'
import { formatChars } from '../panes/DraftPane'

/** 章节编辑器页面（VSCode 式：标签栏内的独立页面，非全屏弹层） */
export function ChapterEditorPage({ chapterNumber }: { chapterNumber: number }): React.JSX.Element {
  const { chapterText, setChapterText, markChapterSaved, dirty, chapterHistory, showHistory, toggleHistory, setChapterHistory } =
    useEditorStore()
  const { loadChapters } = useProjectStore()
  const [checkReport, setCheckReport] = useState<any | null>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedHint, setSavedHint] = useState(false)
  const [historyContent, setHistoryContent] = useState<string | null>(null)

  const chars = chapterText.replace(/\s/g, '').length

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    await window.luobi.chapters.write(chapterNumber, chapterText)
    markChapterSaved()
    setChapterHistory(await window.luobi.chapters.listHistory(chapterNumber))
    await loadChapters()
    setSavedHint(true)
    setSaving(false)
    setTimeout(() => setSavedHint(false), 2000)
  }

  const handleCheck = async (): Promise<void> => {
    setChecking(true)
    const report = await window.luobi.rules.selfCheck(chapterText)
    setCheckReport(report)
    setChecking(false)
  }

  const viewHistory = async (relPath: string): Promise<void> => {
    setHistoryContent(await window.luobi.chapters.readHistory(relPath))
  }

  const revertHistory = async (relPath: string): Promise<void> => {
    const content = await window.luobi.chapters.readHistory(relPath)
    setChapterText(content)
    await window.luobi.chapters.write(chapterNumber, content)
    markChapterSaved()
    setChapterHistory(await window.luobi.chapters.listHistory(chapterNumber))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 编辑器工具栏 */}
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--nf-line)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--nf-bg-2)', flex: '0 0 auto' }}>
        <strong>第 {chapterNumber} 章</strong>
        <span style={{ fontSize: 12, color: 'var(--nf-muted)' }}>{formatChars(chars)}</span>
        <div className="titlebar-spacer" />
        <button className="nf-btn nf-btn--small" onClick={handleCheck} disabled={checking}>
          {checking ? '检查中…' : '🔍 规则自检'}
        </button>
        <button className="nf-btn nf-btn--small" onClick={toggleHistory}>
          🕘 历史 {chapterHistory.length}
        </button>
        <button className="nf-btn nf-btn--small nf-btn--primary" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? '保存中…' : dirty ? '💾 保存' : '已保存 ✓'}
        </button>
        {savedHint && <span style={{ fontSize: 12, color: 'var(--nf-success)' }}>已保存并生成历史版本</span>}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* 正文编辑区 */}
        <textarea
          value={chapterText}
          onChange={(e) => setChapterText(e.target.value)}
          spellCheck={false}
          placeholder="在这里写正文…"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            resize: 'none',
            padding: 18,
            fontSize: 15,
            lineHeight: 1.9,
            background: 'var(--nf-bg)',
            color: 'var(--nf-text)',
            userSelect: 'text',
            WebkitUserSelect: 'text'
          }}
        />
        {/* 自检报告侧栏 */}
        {checkReport && !showHistory && (
          <div style={{ width: 320, borderLeft: '1px solid var(--nf-line)', overflowY: 'auto', padding: 12, background: 'var(--nf-bg-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <strong style={{ fontSize: 13 }}>{checkReport.passed ? '✅ 自检通过' : '⚠️ 发现问题'}</strong>
              <div className="titlebar-spacer" />
              <button className="nf-btn nf-btn--small" onClick={() => setCheckReport(null)}>
                ✕
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--nf-muted)', margin: '4px 0' }}>
              {checkReport.wordCount} 字（目标 {checkReport.targetRange}）
            </div>
            <div className="selfcheck-issues">
              {checkReport.issues.map((iss: any, i: number) => (
                <div key={i} className={`selfcheck-issue selfcheck-issue--${iss.severity}`}>
                  <div>{iss.message}</div>
                  {iss.line > 0 && <div style={{ opacity: 0.7 }}>行 {iss.line}：{iss.quote}</div>}
                  {iss.suggestion && <div style={{ opacity: 0.8 }}>→ {iss.suggestion}</div>}
                </div>
              ))}
              {checkReport.issues.length === 0 && <div className="selfcheck-issue">未检测到问题 ✓</div>}
            </div>
          </div>
        )}
        {/* 历史版本侧栏 */}
        {showHistory && (
          <div style={{ width: 320, borderLeft: '1px solid var(--nf-line)', overflowY: 'auto', padding: 12, background: 'var(--nf-bg-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>历史版本</strong>
              <div className="titlebar-spacer" />
              <button className="nf-btn nf-btn--small" onClick={toggleHistory}>
                ✕
              </button>
            </div>
            {chapterHistory.length === 0 && <div className="empty-hint">暂无历史版本</div>}
            {chapterHistory.map((h) => (
              <div key={h.path} style={{ border: '1px solid var(--nf-line)', borderRadius: 8, padding: 8, marginBottom: 6, background: 'var(--nf-surface)' }}>
                <div style={{ fontSize: 12 }}>{h.name.replace(/^第\d+章_/, '')}</div>
                <div style={{ fontSize: 11, color: 'var(--nf-muted)' }}>{formatChars(h.chars)}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button className="nf-btn nf-btn--small" onClick={() => viewHistory(h.path)}>
                    查看
                  </button>
                  <button className="nf-btn nf-btn--small" onClick={() => revertHistory(h.path)}>
                    回滚
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 历史版本内容浮层 */}
      {historyContent && (
        <div
          style={{
            position: 'fixed',
            inset: '0 0 0 0',
            zIndex: 600,
            background: 'var(--nf-bg)',
            padding: 20,
            overflow: 'auto',
            borderTop: '1px solid var(--nf-line)',
            ...({ WebkitAppRegion: 'no-drag' } as React.CSSProperties)
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <strong>历史版本内容</strong>
            <div className="titlebar-spacer" />
            <button className="nf-btn nf-btn--small" onClick={() => setHistoryContent(null)}>
              ✕ 关闭
            </button>
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.9, userSelect: 'text' }}>
            {historyContent}
          </pre>
        </div>
      )}
    </div>
  )
}
