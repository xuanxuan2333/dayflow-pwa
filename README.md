# M5 · 手机版（PWA）

> 改完展示模块后怎么发布到手机、有哪些硬规则：[docs/手机端同步说明.md](../../../docs/手机端同步说明.md)

把桌面上那份日程表原样搬到 iPhone：**同一份 HTML/CSS/JS**，数据靠一个 JSON 随身包从 Mac 拷过来，装好后**断网也能用**。

- 线上地址：`https://xuanxuan2333.github.io/dayflow-pwa/`
- 数据：`pack.json`（约 2.1 MB，由桌面「手机包」按钮或 `npm run pack:publish` 发布，手机打开自动拉最新）
- 写入：日程存手机浏览器 `localStorage`（键 `dayflow.schedule.v2`），**不回写** Mac 的 `schedule_items`
- 状态：🟡 可用（只读数据 + 本地日程）

## 装到 iPhone

1. Safari 打开上面的地址
2. 点「分享」→「添加到主屏幕」
3. 回到主屏，点开就是全屏 App（无地址栏）

正常情况不用管：打开就会从线上拉 `pack.json`。只有仓库里还没有包（或断网且从没打开过）时，才会停在「选择数据文件」，那时用 AirDrop 传一个过来即可。

## 日常同步：点一下桌面按钮

1. Mac 桌面版顶栏点「**手机包**」（`dayflow://service/pack`）
2. 后台依次做：生成随身包 → 构建 → 提交 → force push 到 GitHub
3. 等 30–60 秒（Pages 重建），手机上打开 App 就会**自动拉到新数据**；也可以点顶栏「同步数据」立刻拉

命令行等价：`npm run pack:publish`。

随身包会顺手瘦身：默认只带「最近 1 天 + 未来 30 天」的活动，去掉空字段和手机端没用的字段（`slot` / `signupCount`）。想调：

```bash
node bin/mobile-pack.mjs --past-days 3      # 多留几天历史
node bin/mobile-pack.mjs --future-days 90   # 只带未来 90 天内（默认 30）
node bin/mobile-pack.mjs --full             # 不裁剪、不精简
```

随身包里是**展示快照**，不是数据库本体：包含活动、自习地点、课程体验课、推荐榜，**不含** `group_messages`、`crawl_runs`、`schedule_items` 等内部表。活动正文原样保留（含主办方的手机号/微信号，手机上要用来联系）。

> ⚠️ 仓库是公开的，所以 `pack.json` 里的活动数据（含正文里的联系方式）任何人都能下载。介意的话用 `node bin/publish-pack.mjs --scrub` 发布打码版。日程永远只在手机本地。

**没有 Mac 在旁时**：包已经推到线上，手机随时能拉；要离线也照样用。想把包手动带到手机，`npm run pack` 生成 `data/dayflow-pack.json` 后 AirDrop，再用「同步数据」选文件。

## 更新代码

```bash
npm run pwa:build      # 重新生成 dist/dayflow-pwa
npm run pwa:deploy     # 构建 + 提交 + push（GitHub Pages 自动重建）
```

`sw.js` 的缓存版本号由构建时间写入，重新部署后手机上再打开一次就会更新。

## 文件

| 文件 | 作用 |
| --- | --- |
| `boot.js` | 引导层 + 增强层：读 IndexedDB / 拉同源 `pack.json` / 导入界面 / 注入 `window.DAYFLOW_*` / 加载 `schedule.js` / 顶栏「同步数据」与 SW 注册 |
| `pwa.css` | 导入界面 + iPhone 安全区 + 顶部栏在 390pt 下的收敛 |
| `sw.js` | 离线缓存（只缓存外壳，`pack.json` 永远走网络） |
| `manifest.webmanifest` | 主屏图标 / 全屏 / 启动色 |
| `icons/` | 180 / 192 / 512 图标 |
| `vendor/leaflet.*` | 1.9.4 本地化，离线也能画地图底图框架（瓦片仍需联网） |

`index.html`、`schedule.css`、`schedule.js` **不在这里**，由 `bin/build-pwa.mjs` 从 `modules/web/design/` 复制并改写（换掉 CDN、换掉 `prototype-data.js`、加 PWA meta）。

## 已知限制

- **只能看，不能采**：手机上没有 Mac 的微信/美团采集链路，「开始爬取」已隐藏；顶部「课程体验课」入口也隐藏（那是个本地服务）。「好玩榜」可以看，数据来自随身包里的 `guides`。
- **日程只在本机**：不回写 `schedule_items`；要回到 Mac 上，暂时只能手动抄/等下一步的导入工具
- **地图**：Leaflet 本地化，但高德瓦片要联网；断网时地图退回 SVG 示意（原有逻辑）。「好玩榜」里的类别地图也走同一套本地 Leaflet，手机端点标记可看名称并打开详情。
- **数据新鲜度**：顶部会显示「数据 11/19 00:21」，超过两天没用新包就变黄提醒

## 桌面原型不受影响

`open modules/web/design/schedule.html` 仍然读 `prototype-data.js`，`window.DAYFLOW_PWA` 为空，所有 PWA 分支都不会触发。
