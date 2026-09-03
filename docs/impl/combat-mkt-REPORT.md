# REPORT — COMBATE: modelo consciente del mercado (rama `impl/combat-mkt`, base `673202bb`)

Fecha: 3-sep-2026. Spec: `scratchpad/impl/spec-combat-mkt.md`. Rama empujada a `origin/impl/combat-mkt`;
`main` sin tocar; árbol limpio. `server.js` nunca se arrancó; `combat-engine/ratings.js`, el blend 0,5, el
umbral 2 pp, el techo 3 y la generación de picks no se tocaron.

## Commits

| hash | contenido |
|---|---|
| `49dbab34` | `scripts/combat-market-aware.js` (backtest) + `combat-engine/market-aware.js` (puro) + `data/combat/market-aware-priors.json` (coeficientes 0) |
| `762538f8` | `server.js` (región de combate: `p_mkt_aware`, `edge_mkt_aware_pp`, probe) + `combat-engine/monitor.js` (`fight_breakdown.mkt_aware_edge`) + `scripts/smoke/combat-mkt-smoke.js` + arreglo de `edgePP(null)` |
| (este) | `docs/COMBATE_MODELO_MERCADO.md` + `docs/impl/combat-mkt-REPORT.md` |

## Veredicto del backtest (tarea 1)

Sobre las **4.180** peleas fuera de muestra (UFC 2015-07 → 2024-12), walk-forward por año (entrena < año,
evalúa el año; rasgo activo solo con ≥ 200 filas ≠ 0 de entrenamiento), `logit(p) = a·logit(p_cierre) + Σ b_i·x_i`,
pareado por pelea, bootstrap 2.000:

| variante | coef (t, ajuste final n=6.090) | Δlog-loss vs cierre (t) | Δlog-loss vs cierre **recalibrado** (t) | P(mejor) |
|---|---|---|---|---|
| cierre recalibrado (solo a) | a = 1,112 (28,7) | −0,00084 (−2,37) | — | 0,991 |
| + age | −0,149 (−3,3) | −0,00180 (−2,28) | **−0,00095 (−1,45)** | 0,929 |
| + reach | +0,168 (1,9) | −0,00106 (−1,88) | −0,00021 (−0,48) | 0,68 |
| + exp / years / chin / streak / mileage | \|t\| ≤ 1,0 | −0,0007…−0,0008 (≈ −1,8…−2,0) | ≈ 0 (+0,05…+1,5) | 0,2-0,5 |
| + misswt, slpm, td15, tddef, ctrl, kdr | inertes (sin muestra con cuota) | = recal | 0 | — |
| + delo (Elo − cierre) | −0,142 (−1,8) | −0,00090 (−1,82) | −0,00006 (−0,16) | 0,55 |
| + dmodel (modelo − cierre) | +0,069 (1,1) | −0,00068 (−1,43) | +0,00017 (+0,63) | 0,27 |
| físicos 7 | 8 cols | −0,00193 (−1,85) | −0,00109 (−1,12) | 0,86 |
| full (delo + 13) | 15 cols | −0,00182 (−1,73) | −0,00098 (−1,00) | 0,85 |

- **Ningún rasgo pasa t ≤ −2 fuera de muestra frente al cierre recalibrado** → `market-aware-priors.json` con
  `close = 1` y todos los rasgos a **0**; `variante: cierre_solo`; el archivo lo dice en `veredicto`.
- Único candidato: **edad** (t −1,45, P 0,93; gana en 2016, 2017 y 2023, nada en 2019/2022/2024). Tamaño: 8 años
  de brecha ≈ 3,7 pp a 50/50. `delo` = 0: la discrepancia del Elo con el cierre no lleva información.
- Lo único con t > 2 es **recalibrar el cierre** (a = 1,11; Shin −0,00072, t −2,96): sesgo favorito-longshot del
  de-vig proporcional. No es un rasgo del modelo; no se publica solo. Es una decisión de `combatFightOdds`.
- Finas y pesaje: 4 / 83 / 195 peleas activas con cuota en 2022 / 2023 / 2024 y 92 pesajes → sin muestra. Sin la
  regla de actividad daban coeficientes de ±8 y +0,35 de log-loss en 2023 (artefacto detectado en la 1ª pasada).
- **Regla de lado** (cuota < 3, ROI al cierre, sin CLV posible: una sola cuota por pelea): blend 0,5 fav45 ≥ 2 pp
  **n 852, +5,2 ± 3,0** vs perro −4,8 ± 3,6 (se replica con cualquier fuente); ≥ 4 pp +7,6 ± 4,1 (478), ≥ 6 pp
  +9,1 ± 5,9 (244): indistinguibles. Un modelo pegado al cierre casi no genera picks (≥ 2 pp = favoritos a 1,5-1,7,
  ROI 0-2 % ± 2); a ≥ 6 pp quedan ~230 con +6-8 % ± 5-6, no significativo y 3ª ventana mirada.
- Tablas completas por año y por fuente en `docs/COMBATE_MODELO_MERCADO.md`.

## Qué se implementó

- **`combat-engine/market-aware.js`** — NUEVO, puro. `FEATURE_KEYS` (13 de `featDiff` + `delo`),
  `zeroCoefs()`, `featuresFor({fd, pElo, pClose})`, `marketAwareProb({pClose, features, coefs})` (con coeficientes
  0 o ausentes devuelve `pClose` exacto; `pClose` inválido → null), `edgePP(p, k)`, `loadPriors(file)` (archivo
  ausente/roto → ceros; `meta` con fecha, variante, muestra, veredicto).
- **`data/combat/market-aware-priors.json`** — generado por el script con `--write-priors`: fecha, fuente,
  muestra (6.090 / 4.180 / años), de-vig, forma, criterio, `recalibracion_del_cierre`, `coefs` (todo 0),
  `resumen_oos` por variante.
- **`scripts/combat-market-aware.js`** — tarea 1 entera (reconstrucción walk-forward de rasgos con comprobación
  contra el archivo: 0 discrepancias > 0,0015; variantes; pareados vs cierre y vs recalibrado; por año; regla de
  lado × ventaja × fuente; selección y priors). `--boot`, `--min-train`, `--min-active`, `--write-priors`, `--json`.
- **`server.js`** (solo región de combate; líneas tras el cambio):
  - **14587-14591** `const CBMA = require('./combat-engine/market-aware'); const CB_MKT_AWARE = CBMA.loadPriors();`
    junto a `CBM`.
  - **14682-14692** creación de la pick FIGHT (tras `CBM.pickTags`): `CE.featDiff(C.elo, C.elo.PF, …, wctx)` +
    `CE.expected(pr.r1, pr.r2)` (Elo puro con rust que `fightProb` ya devuelve) → `p_mkt_aware` (4 dec, de nuestro
    lado) y `edge_mkt_aware_pp = (p_mkt_aware − k)·100`; todo dentro de `try` → null si algo falla. Tarea 3.
  - **14695** los dos campos en el objeto de la pick (tras `...tags`).
  - **22552** `/api/internal/combat-picks` (GET) añade `market_aware: {…meta, coefs}`.
- **`combat-engine/monitor.js`** — `MKT_AWARE_EDGE_PP = 2` y `trackBreakdown(...).mkt_aware_edge = {ge2, lt2,
  sin_dato}` con `aggClv` (n, hit, roi, CLV ± se, t). Tarea 3.
- **`scripts/smoke/combat-mkt-smoke.js`** — 9 comprobaciones. Tarea 4.

## Verificación

```
$ node --check server.js && node --check combat-engine/market-aware.js && node --check combat-engine/monitor.js \
    && node --check scripts/combat-market-aware.js && node --check scripts/smoke/combat-mkt-smoke.js   → OK
$ node scripts/smoke/combat-mkt-smoke.js
  ok  coeficientes 0 → p_cierre exacto (0,05 … 0,95), con o sin rasgos, con coefs null
  ok  p_cierre inválido (0, 1, NaN, texto) → null
  ok  coeficiente +0,4 · age +0,5 sube (valor exacto), −0,5 baja, antisimétrico, rasgo 0 no mueve, coef negativo baja
  ok  close = 1,1 aleja del 50 % en ambos lados y deja el 50 % quieto
  ok  rasgos NaN/texto/Infinity se ignoran
  ok  featuresFor: 14 claves, basura → 0, delo exacto; edgePP en pp con 2 decimales
  ok  loadPriors: archivo real ok (variante cierre_solo); inexistente → ceros y p_cierre
  ok  mkt_aware_edge: ge2 n=2 (el 2,0 exacto entra), lt2 n=2 con un CLV null, sin_dato n=1; ROUNDS fuera
  ok  vacío → todo null (sin división por cero); n=1 sin se/t; cortes previos intactos
combat-mkt-smoke: 9 comprobaciones OK
$ node scripts/smoke/combate-smoke.js   → combate-smoke: 16 comprobaciones OK (el del 2-sep sigue pasando)
$ node scripts/combat-market-aware.js   → 3,3 s; p_model recomputado vs archivo: 0 discrepancias
```
Comprobación extra sin server: `CE.fitElo(fights-ufc, fighters)` + el fragmento exacto de `server.js`
(`featDiff(C.elo, C.elo.PF, …)`, `expected(pr.r1, pr.r2)`, `marketAwareProb` con los priors reales) → `p_mkt_aware`
= `k` con coeficientes 0 y se mueve con un coeficiente de prueba. Fallo encontrado por el smoke y corregido:
`edgePP(null, 0.5)` devolvía −50 (`Number(null)` es 0) → ahora null.

## Pendientes

- Decidir el de-vig del consenso (`combatFightOdds`): proporcional infla al perro (a = 1,11, Shin t −2,96). Es la
  única señal con t > 2 y afecta a la `k` de todas las picks; medir antes con nuestros `closing` reales.
- Edad: re-testear frente al cierre recalibrado con 2025-2026 (nuestros `closing`); si repite t ≤ −2, escribir
  `feats.age` en los priors (el corte del track ya está esperando).
- Finas y pesaje: sin muestra con cuota; ≥ 400 peleas activas antes de volver a mirar.
- El "cierre" del dataset sigue siendo de una casa/hora desconocida.

## Riesgos de merge

- `server.js` tocado en 4 puntos: **14587-14591** (require + `loadPriors` al cargar el módulo, junto a `CBM`),
  **14682-14695** (dentro del bucle de creación de la pick FIGHT en `buildCombatPicksOrg`, entre `CBM.pickTags` y
  `fresh.push`), **22552** (`/api/internal/combat-picks`). Conflicto solo si otra rama edita esas mismas líneas.
- `loadPriors` corre al cargar `server.js` (lectura síncrona de un JSON de 4 KB, con try/catch): sin el archivo el
  server arranca igual con ceros.
- `p_mkt_aware` / `edge_mkt_aware_pp` son campos NUEVOS y aditivos en la pick FIGHT; `mkt_aware_edge` es aditivo en
  `picks_track.fight_breakdown`. `public/app.js` no consume ninguno; nada del frontend cambia.
- Sin variables de entorno nuevas, sin secretos, sin dependencias. `data/combat/market-aware-priors.json` se lee en
  runtime (4 KB); `odds-history.json.gz` no.
