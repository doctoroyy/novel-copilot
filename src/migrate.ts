/**
 * Migration script: Import existing file-based projects into D1 database
 * Run with: pnpm migrate
 */

import path from 'node:path';
import fs from 'node:fs/promises';

const PROJECTS_DIR = path.join(process.cwd(), 'projects');

interface BookState {
  bookTitle: string;
  totalChapters: number;
  nextChapterIndex: number;
  rollingSummary: string;
  openLoops: string[];
  needHuman?: boolean;
  needHumanReason?: string;
}

async function readState(projectDir: string): Promise<BookState> {
  const statePath = path.join(projectDir, 'state.json');
  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    return JSON.parse(raw) as BookState;
  } catch {
    return {
      bookTitle: path.basename(projectDir),
      totalChapters: 100,
      nextChapterIndex: 1,
      rollingSummary: '',
      openLoops: [],
    };
  }
}

async function readBible(projectDir: string): Promise<string> {
  const biblePath = path.join(projectDir, 'bible.md');
  try {
    return await fs.readFile(biblePath, 'utf-8');
  } catch {
    return '';
  }
}

async function readOutline(projectDir: string): Promise<any | null> {
  const outlinePath = path.join(projectDir, 'outline.json');
  try {
    const raw = await fs.readFile(outlinePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function listChapters(projectDir: string): Promise<{ index: number; content: string }[]> {
  const chaptersDir = path.join(projectDir, 'chapters');
  const chapters: { index: number; content: string }[] = [];
  
  try {
    const files = await fs.readdir(chaptersDir);
    for (const file of files) {
      if (file.endsWith('.md') || file.endsWith('.txt')) {
        const match = file.match(/(\d+)/);
        if (match) {
          const index = parseInt(match[1], 10);
          const content = await fs.readFile(path.join(chaptersDir, file), 'utf-8');
          chapters.push({ index, content });
        }
      }
    }
  } catch {
    // No chapters directory
  }
  
  return chapters.sort((a, b) => a.index - b.index);
}

async function generateSQL(projectName: string, projectDir: string): Promise<string> {
  const state = await readState(projectDir);
  const bible = await readBible(projectDir);
  const outline = await readOutline(projectDir);
  const chapters = await listChapters(projectDir);
  
  const id = crypto.randomUUID();
  const sql: string[] = [];
  
  // Escape single quotes for SQL
  const esc = (s: string) => s.replace(/'/g, "''");
  
  // Insert project
  sql.push(`INSERT INTO projects (id, name, bible) VALUES ('${id}', '${esc(projectName)}', '${esc(bible)}');`);
  
  // Insert state
  sql.push(`INSERT INTO states (project_id, book_title, total_chapters, next_chapter_index, rolling_summary, open_loops, need_human, need_human_reason) VALUES ('${id}', '${esc(state.bookTitle || projectName)}', ${state.totalChapters}, ${state.nextChapterIndex}, '${esc(state.rollingSummary || '')}', '${esc(JSON.stringify(state.openLoops || []))}', ${state.needHuman ? 1 : 0}, ${state.needHumanReason ? `'${esc(state.needHumanReason)}'` : 'NULL'});`);
  
  // Insert outline if exists
  if (outline) {
    sql.push(`INSERT INTO outlines (project_id, outline_json) VALUES ('${id}', '${esc(JSON.stringify(outline))}');`);
  }
  
  // Insert chapters
  for (const ch of chapters) {
    sql.push(`INSERT INTO chapters (project_id, chapter_index, content) VALUES ('${id}', ${ch.index}, '${esc(ch.content)}');`);
  }
  
  return sql.join('\n');
}

async function main() {
  console.log('📦 Migrating projects to D1...\n');
  
  const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  const projectDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  
  let allSQL = '-- Migration script for existing projects\n-- Run with: wrangler d1 execute novel-copilot-db --local --file=./migration.sql\n\n';
  
  for (const projectName of projectDirs) {
    const projectDir = path.join(PROJECTS_DIR, projectName);
    console.log(`📖 Processing: ${projectName}`);
    
    const state = await readState(projectDir);
    const chapters = await listChapters(projectDir);
    console.log(`   - State: ${state.nextChapterIndex - 1}/${state.totalChapters} chapters`);
    console.log(`   - Chapters found: ${chapters.length}`);
    
    const sql = await generateSQL(projectName, projectDir);
    allSQL += `-- Project: ${projectName}\n${sql}\n\n`;
  }
  
  // Write SQL file
  const migrationPath = path.join(process.cwd(), 'migration.sql');
  await fs.writeFile(migrationPath, allSQL, 'utf-8');
  
  console.log(`\n✅ Migration SQL saved to: migration.sql`);
  console.log('\n📝 To apply migration:');
  console.log('   wrangler d1 execute novel-copilot-db --local --file=./migration.sql');
}

main().catch(console.error);
