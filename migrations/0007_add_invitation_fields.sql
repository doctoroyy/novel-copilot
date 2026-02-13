-- Add used_count column to invitation_codes table
ALTER TABLE invitation_codes ADD COLUMN used_count INTEGER DEFAULT 0;

-- Add is_active column to invitation_codes table
ALTER TABLE invitation_codes ADD COLUMN is_active INTEGER DEFAULT 1;
