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
