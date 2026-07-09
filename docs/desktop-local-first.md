# Desktop Local-First 开发与打包

面向 `codex/local-first-desktop-cleanup` 分支。目标是让 Novel Copilot 以本地优先桌面应用运行：SQLite + 本地 Hono sidecar + BYOK，不依赖登录/积分。

## 前置

- Node.js 20+（建议 22）
- pnpm 10+
- macOS / Windows / Linux

`better-sqlite3` 是 native 模块，换 Node 主版本后需要重建：

```bash
pnpm rebuild better-sqlite3
# 或
cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npx node-gyp rebuild
```

## 安装

```bash
pnpm install
cd web && pnpm install
cd ../electron && pnpm install
```

## 开发

一键启动（后端 + Vite + Electron）：

```bash
pnpm dev:desktop
# 等价: cd electron && node scripts/dev.mjs
```

只跑本地后端 sidecar（无 Electron 窗口）：

```bash
pnpm sidecar
# 等价: cd electron && node --import tsx --import ./loader.mjs standalone.ts
```

默认：

- 后端: `http://localhost:8787`
- 前端: `http://localhost:5173`
- 数据目录: `~/.novel-copilot`（Electron 下为系统 `userData`）

## 验证

```bash
pnpm typecheck
pnpm test:agent
pnpm smoke:desktop
pnpm --dir web build
pnpm --dir electron build
```

`test:agent` 覆盖：adapter 格式化、agent loop、ContextBuilder 规则选择与预算、10 章连续生成 fixture（状态机 + 持久化 + 可复现性）。

`smoke:desktop` 会：

1. 用临时目录启动 sidecar
2. 检查 `/api/health`
3. 创建/读取/删除临时项目（验证 SQLite）
4. Story Vault 创建实体 + extract 提取接受
5. Chapter Blueprint 保存/读取（状态机）
6. Context Package 构建 + 持久化（Context Inspector）
7. AI Job Ledger summary
8. Project Health Board（5 维度）
9. Genre Templates（3 个题材模板）
10. License 激活 + 状态
11. 退出并清理

## Phase 2-4 能力

### Phase 2: Context Builder + 章节流水线

- **ContextBuilder** (`src/agent/contextBuilder.ts`)：每次 AI 调用前从 Story Vault 按触发词匹配选实体/线索，带来源和理由，token 预算硬控，hash 可复现，持久化到 `context_packages` 表。
- **AI Job Ledger** (`src/services/aiJobLedger.ts`)：每次 AI 调用记录 provider/model/phase/token/cost/duration/status，按项目和模型聚合。
- **Chapter Blueprint** (`src/services/chapterBlueprintService.ts`)：章节蓝图编辑（目标/冲突/钩子/场景节拍/验收标准/作者备注），状态机 draft→ready→generating→drafted→reviewing→committed。
- **Context Inspector**：前端 `ChapterBlueprintView` 内置上下文预览，展示选中条目及理由 + 成本面板。
- **10 章 fixture** (`src/agent/chapterFixture.test.ts`)：验证连续 10 章不丢章节索引、蓝图状态机、context package 持久化、ledger 记录、prompt hash 可复现。

### Phase 3: QC 产品化

- **Project Health Board** (`src/services/projectHealthService.ts`)：聚合 QC + Story Vault + 生成状态为作者可理解维度（设定一致性、伏笔库存、节奏与爽点、人物弧线、AI 成本），嵌入 Dashboard。

### Phase 4: 商业化最小版本

- **License** (`src/services/licenseService.ts`)：授权码激活、tier 检测（free/pro/studio）、14 天离线宽限期、机器绑定，不上传正文。
- **导出**：TXT / Markdown / ZIP 三种格式。
- **题材模板** (`src/services/genreTemplates.ts`)：玄幻升级、都市系统、古言宅斗 3 个模板，新项目对话框一键填充设定。

## 打包

```bash
# 1. 构建前端
pnpm build:web

# 2. 构建 Electron 主进程 bundle
pnpm --dir electron build

# 3. 把 web dist 复制到 electron/renderer（若 build 脚本未自动完成）
# electron/scripts/build.mjs 会处理主进程；renderer 由开发/发布脚本复制

# 4. 出安装包
pnpm --dir electron dist
```

产物在 `electron/release/`。

## Local-first 边界

已收口：

- 默认本地用户 `local-user`，无需登录
- 前端 `HashRouter`，适配 `file://` / 本地静态托管
- 章节 Agent 默认走 Direct API 精简 loop（Anthropic/OpenAI adapter）
- 桌面入口隐藏云端 Admin 路由

仍保留但非主路径：

- `/api/admin`、`/api/credit`、`/api/anime` 后端路由（兼容旧代码）
- 云端 Workers 部署脚本（`wrangler`）

## 常见问题

### better-sqlite3 NODE_MODULE_VERSION 不匹配

说明 native 模块是用另一个 Node 版本编译的。按上面 rebuild 即可。

### Cloudflare Playwright 导入报错

桌面路径通过 `electron/loader.mjs` 和 `electron/shims/cloudflare-playwright.ts` 拦截；不要在桌面主路径直接依赖真实 Browser Rendering。

### 没有 API Key 能不能跑

可以启动、建项目、写 SQLite。生成章节需要在设置里配置 BYOK（Anthropic/OpenAI/兼容接口）。
