import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { generateText, type AIConfig } from '../services/aiClient.js';
import {
  getAIConfig,
  isGeminiLikeConfig,
  isLocationUnsupportedError,
  formatGenerationError,
  getNonGeminiFallbackAIConfig,
} from '../services/aiConfigResolver.js';
import {
  getImagineTemplateSnapshot,
  listImagineTemplateSnapshotDates,
  resolveImagineTemplateById,
  type ImagineTemplate,
} from '../services/imagineTemplateService.js';
import {
  createImagineTemplateRefreshJob,
  enqueueImagineTemplateRefreshJob,
  getImagineTemplateRefreshJob,
  listImagineTemplateRefreshJobs,
} from '../services/imagineTemplateJobService.js';

export const bibleRoutes = new Hono<{ Bindings: Env }>();

function mergeKeywordInput(rawKeywords: string, template?: ImagineTemplate): string {
  const list = [
    ...rawKeywords.split(/[、,，;；|]/).map((entry) => entry.trim()).filter(Boolean),
    ...(template?.keywords || []),
  ];
  return [...new Set(list)].slice(0, 12).join('、');
}

function formatTemplateHint(template: ImagineTemplate | null, snapshotDate?: string): string {
  if (!template) return '';

  return `【热点模板参考${snapshotDate ? ` (${snapshotDate})` : ''}】
- 模板名: ${template.name}
- 类型: ${template.genre}
- 核心主题: ${template.coreTheme}
- 一句话卖点: ${template.oneLineSellingPoint}
- 关键词: ${(template.keywords || []).join('、')}
- 主角设定: ${template.protagonistSetup}
- 开篇钩子: ${template.hookDesign}
- 冲突设计: ${template.conflictDesign}
- 成长路线: ${template.growthRoute}
- 平台信号: ${(template.fanqieSignals || []).join('、')}
- 开篇建议: ${template.recommendedOpening}
- 参考热点书名: ${(template.sourceBooks || []).join('、')}`;
}

// Bible templates
bibleRoutes.get('/bible-templates', async (c) => {
  const snapshotDate = c.req.query('snapshotDate') || c.req.query('date');
  const selectedSnapshot = await getImagineTemplateSnapshot(c.env.DB, snapshotDate || undefined);
  const dates = await listImagineTemplateSnapshotDates(c.env.DB, 60);

  return c.json({
    success: true,
    snapshotDate: selectedSnapshot?.snapshotDate || null,
    templates: selectedSnapshot?.templates || [],
    ranking: selectedSnapshot?.ranking || [],
    status: selectedSnapshot?.status || null,
    errorMessage: selectedSnapshot?.errorMessage || null,
    availableSnapshots: dates,
  });
});

bibleRoutes.post('/bible-templates/refresh', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const snapshotDate = typeof body.snapshotDate === 'string' ? body.snapshotDate : undefined;
  const force = body.force === undefined ? true : Boolean(body.force);
  const userId = c.get('userId');

  const { job, created } = await createImagineTemplateRefreshJob(c.env.DB, {
    snapshotDate,
    force,
    requestedByUserId: userId || null,
    requestedByRole: 'user',
    source: 'manual',
  });

  await enqueueImagineTemplateRefreshJob({
    env: c.env,
    jobId: job.id,
    executionCtx: c.executionCtx,
  });

  return c.json({
    success: true,
    queued: true,
    created,
    job,
  });
});

bibleRoutes.get('/bible-templates/refresh-jobs/:id', async (c) => {
  const jobId = c.req.param('id');
  const job = await getImagineTemplateRefreshJob(c.env.DB, jobId);

  if (!job) {
    return c.json({ success: false, error: 'Template refresh job not found' }, 404);
  }

  return c.json({
    success: true,
    job,
  });
});

bibleRoutes.get('/bible-templates/refresh-jobs', async (c) => {
  const userId = c.get('userId');
  const limitRaw = Number.parseInt(c.req.query('limit') || '10', 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 10;

  const jobs = await listImagineTemplateRefreshJobs(c.env.DB, {
    requestedByUserId: userId || undefined,
    limit,
  });

  return c.json({
    success: true,
    jobs,
  });
});

// Generate bible
bibleRoutes.post('/generate-bible', async (c) => {
  const aiConfig = await getAIConfig(c, c.env.DB, 'generate_outline');

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    const body = await c.req.json().catch(() => ({} as any));
    const genreInput = typeof body.genre === 'string' ? body.genre.trim() : '';
    const themeInput = typeof body.theme === 'string' ? body.theme.trim() : '';
    const keywordsInput = typeof body.keywords === 'string' ? body.keywords.trim() : '';
    const templateId = typeof body.templateId === 'string' ? body.templateId.trim() : '';
    const templateSnapshotDate = typeof body.templateSnapshotDate === 'string' ? body.templateSnapshotDate.trim() : '';

    const bodyTemplate = body.template && typeof body.template === 'object'
      ? body.template as ImagineTemplate
      : null;

    let resolvedTemplate: ImagineTemplate | null = bodyTemplate;
    let resolvedTemplateDate: string | undefined;

    if (!resolvedTemplate && templateId) {
      const resolved = await resolveImagineTemplateById(
        c.env.DB,
        templateId,
        templateSnapshotDate || undefined
      );
      if (resolved) {
        resolvedTemplate = resolved.template;
        resolvedTemplateDate = resolved.snapshotDate;
      }
    }

    const genre = genreInput || resolvedTemplate?.genre || '';
    const theme = themeInput || resolvedTemplate?.coreTheme || '';
    const keywords = mergeKeywordInput(keywordsInput, resolvedTemplate || undefined);

    // Genre-specific templates for better quality
    const genreTemplates: Record<string, string> = {
      '都市重生': `
【类型特点】都市重生文，主角带着前世记忆重生，利用信息差和先知优势逆袭。
【核心爽点】打脸装逼、商战逆袭、弥补遗憾、复仇雪恨、把握机遇。
【金手指建议】重生记忆、系统辅助、空间储物、前世技能传承。
【注意事项】时代背景要有年代感（如90年代），要有大量可利用的历史机遇（房产、股票、互联网）。`,
      '玄幻修仙': `
【类型特点】东方玄幻修仙文，主角在修仙世界从废材崛起，踏上巅峰之路。
【核心爽点】逆天改命、越级挑战、获得机缘、实力碾压、悟道突破。
【金手指建议】特殊体质、神秘传承、系统面板、时间加速修炼、因果反馈。
【注意事项】力量体系要清晰（如练气-筑基-金丹-元婴），要有宗门势力等级划分。`,
      '系统流': `
【类型特点】系统流文，主角获得特殊系统，通过完成任务获得奖励升级。
【核心爽点】任务奖励、签到福利、抽奖开箱、属性加点、技能解锁。
【金手指建议】任务系统、商城系统、抽奖系统、签到系统、成就系统。
【注意事项】系统规则要明确，奖励要有吸引力但不能太超模，要有成长曲线。`,
      '都市异能': `
【类型特点】都市异能文，主角在现代都市获得超凡能力，游走于普通人与异能世界之间。
【核心爽点】实力碾压、身份反转、拯救美人、惩恶扬善、逐步揭秘。
【金手指建议】异能觉醒、血脉传承、神器认主、空间能力、时间能力。
【注意事项】要平衡日常与战斗，异能世界设定要有层次感。`,
      '无敌流': `
【类型特点】无敌流爽文，主角从一开始就拥有绝对实力，横扫一切障碍。
【核心爽点】一拳秒杀、装弱扮猪吃虎、震惊全场、身份曝光、实力展示。
【金手指建议】无限复活、绝对防御、一击必杀、时间静止、规则掌控。
【注意事项】不能只靠战力，要有情感线、成长线（心境成长）、谜团揭示。`,
    };

    const genreTemplate = genre && genreTemplates[genre] ? genreTemplates[genre] : '';
    const templateHint = formatTemplateHint(resolvedTemplate, resolvedTemplateDate || templateSnapshotDate || undefined);

    const system = `你是一个**番茄/起点爆款网文策划专家**，精通读者心理和平台推荐算法。

你的任务是生成一个**极具吸引力**的 Story Bible，它将直接决定这本书能否获得流量。

【硬性要求】
1. 必须设计至少 3 个明确的"读者爽点"（打脸、逆袭、升级、复仇、装逼等）
2. 必须有独特且有成长空间的金手指/系统设计
3. 必须有能在前 100 字抓住读者的"开篇钩子"设计
4. 主角必须有强烈的行动动机（复仇、保护、证明自己等）
5. 要有清晰的力量体系/社会阶层，让读者能感受到主角的攀升

【输出格式 - Markdown】

# 《书名》

## 一句话卖点
（30字内，能让读者立刻想点进去的核心吸引力）

## 核心爽点设计
1. 爽点一：（描述 + 预计出现时机）
2. 爽点二：（描述 + 预计出现时机）
3. 爽点三：（描述 + 预计出现时机）

## 主角设定
- 姓名：
- 身份/职业：
- 前世/背景：
- 性格特点：
- 核心动机：（什么驱动他不断前进？）
- 金手指/系统：（详细描述能力、限制、成长空间）

## 配角矩阵
### 助力型配角
1. 配角A：（身份、与主角关系、作用）
### 反派/竞争者
1. 反派A：（身份、与主角的冲突、结局预期）

## 力量体系/社会阶层
（从最底层到最顶层的"天梯"设计，让读者能感受到主角的攀升路径）

## 世界观设定
（简洁但完整的世界背景）

## 主线剧情节点
1. 开篇危机：（第1-5章，主角遭遇什么困境？如何激发读者同情/好奇？）
2. 金手指觉醒：（主角如何获得能力？第一次使用的震撼感）
3. 第一次打脸：（谁看不起主角？主角如何证明自己？）
4. 中期高潮：（更大的挑战和更强的敌人）
5. 低谷转折：（主角遭遇挫折，如何逆转？）
6. 终极对决：（最终boss和主线冲突的解决）

## 开篇钩子设计
（第一章前100字应该怎么写？用什么场景/冲突/悬念抓住读者？给出具体的开篇思路）`;

    const prompt = `请为以下网文生成 Story Bible：

【用户需求】
${genre ? `- 类型: ${genre}` : '- 类型: 未指定，请根据主题推断最适合的类型'}
${theme ? `- 主题/核心创意: ${theme}` : ''}
${keywords ? `- 关键词/元素: ${keywords}` : ''}

${genreTemplate ? `【类型参考模板】\n${genreTemplate}` : ''}
${templateHint ? `${templateHint}\n` : ''}

请基于以上信息，生成一个**能在番茄获得流量**的完整 Story Bible：`;

    let bible: string;
    let fallbackModelUsed: { provider: string; model: string } | null = null;

    try {
      bible = await generateText(aiConfig, { system, prompt, temperature: 0.9 });
    } catch (primaryError) {
      if (isGeminiLikeConfig(aiConfig) && isLocationUnsupportedError(primaryError)) {
        const fallbackConfig = await getNonGeminiFallbackAIConfig(c.env.DB, aiConfig);
        if (!fallbackConfig) {
          throw new Error(
            '当前默认模型受地区限制，且未找到可用的非 Gemini 备用模型。请在管理员后台配置可用模型。'
          );
        }

        console.warn(
          `[generate-bible] primary model blocked by location, fallback to ${fallbackConfig.provider}/${fallbackConfig.model}`
        );
        bible = await generateText(fallbackConfig, { system, prompt, temperature: 0.9 });
        fallbackModelUsed = {
          provider: String(fallbackConfig.provider || ''),
          model: String(fallbackConfig.model || ''),
        };
      } else {
        throw primaryError;
      }
    }

    return c.json({
      success: true,
      bible,
      fallbackModelUsed,
      templateApplied: resolvedTemplate ? {
        templateId: resolvedTemplate.id,
        templateName: resolvedTemplate.name,
        snapshotDate: resolvedTemplateDate || templateSnapshotDate || null,
      } : null,
    });
  } catch (error) {
    return c.json({ success: false, error: formatGenerationError(error) }, 500);
  }
});
