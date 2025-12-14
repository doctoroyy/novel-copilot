# Novel Copilot

AI 小说自动化生成工具，支持多种 AI 模型（Gemini、OpenAI、DeepSeek）。

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/doctoroyy/novel-copilot)

## ✨ 功能

- 🤖 **Multi-Model Support**: Integrated with Gemini, OpenAI, DeepSeek, and custom API endpoints.
- 📚 **Three-Layer Memory**: Maintains consistencies via Story Bible, Rolling Summaries, and Full Text of recent chapters.
- 📋 **Automated Outlining**: AI auto-plans volumes and chapters based on your bible.
- 🔄 **State Management**: Auto-saves progress, breakpoints, and open loops.
- 🌐 **Modern Web UI**: Built with React, featuring real-time generation logs and progress tracking.
- ☁️ **Local-First Architecture**: Data stored locally (IndexedDB), backend is stateless.

## 🚀 一键部署到 Cloudflare

### 方式一：点击部署按钮

Click the "Deploy to Cloudflare Workers" button above and follow the instructions.

### Option 2: Manual Deployment

```bash
# 1. Clone repository
git clone https://github.com/doctoroyy/novel-copilot.git
cd novel-copilot

# 2. Install dependencies
pnpm install
cd web && pnpm install && cd ..

# 3. Deploy (Frontend + Backend)
pnpm run deploy
```

## 🛠️ Local Development

```bash
# Install dependencies
pnpm install
cd web && pnpm install && cd ..

# Start Backend (Workers on port 8787)
pnpm dev

# Start Frontend (Vite on port 5173 - Optional for HMR)
cd web && pnpm dev
```

Visit: http://localhost:5173 (if running frontend separately) or http://localhost:8787 (if checking worker)

## 📝 Usage Guide

1. **Configuration**: Open Settings (gear icon), select your AI provider (e.g., Gemini), and enter your API Key. Keys are stored locally in your browser.
2. **Create Project**: Enter a book title and your "Story Bible" (world-building, characters, plot points). Data is saved to IndexedDB.
3. **Generate Outline**: Let AI plan your book structure (volumes and chapters).
4. **Write**: Generate chapters one by one or in batches.
5. **Download**: Export your novel as a ZIP archive containing Markdown files and the outline (Client-side generation).

---

<a name="chinese"></a>
# Novel Copilot (中文介绍)

基于 Cloudflare Workers 和 Hono 构建的 AI 小说写作助手。

## ✨ 核心功能

- 🤖 **多模型支持**：支持 Gemini、OpenAI、DeepSeek 及自定义 API。
- 📚 **三层记忆系统**：通过 Story Bible + 滚动摘要 + 近章原文，确保剧情连贯。
- 📋 **智能大纲**：自动规划分卷和章节结构。
- 🔄 **状态管理**：自动保存进度，支持断点续写和伏笔记录。
- 🌐 **Local-First**：数据存储在本地浏览器 (IndexedDB)，隐私安全且响应迅速。
- ☁️ **Serverless 架构**：无状态后端，低成本高可用。

## 🚀 部署指南

### 方式一：一键部署

点击顶部的 "Deploy to Cloudflare Workers" 按钮。

### 方式二：手动部署

```bash
# 1. 克隆项目
git clone https://github.com/doctoroyy/novel-copilot.git
cd novel-copilot

# 2. 安装依赖
pnpm install
cd web && pnpm install && cd ..

# 3. 部署 (含前端构建)
pnpm run deploy
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
