# REPORT — mejoras COMBATE (rama `impl/combate`, base `72f9c1d`)

Fecha: 2-sep-2026. Spec: `scratchpad/impl/spec-combate.md`. Rama empujada a `origin/impl/combate`; `main` y
`claude/*` sin tocar. Sin cambios sin commitear.

## Commits

| hash | contenido |
|---|---|
| `6c0be08` | `combat-engine/monitor.js` (nuevo, puro) + regiones de combate de `server.js` (etiquetas al nacer, T−24 h, `fight_breakdown` del track, guarda de placeholder) + `scripts/smoke/combate-smoke.js` |
| `c4b19cd` | `scripts/combat-odds-history.js` + `data/combat/odds-history.json.gz` (132 KB) + `docs/PREREGISTRO_COMBATE_FAVORITO.md` |
| (este) | `docs/COMBATE_CUOTAS_HISTORICAS.md` + `docs/impl/combate-REPORT.md` |

(El mensaje de `6c0be08` dice "17 comprobaciones"; el smoke imprime 16. Es solo el texto del commit.)

## Archivos

- **`combat-engine/monitor.js`** — NUEVO. Sin db, sin red, `now` por parámetro. `pickTags`, `t24Eval`,
  `isPlaceholderDate`, `hoursToEvent`, `aggClv`, `trackBreakdown` y las constantes (`BLEND_W` 0,5,
  `EDGE_MIN_PP` 2, `DRIFT_MAX` 0,05, `T24_WINDOW_H` 26, `PREREG_FAV_K` 0,45, `PLACEHOLDER_MAX_DAYS` 120).
  Repite 0,5 / 2 pp a propósito para juzgar la degradación: la compuerta de `server.js` no se importa ni se toca.
- **`server.js`** — solo regiones de combate (líneas aprox. tras el cambio):
  - **14331** `const CBM = require('./combat-engine/monitor')` junto a `COMBAT_MAX_ODDS`.
  - **14376** `buildCombatPicksOrg`: guarda `CBM.isPlaceholderDate(ev.date, now)` antes de recorrer las peleas
    (contador `out.placeholder_skipped`). Tarea 6.
  - **14411-14425** creación de la pick FIGHT: `wctx` se calcula una vez y se reutiliza en `fightBreakdown`;
    `pressFlags = combatIntelFlags(...).concat(combatNewsFlags(...))` dentro de `try`; la pick nace con
    `...CBM.pickTags(...)` → `market_fair_at_create`, `fav_market`, `prereg_fav45`, `espn_order_home`,
    `weigh_signal`, `press_signals`, `hours_to_event`. Tarea 1.
  - **14524-14536** bucle de `closing` (rama FIGHT): `CBM.t24Eval(p, { oddsNow, fairNow, now })` con la
    MISMA `mo = combatFightOdds(C, ft)`; `Object.assign(p, t24)`; contadores `out.t24_evaluated`,
    `out.t24_degraded`. Tarea 2.
  - **14314** el `save()` del wrapper incluye `out.t24_evaluated`.
  - **14697** `cbPushDerivPick` (ROUNDS/METHOD): `market_fair_at_create`, `hours_to_event`. Tarea 1.
  - **14757-14765** `combatPicksTrack`: añade `fight_breakdown` (`prereg_fav45.{si,no}`,
    `degraded_monitor.{si,no,sin_t24}`, `clv_by_side.{favorito,perro}`, cada uno con n, w, l, hit, units,
    roi_pct, clv_n, clv_avg, clv_sd, clv_se, clv_t). `total/main/prelim/active` intactos. Tarea 3.
  - NO tocado: `combat-engine/ratings.js`, blend 0,5, umbral 2 pp, `COMBAT_MAX_ODDS`, liquidación
    (`settleCombatPicks`), rutas, fútbol/esports/tenis/baloncesto/real-executor/sombra.
- **`scripts/smoke/combate-smoke.js`** — 16 comprobaciones (tarea "Verificación").
- **`scripts/combat-odds-history.js`** — tarea 5 (ver abajo).
- **`data/combat/odds-history.json.gz`** — 132 KB, 6.090 peleas (4.180 fuera de muestra).
- **`docs/PREREGISTRO_COMBATE_FAVORITO.md`** — tarea 4.
- **`docs/COMBATE_CUOTAS_HISTORICAS.md`** — resultados de la tarea 5.

## Campos nuevos en la pick

FIGHT: `market_fair_at_create` (k, 4 dec), `fav_market` (k ≥ 0,50), `prereg_fav45` (k ≥ 0,45),
`espn_order_home` (lado = f1 listado primero por ESPN; `null` en boxeo, cuya agenda no viene de ESPN),
`weigh_signal` (`{over1, over2, sched}` tal cual `combatWeighCtx`), `press_signals` (`["f1:layoff",
"f2:news_INJURY", …]`, dedup), `hours_to_event`. A T−24 h: `odds_t24`, `fair_t24`, `drift_t24_pct` (%),
`edge_blend_t24_pp`, `t24_at`, `t24_hours_to_event`, `degraded_monitor`, `degraded_reason`.
ROUNDS/METHOD: `market_fair_at_create`, `hours_to_event`.
Las picks anteriores no llevan etiquetas: `trackBreakdown` las clasifica por `market_prob` (misma k) y las
deja en `degraded_monitor.sin_t24`.

## Verificación

```
$ node --check server.js && node --check combat-engine/monitor.js && node --check scripts/combat-odds-history.js && node --check scripts/smoke/combate-smoke.js   → OK
$ node scripts/smoke/combate-smoke.js
  ok  k=0,46: prereg_fav45=true, fav_market=false, prensa dedup, 24 h de antelación
  ok  k=0,55 boxeo: favorito, espn_order_home=null, sin pesaje
  ok  k=0,40 perro: prereg_fav45=false; fecha inválida → hours_to_event null
  ok  fuera de la ventana (26 h → 0 h) no se evalúa
  ok  T−20 h sin deriva: evaluada, degraded_monitor=false, ventaja 5 pp
  ok  deriva +10 % → degradada por cuota
  ok  fair 0,57 → ventaja 1,5 pp < 2 → degradada por ventaja (no por cuota)
  ok  deriva exacta 5 % no degrada (umbral estricto)
  ok  idempotente: la segunda pasada no reescribe la foto
  ok  solo FIGHT ACTIVE
  ok  placeholder: 31-dic 22/23h o >120 días; el resto no
  ok  prereg_fav45=sí: n=2, CLV medio 3 ± 1 (sd 1,41/√2), ROI −10 %
  ok  prereg_fav45=no: la pick vieja (k=0,30) cae aquí por market_prob; CLV −4 ± 2
  ok  degradación: 1 sí, 2 no, 1 sin foto T−24
  ok  CLV por lado: 1 favorito, 3 perros (CLV −2)
  ok  n=1 sin sd/se; n=0 todo null (sin división por cero)
combate-smoke: 16 comprobaciones OK
```
Un fallo real encontrado por el smoke y corregido antes del commit: `2,1/2,0 − 1` da `0,05000000000000004` y
degradaba una deriva exacta del 5 %; ahora se juzga sobre el valor redondeado a 2 decimales que se guarda.
`server.js` nunca se arrancó (regla dura).

## Cuotas históricas (tarea 5) — CONSEGUIDAS

- URLs probadas: `mdabbert/Ultimate-UFC-Dataset/{master,main}` → 404; tres repos adivinados → 404; búsqueda de
  código GitHub `filename:ufc-master.csv` → **`shortlikeafox/ultimate_ufc_dataset/main/data/ultimate_ufc_dataset/ufc-master.csv`
  → 200, 2,9 MB** (repo del autor del dataset de Kaggle; columnas `RedOdds/BlueOdds`, 6.541 filas 2010-2024,
  6.303 con cuota). `raw.githubusercontent.com` no está bloqueado. Kaggle directo no se intentó.
- Salida del script (`node scripts/combat-odds-history.js --csv=…`, 1,5 s):
```
CSV … filas 6541 · con cuotas 6303 · cruzadas 6090 · ambiguas 2 · sin cruce 211
ganador CSV vs nuestro: coinciden 6088 · discrepan 2
walk-forward: 8987 peleas · warm 3145 (hasta 2015-07-15) · fine join 2199 · cruzadas 6090 · evaluadas fuera de muestra: 4180
GLOBAL:
  cierre         {"n":4180,"brier":0.212,"logloss":0.6118,"acc":0.6598}
  elo_puro       {"n":4180,"brier":0.2434,"logloss":0.6797,"acc":0.5699}
  modelo_actual  {"n":4180,"brier":0.2343,"logloss":0.661,"acc":0.6096}
  blend_05       {"n":4180,"brier":0.218,"logloss":0.6263,"acc":0.6553}
  modelo − cierre (Brier pareado): dBrier +0.02228 se 0.002 t 11.16
  blend0,5 − cierre:               dBrier +0.0060  se 0.00098 t 6.13
  modelo − Elo puro:               dBrier −0.0091  se 0.0014 t −6.49
  w* lineal (log-loss): w=1.00 global; por año 0,90 (2015) 0,85 (2016) 0,95 (2017) y 1,00 de 2018 a 2024
REGLA PREREGISTRADA AL CIERRE (≥2 pp, cuota <3):
  todas          n 2031 hit 47.0 ROI −0.6 ± 2.4
  prereg_fav45   n  852 hit 59.6 ROI +5.2 ± 3.0   ← replica H3d
  perro k<0,45   n 1179 hit 37.9 ROI −4.8 ± 3.6
  favorito k≥0,5 n  611 hit 60.6 ROI +1.0 ± 3.3
cruce compacto: 6090 peleas (4180 fuera de muestra) · 132 KB gzip → escrito data/combat/odds-history.json.gz
```
- Lectura: el cierre bate al modelo (t 11) y a la mezcla 0,5 (t 6); **ningún w interior mejora al cierre en
  ningún año** → el modelo market-blind no añade información al cierre de UFC. El corte por lado del
  preregistro se replica en 2.031 picks simuladas (+5,2 % favorito amplio vs −4,8 % perro, diferencia t ≈ 2,1).
  Detalle en `docs/COMBATE_CUOTAS_HISTORICAS.md`.

## Higiene (tarea 6)

Dónde nacían: `combatBoxingUpcoming` agrupa el placeholder 31-dic como `date_tbd` y `buildCombatPicksOrg` ya lo
saltaba, pero la agenda **restaurada** desde `db.boxingAgenda`/picks puede llegar sin `date_tbd`. Ahora la
guarda `CBM.isPlaceholderDate` (31-dic 22/23h **o** > 120 días) corre en `buildCombatPicksOrg` para todas las
orgs, antes del filtro fantasma. El VOID retroactivo de las 31-dic (14305-14311) sigue como estaba.

## Pendientes

- Script de revisión del preregistro que filtre `created_at ≥ corte` (el track acumulado mezcla picks viejas
  clasificadas por `market_prob`); la fecha de corte se fija con el deploy.
- El "cierre" del dataset no dice casa ni hora: comparar con nuestro `closing` real cuando haya muestra.
- Modelo market-aware (rasgos como corrección residual sobre el logit del cierre): ya se puede ajustar con
  `odds-history.json.gz`; NO se hizo (fuera del alcance: no tocar `ratings.js`).
- 2025-2026 no están en el CSV; nuestros `closing` reales son la continuación.

## Riesgos de merge

- `server.js` se tocó en 7 puntos, todos dentro de `buildCombatPicks*`, `cbPushDerivPick` y `combatPicksTrack`
  (líneas 14314-14765). Conflicto probable solo si otra rama edita esas mismas funciones.
- `fight_breakdown` es un campo NUEVO en `picks_track` (aditivo): `public/app.js` no lo consume, `EB.build`
  recibe la función igual. Nada del frontend cambia.
- Cada pick FIGHT crece ~10 campos; `db.json` crece de forma despreciable. La foto T−24 h escribe `save()`
  una vez por pick (idempotente).
- `data/combat/odds-history.json.gz` (132 KB) es binario en el repo; nadie lo carga en runtime.
- Sin variables de entorno nuevas, sin secretos, sin dependencias.
