-- ══════════════════════════════════════════════════════════
-- Migration 004 — Table studio_photos + migration depuis TEXT[]
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS studio_photos (
  id             UUID     PRIMARY KEY DEFAULT uuid_generate_v4(),
  studio_id      INTEGER  NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  url            TEXT     NOT NULL,
  url_thumb      TEXT,
  url_medium     TEXT,
  nom_fichier    VARCHAR(255),
  taille_bytes   INTEGER,
  ordre          SMALLINT DEFAULT 0,
  est_couverture BOOLEAN  DEFAULT false,
  uploaded_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_studio_photos_studio ON studio_photos(studio_id);
CREATE INDEX IF NOT EXISTS idx_studio_photos_couv   ON studio_photos(studio_id) WHERE est_couverture = true;

-- Contrainte : une seule photo de couverture par studio
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'idx_studio_photos_unique_couv'
  ) THEN
    CREATE UNIQUE INDEX idx_studio_photos_unique_couv
      ON studio_photos(studio_id) WHERE est_couverture = true;
  END IF;
END $$;

-- Migrer les photos existantes depuis studios.photos (TEXT[])
INSERT INTO studio_photos (studio_id, url, ordre, est_couverture)
SELECT
  s.id,
  UNNEST(s.photos) AS url,
  (ROW_NUMBER() OVER (PARTITION BY s.id ORDER BY 1) - 1) AS ordre,
  (ROW_NUMBER() OVER (PARTITION BY s.id ORDER BY 1) = 1) AS est_couverture
FROM studios s
WHERE s.photos IS NOT NULL AND array_length(s.photos, 1) > 0
ON CONFLICT DO NOTHING;

-- VÉRIFICATION MANUELLE avant de supprimer la colonne photos :
-- SELECT COUNT(*) FROM studio_photos;
-- Si > 0 et que tout semble correct, exécuter :
-- ALTER TABLE studios DROP COLUMN IF EXISTS photos;
-- (ne pas le faire automatiquement ici — vérifier d'abord en production)
