# Novel Multiverse Launch Design

## Goal

Launch `novel-multiverse` as the next-stage platform evolved from `novel-copilot`.

Phase 1 target in 4 weeks:

Build a minimal but real `multi-verse` demo where a canonical story node can be forked into a branch and continued by AI.

## Approved Decisions

- GitHub organization name: `novel-multiverse`
- Repo strategy for Phase 1: `monorepo`
- `novel-agent-core` shape: independent HTTP service, not a local SDK
- Runtime strategy: portable module boundaries for dual runtime support, but first implementation only needs one runtime target
- Priority order: organization and repo boundary first, core extraction second, forkable product layer third
- Phase 1 success criterion: `minimal multi-verse demo`, not only architecture cleanup

## Product Positioning

`Novel Multiverse` is not a simple AI writing upgrade.

It is a forkable narrative platform built on top of an agent-powered universe engine:

- stories become graph structures instead of fixed chapter lists
- readers can fork from any approved story node
- AI can continue a branch while preserving context, state, and constraints

Working definition:

`GitHub for Stories + AI Universe Engine`

## Approach Comparison

### 1. Platform First, Demo Embedded

Create a clean platform base first, then implement one narrow but real fork flow on top.

Pros:

- preserves long-term architecture quality
- avoids binding the new system to current `novel-copilot` UI or chapter-only semantics
- still produces a visible demo in 4 weeks

Cons:

- first one to two weeks are infrastructure-heavy

### 2. Core Extraction First, Product Later

Extract agent capabilities first and postpone the demo.

Pros:

- lowest architecture debt

Cons:

- misses the approved Phase 1 outcome
- high chance of delivering only refactor progress without product proof

### 3. Demo First, Architecture Lightly Extracted

Add forking directly on top of current `novel-copilot` and extract only the minimum.

Pros:

- fastest short-term demo

Cons:

- almost guarantees a second major rewrite
- keeps chapter-generation coupling in the new system

## Recommended Approach

Use `Platform First, Demo Embedded`.

This is the only option that satisfies both constraints:

- a real multi-verse demo within 4 weeks
- a clean enough foundation for future `Universe -> World -> Timeline -> Story -> Branch` expansion

## Phase 1 Architecture

### Top-Level Structure

```text
novel-multiverse/
├── apps/
│   ├── studio-web
│   └── reader-web
├── services/
│   ├── gateway
│   ├── agent-core-service
│   ├── agent-loop-service
│   ├── story-service
│   └── universe-service
├── packages/
│   ├── domain-schema
│   ├── agent-protocol
│   ├── provider-adapters
│   ├── runtime-kit
│   ├── prompt-assets
│   └── copilot-bridge
├── infra/
│   ├── migrations
│   └── deploy
└── docs/
```

### Application Layer

- `studio-web`: internal authoring and universe-management console
- `reader-web`: lightweight reader surface for canonical reading and branch forking

### Service Layer

- `gateway`: public entrypoint, auth boundary, API composition
- `agent-core-service`: reasoning, tool orchestration, provider routing, prompt assembly
- `agent-loop-service`: job lifecycle, retries, long-running execution, trace state, async run control
- `story-service`: story, node, branch, branch-run CRUD and graph queries
- `universe-service`: future home of universe/world/timeline coordination, thin in Phase 1

### Shared Package Layer

- `domain-schema`: canonical domain models, events, enums, DTOs
- `agent-protocol`: run request/response, tool contracts, trace schema, job states
- `provider-adapters`: Gemini/OpenAI/DeepSeek provider abstraction
- `runtime-kit`: clock, logger, storage, fetch, queue, id generation, runtime shims
- `prompt-assets`: structured prompts and templates, separate from service logic
- `copilot-bridge`: migration bridge for existing `novel-copilot` context, QC, and prompt assets

## Hard Boundaries

### Agent Core Boundary

`agent-core-service` must not know about:

- page routes
- web layouts
- "chapter page" UI semantics
- product-specific orchestration state

It should only expose structured capabilities such as:

- `plan_story_node`
- `continue_branch_from_node`
- `repair_branch_consistency`

### Agent Loop Boundary

`agent-loop-service` owns:

- run creation
- retry and timeout policy
- trace storage
- progress updates
- job state transitions

It must not own:

- provider prompt composition
- tool logic
- story graph persistence

### Story Graph Boundary

`story-service` owns:

- canonical stories
- story nodes
- branch metadata
- branch graph queries

It must not own:

- AI execution policy
- tool orchestration

## Core Domain Model

Phase 1 uses the smallest model that can support a real forkable demo:

`Universe -> World -> Timeline -> Story -> StoryNode -> BranchRun`

### Required Entities

- `Universe`: top-level narrative container, mostly a namespace in Phase 1
- `World`: optional thematic or ruleset container under a universe
- `Timeline`: ordering scope for a story sequence
- `Story`: canonical content root
- `StoryNode`: a stable graph node, usually derived from a canonical chapter or branch continuation step
- `Branch`: a fork created from one `StoryNode`
- `BranchRun`: one AI continuation run for a branch

### Minimum StoryNode Payload

Each `StoryNode` must store a stable snapshot sufficient for future continuation:

- source story id
- node type
- parent node id
- canonical text or content block
- world state snapshot
- character state snapshot
- timeline snapshot
- open loops
- prompt context digest

This snapshot is the anchor of the entire fork model. If it is unstable or incomplete, branch continuation quality collapses.

## Minimal Product Flow

Phase 1 demo should implement only this flow:

1. Create a `Story` in `studio-web`
2. Generate or import one canonical chapter and persist it as a `StoryNode`
3. Select any `StoryNode`
4. Create a `Branch` from that node with one-line `branch intent`
5. Start a `BranchRun`
6. `agent-loop-service` calls `agent-core-service` to continue the branch
7. `reader-web` shows canonical path and branch path in one graph view

This is enough to prove:

- story graph persistence
- forkability
- AI continuation on branch state
- separation between canonical line and derivative branches

Phase 1 explicitly excludes:

- branch merge
- revenue sharing
- recommendation systems
- collaborative editing
- autonomous universe simulation

## API Shape

Minimal API surface:

- `POST /stories`
- `POST /stories/:storyId/nodes`
- `POST /nodes/:nodeId/forks`
- `POST /branches/:branchId/runs`
- `GET /stories/:storyId/graph`
- `GET /branches/:branchId`
- `GET /runs/:runId`

Important rule:

- `fork` creates a branch identity only
- `run` starts AI continuation only

This keeps the system compatible with two future modes:

- human-written continuation
- AI-managed continuation

## Migration Strategy From Novel Copilot

Do not migrate by folder. Migrate by dependency risk.

### Step 1. Provider and Reliability Layer

Extract first:

- provider abstraction
- retry/fallback logic
- trace and diagnostics

### Step 2. Agent Execution Layer

Extract next:

- orchestrator
- tool executor
- tool contracts

These are currently centered in:

- `src/agent/orchestrator.ts`
- `src/agent/toolExecutor.ts`
- `src/agent/tools.ts`
- `src/agent/types.ts`

### Step 3. Context and Quality Layer

Extract after the execution layer is stable:

- context assembly
- narrative guide generation
- quality checks
- memory and summary logic

### Step 4. Product Integration Layer

Only after services are stable:

- adapt web flows
- add graph UI
- add fork and branch run actions

This order protects the new platform from inheriting the old "chapter generation app first" boundary.

## Runtime Strategy

The codebase should be designed for dual runtime portability, but Phase 1 only needs one real runtime implementation.

Rules:

- keep runtime-specific APIs behind `runtime-kit`
- keep domain and protocol packages runtime-neutral
- avoid direct Worker-only or Node-only assumptions in domain code
- delay second runtime support until after the first demo is stable

## Error Handling

### Service Failures

- every run must have explicit states: `pending`, `running`, `failed`, `completed`, `canceled`
- `agent-loop-service` handles retries and dead-letter style recovery
- partial provider failures must surface as trace events, not silent fallthrough

### Story Consistency Failures

- invalid node snapshot blocks branch continuation
- branch generation failures must preserve prior branch state
- consistency repair should be modeled as an explicit run type, not hidden magic

### Migration Risks

- if a `novel-copilot` component still assumes chapter-specific inputs, wrap it in `copilot-bridge` instead of pushing that assumption into core services

## Testing Strategy

Testing should start with platform contracts, not only UI flows.

### Contract Tests

Validate:

- domain schema
- API DTOs
- agent protocol payloads

### Service Tests

Validate:

- fork creation
- branch run lifecycle
- graph query correctness
- retry and run-state transitions

### Golden Tests

Validate:

- same node snapshot + same branch intent -> acceptable continuation stability
- character/world continuity across repeated branch runs

## Four-Week Roadmap

### Week 1

- define monorepo skeleton
- create shared packages
- create service skeletons
- write first-pass schema for story graph and branch runs

### Week 2

- extract provider abstraction from `novel-copilot`
- extract agent orchestrator and tool execution into `agent-core-service`
- isolate runtime dependencies behind `runtime-kit`

### Week 3

- implement `story-service`
- implement `fork -> run` chain between `story-service`, `agent-loop-service`, and `agent-core-service`
- persist graph and run state

### Week 4

- add minimal `studio-web`
- add minimal `reader-web`
- show canonical node, fork entry, branch run progress, and branch output
- run one end-to-end demo

## Main Risks

### 1. Chapter-Specific Coupling Survives Extraction

Risk:

Current agent logic is still shaped around chapter generation.

Mitigation:

Promote task-oriented service contracts and quarantine old semantics inside `copilot-bridge`.

### 2. StoryNode Snapshots Are Too Weak

Risk:

Forked continuation becomes inconsistent, breaking the core product promise.

Mitigation:

Treat snapshot completeness as a first-class contract and cover it with golden tests.

### 3. Loop and Core Responsibilities Blur

Risk:

`agent-loop-service` and `agent-core-service` become one tangled service.

Mitigation:

Keep job lifecycle and reasoning/tool execution as separate service concerns from day one.

## Success Criteria

Phase 1 is successful when all of the following are true:

- a canonical story node can be persisted
- a user can fork from that node
- a branch run can be started asynchronously
- AI can continue the branch using preserved state
- the graph relationship between canonical and branch lines is visible
- the system boundary is clean enough that `novel-copilot` is now a source of migrated capabilities, not the shell of the new platform

## Immediate Next Planning Target

The next planning artifact should translate this design into a concrete implementation plan for:

- repository bootstrap
- package and service creation order
- extraction tasks from `novel-copilot`
- schema and API milestones
- end-to-end demo definition
