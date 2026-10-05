/**
 * IPC 通道常量 —— 命名规则：luobi:<domain>:<action>
 * invoke/handle 双向；主→渲染事件推送统一 <domain>:event / 显式事件名
 */

export const IPC = {
  projects: {
    getCurrent: 'luobi:projects:get-current',
    list: 'luobi:projects:list',
    create: 'luobi:projects:create',
    select: 'luobi:projects:select',
    delete: 'luobi:projects:delete',
    rename: 'luobi:projects:rename',
    listTrash: 'luobi:projects:list-trash',
    restoreTrash: 'luobi:projects:restore-trash',
    deleteTrash: 'luobi:projects:delete-trash',
    openTrashFolder: 'luobi:projects:open-trash-folder',
    getTree: 'luobi:projects:get-tree',
    eventChanged: 'luobi:projects:changed',
    eventTrashChanged: 'luobi:projects:trash-changed'
  },
  chapters: {
    list: 'luobi:chapters:list',
    read: 'luobi:chapters:read',
    write: 'luobi:chapters:write',
    listHistory: 'luobi:chapters:list-history',
    readHistory: 'luobi:chapters:read-history',
    revertHistory: 'luobi:chapters:revert-history',
    delete: 'luobi:chapters:delete',
    eventChanged: 'luobi:chapters:changed',
    eventProgress: 'luobi:chapter-progress:changed'
  },
  materials: {
    list: 'luobi:materials:list',
    read: 'luobi:materials:read',
    write: 'luobi:materials:write',
    delete: 'luobi:materials:delete',
    rename: 'luobi:materials:rename',
    createFolder: 'luobi:materials:create-folder',
    importFiles: 'luobi:materials:import-files',
    openFile: 'luobi:materials:open-file',
    openFolder: 'luobi:materials:open-structure-folder'
  },
  outline: {
    list: 'luobi:outline:list',
    read: 'luobi:outline:read',
    write: 'luobi:outline:write',
    create: 'luobi:outline:create',
    delete: 'luobi:outline:delete'
  },
  memory: {
    list: 'luobi:memory:list',
    read: 'luobi:memory:read',
    write: 'luobi:memory:write',
    delete: 'luobi:memory:delete'
  },
  deposition: {
    list: 'luobi:deposition:list',
    read: 'luobi:deposition:read',
    write: 'luobi:deposition:write',
    delete: 'luobi:deposition:delete'
  },
  chat: {
    chat: 'luobi:chat:chat',
    stop: 'luobi:chat:stop',
    resume: 'luobi:chat:resume',
    getHistory: 'luobi:chat:get-history',
    getSession: 'luobi:chat:get-session',
    clearHistory: 'luobi:chat:clear-history',
    listRunStates: 'luobi:chat:list-run-states',
    event: 'luobi:chat:event',
    confirmWrite: 'luobi:chat:confirm-write',
    historyChanged: 'luobi:chat:history-changed'
  },
  agents: {
    list: 'luobi:agents:list',
    create: 'luobi:agents:create',
    duplicate: 'luobi:agents:duplicate',
    update: 'luobi:agents:update',
    delete: 'luobi:agents:delete',
    reorder: 'luobi:agents:reorder',
    run: 'luobi:agents:run',
    runEvent: 'luobi:agents:run-event'
  },
  provider: {
    save: 'luobi:provider:save-chat-completions',
    remove: 'luobi:provider:remove',
    select: 'luobi:provider:select',
    getSummary: 'luobi:provider:get-summary',
    listModels: 'luobi:provider:list-models',
    test: 'luobi:provider:test'
  },
  rules: {
    list: 'luobi:rules:list',
    read: 'luobi:rules:read',
    write: 'luobi:rules:write',
    delete: 'luobi:rules:delete',
    getDirs: 'luobi:rules:get-dirs',
    selfCheck: 'luobi:rules:self-check',
    listReviews: 'luobi:rules:list-reviews',
    readReview: 'luobi:rules:read-review'
  },
  usage: {
    get: 'luobi:usage:get',
    eventUpdated: 'luobi:usage:updated'
  },
  settings: {
    get: 'luobi:settings:get',
    save: 'luobi:settings:save',
    getProject: 'luobi:settings:get-project',
    saveProject: 'luobi:settings:save-project',
    exportProject: 'luobi:settings:export-project',
    openDataFolder: 'luobi:settings:open-data-folder'
  },
  image: {
    getConfig: 'luobi:image:get-config',
    saveConfig: 'luobi:image:save-config',
    generate: 'luobi:image:generate',
    readFile: 'luobi:image:read-file',
    saveDerived: 'luobi:image:save-derived',
    comfyStatus: 'luobi:image:comfy-status',
    comfyStart: 'luobi:image:comfy-start',
    eventComfyStatus: 'luobi:image:comfy-status-changed',
    eventGenerated: 'luobi:image:generated'
  },
  music: {
    search: 'luobi:music:search',
    getPlaylist: 'luobi:music:get-playlist',
    showPlaylists: 'luobi:music:show-playlists',
    getTrackUrl: 'luobi:music:get-track-url',
    lyric: 'luobi:music:lyric',
    getLibrary: 'luobi:music:get-library',
    toggleFavorite: 'luobi:music:toggle-favorite',
    recordPlay: 'luobi:music:record-play',
    /** 已安装的音乐源名（为空 = 未安装任何音乐源） */
    sources: 'luobi:music:sources'
  },
  system: {
    info: 'luobi:system:info',
    openExternal: 'luobi:system:open-external',
    setZoom: 'luobi:system:set-zoom',
    setTheme: 'luobi:system:set-theme',
    windowAction: 'luobi:system:window-action',
    openChapterEditor: 'luobi:system:open-chapter-editor',
    closeChapterEditor: 'luobi:system:close-chapter-editor',
    setDirtyCount: 'luobi:system:set-dirty-count',
    eventThemeChanged: 'luobi:theme-changed'
  },
  filesystem: {
    resolveDrop: 'luobi:filesystem:resolve-drop',
    selectFiles: 'luobi:filesystem:select-files',
    openInFolder: 'luobi:filesystem:open-containing-folder'
  }
} as const
