# La media que calibramos no es la media que observamos

**16-sep-2026 · A26 y A27 del backlog de la auditoría externa**

Correr: `node scripts/darts-censura.js [--legs 4000]` · `node scripts/darts-dp-sensibilidad.js`

---

## Las dos tareas, y la sorpresa

A26 y A27 señalaban tres aproximaciones en el motor de dardos. Se han medido las tres. Dos son ruido y la
tercera es, con diferencia, el problema más grande del motor.

| aproximación | tarea | coste medido |
|---|---|---|
| el DP aproxima el bust volviendo al resto actual | A26 | **0,026 puntos** de media de tres dardos |
| la caché redondea `pT` a 0,1 y `pD` a 0,05 | A26 | **0,017 puntos** |
| **el objetivo de calibración ignora la censura del leg** | **A27** | **hasta 9,95 puntos** |

Para poner los números en contexto: el error de calibración de la propia base ronda **el punto**. Las dos de
A26 son dos órdenes de magnitud por debajo de eso; la de A27 es un orden de magnitud por encima.

---

## A26: las dos del DP son ruido, y se quedan apagadas

**El estado del bust.** El kernel de visita devuelve un bust exactamente al marcador con el que empezó la
visita (`r0`). La política, cuyo estado es `(r, d)`, no conoce `r0` y lo aproxima con `r` — el marcador
antes de ese dardo. Coinciden solo si el bust cae en el primer dardo; en el segundo o el tercero la DP cree
que fallar devuelve a donde está ahora, ya habiendo puntuado, así que **subestima el coste de fallar** y
elige objetivos más agresivos de lo que debería.

Se ha implementado la política exacta (`policyExacta`, estado `(r0, r, d)`, ~87k entradas) y la diferencia
en cinco perfiles del circuito es **como mucho 0,026 puntos**.

**El redondeo de la caché.** `pT` entra en pasos de 0,1 y `pD` de 0,05, así que la política servida es la
del jugador *redondeado*. Con la rejilla fina (`pT` ×40, `pD` ×100) la diferencia es **0,017 puntos**.

Las dos quedan detrás de un interruptor apagado (`GP_DARTS_DP_EXACTO`, `GP_DARTS_DP_FINO`). Encenderlas
cambiaría la política, la distribución de visitas y el precio de cada familia **para ganar centésimas**, y
además la exacta multiplica por ~170 el coste de calcular la política. No compensa.

---

## A27: el objetivo de calibración está midiendo otra cosa

### El desajuste

`calibrate()` busca el `pT` que hace que **`soloLeg()`** reproduzca la media observada. `soloLeg()` simula
un jugador **solo ante el 501**: siempre llega a cero, siempre tira el checkout.

Las medias que observamos —Darts Orakel, la PDC— se calculan sobre **partidos**, donde la mitad de los legs
se pierden. El que pierde **deja de tirar cuando el rival cierra**, y nunca tira ese checkout.

### Lo medido

2.500 legs por perfil contra un rival de 94 de media, con generador sembrado.

| perfil | media pedida | `soloLeg` | media censurada (lo que mediría la fuente) | sesgo | legs ganados |
|---|---:|---:|---:|---:|---:|
| clasificatorio | 82 | 82,02 | **91,98** | **+9,95** | 40,5 % |
| tour bajo | 88 | 88,02 | **95,03** | **+7,01** | 46,0 % |
| tour medio | 94 | 93,99 | **97,88** | **+3,89** | 50,9 % |
| top 32 | 99 | 99,00 | 100,34 | +1,34 | 54,0 % |
| top 4 | 104 | 103,97 | 102,78 | −1,19 | 57,6 % |

**El sesgo es monótono en la fuerza del jugador y cambia de signo arriba.**

### Por qué, y por qué importa tanto abajo

Un jugador flojo pierde el 60 % de sus legs. En un leg perdido **nunca llega a la fase de dobles** — que es
justo donde un jugador flojo es peor: falla dobles una y otra vez, tirando visitas de tres dardos que
puntúan cero. La censura le **quita exactamente la peor parte de su leg**, así que su media observada sale
inflada casi diez puntos.

Un top-4, al revés: gana el 58 % de los legs, así que tira el checkout más veces que la media. Y su
checkout es eficiente (cierra con uno o dos dardos, y la media es puntos/dardos×3), lo que le **sube** la
media del leg ganado. Al censurar pierde parte de esa ventaja y su media observada baja algo.

### La consecuencia operativa

Cuando `calibrate({ avg: 82 })` busca el `pT` que da 82 en un leg solo, está encontrando el `pT` de un
jugador cuya media **observada** sería 92. O sea: **los jugadores flojos se están calibrando como mucho más
fuertes de lo que son**, y el error crece cuanto más flojo es el jugador.

En un circuito donde los partidos de primera ronda enfrentan a un top-32 con un clasificatorio, eso
desplaza la probabilidad del favorito en la dirección equivocada y de forma sistemática. Y es un sesgo con
signo fijo, que es el peor tipo: no se promedia a cero con la muestra.

---

## Qué queda para Alexis

1. **Cambiar el objetivo de `calibrate()` a la media censurada**, simulando el partido contra un rival de
   referencia en vez del leg solo. Es el arreglo correcto y el script ya tiene la pieza que lo mide
   (`mediaObservada`). Cambia el `pT` de **todos** los jugadores, así que cambia el precio de todas las
   familias de dardos: es un cambio de modelo con su preregistro y su validación hacia adelante.
2. **Mientras tanto, leer el rendimiento de dardos con este sesgo delante.** Todas las familias están en
   sombra, así que no hay dinero en juego, pero el track de dardos que se acumula desde el 6-sep está
   generado con jugadores flojos sobrevalorados.
3. **Dejar las dos de A26 apagadas**, ahora con el 0,026 y el 0,017 detrás en vez de por defecto.

Ninguna se ha aplicado.
