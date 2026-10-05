/**
 * 冒烟测试：纯 Node 运行（无需 Electron），验证核心纯函数（无 electron 依赖的模块）
 * 覆盖：数据布局常量/章节文件规则/项目 meta 结构、模型价格计算、SSE 流式解析
 * 用法：npm run smoke 或 node e2e/smoke.mjs
 */
import assert from 'node:assert'
import {
  WORKSPACE_DIR_NAME,
  PROJECTS_DIR,
  DRAFT_DIR,
  MATERIALS_ROOT,
  TRASH_DIR_NAME,
  CHAPTER_FILE_RE,
  chapterFileName,
  chapterNumberFromFile,
  normalizeChapterFile,
  volumeFileName,
  defaultChapterProgress,
  defaultProjectMeta
} from '../shared/data-layout.ts'
import { priceForModel, computeCost, DEFAULT_PRICE } from '../shared/pricing.ts'
import { parseSseData, iterateSseLines } from '../src/main/ai/sse-parser.ts'
import { normalizeMemoryPath, normalizeDepositionPath } from '../src/main/ai/tools.ts'
import { parseJsonLenient, extractJson } from '../src/main/ai/json-lenient.ts'
import { runMechanicalCheck } from '../src/main/modules/rules/engine.ts'

// 目录常量
assert.strictEqual(WORKSPACE_DIR_NAME, '落笔')
assert.strictEqual(PROJECTS_DIR, 'projects')
assert.strictEqual(DRAFT_DIR, '正文')
assert.strictEqual(MATERIALS_ROOT, '创作资料')
assert.strictEqual(TRASH_DIR_NAME, '垃圾箱')

// 章节文件名规则（旧版兼容核心）
assert.strictEqual(chapterFileName(1), '第001章.txt')
assert.strictEqual(chapterFileName(42), '第042章.txt')
assert.strictEqual(chapterNumberFromFile('第007章.txt'), 7)
assert.strictEqual(chapterNumberFromFile('第7章.md'), 7)
assert.strictEqual(chapterNumberFromFile('成品.txt'), null)
assert.strictEqual(chapterNumberFromFile('第章.txt'), null)
assert.match('第001章.txt', CHAPTER_FILE_RE)
assert.strictEqual(normalizeChapterFile(0), '第001章.txt') // 下限钳制为 1
assert.strictEqual(volumeFileName(3), '第003卷.md')

// 项目 meta 默认结构（严格对齐真实 project.json）
const p = defaultProjectMeta('t1', '测试书')
assert.strictEqual(p.id, 't1')
assert.strictEqual(p.name, '测试书')
assert.strictEqual(p.creativeDirection, 'novel')
assert.strictEqual(p.chapterProgress.currentChapterNumber, 1)
assert.ok(Array.isArray(p.branchState.branches))
assert.strictEqual(p.branchState.branches.length, 1)
assert.strictEqual(p.branchState.branches[0].id, 'branch_default')

// 章节进度默认值
const prog = defaultChapterProgress()
assert.strictEqual(prog.currentChapterNumber, 1)
assert.strictEqual(prog.lastCompletedChapterNumber, 0)
assert.ok(!Number.isNaN(Date.parse(prog.updatedAt)))

// ============ 模型价格（shared/pricing.ts） ============
assert.strictEqual(priceForModel('deepseek-chat').inputPerM, 0.27)
assert.strictEqual(priceForModel('deepseek-reasoner/v3').outputPerM, 2.19)
assert.strictEqual(priceForModel('claude-opus-4-20250514').inputPerM, 15)
assert.strictEqual(priceForModel('glm-4-flash').inputPerM, 0.14)
assert.deepStrictEqual(priceForModel('某个未收录模型'), DEFAULT_PRICE)
// computeCost：deepseek-chat 各 1M token → 0.27 + 1.1 + 0.07 = 1.44
const cost = computeCost('deepseek-chat', { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0 })
assert.ok(Math.abs(cost - 1.44) < 1e-9, `cost=${cost}`)

// ============ SSE 流式解析（src/main/ai/sse-parser.ts） ============
// OpenAI/DeepSeek 风格：内容增量帧
let d = parseSseData('chat_completions', '{"choices":[{"delta":{"content":"你好"}}]}')
assert.strictEqual(d.content, '你好')
assert.strictEqual(d.done, false)
// 结尾帧（finish_reason=stop 且无 delta）
d = parseSseData('chat_completions', '{"choices":[{"delta":{},"finish_reason":"stop"}]}')
assert.strictEqual(d.done, true)
// 工具调用增量帧（按 index 累积，arguments 为增量片段，解析器只透传不解析其内容）
d = parseSseData('chat_completions', '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"write_chapter","arguments":"{}"}}]}}]}')
assert.strictEqual(d.toolCalls?.[0]?.name, 'write_chapter')
assert.strictEqual(d.toolCalls?.[0]?.id, 'call_1')
assert.strictEqual(d.toolCalls?.[0]?.index, 0)
// usage 帧
d = parseSseData('chat_completions', '{"choices":[{"delta":{}}],"usage":{"prompt_tokens":100,"completion_tokens":50}}')
assert.strictEqual(d.usage?.inputTokens, 100)
// Anthropic 风格：text_delta / message_stop
d = parseSseData('anthropic_messages', '{"type":"content_block_delta","delta":{"type":"text_delta","text":"还"}}')
assert.strictEqual(d.content, '还')
d = parseSseData('anthropic_messages', '{"type":"message_stop"}')
assert.strictEqual(d.done, true)
// Gemini 风格：candidates parts
d = parseSseData('gemini_generate_content', '{"candidates":[{"content":{"parts":[{"text":"好"}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}')
assert.strictEqual(d.content, '好')
assert.strictEqual(d.usage?.outputTokens, 5)
// 行聚合迭代器
const lines = ['data: {"a":1}', 'data: {"a":2}', '', 'data: [DONE]', '']
const got = [...iterateSseLines(lines.join('\n'))]
assert.deepStrictEqual(got, ['{"a":1}{"a":2}', '[DONE]'])

// ============ AI 路径自动归类（src/main/ai/tools.ts） ============
// 重点记忆：已在分类下 → 原样保留
assert.strictEqual(
  normalizeMemoryPath('创作资料/重点记忆/用户偏好/节奏.md'),
  '创作资料/重点记忆/用户偏好/节奏.md'
)
// 重点记忆：散在根目录但文件名含完整分类名 → 归入分类
assert.strictEqual(
  normalizeMemoryPath('创作资料/重点记忆/文风偏好要求.md'),
  '创作资料/重点记忆/文风偏好/文风偏好要求.md'
)
// 文件名不含完整分类名（如"文风风格要求"）→ 按现状原样返回
assert.strictEqual(
  normalizeMemoryPath('创作资料/重点记忆/文风风格要求.md'),
  '创作资料/重点记忆/文风风格要求.md'
)
// 设定沉淀：散在根目录（AI 常写成 时间线.md）→ 归入分类文件夹
assert.strictEqual(
  normalizeDepositionPath('创作资料/设定沉淀/时间线.md'),
  '创作资料/设定沉淀/时间线/时间线.md'
)
// 设定沉淀：臆造目录（物品/…）→ 按关键词归入 实体
assert.strictEqual(
  normalizeDepositionPath('创作资料/设定沉淀/物品/青铜鼎.md'),
  '创作资料/设定沉淀/实体/青铜鼎.md'
)
// 设定沉淀：已在正确分类 → 原样
assert.strictEqual(
  normalizeDepositionPath('创作资料/设定沉淀/人物设定/主角.md'),
  '创作资料/设定沉淀/人物设定/主角.md'
)

// ============ AI 输出 JSON 容错解析（src/main/ai/json-lenient.ts） ============
// 标准 JSON
assert.deepStrictEqual(parseJsonLenient('{"a": 1, "b": "x"}'), { a: 1, b: 'x' })
// extractJson 只取首个 { 到最后一个 } 的区间
assert.strictEqual(extractJson('请输出：{"a":1} 谢谢'), '{"a":1}')
assert.strictEqual(extractJson('没有JSON'), null)
// 前缀说明文字（extractJson 只取 JSON 区间）
assert.deepStrictEqual(parseJsonLenient('请输出：{"a":1}'), { a: 1 })
// 无 JSON 内容 → null
assert.strictEqual(parseJsonLenient('全部完成了，没有 JSON'), null)
// 尾逗号容错（,} 与 ,] ）
assert.deepStrictEqual(parseJsonLenient('{"a": 1, "b": [1, 2, ], }'), { a: 1, b: [1, 2] })
// 空数组/对象之间缺逗号（}] [{} 修复）
assert.deepStrictEqual(parseJsonLenient('{"arr": [[1][2]]}'), { arr: [[1], [2]] })
// 输出被截断（尾部字段完整但缺闭合 }）→ 截断恢复逐字段提取
assert.deepStrictEqual(parseJsonLenient('{"a":"x", "b":"y"'), { a: 'x', b: 'y' })
// 字符串字段缺逗号（AI 常见污染）→ 截断恢复提取
assert.deepStrictEqual(parseJsonLenient('{"a":"x" "b":"y"}'), { a: 'x', b: 'y' })

// ============ 规则机械检查（src/main/modules/rules/engine.ts） ============
const clean = runMechanicalCheck('今天天气不错，我去散步。', {
  version: 1,
  compiledAt: '',
  wordCount: { min: 30, max: 50 },
  bannedWords: ['然而'],
  fatigueWords: [{ word: '目光', maxPerChapter: 2 }],
  aiCliches: ['总而言之'],
  styleRequirements: [],
  other: [],
  rawText: ''
})
assert.strictEqual(clean.length, 1) // 仅字数下限 1 条
assert.strictEqual(clean[0].category, 'word_count')

const dirty = runMechanicalCheck('总而言之，然而他的目光很冷，目光追着目光。', {
  version: 1,
  compiledAt: '',
  wordCount: { min: null, max: null },
  bannedWords: ['然而'],
  fatigueWords: [{ word: '目光', maxPerChapter: 2 }],
  aiCliches: ['总而言之'],
  styleRequirements: [],
  other: [],
  rawText: ''
})
const cats = dirty.map((i) => i.category).sort()
assert.deepStrictEqual(cats, ['ai_cliche', 'banned_word', 'fatigue'])
const fatigue = dirty.find((i) => i.category === 'fatigue')
assert.ok(fatigue && /超过阈值/.test(fatigue.message))

// ============ 音乐库持久化（src/main/music/library.ts） ============
// 隔离目录：不碰用户真实的 ~/.luobi/music-library.json
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const libDir = mkdtempSync(path.join(tmpdir(), 'musiclib-'))
process.env.LUOBI_MUSIC_LIB_DIR = libDir
const { getLibrary, toggleFavorite, recordPlay } = await import('../src/main/music/library.ts')

let lib = getLibrary()
assert.deepStrictEqual(lib, { favorites: [], recent: [] }) // 首次为全空库

const trackA = { id: 'netrack_1', title: '晴天', artist: '周杰伦', source: 'netease', url: 'http://x/expired.mp3' }
const trackB = { id: 'netrack_2', title: '七里香', artist: '周杰伦', source: 'netease' }

lib = toggleFavorite(trackA)
assert.strictEqual(lib.favorites.length, 1)
assert.strictEqual(lib.favorites[0].url, undefined) // 播放地址会过期 → 收藏仅存元信息

lib = toggleFavorite(trackA) // 再点一次 = 取消
assert.strictEqual(lib.favorites.length, 0)
lib = toggleFavorite(trackA)
lib = toggleFavorite(trackB) // 追加
assert.strictEqual(lib.favorites.length, 2)

lib = recordPlay(trackB)
lib = recordPlay(trackA) // 去重置顶
assert.deepStrictEqual(
  lib.recent.map((t) => t.id),
  ['netrack_1', 'netrack_2']
)

// 落盘验证：文件存在、可解析、内容完整（模拟重启后从磁盘恢复）
const onDisk = JSON.parse(readFileSync(path.join(libDir, 'music-library.json'), 'utf8'))
assert.strictEqual(onDisk.favorites.length, 2)
assert.strictEqual(onDisk.recent[0].id, 'netrack_1')
assert.strictEqual(onDisk.favorites[0].title, '七里香') // unshift 追加：最新收藏在最前
assert.strictEqual(onDisk.favorites[1].source, 'netease')

rmSync(libDir, { recursive: true, force: true })

// ============ LRC 歌词解析（src/renderer/src/stores/lrc.ts，纯函数） ============
const { parseLrc } = await import('../src/renderer/src/stores/lrc.ts')
const lrc = parseLrc('[00:01.00]第一句\n[00:11.50][01:02.30]重复句\n[02:00.25] 第三句\n无标签行忽略\n')
assert.deepStrictEqual(
  lrc.map((l) => ({ t: l.time.toFixed(2), text: l.text })),
  [
    { t: '1.00', text: '第一句' },
    { t: '11.50', text: '重复句' },
    { t: '62.30', text: '重复句' }, // 一秒多标签展开
    { t: '120.25', text: '第三句' }
  ]
)
// 千分位小数（[00:01.123]）与毫秒换算
const lrc3 = parseLrc('[01:01.123]毫秒行')
assert.strictEqual(Math.round(lrc3[0].time * 1000), 61123)

// ============ 图片风格增强（src/main/modules/image/style-enhance.ts） ============
const { injectStyleEnhance } = await import('../src/main/modules/image/style-enhance.ts')
// JOJO/荒木 → 荒木线式视觉描述
const jojo = injectStyleEnhance('火星无月亮、暗红日头，JOJO漫画风格，主角背影仰头望星空')
assert.match(jojo, /harsh black ink hatching|manga.*harsh/i)
assert.ok(!jojo.includes('undefined'))
// 吉卜力 → 水彩风描述
assert.match(injectStyleEnhance('主角在山间，吉卜力风格'), /ghibli|watercolor/i)
// 无风格词 → 原样返回
assert.strictEqual(injectStyleEnhance('一只猫'), '一只猫')
// 已含英文描述 → 不重复追加
const once = injectStyleEnhance('JOJO风，retro 1980s shounen manga style: harsh black ink hatching')
assert.strictEqual(once, 'JOJO风，retro 1980s shounen manga style: harsh black ink hatching')

console.log('✅ smoke: 数据布局 / 定价 / SSE / 路径规范化 / JSON容错 / 规则引擎 / 音乐库持久化 / LRC解析 / 图片风格增强 断言全部通过')
