# Durable Objects Queue System

本项目使用 Cloudflare Durable Objects 实现了真正的异步任务队列系统，解决了以下问题：

## 解决的问题

1. **不再依赖 HTTP 连接**：之前的 SSE 实现需要客户端保持 HTTP 连接，连接断开后任务会暂停。现在任务在后台独立运行，不受客户端连接影响。

2. **减少轮询请求**：移动端不再需要频繁轮询 `/api/active-tasks` 端点（之前是每 4 秒一次）。现在可以使用更长的轮询间隔（默认 10 秒），大幅减少 API 请求数，节省免费套餐额度。

3. **真正的后台任务**：使用 Durable Objects 的持久化存储和自动唤醒机制，任务可以真正在后台执行，即使没有客户端连接。

## 架构设计

### 组件说明

#### 1. TaskQueue Durable Object
- **文件**: `src/durableObjects/TaskQueue.ts`
- **作用**: 任务队列管理
- **功能**:
  - 接收新任务并入队
  - 维护任务状态（pending, processing, completed, failed）
  - 提供任务列表和查询功能
  - 自动触发下一个任务的处理

#### 2. TaskProcessor Durable Object
- **文件**: `src/durableObjects/TaskProcessor.ts`
- **作用**: 任务处理器
- **功能**:
  - 从队列中取出待处理任务
  - 在后台执行章节生成或大纲生成
  - 更新任务状态和进度
  - 处理失败重试

#### 3. Queue API Routes
- **文件**: `src/routes/queue.ts`
- **端点**:
  - `POST /api/projects/:name/queue-chapters` - 将章节生成任务加入队列
  - `POST /api/projects/:name/queue-outline` - 将大纲生成任务加入队列
  - `GET /api/queue/tasks` - 获取当前用户的所有队列任务
  - `GET /api/queue/tasks/:taskId` - 获取特定任务详情
  - `POST /api/queue/tasks/:taskId/cancel` - 取消任务
  - `DELETE /api/queue/tasks/:taskId` - 删除任务

## 使用方法

### 1. 前端调用（Web）

```typescript
import { queueChapterGeneration } from './lib/api';

// 将章节生成任务加入队列
const { taskId } = await queueChapterGeneration(
  apiBaseUrl,
  token,
  projectName,
  5, // 生成 5 章
  aiConfig
);

console.log('任务已加入队列:', taskId);
```

### 2. 移动端使用

```typescript
import { useQueuedTasks } from './hooks/useQueuedTasks';

function MyComponent() {
  const { tasks, loading, error, refresh } = useQueuedTasks({
    apiBaseUrl,
    token,
    enabled: true,
    pollIntervalMs: 10000, // 每 10 秒轮询一次（而不是之前的 4 秒）
  });

  return (
    <View>
      {tasks.map(task => (
        <TaskCard key={task.id} task={task} />
      ))}
    </View>
  );
}
```

### 3. 任务状态

任务有以下状态：
- `pending`: 等待处理
- `processing`: 正在处理
- `completed`: 已完成
- `failed`: 失败

任务对象包含：
```typescript
{
  id: string;
  type: 'chapter' | 'outline';
  projectId: string;
  projectName: string;
  userId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number; // 0-100
  message?: string; // 当前进度消息
  error?: string; // 错误信息（如果失败）
  createdAt: number;
  updatedAt: number;
}
```

## 配置

### wrangler.toml

```toml
[[durable_objects.bindings]]
name = "TASK_QUEUE"
class_name = "TaskQueue"
script_name = "novel-copilot"

[[durable_objects.bindings]]
name = "TASK_PROCESSOR"
class_name = "TaskProcessor"
script_name = "novel-copilot"

[[migrations]]
tag = "v1"
new_classes = ["TaskQueue", "TaskProcessor"]
```

## 部署

1. **首次部署**需要先迁移 Durable Objects：
```bash
wrangler deploy
```

2. Cloudflare 会自动创建 Durable Objects 实例
3. 无需额外配置，系统会自动使用单例模式（通过固定名称 "global-queue" 和 "global-processor"）

## 优势

### 相比之前的 SSE 实现

| 特性 | SSE 实现 | Durable Objects 实现 |
|-----|---------|---------------------|
| 后台运行 | ❌ 需要保持 HTTP 连接 | ✅ 真正后台运行 |
| 断线恢复 | ❌ 连接断开任务暂停 | ✅ 自动继续执行 |
| 轮询频率 | 4 秒/次 | 10+ 秒/次 |
| 并发控制 | ⚠️ 依赖客户端 | ✅ 服务端控制 |
| 任务持久化 | ⚠️ 数据库存储 | ✅ DO 自动持久化 |

### 免费套餐友好

- **减少 API 请求**：轮询间隔从 4 秒增加到 10 秒，减少 60% 的请求
- **后台执行**：任务不需要客户端保持连接，节省 SSE 连接资源
- **自动管理**：Durable Objects 自动休眠和唤醒，不浪费计算资源

## 迁移指南

### 从旧的 SSE 方式迁移

1. **保持兼容**：旧的 SSE 端点仍然保留，可以继续使用
2. **新功能使用队列**：新开发的功能建议使用队列 API
3. **逐步迁移**：可以逐个端点迁移到队列系统

### 示例：迁移章节生成

**之前（SSE）**:
```typescript
const response = await fetch('/api/projects/mybook/generate-stream', {
  method: 'POST',
  body: JSON.stringify({ chaptersToGenerate: 5 })
});

// 需要保持连接来接收事件
const reader = response.body.getReader();
// ... 处理 SSE 流
```

**现在（Queue）**:
```typescript
// 1. 提交任务
const { taskId } = await queueChapterGeneration(
  apiBaseUrl, token, 'mybook', 5, aiConfig
);

// 2. 定期查询任务状态（间隔更长）
const task = await fetchQueuedTask(apiBaseUrl, token, taskId);
console.log(`进度: ${task.progress}%`);
```

## 故障排查

### 任务卡在 processing 状态

- **原因**：可能是 Worker 超时或错误
- **解决**：任务会在数据库中标记为 `processing`，但 DO 会自动重试下一个任务
- **手动解决**：调用取消或删除 API

### 任务不执行

- **检查**：确保 Durable Objects 已正确部署
- **日志**：在 Cloudflare Dashboard 查看 Worker 日志
- **测试**：调用 `/api/queue/tasks` 确认任务已入队

### 轮询太频繁

- **调整间隔**：在 `useQueuedTasks` 中设置更长的 `pollIntervalMs`
- **条件轮询**：只在有活跃任务时轮询：
```typescript
const { tasks } = useQueuedTasks({
  enabled: hasActiveTasks,
  pollIntervalMs: 15000, // 15 秒
});
```

## 未来改进

1. **WebSocket 支持**：使用 Durable Objects 的 WebSocket 功能实现真正的推送
2. **任务优先级**：支持高优先级任务插队
3. **批量操作**：支持批量取消、删除任务
4. **任务依赖**：支持任务之间的依赖关系（例如：大纲完成后自动开始章节生成）

## 参考资料

- [Cloudflare Durable Objects 文档](https://developers.cloudflare.com/durable-objects/)
- [Workers 最佳实践](https://developers.cloudflare.com/workers/platform/best-practices/)
