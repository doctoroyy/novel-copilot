export interface ContextPackage {
  taskId: string;
  projectId: string;
  chapterIndex: number;
  
  // The essential information the agent always gets in its system prompt/context
  essentials: {
    rollingSummary: string; // Recent 1-3 chapters summary
    currentBlueprint?: string; // If generating a chapter, the blueprint for it
    relevantCharacterStates?: any;
    relevantPlotThreads?: any;
    writingStyleRules: string;
  };
  
  // Available resource index (tells the agent what it CAN query if needed)
  availableResources: {
    chapters: number[]; // e.g., [1, 2, 3, 4]
    storyVaultSections: string[]; // e.g., ["world_building", "magic_system"]
  };
}

export function buildContextPackage(params: {
  taskId: string;
  projectId: string;
  chapterIndex: number;
  rollingSummary: string;
  currentBlueprint?: string;
  writingStyleRules: string;
  totalChapters: number;
}): ContextPackage {
  
  // Slim down the context. The agent relies on tools for deep dives.
  const pkg: ContextPackage = {
    taskId: params.taskId,
    projectId: params.projectId,
    chapterIndex: params.chapterIndex,
    essentials: {
      rollingSummary: params.rollingSummary,
      currentBlueprint: params.currentBlueprint,
      writingStyleRules: params.writingStyleRules,
    },
    availableResources: {
      chapters: Array.from({ length: params.totalChapters }, (_, i) => i + 1),
      storyVaultSections: ['active_plots', 'pending_foreshadowing', 'causal_chains', 'recent_events'],
    }
  };

  return pkg;
}

export function serializeContextPackage(pkg: ContextPackage): string {
  // Format the essentials for the LLM
  return `
# 当前任务上下文
Task ID: ${pkg.taskId}
Project: ${pkg.projectId}
Target Chapter: ${pkg.chapterIndex}

## 核心故事摘要 (Essentials)
${pkg.essentials.rollingSummary || '无'}

## 写作风格与规则
${pkg.essentials.writingStyleRules || '无'}

${pkg.essentials.currentBlueprint ? `## 本章蓝图 (Blueprint)\n${pkg.essentials.currentBlueprint}\n` : ''}

## 可调用的资源目录 (用工具按需读取)
已存在章节: ${pkg.availableResources.chapters.length > 0 ? `1 - ${Math.max(...pkg.availableResources.chapters)}` : '无'}
设定集切片: ${pkg.availableResources.storyVaultSections.join(', ')}
`;
}
