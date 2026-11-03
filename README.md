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

房间角色由参与者自行选择，适合可信参与者之间的训练和演示。当前角色字段用于流程权限检查；房间没有账号认证、角色口令或独占席位。公网正式赛事部署需要补充身份认证和角色授权。JSON 持久化适合单进程小规模部署，服务端数据目录应定期备份。

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
