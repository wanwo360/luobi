/**
 * 联网搜索（为 AI 工具 web_search 服务）：查画风/查资料，生成更精准的图像与回答
 * 零 key、无 electron 依赖；Node 原生 fetch + 正则解析（无 DOMParser）
 * 引擎链：搜狗（中文专名强、无合规阉割）→ Bing 国内版（通用/英文强），
 * 按"关键词命中质量"回退：首个引擎命中文中专名短语即可用，否则换下一个
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export interface WebResult {
  title: string
  url: string
  snippet: string
}

/** 搜索（8s 超时；引擎失败自动回退；全部失败抛错由工具层转友好摘要） */
export async function webSearch(query: string, limit = 8): Promise<WebResult[]> {
  const q = String(query ?? '').trim()
  if (!q) return []
  // 判定"关键词"：优先最长中文短语（专名），否则最长字母数字词（英文查询）
  const keyword = longestCJKPhrase(q) ?? keyAlnumToken(q)
  const engines: Array<(x: string, n: number) => Promise<WebResult[]>> = [sogouSearch, bingSearch]
  const merged: WebResult[] = []
  let lastErr: unknown = null
  for (const fn of engines) {
    let results: WebResult[] = []
    try {
      results = await fn(q, limit)
    } catch (err) {
      lastErr = err
      continue
    }
    if (!results.length) continue
    // 命中判定：任一结果标题/摘要含关键词 → 该引擎够用，直接返回
    if (keyword && results.some((r) => r.title.includes(keyword) || r.snippet.includes(keyword))) {
      return results
    }
    // 未命中：收进候选，换下一引擎（dedupe 按标题）
    for (const r of results) {
      if (!merged.some((m) => m.title === r.title)) merged.push(r)
    }
  }
  if (merged.length) return merged.slice(0, limit)
  throw new Error(lastErr instanceof Error ? lastErr.message : '搜索失败：没有可用的搜索源')
}

/** 搜狗：中文专名/画风查询强；UTF-8 静态页，块级 vrwrap */
async function sogouSearch(q: string, limit: number): Promise<WebResult[]> {
  const res = await fetch('https://www.sogou.com/web?query=' + encodeURIComponent(q), {
    headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(9000)
  })
  if (!res.ok) throw new Error(`搜狗搜索失败（HTTP ${res.status}）`)
  const html = await res.text()
  const blocks = html.split(/<div class="vrwrap">/).slice(1)
  const results: WebResult[] = []
  for (const block of blocks) {
    if (results.length >= limit) break
    const hrefM = /<h3[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/.exec(block) ?? /<a[^>]+href="([^"]+)"[^>]*>/.exec(block)
    const href = hrefM?.[1] ?? ''
    const title = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(block)?.[1] ?? ''
    const snippet = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1] ?? ''
    const t = stripHtml(title)
    if (t && href) {
      results.push({
        title: t,
        url: href.startsWith('http') ? href : `https://www.sogou.com${href}`,
        snippet: stripHtml(snippet).slice(0, 220)
      })
    }
  }
  return results
}

/** Bing 国内版：通用/英文强；个别题材受当地合规过滤（返回票务站等错误结果） */
async function bingSearch(q: string, limit: number): Promise<WebResult[]> {
  const res = await fetch(`https://cn.bing.com/search?q=${encodeURIComponent(q)}&count=${limit + 4}`, {
    headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(9000)
  })
  if (!res.ok) throw new Error(`Bing 搜索失败（HTTP ${res.status}）`)
  const html = await res.text()
  const blocks = splitBingBlocks(html)
  const results: WebResult[] = []
  for (const block of blocks) {
    if (results.length >= limit) break
    const href = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"/.exec(block)?.[1] ?? ''
    const titleM = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(block)
    const snippetM = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block) ?? /<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block)
    const title = titleM ? stripHtml(titleM[1]) : ''
    const snippet = snippetM ? stripHtml(snippetM[1]) : ''
    if (title && href) {
      results.push({ title, url: href.replace(/&amp;/g, '&'), snippet: snippet.slice(0, 220) })
    }
  }
  if (!results.length) {
    // 兜底：页面可读文本（前端渲染信息更多）
    const text = stripHtml(html).replace(/\s+/g, ' ').trim()
    if (text.length > 60) results.push({ title: q, url: 'https://cn.bing.com', snippet: text.slice(0, 240) })
  }
  return results
}

/** 取查询中最长的连续中文短语（3 字起），判定专名命中 */
function longestCJKPhrase(q: string): string | null {
  const m = q.match(/[一-龥]{3,}/g)
  if (!m) return null
  return m.sort((a, b) => b.length - a.length)[0]
}

/** 无中文短语时取最长字母数字词（英文查询判定用） */
function keyAlnumToken(q: string): string | null {
  const m = q.match(/[A-Za-z0-9]{4,}/g)
  if (!m) return null
  return m.sort((a, b) => b.length - a.length)[0]
}

/** 按 b_algo 块切分（防止块内嵌套 href 越界） */
function splitBingBlocks(html: string): string[] {
  const out: string[] = []
  const re = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) out.push(m[1])
  return out
}

/** 剥离标签与实体，压缩空白 */
function stripHtml(html: string): string {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&ensp;|&emsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // 数字实体补全（&#183; 之类，Bing 摘要常用；含十进制与十六进制）
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, ' ')
    .trim()
}

/** 结果转文本（回填 AI） */
export function webResultsToText(results: WebResult[]): string {
  if (!results.length) return '未找到相关结果。'
  return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\n${r.url}`).join('\n\n')
}
