import React, { useCallback, useEffect, useState } from 'react'
import { StartupSplash } from './components/StartupSplash'
import { TitleBar } from './components/TitleBar'
import { ChatPane } from './panes/ChatPane'
import { ProjectsPane } from './panes/ProjectsPane'
import { OutlinePane, DepositionPane, MemoryPane, MaterialsPane } from './panes/MaterialPanes'
import { MusicPane } from './panes/MusicPane'
import { MiniPlayer } from './components/MiniPlayer'
import { FullLyricView } from './components/FullLyricView'
import { SettingsModal } from './settings/SettingsModal'
import { AgentsModal } from './settings/AgentsModal'
import { ChapterEditorPage } from './editor/ChapterEditor'
import { FileEditorPage } from './editor/FileEditorPage'
import { useProjectStore } from './stores/projectStore'
import { useChatStore } from './stores/chatStore'
import { useSettingsStore, subscribeSettingsEvents } from './stores/settingsStore'
import { subscribeChatEvents } from './stores/chatStore'
import { useEditorStore } from './stores/editorStore'
import { useMusicStore } from './stores/musicStore'

const RIGHT_TABS = [
  ['outline', '大纲'],
  ['deposition', '设定'],
  ['memory', '记忆'],
  ['materials', '资料'],
  ['music', '🎵 音乐']
] as const

export default function App(): React.JSX.Element {
  const [booted, setBooted] = useState(false)
  // 稳定引用：否则 StartupSplash 的 effect 依赖 [onDone] 会被启动期多次渲染重置计时器
  const onSplashDone = useCallback(() => setBooted(true), [])
  const [rightTab, setRightTab] = useState<string>('outline')
  const [showSettings, setShowSettings] = useState(false)
  const [showAgents, setShowAgents] = useState(false)
  const { loadCurrent, loadProjects, refreshAll, currentProject } = useProjectStore()
  const { load: loadSettings } = useSettingsStore()
  const { tabs, activeTabId, setActiveTab, closeTab } = useEditorStore()

  useEffect(() => {
    loadSettings()
    const offChat = subscribeChatEvents()
    const offSettings = subscribeSettingsEvents()
    loadProjects()
    // 注意：聊天历史由 ChatPane 挂载后自行加载（依赖 currentProject.id），此处不重复请求
    const offChanged = window.luobi.projects.onChanged(() => {
      refreshAll()
      useChatStore.getState().loadHistory()
    })
    const offProgress = window.luobi.chapters.onProgress(() => {
      useProjectStore.getState().loadChapters()
    })
    loadCurrent()
    // 音乐音频单例（常驻，不随面板开关销毁 → 写作时切面板音乐继续）
    useMusicStore.getState().ensureAudio()
    return () => {
      offChat()
      offSettings()
      offChanged()
      offProgress()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]

  // 未保存标签数上报主进程（用于关闭窗口前拦截确认，防误关丢稿）
  const dirtyCount = tabs.filter((t) => t.dirty).length
  useEffect(() => {
    window.luobi.system.setDirtyCount(dirtyCount)
  }, [dirtyCount])

  return (
    <>
      {!booted && <StartupSplash onDone={onSplashDone} />}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <TitleBar onOpenSettings={() => setShowSettings(true)} onOpenAgents={() => setShowAgents(true)} />
        <div className="workspace">
          {/* 左侧：作品 + 章节树 */}
          <ProjectsPane />
          {/* 中间：标签栏 + 编辑器页面（VSCode 式） */}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="editor-tabs">
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`editor-tab${tab.id === activeTabId ? ' editor-tab--active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span className="editor-tab-icon">{tab.type === 'chat' ? '💬' : '📄'}</span>
                  <span className="editor-tab-title">{tab.title}</span>
                  {tab.id !== 'chat' && (
                    <button
                      className="editor-tab-close"
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTab(tab.id)
                      }}
                      title="关闭"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div
              key={activeTab?.id ?? 'none'}
              style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            >
              {activeTab?.type === 'chapter' && activeTab.chapterNumber ? (
                <ChapterEditorPage chapterNumber={activeTab.chapterNumber} />
              ) : activeTab?.type === 'file' && activeTab.filePath && activeTab.fileKind ? (
                <FileEditorPage filePath={activeTab.filePath} kind={activeTab.fileKind} />
              ) : (
                <ChatPane />
              )}
            </div>
          </div>
          {/* 右侧：创作资料面板 */}
          <div className="ws-right">
            <div className="right-tabs">
              {RIGHT_TABS.map(([key, label]) => (
                <button
                  key={key}
                  className={`right-tab${rightTab === key ? ' right-tab--active' : ''}`}
                  onClick={() => setRightTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div
              key={`${currentProject?.id ?? 'none'}-${rightTab}`}
              style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
            >
              {rightTab === 'outline' && <OutlinePane />}
              {rightTab === 'deposition' && <DepositionPane />}
              {rightTab === 'memory' && <MemoryPane />}
              {rightTab === 'materials' && <MaterialsPane />}
              {rightTab === 'music' && <MusicPane />}
            </div>
          </div>
        </div>
      </div>
      {/* 全局迷你播放条：音乐面板收起时仍可控（写小说场景） */}
      {rightTab !== 'music' && <MiniPlayer onOpen={() => setRightTab('music')} />}
      {/* 全屏大歌词页（📜 打开；Esc 或 ← 返回） */}
      <FullLyricView />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showAgents && <AgentsModal onClose={() => setShowAgents(false)} />}
    </>
  )
}
