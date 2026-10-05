/**
 * preload 桥接层：暴露 window.luobi.<domain>.<action>()
 * 渲染层桥接，renderer 不直连 fs/fetch
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'

function invoke<T = any>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args)
}

function on(channel: string, cb: (payload: unknown) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  projects: {
    getCurrent: () => invoke(IPC.projects.getCurrent),
    list: () => invoke(IPC.projects.list),
    create: (name: string) => invoke(IPC.projects.create, name),
    select: (id: string) => invoke(IPC.projects.select, id),
    delete: (id: string) => invoke(IPC.projects.delete, id),
    rename: (id: string, name: string) => invoke(IPC.projects.rename, id, name),
    listTrash: () => invoke(IPC.projects.listTrash),
    restoreTrash: (id: string) => invoke(IPC.projects.restoreTrash, id),
    deleteTrash: (id: string) => invoke(IPC.projects.deleteTrash, id),
    openTrashFolder: () => invoke(IPC.projects.openTrashFolder),
    getTree: () => invoke(IPC.projects.getTree),
    onChanged: (cb: () => void) => on(IPC.projects.eventChanged, cb),
    onTrashChanged: (cb: () => void) => on(IPC.projects.eventTrashChanged, cb)
  },
  chapters: {
    list: () => invoke(IPC.chapters.list),
    read: (number: number) => invoke(IPC.chapters.read, number),
    write: (number: number, text: string) => invoke(IPC.chapters.write, number, text),
    listHistory: (number: number) => invoke(IPC.chapters.listHistory, number),
    readHistory: (relPath: string) => invoke(IPC.chapters.readHistory, relPath),
    revertHistory: (number: number, relPath: string) => invoke(IPC.chapters.revertHistory, number, relPath),
    delete: (number: number) => invoke(IPC.chapters.delete, number),
    onChanged: (cb: () => void) => on(IPC.chapters.eventChanged, cb),
    onProgress: (cb: () => void) => on(IPC.chapters.eventProgress, cb)
  },
  materials: {
    list: () => invoke(IPC.materials.list),
    read: (relPath: string) => invoke(IPC.materials.read, relPath),
    write: (relPath: string, content: string) => invoke(IPC.materials.write, relPath, content),
    delete: (relPath: string) => invoke(IPC.materials.delete, relPath),
    rename: (relPath: string, newName: string) => invoke(IPC.materials.rename, relPath, newName),
    createFolder: (parentRel: string, folderName: string) => invoke(IPC.materials.createFolder, parentRel, folderName),
    importFiles: () => invoke(IPC.materials.importFiles),
    openFile: (relPath: string) => invoke(IPC.materials.openFile, relPath),
    openFolder: (relPath?: string) => invoke(IPC.materials.openFolder, relPath)
  },
  outline: {
    list: () => invoke(IPC.outline.list),
    read: (relPath: string) => invoke(IPC.outline.read, relPath),
    write: (relPath: string, content: string) => invoke(IPC.outline.write, relPath, content),
    create: (kind: 'volume' | 'chapter', number: number, title?: string) => invoke(IPC.outline.create, kind, number, title),
    delete: (relPath: string) => invoke(IPC.outline.delete, relPath)
  },
  memory: {
    list: () => invoke(IPC.memory.list),
    read: (relPath: string) => invoke(IPC.memory.read, relPath),
    write: (relPath: string, content: string) => invoke(IPC.memory.write, relPath, content),
    delete: (relPath: string) => invoke(IPC.memory.delete, relPath)
  },
  deposition: {
    list: () => invoke(IPC.deposition.list),
    read: (relPath: string) => invoke(IPC.deposition.read, relPath),
    write: (relPath: string, content: string) => invoke(IPC.deposition.write, relPath, content),
    delete: (relPath: string) => invoke(IPC.deposition.delete, relPath)
  },
  chat: {
    chat: (req: unknown) => invoke(IPC.chat.chat, req),
    stop: (runId: string) => invoke(IPC.chat.stop, runId),
    getHistory: () => invoke(IPC.chat.getHistory),
    getSession: (sessionId: string) => invoke(IPC.chat.getSession, sessionId),
    clearHistory: () => invoke(IPC.chat.clearHistory),
    confirmWrite: (key: string) => invoke(IPC.chat.confirmWrite, key),
    listRunStates: () => invoke(IPC.chat.listRunStates),
    onEvent: (cb: (payload: unknown) => void) => on(IPC.chat.event, cb),
    onHistoryChanged: (cb: () => void) => on(IPC.chat.historyChanged, cb)
  },
  agents: {
    list: () => invoke(IPC.agents.list),
    create: (input: { name: string; kind?: string }) => invoke(IPC.agents.create, input),
    duplicate: (id: string) => invoke(IPC.agents.duplicate, id),
    update: (id: string, patch: unknown) => invoke(IPC.agents.update, id, patch),
    delete: (id: string) => invoke(IPC.agents.delete, id),
    reorder: (ids: string[]) => invoke(IPC.agents.reorder, ids),
    run: (agentId: string, req: unknown) => invoke(IPC.agents.run, agentId, req),
    onRunEvent: (cb: (payload: unknown) => void) => on(IPC.agents.runEvent, cb)
  },
  provider: {
    getSummary: () => invoke(IPC.provider.getSummary),
    save: (config: unknown) => invoke(IPC.provider.save, config),
    remove: (id: string) => invoke(IPC.provider.remove, id),
    select: (providerId: string, modelId: string) => invoke(IPC.provider.select, providerId, modelId),
    listModels: () => invoke(IPC.provider.listModels),
    test: (baseUrl: string, apiKey: string) => invoke(IPC.provider.test, baseUrl, apiKey)
  },
  rules: {
    list: () => invoke(IPC.rules.list),
    read: (absPath: string) => invoke(IPC.rules.read, absPath),
    write: (absPath: string, content: string) => invoke(IPC.rules.write, absPath, content),
    delete: (absPath: string) => invoke(IPC.rules.delete, absPath),
    getDirs: () => invoke(IPC.rules.getDirs),
    selfCheck: (text: string) => invoke(IPC.rules.selfCheck, text),
    listReviews: () => invoke(IPC.rules.listReviews),
    readReview: (name: string) => invoke(IPC.rules.readReview, name)
  },
  usage: {
    get: () => invoke(IPC.usage.get),
    onUpdated: (cb: (payload: unknown) => void) => on(IPC.usage.eventUpdated, cb)
  },
  settings: {
    get: () => invoke(IPC.settings.get),
    save: (settings: unknown) => invoke(IPC.settings.save, settings),
    getProject: () => invoke(IPC.settings.getProject),
    saveProject: (settings: unknown) => invoke(IPC.settings.saveProject, settings),
    exportProject: () => invoke(IPC.settings.exportProject),
    openDataFolder: () => invoke(IPC.settings.openDataFolder)
  },
  image: {
    getConfig: () => invoke(IPC.image.getConfig),
    saveConfig: (config: unknown) => invoke(IPC.image.saveConfig, config),
    generate: (prompt: string, opts?: unknown) => invoke(IPC.image.generate, prompt, opts),
    readFile: (relPath: string) => invoke(IPC.image.readFile, relPath),
    saveDerived: (dataUrl: string, label: string) => invoke(IPC.image.saveDerived, dataUrl, label),
    comfyStatus: () => invoke(IPC.image.comfyStatus),
    comfyStart: () => invoke(IPC.image.comfyStart),
    onComfyStatus: (cb: (payload: { status: 'idle' | 'starting' | 'ready' | 'failed'; message?: string }) => void) =>
      on(IPC.image.eventComfyStatus, cb as (payload: unknown) => void),
    onGenerated: (cb: (payload: unknown) => void) => on(IPC.image.eventGenerated, cb)
  },
  music: {
    search: (keywords: string, opts?: { source?: string; type?: number; curpage?: number }) =>
      invoke(IPC.music.search, keywords, opts),
    getPlaylist: (listId: string) => invoke(IPC.music.getPlaylist, listId),
    showPlaylists: (source: string, offset: number, filterId: string) =>
      invoke(IPC.music.showPlaylists, source, offset, filterId),
    getTrackUrl: (track: unknown) => invoke(IPC.music.getTrackUrl, track),
    lyric: (track: unknown) => invoke(IPC.music.lyric, track),
    getLibrary: () => invoke(IPC.music.getLibrary),
    toggleFavorite: (track: unknown) => invoke(IPC.music.toggleFavorite, track),
    recordPlay: (track: unknown) => invoke(IPC.music.recordPlay, track),
    /** 已安装的音乐源名（空数组 = 未安装，UI 据此显示空状态） */
    sources: () => invoke(IPC.music.sources)
  },
  system: {
    info: () => invoke(IPC.system.info),
    openExternal: (url: string) => invoke(IPC.system.openExternal, url),
    setZoom: (factor: number) => invoke(IPC.system.setZoom, factor),
    setTheme: (theme: string) => invoke(IPC.system.setTheme, theme),
    windowAction: (action: 'minimize' | 'maximize' | 'close') => invoke(IPC.system.windowAction, action),
    openChapterEditor: (opts?: unknown) => invoke(IPC.system.openChapterEditor, opts),
    closeChapterEditor: () => invoke(IPC.system.closeChapterEditor),
    setDirtyCount: (count: number) => invoke(IPC.system.setDirtyCount, count),
    onThemeChanged: (cb: (payload: unknown) => void) => on(IPC.system.eventThemeChanged, cb)
  }
}

contextBridge.exposeInMainWorld('luobi', api)

export type LuobiApi = typeof api
