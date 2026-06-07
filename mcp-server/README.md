# Novel Copilot MCP Server

一个 [Model Context Protocol](https://modelcontextprotocol.io/) server，将 novel-copilot 的创作能力暴露给 Claude Code 或任何 MCP 客户端。

## 设计哲学

**旧方案**（已废弃）：24 个 CRUD 工具，agent 自己拼装上下文 → 工具太碎片化，写不出好小说。

**新方案**：围绕**创作流程**设计工具，每个工具输出可直接用于创作的信息：

```
prepare (获取上下文) → analyze (分析决策) → [Agent 写作] → evaluate (质量检查) → commit (保存)
```

核心原则：
- **一次调用获得完整 briefing** — 不让 agent 自己拼 5 次 CRUD
- **评估给可操作建议** — 不只是 pass/fail，而是告诉你怎么改
- **分析提供创作洞察** — 冲突密度、伏笔健康度、节奏诊断
- **Agent 是创作者** — 工具辅助决策和管理状态，写作本身由 agent 完成

## 快速开始

```bash
cd mcp-server && pnpm install
```

## 可用工具（15 个）

### 1. Prepare — 获取上下文
| 工具 | 说明 |
|------|------|
| `prepare_writing_context` | 获取完整创作 briefing（设定、摘要、伏笔、近章、角色、写作提示） |
| `list_projects` | 列出所有项目 |

### 2. Analyze — 创作分析
| 工具 | 说明 |
|------|------|
| `analyze_story_health` | 故事健康度诊断（字数稳定性、伏笔状态、钩子率、节奏） |
| `analyze_last_chapter_ending` | 分析上一章结尾，建议本章如何承接 |
| `suggest_chapter_direction` | 给出本章方向建议（场景序列、伏笔操作、钩子方向） |

### 3. Evaluate — 质量评估
| 工具 | 说明 |
|------|------|
| `evaluate_chapter` | 6 维度评分（字数/结构/对话/钩子/重复/开头）+ 具体修改建议 |
| `check_continuity` | 连续性检查（提前完结信号、角色名一致性） |

### 4. Commit — 保存交付
| 工具 | 说明 |
|------|------|
| `commit_chapter` | 保存章节，自动计字数更新进度 |
| `commit_summary` | 更新滚动摘要和伏笔状态 |
| `read_chapter` | 读取指定章节 |
| `export_novel` | 导出为 TXT 文件 |

### 5. Memory — 跨会话记忆
| 工具 | 说明 |
|------|------|
| `remember` | 记录决策/偏好/笔记 |
| `recall` | 回忆之前的记录 |
| `update_outline` | 更新大纲 |
| `update_characters` | 更新角色档案 |

## 预设 Prompts（4 个）

- `write_next_chapter` — 完整的写章流程（prepare→analyze→write→evaluate→commit）
- `review_and_fix` — 审核并修复章节质量
- `batch_write` — 连续写多章（批量日更）
- `brainstorm_plot` — 剧情头脑风暴

## 配套 Skills

`skills/` 目录包含 6 个 Claude Code skill 文件，定义写作方法论：
- `novel-writer-core.md` — 核心写作规则
- `chinese-webnovel.md` — 中文网文方法论
- `chapter-workflow.md` — 创作 SOP
- `outline-architect.md` — 大纲设计
- `consistency-guardian.md` — 连续性守护
- `batch-production.md` — 批量生产
