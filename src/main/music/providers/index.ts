/**
 * 音乐源注册表
 *
 * ⚠️ 公开版本这里【故意为空】—— 本项目不内置、不分发任何第三方音乐服务的接口实现。
 *
 * 想让音乐播放可用，自己接一个：
 *   1. 在本目录实现 provider（契约见 ../provider-contract.ts）
 *   2. 在下面登记，例如：
 *
 *        import myProvider from './my-provider.ts'
 *        export const PROVIDERS: ProviderConfig[] = [
 *          { name: 'my', instance: myProvider as unknown as ProviderInstance, searchable: true }
 *        ]
 *
 *   3. 如果该源的 CDN 需要防盗链 Referer，在这里一并补 REFERER_RULES
 *
 * 详细步骤与最小示例：./README.md
 * 上游契约参考：Listen 1（MIT）—— 见 src/main/music/LICENSE-LISTEN1.md
 */
import type { ProviderConfig } from '../provider-contract.ts'

/** 已安装的音乐源。为空 = 未安装任何音乐源（搜索结果必然为空） */
export const PROVIDERS: ProviderConfig[] = []

/**
 * 各源 CDN 的防盗链 Referer 规则：[匹配真实音频 URL 的正则, 要伪造的 Referer]
 * 由音乐源实现随实现一起提供；本项目不内置任何平台的规则。
 */
export const REFERER_RULES: [RegExp, string][] = []
