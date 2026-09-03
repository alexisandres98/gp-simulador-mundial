# REPORT — FÚTBOL: rating alimentado con cuotas + prior de plantilla (rama `impl/elo-odds`)

**Fecha:** 3 de septiembre de 2026. **Base:** `673202bb` (origin/main al arrancar). **Spec:** mejora de fondo
del 1X2 de clubes pendiente en `docs/BACKTESTS_FAMILIAS_2026-09-02.md` §3.6 — un rating que bata al de
resultados, backtesteado, y su implementación EN SOMBRA. El servidor NUNCA se arrancó (`node --check` + scripts).
**Reglas cumplidas:** `cards`, CS2, LoL, real-executor, sombra y `buildClubDailyPicks` no se tocan; todo lo de
producción va apagado por defecto tras `GP_CLUB_ELO_SOURCE` (default `results`) y el rating alternativo vive AL
LADO (`db.clubElosOdds`), nunca pisa `db.clubElos`.

## 1. Commits (todos empujados a `origin/impl/elo-odds`)

| Commit | Qué |
|---|---|
| `cd895c6a` | `clubs-engine/eloOdds.js` (módulo puro) + `scripts/clubs-rating-backtest.js` (walk-forward football-data 2122-2526) |
| `8dee4cc5` | `server.js`: rating paralelo en sombra; `scripts/clubs-squad-values.js`; `scripts/smoke/elo-odds-smoke.js` |
| (este) | Defaults del módulo = los del backtest (K=250, w=0,75); regla de parsimonia para K; `docs/ELO_CUOTAS_BACKTEST.md` + `docs/impl/elo-odds-REPORT.md` |

## 2. Backtest (tarea 1) — resumen; tablas completas en `docs/ELO_CUOTAS_BACKTEST.md`

33.335 partidos, 18 divisiones, 5 temporadas; cierre Pinnacle con Shin; `engine.matchProbs` de producción;
desarrollo 2223+2324 (2122 calienta), evaluación 2425+2526 congelada. Parámetros elegidos en desarrollo:
K_odds=250 (meseta 250-300; regla declarada: el menor dentro de 0,0001 del mínimo), w=0,75 (C), α=0,2 (D sobre
A), α=0 (D sobre B).

**Log-loss por temporada de evaluación (n por temporada; Δ pareado vs A con t; Δ vs cierre con t):**

| Temporada | n | Cierre (Shin) | Techo del transform | A resultados (prod.) | B cuotas K=250 | C híbrido | D_A | D_B |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2425 | 6.589 | 0,9905 | 0,9957 (+0,0052 vs cierre, t 4,3) | 1,0213 (+0,0308 vs cierre, t 11,3) | **1,0032** (−0,0180 vs A, **t −7,69**, IC [−0,0226, −0,0133]; +0,0127 vs cierre, t 7,1) | 1,0040 (t −8,18 vs A) | 1,0184 (t −2,80 vs A) | 1,0028 (t −7,80 vs A) |
| 2526 | 6.554 | 0,9967 | 1,0019 (+0,0052, t 5,0) | 1,0243 (+0,0276, t 10,2) | **1,0095** (−0,0148 vs A, **t −6,03**, IC [−0,0198, −0,0099]; +0,0128 vs cierre, t 7,8) | 1,0099 (t −6,48) | 1,0226 (t −1,55) | 1,0091 (t −6,16) |
| 8 primeras jornadas 2425 | 1.384 | 0,9810 | 0,9878 | 1,0162 | **0,9919** (−0,0243 vs A, t −4,47) | 0,9943 | 1,0108 (t −1,59) | 0,9901 (t −4,69) |
| 8 primeras jornadas 2526 | 1.378 | 1,0039 | 1,0101 | 1,0390 | **1,0275** (−0,0115 vs A, t −2,07) | 1,0291 | 1,0342 (t −1,30) | 1,0255 (t −2,36) |

**ROI de la regla `lead` al cierre (0,5 modelo/mercado, ventaja ≥ 2 pp, local/visita), evaluación:**

| Temporada | A · n / ROI / t | B · n / ROI / t | D_A · n / ROI / t |
|---|---|---|---|
| 2425 | 3.633 / −10,4 % / −3,82 | 1.321 / −13,1 % / −2,24 | 3.499 / −9,9 % / −3,47 |
| 2526 | 3.632 / −13,7 % / −5,86 | 1.486 / −27,0 % / −6,59 | 3.517 / −12,9 % / −5,26 |

**Veredicto.** (i) **Sí hay variante que bate al Elo de resultados con t ≥ 2 en evaluación:** B (t −7,7 y
−6,0; también en las 8 primeras jornadas, t −4,5 y −2,1); C, D_B y D_C son B con adornos y no añaden nada;
la regresión de temporada sola (D_A) se queda corta (t −2,8 / −1,6). (ii) **Ninguna se acerca al cierre:** B
queda a +0,013 (t 7-8); +0,005 de eso lo pierde el transform `matchProbs` (calibración λ=0,15 + Poisson)
incluso con el rating implícito del propio cierre, y +0,008 el rating (la última línea de un equipo es de hace
una semana). (iii) `lead` pierde bajo todos los ratings y **más** con B: las "ventajas" que quedan son los
partidos donde la línea se movió desde el último partido — donde el rating está viejo. Confirma `GP_SOLID_C=0`.

## 3. Prior de plantilla (tarea 2) — no medido; qué falta exactamente

- `scripts/clubs-squad-values.js`: mapa **342/342** equipos de 2526 football-data → `ratings.json` (ids
  `tm_` de TSA) para las 18 divisiones (`--map-only`, sin red) + descarga y suma de `market_value` por club con
  el MISMO endpoint que `clubRosterRows` (server.js ~5534), 1,3 s entre llamadas (≈ 9 min para ~420 equipos).
- El backtest ya trae la variante **SQ** (`--squad <json>`): `rating_inicio = a + b·log(valor)` por división
  ajustado contra el rating final de **2425** (menos fuga que contra 2526), mezcla β ∈ {0,5; 1} sobre el
  arrastre, y reporta las 8 primeras jornadas de 2526 frente a D_A/D_B.
- **Falta únicamente `THESTATSAPI_KEY`** (no está en este entorno; solo en Render). Con ella:
  `THESTATSAPI_KEY=… node scripts/clubs-squad-values.js --out $SP/fd` →
  `node scripts/clubs-rating-backtest.js --no-download --squad $SP/fd/squad-values-2526.json`.
- Sesgo de supervivencia reconocido (valores de hoy, no de agosto de 2025). Lo que ya se sabe sin el prior: en
  las 8 primeras jornadas el mercado está a +0,035 de A y a +0,011/+0,023 de B; ese es el espacio máximo.

## 4. Implementación en sombra (tarea 3) — qué se implementó y cómo se enciende

**Nuevos:** `clubs-engine/eloOdds.js` (puro: `resultDelta` = fórmula de `applyClubElo`, `oddsDelta`
Wunderlich-Memmert, `combinedDelta` odds/hybrid/results con reserva al resultado, `regressSeason`,
`applyToOverlay`, `eloSource`, `oddsParams`), `scripts/clubs-rating-backtest.js`, `scripts/clubs-squad-values.js`,
`scripts/smoke/elo-odds-smoke.js`, `docs/ELO_CUOTAS_BACKTEST.md`, `docs/impl/elo-odds-REPORT.md`.

**`server.js`** (+96/−5; líneas de la rama):

| Líneas | Región | Cambio |
|---|---|---|
| ~4344 | `clubsQuotesSweep`, tras `db.clubsQuoteEvents[ceid] = …` | UNA línea: `try { rememberClubClosing1x2(L, ceid, ev); } catch {}` — guarda el último consenso Shin pre-saque (por casa + mediana, `shinConsensus1x2`) de TODOS los partidos con cuotas en `db.clubClosing1x2` (clave `clubScoreKey`, con `hId` para orientar; poda 7 días tras el saque). Es el "cierre de la casa" que `captureClubPicksClosing` solo tenía para las picks |
| ~5746-5836 | bloque nuevo tras `clubCupTierOffset` | `EloOdds` require; `clubEloResults` (= el `clubElo` de antes, byte-idéntico); `clubEloOdds` (overlay paralelo o base); **`clubElo`** ahora: `GP_CLUB_ELO_SOURCE=odds` y hay overlay paralelo → `clubEloOdds`, si no → `clubEloResults`; `rememberClubClosing1x2`; `applyClubEloOdds` (Δ con el cierre si lo hay, si no con el resultado; guarda probabilidad PRE-partido de ambos ratings y del cierre en `db.clubElosOddsLog`, tope 600); `clubEloOddsCompare(days)` (log-loss/Brier de ambos + mercado, Δ pareado con t) |
| ~5845 | `clubEloReconcileFit` | Al cambiar el fit base también resetea `db.clubElosOdds` (el log se conserva) |
| ~6021 (ESPN) y ~6170 (TSA) | transición a final | `try { applyClubEloOdds(...) } catch {}` **antes** de `applyClubElo(...)` (la comparación usa el overlay de resultados aún pre-partido). Idempotencia: misma guarda `elo_applied` |
| ~22987-23000 | `/api/internal/clubs-elo` | Bloque `odds: { source, params, adjusted, closings, log, compare, overlay }` (`?days=` ventana, default 28) y `POST ?odds_test=lg,hId,aId,hg,ag[,pH,pD,pA]` para simular cierre + final |

**Cómo se enciende (Render → env → deploy):**
- `GP_CLUB_ELO_SOURCE=odds` → `clubElo()` lee `db.clubElosOdds` (cockpit, picks, derivadas: todo lo que hoy
  llama a `clubElo`). Sin la variable (o `results`) el comportamiento es el de siempre; el paralelo se acumula
  igual en sombra desde el primer deploy.
- Parámetros del paralelo (defaults en código = los del backtest, no hace falta env): `GP_CLUB_ELO_ODDS_K`
  (default 250), `GP_CLUB_ELO_ODDS_MODE` (`odds` default | `hybrid` | `results`), `GP_CLUB_ELO_ODDS_W` (peso
  de cuotas en `hybrid`, default 0,75).
- Estado: `/api/internal/clubs-elo?key=$GP_EXPORT_KEY&days=28` → `odds.compare` = `{ n, used:{odds,results},
  results:{logloss,brier}, odds:{…}, with_closing:{results,odds,market}, odds_vs_results_logloss:{mean,se,t} }`.
  Criterio para encender: `t ≤ −2` con n ≥ 300 en `with_closing` y `odds.logloss` por debajo de `results`.

**Qué consenso existe en producción y a qué hora.** El barrido de The Odds API corre cada `GP_CLUBS_SWEEP_MIN`
(12 min) para todos los eventos de las ligas en temporada → `db.clubClosing1x2` queda con la última pasada
antes del saque (≤ 12 min antes: cierre de facto). `data/clubs/odds-archive/<día>.json.gz` (disco de Render)
guarda UN snapshot diario del sweep (el primero del día), no un cierre; `db.marketOpenings` guarda la PRIMERA
cuota (apertura). Ninguno de los dos sirve de cierre; por eso el paralelo lee su propio `db.clubClosing1x2`.

**Verificación:** `node --check server.js clubs-engine/eloOdds.js scripts/*.js scripts/smoke/elo-odds-smoke.js`
→ OK; `node scripts/smoke/elo-odds-smoke.js` → 8 bloques OK; backtest corrido de punta a punta (2 pasadas).

## 5. Smoke (tarea 4)

`scripts/smoke/elo-odds-smoke.js` (sin red, sin server, sin db): esperanza implícita ↔ diferencia de Elo
(inversa exacta); `resultDelta` = `applyClubElo` en 5 casos (K=30, G, W); serie sintética con cierre
constante converge a la implícita con K=60 (49 pasos) y K=250 (9 pasos), brecha monótona (sin sobrepasar);
la dirección del Δ sigue al mercado; `combinedDelta` en los tres modos y reserva al resultado sin cierre;
`regressSeason` α=0/1/0,2 sin mutar; `applyToOverlay` con prior de copa; `GP_CLUB_ELO_SOURCE` default
`results` y params con defaults sanos.

## 6. Pendientes

1. **Prior de plantilla:** correr `clubs-squad-values.js` con `THESTATSAPI_KEY` y el backtest con `--squad`
   (§3). Decidir después si el prior entra al paralelo al inicio de 2026-27 (el paralelo ya lleva el prior
   del mercado por construcción).
2. **Encender el paralelo** (`GP_CLUB_ELO_SOURCE=odds`) cuando `odds.compare` acumule n ≥ 300 con cierre y
   t ≤ −2 (unas 3-4 semanas de ligas en temporada).
3. **El transform pierde +0,005 contra el propio cierre:** re-medir `CALIB_LAMBDA=0,15` y el Poisson/DC del
   1X2 de clubes con este mismo backtest (`matchProbs` es del Mundial; el 1X2 de clubes está más comprimido de
   lo que el mercado dice). Es la mitad de la distancia al cierre y no depende del rating.
4. Pool por país (`--pool country`) no se evaluó como variante final (ascensos/descensos compartiendo
   rating); el script lo soporta.
5. `db.clubClosing1x2` añade ~200 B por partido con cuotas durante 7 días (≈ 300 KB en db.json en semanas
   llenas); si pesa, bajar la poda a 4 días.

## 7. Riesgos de merge (regiones de `server.js`)

- **~4344** (`clubsQuotesSweep`): una línea insertada justo tras `db.clubsQuoteEvents[ceid] = …`. Conflicto
  trivial si otra rama toca el loop del barrido.
- **~5746-5836** (bloque Elo dinámico F0.4): `clubElo` cambia de cuerpo (2 líneas); todo lo demás es código
  nuevo entre `clubCupTierOffset` y `applyClubElo`. Si `impl/futbol`-style ramas tocan `clubElo`/`applyClubElo`,
  resolver conservando `clubEloResults` como la versión "de siempre".
- **~6021 y ~6170**: las dos líneas de `applyClubElo(...)` en el sync ESPN/TSA ganan un `try{applyClubEloOdds}`
  delante. Quien toque esas líneas debe mantener el orden (odds ANTES de resultados).
- **~22987-23000** (`/api/internal/clubs-elo`): la respuesta gana la clave `odds`; el `overlay` y `adjusted`
  de siempre no cambian.
- `db.json` gana tres claves nuevas (`clubElosOdds`, `clubClosing1x2`, `clubElosOddsLog`): aditivas, sin
  migración; un rollback las deja inertes.
