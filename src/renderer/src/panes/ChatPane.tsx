import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useChatStore, type ChatMsg, type PendingWriteInfo } from '../stores/chatStore'
import { useProjectStore } from '../stores/projectStore'
import { useSettingsStore } from '../stores/settingsStore'
import { Markdown } from '../components/Markdown'
import { ImageGenDialog } from '../components/ImageGenDialog'

export function ChatPane(): React.JSX.Element {
  const {
    messages,
    input,
    setInput,
    send,
    stop,
    streaming,
    writingMode,
    setWritingMode,
    error,
    history,
    loadHistory,
    loadSession,
    clearHistory,
    confirmPending,
    rewritePending
  } = useChatStore()
  const { currentProject, loadChapters, chapters } = useProjectStore()
  const { providerState, appSettings } = useSettingsStore()
  const threadRef = useRef<HTMLDivElement>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [saveHint, setSaveHint] = useState<string | null>(null)
  const [showImageGen, setShowImageGen] = useState(false)
  const [showScrollDown, setShowScrollDown] = useState(false)

  useEffect(() => {
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id])

  // 混合模式关闭时，写作分身不可用 → 强制回到主编模型
  useEffect(() => {
    if (appSettings?.hybridMode === false && writingMode === 'draft') {
      setWritingMode('main')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appSettings?.hybridMode])

  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    // 仅当用户本就贴近底部时自动跟随（此前 streaming 期间强制滚底，会打断用户向上翻阅已生成内容）
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) {
      el.scrollTo({ top: el.scrollHeight })
      setShowScrollDown(false)
    } else {
      setShowScrollDown(true)
    }
  }, [messages, streaming])

  /** 监听手动滚动：滚到底隐藏按钮，滚上去显示 */
  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    const onScroll = (): void => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      setShowScrollDown(!nearBottom)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  /** 历史下拉：点击面板外关闭 */
  useEffect(() => {
    if (!showHistory) return
    const onClick = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('.history-popup')) setShowHistory(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [showHistory])

  const scrollToBottom = (): void => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
    setShowScrollDown(false)
  }

  const activeModel =
    providerState?.providers?.find((p: any) => p.id === providerState.activeProviderId)?.models?.find(
      (m: any) => m.id === providerState.activeModelId
    )?.name ?? '未配置模型'

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  /** 保存 AI 生成内容为章节（识别不到章号时默认接续下一章，保存前确认防覆盖） */
  const saveAsChapter = useCallback(
    async (text: string): Promise<void> => {
      const matched = guessChapterNumber(text)
      const number = matched ?? Math.max(0, ...chapters.map((c) => c.number)) + 1
      const hint = matched
        ? `将这段内容保存为第 ${number} 章？`
        : `内容中未识别到章节号，将保存为第 ${number} 章（当前正文最后一章的下一章）。\n保存？`
      if (!confirm(hint)) return
      await window.luobi.chapters.write(number, text)
      await loadChapters()
      setSaveHint(`✅ 已保存为 第${number}章`)
      setTimeout(() => setSaveHint(null), 3000)
    },
    [chapters, loadChapters]
  )

  return (
    <div className="ws-main">
      <div className="panel-header">
        <span>总编聊天</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--nf-muted)' }}>{activeModel}</span>
          <div style={{ position: 'relative' }}>
            <button
              className="nf-btn nf-btn--small nf-btn--ghost"
              onClick={() => {
                setShowHistory(!showHistory)
                loadHistory()
              }}
              title="历史会话"
            >
              🕘 {history.length > 0 ? history.length : ''}
            </button>
            {showHistory && (
              <div
                className="history-popup"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 28,
                  width: 260,
                  maxHeight: 320,
                  overflowY: 'auto',
                  background: 'var(--nf-surface)',
                  border: '1px solid var(--nf-line)',
                  borderRadius: 10,
                  boxShadow: 'var(--nf-shadow)',
                  zIndex: 50,
                  padding: 6
                }}
              >
                {history.length === 0 && <div className="empty-hint">暂无历史会话</div>}
                {history.map((s) => (
                  <div
                    key={s.id}
                    className="filetree-item"
                    onClick={async () => {
                      await loadSession(s.id)
                      setShowHistory(false)
                    }}
                  >
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.title || '（无标题）'}
                    </span>
                    <span className="kind">{s.messageCount} 条</span>
                  </div>
                ))}
                {history.length > 0 && (
                  <button
                    className="nf-btn nf-btn--small nf-btn--danger"
                    style={{ width: '100%', marginTop: 6 }}
                    onClick={async () => {
                      if (confirm('清空全部聊天历史？')) {
                        await clearHistory()
                        setShowHistory(false)
                      }
                    }}
                  >
                    清空历史
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
      <div className="chat-thread" ref={threadRef}>
        {messages.length === 0 && (
          <div className="empty-hint">
            {currentProject ? (
              <>
                与主编对话，让 AI 帮你创作《{currentProject.name}》。
                <br />
                例如：「根据总纲写第一章」或「帮我分析人物动机」。
              </>
            ) : (
              <>请在左侧选择或新建一个作品。</>
            )}
          </div>
        )}
        {messages.map((m) => (
          <ChatMessageRow
            key={m.id}
            msg={m}
            onConfirmPending={confirmPending}
            onRewritePending={rewritePending}
            onSaveAsChapter={saveAsChapter}
            saveHint={saveHint}
          />
        ))}
        {error && (
          <div className="selfcheck-issue selfcheck-issue--error" style={{ maxWidth: 600 }}>
            ❌ {error}
          </div>
        )}
        {showScrollDown && (
          <button
            className="nf-btn nf-btn--small chat-scroll-down"
            onClick={scrollToBottom}
            title="回到底部"
          >
            ⬇ 回到底部
          </button>
        )}
      </div>
      </div>
      <div className="chat-composer">
        <textarea
          value={input}
          placeholder="对主编说点什么…（Enter 发送，Shift+Enter 换行）"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="chat-composer-toolbar">
          <select
            className="nf-input"
            style={{ width: 130, padding: '5px 8px' }}
            value={appSettings?.hybridMode === false ? 'main' : writingMode}
            onChange={(e) => setWritingMode(e.target.value as 'main' | 'draft')}
            title={appSettings?.hybridMode === false ? '混合模式已关闭，写作分身跟随主编模型（设置中可开启）' : ''}
          >
            <option value="main">主编模型</option>
            <option value="draft" disabled={appSettings?.hybridMode === false}>
              {appSettings?.hybridMode === false ? '写作分身（已关闭）' : '写作分身（免费）'}
            </option>
          </select>
          <button className="nf-btn nf-btn--small" title="AI 图片生成" onClick={() => setShowImageGen(true)}>
            🖼
          </button>
          <div className="titlebar-spacer" />
          {streaming ? (
            <button className="nf-btn nf-btn--primary chat-send-btn" onClick={stop}>
              ⏹ 停止主编工作
            </button>
          ) : (
            <button
              className="nf-btn nf-btn--primary chat-send-btn"
              onClick={send}
              disabled={!input.trim() || !currentProject}
            >
              ✦ 发送
            </button>
          )}
        </div>
      </div>
      {showImageGen && <ImageGenDialog onClose={() => setShowImageGen(false)} />}
    </div>
  )
}

/**
 * 单条聊天消息行（React.memo：流式 delta 只更新一条消息引用，其余行跳过渲染，
 * 避免长对话/大字正文场景下 50ms 一次的全量 markdown 重渲染）
 */
const ChatMessageRow = React.memo(function ChatMessageRow({
  msg,
  onConfirmPending,
  onRewritePending,
  onSaveAsChapter,
  saveHint
}: {
  msg: ChatMsg
  onConfirmPending: (key: string) => Promise<boolean>
  onRewritePending: (pending: PendingWriteInfo) => Promise<void>
  onSaveAsChapter: (text: string) => Promise<void>
  saveHint: string | null
}): React.JSX.Element {
  return (
    <div className={`chat-message-row chat-message-row--${msg.role}`}>
      <div className={`chat-avatar chat-avatar--${msg.role}`}>{msg.role === 'user' ? '你' : '编'}</div>
      <div>
        {/* 工具执行提示（read/write 等）不显示，保持界面干净；仅保留：待确认、图片、系统通知（章节自动整理） */}
        {msg.pending && (
          <PendingWriteCard pending={msg.pending} state={msg.pendingState ?? 'pending'} onConfirm={onConfirmPending} onRewrite={onRewritePending} />
        )}
        {msg.images && msg.images.length > 0 && <ToolImages images={msg.images} />}
        {msg.tool && msg.tool.name === '章节自动整理' && (
          <div className={`tool-card${(msg.tool.summary ?? '').startsWith('✅') ? ' tool-card--done' : ' tool-card--running'}`}>
            <span>{msg.tool.summary}</span>
          </div>
        )}
        {(msg.content || msg.streaming || msg.reasoning) && (
          <div className="chat-bubble">
            {msg.content ? (
              <Markdown text={msg.content} />
            ) : (
              msg.streaming && <span className="chat-streaming-indicator">主编正在思考</span>
            )}
            {msg.reasoning && !msg.content && (
              <div className="chat-thinking">💭 {msg.reasoning.slice(0, 120)}...</div>
            )}
            {msg.streaming && msg.content && (
              <span className="chat-streaming-indicator">▍</span>
            )}
          </div>
        )}
        {/* AI 生成内容可保存为章节 */}
        {msg.role === 'assistant' && !msg.streaming && msg.content.trim().length > 20 && (
          <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="nf-btn nf-btn--small" onClick={() => onSaveAsChapter(msg.content)}>
              📄 保存为章节
            </button>
            {saveHint && <span style={{ fontSize: 11, color: 'var(--nf-success)' }}>{saveHint}</span>}
          </div>
        )}
      </div>
    </div>
  )
})

/** 工具生成的图片预览 */
function ToolImages({ images }: { images: string[] }): React.JSX.Element {
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    let alive = true
    for (const p of images) {
      window.luobi.image
        .readFile(p)
        .then((url: string) => {
          if (alive) setUrls((prev) => ({ ...prev, [p]: url }))
        })
        .catch(() => {})
    }
    return () => {
      alive = false
    }
  }, [images])
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
      {images.map((p) =>
        urls[p] ? (
          <img
            key={p}
            src={urls[p]}
            alt="AI 生成图片"
            style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--nf-line)', cursor: 'pointer' }}
            onClick={() => window.luobi.materials.openFolder('创作资料/生成图片')}
            title={p}
          />
        ) : (
          <div key={p} style={{ width: 120, height: 120, display: 'grid', placeItems: 'center', background: 'var(--nf-bg-3)', borderRadius: 8, fontSize: 11, color: 'var(--nf-muted)' }}>
            加载中…
          </div>
        )
      )}
    </div>
  )
}

function guessChapterNumber(text: string): number {
  const m = text.match(/^第\s*(\d+)\s*章/m)
  return m ? parseInt(m[1], 10) : 1
}

/** 待确认写入卡片：预览 → 重写 / 保存 */
function PendingWriteCard({
  pending,
  state,
  onConfirm,
  onRewrite
}: {
  pending: PendingWriteInfo
  state: 'pending' | 'saved' | 'replaced'
  onConfirm: (key: string) => Promise<boolean>
  onRewrite: (pending: PendingWriteInfo) => Promise<void>
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const kindLabel =
    pending.kind === 'outline'
      ? '大纲'
      : pending.kind === 'deposition'
        ? '设定'
        : pending.kind === 'global_rule'
          ? '全局规则'
          : '正文'
  const fileName = pending.path.split('/').pop() ?? pending.path

  if (state === 'saved') {
    return <div className="tool-card tool-card--done">✅ 已保存：{pending.path}（{pending.content.length} 字）</div>
  }
  if (state === 'replaced') {
    return <div className="tool-card">🔄 已重写，以上内容作废</div>
  }

  return (
    <div
      style={{
        border: '1px solid var(--nf-accent)',
        borderRadius: 10,
        background: 'var(--nf-surface)',
        marginTop: 6,
        overflow: 'hidden',
        maxWidth: 520
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--nf-accent-soft)' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>📋 待确认：{kindLabel}</span>
        <span style={{ fontSize: 11, color: 'var(--nf-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pending.path}
        </span>
        <button className="nf-btn nf-btn--small" onClick={() => setExpanded(!expanded)}>
          {expanded ? '收起' : '预览'}
        </button>
      </div>
      {expanded && (
        <div style={{ padding: 10, maxHeight: 260, overflowY: 'auto', fontSize: 12, lineHeight: 1.7, userSelect: 'text', WebkitUserSelect: 'text', borderTop: '1px solid var(--nf-line)' }}>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{pending.content}</pre>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, padding: 8, borderTop: '1px solid var(--nf-line)' }}>
        <button
          className="nf-btn nf-btn--small nf-btn--primary"
          onClick={async () => {
            await onConfirm(pending.key)
          }}
        >
          💾 保存到 {fileName}
        </button>
        <button className="nf-btn nf-btn--small" onClick={() => onRewrite(pending)}>
          🔄 重写
        </button>
      </div>
    </div>
  )
}
