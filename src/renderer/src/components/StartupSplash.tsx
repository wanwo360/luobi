import React, { useEffect, useState } from 'react'

/** 启动屏：科技予你同在 · 未来无限可能 */
export function StartupSplash({ onDone }: { onDone: () => void }): React.JSX.Element | null {
  const [hidden, setHidden] = useState(false)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setHidden(true), 1600)
    const t2 = setTimeout(() => {
      setGone(true)
      onDone()
    }, 2200)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [onDone])

  if (gone) return null

  return (
    <div className={`nf-startup${hidden ? ' nf-startup--hidden' : ''}`}>
      <div className="nf-startup-stage">
        <div className="nf-startup-sigil">
          <svg viewBox="0 0 120 120" width="90" height="90">
            <circle cx="60" cy="60" r="45.5" fill="rgba(255,253,248,0.42)" stroke="rgba(116,87,67,0.2)" strokeWidth="1.2" />
            <path
              d="M29 55.5c10.8-4.6 21.1-2.9 31 5.2v25.8c-9.9-8.1-20.2-9.8-31-5.2V55.5Z"
              fill="none"
              stroke="#2a211d"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M91 55.5c-10.8-4.6-21.1-2.9-31 5.2v25.8c9.9-8.1 20.2-9.8 31-5.2V55.5Z"
              fill="none"
              stroke="#2a211d"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M60 60.8v25.7" fill="none" stroke="#2a211d" strokeWidth="1.3" opacity="0.6" />
            <path
              d="M60 25.5c1.9 7.2 6.1 11.4 13.2 13.2-7.1 1.9-11.3 6-13.2 13.2-1.9-7.2-6.1-11.3-13.2-13.2 7.1-1.8 11.3-6 13.2-13.2Z"
              fill="rgba(178,111,76,0.18)"
              stroke="#956046"
              strokeWidth="1.8"
            />
            <circle cx="60" cy="38.7" r="2.8" fill="#c3835f" />
          </svg>
        </div>
        <div className="nf-startup-brand">落笔</div>
        <div className="nf-startup-subtitle">万象文新</div>
        <div className="nf-startup-motto">科技予你同在 · 未来无限可能</div>
      </div>
    </div>
  )
}
