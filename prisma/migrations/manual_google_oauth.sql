-- Migration: Add Google OAuth columns to users table
-- Alasan: Mendukung login/register via Google SSO
-- Impact: password menjadi nullable (Google-only users), google_id sebagai identifier unik Google

ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) DEFAULT 'local';
