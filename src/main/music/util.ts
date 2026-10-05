/**
 * 音乐源基础工具（移植自 Listen1 lowebutil.js 的适配层，MIT）
 * 差异点：chrome cookies API → 内存 cookie 存储；axios → 主进程 fetch（带 Referer/Cookie 头）
 * 本文件零 electron 依赖 → 可被纯 Node 脚本直接导入联调
 */
import type { CookieItem } from './types.ts'

/** 主进程无 btoa，用 Buffer 补齐（binary 字符串 → base64） */
export function btoa(s: string): string {
  return Buffer.from(s, 'binary').toString('base64')
}

export function getParameterByName(name: string, url: string): string {
  name = name.replace(/[[\]]/g, '\\$&')
  const regex = new RegExp(`[?&]${name}(=([^&#]*)|&|#|$)`)

  const results = regex.exec(url)
  if (!results) return ''
  if (!results[2]) return ''
  return decodeURIComponent(results[2].replace(/\+/g, ' '))
}

// ============ cookie 存储（内存版，运行期内有效；域名维度分桶） ============

const cookieStore = new Map<string, Map<string, { value: string; url: string }>>()

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

export function cookieGet(req: { url: string; name: string }): CookieItem | null {
  const host = hostOf(req.url)
  const bucket = cookieStore.get(host)
  const found = bucket?.get(req.name)
  return found ? { url: found.url, name: req.name, value: found.value } : null
}

export function cookieSet(cookie: { url: string; name: string; value: string }): void {
  const host = hostOf(cookie.url)
  let bucket = cookieStore.get(host)
  if (!bucket) {
    bucket = new Map()
    cookieStore.set(host, bucket)
  }
  bucket.set(cookie.name, { value: cookie.value, url: cookie.url })
}

export function cookieRemove(cookie: { url: string; name: string }): void {
  const host = hostOf(cookie.url)
  cookieStore.get(host)?.delete(cookie.name)
}

/** 为请求构造 Cookie 头（host 精确匹配分桶） */
function cookieHeaderFor(url: string): string {
  const bucket = cookieStore.get(hostOf(url))
  if (!bucket || bucket.size === 0) return ''
  return [...bucket.entries()].map(([k, v]) => `${k}=${v.value}`).join('; ')
}

// ============ HTTP（fetch 封装，默认带 cookie；referer 用于防盗链接口） ============

/** 同 host 请求最小间隔（各源对密集请求有明显频控，短时间连发会被限流） */
const lastReqAt = new Map<string, number>()
const MIN_INTERVAL_MS = 350

async function throttleByHost(url: string): Promise<void> {
  const host = hostOf(url)
  const last = lastReqAt.get(host) ?? 0
  const wait = last + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastReqAt.set(host, Date.now())
  if (lastReqAt.size > 64) lastReqAt.clear() // 防止长期运行 Map 膨胀
}

function normalizeBody(body: unknown): { body: string; headers: Record<string, string> } {
  if (body instanceof URLSearchParams) {
    return { body: body.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }
  }
  if (typeof body === 'string') {
    return { body, headers: { 'content-type': 'application/x-www-form-urlencoded' } }
  }
  return { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
}

/** 返回解析后的 JSON（无法解析时返回字符串文本——部分接口返回纯文本/JSONP） */
export async function httpGet(url: string, referer?: string): Promise<any> {
  await throttleByHost(url)
  const headers: Record<string, string> = {}
  if (referer) headers['referer'] = referer
  const cookie = cookieHeaderFor(url)
  if (cookie) headers.cookie = cookie
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function httpPost(url: string, body: unknown, referer?: string): Promise<any> {
  await throttleByHost(url)
  const { body: bodyStr, headers: baseHeaders } = normalizeBody(body)
  const headers: Record<string, string> = { ...baseHeaders }
  if (referer) headers['referer'] = referer
  const cookie = cookieHeaderFor(url)
  if (cookie) headers.cookie = cookie
  const res = await fetch(url, { method: 'POST', body: bodyStr, headers })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// ============ async 库的并发原语（用 Promise 实现） ============

/** async.concat：按序逐个处理（保持结果顺序的串行 concat） */
export async function asyncConcat<T, R>(
  items: T[],
  handler: (item: T, callback: (err: unknown, result?: R) => void) => void
): Promise<R[]> {
  const out: R[] = []
  for (const item of items) {
    await new Promise<void>((resolve, reject) => {
      handler(item, (err, result) => {
        if (err) return reject(err)
        if (result !== undefined) out.push(result)
        resolve()
      })
    })
  }
  return out
}

/** async.parallel：并行执行，按回调完成顺序收集 */
export function asyncParallel(
  tasks: ((cb: (err?: unknown, result?: any) => void) => void)[],
  done: (err: unknown, results: any[]) => void
): void {
  const results: any[] = []
  let remaining = tasks.length
  if (remaining === 0) return done(null, [])
  tasks.forEach((task) => {
    task((err, result) => {
      if (err) return done(err, results)
      results.push(result)
      remaining -= 1
      if (remaining === 0) done(null, results)
    })
  })
}
