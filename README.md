# Novel Copilot

AI 长篇小说创作平台，包含 Web 端与 React Native App 端，后端基于 Cloudflare Workers + D1。

- Web：项目管理、大纲、章节、生成、人物关系、AI 漫剧、任务中心
- App：项目主页、大纲/章节/摘要/创作台、任务页、设置页、正文阅读
- 后端：用户鉴权、章节生成、任务持久化、SSE 事件流、积分与管理接口

## 主要能力

### 创作能力

- Story Bible 生成与编辑
- 分卷/分章大纲生成与修复（SSE）
- 单章生成（SSE）
- 批量章节生成（后台任务）
- 章节正文查看、复制、导出
- 多维度 QC 与自动修复链路（后端）

### 任务系统

- 后台任务持久化到 `generation_tasks`
- 全局任务列表：`/api/active-tasks`
- 项目活跃任务：`/api/projects/:projectRef/active-task`
- 任务取消：`/api/tasks/:id/cancel`（推荐）
- Web 端支持 SSE 同步，移动端支持轮询同步

### 路由与标识

- Web 路由统一使用 `projectId`：`/project/:projectId/...`
- App 导航参数使用 `projectId`
- 后端 `projectRef` 同时兼容 `id` 和 `name`（为兼容历史数据），新代码优先传 `id`

## 技术栈

- 后端：Hono、Cloudflare Workers、D1、R2、TypeScript
- Web：React 19、Vite、TailwindCSS 4、Radix UI
- App：Expo 54、React Native 0.81、React Navigation

## 目录结构

```text
novel-copilot/
├── src/                      # Workers 后端
│   ├── worker.ts             # 入口
│   ├── routes/               # 业务路由（projects/generation/tasks/auth/...）
│   ├── middleware/           # 鉴权中间件
│   ├── services/             # AI/积分/日志等服务
│   ├── context/              # 上下文工程模块
│   ├── narrative/            # 叙事控制
│   ├── qc/                   # 质检与修复
│   └── db/                   # SQL schema
├── web/                      # Web 前端
├── mobile/                   # Expo App 前端
├── migrations/               # D1 migrations
├── scripts/                  # 打包与构建脚本
└── .github/workflows/        # CI/CD（含移动端打包）
```

## 本地开发

### 1) 依赖准备

- Node.js 22+
- pnpm 9+
- Wrangler（可通过项目 devDependencies 调用）

```bash
pnpm install
pnpm -C web install
pnpm -C mobile install
```

### 2) 初始化本地数据库

```bash
pnpm db:migrate:local
```

### 3) 启动后端

```bash
pnpm dev
```

默认在 `http://localhost:8787`。

### 4) 启动 Web

```bash
pnpm -C web dev
```

默认在 `http://localhost:5173`。

### 5) 启动 App（Expo）

```bash
pnpm dev:mobile
```

或：

```bash
pnpm -C mobile start
```

## 常用脚本

```bash
# 类型检查
pnpm typecheck
pnpm mobile:typecheck

# Web 构建
pnpm build:web

# 本地/远端 D1 迁移
pnpm db:migrate:local
pnpm db:migrate:remote

# 部署
pnpm deploy

# iOS 本地打包
pnpm mobile:ios:package
pnpm mobile:ios:package:install
```

## 移动端打包（GitHub Actions）

已提供工作流：

- `.github/workflows/build-mobile-packages.yml`

产物：

- iOS IPA：`ios-ipa`
- Android universal APK：`android-universal-apk`
- Android arm64 APK：`android-arm64-apk`

iOS 需要配置以下仓库 Secrets：

- `IOS_CERT_BASE64`
- `IOS_CERT_PASSWORD`
- `IOS_PROVISION_PROFILE_BASE64`
- `IOS_TEAM_ID`
- `IOS_KEYCHAIN_PASSWORD`

可选：

- `IOS_BUNDLE_ID`
- `IOS_EXPORT_METHOD`
- `IOS_CODE_SIGN_IDENTITY`

补充说明见：`docs/mobile-ci.md`

## 部署（Cloudflare）

### 初始化

```bash
# 创建 D1
npx wrangler d1 create novel-copilot-db

# 创建 R2（可选，用于 AI 漫剧视频）
npx wrangler r2 bucket create novel-copilot-videos

# 初始化 schema（首次）
pnpm db:init
```

将新建 D1 的 `database_id` 写入 `wrangler.toml` 后再部署：

```bash
pnpm deploy
```

## 注意事项

- `mobile/ios` 与 `mobile/android` 是 prebuild 产物，默认不纳入版本管理。
- 生产环境建议统一使用 `projectId` 作为前后端传参，避免同名项目带来的歧义。
- 章节后台任务与前端页面状态通过任务接口/SSE 同步，不应再依赖单个长连接请求维持状态。

## License

MIT
