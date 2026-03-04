/**
 * ReAct Agent 类型定义
 */

/** Agent 可调用的工具定义 */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, {
    type: string;
    description: string;
    required?: boolean;
    enum?: string[];
  }>;
};

/** 工具调用请求 */
export type ToolCall = {
  tool: string;
  args: Record<string, any>;
};

/** Agent 单轮推理结果 */
export type AgentTurn = {
  thought: string;
  toolCalls?: ToolCall[];
  finalOutput?: string;
  metadata?: {
    confidence: number;
    phase: string;
  };
};

/** Agent 执行的完整轨迹 */
export type AgentTrace = {
  turns: {
    turnIndex: number;
    thought: string;
    toolCalls: { tool: string; args: any; result: string }[];
    durationMs: number;
  }[];
  totalTurns: number;
  totalDurationMs: number;
  totalToolCalls: number;
};

/** Agent 运行时状态（scratchpad） */
export type AgentState = {
  scratchpad: string;
  currentDraft: string | null;
  queriedTools: Set<string>;
  turnCount: number;
};

/** Agent 配置 */
export type AgentConfig = {
  maxTurns: number;
  maxToolCallsPerTurn: number;
  enableReaderSimulation: boolean;
  maxAICalls: number;
  onProgress?: (phase: string, detail: string) => void;
};

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxTurns: 8,
  maxToolCallsPerTurn: 3,
  enableReaderSimulation: true,
  maxAICalls: 15,
};
