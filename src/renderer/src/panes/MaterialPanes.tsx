import React, { useEffect, useState } from 'react'
import { FileTree, type TreeNode } from '../components/FileTree'
import { useEditorStore, type FileKind } from '../stores/editorStore'

/**
 * 四个资料面板（大纲/设定沉淀/重点记忆/资料）
 * 点击文件 → 在中间标签页打开编辑；右键可删除/重命名；支持新建
 */

function useTree(load: () => Promise<TreeNode[]>): { nodes: TreeNode[]; reload: () => Promise<void> } {
  const [nodes, setNodes] = useState<TreeNode[]>([])
  const reload = async (): Promise<void> => {
    try {
      setNodes(await load())
    } catch {
      setNodes([])
    }
  }
  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { nodes, reload }
}

/** 新建：带扩展名 → 创建文件；否则创建文件夹 */
function makeCreateFile(
  write: (relPath: string, content: string) => Promise<unknown>,
  mkdir: (parent: string, name: string) => Promise<unknown>
) {
  return async (parentRel: string, name: string): Promise<boolean> => {
    const clean = name.trim()
    if (!clean) return false
    if (/\.(md|markdown|txt)$/i.test(clean)) {
      const path = `${parentRel}/${clean}`.replace(/^\/+/, '')
      await write(path, `# ${clean.replace(/\.(md|markdown|txt)$/i, '')}\n`)
    } else {
      await mkdir(parentRel, clean)
    }
    return true
  }
}

interface PaneProps {
  kind: FileKind
  load: () => Promise<TreeNode[]>
  read: (p: string) => Promise<unknown>
  write: (p: string, c: string) => Promise<unknown>
  del: (p: string) => Promise<unknown>
  header: string
  headerExtra?: (reload: () => Promise<void>) => React.ReactNode
  emptyHint: string
}

function MaterialPane({ kind, load, read, write, del, header, headerExtra, emptyHint }: PaneProps): React.JSX.Element {
  const { nodes, reload } = useTree(load)
  const openFile = useEditorStore((s) => s.openFile)

  return (
    <>
      <div className="panel-header">
        <span>{header}</span>
        <div style={{ display: 'flex', gap: 4 }}>{headerExtra?.(reload)}</div>
      </div>
      <FileTree
        nodes={nodes}
        onOpenFile={(p, name) => openFile(p, kind, name)}
        onOpenDir={(p) => window.luobi.materials.openFolder(p)}
        onCreateFile={async (parent, name) => {
          const ok = await makeCreateFile(
            (p, c) => write(p, c),
            (p, n) => window.luobi.materials.createFolder(p, n)
          )(parent, name)
          await reload()
          return ok
        }}
        onDelete={async (p) => {
          await del(p)
          await reload()
          return true
        }}
        onRename={async (p, name) => {
          await window.luobi.materials.rename(p, name)
          await reload()
          return true
        }}
        emptyHint={emptyHint}
      />
    </>
  )
}

export function OutlinePane(): React.JSX.Element {
  return (
    <MaterialPane
      kind="outline"
      load={() => window.luobi.outline.list()}
      read={(p) => window.luobi.outline.read(p)}
      write={(p, c) => window.luobi.outline.write(p, c)}
      del={(p) => window.luobi.outline.delete(p)}
      header="大纲"
      headerExtra={(reload) => (
        <>
          <button
            className="nf-btn nf-btn--small nf-btn--ghost"
            onClick={async () => {
              const t = await window.luobi.outline.list()
              await window.luobi.outline.create('volume', nextNumber(t, '卷'))
              await reload()
            }}
          >
            ＋分卷
          </button>
          <button
            className="nf-btn nf-btn--small nf-btn--ghost"
            onClick={async () => {
              const t = await window.luobi.outline.list()
              await window.luobi.outline.create('chapter', nextNumber(t, '章'))
              await reload()
            }}
          >
            ＋章纲
          </button>
        </>
      )}
      emptyHint="大纲：总纲/分卷大纲/章节细纲"
    />
  )
}

export function DepositionPane(): React.JSX.Element {
  return (
    <MaterialPane
      kind="deposition"
      load={() => window.luobi.deposition.list()}
      read={(p) => window.luobi.deposition.read(p)}
      write={(p, c) => window.luobi.deposition.write(p, c)}
      del={(p) => window.luobi.deposition.delete(p)}
      header="设定沉淀"
      emptyHint="人物设定 · 世界设定 · 实体 · 关系 · 伏笔 · 时间线"
    />
  )
}

export function MemoryPane(): React.JSX.Element {
  return (
    <MaterialPane
      kind="memory"
      load={() => window.luobi.memory.list()}
      read={(p) => window.luobi.memory.read(p)}
      write={(p, c) => window.luobi.memory.write(p, c)}
      del={(p) => window.luobi.memory.delete(p)}
      header="重点记忆"
      emptyHint="用户偏好 · 写作思路 · 小说规划 · 文风偏好 · 作品禁忌 · 反复纠错"
    />
  )
}

export function MaterialsPane(): React.JSX.Element {
  return (
    <MaterialPane
      kind="materials"
      load={() => window.luobi.materials.list()}
      read={(p) => window.luobi.materials.read(p)}
      write={(p, c) => window.luobi.materials.write(p, c)}
      del={(p) => window.luobi.materials.delete(p)}
      header="资料"
      headerExtra={(reload) => (
        <button
          className="nf-btn nf-btn--small nf-btn--ghost"
          onClick={async () => {
            await window.luobi.materials.importFiles()
            await reload()
          }}
        >
          ⬆ 导入
        </button>
      )}
      emptyHint="大纲 · 剧情概要 · 重点记忆 · 设定沉淀 · 导入资料"
    />
  )
}

function nextNumber(nodes: TreeNode[], kind: '卷' | '章'): number {
  let max = 0
  const walk = (list: TreeNode[]): void => {
    for (const n of list) {
      const m = n.name.match(new RegExp(`^第\\s*(\\d+)\\s*${kind}`))
      if (m) max = Math.max(max, parseInt(m[1], 10))
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return max + 1
}
