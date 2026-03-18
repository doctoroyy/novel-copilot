/**
 * E2E 测试：Agent 模式章节生成
 * 用法: npx tsx test_e2e_agent.ts
 */
import { writeChapterWithAgent } from './src/agent/agentChapterEngine.js';
import type { AIConfig } from './src/services/aiClient.js';
import * as fs from 'fs';

const AI_CONFIG: AIConfig = {
  provider: 'custom-1772719742120' as any,
  model: 'DeepSeek-V3',
  apiKey: 'sk-ln8DQygJDI3EgNCB202045A900Ef41Cf99D829653fA25911',
  baseUrl: 'https://api.edgefn.net/v1',
};

async function main() {
  console.log('=== Agent E2E Test ===');
  console.log('Loading test data...');

  const stateData = JSON.parse(fs.readFileSync('/tmp/nc_test_state.json', 'utf-8'));
  const chaptersData = JSON.parse(fs.readFileSync('/tmp/nc_test_chapters.json', 'utf-8'));
  const charsData = JSON.parse(fs.readFileSync('/tmp/nc_test_chars.json', 'utf-8'));

  const state = stateData[0].results[0];
  const chapters = chaptersData[0].results;

  const bible = state.bible;
  const rollingSummary = state.rolling_summary || '';
  const openLoops = (() => {
    try { return JSON.parse(state.open_loops || '[]'); }
    catch { return []; }
  })();

  const chapterIndex = state.next_chapter_index || 71;
  const totalChapters = 400;
  const lastChapters = chapters.map((c: any) => c.content).slice(-2);

  console.log(`Bible: ${bible.length} chars`);
  console.log(`Summary: ${rollingSummary.length} chars`);
  console.log(`Open loops: ${openLoops.length}`);
  console.log(`Chapter index: ${chapterIndex}`);
  console.log(`Last chapters: ${lastChapters.length} (${lastChapters.map((c: string) => c.length + ' chars').join(', ')})`);

  console.log('\nStarting Agent chapter generation...\n');

  const startTime = Date.now();
  const result = await writeChapterWithAgent({
    aiConfig: AI_CONFIG,
    bible,
    rollingSummary,
    openLoops,
    lastChapters,
    chapterIndex,
    totalChapters,
    minChapterWords: 2500,
    chapterPromptProfile: state.chapter_prompt_profile || 'web_novel_light',
    onProgress: (msg, phase) => {
      console.log(`  [${phase}] ${msg}`);
    },
    enableAgentMode: true,
    agentMaxTurns: 6,
    agentMaxAICalls: 12,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n=== Results ===');
  console.log(`Time: ${elapsed}s`);
  console.log(`Chapter length: ${result.chapterText.length} chars`);

  // 字数统计（去标题行）
  const lines = result.chapterText.split('\n');
  const bodyLines = lines.slice(lines.findIndex((l, i) => i > 0 && l.trim().length > 0));
  const bodyText = bodyLines.join('\n');
  const wordCount = bodyText.replace(/\s/g, '').length;
  console.log(`Body word count: ${wordCount} (target: >= 2500)`);
  console.log(`Status: ${wordCount >= 2500 ? 'PASS ✅' : 'FAIL ❌'}`);

  console.log('\n--- Chapter preview (first 500 chars) ---');
  console.log(result.chapterText.slice(0, 500));
  console.log('\n--- Chapter ending (last 300 chars) ---');
  console.log(result.chapterText.slice(-300));

  // Diagnostics
  if (result.diagnostics) {
    console.log('\n--- Diagnostics ---');
    console.log(`AI calls: ${result.diagnostics.aiCallCount}`);
    console.log(`Main draft duration: ${(result.diagnostics.phaseDurationsMs.mainDraft / 1000).toFixed(1)}s`);
    if ((result.diagnostics as any).agentTrace) {
      const trace = (result.diagnostics as any).agentTrace;
      console.log(`Agent turns: ${trace.totalTurns}`);
      console.log(`Agent tool calls: ${trace.totalToolCalls}`);
    }
  }
}

main().catch(console.error);
