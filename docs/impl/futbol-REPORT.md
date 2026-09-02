# REPORT — mejoras de FÚTBOL DE CLUBES (rama `impl/futbol`)

**Fecha:** 2 de septiembre de 2026. **Base:** `72f9c1d2` (origin/main al arrancar). **Spec:** mejoras SOLID (1X2),
GOALS y CORNERS salidas de `docs/BACKTESTS_FAMILIAS_2026-09-02.md` §3 y `docs/AUTOPSIA_MODELOS_2026-09-02.md` §4.1-4.2.
**Regla dura cumplida:** CARDS (`cards_under_v1`) no se toca — demostración en §3. El servidor NUNCA se arrancó.

## 1. Commits (todos empujados a `origin/impl/futbol`)

| Commit | Qué |
|---|---|
| `286156c7` | `lib/devig.js`: `shinDevig`, `shinConsensus1x2`, `publishableProb` (helper puro, sin dependencias externas) |
| `6ea2d83b` | `server.js`: consenso Shin + `p_pub` en el 1X2, campos de creación congelados, preregistros, sombra de SUPERSEDED, track a cuota de creación |
| `b226aec6` | `clubs-engine/cups.js` + prior por división; `scripts/clubs-cups-gap.js`; `scripts/clubs-closes-fd.js` + `docs/DEVIG_SHIN_MEDIDO.md`; dos preregistros; `scripts/smoke/futbol-smoke.js` |
| (este) | `docs/impl/futbol-REPORT.md` |

## 2. Archivos y regiones de `server.js` (líneas de la rama)

**Nuevos:** `lib/devig.js`, `clubs-engine/cups.js`, `scripts/clubs-cups-gap.js`, `scripts/clubs-closes-fd.js`,
`scripts/smoke/futbol-smoke.js`, `docs/PREREGISTRO_GOALS_TARDE.md`, `docs/PREREGISTRO_CORNERS_2CASAS.md`,
`docs/DEVIG_SHIN_MEDIDO.md`, `docs/impl/futbol-REPORT.md`.

**`server.js`** (solo regiones de clubes; 240 líneas de diff, +190/−50):

| Líneas | Región | Cambio |
|---|---|---|
| ~4240-4256 | `CLUB_CUPS` / `clubsEnsureCups` | La config y la fusión viven ahora en `clubs-engine/cups.js`; `clubsEnsureCups` llama a `buildCupLeague` (copias + prior por división) |
| ~5732-5761 | `clubCupTierOffset` (nuevo), `clubElo`, `applyClubElo` | El overlay `db.clubElos` es global por equipo: el prior se SUMA al leer dentro de la copa y se RESTA al escribir. Sin esto el prior era un no-op en cuanto el equipo tenía un resultado (tarea 3) |
| ~7482-7501 | `buildClubDailyPicks`, rama `mk.market_family === '1x2'` | Consenso Shin por casa + mediana entre casas → `sel[o].market`; el proporcional del scanner queda en `sel[o].marketProp`; `ev.devig` |
| ~7716-7748 | `mkRecord` | Nuevos campos: `odds_at_create`, `best_book_at_create`, `books_at_create`, `hours_to_ko`, `model_prob_raw`, `market_prob_prop`, `devig`, `solid_c` |
| ~7763-7815 | Generación SOLID (anchor/lead) | `p_pub = publishableProb(k_shin, m, GP_SOLID_C)`; `model_prob = p_pub`, `model_prob_raw = m`; la ventaja de `lead` = `(p_pub − k)·100 ≥ 2` |
| ~7881-7893 | Bloque PREREGISTROS | GOALS: `price_vs_fair`, `prereg_goals_late`; CORNERS: `prereg_corners_2books` |
| ~8381-8416 | `recoverClubSupersededResults` | Llama a `measureClubSupersededShadow` al final (`shadow_measured`) |
| ~8418-8470 | `measureClubSupersededShadow` (nuevo) | `shadow_result: {code, units, score, odds, at}` en SETTLED/SUPERSEDED de SOLID/GOALS/CORNERS; NO toca `status` ni `result_code` |
| ~8504-8540 | `refreshClubPickPrices` | Conserva `odds_at_create`/`books_at_create`/`best_book_at_create` (backfill del primer refresco para picks viejas); anota `books_final` |
| ~8563-8606 | `captureClubPicksClosing`, rama SOLID | `closing.fair_prob_shin` AL LADO (medición); el CLV sigue con el proporcional |
| ~8657-8705 | `clubDailyPicksTrackRecord` | `pnl_at_create`/`roi_at_create` en cada bloque; claves `GOALS\|prereg_goals_late:on/off`, `CORNERS\|prereg_corners_2books:on/off`, `CORNERS\|ligamx/resto` y su cruce; bloque `superseded_medido` |
| ~9275-9285 | `evaluateClubDailyPicks` | `measureClubSupersededShadow()` tras el settle (try/catch; `_clubPicksLast.shadow_superseded`) |

## 3. Demostración: qué de-vig usa cada familia (CARDS intacto)

| Familia | Dónde nace `market_prob` | Función de de-vig | Cambió |
|---|---|---|---|
| **SOLID** (1X2) | `buildClubDailyPicks` rama `1x2` (~7493) | `lib/devig.shinConsensus1x2` (Shin por casa, mediana) — `market_prob_prop` = `scanner.consensus` proporcional | **Sí** |
| **GOALS** | rama `match_total` (~7505: `cons.fair[side]`) | `market-scanner/scanner.consensus` → `value-engine/noVig.removeVig({method:'proportional'})`, dos lados | No |
| **CORNERS** | bloque props (~7631) | `goal-engine/noVig.consensus(quotes,'over','under',{minGroups:1})` proporcional a dos lados | No |
| **CARDS** | bloque props (~7631), MISMA llamada que CORNERS | `goal-engine/noVig.consensus` proporcional a dos lados | **No** |
| Cierre GOALS/CORNERS/CARDS | `captureClubPicksClosing` (~8588) | `(1/o_over)/(1/o_over+1/o_under)` por casa, mediana | No |

Pruebas en el humo (§4): `goal-engine/noVig.js`, `value-engine/noVig.js`, `market-scanner/scanner.js` y
`pick-engine/curate.js` no referencian `lib/devig` ni Shin; `server.js` requiere `lib/devig` en exactamente 3
sitios (7493, 7771, 8575) y los tres están en bloques 1X2/SOLID; la línea del cierre a dos lados y la regla
`CARDS over → monitor` siguen byte-idénticas. `git diff 72f9c1d -- server.js | grep CARDS` devuelve una sola
línea y es un comentario ("GOALS/CORNERS/CARDS no pasan por aquí"). Nada de lo tocado altera la probabilidad
publicada, el gate, el régimen ni la liquidación de CARDS; los campos nuevos de `mkRecord` (`odds_at_create`,
`books_at_create`, `hours_to_ko`) son aditivos y `refreshClubPickPrices` ya escribía `odds_at_create`.

## 4. Verificación

```
node --check server.js lib/devig.js clubs-engine/cups.js scripts/clubs-cups-gap.js scripts/clubs-closes-fd.js scripts/smoke/futbol-smoke.js  → OK
node scripts/smoke/futbol-smoke.js → 47/47 comprobaciones bien
```
Humo: (1) `shinDevig` suma 1, longshot 0,0818 → 0,0782 y favorito 0,7547 → 0,7608 para [1,30, 6,00, 12,0]
(z = 0,0097); tres cuotas iguales → 1/3; cuota 1,00 / una sola cuota → `invalid`; sin margen → reserva potencia;
dos resultados suman 1; consenso ignora casas incompletas. (2) `p_pub`: c=0 → mercado; c=0,5 → punto medio exacto
en logit (0,7101 entre 0,6 y 0,8); c=1 → modelo; sin modelo → mercado. (3) Copas con ratings sintéticos: nivel 1
sin ajuste, lista dentro de `from` = mismo nivel, nivel 2 −150, nivel 3 −300, origen NO mutado, copia ≠
referencia, GAP=0 reproduce la fusión anterior, `uclq` todas nivel 1, `facup` 1..4, `brasilb` nivel 2 en
Libertadores; aritmética overlay+prior y escritura sin prior. (4) De-vig de totales idéntico (ver §3).

`git diff 72f9c1d --stat`: 9 archivos, +839/−50; solo `server.js` entre los existentes.

### 4.1 `scripts/clubs-cups-gap.js` sobre el libro real (3.377 picks; 92 SOLID de copas fusionadas)

Elo BASE de `ratings.json` (el overlay vive en `db.json`, fuera del alcance del script); misma regla para GAP=0 y 150.

| Tramo | n | modelo−mercado GAP=0 | GAP=150 | \|disc\| GAP=0 → 150 | n dec. | Brier mercado / GAP=0 / GAP=150 |
|---|---:|---:|---:|---:|---:|---|
| Todas | 92 | +10,4 pp | **+2,8 pp** | 14,6 → 6,6 | 63 | 0,127 / 0,195 / **0,138** |
| Cruzan división | 49 | +15,7 pp | **+1,5 pp** | 20,1 → 5,1 | 38 | 0,090 / 0,185 / **0,091** |
| Misma división | 43 | +4,4 pp | +4,4 pp | 8,3 → 8,3 | 25 | 0,184 / 0,210 / 0,210 |
| DFB-Pokal | 18 | +21,7 | +1,8 | 21,7 → 5,5 | 15 | 0,080 / 0,171 / 0,079 |
| EFL Cup | 27 | +8,5 | +2,3 | 16,4 → 5,3 | 18 | 0,111 / 0,221 / 0,124 |
| Coppa Italia | 18 | +12,9 | +3,2 | 14,0 → 6,2 | 15 | 0,167 / 0,199 / 0,169 |
| Libertadores / Sudamericana / uclq / Leagues Cup | 11 / 6 / 6 / 6 | sin cruces de nivel en el libro → sin cambio | | | | |

Lectura: el prior de 150 elimina casi toda la discrepancia extra de las copas cuando cruzan divisiones (+15,7 →
+1,5 pp) y deja el Brier del modelo igual al del mercado en ese tramo (0,091 vs 0,090). Lo que queda (+4,4 pp
en misma división) es la sobreconfianza general del Elo del §4.1 de la autopsia, no un problema de copas.
El valor 150 sigue siendo un prior declarado: no se ajustó con esta tabla.

### 4.2 `scripts/clubs-closes-fd.js` — football-data.co.uk (la red NO bloqueó)

19.850 partidos (2324, 2425, 2526; 18 divisiones; cierre Pinnacle 15.910, media de cierre 3.936); z medio 0,0216.

| Tramo de cuota | n | Prop. | Shin | Real | Error prop. | Error Shin | Brier prop. | Brier Shin |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ≤1,50 | 2892 | 72,7 % | 74,0 % | 75,1 % | −2,47 | −1,15 | 0,1818 | 0,1813 |
| 1,50-2,00 | 6807 | 54,5 % | 55,2 % | 55,7 % | −1,18 | −0,49 | 0,2441 | 0,2439 |
| 2,00-2,50 | 7523 | 42,8 % | 43,1 % | 44,1 % | −1,29 | −1,00 | 0,2462 | 0,2461 |
| 2,50-3,20 | 11057 | 33,2 % | 33,2 % | 32,7 % | +0,55 | +0,53 | 0,2195 | 0,2195 |
| 3,20-5,00 | 23852 | 25,6 % | 25,4 % | 25,3 % | +0,35 | +0,11 | 0,1877 | 0,1876 |
| 5,00-8,00 | 5218 | 16,1 % | 15,5 % | 15,1 % | +0,99 | +0,43 | 0,1281 | 0,1280 |
| >8,00 | 2201 | 8,7 % | 7,9 % | 6,4 % | +2,36 | +1,58 | 0,0596 | 0,0593 |
| **Total** | 59550 | | | | | | 0,1972 | 0,1971 |

Log-loss: proporcional 0,57919 · Shin 0,57894. Shin corrige algo más de la mitad del sesgo favorito-longshot en
los extremos sin empeorar ningún tramo; detalle y lectura en `docs/DEVIG_SHIN_MEDIDO.md`.

## 5. Decisiones de implementación que conviene conocer

1. **Nivel en copas = orden de `from`, con listas para empates.** Leído al pie de la letra, "orden de `from` =
   nivel" habría restado 750 Elo a la Eredivisie en `uclq` y 150 a Argentina en Libertadores. Cada elemento de
   `from` es un nivel y un elemento que es lista agrupa ligas del mismo nivel (`[['brasileirao','argentina',…],
   'brasilb']`, `[[…19 ligas…]]` para uclq). Copas domésticas quedan idénticas al orden anterior.
2. **`clubElo` / `applyClubElo` tocados** (región de clubes): sin sumar/restar `tier_offset` sobre el overlay
   global, el prior solo actuaba mientras un equipo no tuviera resultados. Fuera de copas el offset es 0 y la
   aritmética es exactamente la anterior.
3. **Gate del ancla sin cambios**: `blendEdge ≥ −2` y `MODEL_AGREES_UP` siguen con el Elo crudo (`m`), sobre el
   consenso Shin. Solo `model_prob`/`confidence` pasan a `p_pub`. Con c=0 la poda `md > mk+0,05` (línea ~7949) y
   el esquema `md ≤ mk+0,05` de `officialClubRecord` son trivialmente ciertos para anchors nuevas; las ACTIVE
   anteriores conservan su `model_prob` crudo y se comportan como hasta ahora.
4. **Cierre de SOLID**: `fair_prob_shin` se guarda al lado; `computeClv` sigue leyendo `fair_prob` proporcional
   para no cortar la serie histórica de CLV. Cambiarlo es una decisión aparte.
5. **`superseded_medido` no entra a ningún cuadro** (ni público ni `officialClubRecord`); vive solo en
   `track_record` del track admin. La primera pasada en producción medirá las ~1.100 SUPERSEDED históricas de
   SOLID/GOALS/CORNERS cuyo marcador esté en `results-<liga>.json` / `props-history-<liga>.json` del disco.
6. `GP_SOLID_C` y `GP_CUP_TIER_GAP_ELO` se leen en cada ciclo (sin deploy para cambiarlos… salvo que Render
   requiera redeploy para propagar env, como con el saldo LLM).

## 6. Pendientes

- **Desplegar y mirar la primera pasada**: `_clubPicksLast.shadow_superseded.measured`, bloque
  `superseded_medido` y que las SOLID nuevas traigan `devig:'shin'`, `market_prob_prop`, `model_prob_raw`.
- Con `GP_SOLID_C=0` (default) **`lead` no genera picks**: confirmar que es lo que Alexis quiere ya (el 23-ago
  se acordó apagar el ganador). El código sigue vivo para cuando `c` se estime > 0.
- Preregistros: leer `GOALS|prereg_goals_late` a las 60 picks (vara CLV) y `CORNERS|prereg_corners_2books:*|resto`
  a las ~225 (vara ROI a creación). Documentos con la regla congelada.
- `clubs-cups-gap.js` usa Elo base; una versión con el overlay requiere el `db.json` del disco.
- El hueco restante del longshot (>8,00 sigue +1,6 pp con Shin) se cierra con el tope de cuota del 1X2 ya
  acordado, no con más de-vig.

## 7. Riesgos de merge

- `origin/main` avanzó durante el trabajo a `547c14e5` ("ejecutor real: stake plano…": `real-executor/store.js`
  +7, `server.js` +11 en la región del ejecutor real). `git merge-tree --write-tree HEAD origin/main` →
  **sin conflictos**. La rama sigue basada en `72f9c1d2`; rebase o merge son triviales.
- Otros agentes editan `server.js` en otras regiones (esports, tenis, baloncesto, combate). Mis cambios están
  acotados a las regiones de clubes listadas en §2; el único símbolo nuevo a nivel de módulo es el `require` de
  `./clubs-engine/cups` (línea ~4245) y `clubCupTierOffset` (~5736).
- `mkRecord` pasó de expresión a bloque (`{ const koAt…; return {…}; }`): un merge que toque sus campos debe
  respetar el cierre `};` doble.
- Los preregistros dependen de que `books_at_create` exista: las picks anteriores lo reciben en su primer
  refresco (valor que había), sin etiqueta → se distinguen solas.
