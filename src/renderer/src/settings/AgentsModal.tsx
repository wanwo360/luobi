import React, { useEffect, useState } from 'react'
import type { Agent } from '@shared/types/agents'

/** 智能体管理：列表 + 创建 + 编辑 + 运行 */
export function AgentsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [agents, setAgents] = useState<Agent[]>([])
  const [editing, setEditing] = useState<Agent | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [runLog, setRunLog] = useState<{ agentId: string; text: string }[]>([])

  const reload = async (): Promise<void> => {
    const data = await window.luobi.agents.list()
    setAgents(data?.agents ?? [])
  }

  useEffect(() => {
    reload()
    const off = window.luobi.agents.onRunEvent((payload: any) => {
      setRunLog((prev) => [...prev.slice(-50), { agentId: payload.agentId, text: payload.text ?? payload.error ?? payload.state ?? '' }])
      if (payload.type === 'done' || payload.type === 'error') setRunning(null)
    })
    return off
  }, [])

  const create = async (kind: 'write' | 'condition'): Promise<void> => {
    const name = prompt(`新${kind === 'write' ? '写作' : '条件'}智能体名称：`)
    if (!name) return
    await window.luobi.agents.create({ name, kind })
    await reload()
  }

  const run = async (agent: Agent): Promise<void> => {
    setRunning(agent.id)
    setRunLog((prev) => [...prev, { agentId: agent.id, text: `▶ 启动 ${agent.name}…` }])
    try {
      const output = await window.luobi.agents.run(agent.id, { instruction: '请执行你的任务。' })
      setRunLog((prev) => [...prev, { agentId: agent.id, text: `✅ 输出: ${output}` }])
    } catch (err: any) {
      setRunLog((prev) => [...prev, { agentId: agent.id, text: `❌ ${err?.message ?? err}` }])
      setRunning(null)
    }
  }

  return (
    <div className="nf-modal-overlay" onClick={onClose}>
      <div className="nf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span>写作智能体</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="nf-btn nf-btn--small" onClick={() => create('write')}>
              ＋ 写作智能体
            </button>
            <button className="nf-btn nf-btn--small" onClick={() => create('condition')}>
              ＋ 条件智能体
            </button>
            <button className="nf-btn nf-btn--small" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', height: '100%' }}>
          <div style={{ width: 300, borderRight: '1px solid var(--nf-line)', overflowY: 'auto', padding: 8 }}>
            {agents.length === 0 && <div className="empty-hint">暂无智能体。写作智能体负责按指令产出正文，条件智能体用于产出设定/小结等。</div>}
            {agents.map((a) => (
              <div
                key={a.id}
                className={`chapter-item${editing?.id === a.id ? ' chapter-item--active' : ''}`}
                onClick={() => setEditing(a)}
              >
                <span>
                  {a.kind === 'write' ? '✍️' : '🧩'} {a.name}
                </span>
                <span className="chars">{a.enabled ? '启用' : '停用'}</span>
              </div>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
            {editing ? (
              <AgentEditor
                agent={editing}
                onSave={async (patch) => {
                  await window.luobi.agents.update(editing.id, patch)
                  await reload()
                  setEditing(null)
                }}
                onRun={() => run(editing)}
                running={running === editing.id}
                onDelete={async () => {
                  await window.luobi.agents.delete(editing.id)
                  await reload()
                  setEditing(null)
                }}
              />
            ) : (
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                <strong style={{ fontSize: 13 }}>运行日志</strong>
                {runLog.length === 0 && <div className="empty-hint">选择一个智能体查看配置，或点击运行</div>}
                {runLog.map((l, i) => (
                  <div key={i} style={{ fontSize: 12, padding: '3px 0', color: 'var(--nf-muted)', borderBottom: '1px solid var(--nf-paper-line)' }}>
                    {l.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function AgentEditor({
  agent,
  onSave,
  onRun,
  running,
  onDelete
}: {
  agent: Agent
  onSave: (patch: Partial<Agent>) => Promise<void>
  onRun: () => void
  running: boolean
  onDelete: () => void
}): React.JSX.Element {
  const [form, setForm] = useState<Partial<Agent>>({ ...agent })

  return (
    <div>
      <div className="settings-section">
        <h3>智能体配置</h3>
        <div className="settings-row">
          <label>名称</label>
          <input className="nf-input" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="settings-row">
          <label>描述</label>
          <input className="nf-input" value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="settings-row">
          <label>读取文件</label>
          <input
            className="nf-input"
            placeholder="项目相对路径，逗号分隔（如 创作资料/总纲.md，创作资料/设定沉淀/人物设定/主角.md）"
            value={(form.readFiles ?? []).join(',')}
            onChange={(e) => setForm({ ...form, readFiles: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          />
        </div>
        <div className="settings-row">
          <label>输出文件</label>
          <input
            className="nf-input"
            placeholder="项目相对路径（如 工作流产物/我的输出.md）"
            value={(form.outputFiles ?? [])[0] ?? ''}
            onChange={(e) => setForm({ ...form, outputFiles: [e.target.value] })}
          />
        </div>
        <div className="settings-row">
          <label>启用</label>
          <input type="checkbox" checked={form.enabled ?? true} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="nf-btn nf-btn--primary" onClick={() => onSave(form)}>
            保存
          </button>
          <button className="nf-btn" onClick={onRun} disabled={running}>
            {running ? '运行中…' : '▶ 运行'}
          </button>
          <button className="nf-btn nf-btn--danger" onClick={onDelete}>
            删除
          </button>
        </div>
      </div>
    </div>
  )
}
