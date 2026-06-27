-- 032 — Fase K.2: snapshot semántico NEUTRAL + i18n en la Pick. Aditiva, reversible, compatible. NO reescribe
-- Signals históricas (signals=0, picks=0). La semántica oficial del Registry proviene de team IDs + outcome_code +
-- market_code + period_code (NO de una frase ES/EN). El texto que vio el aprobador se conserva como metadata
-- auditada (no entra al hash). NO modifica Verified Epoch ni borra columnas existentes.

ALTER TABLE internal_picks
  ADD COLUMN IF NOT EXISTS selection_display_key       TEXT,          -- 'selection.team_to_win' | 'selection.draw'
  ADD COLUMN IF NOT EXISTS selection_display_args      JSONB,         -- { team_id: 'CRO' }
  ADD COLUMN IF NOT EXISTS selection_i18n_version      TEXT DEFAULT 'i18n-1',
  ADD COLUMN IF NOT EXISTS approval_locale             TEXT,          -- es | en (idioma del modal al aprobar)
  ADD COLUMN IF NOT EXISTS selection_display_at_approval TEXT,        -- lo que vio EXACTAMENTE el admin (auditoría)
  ADD COLUMN IF NOT EXISTS canonical_home_team_id      TEXT,          -- stable team ID (CRO)
  ADD COLUMN IF NOT EXISTS canonical_away_team_id      TEXT,          -- stable team ID (GHA)
  ADD COLUMN IF NOT EXISTS outcome_code                TEXT,          -- HOME | DRAW | AWAY
  ADD COLUMN IF NOT EXISTS market_code                 TEXT DEFAULT '1X2',
  ADD COLUMN IF NOT EXISTS period_code                 TEXT DEFAULT 'REGULATION';

-- +migrate down
ALTER TABLE internal_picks
  DROP COLUMN IF EXISTS selection_display_key, DROP COLUMN IF EXISTS selection_display_args,
  DROP COLUMN IF EXISTS selection_i18n_version, DROP COLUMN IF EXISTS approval_locale,
  DROP COLUMN IF EXISTS selection_display_at_approval, DROP COLUMN IF EXISTS canonical_home_team_id,
  DROP COLUMN IF EXISTS canonical_away_team_id, DROP COLUMN IF EXISTS outcome_code,
  DROP COLUMN IF EXISTS market_code, DROP COLUMN IF EXISTS period_code;
