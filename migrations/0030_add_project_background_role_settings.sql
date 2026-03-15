-- Add background and role_settings columns to projects table
ALTER TABLE projects ADD COLUMN background TEXT DEFAULT NULL;
ALTER TABLE projects ADD COLUMN role_settings TEXT DEFAULT NULL;
