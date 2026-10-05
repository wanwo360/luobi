import React from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useProjectStore } from '../stores/projectStore'

export function TitleBar({
  onOpenSettings,
  onOpenAgents
}: {
  onOpenSettings: () => void
  onOpenAgents: () => void
}): React.JSX.Element {
  const { theme, toggleTheme, scale, setScale } = useSettingsStore()
  const { currentProject } = useProjectStore()

  return (
    <div className="titlebar">
      <div className="titlebar-brand">
        <span className="titlebar-brand-mark">炉</span>
        <span>落笔</span>
        <span className="titlebar-subtitle">万象文新</span>
      </div>
      {currentProject && <span style={{ fontSize: 12, color: 'var(--nf-muted)' }}>《{currentProject.name}》</span>}
      <div className="titlebar-spacer" />
      <button className="titlebar-icon-btn" title="写作智能体" onClick={onOpenAgents}>
        🤖
      </button>
      <button className="titlebar-icon-btn" title="缩放" onClick={() => setScale(scale === 'normal' ? 'medium' : scale === 'medium' ? 'large' : 'normal')}>
        {scale === 'normal' ? '100%' : scale === 'medium' ? '110%' : '130%'}
      </button>
      <button className="titlebar-icon-btn" title="主题" onClick={toggleTheme}>
        {theme === 'light' ? '🌙' : '☀️'}
      </button>
      <button className="titlebar-icon-btn" title="设置" onClick={onOpenSettings}>
        ⚙️
      </button>
      <div className="window-dots">
        <button className="window-dot dot-minimize" title="最小化" onClick={() => window.luobi.system.windowAction('minimize')} />
        <button className="window-dot dot-maximize" title="最大化" onClick={() => window.luobi.system.windowAction('maximize')} />
        <button className="window-dot dot-close" title="关闭" onClick={() => window.luobi.system.windowAction('close')} />
      </div>
    </div>
  )
}
