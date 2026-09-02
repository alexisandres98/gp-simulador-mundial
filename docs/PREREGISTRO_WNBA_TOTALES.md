# Preregistro — totales de baloncesto (WNBA/NBA) con el histograma corregido

**Fecha de registro:** 2 de septiembre de 2026. **Corte:** picks del monitor creadas a partir del deploy del
commit `5b659ac` (histograma de totales a resolución de 1 punto), es decir `created_at ≥ 2026-09-02T10:40Z`.
Las 31 picks de TOTAL anteriores al corte están contaminadas por el bug de los cubos de 5 y **no cuentan**.

## Qué se declara antes de ver un solo resultado

- **Familia:** TOTAL (over/under) de WNBA y, cuando arranque, NBA. SPREAD y MONEYLINE siguen en monitor, pero
  este preregistro no los juzga.
- **Regla:** la del monitor tal cual está hoy — `model_prob` = blend en log-odds con el cierre (w = 0,233
  WNBA / 0,134 NBA), `edge_pp ≥ 3`, cuota entre 1,35 y 4,5, máximo 2 picks por partido, compuertas de
  `gates.js` (edge ≥ 1,3 × incertidumbre). No se cambia ningún umbral durante la muestra.
- **Muestra:** las primeras **60 picks liquidadas** de TOTAL tras el corte (WNBA y NBA juntas; si la WNBA cierra
  la temporada antes, se completa con NBA y se dice). La WNBA no juega hasta el **17 de septiembre**
  (comprobado en ESPN el 2-sep): la muestra empieza a contar ese día, no hay picks nuevas que leer antes.
- **Vara principal:** CLV medio contra el cierre del consenso (el que ya calcula `hoopsPicksCloseline`), con
  su error estándar. **Criterio de éxito:** CLV medio > 0 y ≥ 40 % de picks con CLV positivo. **Criterio de
  fracaso:** CLV medio < −1 % con t < −1,5.
- **Vara secundaria:** ROI a la mejor cuota y ROI al precio de cierre (para saber si el edge sobrevive a
  llegar tarde). El ROI con n=60 tiene un error estándar de ~13 puntos: **no decide nada**, se anota.
- **Chequeo de la causa raíz:** la distribución de las líneas apostadas por resto módulo 5 (`line % 5`). Si
  vuelve a concentrarse en x3,5/x4/x4,5 hacia el over, el arreglo no llegó al camino de la pick y hay que
  parar y mirar antes de seguir contando.
- **Qué NO se hace durante la muestra:** ni tocar w, ni el umbral, ni el histograma, ni añadir capas. Si
  aparece un bug de medición, se documenta y se reinicia el contador.

## Enmienda del 2 de septiembre (antes del corte del 17-sep, sin picks nuevas en medio)

Los backtests del 2-sep (§5.3 de `BACKTESTS_FAMILIAS_2026-09-02.md`) encontraron dos defectos de MEDICIÓN,
no de criterio. Como la WNBA no juega hasta el 17-sep, se corrigen ahora y entran en la regla congelada
**antes** de que exista una sola pick de la muestra; ningún umbral de emisión cambia (w, `edge_pp`, cuotas,
`gates.js` siguen tal cual).

1. **Una pick por tesis.** La tesis es partido + familia + lado (`thesis = fam|side|game_id`). Si ya existe una
   pick con esa tesis —viva o liquidada— no nace otra con la línea corrida: la re-cotización se anota en la
   existente (`requotes[]`, máximo 20) y el constructor cuenta `saltadas_por_tesis`. Antes, 79 picks de
   hándicap eran 15 tesis: la muestra de 60 picks de TOTAL serán **60 tesis**, no 60 decimales de las mismas.
2. **CLV justa contra justa.** La vara principal pasa a ser `clv_pct = (prob. justa del consenso al cierre /
   prob. justa del consenso al nacer − 1) × 100`, ambas con el mismo método (mediana de implícitas por lado +
   Shin). La fórmula anterior —mejor cuota CON margen contra cierre SIN margen, que arrancaba en ≈ −3,2 %
   aunque nada se moviera— se conserva como `clv_price_pct` y **no decide**. Los criterios de éxito y fracaso
   de arriba se leen sobre el nuevo `clv_pct`; el "−4,6 en hándicap" de la sección siguiente era el número
   viejo (−3,16 de margen + −1,46 de movimiento real). Cada pick guarda además `line_at_create`,
   `consensus_line_at_create`, `close_line` y `line_moved_pts` (positivo = el cierre nos dio la razón).

**Aviso sobre los overs.** El régimen `GP_HOOPS_V2` (gates de la autopsia del 31-ago) deja pasar solo unders
en TOTAL, así que esta muestra **no valida los overs**, que es justo donde vivía el sesgo del histograma. Si
se quiere validar el arreglo completo hay que permitir overs en el monitor, y eso es un cambio de regla que
se decide antes del 17-sep o se deja para la muestra siguiente — no a mitad. Nota de código, para quien lo
revise: el filtro de overs compara `m.fam === 'total'` mientras la familia se llama `match_total`, así que
hay que comprobar en la primera semana de la muestra si de verdad no aparecen overs (`selection_code ===
'over'` con `regime: 'hoops_v2'`); si aparecen, se documenta como parte de la regla vigente y la lectura se
hace por lado.

## Por qué 60 y por qué CLV

Con 60 picks el CLV medio tiene un error estándar de ~1,2 puntos (sd ≈ 9 en el monitor actual): alcanza para
distinguir "el mercado se mueve en contra" (−4,6 hoy en hándicap) de "no se mueve". El ROI necesita cientos.

## Cómo leerlo el lunes

```
GET /api/hoops/picks?league=wnba   → settled[] con family=TOTAL y created_at ≥ corte
GET /api/hoops/perf?league=wnba    → clv_live, monitor.by_family
```
Contar solo las liquidadas tras el corte. Resultado y decisión se anotan al pie de este archivo.

## Resultado

_(pendiente: se rellena al llegar a 60)_
