-- ══════════════════════════════════════════════════════════
-- Migration 002 — Evolution de la table users
-- Ajoute les colonnes sans toucher aux existantes (safe)
-- ══════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS bio               TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pays              VARCHAR(2)              DEFAULT 'SN';
ALTER TABLE users ADD COLUMN IF NOT EXISTS ville             VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS langue_pref       VARCHAR(5)              DEFAULT 'fr';
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified    BOOLEAN                 DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active         BOOLEAN                 DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS derniere_connexion TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at        TIMESTAMP WITH TIME ZONE;

-- Index
CREATE INDEX IF NOT EXISTS idx_users_email      ON users(email)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_role       ON users(role)       WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_users_pays_ville ON users(pays, ville) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
