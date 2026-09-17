# El encogimiento al precio, medido — 16-sep-2026 (M1 · Fase B1)

**Qué se preguntaba.** `docs/CALIBRACION_2026-09-16.md` midió que el modelo se pasa entre 6 y 16 puntos
porcentuales donde el precio acierta a 0-4, en nueve de doce motores. M1 ordena encoger la probabilidad
publicada hacia el precio con un peso `c` por familia:

```
p* = σ( logit(p_mercado_sin_margen) + c · [ logit(p_gp) − logit(p_mercado_sin_margen) ] )
```

`c` = cuánto peso merece el modelo POR ENCIMA del precio. `c = 0` → publica el precio. `c = 1` → publica el
modelo. La pregunta de B1 es **cuánto vale `c` en cada familia**.

**Cómo.** `lib/encogimiento.js`, ajustando `c` **hacia adelante** (se ajusta con lo anterior, se puntúa con
lo siguiente, bloque a bloque) por log-loss, sobre el **cierre sin margen** reconstruido con sus dos caras.
Sonda: `/api/internal/encogimiento?key=`. Agrupación: **por familia**, con las casas juntas — `c` mide al
modelo, y el modelo es el mismo apueste donde apueste.

---

## La respuesta: no hay una sola familia con un `c` medible por encima de cero

Once familias tienen muestra suficiente. Ocho dicen directamente que el modelo no aporta. Las otras tres
dicen que sí — **y a las tres el intervalo de `c` les incluye el cero.**

| familia | c | n | fuera de muestra | mejora sobre el precio | IC de c | hueco del precio |
|---|---:|---:|---:|---:|---|---|
| lol · KILLS_DNB | 0,45 | 84 | 63 | +0,032514 | **[0 · 0,95]** | insuficiente (8,7 %) |
| lol · KILLS | 0,40 | 212 | 159 | +0,004635 | **[0 · 1,00]** | ignorable (23,2 %) |
| cs2 · RONDAS | 0,15 | 488 | 366 | +0,000561 | **[0 · 0,65]** | insuficiente (8,4 %) |
| cs2 · RONDAS_HANDICAP | 0 | 657 | 493 | −0,000297 | — | **seleccionado (31,8 %)** |
| lol · KILLS_HANDICAP | 0 | 451 | 339 | −0,000408 | — | **seleccionado (27,4 %)** |
| valorant · RONDAS | 0 | 107 | 81 | −0,007103 | — | insuficiente (5,3 %) |
| dota2 · KILLS | 0 | 99 | 75 | −0,000272 | — | insuficiente (14,7 %) |
| valorant · RONDAS_HANDICAP | 0 | 72 | 48 | −0,011199 | — | **seleccionado (59,8 %)** |
| cs2 · HANDICAP | 0 | 70 | 47 | −0,022916 | — | **seleccionado (46,6 %)** |
| cs2 · RONDAS_EQUIPO | 0 | 61 | 41 | −0,002862 | — | insuficiente (12,9 %) |
| lol · HANDICAP | 0 | 61 | 41 | −0,011057 | — | insuficiente (34,4 %) |

Las otras 24 familias no llegan al mínimo de 60 filas y se publican con `c = 0` diciéndolo.

**Los tres `c` positivos no son un hallazgo, son ruido con formato de número.** `lol · KILLS` tiene un
intervalo que ocupa **toda la rejilla, [0, 1]**, sobre 212 filas. `cs2 · RONDAS` mejora el log-loss en
**0,00056** — cinco diezmilésimas sobre 366 filas fuera de muestra. El único con una mejora de tamaño
respetable, `lol · KILLS_DNB` (+0,0325), tiene 63 filas fuera de muestra repartidas en 28 racimos de evento
y un intervalo de [0 · 0,95].

La sonda los marca con `c_no_distinguible_de_cero` y pone el aviso **delante** del número, porque un 0,45
leído sin su intervalo se opera igual que un 0,45 medido.

---

## Lo que esto significa para el plan, y no estaba previsto

M1 dice: doble corrida de 14 días y después la versión encogida pasa a publicar. La Fase B del plan
anticipa que **«el número de picks va a caer mucho. Eso es la fase funcionando.»**

Con los `c` medidos hoy, no caería mucho: **caería a una sexta parte**. `c = 0` significa publicar la
probabilidad del mercado sin margen, y una pick nace de la diferencia entre nuestra probabilidad y el
precio. Si nuestra probabilidad *es* el precio, esa diferencia es cero por construcción y **en esas
familias no nace ninguna pick**. Sobreviven solo las tres con `c` > 0.

> **Corrección del 17-sep.** Aquí ponía «caería a cero, en ninguna familia». Era falso y el primer corte de
> la doble corrida lo enseña: **871 de 5.271 picks anotadas habrían nacido igual** (16,5 %), las de
> `cs2 · RONDAS`, `lol · KILLS` y `lol · KILLS_DNB`. Un apagado total y una reducción a la sexta parte no
> son la misma decisión, y la de Alexis se toma sobre la segunda.

Eso no es un fallo del encogimiento: es lo que los datos dicen. Pero es una consecuencia de otro tamaño que
«bajan las picks», y la decisión de aceptarla no está tomada en el plan — el plan describe una reducción,
no un apagado. **Queda para Alexis**, con los tres caminos sobre la mesa:

1. **Aplicarlo tal cual.** El sistema deja de publicar picks propias y pasa a ser lo que ya es de facto en
   las familias que ganan: un detector de desviaciones de precio entre casas (valor, arbitraje, caídas,
   middles), que no necesita que el modelo aporte nada.
2. **Aplicarlo con un suelo de `c`** (por ejemplo 0,2) en las familias donde el intervalo al menos toca
   territorio positivo. Es una decisión de producto —seguir publicando— con el coste escrito: se publica
   una probabilidad que la medición no respalda.
3. **Correr los 14 días de doble corrida** y volver a mirar con más muestra. Es lo que el plan ya manda y
   no cuesta nada decidir después, salvo que durante esos 14 días se siguen publicando las probabilidades
   crudas, que es justo lo que M1 declara falso.

La opción 3 es la que se ejecuta salvo orden en contra, porque es la que el plan ya tenía escrita.

---

## Tres hallazgos de datos que salieron por el camino

**1. Cuatro familias tienen el hueco del precio SELECCIONADO.** Falta la cara contraria del cierre en
27-60 % de las filas, y en cuatro familias esa ausencia **no es aleatoria**: la probabilidad del propio
modelo o la tasa de acierto difieren significativamente (Benjamini-Hochberg al 10 %) entre las filas con
precio y sin él. Son `cs2 RONDAS_HANDICAP` (31,8 %), `lol KILLS_HANDICAP` (27,4 %), `valorant
RONDAS_HANDICAP` (59,8 %) y `cs2 HANDICAP` (46,6 %). Su `c = 0` está medido sobre una mitad que no
representa a la familia. El veredicto no cambia —el `c` sale 0 igual— pero la confianza sí.

**2. Tenis no tiene NI UNA sola fila con cierre sin margen: 774 picks liquidadas, 0 utilizables.**
No es un fallo nuevo, y el propio motor ya escribe el motivo fila por fila:

- en `ML`, *«el cierre de ganador se guarda como mejor cuota por lado entre casas: las dos caras no son del
  mismo libro»* — es el problema de la tupla del 15-sep, y así el margen no se puede quitar;
- en `TOTAL` y `SPREAD`, *«la casa de la pick no cotizaba esa línea al cierre»* o *«línea X no cotizada al
  cierre»*.

Lo que no estaba escrito en ningún sitio es la **consecuencia**: con eso, tenis **no se puede encoger, ni
se le puede medir el EV al cierre, ni puede cruzar G2**, hoy ni con más muestra. Mientras el cierre se
guarde como mejor-cuota-entre-casas, ninguna cantidad de picks arregla esto.

**3. Tenis de mesa está al 72-80 % de hueco** en sus cuatro familias (`POINTS_TOTAL` 106 filas → 21
utilizables). No está tan muerto como tenis, pero tampoco tiene con qué decidir.

---

## Y un fallo propio, del mismo tipo que los del día

La primera versión de la sonda llamaba a los tres motores con `track({ limit })`. `tt` y `dardos` lo
aceptan, pero **tenis es `track(tour, { limit })`**: el objeto de opciones entraba como `tour`, no casaba
con ningún partido, y el deporte entero desaparecía de la tabla **sin excepción, sin fila y sin aviso**.
Es exactamente el fallo que hoy dejó muertos los dos surtidores de resultados de clubes y la sombra de
props, cometido aquí mismo mientras se documentaba. Corregido: cada llamada lleva su firma, cada motor
declara cuántas filas trajo, y una familia por debajo del mínimo se publica con su recuento en vez de
desaparecer.

---

## Primer corte de la doble corrida — 17-sep-2026, día 0,69 de 14

**No es el veredicto.** El veredicto es el día 14 (≈ 30-sep) y esto son dieciséis horas. Se anota porque la
dirección ya es limpia y porque conviene tenerla fechada antes de saber cómo acaba: si el día 14 dice lo
mismo, esta anotación demuestra que no se eligió el corte que gustaba.

| | log-loss (ponderado, n = 2.726 liquidadas) |
|---|---:|
| **crudo** — lo que el feed publica hoy | **0,724627** |
| **encogido** — la versión alternativa | **0,673826** |
| **precio** — la casa, sin margen | 0,675351 |

**La encogida gana en 25 de 31 familias, y en 11 de 11 de las que tienen n ≥ 50.** Las seis donde gana la
cruda tienen n de 38, 13, 11, 10, 4 y 1. Once de once en el mismo sentido, por signo puro, es p ≈ 0,0005.

**Pero hay que leerlo con cuidado, porque dos cosas distintas se esconden en ese 25 de 31.** En las 26
familias con `c = 0` la encogida **es** el precio, cifra por cifra (se ve en la tabla: `logloss_encogido` y
`logloss_precio` son idénticos). Ahí «gana la encogida» no dice nada nuevo: dice otra vez que el precio le
gana al modelo, que es lo que la autopsia del 2-sep ya sabía. Lo único que añade es que ahora está medido
**prospectivamente**, sobre picks nacidas después del congelado, que es la forma fuerte de medirlo.

**Lo nuevo de verdad son las tres familias con `c` > 0**, porque son las únicas donde la mezcla de modelo y
precio le gana **al precio solo**:

| familia | n | c congelado | la encogida bate al precio por |
|---|---:|---:|---:|
| lol · KILLS_DNB | 84 | 0,45 | **+0,031732** |
| lol · KILLS | 212 | 0,40 | +0,004996 |
| cs2 · RONDAS | 496 | 0,20 | +0,000873 |

Las tres en el mismo sentido. Pero el tamaño manda: 0,00087 sobre 496 filas es indistinguible de nada, y
`KILLS_DNB`, el único con una mejora respetable, tiene 84 filas. **Sigue sin haber aquí un número que
autorice a mover dinero**, y la regla del 13-sep no se toca.

### Qué mirar el día 14

1. Si las tres familias con `c` > 0 **mantienen** el signo con el doble de muestra, hay por primera vez un
   sitio donde el modelo aporta algo por encima del precio. Sería la primera vez este año.
2. Si el resto sigue con la encogida pegada al precio, la opción 1 de arriba (dejar de publicar picks
   propias en esas familias y quedarse con las desviaciones entre casas) pasa de ser una opción a ser la
   lectura literal de los datos.
3. **871 picks de 5.271** es lo que sobreviviría al cambio. No es cero. Ése es el tamaño real de la
   decisión.
