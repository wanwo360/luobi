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
