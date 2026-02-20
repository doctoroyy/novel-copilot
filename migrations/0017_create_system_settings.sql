-- Global system settings table
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  description TEXT,
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

INSERT OR IGNORE INTO system_settings (setting_key, setting_value, description)
VALUES ('summary_update_interval', '2', '批量生成时摘要更新间隔（章）');
