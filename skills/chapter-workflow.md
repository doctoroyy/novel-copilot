---
name: Chapter Workflow
description: 章节创作 SOP v2 — 集成写作规则引擎和节奏曲线控制
tools: [prepare_writing_context, get_writing_rules, get_pacing_guidance, analyze_*, suggest_*, evaluate_*, check_*, commit_*, read_chapter]
---

# 章节创作 SOP

当用户要求写新章节时，严格按以下流程执行：

## Step 1: 获取创作 Briefing（一次调用完备）

```
prepare_writing_context(project_id, narrative_type?)
```
→ 一次调用获得全部上下文：
- 项目设定、滚动摘要、伏笔列表
- **写作规则**（根据章节位置动态生成，含黄金三章/CHST/弃书红线）
- **节奏指导**（紧张度目标、叙事类型、卷内位置）
- 一致性护栏（上章结尾锚点，不可矛盾的事实）
- 最近章节结尾、角色信息

## Step 2: 分析上文 & 方向建议（可选，复杂章节推荐）

```
analyze_last_chapter_ending(project_id)
suggest_chapter_direction(project_id, constraints?)
```
→ 了解如何承接上章，获得伏笔操作建议和钩子方向。

如果需要独立获取规则或节奏（不重新拉整个 briefing）：
```
get_writing_rules(project_id, narrative_type?)
get_pacing_guidance(project_id)
```

## Step 3: 构思规划

根据 briefing 中的规则和节奏指导，规划：
- **场景序列**（2-4 个场景，每个有明确目的）
- **CHST 达成路径**：
  - C: 本章核心冲突是什么？
  - H: 章末钩子用 12 类中的哪一种？
  - S: 主角在哪个场景获得爽点？
  - T: 在哪里安排微转折？
- **伏笔操作**：回收哪条？埋设什么新伏笔？
- **节奏执行**：紧张度目标如何体现在句式和场景节奏上？

## Step 4: 撰写

严格遵守 briefing 中的写作规则，重点关注：

### 弃书红线检查清单（写的时候就避免）
- [ ] 无对白连续段落 ≤ 300 字（超过 = 设定倾泻红线）
- [ ] 正文句长 ≤ 25 字，对话 ≤ 30 字
- [ ] 无话剧腔/译制片腔（吾/尔等/岂非/莫非）
- [ ] 章末必有钩子（12 类之一）
- [ ] 不出现"完结/终章/全书完/感谢读者"

### 写作要点
- 开头不重复上章结尾，用动作/对话直接切入
- 对话像真人（有信息量，不空话）
- 每段有功能（推进/摩擦/信息/关系 四选一）
- 主角主导剧情，不做旁观者
- 字数达到 briefing 建议区间

## Step 5: 引擎级质量自检

```
evaluate_chapter(project_id, content=你写的内容)
check_continuity(project_id, content=你写的内容, chapter_index)
```

`evaluate_chapter` 返回8项量化指标 + 弃书红线检测：

| 问题类型 | 处理方式 |
|----------|----------|
| 🚫 弃书红线 | **必须修复**（设定长段→切碎加对话；无钩子→改写结尾；话剧腔→替换） |
| ⚠️ 质量建议 | 建议修复（长句→断句；对话少→加互动；主角被动→改视角） |
| 评分 < B | 根据建议修改后**重新评估** |

修改后重新评估，直到：
- 零弃书红线
- 评分 ≥ B (70+)

## Step 6: 提交

```
commit_chapter(project_id, chapter_index, title, content)
commit_summary(project_id, rolling_summary, open_loops)
```

commit_summary 要求：
- 滚动摘要：**整个故事**到目前为止的关键剧情概括（800-1500字）
- open_loops：添加新伏笔、移除已回收的伏笔
- 重大事件和状态变化必须记录

## Step 7: 向用户报告

- 章节标题和字数
- 评分和主要指标
- CHST 达成情况
- 埋设/回收的伏笔
- 节奏变化（与上章对比）

---

# 多章连续写作

如果用户要求写多章（如"写 5 章"），每章之间：
1. 完成 Step 5-6 后才开始下一章
2. **必须** commit_summary，否则连续性断裂
3. 每章重新 `prepare_writing_context`（前章改变了状态）
4. 每 3 章 `analyze_story_health` 做全面诊断
5. 注意章间节奏变化（用 `get_pacing_guidance` 确认节奏曲线位置）
6. 连续 2 章有弃书红线 → 暂停报告问题
