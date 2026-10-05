# 自备音乐源（本项目不内置）

落笔的音乐播放是一个**可插拔的壳**：调度层、IPC、UI、播放器代理全部具备，
但**不包含任何第三方音乐服务的接口实现**。想让音乐响起来，你要自己接一个。

## 为什么这样设计

音乐播放依赖的第三方服务接口并非官方开放 API。因此本项目只发布**契约与调度层**，
不发布任何具体平台的实现 —— 是否接入、接入谁，由使用者自己决定并自负其责。

## 契约

见 `../provider-contract.ts`。需要实现 `ProviderInstance` 的四个方法：

| 方法 | 作用 |
|---|---|
| `search(url)` | 关键字搜索，回调返回 `SearchResult`（`TrackItem[]` / `PlaylistItem[]`） |
| `show_playlist(url)` | 榜单/推荐列表（可选） |
| `get_playlist(url)` | 歌单详情（可选） |
| `bootstrap_track(track, ok, fail)` | 取播放地址，回调返回 `SoundItem` |
| `lyric(url)` | 取歌词，回调返回 `LyricResult` |

回调式契约（`{ success(fn) }`）与 Listen 1 一致，调度层已把它转成 Promise。
数据结构和 id 前缀约定见 `../types.ts` 与 `../service.ts`。

## 步骤

1. **写实现**：在本目录新建 `my-source.ts`，导出一个符合 `ProviderInstance` 的对象。
   - 网络请求可用 `../util.ts` 里的 `httpGet` / `httpPost` / `cookieSet` / `cookieGet`
     （零 electron 依赖，可先用纯 Node 脚本联调）
   - 曲目 id 用 `xxxxtrack_` 前缀，调度层据此把曲目路由回你的 provider
     （前缀规则在 `../service.ts` 的 `getProviderByItemId`，需要时在那里加一条）

2. **登记**：在 `index.ts` 里 import 并放进 `PROVIDERS`：

   ```ts
   import mySource from './my-source.ts'
   export const PROVIDERS: ProviderConfig[] = [
     { name: 'my', instance: mySource as unknown as ProviderInstance, searchable: true }
   ]
   ```

3. **（可选）补 Referer 规则**：如果该源 CDN 有防盗链，在 `index.ts` 的
   `REFERER_RULES` 里加一条 `[匹配音频 URL 的正则, 'https://站点根']`，
   `../stream.ts` 会用它代理音频流（支持 Range，进度条可 seek）。

4. **让 UI 认识它**：`src/renderer/src/panes/MusicPane.tsx` 的源下拉框已改为从
   `music.sources` IPC 读取 —— 登记后自动出现，无需改 UI。

5. **验证**：`npm run typecheck` → `npm run build` → 启动应用，在音乐面板搜索。

## 自测建议

本目录下的诊断脚本可以改成你的源来做协议探测：

```
node e2e/diagnostics/music-probe.mjs
```

（该脚本只读、可安全运行；它会把各源的搜索结果打印出来。）

## 上游参考

调度层与契约移植自 **Listen 1**（MIT），版权声明见 `../LICENSE-LISTEN1.md`。
想找现成实现，可以去看该上游项目。
