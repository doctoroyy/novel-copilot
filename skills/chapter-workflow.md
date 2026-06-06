---
name: Chapter Workflow
description: 章节创作标准流程，从构思到质检的完整 SOP
tools: [project_*, outline_*, chapter_*, context_*, qc_*]
---

# 章节创作 SOP

当用户要求写新章节时，严格按以下流程执行：

## Step 1: 信息收集

```
1. project_get(project_id) → 获取项目设定、字数要求
2. context_get_state(project_id) → 滚动摘要 + 未解伏笔
3. chapter_read_recent(project_id, count=2) → 最近 2 章全文
4. outline_get(project_id) → 本章在大纲中的定位
5. context_character_state(project_id, "all") → 所有角色当前状态
```

## Step 2: 构思规划（在写之前想清楚）

输出一段简短的构思笔记（给自己看，不入稿）：
- 本章核心任务（推动什么剧情线）
- 涉及角色及其当前动机
- 计划回收或铺设的伏笔
- 章末钩子方向
- 预估场景数（通常 2-4 个场景）

## Step 3: 撰写

写作时注意：
- 开头不要重复上章结尾的描写
- 第一段就要给出本章的切入点（动作或对话）
- 每个场景之间用场景切换词或空行分隔
- 注意时间推进的合理性
- 对话标签变化（不要每句都"他说"）

## Step 4: 保存

```
chapter_write(project_id, chapter_index, title, content)
```

## Step 5: 更新状态

根据本章发生的事件，更新：
```
chapter_update_summary(project_id, new_summary, updated_open_loops)
```

更新规则：
- 滚动摘要保持 800-1500 字，只保留与后续相关的信息
- 新增伏笔加入 open_loops
- 已回收的伏笔从 open_loops 移除
- 重大事件（角色死亡、关系变化、实力突破）必须记录

## Step 6: 质量检查

```
qc_heuristic_check(project_id, chapter_index)
```

如果检查不通过：
- wordCount 不够 → 补充场景或细节
- repetition 过多 → 替换重复表达
- endingHook 缺失 → 改写最后 1-2 段
- dialogueRatio 过高/过低 → 调整叙事和对话的比例

## Step 7: 交付

向用户报告：
- 章节标题和字数
- 本章推进了什么剧情
- 埋设/回收了什么伏笔
- QC 结果

---

# 多章连续写作

如果用户要求写多章（如"写 5 章"），每章之间：
1. 完成前一章的 Step 4-6 后再开始下一章
2. 不要跳过状态更新，否则连续性会断裂
3. 每章都要重新读取 context（因为前一章改变了状态）
4. 如果中途发现大纲需要调整，先调整再继续

# 紧急修正

如果 QC 反复不通过或发现严重一致性问题：
1. 停止继续写作
2. 报告问题给用户
3. 等待指示（可能需要修改大纲或前文）
