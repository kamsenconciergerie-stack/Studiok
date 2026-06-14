-- ══════════════════════════════════════════════════════════
-- Migration 005 — Toutes les nouvelles tables
-- Ordre respecté selon les dépendances (FK)
-- ══════════════════════════════════════════════════════════

-- ── 1. DISPONIBILITÉS RÉCURRENTES ──────────────────────────

CREATE TABLE IF NOT EXISTS disponibilites_recurrentes (
  id           UUID     PRIMARY KEY DEFAULT uuid_generate_v4(),
  studio_id    INTEGER  NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  jour_semaine SMALLINT NOT NULL CHECK (jour_semaine BETWEEN 0 AND 6), -- 0=Dim, 1=Lun ... 6=Sam
  heure_debut  TIME     NOT NULL,
  heure_fin    TIME     NOT NULL,
  actif        BOOLEAN  DEFAULT true,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CHECK (heure_debut < heure_fin)
);

CREATE INDEX IF NOT EXISTS idx_dispo_rec_studio ON disponibilites_recurrentes(studio_id) WHERE actif = true;
CREATE INDEX IF NOT EXISTS idx_dispo_rec_jour   ON disponibilites_recurrentes(studio_id, jour_semaine) WHERE actif = true;

-- ── 2. BLOCAGES PONCTUELS ──────────────────────────────────

CREATE TABLE IF NOT EXISTS blocages_ponctuels (
  id         UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  studio_id  INTEGER NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  debut      TIMESTAMP WITH TIME ZONE NOT NULL,
  fin        TIMESTAMP WITH TIME ZONE NOT NULL,
  motif      VARCHAR(100) DEFAULT 'indisponible'
             CHECK (motif IN ('indisponible', 'maintenance', 'reserve', 'ferie', 'autre')),
  note       TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CHECK (debut < fin),
  EXCLUDE USING gist (
    studio_id WITH =,
    tstzrange(debut, fin, '[)') WITH &&
  )
);

CREATE INDEX IF NOT EXISTS idx_blocages_studio ON blocages_ponctuels(studio_id, debut, fin);

-- ── 3. EVOLUTION TABLE RESERVATIONS ───────────────────────

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS montant_ht       INTEGER;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS frais_service     INTEGER DEFAULT 0;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS devise            VARCHAR(3) DEFAULT 'XOF';
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS idempotency_key   VARCHAR(100);
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS annulee_par       UUID REFERENCES users(id);
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS motif_annulation  TEXT;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS annulee_at        TIMESTAMP WITH TIME ZONE;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Backfill montant_ht depuis montant_total
UPDATE reservations SET montant_ht = montant_total WHERE montant_ht IS NULL;

-- Contrainte d'exclusion anti-chevauchement sur réservations confirmées
-- (protège au niveau DB, pas seulement applicatif)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_no_overlap'
  ) THEN
    ALTER TABLE reservations ADD CONSTRAINT reservations_no_overlap
      EXCLUDE USING gist (
        studio_id WITH =,
        tstzrange(date_debut, date_fin, '[)') WITH &&
      ) WHERE (statut IN ('confirmee', 'en_cours'));
  END IF;
END $$;

-- Index réservations
CREATE INDEX IF NOT EXISTS idx_resa_studio_dates  ON reservations(studio_id, date_debut, date_fin);
CREATE INDEX IF NOT EXISTS idx_resa_user          ON reservations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resa_statut        ON reservations(statut, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resa_studio_actif  ON reservations(studio_id, statut)
  WHERE statut NOT IN ('annulee', 'remboursee');

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_reservations_updated_at ON reservations;
CREATE TRIGGER trg_reservations_updated_at
  BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 4. AVIS ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS avis (
  id               UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id   UUID    NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  studio_id        INTEGER NOT NULL REFERENCES studios(id)       ON DELETE CASCADE,
  auteur_id        UUID    NOT NULL REFERENCES users(id)         ON DELETE CASCADE,

  note             SMALLINT NOT NULL CHECK (note BETWEEN 1 AND 5),
  titre            VARCHAR(255),
  commentaire      TEXT,

  note_proprete    SMALLINT CHECK (note_proprete    BETWEEN 1 AND 5),
  note_equipement  SMALLINT CHECK (note_equipement  BETWEEN 1 AND 5),
  note_acces       SMALLINT CHECK (note_acces       BETWEEN 1 AND 5),
  note_rapport     SMALLINT CHECK (note_rapport     BETWEEN 1 AND 5),

  reponse_hote     TEXT,
  reponse_at       TIMESTAMP WITH TIME ZONE,
  est_visible      BOOLEAN  DEFAULT true,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT avis_unique_par_reservation UNIQUE (reservation_id, auteur_id)
);

CREATE INDEX IF NOT EXISTS idx_avis_studio ON avis(studio_id, created_at DESC) WHERE est_visible = true;
CREATE INDEX IF NOT EXISTS idx_avis_auteur ON avis(auteur_id, created_at DESC);

-- Trigger : recalcule note moyenne du studio après chaque avis
CREATE OR REPLACE FUNCTION recalc_note_studio()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE studios
  SET
    note    = (SELECT ROUND(AVG(note)::numeric, 2)
               FROM avis
               WHERE studio_id = COALESCE(NEW.studio_id, OLD.studio_id)
               AND est_visible = true),
    nb_avis = (SELECT COUNT(*)
               FROM avis
               WHERE studio_id = COALESCE(NEW.studio_id, OLD.studio_id)
               AND est_visible = true)
  WHERE id = COALESCE(NEW.studio_id, OLD.studio_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_avis_recalc_note ON avis;
CREATE TRIGGER trg_avis_recalc_note
  AFTER INSERT OR UPDATE OR DELETE ON avis
  FOR EACH ROW EXECUTE FUNCTION recalc_note_studio();

-- ── 5. PAIEMENTS ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS paiements (
  id                 UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id     UUID    NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  user_id            UUID    NOT NULL REFERENCES users(id)         ON DELETE RESTRICT,

  montant            INTEGER NOT NULL CHECK (montant > 0),
  devise             VARCHAR(3) NOT NULL DEFAULT 'XOF',
  frais_provider     INTEGER DEFAULT 0,

  provider           VARCHAR(30) NOT NULL
                     CHECK (provider IN ('wave', 'orange_money', 'free_money', 'carte', 'virement', 'cash', 'autre')),
  type_transaction   VARCHAR(20) NOT NULL DEFAULT 'debit'
                     CHECK (type_transaction IN ('debit', 'remboursement', 'commission')),

  reference_externe  VARCHAR(255) UNIQUE,
  telephone_paiement VARCHAR(20),
  numero_carte_last4 VARCHAR(4),

  statut             VARCHAR(20) NOT NULL DEFAULT 'initie'
                     CHECK (statut IN ('initie', 'en_attente', 'confirme', 'echoue', 'rembourse', 'expire')),

  webhook_recu_at    TIMESTAMP WITH TIME ZONE,
  webhook_payload    JSONB,

  idempotency_key    VARCHAR(100) UNIQUE,
  expire_at          TIMESTAMP WITH TIME ZONE,
  confirme_at        TIMESTAMP WITH TIME ZONE,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  metadata           JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_paiements_reservation    ON paiements(reservation_id);
CREATE INDEX IF NOT EXISTS idx_paiements_user           ON paiements(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paiements_provider       ON paiements(provider, statut);
CREATE INDEX IF NOT EXISTS idx_paiements_ref_externe    ON paiements(reference_externe) WHERE reference_externe IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_paiements_expire         ON paiements(expire_at) WHERE statut = 'initie';

DROP TRIGGER IF EXISTS trg_paiements_updated_at ON paiements;
CREATE TRIGGER trg_paiements_updated_at
  BEFORE UPDATE ON paiements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 6. MESSAGERIE ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversations (
  id             UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id UUID    REFERENCES reservations(id) ON DELETE SET NULL,
  hote_id        UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  createur_id    UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  statut         VARCHAR(20) DEFAULT 'active'
                 CHECK (statut IN ('active', 'archivee', 'bloquee')),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT conv_unique_paire UNIQUE (hote_id, createur_id, reservation_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  expediteur_id   UUID    NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
  contenu         TEXT    NOT NULL,
  type_contenu    VARCHAR(20) DEFAULT 'texte'
                  CHECK (type_contenu IN ('texte', 'image', 'fichier')),
  fichier_url     TEXT,
  lu_at           TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv      ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_non_lus   ON messages(conversation_id) WHERE lu_at IS NULL;

DROP TRIGGER IF EXISTS trg_conversations_updated_at ON conversations;
CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 7. NOTIFICATIONS ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id             UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type           VARCHAR(50) NOT NULL
                 CHECK (type IN (
                   'nouvelle_reservation', 'reservation_confirmee', 'reservation_annulee',
                   'paiement_recu', 'paiement_echoue', 'nouvel_avis',
                   'nouveau_message', 'studio_valide', 'rappel_reservation'
                 )),
  titre          VARCHAR(255) NOT NULL,
  corps          TEXT,
  lien           VARCHAR(500),
  envoyee_email  BOOLEAN DEFAULT false,
  envoyee_push   BOOLEAN DEFAULT false,
  envoyee_sms    BOOLEAN DEFAULT false,
  lu_at          TIMESTAMP WITH TIME ZONE,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifs_user     ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifs_non_lues ON notifications(user_id) WHERE lu_at IS NULL;

-- ── 8. AUDIT LOGS ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id                BIGSERIAL PRIMARY KEY,
  table_name        VARCHAR(100) NOT NULL,
  operation         VARCHAR(10)  NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  record_id         TEXT         NOT NULL,
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  ip_address        INET,
  anciennes_valeurs JSONB,
  nouvelles_valeurs JSONB,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_table  ON audit_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_date   ON audit_logs(created_at DESC);
