# Novel Copilot MCP Server

一个 [Model Context Protocol](https://modelcontextprotocol.io/) server，将 novel-copilot 的创作引擎能力暴露给 Claude Code 或任何 MCP 客户端。

## 快速开始

```bash
# 安装依赖
cd mcp-server && pnpm install

# 开发模式运行
pnpm dev

# 构建
pnpm build
```

## 配置 Claude Code

在项目根目录创建 `.claude/settings.json`（已包含）：

```json
{
  "mcpServers": {
    "novel-copilot": {
      "command": "node",
      "args": ["--import", "tsx", "mcp-server/src/index.ts"],
      "cwd": ".",
      "env": {
        "APP_DATA_DIR": "~/.novel-copilot"
      }
    }
  }
}
```

## 可用工具（24 个）

### 项目管理
| 工具 | 说明 |
|------|------|
| `project_list` | 列出所有小说项目 |
| `project_get` | 获取项目详情（设定、状态） |

### 大纲
| 工具 | 说明 |
|------|------|
| `outline_get` | 获取结构化大纲 |
| `outline_update` | 更新大纲 |

### 角色
| 工具 | 说明 |
|------|------|
| `characters_get` | 获取角色档案 |
| `characters_update` | 更新角色档案 |

### 章节
| 工具 | 说明 |
|------|------|
| `chapter_list` | 列出所有章节 |
| `chapter_read` | 读取指定章节全文 |
| `chapter_read_recent` | 读取最近 N 章（保持连续性） |
| `chapter_write` | 保存章节 |
| `chapter_update_summary` | 更新滚动摘要和伏笔 |

### 上下文查询
| 工具 | 说明 |
|------|------|
| `context_get_state` | 获取叙事状态（摘要、伏笔） |
| `context_plot_graph` | 查询剧情图谱 |
| `context_character_state` | 查询角色状态 |
| `context_timeline` | 查询时间线事件 |

### 质量控制
| 工具 | 说明 |
|------|------|
| `qc_heuristic_check` | 启发式质量检查（字数、重复、钩子等） |
| `qc_consistency_check` | 一致性检查 |

### 生成引擎
| 工具 | 说明 |
|------|------|
| `generate_chapter_engine` | 调用完整 AI 引擎生成章节 |
| `batch_status` | 查看批量生成进度 |

### 记忆
| 工具 | 说明 |
|------|------|
| `memory_save` | 保存笔记/决策到持久记忆 |
| `memory_search` | 搜索持久记忆 |
| `memory_delete` | 删除记忆条目 |

### 导出
| 工具 | 说明 |
|------|------|
| `export_txt` | 导出为 TXT 文件 |
| `export_chapter_list` | 导出章节目录 |

## 预设 Prompts

- `generate_chapter` — 带完整上下文注入的章节生成流程
- `review_chapter` — 章节审核流程
- `brainstorm_plot` — 剧情头脑风暴

## Resources

- `novel://project/{project_id}` — 完整项目快照（设定+状态+大纲+角色）

## AI 配置

章节生成引擎需要 AI provider。支持两种方式：

1. **环境变量**（推荐开发用）：
   ```bash
   AI_API_KEY=sk-xxx
   AI_PROVIDER=openai  # openai, anthropic, google
   AI_MODEL=gpt-4o-mini
   AI_BASE_URL=https://api.openai.com/v1  # 可选
   ```

2. **数据库配置**（与 GUI 应用共享）：
   通过 `provider_registry` + `model_registry` + `feature_model_mappings` 表配置

## 配套 Skills

项目 `skills/` 目录包含 6 个 Claude Code skill 文件，定义写作方法论和工作流。
