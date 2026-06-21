-- 007 — Participantes genéricos de un evento canónico (Sprint 0.1).
-- home_participant/away_participant siguen existiendo (útiles para fútbol actual). Esta tabla añade
-- una estructura GENÉRICA para deportes/elecciones/cripto/economía/entretenimiento/etc.
-- 'role' es TEXT (NO enum rígido) para poder ampliarlo sin migraciones de tipo.
--   fútbol:    España→home, Uruguay→away
--   bitcoin:   Bitcoin→asset
--   elección:  Candidato A→candidate, Candidato B→candidate
-- No se migran los eventos actuales aquí: solo se crea la tabla + repo + tests.

CREATE TABLE IF NOT EXISTS canonical_event_participants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_event_id  UUID NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
  participant_type    TEXT,                           -- team | person | country | organization | asset | option | subject
  participant_name    TEXT NOT NULL,
  participant_code    TEXT,                           -- código estable si existe (ESP, BTC, ...)
  role                TEXT NOT NULL,                  -- home | away | team | candidate | country | person | organization | asset | subject | option
  external_reference  TEXT,
  display_order       INTEGER NOT NULL DEFAULT 0,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_event_participants_updated ON canonical_event_participants;
CREATE TRIGGER trg_event_participants_updated BEFORE UPDATE ON canonical_event_participants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_event_participants_event ON canonical_event_participants(canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_event_participants_role  ON canonical_event_participants(canonical_event_id, role);
-- evita duplicar el mismo participante con el mismo rol y orden dentro del evento
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_participant_slot
  ON canonical_event_participants (canonical_event_id, role, display_order);

-- +migrate down
DROP TABLE IF EXISTS canonical_event_participants;
