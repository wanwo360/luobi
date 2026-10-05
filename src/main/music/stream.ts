/**
 * 音频流代理协议：renderer 的 <audio src="music://play?u=<真实url>">
 * 主进程 net.fetch 转发真实音频流（支持 Range 透传 → 进度条 seek 可用）
 * 解决：CSP media-src 'self' 拦截 http 音源 + file:// 生产模式的混合内容问题
 *
 * 防盗链 Referer 规则来自音乐源注册表（providers/index.ts）—— 本项目不内置任何平台规则。
 */
import { protocol, net } from 'electron'
import { REFERER_RULES } from './providers/index.ts'

/** app ready 前注册（特权声明：stream 流式播放必需） */
export function registerMusicSchemePrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'music',
      privileges: { stream: true, supportFetchAPI: false, bypassCSP: false }
    }
  ])
}

/** app ready 后挂载处理器 */
export function handleMusicScheme(): void {
  protocol.handle('music', (request) => {
    try {
      const u = new URL(request.url)
      const real = u.searchParams.get('u') ?? ''
      // 安全：仅允许 http/https（防 file:// 注入读到本地文件）
      if (!/^https?:\/\//i.test(real)) {
        return new Response('invalid url', { status: 400 })
      }
      const headers: Record<string, string> = {}
      // 透传 Range（seek 依赖）
      const range = request.headers.get('range')
      if (range) headers['range'] = range
      for (const [rule, referer] of REFERER_RULES) {
        if (rule.test(real)) {
          headers['referer'] = referer
          break
        }
      }
      return net.fetch(real, { headers })
    } catch {
      return new Response('proxy error', { status: 500 })
    }
  })
}
