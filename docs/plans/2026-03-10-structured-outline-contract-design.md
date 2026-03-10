# Structured Outline Contract

## Problem

The chapter generator currently relies on thin outline fields (`title`, `goal`, `hook`) plus free-form context. That works for straightforward books, but it breaks down when a project needs hard narrative ceilings such as:

- how far a chapter may escalate relative to its current story state
- how many major crises may run in parallel
- whether a chapter must act as a fallout/bridge chapter
- which threads or state transitions must be advanced now

The recent emergency fix added keyword-based guardrails in generation and QC. That stopped one failing book, but it is not a general solution:

- it is brittle and book-specific
- it can produce false positives and false negatives
- it does not scale across many novels with different ontologies

## Goal

Introduce a structured, reusable chapter contract that travels with the outline and is consumed by both generation and QC. The generator should follow explicit chapter constraints instead of inferring them from keywords or stale summaries.

## Non-Goals

- Rebuilding the entire story engine as a finite state machine
- Requiring a database migration before the feature is useful
- Solving automatic outline authoring in the same phase
- Forcing legacy books to adopt contracts immediately

## Design

### 1. Add a structured contract to enhanced chapter outlines

Extend `EnhancedChapterOutline` with a `storyContract` object. This contract stores only structural constraints, not keyword lists and not any hardcoded ontology.

Proposed fields:

- `scope`: free-form range/state constraints for this chapter
- `crisis`: generic machine-readable constraints such as `maxConcurrent` and `requiredBridge`
- `threads`: thread requirements and forbidden introductions as free-form labels
- `stateTransition`: free-form expectations for end-of-chapter state
- `notes`: extra contract notes

Volume outlines get a lighter contract:

- the same free-form sections
- plus optional `chapterDefaults` inherited by chapters in the volume

### 2. Keep the lightweight outline schema backward compatible

The project still stores `outline_json` in its current shape. The system should accept both:

- legacy chapter entries with only `title / goal / hook`
- upgraded entries with optional contract fields

Normalization should preserve old behavior when contracts are missing. Contracts only strengthen generation when present.

### 3. Use one contract in both generation and QC

Generation path:

1. load chapter outline from `outline_json`
2. normalize chapter data into an `EnhancedChapterOutline`
3. inject `storyContract` into the prompt in a human-readable form
4. remove keyword-based guardrails from prompt assembly

QC path:

1. read the same `storyContract`
2. extend goal checking to validate contract adherence
3. surface contract violations as structured QC findings without code-side ontology tables

This keeps the chapter contract as the single source of truth.

### 4. Build from the existing enhanced-outline path

The current system already has:

- `EnhancedChapterOutline`
- goal-based AI QC
- multi-dimensional QC orchestration
- chapter prompt assembly around structured outline data

This phase should reuse those components instead of introducing a second config stack.

### 5. Phase 1 scope

Phase 1 covers:

- type and normalize-layer support for contract fields
- generation prompt support for contract-aware chapter guidance
- QC support for contract adherence
- removal of the temporary hardcoded keyword guardrails

Phase 1 does **not** cover:

- automatic contract generation inside outline authoring
- project-wide automatic migration of old books
- a heavy state-machine rewrite

## Implementation Plan

### Step 1: Types and normalization

Files:

- `src/types/narrative.ts`
- `src/generateOutline.ts`
- `src/utils/outline.ts`

Work:

- define a generic contract container type
- extend chapter and volume outline types with optional contract fields
- normalize contract data from raw `outline_json`
- provide safe defaults when contracts are absent

### Step 2: Generation integration

Files:

- `src/routes/generation.ts`
- `src/enhancedChapterEngine.ts`
- `src/agent/agentChapterEngine.ts`

Work:

- build an `EnhancedChapterOutline` from stored chapter outline data
- pass structured contracts into `writeEnhancedChapter`
- render contract rules in prompt sections
- delete temporary keyword-based guardrail logic

### Step 3: QC integration

Files:

- `src/qc/goalCheck.ts`
- `src/qc/multiDimensionalQC.ts`

Work:

- extend AI-based goal check prompt with contract validation
- surface contract violations as structured issues
- keep behavior tolerant when contracts are missing

### Step 4: Verification

- `pnpm exec tsc --noEmit`
- legacy outline regression check: no contract fields still typecheck and run
- targeted regression on the problematic novel flow to ensure contracts can constrain chapter 78+

## Risks

1. The current project may not always construct `EnhancedChapterOutline` before generation.
   Mitigation: add a normalization helper that upgrades stored chapter outline entries into a minimal enhanced outline.

2. AI QC can still be fuzzy if contract wording is vague.
   Mitigation: keep the machine-sensitive part limited to generic scalars such as `maxConcurrent` and `requiredBridge`, and treat the rest as explicit outline text.

3. Legacy books may not benefit immediately.
   Mitigation: keep compatibility first, then add contract generation in a later phase.

## Open Follow-Up

After Phase 1 is stable, add contract authoring to the outline generator so new books can be created with chapter contracts from the start.
