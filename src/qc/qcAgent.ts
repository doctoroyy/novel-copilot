import { getAIConfigFromRegistry, type AIConfig } from '../services/aiClient.js';
import { createBackgroundTask, updateTaskMessage, completeTask } from '../routes/tasks.js';
import { runQuickQC, type QCResult, type QCIssue } from './multiDimensionalQC.js';
import { quickEndingHeuristic, quickChapterFormatHeuristic } from '../qc.js';
import { checkConsistency } from '../context/consistencyChecker.js';
import { checkCharacterConsistency } from './characterConsistencyCheck.js';
import { checkPacingAlignment } from './pacingCheck.js';
import { checkGoalAchievement } from './goalCheck.js';
import { checkStoryContractCompliance } from './storyContractCheck.js';
import { hasStoryContract } from '../utils/storyContract.js';
import { runGlobalAnalysis, type GlobalAnalysis } from './globalAnalysis.js';
import { checkCrosschapterContinuity } from './continuityCheck.js';

export type ScanMode = 'quick' | 'standard' | 'full';

export type QCReportSummary = {
  totalChapters: number;
  chaptersScanned: number;
  chaptersWithAICheck: number;
  overallScore: number;
  passRate: number;
  criticalCount: number;
  majorCount: number;
  minorCount: number;
};

export type ChapterQCEntry = {
  passed: boolean;
  score: number;
  tier: 1 | 2;
  issues: QCIssue[];
};

export type ActionableIssue = {
  issueId: string;
  chapterIndex: number;
  type: string;
  severity: string;
  description: string;
  suggestion?: string;
  fixStrategy: 'repair' | 'regenerate';
  fixed: boolean;
};

export type QCReport = {
  reportId: string;
  projectId: string;
  createdAt: number;
  scanMode: ScanMode;
  summary: QCReportSummary;
  globalAnalysis: GlobalAnalysis;
  chapters: Record<number, ChapterQCEntry>;
  actionableIssues: ActionableIssue[];
};

function generateId(): string {
  return `qcr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function needsTier2(entry: ChapterQCEntry, chapterIndex: number, scanMode: ScanMode): boolean {
  if (scanMode === 'full') return true;
  if (entry.score < 80) return true;
  if (entry.issues.some(i => i.severity === 'critical' || i.severity === 'major')) return true;
  if (chapterIndex % 20 === 0) return true;
  return false;
}

function buildActionableIssues(chapters: Record<number, ChapterQCEntry>): ActionableIssue[] {
  const issues: ActionableIssue[] = [];
  for (const [chIdx, entry] of Object.entries(chapters)) {
    const chapterIndex = Number(chIdx);
    for (const issue of entry.issues) {
      if (issue.severity === 'critical' || issue.severity === 'major') {
        issues.push({
          issueId: `issue_${chapterIndex}_${issues.length}`,
          chapterIndex,
          type: issue.type,
          severity: issue.severity,
          description: issue.description,
          suggestion: issue.suggestion,
          fixStrategy: issue.severity === 'critical' ? 'regenerate' : 'repair',
          fixed: false,
        });
      }
    }
  }
  return issues;
}

export async function runQCScan(
  db: D1Database,
  projectId: string,
  scanMode: ScanMode,
  taskId: number,
  reportId: string,
): Promise<QCReport> {
  // Load chapters
  const { results: chapterRows } = await db.prepare(`
    SELECT chapter_index, content FROM chapters
    WHERE project_id = ? AND deleted_at IS NULL
    ORDER BY chapter_index
  `).bind(projectId).all() as { results: { chapter_index: number; content: string }[] };

  if (chapterRows.length === 0) {
    throw new Error('没有章节可扫描');
  }

  // Load project settings
  const project = await db.prepare(`
    SELECT s.total_chapters, s.min_chapter_words,
           o.outline_json,
           cs.registry_json as character_states_json
    FROM projects p
    LEFT JOIN states s ON p.id = s.project_id
    LEFT JOIN outlines o ON p.id = o.project_id
    LEFT JOIN character_states cs ON p.id = cs.project_id
    WHERE p.id = ?
  `).bind(projectId).first() as any;

  const outlineJson = project?.outline_json ? JSON.parse(project.outline_json) : null;
  const totalChapters = project?.total_chapters || chapterRows.length;
  const minChapterWords = project?.min_chapter_words || 1500;

  let characterStates: any = null;
  try {
    characterStates = project?.character_states_json ? JSON.parse(project.character_states_json) : null;
  } catch { /* ignore */ }

  const chapters: Record<number, ChapterQCEntry> = {};
  const tier2Candidates: number[] = [];

  // === Tier 1: Rule-based scan for all chapters ===
  await updateTaskMessage(db, taskId, `Tier 1: 开始扫描 ${chapterRows.length} 章...`);

  for (let i = 0; i < chapterRows.length; i++) {
    const row = chapterRows[i];
    const chIdx = row.chapter_index;

    const qcResult = runQuickQC(row.content, chIdx, totalChapters, minChapterWords);
    const entry: ChapterQCEntry = {
      passed: qcResult.passed,
      score: qcResult.score,
      tier: 1,
      issues: qcResult.issues,
    };

    chapters[chIdx] = entry;

    if (needsTier2(entry, chIdx, scanMode)) {
      tier2Candidates.push(chIdx);
    }

    if (i % 50 === 0 || i === chapterRows.length - 1) {
      await updateTaskMessage(db, taskId, `Tier 1: 扫描第 ${i + 1}/${chapterRows.length} 章...`);
    }
  }

  // === 识别卷边界 ===
  const volumeBoundaries = new Set<number>(); // 存放"新卷第一章"的 chapterIndex
  if (outlineJson?.volumes) {
    for (const vol of outlineJson.volumes) {
      if (typeof vol.startChapter === 'number' && vol.startChapter > 1) {
        volumeBoundaries.add(vol.startChapter);
        // 确保卷边界两侧都进入 Tier 2
        if (!tier2Candidates.includes(vol.startChapter)) {
          tier2Candidates.push(vol.startChapter);
        }
        const prevChIdx = vol.startChapter - 1;
        if (!tier2Candidates.includes(prevChIdx) && chapterRows.some(r => r.chapter_index === prevChIdx)) {
          tier2Candidates.push(prevChIdx);
        }
      }
    }
  }

  // === Tier 2: AI checks for problem chapters (standard/full mode only) ===
  let chaptersWithAICheck = 0;
  if (scanMode !== 'quick' && tier2Candidates.length > 0) {
    const aiConfig = await getAIConfigFromRegistry(db, 'qc');
    if (aiConfig) {
      await updateTaskMessage(db, taskId, `Tier 2: 准备 AI 检测 ${tier2Candidates.length} 章...`);

      for (let i = 0; i < tier2Candidates.length; i++) {
        const chIdx = tier2Candidates[i];
        const row = chapterRows.find(r => r.chapter_index === chIdx);
        if (!row) continue;

        await updateTaskMessage(db, taskId, `Tier 2: AI 检测第 ${chIdx} 章 (${i + 1}/${tier2Candidates.length})...`);

        const existingEntry = chapters[chIdx];
        const aiIssues: QCIssue[] = [];

        try {
          // Character consistency
          if (characterStates) {
            const charResult = await checkCharacterConsistency(aiConfig, row.content, characterStates);
            aiIssues.push(...charResult.issues);
            if (charResult.score < existingEntry.score) {
              existingEntry.score = Math.round((existingEntry.score + charResult.score) / 2);
            }
          }

          // Pacing check (needs narrative guide from outline)
          if (outlineJson) {
            const chapterOutline = findChapterOutline(outlineJson, chIdx);
            if (chapterOutline?.narrativeGuide) {
              const pacingResult = await checkPacingAlignment(aiConfig, row.content, chapterOutline.narrativeGuide);
              aiIssues.push(...pacingResult.issues);
            }

            // Goal achievement
            if (chapterOutline) {
              const goalResult = await checkGoalAchievement(aiConfig, row.content, chapterOutline);
              aiIssues.push(...goalResult.issues);
            }

            // Story contract compliance
            if (chapterOutline && hasStoryContract(chapterOutline.storyContract)) {
              const contractResult = await checkStoryContractCompliance(aiConfig, row.content, chapterOutline);
              aiIssues.push(...contractResult.issues);
            }
          }
        } catch (err) {
          console.warn(`Tier 2 AI check failed for chapter ${chIdx}:`, err);
        }

        existingEntry.issues.push(...aiIssues);
        existingEntry.tier = 2;
        existingEntry.passed = !existingEntry.issues.some(i => i.severity === 'critical');
        chaptersWithAICheck++;
      }
    }
  }

  // === Tier 2.5: 章节连续性检测（卷边界 + 卷内采样） ===
  if (scanMode !== 'quick') {
    const continuityPairs = buildContinuityPairs(
      chapterRows, chapters, volumeBoundaries, scanMode,
    );

    if (continuityPairs.length > 0) {
      const aiConfig = await getAIConfigFromRegistry(db, 'qc');
      if (aiConfig) {
        await updateTaskMessage(db, taskId, `连续性检测: 共 ${continuityPairs.length} 对...`);

        const CONCURRENCY = 3;
        for (let batch = 0; batch < continuityPairs.length; batch += CONCURRENCY) {
          const batchPairs = continuityPairs.slice(batch, batch + CONCURRENCY);

          await Promise.all(batchPairs.map(async (pair: ContinuityPair) => {
            const prevRow = chapterRows.find(r => r.chapter_index === pair.prevIdx);
            const nextRow = chapterRows.find(r => r.chapter_index === pair.nextIdx);
            if (!prevRow || !nextRow) return;

            try {
              const prevEnding = prevRow.content.slice(-1000);
              const nextOpening = nextRow.content.slice(0, 1000);

              const contResult = await checkCrosschapterContinuity(
                aiConfig, pair.prevIdx, prevEnding, pair.nextIdx, nextOpening, pair.isVolumeBoundary,
              );

              // 将问题分配给后章
              if (contResult.issues.length > 0) {
                const entry = chapters[pair.nextIdx];
                if (entry) {
                  entry.issues.push(...contResult.issues);
                  entry.score = Math.min(entry.score, contResult.score);
                  entry.passed = !entry.issues.some(iss => iss.severity === 'critical');
                }
              }
            } catch (err) {
              console.warn(`Continuity check failed for ${pair.prevIdx}→${pair.nextIdx}:`, err);
            }
          }));

          // 每批更新一次进度
          const checked = Math.min(batch + CONCURRENCY, continuityPairs.length);
          await updateTaskMessage(db, taskId, `连续性检测: ${checked}/${continuityPairs.length} 对...`);
        }
      }
    }
  }

  // === Tier 3: Global analysis ===
  let globalAnalysis: GlobalAnalysis = {
    pacingCurve: { score: 0, deadSpots: [] },
    characterArcs: { score: 0, characters: [] },
    plotThreads: { score: 0, unresolvedCount: 0, threads: [] },
    conflictDensity: { score: 0, distribution: [] },
  };

  if (scanMode !== 'quick') {
    const aiConfig = await getAIConfigFromRegistry(db, 'qc');
    if (aiConfig) {
      await updateTaskMessage(db, taskId, '全局分析: 正在分析...');
      const chapterSummaries = chapterRows.map(r => r.content.slice(0, 300));
      const characterNames = characterStates?.snapshots
        ? Object.keys(characterStates.snapshots)
        : [];
      globalAnalysis = await runGlobalAnalysis(aiConfig, chapterSummaries, characterNames);
    }
  }

  // === Build report ===
  const chapterEntries = Object.values(chapters);
  const passedCount = chapterEntries.filter(e => e.passed).length;
  const allIssues = chapterEntries.flatMap(e => e.issues);
  const overallScore = chapterEntries.length > 0
    ? Math.round(chapterEntries.reduce((sum, e) => sum + e.score, 0) / chapterEntries.length)
    : 0;

  const report: QCReport = {
    reportId,
    projectId,
    createdAt: Date.now(),
    scanMode,
    summary: {
      totalChapters,
      chaptersScanned: chapterRows.length,
      chaptersWithAICheck,
      overallScore,
      passRate: chapterEntries.length > 0 ? Math.round((passedCount / chapterEntries.length) * 100) : 0,
      criticalCount: allIssues.filter(i => i.severity === 'critical').length,
      majorCount: allIssues.filter(i => i.severity === 'major').length,
      minorCount: allIssues.filter(i => i.severity === 'minor').length,
    },
    globalAnalysis,
    chapters,
    actionableIssues: buildActionableIssues(chapters),
  };

  return report;
}

type ContinuityPair = {
  prevIdx: number;
  nextIdx: number;
  isVolumeBoundary: boolean;
};

/**
 * 根据 scanMode 构建需要连续性检测的章节对列表。
 * - standard: 卷边界 + 评分 < 80 的章节前后对 + 每 10 章采样
 * - full: 所有相邻章节对
 */
function buildContinuityPairs(
  chapterRows: { chapter_index: number; content: string }[],
  chapters: Record<number, ChapterQCEntry>,
  volumeBoundaries: Set<number>,
  scanMode: ScanMode,
): ContinuityPair[] {
  const sortedIndices = chapterRows
    .map(r => r.chapter_index)
    .sort((a, b) => a - b);

  if (sortedIndices.length < 2) return [];

  // 用 "prevIdx-nextIdx" 作为 key 去重
  const seen = new Set<string>();
  const pairs: ContinuityPair[] = [];

  const addPair = (prevIdx: number, nextIdx: number) => {
    const key = `${prevIdx}-${nextIdx}`;
    if (seen.has(key)) return;
    // 确认两章都存在于已扫描的列表中
    if (!sortedIndices.includes(prevIdx) || !sortedIndices.includes(nextIdx)) return;
    seen.add(key);
    pairs.push({
      prevIdx,
      nextIdx,
      isVolumeBoundary: volumeBoundaries.has(nextIdx),
    });
  };

  if (scanMode === 'full') {
    // full 模式：所有相邻对
    for (let i = 0; i < sortedIndices.length - 1; i++) {
      addPair(sortedIndices[i], sortedIndices[i + 1]);
    }
  } else {
    // standard 模式：智能采样

    // 1) 所有卷边界
    for (const boundary of volumeBoundaries) {
      const prevIdx = boundary - 1;
      addPair(prevIdx, boundary);
    }

    // 2) Tier 1/2 评分 < 80 的章节与前后章组成检测对
    for (const idx of sortedIndices) {
      const entry = chapters[idx];
      if (entry && entry.score < 80) {
        const posInSorted = sortedIndices.indexOf(idx);
        if (posInSorted > 0) {
          addPair(sortedIndices[posInSorted - 1], idx);
        }
        if (posInSorted < sortedIndices.length - 1) {
          addPair(idx, sortedIndices[posInSorted + 1]);
        }
      }
    }

    // 3) 每 10 章固定采样一对（均匀覆盖，防止遗漏）
    for (let i = 0; i < sortedIndices.length - 1; i++) {
      if (i % 10 === 0) {
        addPair(sortedIndices[i], sortedIndices[i + 1]);
      }
    }
  }

  // 按章节顺序排列
  return pairs.sort((a, b) => a.prevIdx - b.prevIdx);
}

function findChapterOutline(outlineJson: any, chapterIndex: number): any | null {
  if (!outlineJson?.volumes) return null;
  for (const vol of outlineJson.volumes) {
    if (!vol.chapters) continue;
    for (const ch of vol.chapters) {
      if (ch.chapterIndex === chapterIndex) return ch;
    }
  }
  return null;
}

export async function runQCScanInBackground(params: {
  env: { DB: D1Database };
  taskId: number;
  projectId: string;
  userId: string;
  scanMode: ScanMode;
  reportId: string;
}): Promise<void> {
  const { env, taskId, projectId, scanMode, reportId } = params;
  const db = env.DB;

  try {
    const report = await runQCScan(db, projectId, scanMode, taskId, reportId);

    // Save report to DB
    await db.prepare(`
      UPDATE qc_reports
      SET report_json = ?,
          overall_score = ?,
          total_issues = ?,
          critical_count = ?,
          major_count = ?,
          minor_count = ?,
          status = 'completed',
          updated_at = (unixepoch() * 1000)
      WHERE id = ?
    `).bind(
      JSON.stringify(report),
      report.summary.overallScore,
      report.summary.criticalCount + report.summary.majorCount + report.summary.minorCount,
      report.summary.criticalCount,
      report.summary.majorCount,
      report.summary.minorCount,
      reportId,
    ).run();

    await completeTask(db, taskId, true);
    await updateTaskMessage(db, taskId, `扫描完成: 评分 ${report.summary.overallScore}/100, ${report.actionableIssues.length} 个可修复问题`);
  } catch (error) {
    const msg = (error as Error).message || '扫描失败';
    await db.prepare(`
      UPDATE qc_reports SET status = 'failed', updated_at = (unixepoch() * 1000) WHERE id = ?
    `).bind(reportId).run();
    await completeTask(db, taskId, false, msg);
  }
}
