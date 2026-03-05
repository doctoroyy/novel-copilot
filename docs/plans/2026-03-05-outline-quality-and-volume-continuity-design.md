# Outline Quality & Cross-Volume Continuity

## Problem

1. Volume outlines are too brief — goal/conflict/climax each capped at 30 chars, chapter descriptions get ~160 tokens
2. First chapter of a new volume doesn't connect to the previous volume's ending — no volume-level context injected at volume boundaries

## Solution

### Part 1: Remove artificial limits from outline generation

**File: `src/generateOutline.ts`**

- `generateMasterOutline`: Remove "50字以内" from mainGoal, "30字以内" from goal/conflict/climax. Add `volumeEndState` field.
- `generateAdditionalVolumes`: Same changes to prompt. Use `volumeEndState` in "上一卷结尾状态".
- `generateVolumeChapters`: Remove `maxTokens` limit. Expand bible truncation from 2000 to 4000 chars.
- `generateFullOutline`: Enrich `previousVolumeSummary` to include goal + climax + volumeEndState.

### Part 2: Inject volume context at volume boundaries

**File: `src/routes/generation.ts`**

- When building `chapterGoalHint`, detect if current chapter is the first chapter of a volume
- If so, append: new volume's goal/conflict, previous volume's ending state, and a bridging instruction
