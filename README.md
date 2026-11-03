# LOL BP Simulator

一个面向英雄联盟赛事训练和娱乐开黑的实时 BP 房间工具。项目支持裁判、蓝红双方和观众多角色协作，内置标准 BP 流程、BO 系列赛、全局 Fearless 模式、本地英雄头像和中英文/拼音搜索。

## 功能亮点

- 实时房间：通过 WebSocket 同步完整 BP 状态，断线后自动重连并恢复最新状态。
- 多角色协作：支持裁判、Team A、Team B、观众角色，房间链接可一键复制。
- 赛事流程：支持 BO1/BO2/BO3/BO5、选边、Ready、暂停/恢复、自动超时随机、Swap 阶段和赛果记录。
- BP 规则校验：服务端权威校验当前轮次、重复英雄、非法英雄、Fearless 禁用池、Swap 下标和权限。
- 英雄搜索：支持英文名、中文名、称号、拼音、首字母和轻量容错搜索。
- 响应式界面：桌面端保留左右战队面板，窄屏会改为可滚动的堆叠布局。

## 技术栈

- Monorepo：npm workspaces
- 前端：React 18、Vite、TypeScript、Tailwind CSS、lucide-react
- 服务端：Node.js、TypeScript、ts-node、ws
- 数据：JSON 文件持久化房间状态和操作历史

## 快速开始

运行环境：Node.js 22.12+，npm 10+。首次安装使用 `npm ci`，按锁文件安装依赖。

```bash
npm ci
npm run dev
```

默认端口：

- 前端：http://localhost:5173
- 服务端：http://localhost:8080
- 健康检查：http://localhost:8080/health

打开前端后创建房间，选择角色即可开始 BP。

## 常用脚本

```bash
npm run dev
npm run build
npm run lint
npm test
npm run audit
```

## 环境变量

前端默认连接本机 `8080` 服务端。部署到线上时可以在 `apps/web/.env` 中配置：

```env
VITE_API_BASE_URL=https://your-api.example.com
VITE_WS_URL=wss://your-api.example.com
```

服务端支持：

```env
PORT=8080
```

在启动服务前通过 shell 或部署平台设置 `PORT`；服务端当前不自动读取 `.env`。前端环境变量由 Vite 在构建时读取，修改后需要重新构建。

## 部署与使用范围

`npm run build` 输出前端静态文件到 `apps/web/dist`，同时检查服务端类型。静态文件可由 Nginx 托管，服务端通过 `npm run dev --workspace=apps/server` 启动，反向代理需启用 WebSocket Upgrade。HTTPS 页面应配置 HTTPS API 和 WSS 地址。

房间角色由参与者自行选择，支持同一角色单连接占用与进入记录，适合可信参与者之间的训练和演示。公网正式赛事部署需要补充账号认证和角色授权。JSON 持久化适合单进程小规模部署，服务端数据目录应定期备份。

英雄数据是仓库内的 172 位英雄快照，分路标签来自脚本推断。更新数据后请检查头像覆盖和分路标签。

## 数据与资源

- 英雄数据：`apps/web/src/data/heroes.ts`
- 服务端英雄池：`apps/server/src/heroPool.ts`
- 英雄头像：`apps/web/public/heroes/*.png`
- 房间数据：`apps/server/data/rooms`
- 操作历史：`apps/server/data/actions`

更新英雄列表：

```bash
node scripts/generate-herolist.js
```

下载或刷新英雄头像：

```bash
node scripts/download-images.js
```

`generate-herolist.js` 会同时更新前端英雄数据和服务端随机/校验英雄池，避免两端英雄集合不一致。

## 项目结构

```text
apps/
  web/                React 前端
  server/             WebSocket + HTTP 服务端
scripts/              英雄数据和头像同步脚本
```

## 本次维护重点

- 修复前端缺失 `pinyin-pro` 依赖导致无法构建的问题。
- 升级 Vite、ESLint、TypeScript 等前端工具链，补齐缺失依赖。
- 改造前端连接配置，移除写死的线上 API/WS 地址。
- 修复 WebSocket 每次状态同步都会重连的问题，并增加自动重连。
- 服务端改为全英雄池随机，修复原先只会从少量硬编码英雄中随机的问题。
- 增强服务端权威校验，阻止重复、非法、越权和错误阶段操作。
- 修复 undo 重放会丢失比赛名、队名和赛制配置的问题。
- 补充 ESLint flat config、Vite 类型声明、服务端回归测试和 `.gitignore`。
- 优化移动端/窄屏布局，新增搜索结果计数、空结果清空筛选、复制房间链接和切换角色入口。

## 验证

本轮验证通过前端生产构建、服务端类型检查、lint 和逻辑回归测试。1440×900 桌面与 390×844 手机视口通过创建房间、选边、Ready、开始和暂停流程，头像加载正常、无页面横向溢出。

依赖审计：生产依赖 0 告警；完整开发依赖有 11 项中等告警，涉及 ESLint/minimatch 传递依赖。运行 `npm run audit` 可按当前漏洞库重新检查。

`npm test` 覆盖重复英雄、非法动作、完整 20 步 BP、随机池唯一性、系列赛晋级、Fearless 跨局禁用和重放配置。浏览器回归脚本 `scripts/verify-ui.cjs` 使用 Playwright，服务启动后运行 `node scripts/verify-ui.cjs`；需预先安装 Playwright 及 Chromium，也可用 `PLAYWRIGHT_MODULE` 指定现有模块路径。截图输出到忽略目录 `verification-output`。

## 网站使用说明

本文档面向第一次使用该 BP 网站的裁判、队伍成员与旁观者，帮助你快速完成：创建房间、进入房间、设置对局规则、开始 BP、跨局管理（BO / Fearless）以及常见问题排查。

## 1. 这个网站能做什么

这是一个面向《英雄联盟》BP 场景的网页工具，核心能力包括：

- 创建与加入房间（房间号 6 位）。
- 多身份进入（`TEAM_A` / `TEAM_B` / `REFEREE` / `SPECTATOR`）。
- 支持 `BO1/BO2/BO3/BO5`。
- 支持两种模式：`STANDARD` 与 `FEARLESS`。
- 支持每手计时：30s / 60s / 90s / 不限时。
- 支持“地图蓝红方”和“BP 先手”分离设置。
- 裁判可执行：开始、暂停、恢复、撤销一步、重置。
- 内置聊天（仅裁判与队伍可发言，旁观者不可发）。
- 断线重连与房间状态持久化（服务端落盘）。

## 2. 快速开始（用户视角）

### 2.1 进入首页

打开网站后有两个入口：

- `Create Room`：创建新房间。
- `Join Room`：输入房间号加入已有房间。

### 2.2 创建房间（建议由裁判操作）

在 `Create Room` 中填写或选择：

- 比赛名称 `Match Title`（可留空）。
- 队伍名 `Team A Name` / `Team B Name`。
- 赛制 `BO1 / BO2 / BO3 / BO5`。
- 模式 `STANDARD / FEARLESS`。
- 每手时间 `30 / 60 / 90 / ∞`。
- 是否开启“地图与 BP 顺序分离”。

点击 `创建房间(CREATE ROOM)` 后：

1. 系统会创建房间并生成链接（含 `?room=xxxxxx`）。
2. 前端会自动尝试复制链接到剪贴板。
3. 将该链接发给双方队伍与旁观者。

### 2.3 加入房间

两种方式：

- 直接打开邀请链接（推荐）。
- 或在 `Join Room` 手动输入房间号后点 `CONNECT`。

进入房间后会弹出身份选择：

- `TEAM_A`
- `TEAM_B`
- `REFEREE`
- `SPECTATOR`

> 注意：同一房间内，`TEAM_A / TEAM_B / REFEREE` 属于“独占会话身份”。若同身份在其他设备登录，旧连接会被强制下线。

## 3. 对局流程（标准操作顺序）

### 3.1 赛前配置

1. **选择蓝红方**：
   - 若未开启“地图与 BP 分离”，选择哪队为蓝色方即可。
   - 若已开启分离，需要额外指定“BP 首选队伍”，最后点“确认”。
2. **双方 Ready**：蓝红两侧都需 `READY`。
3. **裁判开始**：裁判点击开始按钮（`Play` 图标）进入 BP。

### 3.2 BP 阶段

- 按系统顺序进行 Ban/Pick（内置完整 20 手流程）。
- 当前可操作方可在英雄池中点击英雄并锁定。
- 支持搜索（中文、英文、拼音模糊）。
- 额外特殊项：
  - `NO BAN`（不禁用）
  - `RANDOM`（随机英雄）

### 3.3 Swap 阶段

BP 结束后进入交换阶段（`SWAP PHASE`）：

- 点击同侧两个英雄可交换位置。
- 队伍仅能操作自己阵营，裁判可操作双方。

### 3.4 局结束与下一局

- 裁判上报胜者后进入下一局（若未达到 BO 终局）。
- 在 `FEARLESS` 下，前局已被双方选过的英雄会在后续局全局禁用。
- 比分会显示在顶部（如 `Team A 1 - 0 Team B`）。

## 4. 功能说明（按角色）

### 4.1 裁判（REFEREE）

可使用完整控制功能：

- 开始对局
- 暂停 / 恢复
- 撤销上一步
- 重置当前局
- 上报胜者
- 与双方聊天

### 4.2 队伍（TEAM_A / TEAM_B）

- 在轮到自己阵营时进行 Ban/Pick。
- 可切换 `READY` 状态。
- 可在 Swap 阶段交换己方英雄。
- 可使用聊天。

### 4.3 旁观者（SPECTATOR）

- 仅观看，不可操作 BP。
- 不可发送聊天消息。

## 5. 房间与数据说明

服务端会将每个房间的数据写入本地 JSON 文件，包括：

- 当前房间状态
- 历史 action（用于重放/补齐）
- 聊天记录（保留最近 N 条）

因此服务端重启后，房间通常可以从磁盘恢复。

## 6. 本地运行（开发者）

> 当前前端代码默认连接固定线上地址（`https://zijing.yejiaxin.online` / `wss://zijing.yejiaxin.online`）。
> 若要全本地联调，需要把这些地址改为本地服务地址。

### 6.1 安装依赖

```bash
npm install
```

### 6.2 一键启动（前后端并行）

```bash
npm run dev
```

默认会并行启动：

- `apps/server`：WebSocket + HTTP
- `apps/web`：Vite 前端

### 6.3 常用单独命令

```bash
npm run dev --workspace=apps/server
npm run dev --workspace=apps/web
npm run build --workspace=apps/web
```

## 7. 常见问题

### Q1：为什么我操作不了？

常见原因：

- 你是 `SPECTATOR`。
- 还没轮到你这边。
- 当前处于暂停状态。
- 赛前未完成蓝红方配置与双方 Ready。

### Q2：为什么身份突然退出？

你的身份（裁判/队伍）被其他设备以相同角色登录了。系统会保留最新连接，并让旧连接退出。

### Q3：聊天发不出去？

- 旁观者不能发送。
- 单条消息长度上限为 300 字符。

### Q4：断线后怎么办？

页面会尝试维持连接与状态同步。若网络恢复后仍异常，刷新页面并重新进入房间即可。

---

如果你是赛事执行同学，建议固定流程为：

1. 裁判建房并发链接。
2. 双方选择角色后先确认蓝红与 BP 先手。
3. 双方 Ready，裁判再开始。
4. 每局结束立即上报结果，避免赛后统一补录。

这样最稳，也最不容易出错。
