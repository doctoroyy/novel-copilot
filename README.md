# Novel Copilot

AI 小说自动化生成工具，支持多种 AI 模型（Gemini、OpenAI、DeepSeek）。

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/doctoroyy/novel-copilot)

## ✨ 功能

- 🤖 **多模型支持**：Gemini、OpenAI、DeepSeek 及自定义 API
- 📚 **三层记忆**：Story Bible + 滚动摘要 + 近章原文
- 📋 **大纲生成**：自动规划卷章结构
- 🔄 **断点续写**：自动保存进度，支持中断恢复
- 🌐 **Web UI**：现代化界面，实时进度显示

## 🚀 一键部署到 Cloudflare

### 方式一：点击部署按钮

点击上方 "Deploy to Cloudflare Workers" 按钮，按提示操作即可。

### 方式二：手动部署

```bash
# 1. 克隆项目
git clone https://github.com/doctoroyy/novel-copilot.git
cd novel-copilot

# 2. 安装依赖
pnpm install
cd web && pnpm install && cd ..

# 3. 创建 D1 数据库
wrangler d1 create novel-copilot-db
# 复制输出的 database_id 到 wrangler.toml

# 4. 初始化数据库
pnpm db:init

# 5. 构建前端
pnpm build:web

# 6. 部署
wrangler deploy
```

## 🛠️ 本地开发

```bash
# 安装依赖
pnpm install
cd web && pnpm install && cd ..

# 初始化本地 D1
pnpm db:init:local

# 启动后端 (Workers, 端口 8787)
pnpm dev

# 启动前端 (Vite, 端口 5173)
cd web && pnpm dev
```

访问 http://localhost:5173

## 📁 项目结构

```
novel-copilot/
├── src/
│   ├── worker.ts           # Cloudflare Workers 入口
│   ├── routes/             # Hono API 路由
│   ├── services/           # AI 客户端
│   └── db/                 # D1 数据库 Schema
├── web/                    # React 前端
├── wrangler.toml           # Cloudflare 配置
└── package.json
```

## 🔧 配置 AI

部署后访问应用，点击设置按钮：

1. 选择 AI 提供商（Gemini/OpenAI/DeepSeek）
2. 输入对应的 API Key
3. 选择模型
4. 点击"测试连接"验证
5. 保存

API Key 存储在浏览器 localStorage，不会上传到服务器。

## 📝 使用流程

1. **创建项目**：输入书名和 Story Bible
2. **生成大纲**：AI 自动规划章节结构
3. **生成章节**：按需生成，支持批量
4. **导出下载**：打包所有章节为 ZIP

## 🔗 相关链接

- [Gemini API Key](https://aistudio.google.com/)
- [OpenAI API Key](https://platform.openai.com/api-keys)
- [DeepSeek API Key](https://platform.deepseek.com/)

## 📄 许可

MIT License
