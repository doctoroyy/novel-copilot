import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 书籍状态
 */
export type BookState = {
  /** 书名 */
  bookTitle: string;
  /** 计划总章数 */
  totalChapters: number;
  /** 下一章索引 (从 1 开始) */
  nextChapterIndex: number;
  /** 滚动剧情摘要 (800~1500 字) */
  rollingSummary: string;
  /** 未解伏笔/悬念 (最多 12 条) */
  openLoops: string[];
  /** 是否需要人工介入 */
  needHuman?: boolean;
  /** 人工介入原因 */
  needHumanReason?: string;
};

/**
 * 确保书籍项目目录存在，如果 state.json 不存在则初始化
 */
export async function ensureBook(
  projectDir: string,
  defaults?: Partial<BookState>
): Promise<void> {
  // 创建章节目录
  await fs.mkdir(path.join(projectDir, 'chapters'), { recursive: true });

  const statePath = path.join(projectDir, 'state.json');

  try {
    await fs.access(statePath);
  } catch {
    // state.json 不存在，创建初始状态
    const init: BookState = {
      bookTitle: defaults?.bookTitle ?? path.basename(projectDir),
      totalChapters: defaults?.totalChapters ?? 80,
      nextChapterIndex: defaults?.nextChapterIndex ?? 1,
      rollingSummary: defaults?.rollingSummary ?? '',
      openLoops: defaults?.openLoops ?? [],
    };
    await fs.writeFile(statePath, JSON.stringify(init, null, 2), 'utf-8');
  }
}

/**
 * 读取书籍状态
 */
export async function readState(projectDir: string): Promise<BookState> {
  const statePath = path.join(projectDir, 'state.json');
  const raw = await fs.readFile(statePath, 'utf-8');
  return JSON.parse(raw) as BookState;
}

/**
 * 写入书籍状态
 */
export async function writeState(projectDir: string, state: BookState): Promise<void> {
  const statePath = path.join(projectDir, 'state.json');
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * 读取 Story Bible (长期设定)
 */
export async function readBible(projectDir: string): Promise<string> {
  const biblePath = path.join(projectDir, 'bible.md');
  try {
    return await fs.readFile(biblePath, 'utf-8');
  } catch {
    throw new Error(`Story Bible not found: ${biblePath}`);
  }
}

/**
 * 读取最近 N 章原文
 */
export async function readLastChapters(projectDir: string, n: number): Promise<string[]> {
  const chaptersDir = path.join(projectDir, 'chapters');

  let files: string[];
  try {
    files = await fs.readdir(chaptersDir);
  } catch {
    return [];
  }

  // 按章节号排序 (001.md, 002.md, ...)
  const chapterFiles = files
    .filter((f) => /^\d{3}\.md$/.test(f))
    .sort();

  // 取最后 N 个
  const lastFiles = chapterFiles.slice(Math.max(0, chapterFiles.length - n));

  const texts: string[] = [];
  for (const f of lastFiles) {
    const content = await fs.readFile(path.join(chaptersDir, f), 'utf-8');
    texts.push(content);
  }

  return texts;
}

/**
 * 保存章节
 */
export async function saveChapter(
  projectDir: string,
  index: number,
  text: string
): Promise<string> {
  const chaptersDir = path.join(projectDir, 'chapters');
  const filename = `${String(index).padStart(3, '0')}.md`;
  const filepath = path.join(chaptersDir, filename);
  await fs.writeFile(filepath, text, 'utf-8');
  return filepath;
}

/**
 * 获取所有书籍项目目录
 */
export async function listProjects(projectsDir: string): Promise<string[]> {
  const entries = await fs.readdir(projectsDir, { withFileTypes: true });
  const projects: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const projectPath = path.join(projectsDir, entry.name);
      // 检查是否有 bible.md
      try {
        await fs.access(path.join(projectPath, 'bible.md'));
        projects.push(projectPath);
      } catch {
        // 不是有效项目，跳过
      }
    }
  }

  return projects;
}
