import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  listProjects,
  readState,
  writeState,
  readBible,
  saveChapter,
  ensureBook,
  readLastChapters,
  type BookState,
} from './memory.js';
import { readOutline, generateFullOutline, type NovelOutline } from './generateOutline.js';
import { writeOneChapter } from './generateChapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Projects directory
const PROJECTS_DIR = path.join(process.cwd(), 'projects');

// Helper: ensure projects directory exists
async function ensureProjectsDir() {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
}

// ==================== API Routes ====================

/**
 * GET /api/projects - 获取所有项目列表
 */
app.get('/api/projects', async (req: Request, res: Response) => {
  try {
    await ensureProjectsDir();
    const projects = await listProjects(PROJECTS_DIR);
    
    const projectList = await Promise.all(
      projects.map(async (projectPath) => {
        const name = path.basename(projectPath);
        const state = await readState(projectPath);
        const outline = await readOutline(projectPath);
        
        return {
          name,
          path: projectPath,
          state,
          hasOutline: !!outline,
          outlineSummary: outline ? {
            totalChapters: outline.totalChapters,
            targetWordCount: outline.targetWordCount,
            volumeCount: outline.volumes.length,
            mainGoal: outline.mainGoal,
          } : null,
        };
      })
    );
    
    res.json({ success: true, projects: projectList });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/projects/:name - 获取单个项目详情
 */
app.get('/api/projects/:name', async (req: Request, res: Response) => {
  try {
    const projectPath = path.join(PROJECTS_DIR, req.params.name);
    const state = await readState(projectPath);
    const bible = await readBible(projectPath);
    const outline = await readOutline(projectPath);
    
    // Get generated chapters list
    const chaptersDir = path.join(projectPath, 'chapters');
    let chapters: string[] = [];
    try {
      const files = await fs.readdir(chaptersDir);
      chapters = files.filter(f => /^\d{3}\.md$/.test(f)).sort();
    } catch {
      // No chapters yet
    }
    
    res.json({
      success: true,
      project: {
        name: req.params.name,
        path: projectPath,
        state,
        bible,
        outline,
        chapters,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/projects - 创建新项目
 */
app.post('/api/projects', async (req: Request, res: Response) => {
  try {
    const { name, bible, totalChapters = 400 } = req.body;
    
    if (!name || !bible) {
      return res.status(400).json({ success: false, error: 'name and bible are required' });
    }
    
    const projectPath = path.join(PROJECTS_DIR, name);
    
    // Check if project already exists
    try {
      await fs.access(projectPath);
      return res.status(400).json({ success: false, error: 'Project already exists' });
    } catch {
      // Project doesn't exist, good to create
    }
    
    // Create project structure
    await ensureBook(projectPath, {
      bookTitle: name,
      totalChapters,
    });
    
    // Write bible
    await fs.writeFile(path.join(projectPath, 'bible.md'), bible, 'utf-8');
    
    res.json({ success: true, message: 'Project created', path: projectPath });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * PUT /api/projects/:name/bible - 更新 Story Bible
 */
app.put('/api/projects/:name/bible', async (req: Request, res: Response) => {
  try {
    const { bible } = req.body;
    const projectPath = path.join(PROJECTS_DIR, req.params.name);
    
    await fs.writeFile(path.join(projectPath, 'bible.md'), bible, 'utf-8');
    
    res.json({ success: true, message: 'Bible updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/projects/:name/outline - 生成大纲 (支持自定义提示词)
 */
app.post('/api/projects/:name/outline', async (req: Request, res: Response) => {
  try {
    const { targetChapters = 400, targetWordCount = 100, customPrompt } = req.body;
    const projectPath = path.join(PROJECTS_DIR, req.params.name);
    
    // Read current bible
    let bible = await readBible(projectPath);
    
    // If custom prompt provided, append to bible
    if (customPrompt) {
      bible = `${bible}\n\n## 用户自定义要求\n${customPrompt}`;
    }
    
    // Generate outline
    const outline = await generateFullOutline({
      projectDir: projectPath,
      targetChapters,
      targetWordCount,
    });
    
    res.json({ success: true, outline });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/projects/:name/generate - 生成章节
 */
app.post('/api/projects/:name/generate', async (req: Request, res: Response) => {
  try {
    const { chaptersToGenerate = 1 } = req.body;
    const projectPath = path.join(PROJECTS_DIR, req.params.name);
    const projectName = req.params.name;
    
    console.log(`\n📚 [${projectName}] 开始生成 ${chaptersToGenerate} 章...`);
    
    const bible = await readBible(projectPath);
    let state = await readState(projectPath);
    const outline = await readOutline(projectPath);
    
    if (outline) {
      console.log(`   📋 已加载大纲: ${outline.totalChapters} 章, ${outline.volumes.length} 卷`);
    } else {
      console.log(`   ⚠️ 未找到大纲文件 outline.json`);
    }
    
    const results: { chapter: number; title: string }[] = [];
    
    for (let i = 0; i < chaptersToGenerate; i++) {
      const chapterIndex = state.nextChapterIndex;
      
      if (chapterIndex > state.totalChapters) {
        console.log(`   ✅ 书籍已完成!`);
        break; // Book complete
      }
      
      console.log(`\n   📝 [${i + 1}/${chaptersToGenerate}] 生成第 ${chapterIndex}/${state.totalChapters} 章...`);
      
      // Get chapter outline if available
      let chapterGoalHint: string | undefined;
      let outlineTitle: string | undefined;
      if (outline) {
        for (const vol of outline.volumes) {
          const ch = vol.chapters.find(c => c.index === chapterIndex);
          if (ch) {
            outlineTitle = ch.title;
            chapterGoalHint = `【章节大纲】
- 标题: ${ch.title}
- 目标: ${ch.goal}
- 章末钩子: ${ch.hook}

请按照大纲完成本章，但允许适当扩展和细化。`;
            console.log(`      📋 使用大纲: ${ch.title}`);
            break;
          }
        }
        if (!chapterGoalHint) {
          console.log(`      ⚠️ 大纲中未找到第 ${chapterIndex} 章`);
        }
      }
      
      const lastChapters = await readLastChapters(projectPath, 2);
      
      // 每 5 章更新一次摘要，或最后一章/每卷结尾时更新
      const isLastOfBatch = i === chaptersToGenerate - 1;
      const isVolumeEnd = outline?.volumes.some(v => v.endChapter === chapterIndex);
      const isFifthChapter = chapterIndex % 5 === 0;
      const shouldUpdateSummary = isLastOfBatch || isVolumeEnd || isFifthChapter;
      
      const result = await writeOneChapter({
        bible,
        rollingSummary: state.rollingSummary,
        openLoops: state.openLoops,
        lastChapters,
        chapterIndex,
        totalChapters: state.totalChapters,
        chapterGoalHint,
        skipSummaryUpdate: !shouldUpdateSummary,
      });
      
      await saveChapter(projectPath, chapterIndex, result.chapterText);
      
      // Extract title from first line
      const titleMatch = result.chapterText.match(/^第?\d*[章回节]?\s*[：:.]?\s*(.+)/m);
      const title = titleMatch ? titleMatch[1] : (outlineTitle || `Chapter ${chapterIndex}`);
      
      console.log(`      ✅ 已生成: ${title}`);
      if (result.wasRewritten) {
        console.log(`      ⚠️ 触发了 ${result.rewriteCount} 次重写`);
      }
      if (!result.skippedSummary) {
        console.log(`      📝 已更新摘要`);
      }
      
      results.push({ chapter: chapterIndex, title });
      
      // Update state
      state = {
        ...state,
        nextChapterIndex: chapterIndex + 1,
        rollingSummary: result.updatedSummary,
        openLoops: result.updatedOpenLoops,
      };
      await writeState(projectPath, state);
    }
    
    console.log(`\n✅ [${projectName}] 完成! 当前进度: ${state.nextChapterIndex - 1}/${state.totalChapters}`);
    
    res.json({ success: true, generated: results, state });
  } catch (error) {
    console.error(`\n❌ 生成失败:`, error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/projects/:name/chapters/:index - 获取章节内容
 */
app.get('/api/projects/:name/chapters/:index', async (req: Request, res: Response) => {
  try {
    const projectPath = path.join(PROJECTS_DIR, req.params.name);
    const chapterIndex = parseInt(req.params.index, 10);
    const filename = `${String(chapterIndex).padStart(3, '0')}.md`;
    const chapterPath = path.join(projectPath, 'chapters', filename);
    
    const content = await fs.readFile(chapterPath, 'utf-8');
    
    res.json({ success: true, chapter: chapterIndex, content });
  } catch (error) {
    res.status(404).json({ success: false, error: 'Chapter not found' });
  }
});

/**
 * DELETE /api/projects/:name - 删除项目
 */
app.delete('/api/projects/:name', async (req: Request, res: Response) => {
  try {
    const projectPath = path.join(PROJECTS_DIR, req.params.name);
    await fs.rm(projectPath, { recursive: true, force: true });
    res.json({ success: true, message: 'Project deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * PUT /api/projects/:name/reset - 重置项目状态
 */
app.put('/api/projects/:name/reset', async (req: Request, res: Response) => {
  try {
    const projectPath = path.join(PROJECTS_DIR, req.params.name);
    const state = await readState(projectPath);
    
    state.needHuman = false;
    state.needHumanReason = undefined;
    
    await writeState(projectPath, state);
    
    res.json({ success: true, message: 'State reset', state });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/projects/:name/download - 下载整本书 (TXT 格式)
 */
app.get('/api/projects/:name/download', async (req: Request, res: Response) => {
  try {
    const projectPath = path.join(PROJECTS_DIR, req.params.name);
    const projectName = req.params.name;
    const chaptersDir = path.join(projectPath, 'chapters');
    
    // Get all chapter files
    let files: string[] = [];
    try {
      const allFiles = await fs.readdir(chaptersDir);
      files = allFiles.filter(f => /^\d{3}\.md$/.test(f)).sort();
    } catch {
      return res.status(404).json({ success: false, error: 'No chapters found' });
    }
    
    if (files.length === 0) {
      return res.status(404).json({ success: false, error: 'No chapters found' });
    }
    
    // Read outline for chapter titles
    const outline = await readOutline(projectPath);
    const getChapterTitle = (index: number): string | null => {
      if (!outline) return null;
      for (const vol of outline.volumes) {
        const ch = vol.chapters.find(c => c.index === index);
        if (ch) return ch.title;
      }
      return null;
    };
    
    // Combine all chapters
    const chapters: string[] = [];
    for (const file of files) {
      const chapterIndex = parseInt(file.replace('.md', ''), 10);
      const chapterPath = path.join(chaptersDir, file);
      const content = await fs.readFile(chapterPath, 'utf-8');
      
      // Check if content already has a chapter title line
      const hasTitle = /^第?\d*[章回节]/.test(content.trim());
      
      if (hasTitle) {
        chapters.push(content.trim());
      } else {
        // Add chapter title if not present
        const title = getChapterTitle(chapterIndex) || '';
        const chapterHeader = `第${chapterIndex}章 ${title}`.trim();
        chapters.push(`${chapterHeader}\n\n${content.trim()}`);
      }
    }
    
    const fullContent = chapters.join('\n\n' + '='.repeat(40) + '\n\n');
    
    // Read state and bible for book title
    const state = await readState(projectPath);
    const bible = await readBible(projectPath);
    
    // Try to extract book title from bible (format: # 书名：《...》 or # XXX)
    let bookTitle = projectName;
    const titleMatch = bible.match(/^#\s*书名[：:]\s*[《「]?(.+?)[》」]?\s*$/m) 
                    || bible.match(/^#\s*[《「](.+?)[》」]\s*$/m)
                    || bible.match(/^#\s*(.+?)\s*$/m);
    if (titleMatch) {
      bookTitle = titleMatch[1].trim();
    } else if (state.bookTitle && state.bookTitle !== projectName) {
      bookTitle = state.bookTitle;
    }
    
    // Set response headers for file download
    const filename = `${bookTitle}.txt`;
    // Use RFC 5987 for UTF-8 filename support
    // Only use filename* since plain filename cannot contain non-ASCII characters
    const encodedFilename = encodeURIComponent(filename).replace(/'/g, '%27');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
    
    res.send(fullContent);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/generate-bible - AI 自动生成 Story Bible
 */
app.post('/api/generate-bible', async (req: Request, res: Response) => {
  try {
    const { genre, theme, keywords } = req.body;
    
    // 动态导入 gemini
    const { generateTextWithRetry } = await import('./gemini.js');
    
    const system = `
你是一个网文策划专家。请根据用户提供的关键词，生成一份完整的 Story Bible（小说设定文档）。

输出格式（Markdown）：
# 书名：XXX（自己起一个吸引人的书名）

## 核心卖点
- 列出 3-5 个卖点

## 主角
- 姓名、年龄、身份
- 性格特点
- 核心动机/目标

## 配角（2-3个重要配角）
- 简要介绍

## 世界观规则
- 核心设定
- 关键规则

## 主线
- 主线目标
- 分阶段目标

## 禁写规则
- 列出非最终章禁止出现的收尾语气

## 爽点节奏
- 节奏安排
`.trim();

    const prompt = `
请生成一个网文 Story Bible：
- 题材/类型: ${genre || '不限'}
- 主题/风格: ${theme || '不限'}
- 关键词/要素: ${keywords || '热血、逆袭、爽文'}
`.trim();

    const bible = await generateTextWithRetry({ system, prompt, temperature: 0.9 });
    
    res.json({ success: true, bible });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ==================== Start Server ====================

app.listen(PORT, () => {
  console.log(`🚀 Novel Automation API running at http://localhost:${PORT}`);
  console.log(`📁 Projects directory: ${PROJECTS_DIR}`);
});
