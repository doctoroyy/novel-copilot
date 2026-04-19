import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWritingStyle } from './writingStyleHeuristics.js';

const GOOD_CHAPTER = `
张三走进大厅，一眼就看到了李四。

"又是你。"张三皱眉。

"怎么，不欢迎？"李四冷笑。

张三没说话，手摸向腰间。大厅里的人都屏住呼吸。外面的雨下得更大了。

"三天内，把钱交出来。"李四丢下一句话就走了。

门关上的瞬间，张三听到远处传来一声惨叫。他的眼神变了。

这不是李四的声音。是王五的。王五昨天刚答应帮他......难道？

张三冲出门外，雨水打在脸上。巷口那个倒下的身影，让他心里咯噔一下。
`.trim();

const BAD_LONG_SETTING = `
这个世界被称为玄黄大陆，是一片广袤无垠、神秘莫测、蕴含无尽力量的奇异土地。在这片土地上，生活着各种各样的种族，有高贵优雅的精灵，有凶猛彪悍的兽人，有神秘莫测的龙族，有冷酷无情的亡灵，还有占据主导地位的人类。玄黄大陆的历史可以追溯到万年之前，当时诞生了创世神祇九重天尊，他以无上神力开天辟地，创造了日月星辰，创造了山川河流，创造了飞禽走兽，创造了万千生灵。九重天尊坐化之后，大陆进入了漫长的神话时代，无数强者辈出，先后出现了三皇五帝、十二金仙、八十一散仙等等不朽传说。随着时间的流逝，大陆的灵气逐渐稀薄，修炼资源日益匮乏，强者也越来越少，到了如今的凡俗时代，能够踏入元婴期的修士已经寥寥无几，而金仙、大罗金仙这种传说中的存在，早已成为了一个个记载在古籍里的名字。

主角张三出生在玄黄大陆东部一个叫做青云村的小村子里，从小父母双亡，被村里的老铁匠收养。青云村地处偏僻，常年受到附近妖兽的侵扰，村民们只能依靠修炼浅显的锻体功夫来保护自己。张三天资平庸，修炼一年才勉强突破炼体一层，被村里的同龄人嘲笑为"废物"。这种生活一直持续了十几年，直到那一天，一颗流星划破夜空，砸在青云村后山，改变了张三的命运。
`.trim();

const NO_HOOK_ENDING = `
张三起床洗脸吃饭。
"今天又是平淡的一天。"他想。
他走到门口，看到太阳升起来了。
"真是美好的一天。"他自言自语。
他决定去街上走走。街上人很多。他买了个包子。吃完包子，他回家了。
回到家，他躺在床上睡觉。就这样过了一天。
`.trim();

const DRAMA_TONE = `
"哼！尔等竟敢小觑本座？"

"岂非贻笑大方！"

"莫非阁下想要一战？"

张三冷笑："尔等皆是蝼蚁，焉能与吾为敌？休得放肆！"
`.trim();

test('analyzeWritingStyle: 好章节无 blocking', () => {
  const r = analyzeWritingStyle(GOOD_CHAPTER, {
    protagonistAliases: ['张三'],
  });
  assert.equal(r.blockingReasons.length, 0, `不应有 blocking: ${JSON.stringify(r.blockingReasons)}`);
  assert.ok(r.metrics.endingHookScore >= 1, '好章节应检测到钩子');
});

test('analyzeWritingStyle: 长段设定倾泻 → blocking', () => {
  // 单段版（真实网文开篇常见的一整段世界观介绍）
  const singleLongSetting =
    '这个世界被称为玄黄大陆，蕴含无尽力量。'.repeat(60);
  const r = analyzeWritingStyle(singleLongSetting);
  assert.ok(
    r.blockingReasons.some((x) => /设定.*倾泻|无对白长段/.test(x)),
    `应拦截设定倾泻: ${JSON.stringify(r.blockingReasons)}`,
  );
  assert.ok(r.metrics.maxSettingRunChars > 500);
});

test('analyzeWritingStyle: 无钩子结尾 → blocking', () => {
  // 补齐 1500 字触发检测
  const padded = NO_HOOK_ENDING + '张三又睡了一觉。'.repeat(200);
  const r = analyzeWritingStyle(padded);
  assert.ok(
    r.blockingReasons.some((x) => /章末.*钩子/.test(x)),
    `应拦截无钩子: ${JSON.stringify(r.blockingReasons)}`,
  );
});

test('analyzeWritingStyle: 话剧腔 → blocking', () => {
  const r = analyzeWritingStyle(DRAMA_TONE);
  assert.ok(
    r.blockingReasons.some((x) => /话剧腔/.test(x)),
    `应拦截话剧腔: ${JSON.stringify(r.blockingReasons)}`,
  );
});

test('analyzeWritingStyle: metrics 字段正确计算', () => {
  const r = analyzeWritingStyle(GOOD_CHAPTER, { protagonistAliases: ['张三'] });
  assert.ok(r.metrics.bodyChars > 0);
  assert.ok(r.metrics.paragraphCount > 0);
  assert.ok(r.metrics.longSentenceRatio >= 0 && r.metrics.longSentenceRatio <= 1);
  assert.ok(r.metrics.dialoguePercent >= 0 && r.metrics.dialoguePercent <= 1);
  assert.ok(r.metrics.protagonistAgencyScore >= 0 && r.metrics.protagonistAgencyScore <= 1);
});

test('analyzeWritingStyle: isOpeningChapter 时 300 字设定段就触发 review', () => {
  const mediumSetting = '这个世界有一种力量叫做灵气，弥漫在天地之间，修炼者吸纳灵气就能提升实力。'.repeat(10);
  const r = analyzeWritingStyle(mediumSetting, { isOpeningChapter: true });
  assert.ok(
    r.reviewReasons.some((x) => /开篇章.*长段/.test(x)) || r.blockingReasons.length > 0,
    `开篇章应对设定段更严格: ${JSON.stringify({ r: r.reviewReasons, b: r.blockingReasons })}`,
  );
});
