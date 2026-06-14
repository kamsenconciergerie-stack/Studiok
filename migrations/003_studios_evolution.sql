-- ══════════════════════════════════════════════════════════
-- Migration 003 — Evolution de la table studios
-- ══════════════════════════════════════════════════════════

ALTER TABLE studios ADD COLUMN IF NOT EXISTS slug             VARCHAR(300);
ALTER TABLE studios ADD COLUMN IF NOT EXISTS pays             VARCHAR(2)              DEFAULT 'SN';
ALTER TABLE studios ADD COLUMN IF NOT EXISTS adresse_complete TEXT;
ALTER TABLE studios ADD COLUMN IF NOT EXISTS latitude         DECIMAL(10, 8);
ALTER TABLE studios ADD COLUMN IF NOT EXISTS longitude        DECIMAL(11, 8);
ALTER TABLE studios ADD COLUMN IF NOT EXISTS capacite_max     SMALLINT                DEFAULT 1;
ALTER TABLE studios ADD COLUMN IF NOT EXISTS devise           VARCHAR(3)              DEFAULT 'XOF';
ALTER TABLE studios ADD COLUMN IF NOT EXISTS regles           TEXT;
ALTER TABLE studios ADD COLUMN IF NOT EXISTS nb_reservations  INTEGER                 DEFAULT 0;
ALTER TABLE studios ADD COLUMN IF NOT EXISTS valide_admin     BOOLEAN                 DEFAULT false;
ALTER TABLE studios ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE studios ADD COLUMN IF NOT EXISTS deleted_at       TIMESTAMP WITH TIME ZONE;

-- Ajouter la FK hote_id si elle n'existe pas encore
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'studios_hote_id_fkey'
  ) THEN
    ALTER TABLE studios ADD CONSTRAINT studios_hote_id_fkey
      FOREIGN KEY (hote_id) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Générer les slugs pour les studios existants
UPDATE studios
SET slug = LOWER(
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      UNACCENT(nom),
      '[^a-zA-Z0-9\s-]', '', 'g'
    ),
    '\s+', '-', 'g'
  )
) || '-' || id::text
WHERE slug IS NULL;

-- Rendre slug unique après backfill
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'studios_slug_unique'
  ) THEN
    ALTER TABLE studios ADD CONSTRAINT studios_slug_unique UNIQUE (slug);
  END IF;
END $$;

-- Index
CREATE INDEX IF NOT EXISTS idx_studios_hote       ON studios(hote_id)       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_studios_type_ville  ON studios(type, ville)   WHERE disponible = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_studios_pays_ville  ON studios(pays, ville)   WHERE disponible = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_studios_prix        ON studios(prix_heure)    WHERE disponible = true;
CREATE INDEX IF NOT EXISTS idx_studios_note        ON studios(note DESC)     WHERE disponible = true;
CREATE INDEX IF NOT EXISTS idx_studios_slug        ON studios(slug)          WHERE deleted_at IS NULL;

-- Index de recherche textuelle (nécessite pg_trgm de la migration 001)
CREATE INDEX IF NOT EXISTS idx_studios_search ON studios
  USING gin(to_tsvector('french', nom || ' ' || COALESCE(description, '') || ' ' || COALESCE(quartier, '')));

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_studios_updated_at ON studios;
CREATE TRIGGER trg_studios_updated_at
  BEFORE UPDATE ON studios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
