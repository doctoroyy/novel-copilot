# Novel Copilot

AI 长篇小说创作平台，包含 Web 端与 React Native App 端，后端基于 Cloudflare Workers。

[English](./README.md)

## 核心能力

- Web + App 双端创作体验：项目管理、大纲、章节生成与阅读
- 后台生成任务持久化（`generation_tasks`），任务中心可同步感知
- 基于 SSE 的生成流与事件同步
- 上下文工程 + QC 质检链路，增强长篇一致性
- Cloudflare 技术栈：Workers + D1 + R2

## 产品截图

### Web 主页（仪表盘）

![Web 主页](./docs/images/web-home-dashboard.png)

### App 主页（项目列表）

![App 项目列表主页](./docs/images/app-home-project-list.png)

### App 项目主页

![App 项目主页](./docs/images/app-project-home.png)

### App 正文页

![App 正文页](./docs/images/app-chapter-content.png)

## 技术栈

- 后端：Hono、Cloudflare Workers、D1、R2、TypeScript
- Web：React 19、Vite、TailwindCSS 4、Radix UI
- App：Expo 54、React Native 0.81、React Navigation

## 目录结构

```text
novel-copilot/
├── src/                    # Worker 后端
├── web/                    # Web 前端
├── mobile/                 # Expo 移动端
├── migrations/             # D1 迁移
├── scripts/                # 构建/打包脚本
├── docs/                   # 文档与截图
└── .github/workflows/      # CI 工作流
```

## 本地开发

### 环境要求

- Node.js 22+
- pnpm 9+
- Cloudflare 账号（用于部署）

### 安装依赖

```bash
pnpm install
pnpm -C web install
pnpm -C mobile install
```

### 初始化本地数据库

```bash
pnpm db:migrate:local
```

### 启动后端

```bash
pnpm dev
```

后端地址：`http://localhost:8787`

### 启动 Web

```bash
pnpm -C web dev
```

Web 地址：`http://localhost:5173`

### 启动 App

```bash
pnpm dev:mobile
```

## 常用脚本

```bash
# 类型检查
pnpm typecheck
pnpm mobile:typecheck

# Web 构建
pnpm build:web

# 数据库迁移
pnpm db:migrate:local
pnpm db:migrate:remote

# 部署
pnpm deploy

# iOS 本地打包
pnpm mobile:ios:package
pnpm mobile:ios:package:install
```

## 移动端 CI 打包

工作流：

- `.github/workflows/build-mobile-packages.yml`

产物：

- `ios-ipa`
- `android-universal-apk`
- `android-arm64-apk`

iOS 需要配置仓库 Secrets：

- `IOS_CERT_BASE64`
- `IOS_CERT_PASSWORD`
- `IOS_PROVISION_PROFILE_BASE64`
- `IOS_TEAM_ID`
- `IOS_KEYCHAIN_PASSWORD`

可选：

- `IOS_BUNDLE_ID`
- `IOS_EXPORT_METHOD`
- `IOS_CODE_SIGN_IDENTITY`

详见：`./docs/mobile-ci.md`

## Cloudflare 部署

```bash
# 创建 D1
npx wrangler d1 create novel-copilot-db

# 可选：创建 R2（用于漫剧视频）
npx wrangler r2 bucket create novel-copilot-videos

# 初始化 schema
pnpm db:init

# 部署
pnpm deploy
```

## 说明

- Web 路由使用 `projectId`：`/project/:projectId/...`
- App 导航使用 `projectId`
- 后端 `projectRef` 同时兼容 `id`/`name`（历史兼容），新代码应优先传 `id`

## License

MIT
