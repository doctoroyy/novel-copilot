/**
 * 日志与监控模块
 * 
 * 记录生成过程的关键指标，用于调试和性能优化
 */

/**
 * 生成阶段
 */
export type GenerationPhase = 
  | 'context_build'
  | 'prompt_prepare'
  | 'model_call'
  | 'qc_check'
  | 'repair'
  | 'summary_update'
  | 'state_save';

/**
 * 生成指标
 */
export interface GenerationMetrics {
  /** 项目 ID */
  projectId: string;
  /** 章节索引 */
  chapterIndex: number;
  /** 提示词 token 数（估算） */
  promptTokens: number;
  /** 输出 token 数（估算） */
  outputTokens: number;
  /** 总生成时间（毫秒） */
  generationTime: number;
  /** 各阶段耗时 */
  phaseTimes: Partial<Record<GenerationPhase, number>>;
  /** QC 尝试次数 */
  qcAttempts: number;
  /** QC 最终分数 */
  qcFinalScore?: number;
  /** 是否重写 */
  wasRewritten: boolean;
  /** 使用的模型 */
  model: string;
  /** 使用的提供商 */
  provider: string;
  /** 错误信息（如果有） */
  error?: string;
  /** 时间戳 */
  timestamp: Date;
}

/**
 * 项目统计
 */
export interface ProjectStats {
  /** 总生成章节数 */
  totalChapters: number;
  /** 成功章节数 */
  successfulChapters: number;
  /** 失败章节数 */
  failedChapters: number;
  /** 平均生成时间（毫秒） */
  averageGenerationTime: number;
  /** 平均 QC 分数 */
  averageQCScore: number;
  /** 重写率 */
  rewriteRate: number;
  /** 总 token 消耗（估算） */
  totalTokensUsed: number;
  /** 按阶段的平均耗时 */
  averagePhaseTimes: Partial<Record<GenerationPhase, number>>;
}

/**
 * 日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 日志配置
 */
export interface LogConfig {
  /** 日志级别 */
  level: LogLevel;
  /** 是否记录提示词 */
  logPrompts: boolean;
  /** 是否记录响应 */
  logResponses: boolean;
  /** 最大日志条目数 */
  maxEntries: number;
}

/**
 * 默认日志配置
 */
const DEFAULT_LOG_CONFIG: LogConfig = {
  level: 'info',
  logPrompts: false,
  logResponses: false,
  maxEntries: 1000,
};

/**
 * 日志级别优先级
 */
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * 内存日志存储
 */
const metricsStore = new Map<string, GenerationMetrics[]>();
let logConfig = { ...DEFAULT_LOG_CONFIG };

/**
 * 设置日志配置
 */
export function setLogConfig(config: Partial<LogConfig>): void {
  logConfig = { ...logConfig, ...config };
}

/**
 * 获取日志配置
 */
export function getLogConfig(): LogConfig {
  return { ...logConfig };
}

/**
 * 记录生成指标
 */
export function logGenerationMetrics(metrics: GenerationMetrics): void {
  const key = metrics.projectId;
  
  if (!metricsStore.has(key)) {
    metricsStore.set(key, []);
  }
  
  const projectMetrics = metricsStore.get(key)!;
  projectMetrics.push(metrics);
  
  // 限制存储数量
  if (projectMetrics.length > logConfig.maxEntries) {
    projectMetrics.shift();
  }
  
  // 输出日志
  log('info', `[Chapter ${metrics.chapterIndex}] Generated in ${metrics.generationTime}ms`, {
    tokens: metrics.promptTokens + metrics.outputTokens,
    qcScore: metrics.qcFinalScore,
    rewritten: metrics.wasRewritten,
  });
}

/**
 * 获取项目统计
 */
export function getProjectStats(projectId: string): ProjectStats | null {
  const metrics = metricsStore.get(projectId);
  
  if (!metrics || metrics.length === 0) {
    return null;
  }
  
  const successful = metrics.filter(m => !m.error);
  const failed = metrics.filter(m => m.error);
  
  // 计算平均值
  const avgTime = successful.length > 0
    ? successful.reduce((sum, m) => sum + m.generationTime, 0) / successful.length
    : 0;
  
  const avgQC = successful.filter(m => m.qcFinalScore !== undefined).length > 0
    ? successful.reduce((sum, m) => sum + (m.qcFinalScore || 0), 0) / 
      successful.filter(m => m.qcFinalScore !== undefined).length
    : 0;
  
  const rewriteCount = successful.filter(m => m.wasRewritten).length;
  
  const totalTokens = metrics.reduce((sum, m) => sum + m.promptTokens + m.outputTokens, 0);
  
  // 计算各阶段平均耗时
  const phaseTotals: Partial<Record<GenerationPhase, { sum: number; count: number }>> = {};
  for (const m of successful) {
    for (const [phase, time] of Object.entries(m.phaseTimes)) {
      if (!phaseTotals[phase as GenerationPhase]) {
        phaseTotals[phase as GenerationPhase] = { sum: 0, count: 0 };
      }
      phaseTotals[phase as GenerationPhase]!.sum += time;
      phaseTotals[phase as GenerationPhase]!.count += 1;
    }
  }
  
  const averagePhaseTimes: Partial<Record<GenerationPhase, number>> = {};
  for (const [phase, data] of Object.entries(phaseTotals)) {
    averagePhaseTimes[phase as GenerationPhase] = data.sum / data.count;
  }
  
  return {
    totalChapters: metrics.length,
    successfulChapters: successful.length,
    failedChapters: failed.length,
    averageGenerationTime: avgTime,
    averageQCScore: avgQC,
    rewriteRate: successful.length > 0 ? rewriteCount / successful.length : 0,
    totalTokensUsed: totalTokens,
    averagePhaseTimes,
  };
}

/**
 * 获取项目的所有指标
 */
export function getProjectMetrics(projectId: string): GenerationMetrics[] {
  return metricsStore.get(projectId) || [];
}

/**
 * 清除项目指标
 */
export function clearProjectMetrics(projectId: string): void {
  metricsStore.delete(projectId);
}

/**
 * 获取最近的错误
 */
export function getRecentErrors(projectId: string, limit = 10): GenerationMetrics[] {
  const metrics = metricsStore.get(projectId) || [];
  return metrics
    .filter(m => m.error)
    .slice(-limit);
}

/**
 * 通用日志函数
 */
export function log(level: LogLevel, message: string, data?: Record<string, any>): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[logConfig.level]) {
    return;
  }
  
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  
  if (data) {
    console.log(prefix, message, JSON.stringify(data));
  } else {
    console.log(prefix, message);
  }
}

/**
 * 调试日志
 */
export function debug(message: string, data?: Record<string, any>): void {
  log('debug', message, data);
}

/**
 * 信息日志
 */
export function info(message: string, data?: Record<string, any>): void {
  log('info', message, data);
}

/**
 * 警告日志
 */
export function warn(message: string, data?: Record<string, any>): void {
  log('warn', message, data);
}

/**
 * 错误日志
 */
export function error(message: string, data?: Record<string, any>): void {
  log('error', message, data);
}

/**
 * 创建计时器
 */
export function createTimer(): { elapsed: () => number } {
  const start = Date.now();
  return {
    elapsed: () => Date.now() - start,
  };
}

/**
 * 包装函数以测量执行时间
 */
export async function measureTime<T>(
  phase: GenerationPhase,
  fn: () => Promise<T>,
  phaseTimes: Partial<Record<GenerationPhase, number>>
): Promise<T> {
  const timer = createTimer();
  try {
    return await fn();
  } finally {
    phaseTimes[phase] = timer.elapsed();
  }
}
