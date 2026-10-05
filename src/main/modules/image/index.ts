/**
 * image IPC 域：AI 图片生成（OpenAI 兼容 /v1/images/generations）
 * 支持：智谱 CogView / SiliconFlow / 任意兼容服务
 * 生成结果保存到：创作资料/生成图片/
 */
import { ipcMain, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { IPC } from '@shared/ipc'
import type { ImageServiceConfig, GeneratedImage } from '@shared/types/image'
import { readJson, writeJson, homePath, getProjectRoot, toAppError, AppError } from '../shared/fs-utils'
import { MATERIALS_ROOT } from '@shared/data-layout'
import { providerStore } from '../provider'
import { injectStyleEnhance } from './style-enhance.ts'

export type { ImageServiceConfig, GeneratedImage }

interface ImageStore {
  service: ImageServiceConfig | null
  history: GeneratedImage[]
}

const IMAGE_CONFIG_FILE = 'image-config.json'

const imageStore = {
  filePath(): string {
    return path.join(homePath(), '.luobi', IMAGE_CONFIG_FILE)
  },
  async load(): Promise<ImageStore> {
    return readJson<ImageStore>(this.filePath(), { service: null, history: [] })
  },
  async save(store: ImageStore): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath()), { recursive: true })
    await writeJson(this.filePath(), store)
  }
}

function generatedDir(): string {
  return path.join(getProjectRoot(), MATERIALS_ROOT, '生成图片')
}

// ============ 本地 ComfyUI 适配层（SDXL/FLUX 本地出图，零费用） ============

/** 判定本地 ComfyUI（默认 127.0.0.1:8188） */
function isLocalComfy(base: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(base)
}

// ---------- 服务自动拉起：生成图片时若 8188 未就绪，自动启动 run_nvidia_gpu.bat ----------

interface ComfyRunState {
  ready: boolean
  starting: boolean
  error: string | null
}

const comfyState: ComfyRunState = { ready: false, starting: false, error: null }
let startPromise: Promise<boolean> | null = null

/** run_nvidia_gpu.bat 候选路径（环境变量优先，其次常见安装位置） */
function comfyBatCandidates(): string[] {
  const home = os.homedir()
  return [
    process.env.LUOBI_COMFY_BAT ?? '',
    path.join(home, 'ComfyUI-portable', 'ComfyUI_windows_portable', 'run_nvidia_gpu.bat'),
    path.join(home, 'ComfyUI', 'run_nvidia_gpu.bat')
  ].filter(Boolean)
}

/** 探测 8188 是否就绪 */
async function comfyReady(base: string, timeoutMs = 2500): Promise<boolean> {
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/system_stats`, { signal: AbortSignal.timeout(timeoutMs) })
    comfyState.ready = res.ok
  } catch {
    comfyState.ready = false
  }
  return comfyState.ready
}

/** 状态推送（图片工作台的状态条依此刷新） */
function notifyComfy(status: 'idle' | 'starting' | 'ready' | 'failed', message?: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.image.eventComfyStatus, { status, message })
  }
}

/**
 * 启动本地 ComfyUI（幂等）：未就绪 → spawn run_nvidia_gpu.bat（黑色窗口可见加载日志/报错）
 * → 轮询 /system_stats 直至就绪（最长 4 分钟）。已在启动中的并发调用共用同一 promise
 */
function startComfy(base: string): Promise<boolean> {
  if (startPromise) return startPromise
  startPromise = (async () => {
    if (await comfyReady(base, 2000)) {
      notifyComfy('ready')
      startPromise = null
      return true
    }
    // 找 bat
    let bat: string | null = null
    for (const p of comfyBatCandidates()) {
      try {
        await fs.stat(p)
        bat = p
        break
      } catch {
        /* 继续找 */
      }
    }
    if (!bat) {
      comfyState.error = '未找到 run_nvidia_gpu.bat（期望位置：~/ComfyUI-portable/ComfyUI_windows_portable/）'
      notifyComfy('failed', comfyState.error)
      startPromise = null
      return false
    }
    comfyState.starting = true
    comfyState.error = null
    notifyComfy('starting', '正在启动本地 ComfyUI…')
    // 分离进程：cmd /c 跑 bat（bat 内含 pause，独立窗口可见加载进度）
    spawn('cmd.exe', ['/d', '/c', `"${bat}"`], { detached: true, stdio: 'ignore' }).unref()
    const deadline = Date.now() + 240_000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500))
      if (await comfyReady(base, 1500)) {
        comfyState.starting = false
        notifyComfy('ready', '本地 ComfyUI 已就绪')
        startPromise = null
        return true
      }
    }
    comfyState.starting = false
    comfyState.error = '等 4 分钟仍未就绪：请查看黑色窗口日志（可能是模型加载中/显存不足/端口被占用）'
    notifyComfy('failed', comfyState.error)
    startPromise = null
    return false
  })()
  return startPromise
}

/** 漫画/动漫类风格判定（命中 → 本地路由 SDXL） */
function isMangaStyle(prompt: string): boolean {
  return /(?:jojo|荒木|漫画|日漫|日式漫画|美漫|美式漫画|二次元|动漫|吉卜力|宫崎骏|浮世绘|水墨|像素|manga|comic|anime|animestyle|screentone|ink hatching)/i.test(
    prompt
  )
}

/** 生成前确保本地服务就绪：失败抛 AppError（含具体原因） */
async function ensureComfyStarted(base: string): Promise<void> {
  if (!isLocalComfy(base)) return
  const ok = await startComfy(base)
  if (!ok) throw new AppError('comfyui_offline', comfyState.error ?? 'ComfyUI 未就绪', true)
}

/**
 * 中文提示词 → 英文（SDXL/FLUX 本地模型只吃英文；复用用户已配置的文本模型翻译）
 * 关键：只翻译中文部分——prompt 里已存在的英文段（如风格增强注入的 ". Art style: …" 精确英文描述、
 * 手动工作台的 STYLES 英文预设）原样保留，防止二次翻译把"harsh black ink hatching and screentone"
 * 冲淡成"comic style"（这是"JOJO 变日常"的元凶）
 */
async function translateToEnglish(text: string): Promise<string> {
  // 全英文（无中文）→ 无需翻译
  if (!/[一-龥]/.test(text)) return text
  const { zh, enBlocks } = splitMixed(text)
  if (!zh.trim()) return text
  try {
    const state = await providerStore.load()
    const provider = state.providers.find((p) => p.id === state.activeProviderId)
    if (!provider || !state.activeModelId) return text
    const res = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({
        model: state.activeModelId,
        messages: [
          {
            role: 'system',
            content:
              '你是图像提示词翻译器。将用户的中文图像描述翻译成专业英文图生提示词（English only，保留风格、构图、光照、色彩关键词）。只输出译文。'
          },
          { role: 'user', content: zh }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    })
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const out = j?.choices?.[0]?.message?.content?.trim() ?? ''
    if (!out) return text
    // 翻译段在前，原英文段依原顺序拼回（风格细节不再被翻译改写）
    return [out, ...enBlocks].join(' ').trim()
  } catch {
    return text
  }
}

/** 按句切分：纯英文句（无中文且 ASCII≥8）识别为受保护段，其余合成中文翻译主体 */
function splitMixed(text: string): { zh: string; enBlocks: string[] } {
  const sentences = text.split(/(?<=[。！？!?；;])/u)
  const zhParts: string[] = []
  const enBlocks: string[] = []
  for (const s of sentences) {
    const cjk = (s.match(/[一-龥]/g) ?? []).length
    const ascii = (s.match(/[\x21-\x7e]/g) ?? []).length
    if (cjk === 0 && ascii >= 8) enBlocks.push(s.trim())
    else zhParts.push(s)
  }
  return { zh: zhParts.join(''), enBlocks }
}

/**
 * ComfyUI 出图：POST /prompt（API 格式工作流）→ 轮询 /history → /view 取图
 * SDXL 默认 1024×1024 高；分辨率取 64 的倍数（且 768 视为 768n 档）
 */
async function comfyuiGenerate(
  base: string,
  prompt: string,
  size: string,
  model: string
): Promise<{ b64_json: string }[]> {
  const [wRaw = 1024, hRaw = 1024] = String(size).toLowerCase().split('x').map((n) => Number(n))
  const fit = (v: number): number => {
    if (v >= 640) return Math.max(768, Math.round(v / 64) * 64)
    return Math.max(384, Math.round(v / 64) * 64)
  }
  const W = fit(wRaw)
  const H = fit(hRaw)
  const en = await translateToEnglish(prompt)
  const seed = Math.floor(Math.random() * 2 ** 31)
  // SDXL 对句首注意力权重高：把 Art style 精确风格段前置（句尾的风格词常被忽略 → 画风退化成普通插画）
  const styleBlock = /(\.\s*Art style:[\s\S]*)$/i.exec(en)?.[1] ?? ''
  const styleFirstPrompt = styleBlock ? `${styleBlock.trim()}. ${en.replace(styleBlock, '').trim()}` : en

  // 模型后缀 .gguf 或名称含 flux → FLUX 工作流（UnetLoaderGGUF + DualCLIPLoader + ModelSamplingFlux）
  const isFlux = /\.gguf$/i.test(model) || /flux/i.test(model)
  let workflow: Record<string, any>
  let saveNode = '7'
  if (isFlux) {
    workflow = {
      '1': { class_type: 'UnetLoaderGGUF', inputs: { unet_name: model, weight_dtype: 'default' } },
      '2': {
        class_type: 'ModelSamplingFlux',
        inputs: { model: ['1', 0], max_shift: 1.15, base_shift: 0.5, width: W, height: H }
      },
      '3': {
        class_type: 'DualCLIPLoaderGGUF',
        inputs: { clip_name1: 'clip_l.safetensors', clip_name2: 't5-xxl-Q5_K_M.gguf', type: 'flux' }
      },
      '4': { class_type: 'CLIPTextEncode', inputs: { text: en, clip: ['3', 0] } },
      '5': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: 'lowres, watermark, text, logo, bad anatomy, worst quality, blurry, signature, ai label',
          clip: ['3', 0]
        }
      },
      '6': { class_type: 'EmptyLatentImage', inputs: { width: W, height: H, batch_size: 1 } },
      '7': {
        class_type: 'KSampler',
        inputs: {
          model: ['2', 0],
          positive: ['4', 0],
          negative: ['5', 0],
          latent_image: ['6', 0],
          seed,
          steps: 20,
          cfg: 1,
          sampler_name: 'euler',
          scheduler: 'simple',
          denoise: 1
        }
      },
      '8': { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
      '9': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['8', 0] } },
      '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'luobi' } }
    }
    saveNode = '10'
  } else {
    workflow = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: model } },
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: { text: `${styleFirstPrompt}, masterpiece, best quality`, clip: ['1', 1] }
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: {
          text: 'lowres, watermark, text, logo, bad anatomy, worst quality, blurry, signature, ai label',
          clip: ['1', 1]
        }
      },
      '4': {
        class_type: 'KSampler',
        inputs: {
          model: ['1', 0],
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['5', 0],
          seed,
          steps: 30,
          cfg: 7,
          sampler_name: 'dpmpp_2m',
          scheduler: 'karras',
          denoise: 1
        }
      },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: W, height: H, batch_size: 1 } },
      '6': { class_type: 'VAEDecode', inputs: { samples: ['4', 0], vae: ['1', 2] } },
      '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'luobi' } }
    }
  }
  const clientId = `luobi-${Date.now().toString(36)}`
  const resp = await fetch(`${base.replace(/\/+$/, '')}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId })
  })
  if (!resp.ok) {
    // 400 类：工作流/模型校验被拒（如模型名与实际文件名不符）——如实带出原因，避免误传"未启动"
    if (resp.status >= 400 && resp.status < 500) {
      let detail = ''
      try {
        detail = (await resp.text()).slice(0, 300)
      } catch {
        /* 忽略 */
      }
      throw new AppError(
        'comfyui_error',
        `本地生成被拒绝（HTTP ${resp.status}）：${detail || '工作流校验未通过（请检查设置中的模型名与本地文件名一致）'}`,
        true
      )
    }
    throw new AppError(
      'comfyui_offline',
      'ComfyUI 未响应：已自动尝试启动本地 ComfyUI，仍失败请查看黑色窗口日志（GPU 显存不足/端口被占用也可能导致）',
      true
    )
  }
  const { prompt_id } = (await resp.json()) as { prompt_id: string }
  // 轮询结果（SDXL 单张 1024² 通常 10-30 秒），超时 240s
  let entry: any = null
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 900))
    try {
      const h = (await (await fetch(`${base.replace(/\/+$/, '')}/history/${prompt_id}`)).json()) as any
      const e = h?.[prompt_id]
      if (e?.status?.completed) {
        entry = e
        break
      }
      if (e?.status?.status_str === 'error') {
        const msg = e.status?.messages?.[0]?.[1]?.message ?? '生成出错（可能模型未下载/显存不足）'
        throw new AppError('comfyui_error', `本地生成失败：${String(msg).slice(0, 120)}`, true)
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      /* 轮询中间抖动忽略 */
    }
  }
  if (!entry) {
    throw new AppError('comfyui_error', '本地生成超时（240s）：请检查 ComfyUI 窗口是否在正常出图', true)
  }
  const images = entry.outputs?.[saveNode]?.images ?? []
  const results: { b64_json: string }[] = []
  for (const m of images) {
    const v = await fetch(
      `${base.replace(/\/+$/, '')}/view?filename=${encodeURIComponent(m.filename)}&subfolder=${encodeURIComponent(m.subfolder ?? '')}&type=${encodeURIComponent(m.type ?? 'output')}`
    )
    const buf = Buffer.from(await v.arrayBuffer())
    if (buf.length) results.push({ b64_json: buf.toString('base64') })
  }
  return results
}

export async function generateImage(prompt: string, opts: { size?: string; count?: number } = {}): Promise<GeneratedImage[]> {
  const store = await imageStore.load()
  const service = store.service
  if (!service || !service.enabled || !service.apiKey) {
    throw new AppError('no_image_service', '尚未配置图片生成服务，请在 设置 → 模型 → 图片生成 中配置（支持智谱 CogView / SiliconFlow 等 OpenAI 兼容服务）', true)
  }
  // 风格增强：'JOJO风/吉卜力' 等术语 → 模型能懂的视觉描述（基础模型不认画师名）
  prompt = injectStyleEnhance(prompt)

  const base = service.baseUrl.replace(/\/+$/, '')
  const size = opts.size ?? service.size ?? '1024x1024'
  const count = Math.min(Math.max(opts.count ?? 1, 1), 4)

  let results: { b64_json?: string; url?: string }[]
  if (isLocalComfy(base)) {
    // 本地 ComfyUI（SDXL/FLUX）：确保服务就绪（未启动自动拉起，最长等 4 分钟），中文 prompt 自动翻译后走工作流出图
    await ensureComfyStarted(base)
    // 漫画/动漫类风格自动路由到 SDXL：FLUX 对线条刻画响应弱（实测 JOJO 请求产出"现代日漫插画"、
    // 无排线/网点），SDXL 漫画数据更足——写实/电影感封面仍用 FLUX
    const sdxlPath = 'sd_xl_base_1.0.safetensors'
    const useFlux = /\.gguf$/i.test(service.model) || /flux/i.test(service.model)
    const useSdxl = isMangaStyle(prompt) && useFlux
    const model = useSdxl ? sdxlPath : service.model
    if (useSdxl) console.warn('[image] 命中漫画风格 → 自动切换 SDXL 出图（FLUX 漫画线条弱）')
    results = await comfyuiGenerate(base, prompt, size, model)
  } else {
    const res = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${service.apiKey}`
      },
      body: JSON.stringify({
        model: service.model,
        prompt,
        n: count,
        size,
        response_format: 'b64_json',
        // 关闭 AI 生成标识水印：cogview 系认 watermark（此前用 Gemini 系参数 watermark_enabled 未生效）
        watermark: false,
        watermark_enabled: false
      })
    })

    if (!res.ok) {
      let detail = ''
      try {
        const j = (await res.json()) as { error?: { message?: string } }
        detail = j?.error?.message ?? ''
      } catch {
        /* 忽略 */
      }
      throw new AppError('image_api_error', `图片生成失败（HTTP ${res.status}）：${detail || '请检查服务配置'}`, true)
    }

    // 兼容两种响应：① OpenAI 兼容 JSON（data[].b64_json/url）② 裸图字节（Pollinations flux 直返 PNG）
    const ct = res.headers.get('content-type') ?? ''
    if (ct.startsWith('image/')) {
      const buf = Buffer.from(await res.arrayBuffer())
      if (!buf.length) throw new AppError('image_empty', '服务未返回图片', true)
      results = [{ b64_json: buf.toString('base64') }]
    } else {
      const data = (await res.json()) as { data?: { b64_json?: string; url?: string }[] }
      results = (data.data ?? []).slice(0, count)
    }
  }
  if (!results.length) {
    throw new AppError('image_empty', '服务未返回图片', true)
  }

  const dir = generatedDir()
  await fs.mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:.T]/g, '').slice(0, 17)
  const saved: GeneratedImage[] = []

  for (let i = 0; i < results.length; i++) {
    const item = results[i]
    const id = randomUUID().slice(0, 8)
    const name = `${stamp}_${id}${count > 1 ? `_${i + 1}` : ''}.png`
    const target = path.join(dir, name)
    if (item.b64_json) {
      await fs.writeFile(target, Buffer.from(item.b64_json, 'base64'))
    } else if (item.url) {
      const imgRes = await fetch(item.url)
      await fs.writeFile(target, Buffer.from(await imgRes.arrayBuffer()))
    } else {
      continue
    }
    const record: GeneratedImage = {
      id,
      prompt,
      filePath: `${MATERIALS_ROOT}/生成图片/${name}`,
      size,
      createdAt: new Date().toISOString()
    }
    saved.push(record)
    store.history.unshift(record)
  }

  store.history = store.history.slice(0, 100)
  await imageStore.save(store)
  return saved
}

/**
 * 保存派生图（封面文字合成 / 漫画分镜拼贴等 canvas 产物）
 * dataUrl 传回主进程直接落盘，复用生成目录与历史
 */
export async function saveDerivedImage(dataUrl: string, label: string): Promise<GeneratedImage> {
  const m = /^data:image\/(png|jpeg);base64,([\s\S]+)$/.exec(dataUrl)
  if (!m) throw new AppError('invalid_data', '不是有效图片数据', true)
  const buf = Buffer.from(m[2], 'base64')
  const dir = generatedDir()
  await fs.mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:.T]/g, '').slice(0, 17)
  const id = randomUUID().slice(0, 8)
  const safe = String(label ?? 'img').replace(/[\\/:*?"<>|]/g, '')
  const name = `${stamp}_${safe}_${id}.png`
  await fs.writeFile(path.join(dir, name), buf)
  const record: GeneratedImage = {
    id,
    prompt: label,
    filePath: `${MATERIALS_ROOT}/生成图片/${name}`,
    size: '1024x1536',
    createdAt: new Date().toISOString()
  }
  const store = await imageStore.load()
  store.history.unshift(record)
  store.history = store.history.slice(0, 100)
  await imageStore.save(store)
  return record
}

/** 根据生成历史找到原图的 prompt（重绘修改用） */
export async function findPromptByPath(relPath: string): Promise<string | null> {
  const store = await imageStore.load()
  const hit = store.history.find((h) => h.filePath === relPath)
  return hit?.prompt ?? null
}

export function registerImageIpc(): void {
  ipcMain.handle(IPC.image.getConfig, async () => {
    try {
      const store = await imageStore.load()
      return { service: store.service, history: store.history.slice(0, 20) }
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.image.saveConfig, async (_e, config: Omit<ImageServiceConfig, 'updatedAt'>) => {
    try {
      const store = await imageStore.load()
      store.service = { ...config, updatedAt: new Date().toISOString() }
      await imageStore.save(store)
      return store.service
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.image.generate, async (_e, prompt: string, opts?: { size?: string; count?: number }) => {
    try {
      const result = await generateImage(prompt, opts)
      // 通知资料面板刷新
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.image.eventGenerated, { count: result.length })
      }
      return result
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.image.comfyStatus, async () => {
    try {
      const store = await imageStore.load()
      const s = store.service
      const local = !!s?.enabled && isLocalComfy(s?.baseUrl ?? '')
      // 打开工作台时实时探测一次（轻量，2s 超时）
      if (local) await comfyReady(s!.baseUrl, 2000)
      return { isLocal: local, ready: comfyState.ready, starting: comfyState.starting, error: comfyState.error }
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.image.comfyStart, async () => {
    try {
      const store = await imageStore.load()
      const s = store.service
      if (!s || !isLocalComfy(s?.baseUrl ?? '')) return false
      const ok = await startComfy(s.baseUrl)
      if (!ok) throw new AppError('comfyui_start_failed', comfyState.error ?? 'ComfyUI 启动失败', true)
      return true
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.image.saveDerived, async (_e, dataUrl: string, label: string) => {
    try {
      const record = await saveDerivedImage(String(dataUrl ?? ''), String(label ?? '封面'))
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.image.eventGenerated, { count: 1 })
      }
      return record
    } catch (err) {
      throw toAppError(err)
    }
  })

  ipcMain.handle(IPC.image.readFile, async (_e, relPath: string) => {
    try {
      const abs = resolveImagePath(relPath)
      const stat = await fs.stat(abs)
      // mtime+size 不变则复用缓存（同一张图被多次预览时不重复读盘+base64；上限 20 张防内存堆积）
      const cached = readFileCache.get(abs)
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.dataUrl
      }
      const buf = await fs.readFile(abs)
      // 按实际扩展名给 mime（此前一律标 image/png，jpeg/webp/gif 预览依赖浏览器宽容）
      const mime =
        {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
          '.gif': 'image/gif',
          '.bmp': 'image/bmp'
        }[path.extname(abs).toLowerCase()] ?? 'image/png'
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      readFileCache.set(abs, { mtimeMs: stat.mtimeMs, size: stat.size, dataUrl })
      if (readFileCache.size > 20) readFileCache.clear()
      return dataUrl
    } catch (err) {
      throw toAppError(err)
    }
  })
}

/** 图片 dataURL 读盘缓存（mtime+size 键，见 readFile handler） */
const readFileCache = new Map<string, { mtimeMs: number; size: number; dataUrl: string }>()

/** 校验并解析创作资料内的图片路径 */
function resolveImagePath(relPath: string): string {
  const root = getProjectRoot()
  const abs = path.resolve(root, relPath)
  const materialsAbs = path.join(root, MATERIALS_ROOT)
  if (!abs.startsWith(materialsAbs + path.sep)) {
    throw new AppError('invalid_path', '非法图片路径', true)
  }
  const ext = path.extname(abs).toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) {
    throw new AppError('invalid_type', '不是图片文件', true)
  }
  return abs
}
