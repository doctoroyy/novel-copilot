-- Per-project chapter generation prompt configuration
ALTER TABLE projects ADD COLUMN chapter_prompt_profile TEXT DEFAULT 'web_novel_light';
ALTER TABLE projects ADD COLUMN chapter_prompt_custom TEXT DEFAULT '';
