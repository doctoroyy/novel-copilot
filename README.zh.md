# Novel Copilot

一个基于 Cloudflare Workers 的 AI 长篇小说创作平台，提供 Web 端与 React Native App 端。

[English](./README.md)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/doctoroyy/novel-copilot)

## 产品截图

### Web 主页

<p>
  <img src="./docs/images/web-home-dashboard.png" alt="NovelCopilot Web 首页" width="560" />
</p>

### App 截图

<p>
  <img src="./docs/images/app-home-project-list.png" alt="NovelCopilot App 项目列表页" width="220" />
  <img src="./docs/images/app-project-home.png" alt="NovelCopilot App 项目主页" width="220" />
  <img src="./docs/images/app-chapter-content.png" alt="NovelCopilot App 正文页" width="220" />
</p>

## 核心能力

### 创作流程

- 多模型提供商支持（Gemini、OpenAI、DeepSeek、自定义 provider）
- Story Bible 生成与编辑
- 大纲生成与修复（SSE 流式）
- 单章生成（SSE 流式）
- 批量章节生成（后台任务持久化）
- 章节阅读、复制与导出 ZIP
- 人物关系与上下文增强写作

### 上下文工程 + 质检

| 层级/阶段 | 模块 | 作用 |
|---|---|---|
| 基础层 | Story Bible | 世界观、规则、约束 |
| 基础层 | Rolling Summary | 滚动压缩剧情摘要 |
| 基础层 | Recent Chapters | 近章风格与上下文锚点 |
| Phase 1 | Character State | 人物状态快照 |
| Phase 2 | Plot Graph | 伏笔与剧情依赖图 |
| Phase 3 | Narrative Control | 节奏和叙事弧线控制 |
| Phase 4 | Multi-dimensional QC | 一致性/节奏/目标质检 |
| Phase 5 | Semantic Cache | 语义上下文复用优化 |
| Phase 6 | Timeline Tracking | 时间线去重和校验 |

### 任务系统（重点）

- 任务持久化表：`generation_tasks`
- 全局任务接口：`/api/active-tasks`
- 项目任务接口：`/api/projects/:projectRef/active-task`
- 推荐取消接口：`/api/tasks/:id/cancel`
- Web 端：基于 SSE 的同步
- App 端：低频轮询同步

## 架构与目录

```text
novel-copilot/
├── src/                                  # Cloudflare Worker 后端
│   ├── worker.ts                         # 入口与路由挂载
│   ├── middleware/
│   │   └── authMiddleware.ts             # JWT 鉴权与可选鉴权
│   ├── routes/
│   │   ├── auth.ts                       # 登录/注册/google 登录
│   │   ├── projects.ts                   # 项目/章节 CRUD 与下载
│   │   ├── generation.ts                 # 大纲/章节生成（SSE + 任务）
│   │   ├── tasks.ts                      # 活跃任务/取消/暂停/删除
│   │   ├── editing.ts                    # 章节编辑相关 API
│   │   ├── characters.ts                 # 人物关系图谱 API
│   │   ├── context.ts                    # 上下文工程 API
│   │   ├── anime.ts                      # 漫剧管线 API
│   │   ├── admin.ts                      # 管理端模型能力开关
│   │   ├── credit.ts                     # 积分相关 API
│   │   └── config.ts                     # 运行时配置
│   ├── services/
│   │   ├── aiClient.ts                   # 模型提供商抽象
│   │   ├── configManager.ts              # 动态模型配置
│   │   ├── creditService.ts              # 积分扣减逻辑
│   │   ├── imageGen.ts                   # 图像生成
│   │   ├── veoClient.ts                  # 视频生成
│   │   └── voiceService.ts               # TTS
│   ├── context/
│   │   ├── characterStateManager.ts
│   │   ├── plotManager.ts
│   │   ├── semanticCache.ts
│   │   └── timelineManager.ts
│   ├── narrative/
│   │   └── pacingController.ts
│   ├── qc/
│   │   ├── multiDimensionalQC.ts
│   │   ├── characterConsistencyCheck.ts
│   │   ├── pacingCheck.ts
│   │   ├── goalCheck.ts
│   │   └── repairLoop.ts
│   ├── db/
│   │   ├── schema.sql
│   │   └── anime-schema.sql
│   └── worker.ts
├── web/                                  # React Web 前端
│   ├── src/components/
│   │   ├── layout/                       # header/sidebar/activity panel
│   │   ├── views/                        # dashboard/outline/generate/chapters/...
│   │   └── ui/                           # 通用 UI 组件
│   ├── src/contexts/                     # auth/project/generation/server-events
│   ├── src/pages/                        # 路由页面
│   └── src/layouts/                      # 项目布局
├── mobile/                               # Expo React Native 前端
│   ├── src/navigation/                   # root stack + tabs + project stack
│   ├── src/screens/                      # auth/projects/activity/anime/settings/admin
│   ├── src/contexts/                     # auth + app config
│   ├── src/hooks/                        # active task polling
│   ├── src/lib/                          # API 客户端 + 存储 + 常量
│   └── src/types/                        # 领域类型/导航类型
├── migrations/                           # D1 migrations
├── scripts/
│   ├── ios-package.sh                    # 本地 iOS 打包脚本
│   └── android-enable-abi-splits.sh      # Android ABI 拆分补丁脚本
├── docs/
│   ├── mobile-ci.md                      # CI 打包文档
│   └── images/                           # README 截图
├── .github/workflows/
│   └── build-mobile-packages.yml         # 移动端构建 + Release 发布
├── package.json
├── wrangler.toml
└── README.md
```

## 路由与 ID 约定

- Web 路由默认使用 `projectId`：
  - `/project/:projectId/dashboard`
  - `/project/:projectId/outline`
  - `/project/:projectId/generate`
  - `/project/:projectId/chapters`
- App 导航参数统一使用 `projectId`
- 后端 `projectRef` 兼容 `id` 和 `name`（历史兼容），新代码必须优先传 `id`

## 本地开发

### 环境要求

- Node.js 22+
- pnpm 9+
- Cloudflare 账号（部署时）

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

# 本地 iOS 打包
pnpm mobile:ios:package
pnpm mobile:ios:package:install
```

## 移动端 CI 打包与 Release 资产

工作流：`.github/workflows/build-mobile-packages.yml`

构建产物（Artifact 名）：

- `NovelCopilot-android-universal-apk`
- `NovelCopilot-android-arm64-apk`
- `NovelCopilot-ios-ipa`

发布到 GitHub Release 的文件名：

- `NovelCopilot-android-universal.apk`
- `NovelCopilot-android-arm64-v8a.apk`
- `NovelCopilot-ios.ipa`

工作流会自动发布到一个滚动预发布版本：

- Tag：`mobile-builds`
- Release 名称：`NovelCopilot Mobile Builds`

### iOS Secrets

必需：

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

# 可选：创建 R2（漫剧视频）
npx wrangler r2 bucket create novel-copilot-videos

# 初始化 schema
pnpm db:init

# 部署
pnpm deploy
```

## 核心数据表

| 表名 | 说明 |
|---|---|
| `projects` | 项目元数据与 bible |
| `states` | 下章索引、滚动摘要、开放回路 |
| `chapters` | 章节正文 |
| `outlines` | 大纲 JSON |
| `characters` | 人物关系数据 |
| `generation_tasks` | 后台生成任务 |
| `chapter_qc` | 质检结果 |
| `users` | 用户与权限 |

## License

MIT
