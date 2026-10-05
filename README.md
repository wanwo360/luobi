# 落笔 · 万象文新

科技予你同在 · 未来无限可能 —— 本地优先的长篇 AI 创作工作台。

> **关于作者与 AI 辅助**
>
> 这个项目是在 AI 辅助下完成的：方向、取舍和验收由我负责，代码主要由 AI 生成并反复迭代。
> 我是个普通人，编程并不在行，代码里一定还有许多可以做得更好的地方。
> 如果你发现问题、有更漂亮的写法，或者只是想留一句建议，欢迎提 Issue 或留言 —— 我看到了就会改。
> 谢谢你的耐心。

> **关联声明**
>
> 本项目是独立的个人项目，与任何商业写作软件**均无关联**，也未获得任何厂商的授权、赞助或背书。
> 代码保留了读取旧版数据目录（`Documents/星炉/`）的能力，目的是迁移我自己已有的书目，
> 属于数据互操作；这不代表与相关产品存在任何合作关系。

---

## English

**Luobi (落笔 · 万象文新)** is a local-first writing studio for long-form fiction.

> **A note on authorship.** This project was built with heavy AI assistance: I set the direction
> and made the calls, while the code was mostly generated and iterated by AI. I'm an ordinary
> person, not a professional programmer, so there is certainly room for improvement in here.
> If you spot a problem, know a better way, or just want to leave a suggestion, please open an
> issue or drop a comment — I'll fix it when I see it. Thanks for your patience.

> **No affiliation.** This is an independent personal project. It is not affiliated with,
> authorised by, sponsored by, or endorsed by any commercial writing software. The code can read
> a legacy data directory (`Documents/星炉/`) purely for data interoperability — so that my own
> existing manuscripts keep working — which does not imply any relationship with those products.

Your manuscript is plain text on your own disk — one file per chapter, plus Markdown outlines
and setting notes. Nothing is uploaded, and no API key ships with the app: you connect your own
OpenAI-compatible endpoint.

Around the editor it keeps what long fiction actually needs:

- **Consistency interlock** (the core idea) — a *world-state ledger* tracks the protagonist's
  assets, power, level, location, inventory and relationships, plus **persistent state** such as
  injuries, stamina and gear wear — an unhealed wound must keep showing up in every chapter.
  The ledger is injected **in full** on every generation, rewritten **automatically** after each
  chapter, and checked by **two independent conflict detectors**: one semantic (the model
  cross-checks numbers in the prose against the ledger) and one **purely mechanical** (a number
  exceeding the ledger by 5× with no stated cause is flagged, whatever the model claims).
- **Auto-maintenance after every chapter** — save a chapter and, five seconds later, the app
  re-reads it and rewrites the story summary, the state ledger, the canon files (characters,
  world, entities, relationships, foreshadowing, timeline), the outline (master / volume /
  chapter / revision log), chapter abstracts and key memory. Debounced, re-run on the next
  launch if you quit mid-debounce, retried once on parse failure, and degraded to at least
  timeline + outline markers if the model output still can't be parsed.
- **Token discipline** — context is budgeted per section instead of dumped in whole: the state
  ledger gets 9000 chars (the one part that must not be truncated), rules 5000, master outline
  3500, summaries and the next-chapter outline 3000 each, and recent chapters only their **last
  2500 chars**; background canon/memory pre-reading takes only the **first 120–200 chars per
  file**. Chat history is truncated per message, retry loops are capped, and one JSON call
  updates summary + ledger + canon + memory + outline at once instead of several. A built-in
  price table (DeepSeek, GPT, Claude, Gemini, Chinese providers) bills cached input at its
  discounted rate.
- **Outline & setting memory** — characters, world, entities, relationships, foreshadowing,
  timeline; injected into the model's context automatically
- **Rule engine** — enforces word-count limits and banned / tired-word lists
- **Commit self-check** — runs before a chapter is written to disk
- **Usage tracking** — token and cost, per project
- **Multi-book projects** — version snapshots and rollback, plus an agent runner
- **Music playback** — for when the writing session runs long

Built with Electron, React 19 and TypeScript. Windows. MIT licensed. v0.1.0 — early, and moving.

> **Bring your own key.** The app ships with no credentials and uploads nothing.
> Media playback talks to unofficial APIs of third-party services; it is included for personal,
> educational use only. Rights to all media belong to their respective owners.

---

## 亮点

### 🔒 一致性互锁 —— 本项目的核心

AI 写长篇最大的痛点是"写着写着就前后矛盾"。落笔不靠模型自觉：它把
**设定 / 大纲 / 正文 / 台账**四者互相锁死，而且**有机械检测兜底**。

**世界状态台账**（`创作资料/重点记忆/小说规划/世界状态台账.md`）记录并强制维护：

- 主角状态：资产、实力、等级、所在地点、持有物品、人际关系
- **持续状态**：伤病（哪一章受的伤、部位、严重程度、是否愈合）、体力、装备损耗
  —— 未痊愈的伤**必须每章持续体现**，不得凭空消失；恢复必须写明过程
- 势力格局、关键时间线（第几章发生了什么）

**锁在哪些环节：**

| 环节 | 机制 |
|---|---|
| **写前** | 台账**完整注入**每次创作上下文（刻意不截断尾部时间线），并硬性约束"数值以台账为准，不得随意更改" |
| **写后** | 章节保存后自动分析回写：前文概要 / 台账 / 设定沉淀 / 大纲 / 细纲 / 时间线 |
| **硬性输出** | `state_update` 必须输出；`canon_updates` **禁止空数组**（至少要有时间线更新） |
| **双重冲突检测** | ① AI 逐条核对正文数值与台账；② **纯机械检测**：正文数值超台账 5 倍且无来源交代 → 直接报冲突 |
| **提交校验网关** | 落盘前再核对一遍前文资料，检出矛盾 / 脱节 / 元叙述 |
| **优先级** | 章节细纲 > 分卷大纲 > 总纲；**数值以世界状态台账为准** |
| **设定强制落盘** | 聊天里修正设定时，AI 必须**立即写文件**，不许只回"记住了" |
| **缺口补齐** | 一键遍历已写章节，补齐缺失的时间线 / 细纲 / 大纲标记 |

### 🔄 保存一章，资料自动长出来（不用手动维护）

章节存盘 5 秒后，自动读最新章节并回写：**前文剧情概要 / 世界状态台账 / 设定沉淀（人物·世界·实体·关系·伏笔·时间线）/ 大纲（总纲·分卷大纲·章节细纲·大纲修订记录）/ 章节摘要 / 重点记忆**。

工程上的兜底（这才是关键）：

| 机制 | 说明 |
|---|---|
| **防抖** | 连续保存只整理最后一次，不浪费模型调用 |
| **退出补跑** | 防抖期内退出应用，下次启动自动补跑，**整理不会丢** |
| **失败重试** | AI 输出解析失败 → 自动重试一次完整整理 |
| **优雅降级** | 重试仍失败 → 至少补齐大纲标记与时间线，保证不缺章 |
| **台账兜底** | AI 漏输出台账时，自动把本章摘要追加进时间线，台账永远不缺章 |
| **缺口补齐** | 一键遍历全部已写章节，把缺失的时间线 / 细纲 / 大纲标记补齐 |

> 也就是：你只管写正文，资料是**自动长出来的**，而且每一条失败路径都有兜底。

### 💰 省 token 的设计（不是"接上模型就完事"）

**分档截断** —— 按用途分配预算，而不是把资料全量塞进上下文：

| 内容 | 注入上限 |
|---|---|
| 世界状态台账 | 9000 字（唯一要求完整注入、不许截断时间线的一段） |
| 写作规则 | 5000 字 |
| 声明式附件 | 每份 4000 字 |
| 总纲 | 3500 字（只取核心前段） |
| 前文剧情概要 / 下一章细纲 | 各 3000 字 |
| 最近章节正文 | 只取**章节尾部 2500 字**（足够接上文风与剧情） |
| 分卷大纲 | 每卷 2000 字 |
| 大纲修订记录 | 每份 800 字 |
| 章节摘要 | 每章 400 字 |
| 其余章节细纲 | 每份 150 字摘要 |
| 设定 / 记忆后台预读 | **每文件前 120–200 字**，最多 30 个文件 |

**可调开关**：注入最近几章（0 = 不注入）、是否注入总纲 / 剧情概要、上下文总字符上限。

**防浪费：**

- 多轮对话历史每条截断 500 字；单会话消息数上限约 150 轮
- 工具调用"口胡"最多纠正 3 次，防死循环烧 token
- **章节整理一次调用输出一份 JSON**，同时更新 摘要 / 概要 / 台账 / 设定 / 记忆 / 大纲 —— 而不是分多次调用
- 保存防抖：连续保存只整理最后一次
- 工具**按需注入**：用户提到"设定 / 时间线 / 伏笔"等词，才挂上对应工具

**成本看得见**：内置数十个模型的价格表（DeepSeek / GPT / Claude / Gemini / 国产），**区分缓存读入价**（通常只有输入价的 1/4），token 与费用按项目累计。写作分身还能单独指定一个更便宜的模型。

### 其余优点

- **本地优先、纯文本**：书稿就是磁盘上的 `正文/第001章.txt` + Markdown 资料，不进数据库、
  不上传服务器，可随时用任何编辑器打开，也可以直接 Git 管理
- **不锁定数据**：目录布局稳定，并兼容旧版目录（自动识别迁移），换工具不丢稿
- **自带写作规则**：字数上下限、禁用词、疲劳词、AI 套句检测，落盘前自检并留报告
- **成本可见**：token 与费用按项目累计
- **自备 Key**：不内置任何 API Key，接你自己的 OpenAI 兼容接口

---

## 功能

| 模块 | 说明 |
|---|---|
| 作品管理 | 多书、回收站、当前项目指针；新书存于 `Documents/落笔/projects/`，可自动读取旧版目录中的书（`Documents/星炉/`） |
| 章节编辑 | 正文/第001章.txt（编号规则与旧版目录一致）、历史版本快照与回滚、字数统计 |
| 总编聊天 | 流式 AI 对话（DeepSeek 等 OpenAI 兼容 API）、写作分身双模型、自动注入项目背景（总纲/概要/最近章节） |
| 创作资料 | 大纲（总纲/分卷大纲/章纲）、设定沉淀（人物/世界/实体/关系/伏笔/时间线）、重点记忆（7 分类 + INDEX）、资料导入 |
| 规则系统 | ainovel 融合：全局 `~/.ainovel/rules/*.md` + 书级 `项目/.ainovel/rules/*.md`，自动提取字数/禁用词/疲劳词约束 |
| 提交自检 | 禁用词、疲劳词、AI 套句、字数检查，报告存入 `项目/.ainovel/reviews/` |
| 用量统计 | token/成本累计（`项目/.ainovel/usage.json`，与 ainovel 格式兼容） |
| 智能体 | 写作/条件智能体（读文件、输出文件、独立模型），配置存 `.novelforge/agents.json` |
| 设置中心 | 模型供应商（OpenAI 兼容）、主题（亮/暗）、界面缩放（100/110/130%）、写作偏好 |

## 开发运行

```bash
npm install          # 首次（若 npm 阻止 postinstall，需 node node_modules/electron/install.js 手动下载二进制）
npm run dev          # 开发模式
npm run build        # 构建
npm run typecheck    # 类型检查
```

> ⚠️ 本机用户环境变量设置了 `ELECTRON_RUN_AS_NODE=1`（会导致 Electron 以纯 Node 模式运行、内置模块不可用）。
> 项目已在 `electron.vite.config.ts` 中自动清除；若在 IDE/终端手动运行 Electron，请先执行
> `Remove-Item Env:ELECTRON_RUN_AS_NODE`。

## 数据位置

- 新书（项目）：`Documents/落笔/projects/<id>/`
- 旧版目录中的书：`Documents/星炉/projects/<id>/`（落笔自动兼容读取，可继续创作）
- 全局规则：`~/.ainovel/rules/`
- 应用设置：`~/.luobi/`

> **首次使用**：打开「设置中心 → 模型供应商」，填入你自己的 OpenAI 兼容 API Key。
> 本项目**不内置任何 API Key**，也不会读取他人的配置。

## 目录结构

```
shared/        三进程共享类型、IPC 通道、数据布局常量（兼容性单一事实源）
src/main/      主进程（工作区/项目/章节/资料/聊天/AI 引擎/规则/用量/智能体）
src/main/music/ 音乐源（网易云/QQ 等，移植自 Listen1（MIT），零 electron 依赖可独立联调）
src/preload/   window.luobi.* 桥接（渲染层桥接）
src/renderer/  React UI（7 面板布局、聊天、章节编辑器、设置中心）
e2e/           兼容性冒烟（npm run smoke）
```

## 测试

```bash
npm run typecheck    # 类型检查（node + web）
npm run smoke        # 数据层冒烟：数据布局/章节文件规则/项目 meta 结构断言（纯 Node，无需启动应用）
```

> `e2e/diagnostics/` 是开发期的一次性脚本。**会修改书目数据或含个人信息的脚本不随仓库发布**
> （已在 `.gitignore` 中排除），只公开其中经确认「只读且无个人信息」的探测脚本。
