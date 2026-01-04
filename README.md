# Novel Copilot

A powerful AI-driven creative writing platform powered by Cloudflare Workers. Features an advanced **Context Engineering System** for maintaining plot consistency, and supports **Novel-to-Anime conversion** with AI-generated storyboards and video generation.

[中文介绍](#chinese)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/doctoroyy/novel-copilot)

## ✨ Features

### 📖 Novel Writing
- 🤖 **Multi-Model Support**: Gemini, OpenAI, DeepSeek, and custom API endpoints
- 🧠 **Advanced Context Engineering**: 6-phase context system (see below)
- 📋 **Automated Outlining**: AI-generated volume and chapter structures
- 📊 **Character Relationship Graph**: Visual force-directed graph of character relationships
- ✅ **Multi-dimensional QC**: Automated quality checks with repair loop

### 🧠 Context Engineering System

The core innovation — a 6-phase system that goes far beyond simple "memory":

| Phase | Component | Description |
|-------|-----------|-------------|
| **Base** | Story Bible | World-building, rules, core settings |
| **Base** | Rolling Summary | Cumulative plot summary, auto-compressed |
| **Base** | Recent Chapters | Full text of last 1-2 chapters for style continuity |
| **1** | Character State Tracking | Dynamic character snapshots (location, mood, inventory, relationships) |
| **2** | Plot Graph | Foreshadowing management with urgency tracking |
| **3** | Narrative Control | Pacing curves, emotional arcs, scene requirements |
| **4** | Multi-dimensional QC | Character consistency, pacing alignment, goal achievement checks |
| **5** | Semantic Cache | Incremental context building, change detection |
| **6** | Timeline Tracking | Event deduplication, prevents repetitive plot points |

All context is **budget-optimized** with configurable token allocation per component.

### 🎬 Novel-to-Anime Conversion
- 🎭 **Character Consistency**: AI-generated character profiles with visual references
- 📝 **Script Generation**: Automatic screenplay adaptation from novel text
- 🖼️ **AI Storyboarding**: Scene-by-scene visual storyboards via Gemini
- 🎙️ **Voice Synthesis**: TTS audio generation for narration
- 🎥 **Video Generation**: Veo-powered video synthesis with R2 storage

### 🛠️ Tech Stack
- ☁️ **Serverless**: Cloudflare Workers + D1 Database + R2 Object Storage
- ⚛️ **Frontend**: React 19 + Vite (Rolldown) + TailwindCSS 4 + Radix UI
- 🔧 **Backend**: Hono framework with typed routes

## 🏗️ Architecture

```
novel-copilot/
├── src/                        # Backend (Cloudflare Worker)
│   ├── worker.ts               # Main entry point
│   ├── routes/                 # API routes
│   │   ├── projects.ts         # Novel project CRUD
│   │   ├── generation.ts       # Chapter/outline generation
│   │   ├── characters.ts       # Character relationship graph
│   │   ├── context.ts          # Context engineering APIs
│   │   ├── anime.ts            # Novel-to-Anime conversion
│   │   └── config.ts           # Runtime configuration
│   ├── context/                # Context managers
│   │   ├── characterStateManager.ts   # Phase 1
│   │   ├── plotManager.ts             # Phase 2
│   │   ├── semanticCache.ts           # Phase 5
│   │   └── timelineManager.ts         # Phase 6
│   ├── narrative/              # Narrative control
│   │   └── pacingController.ts # Phase 3: Pacing curves
│   ├── qc/                     # Quality control
│   │   ├── multiDimensionalQC.ts
│   │   ├── characterConsistencyCheck.ts
│   │   ├── pacingCheck.ts
│   │   ├── goalCheck.ts
│   │   └── repairLoop.ts
│   ├── services/               # External services
│   │   ├── aiClient.ts         # Multi-provider AI client
│   │   ├── imageGen.ts         # Gemini image generation
│   │   ├── veoClient.ts        # Google Veo video generation
│   │   └── voiceService.ts     # TTS service
│   ├── contextOptimizer.ts     # Budget-based context optimization
│   ├── contextEngineering.ts   # Unified exports
│   └── db/                     # D1 database schemas
├── web/                        # Frontend (React SPA)
│   └── src/
│       ├── components/
│       │   ├── views/          # Main view components
│       │   │   ├── DashboardView.tsx
│       │   │   ├── ChapterListView.tsx
│       │   │   ├── CharacterGraphView.tsx
│       │   │   ├── OutlineView.tsx
│       │   │   ├── GenerateView.tsx
│       │   │   └── AnimeView.tsx
│       │   ├── layout/         # Layout components
│       │   └── ui/             # shadcn/ui components
│       ├── hooks/              # Custom React hooks
│       └── contexts/           # React context providers
└── wrangler.toml               # Cloudflare configuration
```

## 🚀 Deployment

### One-Click Deploy
Click the "Deploy to Cloudflare Workers" button above.

### Manual Deployment

```bash
# 1. Clone & install
git clone https://github.com/doctoroyy/novel-copilot.git
cd novel-copilot
pnpm install
cd web && pnpm install && cd ..

# 2. Create D1 Database
npx wrangler d1 create novel-copilot-db
# Copy the database_id to wrangler.toml

# 3. Create R2 Bucket (for anime videos)
npx wrangler r2 bucket create novel-copilot-videos

# 4. Initialize Database
pnpm db:init

# 5. Deploy
pnpm deploy
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

### Novel Writing
1. **Configure API**: Settings → Select AI provider → Enter API key (stored in browser)
2. **Create Project**: Enter book title and Story Bible (world-building, characters, plot)
3. **Generate Outline**: Let AI plan volumes and chapters
4. **Write Chapters**: Generate one by one or in batches
5. **View Characters**: Explore the character relationship graph
6. **Export**: Download as ZIP (Markdown files + outline)

### Novel-to-Anime (Experimental)
1. **Create Anime Project**: Import novel text
2. **Generate Characters**: AI creates character profiles with visual references
3. **Script & Storyboard**: Generate screenplay and visual storyboards per episode
4. **Video Generation**: Synthesize video clips with Veo (requires API access)

## 🗄️ Database Schema

### Core Tables
| Table | Description |
|-------|-------------|
| `projects` | Novel projects with bible |
| `chapters` | Generated chapter content |
| `outlines` | Volume/chapter structure (JSON) |
| `characters` | Character relationship graph |
| `character_states` | Dynamic character state snapshots (Phase 1) |
| `plot_graphs` | Plot graph with foreshadowing (Phase 2) |
| `narrative_config` | Pacing curves and narrative arcs (Phase 3) |
| `chapter_qc` | Quality check results (Phase 4) |

### Anime Tables
| Table | Description |
|-------|-------------|
| `anime_projects` | Anime conversion projects |
| `anime_episodes` | Episode data (script, storyboard, video) |
| `anime_series_scripts` | Global series scripts |
| `anime_characters` | Character visual consistency data |

## 🔗 Links

- [Gemini API Key](https://aistudio.google.com/)
- [OpenAI API Key](https://platform.openai.com/api-keys)
- [DeepSeek API Key](https://platform.deepseek.com/)

---

<a name="chinese"></a>
# Novel Copilot (中文介绍)

基于 Cloudflare Workers 构建的 AI 创意写作平台。核心特色是**上下文工程系统**，确保长篇小说的剧情连贯性。同时支持**小说转动漫**功能。

## ✨ 核心功能

### 📖 小说写作
- 🤖 **多模型支持**：Gemini、OpenAI、DeepSeek 及自定义 API
- 🧠 **上下文工程系统**：6 阶段上下文管理（见下表）
- 📋 **智能大纲**：自动规划分卷和章节结构
- 📊 **人物关系图谱**：可视化力导向图展示人物关系
- ✅ **多维度质检**：自动检测章节质量并修复

### 🧠 上下文工程系统

核心创新 — 远超简单"记忆"的 6 阶段系统：

| 阶段 | 组件 | 描述 |
|------|------|------|
| **基础** | Story Bible | 世界观、规则、核心设定 |
| **基础** | 滚动摘要 | 累积剧情摘要，自动压缩 |
| **基础** | 近章原文 | 最近 1-2 章全文，保持风格连贯 |
| **Phase 1** | 人物状态追踪 | 动态人物快照（位置、心情、物品、关系） |
| **Phase 2** | 剧情图谱 | 伏笔管理，紧急度追踪 |
| **Phase 3** | 叙事控制 | 节奏曲线、情感弧线、场景要求 |
| **Phase 4** | 多维度 QC | 人物一致性、节奏对齐、目标完成检查 |
| **Phase 5** | 语义缓存 | 增量上下文构建，变化检测 |
| **Phase 6** | 时间线追踪 | 事件去重，防止剧情重复 |

所有上下文都经过**预算优化**，可配置各组件的 token 分配。

### 🎬 小说转动漫 (新功能)
- 🎭 **角色一致性**：AI 生成角色设定，保持视觉一致
- 📝 **剧本生成**：自动将小说改编为剧本
- 🖼️ **AI 分镜**：逐场景生成分镜脚本
- 🎙️ **语音合成**：TTS 旁白音频生成
- 🎥 **视频生成**：Veo 驱动的视频合成，R2 存储

### 🛠️ 技术栈
- ☁️ **Serverless**：Cloudflare Workers + D1 数据库 + R2 对象存储
- ⚛️ **前端**：React 19 + Vite (Rolldown) + TailwindCSS 4 + Radix UI
- 🔧 **后端**：Hono 框架 + TypeScript

## 🚀 部署指南

### 方式一：一键部署
点击顶部的 "Deploy to Cloudflare Workers" 按钮。

### 方式二：手动部署

```bash
# 1. 克隆并安装
git clone https://github.com/doctoroyy/novel-copilot.git
cd novel-copilot
pnpm install
cd web && pnpm install && cd ..

# 2. 创建 D1 数据库
npx wrangler d1 create novel-copilot-db
# 将 database_id 填入 wrangler.toml

# 3. 创建 R2 存储桶（用于动漫视频）
npx wrangler r2 bucket create novel-copilot-videos

# 4. 初始化数据库
pnpm db:init

# 5. 部署
pnpm deploy
```

## 📝 使用说明

### 小说写作
1. **配置 API**：设置 → 选择 AI 服务商 → 输入 API Key
2. **创建项目**：输入书名和 Story Bible（世界观、人设、主线）
3. **生成大纲**：AI 自动生成分卷大纲
4. **写作**：开始生成章节
5. **查看人物**：探索人物关系图谱
6. **导出**：一键下载 ZIP 包

### 小说转动漫 (实验性)
1. **创建动漫项目**：导入小说文本
2. **生成角色**：AI 创建角色设定和视觉参考
3. **剧本与分镜**：按集生成剧本和分镜
4. **视频生成**：使用 Veo 合成视频片段

## 📄 License

MIT License
