import path from 'node:path';
import 'dotenv/config';
import {
  ensureBook,
  readBible,
  readLastChapters,
  readState,
  saveChapter,
  writeState,
} from './memory.js';
import { writeOneChapter } from './generateChapter.js';
import { readOutline, getChapterOutline } from './generateOutline.js';
import type { AIConfig } from './aiClient.js';

/**
 * 运行参数
 */
type RunOptions = {
  /** AI 配置 */
  aiConfig: AIConfig;
  /** 项目目录 */
  projectDir: string;
  /** 生成章节数 (默认 1) */
  chaptersToGenerate?: number;
  /** 章节间延迟 (毫秒) */
  delayBetweenChapters?: number;
};

/**
 * 运行一本书的章节生成
 */
export async function runOneBook(options: RunOptions): Promise<void> {
  const {
    aiConfig,
    projectDir,
    chaptersToGenerate = 1,
    delayBetweenChapters = 2000,
  } = options;

  console.log(`\n📚 开始处理: ${path.basename(projectDir)}`);

  // 确保项目目录存在
  await ensureBook(projectDir);

  // 读取配置
  const bible = await readBible(projectDir);
  let state = await readState(projectDir);

  // 尝试读取大纲（如果存在）
  const outline = await readOutline(projectDir);
  if (outline) {
    console.log(`   📋 已加载大纲: ${outline.totalChapters} 章 / ${outline.targetWordCount} 万字`);
  }

  console.log(`   总章数: ${state.totalChapters}, 当前进度: ${state.nextChapterIndex - 1}/${state.totalChapters}`);

  // 检查是否需要人工介入
  if (state.needHuman) {
    console.log(`❌ 该书需要人工介入: ${state.needHumanReason}`);
    return;
  }

  // 检查是否已完成
  if (state.nextChapterIndex > state.totalChapters) {
    console.log(`✅ 该书已完成!`);
    return;
  }

  // 生成指定数量的章节
  for (let i = 0; i < chaptersToGenerate; i++) {
    const chapterIndex = state.nextChapterIndex;

    // 再次检查是否已完成
    if (chapterIndex > state.totalChapters) {
      console.log(`✅ 该书已完成!`);
      break;
    }

    console.log(`\n📝 生成第 ${chapterIndex}/${state.totalChapters} 章...`);

    // 读取最近章节
    const lastChapters = await readLastChapters(projectDir, 2);

    // 构建章节目标提示（如果有大纲）
    let chapterGoalHint: string | undefined;
    if (outline) {
      const chapterOutline = getChapterOutline(outline, chapterIndex);
      if (chapterOutline) {
        chapterGoalHint = `【章节大纲】
- 标题: ${chapterOutline.title}
- 目标: ${chapterOutline.goal}
- 章末钩子: ${chapterOutline.hook}

请按照大纲完成本章，但允许适当扩展和细化。`;
        console.log(`   📋 使用大纲: ${chapterOutline.title}`);
      }
    }

    try {
      // 生成章节
      const result = await writeOneChapter({
        aiConfig,
        bible,
        rollingSummary: state.rollingSummary,
        openLoops: state.openLoops,
        lastChapters,
        chapterIndex,
        totalChapters: state.totalChapters,
        chapterGoalHint,
      });

      // 保存章节
      const chapterPath = await saveChapter(projectDir, chapterIndex, result.chapterText);
      console.log(`   ✅ 已保存: ${path.basename(chapterPath)}`);

      if (result.wasRewritten) {
        console.log(`   ⚠️ 触发了 ${result.rewriteCount} 次重写`);
      }

      // 更新状态
      state = {
        ...state,
        nextChapterIndex: chapterIndex + 1,
        rollingSummary: result.updatedSummary,
        openLoops: result.updatedOpenLoops,
      };

      await writeState(projectDir, state);

      // 章节间延迟
      if (i < chaptersToGenerate - 1 && chapterIndex < state.totalChapters) {
        console.log(`   ⏳ 等待 ${delayBetweenChapters / 1000} 秒...`);
        await sleep(delayBetweenChapters);
      }
    } catch (error) {
      console.error(`   ❌ 生成失败:`, error);

      // 标记需要人工介入
      state.needHuman = true;
      state.needHumanReason = `第 ${chapterIndex} 章生成失败: ${(error as Error).message}`;
      await writeState(projectDir, state);

      throw error;
    }
  }

  console.log(`\n✅ 完成! 当前进度: ${state.nextChapterIndex - 1}/${state.totalChapters}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// CLI 入口 - 只在直接执行时运行
const isMain = import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  // Read AI config from environment variables
  const aiConfig: AIConfig = {
    provider: (process.env.AI_PROVIDER || 'gemini') as AIConfig['provider'],
    model: process.env.AI_MODEL || process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    apiKey: process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '',
    baseUrl: process.env.AI_BASE_URL,
  };

  if (!aiConfig.apiKey) {
    console.error('❌ Missing AI_API_KEY or GEMINI_API_KEY environment variable');
    process.exit(1);
  }

  const projectDir = process.argv[2] || path.join(process.cwd(), 'projects', 'demo-book');
  const chaptersToGenerate = parseInt(process.argv[3] || '1', 10);

  console.log('='.repeat(50));
  console.log('📖 Novel Automation Agent');
  console.log(`   Provider: ${aiConfig.provider}`);
  console.log(`   Model: ${aiConfig.model}`);
  console.log('='.repeat(50));

  runOneBook({
    aiConfig,
    projectDir,
    chaptersToGenerate,
  }).catch((err) => {
    console.error('\n❌ 运行失败:', err);
    process.exit(1);
  });
}
