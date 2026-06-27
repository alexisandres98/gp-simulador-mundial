-- 036 — Fase O: Automatic Open-Source Context Collector. ADITIVA, reversible, INERTE. Catálogo de fuentes,
-- fetch runs, documentos, claims estructurados, entity resolution, weather. NADA se cablea como impacto sin pasar
-- por claim→observation→factor policy. NO toca tablas oficiales. Reusa signal_forbid_mutation()/set_updated_at().

-- catálogo de fuentes de contexto open-source (versionado, con compliance flags)
CREATE TABLE IF NOT EXISTS context_source_catalog (
  source_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key             TEXT NOT NULL UNIQUE,
  source_name            TEXT NOT NULL,
  source_type            TEXT NOT NULL,                       -- official | news | weather | federation | social
  domain                 TEXT,
  country                TEXT,
  language               TEXT,
  reliability_tier       TEXT NOT NULL DEFAULT 'TIER_4_UNVERIFIED', -- TIER_1_OFFICIAL|TIER_2_HIGH_REPUTATION|TIER_3_APPROVED_SPECIALIST|TIER_4_UNVERIFIED|BLOCKED
  official_status        BOOLEAN NOT NULL DEFAULT false,
  allowed_collection_method TEXT NOT NULL DEFAULT 'rss',      -- rss | atom | json_api | weather_api | news_api | official_web
  terms_review_status    TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | rejected
  robots_review_status   TEXT NOT NULL DEFAULT 'pending',
  polling_cadence_ms     BIGINT NOT NULL DEFAULT 3600000,
  rate_limit_per_hour    INTEGER NOT NULL DEFAULT 30,
  enabled                BOOLEAN NOT NULL DEFAULT false,      -- INERTE por defecto
  kill_switch            BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT csc_tier_chk CHECK (reliability_tier IN ('TIER_1_OFFICIAL','TIER_2_HIGH_REPUTATION','TIER_3_APPROVED_SPECIALIST','TIER_4_UNVERIFIED','BLOCKED'))
);
DROP TRIGGER IF EXISTS trg_csc_updated ON context_source_catalog;
CREATE TRIGGER trg_csc_updated BEFORE UPDATE ON context_source_catalog FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- fetch runs (auditoría de cada fetch: ETag, status, hash, rate limit)
CREATE TABLE IF NOT EXISTS context_fetch_runs (
  fetch_run_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id        UUID,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  response_at      TIMESTAMPTZ,
  http_status      INTEGER,
  etag             TEXT,
  last_modified    TEXT,
  content_type     TEXT,
  content_hash     TEXT,
  bytes            INTEGER,
  rate_limit_state TEXT,
  fetch_status     TEXT NOT NULL DEFAULT 'ok',                -- ok | not_modified | blocked | error | timeout
  error_code       TEXT
);
CREATE INDEX IF NOT EXISTS idx_cfr_source ON context_fetch_runs(source_id, requested_at DESC);

-- documentos crudos (metadata + hash + excerpt; sin contenido completo si licencia no lo permite)
CREATE TABLE IF NOT EXISTS context_source_documents (
  document_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id              UUID,
  canonical_url          TEXT,
  title                  TEXT,
  language               TEXT,
  source_published_at    TIMESTAMPTZ,
  provider_updated_at    TIMESTAMPTZ,
  first_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  timestamp_quality      TEXT NOT NULL DEFAULT 'INGESTION_OBSERVED',
  raw_content_hash       TEXT,
  normalized_content_hash TEXT,
  content_excerpt        TEXT,
  fetch_run_id           UUID,
  status                 TEXT NOT NULL DEFAULT 'parsed',
  UNIQUE (normalized_content_hash)
);
CREATE INDEX IF NOT EXISTS idx_csd_source ON context_source_documents(source_id, first_seen_at DESC);

-- claims estructurados extraídos de documentos (schema cerrado; review_status)
CREATE TABLE IF NOT EXISTS context_claims (
  claim_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id            UUID,
  factor_code            TEXT NOT NULL,
  subject_type           TEXT NOT NULL,
  subject_id             TEXT,
  event_id               UUID,
  team_id                TEXT,
  player_id              TEXT,
  fact_or_inference      TEXT NOT NULL DEFAULT 'UNKNOWN',     -- FACT|INFERENCE|RUMOR|UNKNOWN
  claim_text_hash        TEXT,
  confidence             NUMERIC(6,4) NOT NULL DEFAULT 0,
  valid_from             TIMESTAMPTZ,
  valid_until            TIMESTAMPTZ,
  source_published_at    TIMESTAMPTZ,
  first_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  timestamp_quality      TEXT NOT NULL DEFAULT 'INGESTION_OBSERVED',
  extraction_method      TEXT NOT NULL DEFAULT 'rule_based',  -- rule_based | llm
  extraction_model_version TEXT,
  materiality            TEXT NOT NULL DEFAULT 'NON_MATERIAL',-- MATERIAL|NON_MATERIAL|REVIEW_REQUIRED
  propagation_class      TEXT,                                -- ORIGINAL_SOURCE|REPUBLICATION|INDEPENDENT_CONFIRMATION|DERIVED_COMMENTARY
  entity_match_confidence NUMERIC(6,4),
  entity_match_method    TEXT,
  applied                BOOLEAN NOT NULL DEFAULT false,
  applied_impact         NUMERIC(10,6) NOT NULL DEFAULT 0,
  discard_reason         TEXT,
  review_status          TEXT NOT NULL DEFAULT 'auto',        -- auto | review_required | approved | rejected
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cc_event ON context_claims(event_id);
CREATE INDEX IF NOT EXISTS idx_cc_factor ON context_claims(factor_code);
DROP TRIGGER IF EXISTS trg_cc_immutable ON context_claims;
CREATE TRIGGER trg_cc_immutable BEFORE UPDATE OR DELETE ON context_claims FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- weather snapshots por fixture (forecast con issued_at + horizon + expiración)
CREATE TABLE IF NOT EXISTS weather_snapshots (
  weather_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_event_id  UUID,
  venue               TEXT,
  latitude            NUMERIC(9,5),
  longitude           NUMERIC(9,5),
  kickoff_local       TIMESTAMPTZ,
  forecast_issued_at  TIMESTAMPTZ,
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  horizon_hours       NUMERIC(6,2),
  temperature_c       NUMERIC(6,2),
  apparent_c          NUMERIC(6,2),
  humidity_pct        NUMERIC(6,2),
  precip_mm           NUMERIC(6,2),
  wind_kmh            NUMERIC(6,2),
  weather_factors     JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [EXTREME_HEAT, STRONG_WIND, ...]
  source              TEXT NOT NULL DEFAULT 'open-meteo',
  input_hash          TEXT NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_weather_event ON weather_snapshots(canonical_event_id);
DROP TRIGGER IF EXISTS trg_weather_immutable ON weather_snapshots;
CREATE TRIGGER trg_weather_immutable BEFORE UPDATE OR DELETE ON weather_snapshots FOR EACH ROW EXECUTE FUNCTION signal_forbid_mutation();

-- +migrate down
DROP TABLE IF EXISTS weather_snapshots;
DROP TABLE IF EXISTS context_claims;
DROP TABLE IF EXISTS context_source_documents;
DROP TABLE IF EXISTS context_fetch_runs;
DROP TABLE IF EXISTS context_source_catalog;
