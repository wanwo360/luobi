import { create } from 'zustand'
import type { ProjectSummary } from '@shared/data-layout'

interface ChapterInfo {
  number: number
  name: string
  path: string
  size: number
  chars: number
  updatedAt: string
}

interface ProjectState {
  projects: ProjectSummary[]
  currentProject: ProjectSummary | null
  chapters: ChapterInfo[]
  activeChapterNumber: number | null
  chapterText: string
  loading: boolean

  loadProjects: () => Promise<void>
  loadCurrent: () => Promise<void>
  loadChapters: () => Promise<void>
  createProject: (name: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  selectProject: (id: string) => Promise<void>
  openChapter: (number: number) => Promise<void>
  saveChapter: (number: number, text: string) => Promise<void>
  refreshAll: () => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  chapters: [],
  activeChapterNumber: null,
  chapterText: '',
  loading: false,

  loadProjects: async () => {
    const projects = await window.luobi.projects.list()
    set({ projects })
  },

  loadCurrent: async () => {
    const currentProject = await window.luobi.projects.getCurrent()
    set({ currentProject })
    if (currentProject) {
      await get().loadChapters()
    }
  },

  loadChapters: async () => {
    const chapters = await window.luobi.chapters.list()
    set({ chapters })
  },

  createProject: async (name) => {
    await window.luobi.projects.create(name)
    await get().loadCurrent()
    await get().loadProjects()
  },

  deleteProject: async (id) => {
    await window.luobi.projects.delete(id)
    // 删除的是当前作品：重置项目状态，防止幽灵项目继续渲染/报错
    if (get().currentProject?.id === id) {
      set({ currentProject: null, chapters: [], activeChapterNumber: null, chapterText: '' })
      // 关闭已打开的作品标签（章节/大纲/设定等）
      const { useEditorStore } = await import('./editorStore')
      useEditorStore.getState().clearNonChatTabs()
      // 清空聊天状态（旧作品的对话不再显示）
      const { useChatStore } = await import('./chatStore')
      useChatStore.getState().resetProject()
    }
    await get().loadProjects()
  },

  selectProject: async (id) => {
    if (id === get().currentProject?.id) return
    await window.luobi.projects.select(id)
    await get().loadCurrent()
    await get().loadProjects()
    // 切换作品：关闭旧作品的打开标签（保留聊天）
    const { useEditorStore } = await import('./editorStore')
    useEditorStore.getState().clearNonChatTabs()
  },

  openChapter: async (number) => {
    const { text } = await window.luobi.chapters.read(number)
    set({ activeChapterNumber: number, chapterText: text })
  },

  saveChapter: async (number, text) => {
    await window.luobi.chapters.write(number, text)
    await get().loadChapters()
  },

  refreshAll: async () => {
    await get().loadCurrent()
    await get().loadProjects()
  }
}))

export type { ChapterInfo }
