---
name: Chapter Workflow
description: 章节创作标准流程，从构思到质检的完整 SOP
tools: [prepare_writing_context, analyze_*, suggest_*, evaluate_*, check_*, commit_*, read_chapter]
---

# 章节创作 SOP

当用户要求写新章节时，严格按以下流程执行：

## Step 1: 获取创作 Briefing

```
prepare_writing_context(project_id)
```
→ 一次调用获得：项目设定、滚动摘要、伏笔列表、最近章节结尾、本章定位、角色信息、写作提示。

## Step 2: 分析上文 & 方向建议

```
analyze_last_chapter_ending(project_id)
suggest_chapter_direction(project_id, constraints?)
```
→ 了解如何承接上章，获得场景序列建议和钩子方向。

## Step 3: 构思规划（在写之前想清楚）

在心中规划（不调用工具）：
- 本章核心任务（推动什么剧情线）
- 场景序列（2-4 个场景，每个有目的）
- 涉及角色及其当前动机
- 计划回收或铺设的伏笔
- 章末钩子方向

## Step 4: 撰写

写作时注意：
- 开头不要重复上章结尾的描写
- 第一段就要给出本章的切入点（动作或对话）
- 每个场景之间用场景切换或空行分隔
- 注意时间推进的合理性
- 对话标签变化（不要每句都"他说"）
- 字数必须达到 briefing 中要求的最低字数

## Step 5: 质量自检

```
evaluate_chapter(project_id, content=你写的内容)
check_continuity(project_id, content=你写的内容)
```

如果 evaluate_chapter 评分低于 B：
- wordCount 不够 → 补充场景或细节
- endingHook 缺失 → 改写最后 1-2 段
- dialogueRatio 过高/过低 → 调整叙事和对话的比例
- repetition 过多 → 替换重复表达
- opening 平淡 → 改写开头

修改后重新评估，直到 B 级以上。

## Step 6: 提交

```
commit_chapter(project_id, chapter_index, title, content)
commit_summary(project_id, rolling_summary, open_loops)
```

commit_summary 时注意：
- 滚动摘要是对整个故事（不是单章）的概括
- 新增伏笔加入 open_loops
- 已回收的伏笔从 open_loops 移除
- 重大事件必须记录

## Step 7: 向用户报告

报告内容：
- 章节标题和字数
- 本章推进了什么剧情
- 埋设/回收了什么伏笔
- 质量评分

---

# 多章连续写作

如果用户要求写多章（如"写 5 章"），每章之间：
1. 完成前一章的 Step 5-6 后再开始下一章
2. 不要跳过 commit_summary，否则连续性会断裂
3. 每章都要重新调用 prepare_writing_context（因为前一章改变了状态）
4. 每 3 章调用 analyze_story_health 做全面诊断
