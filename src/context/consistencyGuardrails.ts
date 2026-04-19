/**
 * Consistency guardrails — extract critical continuity facts and format
 * them as an inline checklist the LLM must not violate.
 *
 * This improves quality without extra LLM calls by embedding key constraints
 * directly in the context window.
 */

import type { CharacterStateRegistry } from '../types/characterState.js';
import type { PlotGraph } from '../types/plotGraph.js';
import type { TimelineState } from '../types/timeline.js';

export type ConsistencyInput = {
  characterStates?: CharacterStateRegistry;
  plotGraph?: PlotGraph;
  timeline?: TimelineState;
  lastChapterEnding: string;
  chapterIndex: number;
};

const CONDITION_LABELS: Record<string, string> = {
  healthy: '健康',
  minor_injury: '轻伤',
  major_injury: '重伤',
  weak: '虚弱',
  unconscious: '昏迷',
};

export function buildConsistencyGuardrails(input: ConsistencyInput): string {
  const items: string[] = [];

  // 1. Character physical/emotional state constraints
  if (input.characterStates) {
    const snapshots = Object.values(input.characterStates.snapshots);
    for (const s of snapshots) {
      const parts: string[] = [];
      const condLabel = CONDITION_LABELS[s.physical.condition] || s.physical.condition;
      if (s.physical.condition !== 'healthy' && s.physical.condition !== 'unknown') {
        parts.push(`身体状态:${condLabel}`);
      }
      if (s.physical.location) {
        parts.push(`位于${s.physical.location}`);
      }
      if (s.recentChanges.length > 0) {
        const last = s.recentChanges[s.recentChanges.length - 1];
        if (input.chapterIndex - last.chapter <= 3) {
          parts.push(`近期:${last.change}`);
        }
      }
      if (parts.length > 0) {
        items.push(`${s.characterName}：${parts.join('，')}`);
      }
    }
  }

  // 2. Critical foreshadowing that MUST be respected
  if (input.plotGraph) {
    const critical = input.plotGraph.pendingForeshadowing.filter(
      f => f.urgency === 'critical' && input.chapterIndex >= f.suggestedResolutionRange[0],
    );
    for (const f of critical.slice(0, 3)) {
      items.push(`[紧急伏笔回收] ${f.summary}（已埋${f.ageInChapters}章）`);
    }
  }

  // 3. Recent timeline events that must not be contradicted
  if (input.timeline && input.timeline.events.length > 0) {
    const recent = input.timeline.events
      .filter(e => input.chapterIndex - (e.startedChapter ?? e.completedChapter ?? 0) <= 2)
      .slice(-3);
    for (const e of recent) {
      items.push(`[已发生] ${e.summary || e.description}`);
    }
  }

  // 4. Last chapter ending anchor — direct excerpt so the model can't drift
  const tail = (input.lastChapterEnding || '').trim();
  if (tail) {
    const excerpt = tail.slice(-200);
    items.push(`[上章结尾锚点] ${excerpt}`);
    items.push('[衔接自检] 本章第1段必须从这个结尾状态/位置/情绪继续，不得跳转或复原');
  }

  if (items.length === 0) return '';

  return `【一致性护栏 — 以下事实不可矛盾】\n${items.map((it, i) => `${i + 1}. ${it}`).join('\n')}`;
}
