# Novel Copilot 可售产品重构计划

日期：2026-07-04  
分支：`codex/local-first-desktop-cleanup`  
目标：把现有 AI 小说生成工具重构成一个作者愿意长期付费的中文长篇小说创作产品。

## 结论

Novel Copilot 不应该继续定位成“能生成大纲和章节的工具集合”。社区和竞品共同指向一个更清晰的方向：作者付费买的不是一次生成，而是一个能长期维护故事资产、降低卡文成本、保证连载稳定、让作者保留控制权的创作工作台。

产品主张建议改成：

> 面向中文网文和长篇类型小说作者的本地优先创作工作台。它把设定、人物、伏笔、章节蓝图、生成、修订和质量检查组织成一个持续运转的写作系统，作者负责审美和决策，AI 负责准备、起草、校验和修补。

优先卖点：

1. 长篇不崩：人物状态、伏笔、时间线、剧情摘要和章节蓝图自动维护。
2. 作者可控：每次生成前能看到 AI 会参考什么，生成后以 proposal 形式确认改动。
3. 网文导向：支持总纲、卷纲、章节蓝图、爽点、钩子、追读节奏。
4. 成本透明：本地优先，支持 BYOK，也支持可选托管模型额度。
5. 能交付：导入旧稿，持续生成，质量扫描，导出发布稿。
6. 运行时不绑定：产品层不耦合 OpenAI Codex 或任何单一 Agent Runtime，默认优先套壳 Claude Code，后续通过适配器支持其他运行时。

## 社区与竞品信号

### 1. Story Bible / Story Vault 是核心资产

Sudowrite 的 Story Bible 把故事核心元素放到一个地方，让作者和 AI 都能引用，目标是组织叙事并让 AI 保持方向；它还支持从想法逐步推进到 synopsis、outline、scenes、chapter prose。  
来源：[Sudowrite Story Bible 文档](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/what-is-story-bible/jmWepHcQdJetNrE991fjJC)

Novelcrafter 的 Codex 是角色、地点、物品等故事元素的中心资料库。社区讨论里反复提到，Codex 和 scene summaries 能让 AI 更理解故事，不像通用聊天工具那样需要作者反复重述上下文。  
来源：[Novelcrafter Codex 文档](https://www.novelcrafter.com/help/docs/codex/the-codex)、[Reddit: NovelAI vs Sudowrite vs NovelCrafter](https://www.reddit.com/r/WritingWithAI/comments/1akj00y/novelai_vs_sudowrite_vs_novelcrafter/)

对 Novel Copilot 的启示：现有 `bible`、`outlines`、`characters`、`character_states`、`plot_graphs`、`narrative_config`、`summary_memories` 已经有雏形，但它们还是后端数据表和分散页面，不是作者日常工作的“故事资产中心”。为了避免和 OpenAI Codex / Codex CLI 混淆，产品内建议命名为 `Story Vault` 或“故事资料库”，不叫 Codex。

### 2. 生成不是一次性按钮，而是 scene beats + 导演式控制

社区里有作者描述自己的工作流：用 Story Bible / 故事资料库维持故事骨架，然后像导演一样构造场景节拍、安排角色行动；生成不合适就改 prompt 或重来。UI 是否顺手会直接影响是否继续使用。  
来源：[Reddit: Sudowrite is better than Novelcrafter](https://www.reddit.com/r/WritingWithAI/comments/1sczcs4/sudowrite_is_better_than_novelcrafter/)

Novelcrafter 的 Extract 能把聊天里的想法提取成 Codex entries、chapters 或 scene beats。  
来源：[Novelcrafter Extract 文档](https://www.novelcrafter.com/help/docs/organization/the-extract-feature)

对 Novel Copilot 的启示：下一版不能只提供“生成大纲”“生成章节”。应该把章节拆成“章节蓝图 -> 场景节拍 -> 草稿 -> 审稿 -> 修补 -> 记忆提交”的循环。

### 3. 动态记忆比长上下文更重要

SillyTavern 的 World Info / Lorebook 通过关键词动态插入设定；Author's Note 允许把作者意图插入到指定上下文位置。社区讨论还提出，单靠长上下文、向量库、摘要都不足以支撑复杂长篇，需要动态维护时间、地点、角色等持久状态。  
来源：[SillyTavern World Info 文档](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)、[Author's Note 文档](https://docs.sillytavern.app/usage/core-concepts/authors-note/)、[SillyTavern 动态世界构建讨论](https://github.com/SillyTavern/SillyTavern/discussions/3466)

对 Novel Copilot 的启示：应建立明确的 Context Builder。每次 AI 调用都产出一个可查看的“上下文包”，包含被选中的 Story Bible 条目、角色状态、章节摘要、伏笔、作者指令和当前任务，避免作者不知道 AI 到底看到了什么。

### 4. 商业模型出现两类路线

Sudowrite 是功能全开，按月给 credits，Hobby & Student 年付 $10/月起，Professional 年付 $22/月，Max 年付 $44/月。  
来源：[Sudowrite plans 文档](https://docs.sudowrite.com/plans--account/wBnmhtSyMcWtk2BLzifGkz/what-plans-are-available/mwfVvj2rGcKYs1BQy4Pdcb)

Novelcrafter 是平台订阅加 BYOK，$4/月起，$8/月开始有 BYOK AI，$14/月有 Chat，$20/月有团队能力。  
来源：[Novelcrafter pricing](https://www.novelcrafter.com/pricing)

NovelAI 用订阅层级区分上下文能力和图像额度，强调“更大 Context Size 会让 AI 记住更多”。  
来源：[NovelAI subscription 文档](https://docs.novelai.net/en/subscription/)

对 Novel Copilot 的启示：最适合当前项目的是 BYOK + Pro 工作流订阅。先不要重建复杂云端积分系统；可选托管模型作为增值项，而不是第一版依赖。

### 5. 中文网文竞品强调多 Agent、三级大纲、知识图谱和成本透明

马良写作公开主打 7 个专业 Agent、三级大纲、知识图谱、RAG 生成、角色与故事线管理、多模型按量计费，并强调不留存创作内容和成本透明。  
来源：[马良写作官网](https://maliangwriter.com/)

彩云小梦更偏故事续写、世界设定、角色扮演和世界广场。  
来源：[彩云小梦 App Store](https://apps.apple.com/cn/app/%E5%BD%A9%E4%BA%91%E5%B0%8F%E6%A2%A6/id1564619616)

笔灵 AI 小说强调大纲、剧情创作、资料库和大量生成器。  
来源：[笔灵 AI 小说介绍](https://ibiling.cn/novel-navigation/detail/1)

中文内容社区常见建议是：人负责脑洞和审美，AI 负责扩展大纲和初稿，最后作者修对话、梗、潜台词和细节。  
来源：[知乎 AI 写小说工作流文章](https://zhuanlan.zhihu.com/p/1989711973827502486)

对 Novel Copilot 的启示：中文市场不能只复制 Sudowrite。要围绕连载效率、追读节奏、爽点、伏笔回收、日更任务和成本做产品。

## 当前代码状态

当前分支已经具备一部分基础：

1. 本地优先桌面形态：`electron/` 里有 Hono sidecar、SQLite、进程内队列和本地文件存储适配。
2. 创作数据模型：`projects`、`states`、`outlines`、`chapters`、`characters`、`character_states`、`plot_graphs`、`narrative_config`、`summary_memories`。
3. 生成链路：`src/routes/generation.ts`、`src/enhancedChapterEngine.ts`、`src/contextOptimizer.ts`、`src/agent/*`。
4. 质量系统：`src/qc/*`、`qc_reports`、`QualityView`。
5. Agent Copilot 雏形：`agent_skills`、`agent_sessions`、`agent_messages`、`agent_proposals` 和右侧 `CopilotPanel`。
6. 多模型能力：provider registry、feature model mapping、BYOK header、OpenAI/Anthropic/Gemini 兼容。

主要问题：

1. 作者视角不统一：功能散在 Dashboard、Bible、Outline、Generate、Summary、Quality、Characters、Copilot 等页面，缺少一个持续写作主流程。
2. 故事资产没有产品化：很多结构存在于 JSON 或表里，但作者不能像管理故事资料库那样直接维护、抽取、引用和审查。
3. 生成链路不可解释：作者很难知道每次生成用了哪些设定、摘要、人物状态和限制。
4. Agent 能力还像聊天助手：应该升级为“项目编辑部”，输出可审阅、可回滚、可批量执行的改动方案。
5. 商业化边界不清：云端积分、登录、移动端、动漫生成、桌面本地优先混在一起，第一版可售产品应该更聚焦。
6. Agent Runtime 边界不清：产品层不能绑定 Codex 或其他单一运行时。应把 Claude Code 作为默认可替换运行时，通过适配器连接。
7. 打包和运行可靠性仍需工程化：当前 Node 26 + pnpm build approval 对 `better-sqlite3` 有运行时风险，sidecar smoke test 需要纳入 CI。

## 产品定位

### 目标用户

第一阶段只服务一个核心用户：

中文长篇网文作者，尤其是已经有连载压力、想用 AI 提升日更稳定性、但不愿把全部内容交给黑盒云服务的人。

暂不优先服务：

1. 纯短篇故事生成用户。
2. 只想聊天或角色扮演的用户。
3. 动漫视频生成用户。
4. 团队协作工作室。

### 核心承诺

1. 10 分钟完成新项目初始化或旧稿导入。
2. 每章生成前能看到章节目标、场景节拍和 AI 将参考的上下文。
3. 每章生成后能自动更新摘要、人物状态、伏笔和质量报告。
4. 作者可以随时改设定、重排大纲、修章节，系统能评估影响范围。
5. 所有草稿和设定默认保存在本地。

## 目标架构

### 1. Story Workspace

把当前页面重组成一个主工作台：

1. 左侧：作品树，包含总纲、卷纲、章节、故事资料库、素材、导出。
2. 中间：当前任务区，支持编辑章节、章节蓝图、场景节拍、质量报告。
3. 右侧：Project Copilot，负责解释、建议、生成 proposal 和执行已确认操作。
4. 顶部：当前项目健康状态，显示连续性、未闭环伏笔、今日产出、模型成本。

### 2. Story Bible 2.0 / Story Vault

把现有 `bible` 从单个文本升级为结构化故事资产：

1. Premise：一句话卖点、读者承诺、题材、目标平台。
2. Style Guide：文风、禁用表达、对话偏好、视角规则。
3. World：世界观、力量体系、地理、组织、规则。
4. Characters：人物档案、目标、秘密、当前状态、已知信息。
5. Plot Threads：主线、支线、伏笔、未闭环问题。
6. Locations / Items / Factions：地点、物品、势力。
7. Market Templates：题材模板、热榜套路、爽点结构。

新增能力：

1. 从聊天、章节、导入稿中 Extract 为 Story Vault 条目。
2. 每条 Story Vault 条目有触发词、重要性、适用范围、最近引用章节。
3. 每次生成后自动建议更新 Story Vault，但必须由作者确认。

### 3. Context Builder

新增一个可测试、可观察的上下文组装层：

输入：

1. 当前任务：生成章节、修订段落、补人物、质量扫描。
2. 当前章节蓝图和 scene beats。
3. Story Bible / Story Vault 条目。
4. 角色状态、时间线、地点状态、伏笔。
5. 最近章节、滚动摘要、卷级桥接摘要。
6. 作者笔记和本章禁忌。

输出：

1. `context_package` JSON，写入 AI job ledger。
2. 给模型的 system / prompt / tool context。
3. 前端 Context Inspector，可显示“AI 这次看到了什么”。

原则：

1. 先规则选择，再向量检索作为补充。
2. 每条上下文要有来源和理由。
3. 每次输出都记录 hash，方便复现问题。

### 4. Generation Pipeline

把生成流程统一成明确的状态机：

1. Idea Intake：灵感输入或旧稿导入。
2. Story Setup：生成或整理 Story Bible 2.0。
3. Arc Planning：总纲、卷纲、章节蓝图。
4. Chapter Blueprint：本章目标、冲突、钩子、角色状态变化、伏笔操作。
5. Scene Beats：按场景拆解行动、情绪、信息揭示。
6. Draft：生成初稿，可生成多个候选版本。
7. Review：连续性、人物动机、节奏、文风、禁忌检查。
8. Repair：自动修补或生成局部改写 proposal。
9. Commit：作者确认后写入章节，更新摘要、人物状态、伏笔和时间线。

### 5. Agent 编辑部

把现有 Copilot 从聊天侧栏升级为角色明确的编辑部：

1. 蓝图 Agent：负责总纲、卷纲、章节目标。
2. 连续性 Agent：维护人物状态、伏笔、时间线、地点。
3. 草稿 Agent：根据 scene beats 起草正文。
4. 风格 Agent：贴合作者文风、平台风格、题材节奏。
5. 审稿 Agent：给出质量分、问题、修补建议。
6. 成本 Agent：选择合适模型，控制预算。

实现上不需要同时并发多个大模型。第一版应使用确定性的 orchestration，让每一步输入输出可审查。

### 6. Agent Runtime Adapter

不要把 Novel Copilot 做成 Codex 的强绑定外壳。更合适的方式是把 Claude Code 当作默认 Agent Runtime，但产品层拥有完整的领域模型、上下文构建、proposal、审查、回滚和商业逻辑。

建议架构：

1. `Novel Copilot Core`：负责 SQLite、Story Vault、Context Builder、章节蓝图、质量扫描、导出、license。
2. `Runtime Adapter`：负责启动和管理外部 Agent Runtime，第一版实现 `ClaudeCodeAdapter`。
3. `Virtual Project Workspace`：把项目数据物化成 Claude Code 容易理解的文件结构，例如 `story-bible.md`、`story-vault/*.md`、`outline.json`、`chapters/*.md`、`blueprints/*.json`。
4. `Tool Contract`：Claude Code 只能调用受控工具，例如读取故事资料库、生成上下文包、提交 proposal、运行 QC。不能直接写数据库。
5. `Proposal Importer`：Claude Code 修改虚拟工作区或输出结构化 proposal 后，产品层做 schema 校验、diff 预览、风险评级和作者确认。
6. `Runtime Registry`：后续可接其他 CLI/SDK Agent、本地模型 agent 或团队自研运行时，但 UI 和业务逻辑不改。

为什么 Claude Code 优先：

1. 它已经有成熟的长任务规划、工具调用、文件编辑和上下文工作流。
2. 小说项目天然可以映射成文件工作区，适合让 Claude Code 读写 Markdown/JSON。
3. 产品可以把 AI 写作能力包装成“可审查的项目改动”，而不是把所有智能都写死在应用后端。
4. 这样能更快做出能卖的版本：先卖工作流和体验，再逐步沉淀自有 agent runtime。

边界：

1. Claude Code 是默认运行时，不是产品身份。
2. 所有项目数据仍由 Novel Copilot Core 管理。
3. 所有变更必须经过 proposal 和作者确认。
4. 不能把 license、计费、导出、Story Vault、Context Builder 做进 Claude Code prompt 里。

### 7. Commercial Shell

桌面版第一阶段：

1. 本地项目、SQLite、本地文件。
2. BYOK 多模型。
3. License 激活，只验证授权，不上传正文。
4. 自动更新。
5. 崩溃日志和匿名产品分析必须 opt-in。

云端第二阶段：

1. 可选备份和多设备同步。
2. 托管模型额度。
3. 模板市场。
4. 团队协作。

## 重构路线

### Phase 0：打包和本地优先收口，1 周

目标：现有 local-first 版本能稳定运行，并能给内测用户安装。

任务：

1. 统一 monorepo 依赖管理，把 root/web/electron 的 pnpm workspace 关系理顺。
2. 修复 `better-sqlite3` native build 和 sidecar smoke test。
3. 移除或隐藏桌面版不需要的登录、积分、云端 admin 入口。
4. 保留 BYOK 设置，移除所有硬编码 key 风险。
5. 新增 `ClaudeCodeAdapter` 的技术 spike：能启动 Claude Code，读取一个虚拟作品工作区，并输出结构化 proposal。
6. 新增 `pnpm smoke:desktop`：启动 sidecar，访问 `/api/health`，创建临时项目，写入 SQLite，再关闭。
7. 新增桌面开发说明和打包说明。

验收：

1. 新机器 clone 后能按 README 安装、启动、打包。
2. `pnpm typecheck`、`pnpm --dir web build`、`pnpm --dir electron build`、`pnpm smoke:desktop` 全部通过。
3. 没有明文 API key。

### Phase 1：产品主工作台和 Story Bible 2.0，2 到 3 周

目标：作者能围绕一个工作台维护作品，而不是在页面间找功能。

任务：

1. 新增 Story Workspace layout，整合章节树、编辑器、Copilot 和项目健康状态。
2. 新增 `story_entities`、`story_threads`、`story_notes`、`context_packages` 表，或在现有表上加兼容层。
3. 把 `bible` 文本迁移为结构化 Story Bible 2.0，同时保留 raw text。
4. 新增 Story Vault 管理视图：人物、地点、物品、势力、规则、伏笔。
5. 新增 Extract 功能：从章节/聊天结果中提取 Story Vault 条目和 scene beats。
6. 旧项目自动迁移，不能丢现有 bible、outline、characters。

验收：

1. 用户能创建项目、填写题材和卖点、生成初版 Story Bible。
2. 用户能手动新增角色、地点、伏笔，并在生成前看到它被引用。
3. 从一段章节文本中能提取人物或伏笔 proposal。

### Phase 2：Context Builder 和章节生产流水线，2 到 4 周

目标：每章生成变成可解释、可控制、可复现的流程。

任务：

1. 实现 `ContextBuilder` 服务，替代散落在 generation/contextOptimizer/agent 中的上下文拼接。
2. 每次 AI 调用写入 `ai_job_ledger`：任务、模型、上下文 hash、token 估算、成本、耗时、错误。
3. 新增 Context Inspector 前端。
4. 新增 Chapter Blueprint 编辑视图。
5. 新增 Scene Beats 编辑和重排。
6. 生成后进入 Review，再进入 Commit，不再直接默默更新所有状态。
7. 建立 10 章连续生成 fixture，用固定假模型或录制响应验证状态更新。

验收：

1. 任意一章生成前，用户能查看上下文包。
2. 任意一章生成后，系统能展示更新了哪些摘要、人物状态和伏笔。
3. 同一个 context package 能复现同一类模型请求。
4. 连续生成 10 章不会丢章节索引、人物状态和未闭环线索。

### Phase 3：质量系统产品化，2 周

目标：把 QC 从“报告页”变成日常写作安全网。

任务：

1. 把 QC 结果和章节编辑器绑定，问题定位到章节/段落。
2. 质量维度改成作者可理解的项目健康项：设定冲突、人物动机、节奏疲软、爽点不足、钩子弱、伏笔未回收。
3. 修补动作统一走 proposal，支持预览 diff 和回滚。
4. 新增项目级健康看板：中盘风险、角色弧线、伏笔库存、读者承诺兑现度。
5. 加入成本控制：低成本模型初筛，高质量模型复核。

验收：

1. 用户能从章节里直接看到 QC 问题并一键生成修补 proposal。
2. 用户能接受或拒绝每个修补。
3. 修补后自动更新相关状态。

### Phase 4：商业化最小版本，2 到 3 周

目标：可以对外卖给第一批用户。

任务：

1. License 激活和离线宽限期。
2. 新手引导：新建项目、导入旧稿、配置模型、生成第一章。
3. 成本面板：本次调用、今日、项目累计成本。
4. 导出：TXT、Markdown、DOCX 或 EPUB 至少支持两种。
5. 官网落地页、下载页、隐私说明、退款说明、用户协议。
6. 内测反馈入口。
7. 示例项目和 3 个题材模板：玄幻升级、都市系统、古言宅斗。

建议定价：

1. Free：1 个项目，BYOK，基础生成，基础故事资料库。
2. Pro：人民币 49 到 79 元/月，或 399 到 599 元/年。本地无限项目、Context Inspector、高级 QC、批量生成、导出。
3. Studio：人民币 129 到 199 元/月。托管模型额度、云备份、多设备、模板市场优先。
4. Token Pack：只给不想配置 API 的用户，作为可选项。

第一版不要主打“全自动写百万字”。应该主打“稳定日更、长篇不崩、作者可控”。

## 要暂缓或下沉的模块

1. Anime/video：放到 Labs，不进入主路径。
2. Mobile：等桌面工作流跑通后再做阅读和轻编辑。
3. 云端积分系统：桌面版先隐藏，后续作为托管模型账单重做。
4. 多人协作：等个人 Pro 付费成立后再做。
5. 自动热榜抓取：可以保留为模板素材，但不能成为第一版核心依赖。

## 数据模型建议

新增或重构表：

1. `story_entities`
   - `id`
   - `project_id`
   - `type`: character/location/item/faction/rule/thread/style/market
   - `name`
   - `aliases_json`
   - `content`
   - `status_json`
   - `trigger_terms_json`
   - `importance`
   - `last_referenced_chapter`
   - `source_refs_json`

2. `chapter_blueprints`
   - `project_id`
   - `chapter_index`
   - `goal_json`
   - `scene_beats_json`
   - `state_delta_plan_json`
   - `acceptance_criteria_json`
   - `status`

3. `context_packages`
   - `id`
   - `project_id`
   - `task_type`
   - `chapter_index`
   - `input_refs_json`
   - `package_json`
   - `prompt_hash`
   - `created_at`

4. `ai_job_ledger`
   - `id`
   - `context_package_id`
   - `provider`
   - `model`
   - `phase`
   - `estimated_input_tokens`
   - `estimated_output_tokens`
   - `estimated_cost`
   - `duration_ms`
   - `status`
   - `error_message`

5. `revision_proposals`
   - 可复用或扩展现有 `agent_proposals`
   - 需要支持 diff、批量动作、回滚和作者确认。

6. `runtime_sessions`
   - `id`
   - `project_id`
   - `runtime`: claude_code / custom_cli / sdk_agent
   - `virtual_workspace_path`
   - `status`
   - `last_error`
   - `created_at`
   - `updated_at`

7. `virtual_workspace_snapshots`
   - `id`
   - `runtime_session_id`
   - `context_package_id`
   - `manifest_json`
   - `input_hash`
   - `output_hash`
   - `created_at`

## 工程原则

1. 先本地稳定，再云端增值。
2. 所有 AI 改动都必须可预览、可拒绝、可回滚。
3. 任何生成都必须有上下文包和任务记录。
4. 任何长期记忆更新都必须来自明确来源，不允许模型随意改核心设定。
5. 生成引擎要可测试，至少能用假模型跑完整 10 章流程。
6. UI 不堆功能入口，所有能力围绕“下一步写什么、怎么写好、哪里有风险”组织。

## 最近两周建议排期

### Week 1

1. 修复 workspace 依赖和 `better-sqlite3` native build。
2. 增加 desktop smoke test。
3. 定义 Story Bible 2.0 和 Context Package TypeScript 类型。
4. 定义 `ClaudeCodeAdapter` 接口和 Virtual Project Workspace 文件 manifest。
5. 新增 Context Builder 的空实现和单元测试。
6. 写迁移草案，不直接删旧字段。

### Week 2

1. 新建 Story Workspace 产品壳。
2. 接入 Story Vault 列表和编辑。
3. 把章节生成改为先生成 Chapter Blueprint。
4. 在生成前展示 Context Inspector。
5. 用 Claude Code 跑通一个只读示例任务：读取虚拟作品工作区并输出章节修订 proposal。
6. 用一个示例项目跑通“生成蓝图 -> 生成草稿 -> 审查 -> 提交记忆”。

## 成功指标

产品指标：

1. 新用户 10 分钟内完成第一章草稿。
2. 用户愿意连续 3 天打开同一项目继续写。
3. 每章生成后作者平均只需要改 20% 到 40%，而不是重写。
4. 用户能明确说出“它帮我记住了什么”和“它避免了什么错误”。

工程指标：

1. 桌面 smoke test 稳定通过。
2. 10 章 fixture 流程稳定通过。
3. 每次 AI 调用都有 ledger。
4. 任意生成结果都能追溯上下文包。
5. 没有明文密钥和默认托管模型泄露。

商业指标：

1. 内测 20 人中至少 5 人愿意付费。
2. Pro 定价转化率优于一次性买断。
3. BYOK 用户能理解自己的模型成本。
4. 至少 3 个题材模板能让用户直接开始项目。

## 下一步

从工程执行角度，先做 Phase 0 和 Phase 1 的交界处：

1. 修复桌面运行和打包可靠性。
2. 建 `ContextBuilder` 和 `StoryEntity` 类型。
3. 新建 Story Workspace 壳，把现有 Bible、Outline、Chapters、Copilot 收进同一个工作台。
4. 把“生成章节”改成先生成可编辑的 Chapter Blueprint。

这四件事完成后，Novel Copilot 才会从“功能很多的 AI 工具”变成“作者每天能打开继续写的产品”。
