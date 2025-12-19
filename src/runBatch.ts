import path from 'node:path';
import 'dotenv/config';
import { listProjects, readState } from './memory.js';
import { runOneBook } from './runOneBook.js';
import type { AIConfig } from './services/aiClient.js';

/**
 * 批量运行参数
 */
type BatchOptions = {
  /** AI 配置 */
  aiConfig: AIConfig;
  /** 项目根目录 */
  projectsDir: string;
  /** 每本书生成的章节数 */
  chaptersPerBook?: number;
  /** 书籍间延迟 (毫秒) */
  delayBetweenBooks?: number;
};

/**
 * 批量运行多本书
 * 策略：轮流生成，每本书一章
 */
export async function runBatch(options: BatchOptions): Promise<void> {
  const {
    aiConfig,
    projectsDir,
    chaptersPerBook = 1,
    delayBetweenBooks = 5000,
  } = options;

  console.log('='.repeat(50));
  console.log('📖 Novel Automation Agent - Batch Mode');
  console.log(`   Provider: ${aiConfig.provider}`);
  console.log(`   Model: ${aiConfig.model}`);
  console.log('='.repeat(50));

  // 获取所有项目
  const projects = await listProjects(projectsDir);

  if (projects.length === 0) {
    console.log('❌ 没有找到有效的项目 (需要包含 bible.md)');
    return;
  }

  console.log(`\n找到 ${projects.length} 个项目:`);
  for (const p of projects) {
    const state = await readState(p);
    const status = state.needHuman
      ? '⚠️ 需要人工'
      : state.nextChapterIndex > state.totalChapters
      ? '✅ 已完成'
      : `📝 ${state.nextChapterIndex - 1}/${state.totalChapters}`;
    console.log(`  - ${path.basename(p)}: ${status}`);
  }

  // 过滤出可以继续的项目
  const activeProjects: string[] = [];
  for (const p of projects) {
    const state = await readState(p);
    if (!state.needHuman && state.nextChapterIndex <= state.totalChapters) {
      activeProjects.push(p);
    }
  }

  if (activeProjects.length === 0) {
    console.log('\n没有需要处理的项目');
    return;
  }

  console.log(`\n将处理 ${activeProjects.length} 个活跃项目，每本生成 ${chaptersPerBook} 章`);

  // 轮流生成
  for (let round = 0; round < chaptersPerBook; round++) {
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`Round ${round + 1}/${chaptersPerBook}`);
    console.log(`${'─'.repeat(40)}`);

    for (let i = 0; i < activeProjects.length; i++) {
      const projectDir = activeProjects[i];

      try {
        await runOneBook({
          aiConfig,
          projectDir,
          chaptersToGenerate: 1,
        });
      } catch (error) {
        console.error(`跳过项目 ${path.basename(projectDir)}: ${(error as Error).message}`);
      }

      // 书籍间延迟
      if (i < activeProjects.length - 1) {
        console.log(`\n⏳ 等待 ${delayBetweenBooks / 1000} 秒后处理下一本...`);
        await sleep(delayBetweenBooks);
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('✅ 批量处理完成!');
  console.log('='.repeat(50));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// CLI 入口
async function main() {
  // Read AI config from environment variables
  const aiConfig: AIConfig = {
    provider: (process.env.AI_PROVIDER || 'gemini') as AIConfig['provider'],
    model: process.env.AI_MODEL || process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
    apiKey: process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '',
    baseUrl: process.env.AI_BASE_URL,
  };

  if (!aiConfig.apiKey) {
    console.error('❌ Missing AI_API_KEY or GEMINI_API_KEY environment variable');
    process.exit(1);
  }

  const projectsDir = process.argv[2] || path.join(process.cwd(), 'projects');
  const chaptersPerBook = parseInt(process.argv[3] || '1', 10);

  await runBatch({
    aiConfig,
    projectsDir,
    chaptersPerBook,
  });
}

main().catch((err) => {
  console.error('\n❌ 批量运行失败:', err);
  process.exit(1);
});
