/**
 * web_search 连通性诊断：双引擎链（搜狗+Bing）真实抓取验证
 * 用法：node e2e/diagnostics/web-search-probe.mjs [查询词...]
 * 覆盖：正常画风查询 / 中文专名（Bing 合规阉割场景） / 空查询
 */
import { webSearch, webResultsToText } from '../../src/main/ai/web-search.ts'

const queries = process.argv.slice(2)
if (!queries.length) {
  queries.push('JOJO 荒木飞吕彦 画风 视觉特征', '猫眼三姐妹 画风 风格 特征')
}
let failed = 0
for (const q of queries) {
  const t0 = Date.now()
  try {
    const r = await webSearch(q, 5)
    const hit = r.length ? r[0].title + ' / ' + r[0].snippet.slice(0, 60) : '(空)'
    console.log(`OK   "${q}" -> ${r.length} 条 in ${Date.now() - t0}ms\n     ${hit}`)
    if (!r.length) failed++
  } catch (e) {
    console.log(`FAIL "${q}" -> ${e.message}`)
    failed++
  }
}
console.log(failed ? `❌ ${failed} 个查询失败` : '✅ 全部查询成功')
process.exit(failed ? 1 : 0)
