/**
 * Genre Templates — pre-built story setups for quick project initialization.
 *
 * Phase 4: 3 templates (玄幻升级, 都市系统, 古言宅斗) so a user can start a
 * project in minutes instead of from a blank page.
 */

export type GenreTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  bible: string;
  suggestedTotalChapters: number;
  suggestedMinWords: number;
  outlineTemplate?: {
    mainGoal: string;
    milestones: string[];
    volumes: Array<{
      title: string;
      startChapter: number;
      endChapter: number;
      goal: string;
      conflict: string;
    }>;
  };
};

export const GENRE_TEMPLATES: GenreTemplate[] = [
  {
    id: 'xuanhuan-leveling',
    name: '玄幻升级',
    description: '经典东方玄幻，废柴逆袭，功法修炼，境界突破。适合起点/番茄男频长篇。',
    category: '玄幻',
    suggestedTotalChapters: 200,
    suggestedMinWords: 2500,
    bible: `# 世界观

## 力量体系
修炼境界：炼气 → 筑基 → 金丹 → 元婴 → 化神 → 炼虚 → 合体 → 大乘 → 渡劫
每境九层，突破需感悟天地法则或服用丹药。

## 地理
天玄大陆，分为东、西、南、北四大域。各域由不同宗门掌控。

## 势力
- 天剑宗：东域第一宗门，以剑修闻名
- 万药谷：南域丹药世家
- 魔渊：大陆禁地，魔修聚集之地

## 规则
- 修炼需要灵石/灵药辅助
- 境界越高，寿元越长
- 渡劫失败则形神俱灭

# 主角设定
姓名：[待定]
背景：家族没落的少年，被视为废材，实则体内封印着远古血脉
金手指：神秘传承/老爷爷/系统
性格：坚韧隐忍，有仇必报，不圣母

# 核心卖点
1. 废柴逆袭的爽感
2. 境界突破的期待感
3. 装逼打脸的快感
4. 神秘传承的探索感

# 追读节奏
- 黄金三章：穿越/觉醒 → 展现金手指 → 第一次打脸
- 每5章一个小高潮
- 每30-50章一个大境界突破
- 章末必须有钩子`,
    outlineTemplate: {
      mainGoal: '废柴少年觉醒远古血脉，一步步修炼到大陆巅峰，揭开身世之谜',
      milestones: ['觉醒血脉', '拜入宗门', '金丹突破', '元婴突破', '发现身世', '渡劫飞升'],
      volumes: [
        { title: '第一卷 废柴崛起', startChapter: 1, endChapter: 50, goal: '觉醒金手指，完成第一次逆袭', conflict: '家族欺压与同龄人嘲讽' },
        { title: '第二卷 宗门风云', startChapter: 51, endChapter: 100, goal: '拜入宗门，在弟子大比中崭露头角', conflict: '宗门内部派系斗争' },
        { title: '第三卷 金丹大道', startChapter: 101, endChapter: 150, goal: '突破金丹，探索秘境获得传承', conflict: '秘境争夺与魔修入侵' },
      ],
    },
  },
  {
    id: 'urban-system',
    name: '都市系统',
    description: '现代都市背景，主角获得系统/异能，在都市中崛起。适合轻松爽文路线。',
    category: '都市',
    suggestedTotalChapters: 150,
    suggestedMinWords: 2000,
    bible: `# 世界观

## 时代背景
现代都市，表面是普通人类社会，暗面存在异能者/修真者/古武世家。
主角是普通人，获得神秘系统后开始逆袭。

## 系统设定
- 签到系统：每日签到获得奖励（金钱/技能/属性点）
- 任务系统：完成系统任务获得特殊奖励
- 商城系统：用积分兑换物品和能力
- 升级条件：完成特定任务或消费积分

## 核心规则
- 系统来源是谜，后期揭晓
- 普通人不知道异能者存在
- 异能者有官方管理组织

# 主角设定
姓名：[待定]
背景：普通大学生/上班族，被女友抛弃/被人看不起
金手指：神秘系统
性格：前期低调发育，后期张扬装逼，有底线

# 核心卖点
1. 签到升级的即时满足感
2. 打脸前任/恶人的爽感
3. 低调装逼的期待感
4. 系统/异能的探索感

# 追读节奏
- 黄金三章：获得系统 → 第一次签到奖励 → 打脸恶人
- 每章一个签到或任务奖励
- 章末钩子：新任务/新危机/新奖励预告`,
    outlineTemplate: {
      mainGoal: '普通人获得神秘系统，在都市中崛起，最终揭开系统背后的真相',
      milestones: ['获得系统', '第一次暴富', '发现异能世界', '加入管理组织', '系统觉醒', '揭开真相'],
      volumes: [
        { title: '第一卷 系统降临', startChapter: 1, endChapter: 40, goal: '获得系统，完成财富自由初阶', conflict: '前任与职场欺压' },
        { title: '第二卷 异能觉醒', startChapter: 41, endChapter: 80, goal: '发现异能世界，加入管理组织', conflict: '异能者世界的规则与危险' },
        { title: '第三卷 都市争霸', startChapter: 81, endChapter: 120, goal: '成为都市顶级存在', conflict: '敌对势力与系统真相' },
      ],
    },
  },
  {
    id: 'ancient-romance',
    name: '古言宅斗',
    description: '古代世家宅院，女主重生/穿越，宅斗权谋与情感纠葛。适合女频长篇。',
    category: '古言',
    suggestedTotalChapters: 180,
    suggestedMinWords: 2200,
    bible: `# 世界观

## 时代背景
架空王朝，参考唐宋制度。世家大族林立，门第观念极重。
女主重生/穿越到不受宠的嫡女/庶女身上，需要在宅门中生存并崛起。

## 社会规则
- 嫡庶有别，嫡女地位远高于庶女
- 婚姻是家族联姻的工具
- 后宅争斗：婆媳、妯娌、妻妾
- 女子出家门难，但可以通过经营铺子/结交贵人获得影响力

## 核心设定
- 女主重生带有前世记忆，知道反派阴谋
- 男主是权贵/将军/王爷，表面冷酷实则深情
- 反派是继母/庶妹/白莲花

# 主角设定
姓名：[待定]
背景：世家嫡女/庶女，前世被害死，重生后决心不再重蹈覆辙
金手指：前世记忆 + 现代思维
性格：外柔内刚，谋定后动，不圣母不狠毒

# 核心卖点
1. 重生逆袭的爽感（前世仇人这次要付出代价）
2. 宅斗智斗的紧张感
3. 男女主感情的期待感
4. 经营养铺子/势力的成就感

# 追读节奏
- 黄金三章：重生觉醒 → 展现不同 → 第一次化解危机
- 每3-5章一个小宅斗回合
- 章末钩子：新阴谋/新危机/感情进展`,
    outlineTemplate: {
      mainGoal: '重生嫡女在宅门中步步为营，最终扳倒反派，收获爱情与地位',
      milestones: ['重生觉醒', '化解第一次危机', '经营产业', '男女主相遇', '扳倒继母', '大婚掌权'],
      volumes: [
        { title: '第一卷 重生归来', startChapter: 1, endChapter: 50, goal: '重生后站稳脚跟，化解初危机', conflict: '继母与庶妹的算计' },
        { title: '第二卷 宅门风云', startChapter: 51, endChapter: 100, goal: '经营产业，结交贵人，与男主相认', conflict: '家族内部与外部势力的博弈' },
        { title: '第三卷 执掌中馈', startChapter: 101, endChapter: 150, goal: '扳倒反派，大婚掌权', conflict: '最终决战与情感归宿' },
      ],
    },
  },
];

export function getTemplateById(id: string): GenreTemplate | undefined {
  return GENRE_TEMPLATES.find((t) => t.id === id);
}
