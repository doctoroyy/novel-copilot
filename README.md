# Novel Automation Agent

基于 Gemini API 的小说自动化生成 Agent，支持三层记忆系统保持章节关联性，自动检测"提前完结"并重写。

## 功能特性

- ✅ **三层记忆系统**：Story Bible + 滚动摘要 + 近章原文，保持剧情强关联
- ✅ **提前完结检测**：自动检测并重写"提前收尾"的章节
- ✅ **状态机管理**：每章生成后自动更新摘要和伏笔列表
- ✅ **批量处理**：支持多本书队列生成

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API Key

复制 `.env.example` 到 `.env`，填入你的 Gemini API Key：

```bash
cp .env.example .env
# 编辑 .env，填入 GEMINI_API_KEY
```

API Key 从 [AI Studio](https://aistudio.google.com/) 获取。

### 3. 创建书籍项目

在 `projects/` 目录下创建书籍文件夹，包含：

- `bible.md`：Story Bible（世界观、人物、禁写规则等）
- `state.json`：书籍状态（会自动创建）

参考 `projects/demo-book/` 示例。

### 4. 生成章节

```bash
# 生成单本书的 1 章
npm run dev

# 生成指定本书的 N 章
npm run dev -- ./projects/my-book 5

# 批量生成所有书籍，每本 1 章
npm run batch

# 批量生成，每本 3 章
npm run batch -- ./projects 3
```

## 项目结构

```
novel-automation/
├── src/
│   ├── gemini.ts          # Gemini API 封装
│   ├── memory.ts          # 状态管理
│   ├── qc.ts              # 质量控制（提前完结检测）
│   ├── generateChapter.ts # 章节生成核心
│   ├── runOneBook.ts      # 单本书运行器
│   └── runBatch.ts        # 批量运行器
├── projects/
│   └── demo-book/         # 示例项目
│       ├── bible.md       # Story Bible
│       ├── state.json     # 书籍状态
│       └── chapters/      # 生成的章节
└── .env                   # 环境变量 (API Key)
```

## Story Bible 格式

参考 `projects/demo-book/bible.md`，建议包含：

- **核心卖点**：题材、风格、爽点
- **主角/配角**：人设、动机、关系
- **世界观规则**：设定、禁忌
- **主线**：核心目标、阶段
- **禁写规则**：哪些内容在非最终章禁止出现

## 工作原理

1. 每章生成时，带入三层记忆：
   - Story Bible（长期设定）
   - Rolling Summary（滚动剧情摘要）
   - Last Chapters（近 1-2 章原文）

2. 生成后自动 QC 检测"提前完结"信号（关键词匹配）

3. 如果通不过 QC，自动重写（最多 2 次）

4. 生成完成后，自动更新 `rollingSummary` 和 `openLoops`

5. 状态落盘到 `state.json`，支持断点续写

## 后续计划

- [ ] 番茄小说作者后台自动上传 (Playwright RPA)
- [ ] Context Caching 优化 (降低成本)
- [ ] 模型裁判复核 (更稳的 QC)
