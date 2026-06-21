# Sprint 0.1 — Auditoría de hardening (verificación del código real)

> Revisión del código REAL de la fundación del Sprint 0 antes de modificarlo. No se asume que el
> reporte del Sprint 0 coincide con el código: cada punto se verificó leyendo los archivos.

Fecha: jun-2026 · Alcance: `database/**`, `server.js` (integración), feature flags.

## Resultados de la inspección

| # | Verificación | Resultado real |
|---|---|---|
| 1 | Migraciones actuales | 001 (providers, ingestion_runs), 002 (raw/normalized snapshots), 003 (canonical + mappings), 004 (signals). ✅ coincide |
| 2 | Constraints/índices reales | `UNIQUE` solo en `providers.code` y en `(provider_id, external_*_id, mapping_version)` de los mappings. Índices en provider/market/timestamps/checksum/run. ✅ |
| 3 | **Checksum** | `raw_market_snapshots.checksum` tiene **índice, NO `UNIQUE`** → ya admite múltiples observaciones con el mismo contenido. El repo `insert()` **siempre inserta** (no hay skip por dedup). `existsByChecksum()` es un helper opcional, no se usa para bloquear. ✅ pero falta utilidad de cómputo determinístico (ver A2). |
| 4 | Repositorios | 8 repos parametrizados (`$1..$n`), sin SQL concatenado. ✅ |
| 5 | Feature flags | Leídos en `config.js` (`platformV2`, `writeEnabled`). **No hay validación cruzada** (V2=false + WRITE=true se acepta como válido). ⚠️ a corregir (A6). |
| 6 | Cuándo corren las migraciones | `migrate.js` es CLI (`require.main === module`). `up()`/`rollback()` solo desde `npm run db:migrate/rollback`. ✅ |
| 7 | NUMERIC como strings | Confirmado en prueba contra PG real: `best_bid` → `"0.41000000"`, `typeof === 'string'`. ✅ sin pérdida de precisión. |
| 8 | Migraciones desde requests normales | Ningún endpoint público ni el arranque ejecutan `up()`. ✅ |
| 9 | **Health no modifica el esquema** | **🔴 HALLAZGO**: `migrate.status()` llama a `ensureTable()` (`CREATE TABLE IF NOT EXISTS schema_migrations`). Como `health.snapshot()` llama a `migrate.status()`, **el health check CREA `schema_migrations` si no existe** → modificación de esquema disparada por un request. Viola A7. |
| 10 | Conexiones con flags apagados | `getPool()` devuelve `null` si `!cfg.db.configured`. El arranque no abre conexión. El pool se crea perezosamente solo si hay `DATABASE_URL` y alguien consulta. ✅ |

## Hallazgos que requieren corrección en este Sprint 0.1

1. **(A7) Health crea `schema_migrations`** vía `migrate.status() → ensureTable()`.
   **Fix:** `status()` pasa a ser **read-only** (consulta `information_schema` para saber si la tabla existe; si no, reporta `pending`/`unknown` sin crearla). Solo `up()`/`rollback()` (CLI explícito) crean la tabla.

2. **(A2) Checksum determinístico:** hoy lo calcula el *caller* (no existe utilidad). Se añade `database/checksum.js` que canonicaliza el payload (claves ordenadas) y hashea SHA-256, **excluyendo** `received_at`, secretos y campos volátiles. Se documenta que **no** habrá `UNIQUE(checksum)` (cada observación se guarda).

3. **(A6) Validación de flags:** `MARKET_DATA_PLATFORM_V2=false` + `MARKET_DATA_WRITE_ENABLED=true` debe ser **inválida** → forzar `writeEnabled=false`, warning estructurado, `configurationValid:false` en health. Centralizado en `config.js`.

4. **(A3) `processed_at`:** **ya existe** en `normalized_market_snapshots`. Se evalúa para `ingestion_runs` (cubierto por `finished_at`) y `signals` (cubierto por `published_at`) → no se añaden columnas redundantes (decisión documentada).

## No-hallazgos (ya correctos en Sprint 0)
- Pool único y perezoso, SSL configurable, graceful shutdown solo si hay pool.
- Errores saneados (sin URL/credenciales).
- Migraciones transaccionales con tabla de control.
- NUMERIC para dinero/probabilidades.

## Cambios planificados a partir de esta auditoría
- Nuevas migraciones: `005` (observation hardening + índices de timeline), `006` (canonical_outcomes + provider_outcome_mappings), `007` (canonical_event_participants), `008` (model_analysis_runs).
- `migrate.status()` read-only; `database/checksum.js`; validación central de flags; repos nuevos; harness de pruebas.
