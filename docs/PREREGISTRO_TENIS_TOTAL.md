# Preregistro — TENIS, familia TOTAL (juegos), ventaja ≥ 8 pp

> Escrito el 2 de septiembre de 2026, ANTES de mirar la muestra que decide. Sale de
> `BACKTESTS_FAMILIAS_2026-09-02.md` §6.5: el libro de TOTAL (+18 % por pick) eran 77 picks que en realidad
> son 43 eventos, con ROI por evento +10,5 % (SE 14,7, t 0,72) y solo 9 cierres capturados. No hay prueba.
> Esto fija la regla y la vara para que la muestra que viene no se lea a conveniencia.

## La regla (fija; no se toca hasta cerrar la muestra)

- **Familia:** TOTAL de juegos de tenis (ATP y WTA), en sombra como hasta ahora. Ninguna pick pública.
- **Corte:** ventaja del modelo **≥ 8 pp** sobre la implícita de la mejor cuota **al nacer la pick**
  (`edge_pp_at_create`). La pick lleva `prereg_total8: true` desde el deploy de esta rama; lo anterior no
  cuenta aunque cumpla el corte (fue la muestra que sugirió la regla).
- **Unidad de cuenta: el EVENTO** (`event_id`), no la pick. Varias picks del mismo partido (casas o líneas
  distintas) son UNA tesis: una unidad repartida a partes iguales, acierto por el signo de esa unidad, CLV
  promediado dentro del evento y luego entre eventos. Lo publica `TEN.track()` en `por_evento.TOTAL`.
- **Modelo:** el que corre en producción en el momento de la pick. Desde esta rama, en ATP a tres sets la
  distribución de juegos es C6 (`dist_method: 'c6'`); en WTA y en Grand Slam masculino sigue el
  desplazamiento (`'shift'`). Se anota por pick para poder partir la muestra, pero el preregistro es UNO.
- **Corte temporal:** empieza con el deploy de `impl/tenis`; termina al liquidar **60 eventos** con la
  bandera (VOID no cuenta). Los cierres se capturan para TODAS las líneas (`totals_all`, hasta 12 por
  evento) para que la línea de la pick tenga cierre aunque el consenso se haya movido.

## La vara (qué decide)

- **Decide el CLV medio por evento contra Pinnacle** cuando esté en `totals_all` para la línea de la pick;
  si Pinnacle no cotiza esa línea, contra la mejor cuota de cierre de la misma línea (`close_source`).
  Éxito = **CLV medio > 0** con su error estándar (t ≥ 2 para llamarlo positivo; entre 0 y 2, inconcluso;
  < 0, la regla no vale).
- **El ROI se anota pero NO decide.** Con 60 eventos el error estándar del ROI ronda los 12-15 puntos: no
  distingue nada. Se publica junto al CLV para que se vea, no para que mande.
- **El acierto por evento se anota** como descriptivo; tampoco decide.

## Qué NO se hace mientras corre

- No se cambia el corte (8 pp), ni la familia, ni la unidad de cuenta, ni se añaden filtros a mitad.
- No se aplica el `c = 6` ni ningún blend con el mercado (§6.5: no identificable con picks correlacionadas).
- No se lee la muestra por trozos (ATP/WTA, over/under, c6/shift) para decidir: esos cortes se miran DESPUÉS
  del cierre y se declaran como exploratorios.

## Dónde se ve

- `/api/tennis/track` → `por_evento.TOTAL.preregistradas` (eventos, ROI ± SE, acierto, CLV ± SE, t) y
  `abiertas_prereg`. `todas` y `edge8` (todas las TOTAL liquidadas y las de ≥ 8 pp por `edge_pp` histórico)
  van al lado como contexto, no como muestra del preregistro.
- Al cerrar los 60 eventos: sección nueva en `docs/BACKTESTS_FAMILIAS_2026-09-02.md` (o su sucesor) con el
  resultado, y decisión de Alexis sobre si la familia sale de la sombra, sigue acumulando o se cierra.
