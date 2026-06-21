-- 010 — Canonical Event Graph: participantes, aliases, snapshots de reglas, historial y cola de revisión.
-- Scaffolding + tablas de trabajo para la equivalencia (Sprint 2). No borra datos de Sprint 1.
-- Las decisiones de equivalencia (evidencia/conflictos) se guardan en el JSONB `metadata` de los
-- provider_*_mappings ya existentes; aquí añadimos las entidades nuevas.

-- ---------- canonical_participants ----------
CREATE TABLE IF NOT EXISTS canonical_participants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_type TEXT NOT NULL DEFAULT 'team',     -- team | person | country | ...
  canonical_name   TEXT NOT NULL,
  short_name       TEXT,
  country_code     TEXT,                              -- ISO/FIFA si aplica (ESP, KOR, USA)
  sport            TEXT NOT NULL DEFAULT 'football',
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sport, canonical_name)
);
DROP TRIGGER IF EXISTS trg_canon_participants_updated ON canonical_participants;
CREATE TRIGGER trg_canon_participants_updated BEFORE UPDATE ON canonical_participants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_canon_participants_country ON canonical_participants(sport, country_code);

-- ---------- participant_aliases ----------
CREATE TABLE IF NOT EXISTS participant_aliases (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_participant_id UUID NOT NULL REFERENCES canonical_participants(id) ON DELETE CASCADE,
  provider_id             UUID REFERENCES providers(id) ON DELETE SET NULL,  -- null = alias global
  alias                   TEXT NOT NULL,
  normalized_alias        TEXT NOT NULL,              -- minúsculas/sin acentos/sin puntuación
  language                TEXT,
  alias_type              TEXT NOT NULL DEFAULT 'auto'  CHECK (alias_type IN ('validated','auto','provider','code')),
  confidence              NUMERIC(6,4),
  source                  TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (canonical_participant_id, normalized_alias, provider_id)
);
DROP TRIGGER IF EXISTS trg_participant_aliases_updated ON participant_aliases;
CREATE TRIGGER trg_participant_aliases_updated BEFORE UPDATE ON participant_aliases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_aliases_normalized ON participant_aliases(normalized_alias);
-- a lo sumo UN alias global 'validated' por texto normalizado (evita colisiones peligrosas a nivel global)
CREATE UNIQUE INDEX IF NOT EXISTS uq_alias_validated_global
  ON participant_aliases (normalized_alias) WHERE provider_id IS NULL AND alias_type = 'validated';

-- ---------- provider_market_rule_snapshots ----------
-- Reglas del proveedor (raw + normalizadas + fingerprint), versionadas y append-only.
CREATE TABLE IF NOT EXISTS provider_market_rule_snapshots (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id        UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  external_market_id TEXT NOT NULL,
  raw_rules          JSONB,
  rules_text         TEXT,
  normalized_rules   JSONB,
  rules_fingerprint  TEXT,
  normalizer_version TEXT NOT NULL DEFAULT 'rule-normalizer-1',
  provider_timestamp TIMESTAMPTZ,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rule_snap_market ON provider_market_rule_snapshots(provider_id, external_market_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_rule_snap_fingerprint ON provider_market_rule_snapshots(rules_fingerprint);

-- ---------- mapping_decision_history ----------
-- Historial inmutable de decisiones de mapping (auto o manual). No sobreescribe; añade filas.
CREATE TABLE IF NOT EXISTS mapping_decision_history (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_entity_type TEXT NOT NULL CHECK (mapping_entity_type IN ('event','market','outcome')),
  mapping_entity_id  UUID,
  previous_status    TEXT,
  new_status         TEXT,
  previous_score     NUMERIC(6,4),
  new_score          NUMERIC(6,4),
  decision_source    TEXT NOT NULL DEFAULT 'auto'  CHECK (decision_source IN ('auto','manual','reeval')),
  algorithm_version  TEXT,
  reviewed_by        TEXT,
  reason             TEXT,
  evidence           JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decision_history_entity ON mapping_decision_history(mapping_entity_type, mapping_entity_id, created_at DESC);

-- ---------- mapping_review_queue ----------
CREATE TABLE IF NOT EXISTS mapping_review_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('event','market','outcome')),
  provider_a      TEXT,
  provider_b      TEXT,
  external_id_a   TEXT,
  external_id_b   TEXT,
  candidate_payload JSONB,
  score           NUMERIC(6,4),
  conflicts       JSONB,
  evidence        JSONB,
  priority        INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending'  CHECK (status IN ('pending','approved','rejected','conditional','dismissed')),
  assigned_to     TEXT,
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  decision        TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- no duplicar el mismo candidato (par de externos) en el mismo tipo mientras esté pendiente
  UNIQUE (entity_type, provider_a, external_id_a, provider_b, external_id_b)
);
DROP TRIGGER IF EXISTS trg_review_queue_updated ON mapping_review_queue;
CREATE TRIGGER trg_review_queue_updated BEFORE UPDATE ON mapping_review_queue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_review_status ON mapping_review_queue(status, priority DESC, created_at);

-- ---------- columnas adicionales en canonical_events (scope/stage) ----------
ALTER TABLE canonical_events ADD COLUMN IF NOT EXISTS event_scope TEXT;
ALTER TABLE canonical_events ADD COLUMN IF NOT EXISTS stage TEXT;
-- vínculo opcional de participantes canónicos
ALTER TABLE canonical_event_participants ADD COLUMN IF NOT EXISTS canonical_participant_id UUID REFERENCES canonical_participants(id) ON DELETE SET NULL;
-- familia de mercado normalizada (taxonomía) en canonical_markets
ALTER TABLE canonical_markets ADD COLUMN IF NOT EXISTS market_family TEXT;

-- +migrate down
ALTER TABLE canonical_markets DROP COLUMN IF EXISTS market_family;
ALTER TABLE canonical_event_participants DROP COLUMN IF EXISTS canonical_participant_id;
ALTER TABLE canonical_events DROP COLUMN IF EXISTS stage;
ALTER TABLE canonical_events DROP COLUMN IF EXISTS event_scope;
DROP TABLE IF EXISTS mapping_review_queue;
DROP TABLE IF EXISTS mapping_decision_history;
DROP TABLE IF EXISTS provider_market_rule_snapshots;
DROP TABLE IF EXISTS participant_aliases;
DROP TABLE IF EXISTS canonical_participants;
