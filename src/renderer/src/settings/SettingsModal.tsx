import React, { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import type { RuleFile, UsageStats } from '@shared/types/rules'
import type { ImageServiceConfig } from '@shared/types/image'

type Tab = 'model' | 'chat' | 'writing' | 'rules' | 'usage' | 'data' | 'general' | 'about'

/** 设置中心：模型 / 对话 / 写作 / 规则 / 用量 / 数据 / 通用 / 关于 */
export function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('model')
  const [rules, setRules] = useState<RuleFile[]>([])
  const { usage, refreshProvider, refreshUsage } = useSettingsStore()

  const reload = async (): Promise<void> => {
    await refreshProvider()
    await refreshUsage()
    setRules(await window.luobi.rules.list())
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="nf-modal-overlay" onClick={onClose}>
      <div className="nf-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', height: '100%' }}>
          <div className="settings-nav">
            {(
              [
                ['model', '模型'],
                ['chat', '对话'],
                ['writing', '写作'],
                ['rules', '写作规则'],
                ['usage', '用量统计'],
                ['data', '数据'],
                ['general', '通用'],
                ['about', '关于']
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? 'settings-nav button--active' : 'settings-nav'}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <button className="nf-btn nf-btn--small" onClick={onClose}>
              关闭
            </button>
          </div>
          <div className="settings-body">
            {tab === 'model' && <ModelTab />}
            {tab === 'chat' && <ChatTab />}
            {tab === 'writing' && <WritingTab />}
            {tab === 'rules' && <RulesTab rules={rules} onChanged={reload} />}
            {tab === 'usage' && <UsageTab usage={usage} />}
            {tab === 'data' && <DataTab />}
            {tab === 'general' && <GeneralTab />}
            {tab === 'about' && <AboutTab onClose={onClose} />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============ 模型 ============

function ModelTab(): React.JSX.Element {
  const { providerState, refreshProvider, saveProject, projectSettings, appSettings, saveApp } = useSettingsStore()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ baseUrl: '', apiKey: '', name: '', models: '' })
  const [testResult, setTestResult] = useState<string | null>(null)

  const addProvider = async (): Promise<void> => {
    if (!form.baseUrl.trim() || !form.apiKey.trim()) return
    const models = form.models
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean)
      .map((id) => ({ id, name: id, contextWindow: 128000 }))
    await window.luobi.provider.save({
      name: form.name || form.baseUrl,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      apiStyle: 'chat_completions',
      models: models.length ? models : [{ id: 'deepseek-chat', name: 'deepseek-chat', contextWindow: 128000 }]
    })
    // 连通性测试
    const t = await window.luobi.provider.test(form.baseUrl.trim(), form.apiKey.trim())
    setTestResult(t.ok ? `✅ 连通成功，识别到 ${t.models?.length ?? 0} 个模型` : `❌ 测试失败：${t.message}`)
    setForm({ baseUrl: '', apiKey: '', name: '', models: '' })
    setShowForm(false)
    await refreshProvider()
  }

  const removeProvider = async (id: string): Promise<void> => {
    await window.luobi.provider.remove(id)
    await refreshProvider()
  }

  const selectModel = async (providerId: string, modelId: string): Promise<void> => {
    await window.luobi.provider.select(providerId, modelId)
    await refreshProvider()
  }

  return (
    <div>
      <div className="settings-section">
        <h3>模型供应商</h3>
        <div style={{ fontSize: 12, color: 'var(--nf-muted)', marginBottom: 10 }}>
          支持任意 OpenAI 兼容 API（DeepSeek / 智谱 / 中转站等），首次启动已自动导入 ainovel 配置。
        </div>
        {(providerState?.providers ?? []).map((p: any) => (
          <div key={p.id} style={{ border: '1px solid var(--nf-line)', borderRadius: 10, padding: 12, marginBottom: 10, background: 'var(--nf-surface)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong>{p.name}</strong>
              <span style={{ fontSize: 11, color: 'var(--nf-muted)' }}>{p.baseUrl}</span>
              <div className="titlebar-spacer" />
              <button className="nf-btn nf-btn--small nf-btn--danger" onClick={() => removeProvider(p.id)}>
                移除
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--nf-muted)', marginTop: 2 }}>
              API Key：{maskKey(p.apiKey)}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {p.models.map((m: any) => (
                <button
                  key={m.id}
                  className={`nf-btn nf-btn--small${providerState?.activeModelId === m.id ? ' nf-btn--primary' : ''}`}
                  onClick={() => selectModel(p.id, m.id)}
                  title={`上下文 ${m.contextWindow ?? 128000} tokens`}
                >
                  {m.id}
                </button>
              ))}
            </div>
          </div>
        ))}
        {!showForm ? (
          <button className="nf-btn" onClick={() => setShowForm(true)}>
            ＋ 添加供应商
          </button>
        ) : (
          <div style={{ border: '1px solid var(--nf-line)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="nf-input" placeholder="名称（如 DeepSeek）" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="nf-input" placeholder="Base URL（如 https://api.deepseek.com）" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
            <input className="nf-input" type="password" placeholder="API Key" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
            <input className="nf-input" placeholder="模型列表，逗号分隔（如 deepseek-chat,deepseek-reasoner）" value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} />
            {testResult && <div style={{ fontSize: 12 }}>{testResult}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="nf-btn nf-btn--primary" onClick={addProvider}>
                保存并测试
              </button>
              <button className="nf-btn" onClick={() => setShowForm(false)}>
                取消
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="settings-section">
        <h3>图片生成</h3>
        <div style={{ fontSize: 12, color: 'var(--nf-muted)', marginBottom: 10 }}>
          用于生成封面/场景/人物图，兼容 OpenAI 图片接口。DeepSeek 官方不支持图片生成；
          <strong>免费选择</strong>：本地 ComfyUI（SDXL 出图，零费用，需先启动 ComfyUI 窗口）/
          Pollinations（flux，零费用）/ 智谱 CogView（注册送体验额度，按张计费）。
        </div>
        <ImageServiceConfig />
      </div>
      <div className="settings-section">
        <h3>写作分身</h3>
        <div className="settings-row">
          <label>混合模式</label>
          <input
            type="checkbox"
            checked={appSettings?.hybridMode !== false}
            onChange={(e) => saveApp({ hybridMode: e.target.checked })}
          />
        </div>
        <div style={{ fontSize: 12, color: 'var(--nf-muted)' }}>
          混合模式开启：主编聊天用主模型，正文写作自动用下方"写作分身模型"（如智谱免费模型），
          大幅节省写作成本；关闭：全部使用主编模型。
        </div>
        <div className="settings-row" style={{ marginTop: 10 }}>
          <label>写作分身模型</label>
          <select
            className="nf-input"
            style={{ width: 'auto' }}
            disabled={appSettings?.hybridMode === false}
            value={projectSettings?.writingModelId ?? 'inherit'}
            onChange={(e) => saveProject({ writingModelId: e.target.value })}
          >
            <option value="inherit">跟随主编模型</option>
            {(providerState?.providers ?? []).flatMap((p: any) =>
              p.models.map((m: any) => (
                <option key={`${p.id}:${m.id}`} value={m.id}>
                  {m.id}
                </option>
              ))
            )}
          </select>
        </div>
        <div style={{ fontSize: 12, color: 'var(--nf-muted)' }}>
          主编模型负责对话与创作指导；写作分身专职生成正文，可独立选择更便宜/更快的模型（如 glm-4-flash 免费）。
        </div>
      </div>
    </div>
  )
}

/** 图片生成服务配置（预置常见服务模板） */
const IMAGE_TEMPLATES = [
  { name: '本地 ComfyUI-FLUX（顶级·慢）', baseUrl: 'http://127.0.0.1:8188', model: 'flux1-dev-Q4_K_S.gguf', apiKey: 'local' },
  { name: '本地 ComfyUI-SDXL（快）', baseUrl: 'http://127.0.0.1:8188', model: 'sd_xl_base_1.0.safetensors', apiKey: 'local' },
  { name: 'Pollinations（免费·无 key）', baseUrl: 'https://image.pollinations.ai/v1', model: 'flux', apiKey: 'anonymous' },
  { name: '智谱 CogView', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'cogview-4' },
  { name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Kwai-Kolors/Kolors' },
  { name: '自定义', baseUrl: '', model: '' }
]

function ImageServiceConfig(): React.JSX.Element {
  const [cfg, setCfg] = useState<ImageServiceConfig | null>(null)
  const [form, setForm] = useState({ name: '智谱 CogView', baseUrl: '', apiKey: '', model: '', size: '1024x1024' })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.luobi.image.getConfig().then((c: any) => {
      setCfg(c?.service ?? null)
      if (c?.service) {
        setForm({
          name: c.service.baseUrl,
          baseUrl: c.service.baseUrl,
          apiKey: c.service.apiKey,
          model: c.service.model,
          size: c.service.size ?? '1024x1024'
        })
      }
    })
  }, [])

  const pickTemplate = (name: string): void => {
    const t = IMAGE_TEMPLATES.find((x) => x.name === name)
    if (t) setForm({ ...form, name, baseUrl: t.baseUrl, model: t.model, apiKey: t.apiKey ?? form.apiKey })
  }

  const save = async (): Promise<void> => {
    if (!form.baseUrl.trim() || !form.apiKey.trim()) return
    const saved = (await window.luobi.image.saveConfig({
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      model: form.model.trim() || 'cogview-4',
      size: form.size,
      enabled: true
    })) as ImageServiceConfig
    setCfg(saved)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div>
      {cfg && (
        <div style={{ fontSize: 12, color: 'var(--nf-muted)', marginBottom: 8 }}>
          当前服务：{cfg.baseUrl}（模型 {form.model}）
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {IMAGE_TEMPLATES.map((t) => (
          <button key={t.name} className={`nf-btn nf-btn--small${form.name === t.name ? ' nf-btn--primary' : ''}`} onClick={() => pickTemplate(t.name)}>
            {t.name}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input className="nf-input" placeholder="Base URL" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value, name: '自定义' })} />
        <input className="nf-input" type="password" placeholder="API Key（智谱在 platform.bigmodel.cn 获取）" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
        <input className="nf-input" placeholder="模型（如 cogview-4）" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="nf-input" style={{ width: 150, padding: '6px 8px' }} value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })}>
            <option value="1024x1024">1024×1024</option>
            <option value="768x1344">768×1344（竖版）</option>
            <option value="1344x768">1344×768（横版）</option>
          </select>
          <button className="nf-btn nf-btn--primary" onClick={save} disabled={!form.baseUrl.trim() || !form.apiKey.trim()}>
            保存配置
          </button>
          {saved && <span style={{ fontSize: 12, color: 'var(--nf-success)' }}>✓ 已保存</span>}
        </div>
      </div>
    </div>
  )
}

function maskKey(key: string): string {
  if (!key) return '（未配置）'
  if (key.length <= 8) return '****'
  return `${key.slice(0, 6)}...${key.slice(-4)}`
}

// ============ 对话（上下文控制） ============

function ChatTab(): React.JSX.Element {
  const { appSettings, saveApp } = useSettingsStore()
  const [saved, setSaved] = useState(false)

  const update = (patch: any): void => {
    saveApp(patch)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div>
      <div className="settings-section">
        <h3>上下文注入</h3>
        <div style={{ fontSize: 12, color: 'var(--nf-muted)', marginBottom: 12 }}>
          控制发给 AI 的项目背景内容。注入越多上下文越准确，但消耗更多 token 且更慢。
        </div>
        <div className="settings-row">
          <label>注入最近章节</label>
          <select
            className="nf-input"
            style={{ width: 'auto' }}
            value={appSettings?.contextChapters ?? 2}
            onChange={(e) => update({ contextChapters: parseInt(e.target.value, 10) })}
          >
            <option value={0}>不注入</option>
            <option value={1}>最近 1 章</option>
            <option value={2}>最近 2 章</option>
            <option value={3}>最近 3 章</option>
            <option value={5}>最近 5 章</option>
          </select>
        </div>
        <div className="settings-row">
          <label>注入总纲</label>
          <input
            type="checkbox"
            checked={appSettings?.injectMasterOutline ?? true}
            onChange={(e) => update({ injectMasterOutline: e.target.checked })}
          />
        </div>
        <div className="settings-row">
          <label>注入剧情概要</label>
          <input
            type="checkbox"
            checked={appSettings?.injectStorySummary ?? true}
            onChange={(e) => update({ injectStorySummary: e.target.checked })}
          />
        </div>
        <div className="settings-row">
          <label>上下文上限</label>
          <select
            className="nf-input"
            style={{ width: 'auto' }}
            value={appSettings?.contextCharLimit ?? 20000}
            onChange={(e) => update({ contextCharLimit: parseInt(e.target.value, 10) })}
          >
            <option value={8000}>约 8 千字（省 token）</option>
            <option value={20000}>约 2 万字（推荐）</option>
            <option value={40000}>约 4 万字（更准确）</option>
            <option value={80000}>约 8 万字（完整）</option>
          </select>
        </div>
        {saved && <div style={{ fontSize: 12, color: 'var(--nf-success)' }}>✓ 已保存</div>}
      </div>
    </div>
  )
}

// ============ 写作 ============

function WritingTab(): React.JSX.Element {
  const { projectSettings, saveProject } = useSettingsStore()
  const [prefs, setPrefs] = useState(projectSettings?.writingPreferences ?? { technique: '', style: '', reviewFocus: '' })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setPrefs(projectSettings?.writingPreferences ?? { technique: '', style: '', reviewFocus: '' })
  }, [projectSettings])

  const save = async (): Promise<void> => {
    await saveProject({ writingPreferences: prefs, temperature: projectSettings?.temperature ?? 0.8 })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div>
      <div className="settings-section">
        <h3>生成参数</h3>
        <div className="settings-row">
          <label>温度</label>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.1}
            value={projectSettings?.temperature ?? 0.8}
            onChange={(e) => saveProject({ temperature: parseFloat(e.target.value) })}
            style={{ flex: 1 }}
          />
          <span style={{ width: 40, fontSize: 12 }}>{(projectSettings?.temperature ?? 0.8).toFixed(1)}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--nf-muted)' }}>
          低温度更稳定严谨，高温度更有创意与发散。写作推荐 0.7~0.9。
        </div>
      </div>
      <div className="settings-section">
        <h3>高质量审稿</h3>
        <div className="settings-row">
          <label>落盘自动审稿</label>
          <input
            type="checkbox"
            checked={projectSettings?.highQualityReview ?? false}
            onChange={(e) => saveProject({ highQualityReview: e.target.checked })}
          />
        </div>
        <div style={{ fontSize: 12, color: 'var(--nf-muted)' }}>
          开启后，每章保存到正文时自动执行规则自检（禁用词/疲劳词/AI 套句/字数），报告存入 <code>.ainovel/reviews/</code>。
        </div>
      </div>
      <div className="settings-section">
        <h3>写作偏好（自动注入每次创作）</h3>
        <div style={{ fontSize: 12, color: 'var(--nf-muted)', marginBottom: 10 }}>
          用大白话写要求即可，保存后写入书级规则 <code>.ainovel/rules/写作偏好.md</code>，AI 创作时自动遵循。
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>写作技法</div>
            <textarea
              className="nf-textarea"
              style={{ minHeight: 80 }}
              placeholder={'例：多用身体感知（指节发白）替代情绪标签（紧张）；对话别太书面；每章 3000 字左右'}
              value={prefs.technique}
              onChange={(e) => setPrefs({ ...prefs, technique: e.target.value })}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>文风偏好</div>
            <textarea
              className="nf-textarea"
              style={{ minHeight: 80 }}
              placeholder={'例：行文干净利落，少用形容词堆砌；喜欢短句与留白；可粘贴一段例文作为风格参考'}
              value={prefs.style}
              onChange={(e) => setPrefs({ ...prefs, style: e.target.value })}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>审稿重点</div>
            <textarea
              className="nf-textarea"
              style={{ minHeight: 80 }}
              placeholder={'例：检查人物行为是否符合设定；伏笔是否回收；对话是否符合角色身份'}
              value={prefs.reviewFocus}
              onChange={(e) => setPrefs({ ...prefs, reviewFocus: e.target.value })}
            />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <button className="nf-btn nf-btn--primary" onClick={save}>
            保存写作偏好
          </button>
          {saved && <span style={{ fontSize: 12, color: 'var(--nf-success)' }}>✓ 已保存并生效</span>}
        </div>
      </div>
    </div>
  )
}

// ============ 规则 ============

function RulesTab({ rules, onChanged }: { rules: RuleFile[]; onChanged: () => void }): React.JSX.Element {
  const [editing, setEditing] = useState<RuleFile | null>(null)
  const [content, setContent] = useState('')
  const [newRule, setNewRule] = useState(false)
  const [newName, setNewName] = useState('')

  const save = async (): Promise<void> => {
    if (editing) {
      await window.luobi.rules.write(editing.absPath, content)
    }
    setEditing(null)
    setContent('')
    await onChanged()
  }

  const createRule = async (): Promise<void> => {
    // 规则目录由主进程提供（写接口有白名单校验，硬编码用户路径会直接报错）
    const { globalDir } = await window.luobi.rules.getDirs()
    const absPath = `${globalDir}\\${newName.trim().endsWith('.md') ? newName.trim() : newName.trim() + '.md'}`
    await window.luobi.rules.write(absPath, '# 我的规则\n')
    setNewRule(false)
    setNewName('')
    await onChanged()
  }

  return (
    <div>
      <div className="settings-section">
        <h3>写作规则（ainovel 规则系统）</h3>
        <div style={{ fontSize: 12, color: 'var(--nf-muted)', marginBottom: 10 }}>
          全局规则：<code>~/.ainovel/rules/*.md</code>（所有书生效） · 项目规则：<code>&lt;项目&gt;/.ainovel/rules/*.md</code>（仅本书）·
          优先级：项目 &gt; 全局 &gt; 内置基线（AI 套句/疲劳词）。写作偏好页保存的内容自动写入项目规则。
        </div>
        {(rules ?? []).map((r) => (
          <div key={r.absPath} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--nf-line)' }}>
            <span style={{ fontSize: 12 }}>
              <span style={{ color: r.scope === 'project' ? 'var(--nf-accent)' : 'var(--nf-muted)' }}>
                {r.scope === 'project' ? '[本书]' : '[全局]'}
              </span>{' '}
              {r.name}
            </span>
            <div className="titlebar-spacer" />
            <button
              className="nf-btn nf-btn--small"
              onClick={() => {
                setEditing(r)
                setContent(r.content)
              }}
            >
              编辑
            </button>
            <button className="nf-btn nf-btn--small nf-btn--danger" onClick={async () => { await window.luobi.rules.delete(r.absPath); await onChanged() }}>
              删除
            </button>
          </div>
        ))}
        {!newRule && (
          <button className="nf-btn nf-btn--small" style={{ marginTop: 10 }} onClick={() => setNewRule(true)}>
            ＋ 新建全局规则
          </button>
        )}
        {newRule && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input className="nf-input" placeholder="规则名（如 my-style.md）" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="nf-btn nf-btn--small nf-btn--primary" onClick={createRule}>
              创建
            </button>
            <button className="nf-btn nf-btn--small" onClick={() => setNewRule(false)}>
              取消
            </button>
          </div>
        )}
      </div>
      {editing && (
        <div className="settings-section">
          <h3>编辑 {editing.name}</h3>
          <textarea
            className="nf-textarea"
            style={{ minHeight: 180 }}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div style={{ fontSize: 11, color: 'var(--nf-muted)', margin: '6px 0' }}>
            用大白话写要求即可：如「主角别写成圣母」「每章 3000 字左右」「不要出现『某种程度上』」。
            系统会自动提取字数/禁用词/疲劳词约束。
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="nf-btn nf-btn--primary" onClick={save}>
              保存
            </button>
            <button className="nf-btn" onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============ 用量 ============

function UsageTab({ usage }: { usage: UsageStats | null }): React.JSX.Element {
  if (!usage) return <div className="empty-hint">暂无用量数据</div>
  const o = usage.overall
  return (
    <div>
      <div className="settings-section">
        <h3>用量统计</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            ['输入 tokens', o.input.toLocaleString()],
            ['输出 tokens', o.output.toLocaleString()],
            ['缓存读取', o.cache_read.toLocaleString()],
            ['缓存写入', o.cache_write.toLocaleString()],
            ['累计成本', `$${o.cost_usd.toFixed(4)}`]
          ].map(([k, v]) => (
            <div key={k} style={{ border: '1px solid var(--nf-line)', borderRadius: 10, padding: 14, background: 'var(--nf-surface)' }}>
              <div style={{ fontSize: 12, color: 'var(--nf-muted)' }}>{k}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="settings-section">
        <h3>按模型</h3>
        {Object.entries(usage.per_model ?? {}).map(([model, u]: [string, any]) => (
          <div key={model} style={{ fontSize: 12, padding: '4px 0' }}>
            {model}：输入 {u.input.toLocaleString()} / 输出 {u.output.toLocaleString()} / ${u.cost_usd.toFixed(4)}（{u.requests} 次请求）
          </div>
        ))}
      </div>
      <div className="settings-section">
        <h3>按用途</h3>
        {Object.entries(usage.per_agent ?? {}).map(([agent, u]: [string, any]) => (
          <div key={agent} style={{ fontSize: 12, padding: '4px 0' }}>
            {agent}：{u.requests} 次请求 / ${u.cost_usd.toFixed(4)}
          </div>
        ))}
      </div>
    </div>
  )
}

// ============ 数据 ============

function DataTab(): React.JSX.Element {
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const exportProject = async (): Promise<void> => {
    setExporting(true)
    setMessage(null)
    const target = await window.luobi.settings.exportProject()
    if (target) setMessage(`✅ 已备份到：${target}`)
    setExporting(false)
  }

  return (
    <div>
      <div className="settings-section">
        <h3>备份与恢复</h3>
        <div style={{ fontSize: 12, color: 'var(--nf-muted)', marginBottom: 10 }}>
          书是纯本地文件（正文/创作资料/规则/聊天记录都在项目目录里），复制即备份。
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="nf-btn" onClick={exportProject} disabled={exporting}>
            {exporting ? '备份中…' : '📦 备份当前作品'}
          </button>
          <button className="nf-btn" onClick={() => window.luobi.settings.openDataFolder()}>
            📂 打开数据目录
          </button>
        </div>
        {message && <div style={{ fontSize: 12, marginTop: 8, color: 'var(--nf-muted)' }}>{message}</div>}
      </div>
      <div className="settings-section">
        <h3>数据位置</h3>
        <div style={{ fontSize: 12, color: 'var(--nf-muted)', lineHeight: 2 }}>
          · 新书：<code>Documents/落笔/projects/</code>
          <br />
          · 旧版目录中的书：<code>Documents/星炉/projects/</code>（自动兼容读取）
          <br />
          · 全局规则：<code>~/.ainovel/rules/</code>
          <br />
          · 应用设置：<code>~/.luobi/</code>
        </div>
      </div>
    </div>
  )
}

// ============ 通用 ============

function GeneralTab(): React.JSX.Element {
  const { scale, setScale, projectSettings, saveProject } = useSettingsStore()
  return (
    <div>
      <div className="settings-section">
        <h3>界面</h3>
        <div className="settings-row">
          <label>界面缩放</label>
          <select className="nf-input" style={{ width: 'auto' }} value={scale} onChange={(e) => setScale(e.target.value as any)}>
            <option value="normal">100%</option>
            <option value="medium">110%</option>
            <option value="large">130%</option>
          </select>
        </div>
      </div>
      <div className="settings-section">
        <h3>写作</h3>
        <div className="settings-row">
          <label>提交时自检</label>
          <input
            type="checkbox"
            checked={projectSettings?.selfCheckOnCommit ?? true}
            onChange={(e) => saveProject({ selfCheckOnCommit: e.target.checked })}
          />
        </div>
        <div style={{ fontSize: 12, color: 'var(--nf-muted)' }}>
          章节编辑器内点击「保存」时自动弹出规则自检结果。
        </div>
      </div>
    </div>
  )
}

// ============ 关于 ============

function AboutTab({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [info, setInfo] = useState<any>(null)

  useEffect(() => {
    window.luobi.system.info().then(setInfo).catch(() => {})
  }, [])

  return (
    <div style={{ textAlign: 'center', paddingTop: 24 }}>
      {/* 品牌 */}
      <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '0.1em' }}>落笔 AI 智能体</div>
      <div style={{ fontSize: 15, letterSpacing: '0.25em', color: 'var(--nf-accent)', marginTop: 6 }}>v1.0</div>
      <div style={{ fontSize: 12, color: 'var(--nf-muted)', marginTop: 10, letterSpacing: '0.15em' }}>
        科技予你同在 · 未来无限可能
      </div>

      {/* 简介 */}
      <div style={{ fontSize: 13, color: 'var(--nf-muted)', lineHeight: 1.9, margin: '18px auto 0', maxWidth: 460 }}>
        本地 AI 小说创作助手 —— 本地优先的长篇创作体验与 ainovel 写作规则系统，
        数据完全保存在本地，自由接入任意 OpenAI 兼容模型。
      </div>

      {/* 核心特性 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, margin: '20px auto 0', maxWidth: 540 }}>
        {[
          ['📚', '多书管理', '兼容旧版目录'],
          ['💬', '主编对话', '流式生成正文'],
          ['📐', '规则自检', '禁用词/疲劳词/套句'],
          ['🤖', '智能体', '写作与条件分工'],
          ['📊', '用量统计', 'token 与成本明细'],
          ['🔒', '本地存储', '纯本地文件，可随时备份']
        ].map(([icon, title, desc]) => (
          <div key={title} style={{ border: '1px solid var(--nf-line)', borderRadius: 10, padding: '12px 8px', background: 'var(--nf-surface)' }}>
            <div style={{ fontSize: 18 }}>{icon}</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{title}</div>
            <div style={{ fontSize: 11, color: 'var(--nf-muted)', marginTop: 2 }}>{desc}</div>
          </div>
        ))}
      </div>

      {/* 技术信息 */}
      <div style={{ margin: '20px auto 0', maxWidth: 460, fontSize: 12, color: 'var(--nf-muted)', lineHeight: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--nf-text)', marginBottom: 4 }}>技术信息</div>
        <div>
          Electron {info?.versions?.electron ?? '—'} · Chromium {info?.versions?.chrome ?? '—'} · Node{' '}
          {info?.versions?.node ?? '—'}
        </div>
        <div>
          数据目录：<code style={{ background: 'var(--nf-bg-3)', padding: '1px 5px', borderRadius: 4 }}>Documents/落笔/projects/</code>
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <button className="nf-btn" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  )
}
