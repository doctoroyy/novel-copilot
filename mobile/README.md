# Novel Copilot Mobile (Expo)

基于 Expo + React Native 的 iOS/Android 客户端，复用现有 `Cloudflare Worker API`。

## 交互设计

移动端采用原生交互结构，不复用 PC 版布局：

- 底部三栏：`项目` / `任务` / `设置`
- 项目页：卡片化概览 + 底部悬浮创建按钮
- 项目详情：操作面板 + 章节列表 + 底部弹层阅读
- 设置页：服务地址、AI 参数、账号管理

## 快速开始（pnpm）

```bash
cd mobile
pnpm install
pnpm start
```

也可从仓库根目录运行：

```bash
pnpm dev:mobile
```

## 已接入能力

- 用户登录/注册（复用 `/api/auth/*`）
- 项目列表、创建、详情、重置
- 流式大纲生成（SSE 解析）
- 流式章节生成（SSE 解析）
- 活跃任务轮询中心（`/api/active-tasks`）
- 章节内容阅读
- `expo-secure-store` 安全存储 token 与 AI key

## 关键目录

- `src/navigation/`：导航结构（Root/Tab/Projects Stack）
- `src/contexts/`：`Auth` 与 `AppConfig` 状态
- `src/lib/api.ts`：移动端 API 客户端与 SSE 解析
- `src/screens/`：业务页面

## 运行检查

```bash
pnpm exec tsc --noEmit
pnpm dlx expo-doctor
```
