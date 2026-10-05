export interface ProjectTreeNode {
  name: string
  /** 项目相对路径（正斜杠） */
  path: string
  isDir: boolean
  size?: number
  children?: ProjectTreeNode[]
}

export interface ProjectTree extends ProjectTreeNode {}
