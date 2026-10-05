/** 章节合同类型（列表/历史版本，main 返回、renderer 展示同源） */

/** 章节历史版本快照（正文/历史版本/下） */
export interface HistoryVersion {
  name: string
  /** 项目相对路径（正斜杠） */
  path: string
  timestamp: string
  chars: number
}
