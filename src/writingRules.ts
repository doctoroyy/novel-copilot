/**
 * 核心写作规则工厂
 *
 * 把《网文写作方法论-黄金三章与追读技巧》的全量硬规则集中生成，
 * 供 fast-path 与 orchestrator（ReAct agent）共用。单一事实源 —— 避免两条
 * 路径 prompt 漂移导致的低复杂度章节质量崩塌。
 *
 * 设计要点：
 * - 按章节索引 / 节奏类型 / 是否最终章 条件性注入不同规则块
 * - 每条规则都来自方法论文档，尽量附可执行的数量阈值（字数/段落数/频次）
 * - 正面规则 + 禁忌清单对照出现，LLM 对负面约束敏感
 */
export type NarrativeType =
  | 'action'
  | 'climax'
  | 'tension'
  | 'revelation'
  | 'emotional'
  | 'transition';

export interface CoreRulesInput {
  chapterIndex: number;
  totalChapters: number;
  isFinalChapter: boolean;
  narrativeType?: NarrativeType;
  pacingTarget?: number; // 0~10
  /** 是否为卷首/新弧线起点 */
  isArcOpening?: boolean;
}

const NARRATIVE_RECIPES: Record<NarrativeType, string> = {
  action:
    '动作/战斗章：短句为主（≤20字），动词密度高，多用具体招式/轨迹/反击；禁止慢镜心理独白；围观者/旁白只写反应不写感悟',
  climax:
    '高潮章：伏笔集中触发，主角招式/底牌倾泻，对手崩盘；结尾以"破局瞬间+新威胁浮现"收束，不写胜利后的总结',
  tension:
    '铺垫紧张章：时限/追兵/倒计时具体化；主角每段选择都加重代价；禁止"什么都没发生"的日常段；章末危机逼近',
  revelation:
    '揭示章：关键信息分 2~3 次递进释放，每次释放都触发角色反应；禁止一次性长段独白倾倒真相；揭示后必须抛出新疑问',
  emotional:
    '情感章：对话承担 60%+ 推进，心理描写≤200字/段；细节通过动作/表情外化；禁止"他感到……"式直述情绪',
  transition:
    '过渡章：上弧余波 20% + 新弧钩子 25%；必须有 1 个微爽点（小进展/小幽默/新线索）；≤2 章必须进入新冲突',
};

function buildGoldenThreeRules(chapterIndex: number): string {
  if (chapterIndex > 3) return '';
  const c1 = chapterIndex === 1;
  const c2 = chapterIndex === 2;
  const c3 = chapterIndex === 3;
  const specific = [
    c1 && '第1章：500字内必出冲突/异常事件；禁止"某年某月"/"他叫XXX"/天气风景开场；首段≤3句建立主角身份；章末留更大危机或秘密',
    c2 && '第2章：主角启动应对，金手指/独特能力展示一次（不必全开）；引入第一个对手或压力源；章末出现更大挑战',
    c3 && '第3章：必须完成首个完整爽点循环（压抑→积蓄→爆发），核心卖点首次兑现；章末升级格局，让读者看到后面的大戏',
  ].filter(Boolean) as string[];
  return [
    `【黄金三章铁律（当前第${chapterIndex}章）】`,
    '- 设定融入行动与对话，禁止集中介绍世界观',
    '- 出场角色≤5人（主角+1~2关键配角+1对手）',
    '- 回忆段落≤500字，禁止长篇前情回顾',
    '- 每章结尾强钩子，读者必须"忍不住翻下一章"',
    '- 主角主导剧情，旁观时长≤半章',
    ...specific.map((s) => `- ${s}`),
  ].join('\n');
}

function buildPacingLine(input: CoreRulesInput): string {
  const parts: string[] = [];
  if (input.narrativeType) {
    parts.push(`节奏类型: ${input.narrativeType} — ${NARRATIVE_RECIPES[input.narrativeType]}`);
  }
  if (typeof input.pacingTarget === 'number') {
    const tag =
      input.pacingTarget >= 8 ? '极高强度' :
      input.pacingTarget >= 6 ? '高强度' :
      input.pacingTarget >= 4 ? '中强度' :
      '低强度';
    parts.push(`紧张度目标 ${input.pacingTarget}/10（${tag}）`);
  }
  return parts.length ? `【本章节奏】\n- ${parts.join('\n- ')}` : '';
}

/**
 * 核心写作规则（所有章节共用）。
 * 覆盖：文风、CHST四要素、追读引擎、信息差、爽点三步法、12钩子、禁忌清单。
 */
const EVERGREEN_CORE_RULES = `【上下文一致性（最高优先级 — 不得违反）】
- 必须严格延续最近章的角色状态（位置/情绪/受伤/物品），禁止"神隐复原"或跳跃
- 不复述 Rolling Summary 已记录的情节，也不重写已发生的画面
- 除非大纲明确要求，禁止引入超当前层级的敌人/能力/世界观
- 上章刚经历大事件，本章先写余波/代价/角色反应，再切新线
- 单章 1 主危机 + 1 副事件，其他冲突只埋钩子

【文风铁律（商业网文小白向）】
- 大白话口语化：接地气、有呼吸感；句长正文≤25字，对话≤30字；超长必须断句
- 禁止文艺腔：连续形容词/华丽比喻/长定语/四字成语堆叠/排比——一律砍掉
- 对话像真人：每句有信息量或情绪推力；禁止空话/客套/官腔/话剧腔/译制片腔
- 每段有功能：推进事件、制造摩擦、释放信息、改变关系 —— 四选一
- 禁止"他感到/她意识到"式直述情绪，用动作、表情、语言外化

【CHST 章节四要素（每章至少达成3项）】
- C 冲突：每章至少1个明确冲突（人vs人/人vs环境/人vs自我/势力vs势力）
- H 钩子：章末 200~300 字必须属于以下 12 类之一 —— 危机悬停/信息炸弹/强敌出场/反转/抉择困境/伏笔触发/时限压力/情感爆发前奏/身份暴露/奖励预告/误会加深/格局升级
- S 爽点：主角必须达成以下至少一项 —— 展示能力、获得进展、赢得冲突、揭露信息、推进关系、获取机缘
- T 转折：至少1个微转折（小意外/新发现/局势变化），让读者"没想到"

【追读引擎（商业追读率核心）】
- 推进链：目标→阻碍→行动→新结果/新问题 —— 必须闭环
- 主角主导：主角是剧情推动者，绝不沦为旁观或被动接受
- 信息差：至少维持1条角色间信息差（主角>对手=期待感；读者>角色=紧张感；角色>读者=悬念感）
- 解一抛一：每解决一个问题立即抛出新问题，读者永远不彻底满足
- 承诺兑现：前文埋过的线索在合理时机必须兑现，但方式要超预期

【爽点三步法】
- 铺垫压抑（1~3章，不超5章）：让主角遭遇不公/困境/挑战
- 积蓄期待（0.5~2章）：暗示主角有底牌/计划
- 爆发释放（0.5~1章）：干脆利落，结果超预期；有围观者时放大反应增强爽感

【章节结构三段式】
- 开头 200~300 字：承接上章钩子，1~2 句建立紧张/期待，直接进入当前场景（禁止回顾式开场）
- 中段：核心事件推进 + 至少1个微爽点或情绪拐点 + 信息释放
- 结尾 200~300 字：本章阶段性结果 + 未完成悬念 + 暗示下章爆点

【弃书红线（绝对禁止）】
- 连续超 300 字的设定/世界观/能力介绍
- 主角做出与智商/人设不符的蠢决定
- 无冲突的纯日常闲聊超 500 字
- 与前文设定矛盾 / 重复已写过的信息与描写
- 在高潮场景插入长段回忆或心理独白
- 说教式总结、口号式感悟、作者旁白、"本章完"字数统计`;

/**
 * 生成最终可直接塞进 system prompt 的核心规则字符串。
 * 调用方只需附加自己的风格模板、输出格式和硬性字数要求。
 */
export function buildCoreWritingRules(input: CoreRulesInput): string {
  if (isLegacyWritingRulesMode()) {
    return buildLegacyCoreRules(input.chapterIndex, input.isFinalChapter);
  }
  const sections: string[] = [
    '你是商业网文连载写作助手。唯一使命：让读者"读了就停不下来"，兼顾起点白金/番茄金番级别的文笔与追读率。',
    EVERGREEN_CORE_RULES,
  ];
  const golden = buildGoldenThreeRules(input.chapterIndex);
  if (golden) sections.push(golden);
  const pacing = buildPacingLine(input);
  if (pacing) sections.push(pacing);
  if (input.isArcOpening && input.chapterIndex > 3) {
    sections.push(
      [
        '【新弧起点规则】',
        '- 本章是新弧线起点：前 300 字快速切入新冲突源，不做旧弧大段回顾',
        '- 本章须明确新弧线核心卖点（打脸/升级/探秘/救人 之一），让读者立刻明白接下来看什么',
        '- 章末钩子强度拉满，奠定新弧基调',
      ].join('\n'),
    );
  }
  if (input.isFinalChapter) {
    sections.push('【最终章】允许收束主线、揭示关键真相，但保留至少 1 条宏观悬念或情感留白，不写"感谢读者"式元叙事。');
  } else {
    sections.push('【非最终章】严禁任何"完结/终章/尾声/后记/全书完/感谢读者"等收尾表达；结尾必须留悬念。');
  }
  return sections.join('\n\n');
}

export const WRITING_RULES_VERSION = '2026-04-v2';

const LEGACY_CORE_RULES = `你是商业网文连载写作助手。唯一使命：让读者"读了就停不下来"。
- 小白文/大白话，口语化、接地气，句长≤25字（对话≤30字）
- 对话像真人说话，每句有信息量，禁止空话
- 每章必含：冲突(≥1个)+章末钩子+爽点(主角有进展)+微转折
- 完成"目标→阻碍→行动→新问题"推进链
- 主角必须是推动者，禁止旁观和被动
- 至少维持1个信息差（制造期待感或紧张感）
- 开头直入场景，章末用事件/悬念收尾
- 单章1主危机+1副事件，其他只埋钩子`;

/**
 * 旧版规则（用于 A/B 对比 baseline）。进程启动时通过 env
 * WRITING_RULES_LEGACY=1 切换 —— 仅供 benchmark 脚本使用，
 * 生产环境不应设置。
 */
export function isLegacyWritingRulesMode(): boolean {
  return process.env.WRITING_RULES_LEGACY === '1';
}

export function buildLegacyCoreRules(chapterIndex: number, isFinalChapter: boolean): string {
  const opening = chapterIndex <= 3
    ? '- 【黄金三章】500字内必出冲突，设定融入行动，出场≤5人，展示核心卖点'
    : '';
  const closing = isFinalChapter
    ? ''
    : '\n- 非最终章严禁完结/终章/尾声';
  return `${LEGACY_CORE_RULES}${opening ? '\n' + opening : ''}${closing}`;
}
