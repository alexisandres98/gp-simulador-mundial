# Preregistro — combate FIGHT: el lado del favorito del mercado y la degradación a T−24 h

**Fecha de registro:** 2 de septiembre de 2026. **Corte:** picks FIGHT del monitor de combate **creadas a
partir del deploy** de la rama `impl/combate` (llevan `market_fair_at_create` y `prereg_fav45` en el propio
registro; las anteriores no lo tienen y, aunque el track las deriva de `market_prob` para comparar, **no
cuentan** para este preregistro).

De dónde sale: `docs/BACKTESTS_FAMILIAS_2026-09-02.md` §7.3-7.4. En las 48 FIGHT liquidadas hasta esa fecha,
comprar al **perro** del mercado dio CLV **−8,64 ± 2,47** (t −3,5, n=34) y comprar al **favorito** **+3,31 ± 1,73**
(t +1,9, n=14); diferencia +11,95 ± 3,02 (t 4,0), robusta post-techo y solo UFC. Es el único corte del libro
que sobrevive al escéptico, y solo en CLV. Con las cuotas históricas de UFC (`docs/COMBATE_CUOTAS_HISTORICAS.md`)
el mismo corte aparece en 2.031 picks simuladas al cierre 2015-2024: lado favorito amplio ROI +5,2 ± 3,0 %,
lado perro −4,8 ± 3,6 %. Eso es evidencia para **preregistrar**, no para cambiar la compuerta a mitad de muestra.

## Qué se declara antes de ver un solo resultado

### Regla 1 — el favorito amplio del mercado

- **Familia:** FIGHT (ganador) de UFC, MMA (Bellator/PFL) y boxeo, admin-only como hoy.
- **Regla fija:** la del monitor tal cual está: blend `0,5·modelo + 0,5·consenso`, ventaja post-blend
  **≥ 2 pp**, **techo de cuota 3**, muestra ≥ 3 peleas por peleador, filtros de fantasma/placeholder. **Nada de
  eso se toca durante la muestra.**
- **Subconjunto que se juzga:** las picks con `prereg_fav45 = true`, es decir, la probabilidad justa del
  consenso de **nuestro** lado al crear (`market_fair_at_create`) **≥ 0,45**. El 0,45 y no el 0,50 es para no
  perder los pick'em; `fav_market` (≥ 0,50) se guarda también y se lee como corte secundario.
- **Muestra:** las primeras **40 picks liquidadas** (WIN/LOSS) con `prereg_fav45 = true` tras el corte, todas
  las orgs juntas. Las VOID no cuentan ni reinician nada.
- **Vara principal:** CLV medio contra el cierre (`clv_pct` = cuota tomada / cuota de cierre − 1, la misma
  fuente `combatFightOdds` de siempre), con su error estándar (`clv_se = sd/√n`).
- **Éxito:** CLV medio **> 0**. **Fracaso:** CLV medio **< −2** con **t < −1,5**. Entre medias: inconcluso,
  se extiende a 80 y se vuelve a leer.
- **Vara secundaria (se anota, no decide):** ROI a la cuota tomada y acierto; el complemento
  (`prereg_fav45 = false`, los perros) se mira al lado para saber si la diferencia sigue existiendo.
- **Qué NO se hace durante la muestra:** ni tocar el peso del blend, ni el umbral, ni el techo, ni convertir
  la etiqueta en compuerta. Si aparece un bug de medición, se documenta y se reinicia el contador.

### Regla 2 — degradación a T−24 h

- **Qué pasa:** entre 26 h y 0 h antes del campanazo, el ciclo de combate toma **una** foto de la cuota y del
  fair actual de nuestro lado (`odds_t24`, `fair_t24`, `drift_t24_pct`) y marca `degraded_monitor = true` si
  **(a)** nuestro lado se alargó **más de un 5 %** respecto a la cuota tomada, o **(b)** con el fair actual la
  ventaja post-blend queda **por debajo de 2 pp**. `degraded_reason` dice cuál. **No cambia el status:** la
  pick sigue ACTIVE y liquida igual; solo se etiqueta.
- **Hipótesis:** las degradadas tienen CLV peor que las no degradadas (el mercado tardío tiene razón:
  corr(deriva tomada→cierre, resultado) −0,31 en el libro). Si con **40 degradadas liquidadas** su CLV medio
  no es peor que el de las no degradadas (diferencia con t > 1,5), la regla no vale como veto y se retira.
- Si sí lo es, la propuesta que se llevaría a revisión es "degradar a monitor" (no publicar) — **hoy no se
  aplica**, solo se mide.

## Por qué 40 y por qué CLV

El CLV de las FIGHT tiene sd ≈ 13 puntos en el libro: con 40 picks el error estándar es ≈ 2 pp, suficiente
para separar el −8,6 de los perros del +3,3 de los favoritos. El ROI con n=40 tiene se ≈ 15 puntos: no decide.

## Cómo leerlo el lunes

```
GET /api/combat/state?org=ufc   (admin)  → picks_track.fight_breakdown
   .prereg_fav45.si / .no          n, hit, roi_pct, clv_avg, clv_sd, clv_se, clv_t
   .degraded_monitor.si / .no / .sin_t24
   .clv_by_side.favorito / .perro
```
El track es acumulado sobre TODAS las FIGHT liquidadas (las viejas se clasifican por `market_prob`); para el
preregistro hay que filtrar además por `created_at ≥ corte`, que es lo que hará el script de revisión.
Resultado y decisión se anotan al pie de este archivo.

## Resultado

_(pendiente: se rellena al llegar a 40 liquidadas con `prereg_fav45 = true`)_
