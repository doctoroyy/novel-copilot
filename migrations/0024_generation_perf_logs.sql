-- 全链路性能日志表
-- 持久化每一章的完整性能数据，用于排查生成慢的问题
CREATE TABLE generation_perf_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  project_id TEXT NOT NULL,
  chapter_index INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  -- 阶段耗时（毫秒）
  total_duration_ms INTEGER NOT NULL,
  context_build_ms INTEGER DEFAULT 0,
  planning_ms INTEGER DEFAULT 0,
  main_draft_ms INTEGER DEFAULT 0,
  self_review_ms INTEGER DEFAULT 0,
  quick_qc_ms INTEGER DEFAULT 0,
  full_qc_ms INTEGER DEFAULT 0,
  summary_ms INTEGER DEFAULT 0,
  character_state_ms INTEGER DEFAULT 0,
  plot_graph_ms INTEGER DEFAULT 0,
  timeline_ms INTEGER DEFAULT 0,
  db_save_ms INTEGER DEFAULT 0,
  -- AI 调用统计
  ai_call_count INTEGER DEFAULT 0,
  total_ai_duration_ms INTEGER DEFAULT 0,
  -- token 统计（估算）
  estimated_prompt_tokens INTEGER DEFAULT 0,
  estimated_output_tokens INTEGER DEFAULT 0,
  -- 状态
  was_rewritten INTEGER DEFAULT 0,
  rewrite_count INTEGER DEFAULT 0,
  summary_skipped INTEGER DEFAULT 0,
  -- 详细 AI 调用链（JSON 数组）
  ai_call_traces TEXT,
  -- 队列延迟
  queue_latency_ms INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_perf_logs_project ON generation_perf_logs(project_id, chapter_index);
CREATE INDEX idx_perf_logs_task ON generation_perf_logs(task_id);
