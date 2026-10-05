/**
 * 图片生成合同类型（image-config.json 数据形状）
 * main：ImageServiceConfig 配置 / GeneratedImage 生成记录；renderer：生成对话框与设置页展示
 */

export interface ImageServiceConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** 尺寸，如 1024x1024 */
  size: string
  enabled: boolean
  updatedAt: string
}

export interface GeneratedImage {
  id: string
  prompt: string
  filePath: string
  size: string
  createdAt: string
}
