import { create } from 'zustand'
import type { HistoryVersion } from '@shared/types/chapter'

export type FileKind = 'outline' | 'deposition' | 'memory' | 'materials'

export interface EditorTab {
  id: string
  type: 'chat' | 'chapter' | 'file'
  title: string
  chapterNumber?: number
  filePath?: string
  fileKind?: FileKind
  /** 内容快照（每个标签独立保存，切换时恢复，防止显示错乱） */
  content?: string
  original?: string
  dirty?: boolean
}

interface EditorState {
  tabs: EditorTab[]
  activeTabId: string
  /** 章节编辑状态（当前激活标签） */
  chapterText: string
  chapterOriginal: string
  dirty: boolean
  chapterHistory: HistoryVersion[]
  showHistory: boolean
  /** 资料文件编辑状态（当前激活标签） */
  fileText: string
  fileOriginal: string
  fileDirty: boolean

  openChat: () => void
  clearNonChatTabs: () => void
  openChapter: (number: number, text: string) => Promise<void>
  openFile: (relPath: string, kind: FileKind, name?: string) => Promise<void>
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  setChapterText: (text: string) => void
  markChapterSaved: () => void
  setChapterHistory: (history: any[]) => void
  toggleHistory: () => void
  setFileText: (text: string) => void
  markFileSaved: () => void
}

/** 读取章节内容（供切换标签时按标签加载） */
async function loadChapterContent(tab: EditorTab): Promise<{ content: string; history: HistoryVersion[] }> {
  const read = await window.luobi.chapters.read(tab.chapterNumber!)
  const history = (await window.luobi.chapters.listHistory(tab.chapterNumber!)) as HistoryVersion[]
  return { content: read?.text ?? '', history }
}

/** 读取文件内容（供切换标签时按标签加载） */
async function loadFileContent(tab: EditorTab): Promise<string> {
  const readers: Record<FileKind, (p: string) => Promise<any>> = {
    outline: (p) => window.luobi.outline.read(p),
    deposition: (p) => window.luobi.deposition.read(p),
    memory: (p) => window.luobi.memory.read(p),
    materials: (p) => window.luobi.materials.read(p)
  }
  try {
    const raw = await readers[tab.fileKind!](tab.filePath!)
    return typeof raw === 'string' ? raw : (raw?.content ?? '')
  } catch {
    return ''
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [{ id: 'chat', type: 'chat', title: '聊天' }],
  activeTabId: 'chat',
  chapterText: '',
  chapterOriginal: '',
  dirty: false,
  chapterHistory: [],
  showHistory: false,
  fileText: '',
  fileOriginal: '',
  fileDirty: false,

  openChat: () => set({ activeTabId: 'chat' }),

  /** 切换作品时关闭所有打开的文件/章节标签（保留聊天）；有未保存改动时确认（防丢稿） */
  clearNonChatTabs: () => {
    const { tabs } = get()
    const dirtyTab = tabs.find((t) => t.id !== 'chat' && t.dirty)
    if (dirtyTab && !confirm(`「${dirtyTab.title}」有未保存的修改，切换作品将丢失该修改，继续？`)) {
      return
    }
    set({
      tabs: [{ id: 'chat', type: 'chat', title: '聊天' }],
      activeTabId: 'chat'
    })
  },

  openChapter: async (number, text) => {
    const id = `chapter-${number}`
    const { tabs } = get()
    if (!tabs.some((t) => t.id === id)) {
      set({ tabs: [...tabs, { id, type: 'chapter', title: `第${number}章`, chapterNumber: number }] })
    }
    const read = await window.luobi.chapters.read(number)
    const history = await window.luobi.chapters.listHistory(number)
    const content = read?.text ?? text
    // 内容快照保存到标签上（每个标签独立）
    set({
      activeTabId: id,
      tabs: get().tabs.map((t) =>
        t.id === id ? { ...t, content, original: content, dirty: false } : t
      ),
      chapterText: content,
      chapterOriginal: content,
      dirty: false,
      chapterHistory: history,
      showHistory: false
    })
  },

  openFile: async (relPath, kind, name) => {
    const id = `file-${kind}-${relPath}`
    const { tabs } = get()
    const title = name ?? relPath.split('/').pop() ?? '文件'
    if (!tabs.some((t) => t.id === id)) {
      set({ tabs: [...tabs, { id, type: 'file', title, filePath: relPath, fileKind: kind }] })
    }
    // 读取内容（按 kind 选择读取通道）
    const content = await loadFileContent({ id, type: 'file', title, filePath: relPath, fileKind: kind })
    set({
      activeTabId: id,
      tabs: get().tabs.map((t) =>
        t.id === id ? { ...t, content, original: content, dirty: false } : t
      ),
      fileText: content,
      fileOriginal: content,
      fileDirty: false
    })
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get()
    const idx = tabs.findIndex((t) => t.id === id)
    const tab = tabs[idx]
    // 未保存改动的标签关闭前确认，防止误点击丢失正文/资料内容
    if (tab?.dirty && !confirm(`「${tab.title}」有未保存的修改，关闭后将丢失，确定关闭？`)) {
      return
    }
    const next = tabs.filter((t) => t.id !== id)
    if (next.length === 0) {
      next.push({ id: 'chat', type: 'chat', title: '聊天' })
    }
    set({
      tabs: next,
      activeTabId: activeTabId === id ? next[Math.min(idx, next.length - 1)].id : activeTabId
    })
  },

  setActiveTab: (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return
    set({ activeTabId: id })
    // 切换标签：恢复该标签自己的内容（快照有则直接恢复，无则按标签读取）
    if (tab.type === 'chapter' && tab.chapterNumber) {
      if (tab.content !== undefined) {
        set({
          chapterText: tab.content,
          chapterOriginal: tab.original ?? tab.content,
          dirty: tab.dirty ?? false
        })
      } else {
        void loadChapterContent(tab).then(({ content, history }) => {
          // 只在该标签仍是激活标签时应用
          if (get().activeTabId === id) {
            set({
              chapterText: content,
              chapterOriginal: content,
              dirty: false,
              chapterHistory: history,
              tabs: get().tabs.map((t) =>
                t.id === id ? { ...t, content, original: content, dirty: false } : t
              )
            })
          }
        })
      }
    } else if (tab.type === 'file' && tab.filePath && tab.fileKind) {
      if (tab.content !== undefined) {
        set({
          fileText: tab.content,
          fileOriginal: tab.original ?? tab.content,
          fileDirty: tab.dirty ?? false
        })
      } else {
        void loadFileContent(tab).then((content) => {
          if (get().activeTabId === id) {
            set({
              fileText: content,
              fileOriginal: content,
              fileDirty: false,
              tabs: get().tabs.map((t) =>
                t.id === id ? { ...t, content, original: content, dirty: false } : t
              )
            })
          }
        })
      }
    }
  },

  setChapterText: (text) => {
    const s = get()
    const dirty = text !== s.chapterOriginal
    set({
      chapterText: text,
      dirty,
      // 同步回当前标签的快照（切走再切回不丢修改）
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId && t.type === 'chapter' ? { ...t, content: text, dirty } : t
      )
    })
  },

  markChapterSaved: () => {
    const s = get()
    set({
      chapterOriginal: s.chapterText,
      dirty: false,
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId && t.type === 'chapter'
          ? { ...t, original: s.chapterText, content: s.chapterText, dirty: false }
          : t
      )
    })
  },

  setChapterHistory: (history) => set({ chapterHistory: history }),

  toggleHistory: () => set({ showHistory: !get().showHistory }),

  setFileText: (text) => {
    const s = get()
    const fileDirty = text !== s.fileOriginal
    set({
      fileText: text,
      fileDirty,
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId && t.type === 'file' ? { ...t, content: text, dirty: fileDirty } : t
      )
    })
  },

  markFileSaved: () => {
    const s = get()
    set({
      fileOriginal: s.fileText,
      fileDirty: false,
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId && t.type === 'file'
          ? { ...t, original: s.fileText, content: s.fileText, dirty: false }
          : t
      )
    })
  }
}))
