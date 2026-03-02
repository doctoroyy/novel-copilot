-- Add enabled and display_order columns to provider_registry
ALTER TABLE provider_registry ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE provider_registry ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
