# Novel Copilot (Previously Novel Automation Agent)

A powerful AI-driven novel writing assistant powered by Cloudflare Workers and Hono. It features a sophisticated three-layer memory system to maintain plot consistency, automatic "premature ending" detection, and one-click deployment.

[中文介绍](#chinese)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/doctoroyy/novel-copilot)

## ✨ Features

- 🤖 **Multi-Model Support**: Integrated with Gemini, OpenAI, DeepSeek, and custom API endpoints.
- 📚 **Three-Layer Memory**: Maintains consistencies via Story Bible, Rolling Summaries, and Full Text of recent chapters.
- 📋 **Automated Outlining**: AI auto-plans volumes and chapters based on your bible.
- 🔄 **State Management**: Auto-saves progress, breakpoints, and open loops.
- 🌐 **Modern Web UI**: Built with React, featuring real-time generation logs and progress tracking.
- ☁️ **Serverless Architecture**: Fully migrated to Cloudflare Workers & D1 Database.

## 🚀 One-Click Deployment

### Option 1: Deploy Button

Click the "Deploy to Cloudflare Workers" button above and follow the instructions.

### Option 2: Manual Deployment

```bash
# 1. Clone repository
git clone https://github.com/doctoroyy/novel-copilot.git
cd novel-copilot

# 2. Install dependencies
pnpm install
cd web && pnpm install && cd ..

# 3. Create D1 Database (Cloudflare account required)
npx wrangler d1 create novel-copilot-db
# Copy the output `database_id` to your `wrangler.toml`

# 4. Initialize Database Schema
pnpm db:init

# 5. Deploy
npx wrangler deploy
```

## 🛠️ Local Development

```bash
# Install dependencies
pnpm install
cd web && pnpm install && cd ..

# Initialize local D1 database
pnpm db:init:local

# Start Backend (Workers on port 8787)
pnpm dev

# Start Frontend (Vite on port 5173)
cd web && pnpm dev
```

Visit: http://localhost:5173

## 📝 Usage Guide

1. **Configuration**: Open Settings (gear icon), select your AI provider (e.g., Gemini), and enter your API Key. Keys are stored locally in your browser.
2. **Create Project**: Enter a book title and your "Story Bible" (world-building, characters, plot points).
3. **Generate Outline**: Let AI plan your book structure (volumes and chapters).
4. **Write**: Generate chapters one by one or in batches.
5. **Download**: Export your novel as a ZIP archive containing Markdown files and the outline.

---

<a name="chinese"></a>
# Novel Copilot (中文介绍)

基于 Cloudflare Workers 和 Hono 构建的 AI 小说写作助手。

## ✨ 核心功能

- 🤖 **多模型支持**：支持 Gemini、OpenAI、DeepSeek 及自定义 API。
- 📚 **三层记忆系统**：通过 Story Bible + 滚动摘要 + 近章原文，确保剧情连贯。
- 📋 **智能大纲**：自动规划分卷和章节结构。
- 🔄 **状态管理**：自动保存进度，支持断点续写和伏笔记录。
- 🌐 **现代化界面**：React 构建的 Web UI，实时显示生成日志。
- ☁️ **Serverless 架构**：全栈部署在 Cloudflare，低成本高可用。

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

# 3. 创建数据库
npx wrangler d1 create novel-copilot-db
# 将输出的 database_id 填入 wrangler.toml

# 4. 初始化数据库
pnpm db:init

# 5. 部署
npx wrangler deploy
```

## 📝 使用说明

1. **配置**：点击设置图标，选择 AI 服务商并填入 Key（数据存储在本地浏览器）。
2. **创建**：输入书名和 Story Bible（世界观、人设、主线）。
3. **大纲**：AI 自动生成分卷大纲。
4. **写作**：开始生成章节。
5. **导出**：一键下载 ZIP 包（包含分章 Markdown 和大纲）。

## 🔗 Links

- [Gemini API Key](https://aistudio.google.com/)
- [OpenAI API Key](https://platform.openai.com/api-keys)
- [DeepSeek API Key](https://platform.deepseek.com/)

## 📄 License

MIT License
