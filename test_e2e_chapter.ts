/**
 * 端到端章节生成测试
 * 从生产 D1 导出的数据测试重构后的 writeEnhancedChapter
 *
 * Usage: npx tsx test_e2e_chapter.ts
 */
import fs from 'node:fs/promises';
import { writeEnhancedChapter } from './src/enhancedChapterEngine.js';
import type { AIConfig } from './src/services/aiClient.js';
import {
  buildEnhancedOutlineFromChapterContext,
  getOutlineChapterContext,
  normalizeNovelOutline,
} from './src/utils/outline.js';

function extractD1Results(raw: any): any[] {
  if (Array.isArray(raw)) return raw[0]?.results ?? [];
  return raw?.result?.[0]?.results ?? raw?.results ?? [];
}

async function loadD1Export(path: string): Promise<any[]> {
  const raw = JSON.parse(await fs.readFile(path, 'utf-8'));
  return extractD1Results(raw);
}

async function main() {
  console.log('=== 端到端章节生成测试 (重构后) ===\n');

  // 1. AI Config - 生产环境配置: DeepSeek-V3 on 白山智算
  const aiConfig: AIConfig = {
    provider: 'custom-1772719742120',
    model: 'DeepSeek-V3',
    apiKey: 'sk-ln8DQygJDI3EgNCB202045A900Ef41Cf99D829653fA25911',
    baseUrl: 'https://api.edgefn.net/v1',
  };

  // 2. Load exported data
  const [stateRows, outlineRows, chapterRows, charRows] = await Promise.all([
    loadD1Export('/tmp/nc_test_state.json'),
    loadD1Export('/tmp/nc_test_outline.json'),
    loadD1Export('/tmp/nc_test_chapters.json'),
    loadD1Export('/tmp/nc_test_chars.json'),
  ]);

  const state = stateRows[0];
  const outlineRaw = outlineRows[0]?.outline_json ? JSON.parse(outlineRows[0].outline_json) : null;
  const characters = charRows[0]?.characters_json ? JSON.parse(charRows[0].characters_json) : undefined;
  const lastChapters = chapterRows
    .sort((a: any, b: any) => a.chapter_index - b.chapter_index)
    .map((r: any) => r.content);

  const chapterIndex = state.next_chapter_index; // 71
  const totalChapters = outlineRaw?.totalChapters ?? 300;
  const bible = state.bible;
  const rollingSummary = state.rolling_summary || '';
  const openLoops: string[] = JSON.parse(state.open_loops || '[]');

  console.log(`项目: 疯了吧！你管这叫F级收破烂职业？`);
  console.log(`章节: 第${chapterIndex}章 / 共${totalChapters}章`);
  console.log(`Bible: ${bible.length} 字`);
  console.log(`摘要: ${rollingSummary.length} 字`);
  console.log(`前文: ${lastChapters.length} 章 (${lastChapters.map((c: string) => c.length + '字').join(', ')})`);
  console.log(`大纲: ${outlineRaw ? '有' : '无'}`);
  console.log(`角色: ${characters ? '有' : '无'}`);
  console.log(`AI: ${aiConfig.provider} / ${aiConfig.model}`);
  console.log('');

  // 3. Build outline context
  const outline = outlineRaw ? normalizeNovelOutline(outlineRaw, {
    fallbackMinChapterWords: 2500,
    fallbackTotalChapters: totalChapters,
  }) : null;
  const outlineContext = getOutlineChapterContext(outline, chapterIndex);
  const enhancedOutline = outlineContext
    ? buildEnhancedOutlineFromChapterContext(outlineContext)
    : undefined;

  let chapterGoalHint: string | undefined;
  let chapterTitle: string | undefined;
  if (outlineContext) {
    chapterTitle = outlineContext.chapter.title;
    chapterGoalHint = `【章节大纲】\n- 标题: ${outlineContext.chapter.title}\n- 目标: ${outlineContext.chapter.goal}\n- 章末钩子: ${outlineContext.chapter.hook}`;
    console.log(`大纲标题: ${chapterTitle}`);
    console.log(`大纲目标: ${outlineContext.chapter.goal}`);
    console.log('');
  }

  // 4. Generate!
  console.log('--- 开始生成 ---\n');
  const startTime = Date.now();

  try {
    const result = await writeEnhancedChapter({
      aiConfig,
      bible,
      rollingSummary,
      openLoops,
      lastChapters,
      chapterIndex,
      totalChapters,
      minChapterWords: 2500,
      chapterGoalHint,
      chapterTitle,
      enhancedOutline,
      characters,
      chapterPromptProfile: state.chapter_prompt_profile || 'web_novel_light',
      chapterPromptCustom: state.chapter_prompt_custom || '',
      enableContextOptimization: true,
      skipSummaryUpdate: false,
      onProgress: (message, status) => {
        console.log(`  [${status || 'progress'}] ${message}`);
      },
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n--- 生成完成 ---\n');
    console.log(`耗时: ${elapsed}s (正文: ${(result.generationDurationMs / 1000).toFixed(1)}s, 摘要: ${(result.summaryDurationMs / 1000).toFixed(1)}s)`);
    console.log(`AI 调用: ${result.diagnostics.aiCallCount} 次`);
    console.log(`正文字数: ${result.chapterText.length}`);
    console.log(`摘要更新: ${result.skippedSummary ? '跳过' : '已更新'}`);
    console.log(`QC: ${result.qcResult ? `${result.qcResult.passed ? '通过' : '未通过'} (${result.qcResult.score})` : '未执行'}`);
    console.log(`重写: ${result.wasRewritten ? `是 (${result.rewriteCount}次)` : '否'}`);

    // Print first 500 chars of chapter
    console.log('\n--- 章节预览 (前500字) ---\n');
    console.log(result.chapterText.slice(0, 500));
    console.log('\n--- 章节结尾 (后300字) ---\n');
    console.log(result.chapterText.slice(-300));

    // Save full output
    await fs.writeFile('/tmp/nc_test_output.txt', result.chapterText, 'utf-8');
    console.log('\n完整章节已保存到: /tmp/nc_test_output.txt');

    // Diagnostics
    console.log('\n--- 诊断信息 ---');
    const d = result.diagnostics;
    console.log(`阶段耗时: ctx=${(d.phaseDurationsMs.contextBuild/1000).toFixed(1)}s, plan=${(d.phaseDurationsMs.planning/1000).toFixed(1)}s, draft=${(d.phaseDurationsMs.mainDraft/1000).toFixed(1)}s, summary=${(d.phaseDurationsMs.summary/1000).toFixed(1)}s`);
    if (d.aiCallTraces.length > 0) {
      console.log('AI 调用链:');
      for (const t of d.aiCallTraces) {
        console.log(`  [${t.phase}] ${t.provider}/${t.model} ${(t.durationMs/1000).toFixed(1)}s in=${t.estimatedPromptTokens}tok out=${t.estimatedOutputTokens}tok${t.error ? ' ERR=' + t.error.slice(0, 60) : ''}`);
      }
    }
  } catch (err) {
    console.error('\n生成失败:', err);
    process.exit(1);
  }
}

main();
