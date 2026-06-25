# Sportsbook — Retención (Bloque B)

`sportsbook-providers/retention.js`. **Pausada por defecto.** Toda purga es configurable, incremental,
auditable y **incapaz de tocar señales/closing/datos oficiales** (allowlist de tablas).

## Flags
| Flag | Default | Efecto |
|------|---------|--------|
| `SPORTSBOOK_RETENTION_ENABLED` | `false` | maestro: si false → solo dry-run |
| `SPORTSBOOK_RETENTION_DRY_RUN` | `true` | si true → cuenta, no borra |

Con los defaults (`enabled=false`), `run()` siempre es **dry-run** (cuenta candidatas, audita, no borra).
Para ejecutar hace falta `ENABLED=true` **y** `DRY_RUN=false`.

## Scopes (allowlist — nada fuera de estas tablas)
| scope | tabla | columna de tiempo | default días |
|-------|-------|-------------------|-------------|
| `redundant_raw` | `sportsbook_quotes` (raw legacy) | `received_at` | 14 |
| `material_history` | `sportsbook_quote_history` | `observed_at` | 180 |

`current state` no expira mientras el evento sea relevante. Un scope inválido (p.ej. `signals`) lanza
`invalid_retention_scope` — **no puede** alcanzar tablas oficiales.

## Ejecución
Borrado **incremental** en lotes de 5000 (`DELETE ... WHERE ctid IN (... LIMIT 5000)`), cada `run()` escribe una
fila en `sportsbook_retention_audit` (`mode`, `target_table`, `scope`, `cutoff_at`, `rows_considered`,
`rows_deleted`, `flags_snapshot`, `executed_by`). `projection()` reporta conteos para el storage sin borrar.

**Política inicial sugerida (ajustable tras auditar):** raw redundante 7–14 días; history material largo plazo;
eventos cerrados → compactación posterior. **No** se implementa ninguna purga destructiva irreversible automática.
Tests: `tests/post-shadow-ops-db.test.js` (dry-run cuenta/no borra, execute guarded, allowlist).
