# GP Intelligence — Validación (Sprint 0.1)

> Casos de prueba, sanity matemático y reproducibilidad de V2. Harness reproducible sin dependencias.

## Ejecutar
```bash
node tests/gp-intelligence.test.js     # 11 casos (31 aserciones) — sin DB
# DB (requiere PostgreSQL de prueba):
DATABASE_URL=... DB_SSL=false node tests/db-acceptance.test.js
```

## Casos (todos PASAN — 31/31 aserciones)
| # | Caso | Qué verifica |
|---|---|---|
| 1 | Equipos idénticos, cancha neutral | 1X2 ~ simétrico; deltas iguales |
| 2 | Favorito muy fuerte | aparecen marcadores 3+; equipo fuerte puede meter 3+; **no se topa en 2-0** |
| 3 | Contexto faltante | sin crash; ajuste 0; data quality Insuficiente; V2 ≈ V1 |
| 4 | Lesión jugador clave vs suplente | la baja clave penaliza más (−15 vs −7) |
| 5 | Lesión stale | se excluye (`included:false, exclusion_reason:'stale'`); no contribuye |
| 6 | Ventaja de descanso | acotada (≤10 Elo; cap LOAD ±12) |
| 7 | Double counting | grupo PERFORMANCE uncapped < −40 pero **capped = −40**; total dentro del safety cap |
| 8 | Reproducibilidad | mismo input → mismo `input_hash`, misma seed, mismo Monte Carlo, mismos topScores |
| 9 | Sanity de totales | `sanity.ok`; O1.5≥O2.5≥O3.5; 1X2 suma 1; BTTS ∈ [0,1] |
| 10 | V1 vs V2 | ambos outputs presentes; delta pp coherente; modelConfidence ≠ dataQuality |
| 11 | No regresión global | `matchProbs` determinístico; snapshot V1 congelado (home=0.7481 para 2125 vs 1438) |

## Sanity matemático (en cada ejecución, `run.sanity`)
- 1X2: `P1 + PX + P2 ≈ 1` (tolerancia 0.02).
- Totales: `Over 1.5 ≥ Over 2.5 ≥ Over 3.5` (monotonicidad).
- BTTS ∈ [0,1].
- Distribución de totales del Monte Carlo suma ≈ 1.
- xG finito, no negativo, ≤ 6.
- Ajuste de Elo dentro de `±GP_INTELLIGENCE_MAX_ELO_ADJUSTMENT`.

## Precisión visual
- 1X2 y porcentajes se muestran con **máximo 1 decimal** (p.ej. `52.3%`); secundarios a entero (`52%`).
- Precisión interna completa; el redondeo es solo de presentación.

## Aceptación de base de datos (`tests/db-acceptance.test.js`, 31/31)
- Health/status **no crean** `schema_migrations` en DB vacía (read-only).
- 8 migraciones → 12 tablas; idempotencia; rollback + re-up.
- **4 observaciones idénticas (mismo checksum) persisten** como 4 filas.
- checksum determinístico e **ignora `received_at`**.
- CRUD de outcomes (rechaza duplicados; CHECK matched→canónico) y de participantes (fútbol + cripto).
- `NUMERIC` se preserva como string (sin float).

## Entornos validados
- Sin `DATABASE_URL` → app y GP Intelligence funcionan; health `configured:false`.
- Con PostgreSQL real (PG 18.4) → migraciones, health, repos OK.
- DB caída → `unavailable`, sin filtrar secretos, sin crash.
- Clon limpio (`npm ci` + `db:migrate` + `db:status` + `platform:health` + `npm start`) → OK.
- 0 errores de consola; 0 errores de servidor.
