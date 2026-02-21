-- Per-project minimum chapter word count
ALTER TABLE states ADD COLUMN min_chapter_words INTEGER DEFAULT 2500;
