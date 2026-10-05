/** LRC 歌词解析（纯函数，可被 Node 冒烟测试导入） */

export interface LrcLine {
  time: number
  text: string
}

/** [mm:ss.xx] 支持一秒多标签行（[00:01.00][01:02.03]词）；无标签行忽略 */
export function parseLrc(lrc: string): LrcLine[] {
  const lines: LrcLine[] = []
  for (const raw of String(lrc).split(/\r?\n/)) {
    const tags = raw.match(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)
    if (!tags) continue
    const text = raw.replace(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g, '').trim()
    for (const tag of tags) {
      const m = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/.exec(tag)
      if (!m) continue
      const frac = Number((m[3] ?? '0').padEnd(3, '0')) / 1000
      lines.push({ time: Number(m[1]) * 60 + Number(m[2]) + frac, text })
    }
  }
  return lines.sort((a, b) => a.time - b.time)
}
