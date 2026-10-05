/**
 * 模型供应商合同类型（provider-config.json 数据形状）
 * 三进程共享：main 读写的 ProviderState 与 renderer 展示的供应商信息同源
 */
import type { ProviderConfig } from './chat'

export interface ProviderState {
  providers: ProviderConfig[]
  /** 激活的 provider id + 主模型 id */
  activeProviderId: string
  activeModelId: string
  /** 写作分身模型（inherit = 跟随主模型） */
  writingModelId: string | 'inherit'
}
