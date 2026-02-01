/**
 * 配置管理器
 * 
 * 集中管理系统配置，支持默认配置和项目级覆盖
 */

import type { ContextBudget } from '../contextOptimizer.js';

/**
 * QC 配置
 */
export interface QCConfig {
  /** 是否启用快速 QC */
  enableQuickQC: boolean;
  /** 是否启用完整 QC */
  enableFullQC: boolean;
  /** 是否启用自动修复 */
  enableAutoRepair: boolean;
  /** 最大修复尝试次数 */
  maxRepairAttempts: number;
  /** 通过分数阈值 */
  passScoreThreshold: number;
  /** 宽松模式（跳过次要问题） */
  relaxedMode: boolean;
}

/**
 * 重试配置
 */
export interface RetryConfig {
  /** 每个提供商的最大重试次数 */
  maxRetriesPerProvider: number;
  /** Rate limit 错误的基础延迟（毫秒） */
  rateLimitBaseDelay: number;
  /** 其他错误的基础延迟（毫秒） */
  otherErrorBaseDelay: number;
  /** 是否启用降级到备用提供商 */
  enableFallback: boolean;
}

/**
 * 流式输出配置
 */
export interface StreamConfig {
  /** 心跳间隔（毫秒） */
  heartbeatInterval: number;
  /** 是否启用 Token 级流式输出 */
  enableTokenStreaming: boolean;
  /** 连接超时（毫秒） */
  connectionTimeout: number;
}

/**
 * 生成配置
 */
export interface GenerationConfig {
  /** 默认生成温度 */
  defaultTemperature: number;
  /** 最大输出 token 数 */
  maxOutputTokens?: number;
  /** 是否跳过摘要更新 */
  skipSummaryUpdate: boolean;
  /** 是否跳过状态更新 */
  skipStateUpdate: boolean;
}

/**
 * 系统配置
 */
export interface SystemConfig {
  /** 上下文预算配置 */
  context: ContextBudget;
  /** QC 配置 */
  qc: QCConfig;
  /** 重试配置 */
  retry: RetryConfig;
  /** 流式输出配置 */
  streaming: StreamConfig;
  /** 生成配置 */
  generation: GenerationConfig;
}

/**
 * 默认上下文预算
 */
const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  totalTokens: 16000,
  allocation: {
    bible: 0.15,
    characterState: 0.10,
    plotContext: 0.10,
    timeline: 0.10,
    rollingSummary: 0.15,
    lastChapters: 0.25,
    narrativeGuide: 0.10,
  },
};

/**
 * 默认系统配置
 */
const DEFAULT_CONFIG: SystemConfig = {
  context: DEFAULT_CONTEXT_BUDGET,
  qc: {
    enableQuickQC: true,
    enableFullQC: false,
    enableAutoRepair: false,
    maxRepairAttempts: 2,
    passScoreThreshold: 70,
    relaxedMode: false,
  },
  retry: {
    maxRetriesPerProvider: 3,
    rateLimitBaseDelay: 5000,
    otherErrorBaseDelay: 1000,
    enableFallback: true,
  },
  streaming: {
    heartbeatInterval: 5000,
    enableTokenStreaming: true,
    connectionTimeout: 30000,
  },
  generation: {
    defaultTemperature: 0.8,
    maxOutputTokens: undefined,
    skipSummaryUpdate: false,
    skipStateUpdate: false,
  },
};

/**
 * 项目级配置覆盖
 */
const projectConfigs = new Map<string, Partial<SystemConfig>>();

/**
 * 深度合并配置对象
 */
function deepMerge<T extends Record<string, any>>(base: T, override: Partial<T>): T {
  const result = { ...base };
  
  for (const key of Object.keys(override) as (keyof T)[]) {
    const overrideValue = override[key];
    if (overrideValue !== undefined) {
      if (
        typeof overrideValue === 'object' &&
        overrideValue !== null &&
        !Array.isArray(overrideValue) &&
        typeof result[key] === 'object' &&
        result[key] !== null
      ) {
        result[key] = deepMerge(result[key] as Record<string, any>, overrideValue as Record<string, any>) as T[keyof T];
      } else {
        result[key] = overrideValue as T[keyof T];
      }
    }
  }
  
  return result;
}

/**
 * 获取配置
 * @param projectId 项目 ID（可选，用于获取项目级覆盖）
 */
export function getConfig(projectId?: string): SystemConfig {
  if (projectId) {
    const projectOverride = projectConfigs.get(projectId);
    if (projectOverride) {
      return deepMerge(DEFAULT_CONFIG, projectOverride);
    }
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * 设置项目级配置覆盖
 * @param projectId 项目 ID
 * @param config 配置覆盖
 */
export function setProjectConfig(projectId: string, config: Partial<SystemConfig>): void {
  const existing = projectConfigs.get(projectId) || {};
  projectConfigs.set(projectId, deepMerge(existing, config));
}

/**
 * 清除项目级配置
 * @param projectId 项目 ID
 */
export function clearProjectConfig(projectId: string): void {
  projectConfigs.delete(projectId);
}

/**
 * 获取所有项目配置的键
 */
export function getProjectConfigKeys(): string[] {
  return Array.from(projectConfigs.keys());
}

/**
 * 根据模型类型调整上下文预算
 */
export function getContextBudgetForModel(model: string): ContextBudget {
  const baseConfig = getConfig().context;
  
  // 根据模型调整 token 预算
  const modelContextSizes: Record<string, number> = {
    // Gemini models
    'gemini-2.0-flash': 128000,
    'gemini-1.5-pro': 128000,
    'gemini-1.5-flash': 128000,
    // OpenAI models
    'gpt-4o': 128000,
    'gpt-4-turbo': 128000,
    'gpt-4': 8192,
    'gpt-3.5-turbo': 4096,
    // DeepSeek models
    'deepseek-chat': 32000,
    'deepseek-coder': 32000,
  };
  
  // 找到匹配的模型或使用默认值
  let contextSize = 16000;
  for (const [modelName, size] of Object.entries(modelContextSizes)) {
    if (model.includes(modelName)) {
      contextSize = size;
      break;
    }
  }
  
  // 使用模型上下文的 10% 作为预算（保守策略）
  const adjustedTokens = Math.min(contextSize * 0.1, 32000);
  
  return {
    ...baseConfig,
    totalTokens: adjustedTokens,
  };
}

/**
 * 导出默认配置供参考
 */
export { DEFAULT_CONFIG, DEFAULT_CONTEXT_BUDGET };
