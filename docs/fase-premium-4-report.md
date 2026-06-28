# FASE PREMIUM 4 — Reporte (slice entregado + auditoría + diferidos honestos)

**Fecha:** 2026-06-28 · Todo aislado en `/x` detrás de `GP_PREMIUM_UI_ENABLED`. Plataforma de los 509 usuarios
intacta. Dirección visual aprobada conservada. **Esta fase es multi-sesión**: se entregó el subconjunto seguro y de
alto impacto que NO toca el motor en vivo; los cortes que requieren cambios operativos/backend del scheduler o
refactors grandes quedan **auditados y diferidos con recomendación** (ver §Diferidos).

## 1. Auditoría de datos V2 (4D#10) — matriz real

| Factor | En DB | Lo usa GP | En DTO | Visible | Fuente | Freshness |
|---|---|---|---|---|---|---|
| Probabilidad base 1X2 | sí (`v2_probability_snapshots.base_probability_vector`) | sí | sí | sí (módulo Prob) | snapshot | sí |
| Probabilidad GP final 1X2 | sí (`final_probability_vector`) | sí | sí | sí | snapshot | sí |
| Ajustes por outcome | sí (`context_adjustments`) | sí | sí | sí (flecha base→GP) | snapshot | sí |
| Confianza | sí (`snapshot.confidence`, ej. 0.67) | sí | sí (`confidence_code`) | sí (badge) | snapshot | — |
| Incertidumbre | sí (`uncertainty`, `eval.uncertainty_score`) | sí | vía risks | sí (riesgos) | snapshot/eval | — |
| Forma reciente (FORM) | sí (`context_observations`, 12) | net | sí (evaluated_factors) | sí | API-Football | INGESTION_OBSERVED |
| Disponibilidad (AVAILABILITY) | sí (12) | net | sí | sí | API-Football | INGESTION_OBSERVED |
| Calidad de plantilla (SQUAD_QUALITY) | sí (6) | net | sí | sí | API-Football | INGESTION_OBSERVED |
| Solidez (SOLIDITY) | sí (5) | net | sí | sí | API-Football | INGESTION_OBSERVED |
| Racha (STREAK) | sí (5) | net | sí | sí | API-Football | INGESTION_OBSERVED |
| Clima — humedad/lluvia | sí (HIGH_HUMIDITY 2, HEAVY_RAIN 1) | net | sí (factor) | sí (chip/factor) | proveedor clima | INGESTION_OBSERVED |
| **Sede/estadio (venue)** | **NO** (`canonical_events.venue` NULL en 64/64) | no | no | **no (correcto)** | — | — |
| **Clima exacto temp/sede** | **NO** | no | no | **no (correcto)** | — | — |
| Mercado consenso / mejor precio | sí (value/sportsbook) | sí | sí | sí (Mercados) | sportsbook | price_observed_at |
| Liquidez | sí (Polymarket volume) | sí | sí | sí | Polymarket | — |
| Goal projections | sí (`goal_model_snapshots`, 6) | validación | sí | sí (Goles) | Goal Engine | — |
| Lineups/eventos/stats/news | sí (`/api/match`) | contexto | sí | sí | API-Football/ESPN | providerStatus |

**Hallazgo clave:** TODOS los `context_observations` tienen `applied_impact=0` → el efecto del contexto es el
**ajuste NETO del snapshot**, no un impacto per-factor aislado. Por eso "Por qué GP cambió" muestra base→ajuste
neto→GP + los factores evaluados con su evidencia/confianza/freshness, SIN fabricar un "+X pp por factor" que no
existe. **`venue` es NULL** → no se muestra sede ni clima exacto (sí los factores de humedad/lluvia reales). Corregido
en el cliente para no mostrar nada inventado.

## 2. Auditoría del scheduler (4B) — por qué la cobertura es parcial

El loop oficial (`value-engine/scheduler.js` → `valueDryRun.runOperational`) evalúa SOLO eventos que cumplen
`canonical_event_id IS NOT NULL AND market_family='1x2'` en `sportsbook_quote_current` — es decir, **solo los
partidos que the_odds_api está cotizando** y que fueron aprobados como canónicos (`CANONICAL_AUTO_MATCH_ENABLED=false`).
Resultado: **64 canonical_events** (los cotizados), no los 104 fixtures. Por eso la mayoría de los partidos del
calendario muestran "GP Intelligence no disponible".

**Ampliar a "todos los partidos próximos" (4B#4/#5) es un cambio OPERATIVO de backend**, no un flag de UI: requiere
habilitar canonical auto-match + ampliar la ingesta de cuotas (costo de the_odds_api / API-Football, más escrituras
en DB). **No se flipeó a ciegas** porque toca el pipeline que alimenta el Value/Picks de los 509 usuarios. Camino
seguro recomendado (para decisión de Alexis): añadir `GP_INTELLIGENCE_EVALUATION_HORIZON_HOURS` + un `linkedEvents()`
que incluya canonical_events dentro del horizonte aunque no tengan cuota (clasificarán PASS por falta de consenso, sin
generar Picks), y decidir la política de ingesta/costo. Documentado, no ejecutado.

## 3. Lo ENTREGADO este corte (seguro, frontend + DTO aditivo)

- **4C#7 — Orden de Partidos.** Por defecto: LIVE → próximos/futuros por kickoff ASC → finalizados por fecha DESC.
  "Todos" abre con Hoy (no con partidos antiguos). Filtros En vivo/Próximos/Finalizados + fase + búsqueda intactos.
- **4C#8 — Finalizados (y todo partido) abren el cockpit.** Nuevo modo `#match/fx-<fixtureId>` que arma un cockpit
  desde `/api/match` para partidos sin evaluación canónica: hero con resultado + "Finalizado", **"No se registró una
  evaluación GP prepartido para este encuentro"** (un solo mensaje honesto, sin doble "no disponible"), Mercados +
  Contexto reales; sin recalcular el pasado. Las 88 filas de Partidos ahora son navegables.
- **4D#11 — "Por qué GP cambió" enriquecido.** El DTO expone por factor evaluado: `evidence_class`, `confidence`,
  `timestamp_quality_code`, `subject_team_id`. El cockpit los muestra como filas (Inferencia/Dato · Confianza 60% ·
  "Observado en ingesta") + nota honesta de que el efecto está en el ajuste neto. `confidence_code` ahora integra el
  `snapshot.confidence` real (los riesgos solo bajan el nivel).
- **4F — i18n estructural.** El Simulador ya NO usa la prosa ES del backend: Verdict/Tesis/Riesgo se construyen desde
  estructura (probs/factores) y se localizan en cliente (verificado 100% EN, sin fuga ES ni V1/V2/delta). Forma
  reciente: en ES nunca W/D/L → **V/E/D**. `timestamp_quality` localizado. Test `tests/premium-i18n.test.js` (9/0) que
  falla si falta paridad de claves o si claves clave quedan iguales entre locales.
- **4G — Polish móvil.** Nav de secciones con scroll-snap + **fade lateral** (la última pestaña no queda cortada) +
  touch targets ≥44px; **Mercados colapsables** en móvil (`<details>`: "Mejor precio" abierto, Casas/PM colapsados);
  bottom nav en orden canónico Oportunidades/Partidos/Simulador/Equipos/Más + safe-area.

## 4. QA
- Preview local :3011, DB prod read-only, admin. 1440×900 + 390×844 **sin overflow**, **0 errores de consola**.
- Verificado: orden Partidos (primer grupo "Hoy"), 88/88 filas clickeables (84 vía `fx-`), cockpit fixture-only de
  finalizado (3-3, estado honesto), factores enriquecidos (ALG/AUT: Inferencia·Confianza 60%·Observado en ingesta),
  Simulador EN estructurado, Mercados móvil colapsables (1 abierto), nav fade.
- Tests: `premium-confidence` 10/0, `premium-i18n` 9/0, `gp-product` 41/0, `value-engine` 36/0.

## 5. Invariantes (intactos)
509 usuarios/auth/sesiones · Verified Epoch · Registry · Picks/Signals V1=2 · modelo forward-only · sin fallback
silencioso a V1 · goles en validación (sin Pick/Value) · arbitraje/billing/públicos OFF · auto-exec OFF · sin
migración destructiva · **no se fabricó** prob histórica/mercado/clima/sede/alineación/noticia · no auto-publicación.
Migraciones: **ninguna nueva** (todo aditivo en DTO/UI). `app.js` NO tocado.

## 6. DIFERIDOS (auditados, NO ejecutados — requieren backend/operación o son refactors grandes)
- **4B cobertura total** (evaluar todos los fixtures): cambio operativo de ingesta/canonical-auto-match + costo API →
  decisión de Alexis. Recomendado el flag `GP_INTELLIGENCE_EVALUATION_HORIZON_HOURS` + ampliar `linkedEvents()`.
- **4A servicio canónico único `buildPremiumMatchIntelligence`** server-side: hoy el patrón canónico→intelligence ya se
  cumple a nivel de lectura (cockpit consume `/api/beta/match` + `/api/match`; Oportunidades y Partidos abren la misma
  página). Consolidarlo en un único servicio backend es un refactor grande → siguiente sesión.
- **4C#6 persistencia forward-only de snapshots** (escritura programada): toca el motor; aditivo pero requiere cuidado.
- **4D#12 módulos de sede/clima exacto**: NO hay venue ni temperatura en DB → no se construyeron (sería fabricar).
- **4F narrativa estructurada del backend** (reason_codes en el DTO oficial en vez de prosa): el Simulador ya se
  resolvió en cliente; falta el equivalente en otras superficies/DTOs oficiales → siguiente sesión.
- **4H Equipos/Grupos/Bracket/Evolución/Registro/Metodología premium**: gated por 4A–4G; superficies grandes →
  siguiente sesión.
- **§29 Observatory de cobertura** (admin): métricas de fixtures elegibles/evaluados/pendientes → siguiente sesión.

## 7. Archivos / Deploy
- `public/premium.{js,css}` (orden, fx-cockpit, factores enriquecidos, i18n Simulador, V/E/D, mercados colapsables,
  nav fade), `gp-product/dto.js` (evaluated_factors enriquecidos), `gp-product/api.js` (snapshotConfidence +
  `/api/beta/matches`), `gp-product/confidence.js` (snapshotConfidence), `tests/premium-i18n.test.js` (nuevo).
- Commit + deploy: ver al final del reporte (se completan al desplegar).

## STOP
Detenido tras el slice + auditoría + reporte. **NO** fusionar `/x` con la principal, **NO** iniciar Equipos/torneo
(4H), **NO** G.7/referidos/email/billing/beta externa. Esperar aprobación visual y funcional de Alexis para continuar
con 4B (decisión operativa), 4A (servicio canónico) y 4H.
