-- Add dedicated feature key for rolling summary model routing
INSERT OR IGNORE INTO credit_features (
  feature_key,
  name,
  description,
  base_cost,
  model_multiplier_enabled,
  is_vip_only,
  is_active,
  category
) VALUES (
  'generate_summary_update',
  '更新剧情摘要',
  '在章节生成后更新滚动剧情摘要与未解伏笔',
  2,
  1,
  0,
  1,
  'basic'
);
