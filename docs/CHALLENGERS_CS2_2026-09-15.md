# CS2: el aspirante S1, la comparación y el contrato de Underdog — resultados

> **T2.7, T2.8 y T2.9 del plan de trabajo de la auditoría externa.** Ejecutado el 15-sep-2026.
> Reproducible: `node tests/cs2-s1.test.js` · `node tests/props-contrato.test.js` ·
> `node scripts/cs2-challengers.js --libro <libro de la sombra>`.
> Registro de los experimentos: `docs/REGISTRO_EXPERIMENTOS.md` (E-010 a E-014).
> Contrato de la casa: `docs/CONTRATOS_CASA.md` § Underdog.

## La pregunta

`cs2_rounds_v1` es la familia de esports con más muestra de la casa: 1.128 picks de hándicap de rondas en el
motor, 541 espejadas en la sombra, y el único CLV positivo y significativo que quedaba en pie tras la
auditoría (+1,04 % con t 8,19 en Pinnacle). La vara nueva ya le había quitado el título —su EV al cierre es
−3,28 %— pero quedaba sin contestar la pregunta de fondo, que es la misma que en tarjetas: **¿el modelo que
genera esas picks es mejor que las alternativas obvias, o solo es el primero que escribimos?**

Y había una sospecha concreta, señalada por la auditoría (A16) y no medida: que la probabilidad de ronda, la
de mapa y la de serie se mezclan sin tipar dentro de `esports-engine/cs2.js`.

## Parte 1 — el fallo, medido (E-010)

`cs2.js` convierte la probabilidad de MAPA en probabilidad de RONDA con una constante:

```js
// la probabilidad de RONDA no es la de mapa: un 60 % de mapa es ~53 % de ronda. Se comprime hacia el centro.
const clampRound = (pMap) => C.clamp(0.5 + (pMap - 0.5) * 0.42, 0.32, 0.68);
```

La intuición es correcta y **el número no**. Si se mete el resultado de esa fórmula en la propia simulación
de rondas del motor y se pregunta con qué frecuencia gana el mapa, no sale el `p_map` del que se partió:

| p_map que el motor cree | p_round que usa | p_map que su simulación de verdad juega | error |
|---:|---:|---:|---:|
| 0,30 | 0,4160 | 0,1814 | **−11,86 pp** |
| 0,40 | 0,4580 | 0,3252 | −7,48 pp |
| 0,45 | 0,4790 | 0,4104 | −3,96 pp |
| 0,50 | 0,5000 | 0,5000 | 0,00 pp |
| 0,55 | 0,5210 | 0,5896 | +3,96 pp |
| 0,60 | 0,5420 | 0,6748 | **+7,48 pp** |
| 0,65 | 0,5630 | 0,7521 | +10,21 pp |
| 0,70 | 0,5840 | 0,8186 | +11,86 pp |
| 0,75 | 0,6050 | 0,8730 | **+12,30 pp** |

La p_round que SÍ reproduce cada p_map (bisección exacta, `esports-engine/cs2-s1.js`) es mucho más plana:
0,5235 para el 0,60 y no 0,5420; 0,5624 para el 0,75 y no 0,6050. **La pendiente correcta cerca del centro
es ~0,23, no 0,42.**

Esto no es un matiz de tercer decimal. El motor ancla la serie al mercado con un cuidado que ocupa media
pantalla de comentarios —hay un fallo anterior del mismo tipo documentado allí, el de los mapas sin
anclar— y acto seguido mete en la simulación de rondas a un favorito entre 4 y 12 puntos más fuerte del que
el mercado acaba de cotizar. Todo lo que se lee de esa distribución (hándicap de rondas, rondas por equipo,
total de rondas, prórroga) sale del partido equivocado.

**Y `clampRound` se aplica dos veces.** Una dentro de `shiftBy()`, donde lo que se está desplazando son
probabilidades de MAPA y la función de conversión a rondas no pinta nada; y otra al entrar a `mapRounds()`.
Es la «doble compresión» del informe de la auditoría, y ahora tiene un número.

### Qué es S1

`esports-engine/cs2-s1.js`, módulo nuevo. **No toca `cs2.js`**, que está congelado y genera picks con dinero
histórico detrás. Las cinco piezas que pedía el plan:

1. **Tipado.** `p_round`, `p_map` y `p_series` viajan etiquetados. Pasar uno donde se espera otro lanza.
2. **Bisección.** `pRoundDesdePMap()` resuelve la conversión contra la propia simulación, con residuo < 1e-7.
3. **Serie compilada.** Enumeración exacta de los caminos del mejor de N con los `p_map` resultantes, y la
   inversa `pMapsDesdePSeries()` que pone el nivel del ancla sin pasar por `clampRound`.
4. **Momentum apagado** por defecto. El +0,06 de `core.js` está etiquetado «experimental» en la propia ficha
   del modelo; un aspirante no hereda un parámetro sin medir.
5. **Veto como distribución.** `cs2.js` construye el veto quedándose en cada paso con el mapa más probable:
   una rama de 5.040. Medido sobre un pool realista, **la rama más probable se lleva el 0,35 % de la masa** y
   se publica como si fuera el veto. S1 enumera las 5.040 con su probabilidad, y cuando el veto ya se ha
   publicado condiciona al prefijo de forma exacta (dos bans conocidos ⇒ 120 ramas, renormalizadas).

**Distribución exacta, no Monte Carlo.** El modelo de ronda es una cadena de Markov de 980 estados, así que
la distribución del mapa se calcula por programación dinámica en milisegundos. Eso quita el ruido de ±0,3 pp
que tenía la simulación y permite que la bisección converja de verdad. Comprobado que reproduce el Monte
Carlo del motor congelado dentro del error de muestreo (`tests/cs2-s1.test.js` §9): media de rondas a 0,02 y
tasa de prórroga a 0,002. **La mecánica de ronda es la misma**; lo único que cambia es la conversión.

**Aceptación (T2.7), con tolerancia 0,002:** el círculo cierra. `tests/cs2-s1.test.js` comprueba
ronda→mapa→ronda, mapa→ronda→mapa y serie→mapas→rondas→mapas→serie en cuatro niveles de anclaje; el residuo
peor es 1,2e-7. Además: la PMF suma 1 a 1e-9, no hay marcadores imposibles, las 5.040 ramas del veto suman
1, y un mapa baneado tiene probabilidad exactamente 0 de jugarse.

## Parte 2 — la comparación (E3 / T2.8)

### El montaje

**Universo.** Las 376 apuestas de `RONDAS_HANDICAP` del libro de la sombra que están liquidadas en WIN o
LOSS, con cuota y con probabilidad del modelo: **239 en Pinnacle (106 series) y 137 en Cloudbet (63
series)**. Cuota media 2,44 (mín. 1,49, máx. 6,00): son hándicaps largos, no líneas de casi-moneda.

**Cómo se comparan tres modelos sobre las mismas apuestas.** El libro guarda la probabilidad que el motor
publicó, no sus entradas. Pero el camino del motor es determinista e invertible
(`p_map → clampRound → p_round → simulación → P(hándicap)`), así que de la probabilidad publicada, la línea
y el lado se recupera por bisección el `p_round` que usó, y de ahí el `p_map` que le habían dado. Ese
`p_map` es **el mismo para los tres aspirantes**: es lo que garantiza que se comparan tres lecturas del
mismo partido. Se reconstruyeron las 376 filas con un residuo máximo de 4e-4, que es la propia resolución
con la que el libro guarda la probabilidad.

**Los cuatro aspirantes.**

| id | qué es |
|----|--------|
| **T0** | el motor congelado, tal cual salió en producción. Su probabilidad es la que quedó escrita en la apuesta: no se recalcula y no se puede falsear |
| **S1** | el challenger: mismo `p_map`, misma mecánica de ronda, mismo arrastre, conversión resuelta por bisección |
| **MON** | la moneda literal, `p = 0,5` en toda apuesta. Su log-score es exactamente ln 2 = 0,69315 |
| **MAP50** | el mapa es una moneda (`p_map = 0,5`) y la distribución de rondas sale de ahí. Sabe la estructura del juego y nada de los equipos |

**Puntuación.** Log-score y Brier pareados contra el resultado real, con bootstrap por **racimos de serie**
(`lib/inferencia.js`): los dos mapas de una serie los juega el mismo equipo el mismo día. En el libro hay
115 racimos serie+lado con más de una apuesta y el mayor tiene 7 filas en una sola serie, así que la
diferencia entre contar tickets y contar series no es teórica. Sobre las **doce comparaciones declaradas de
antemano** (tres aspirantes × dos métricas × dos casas) se aplica Benjamini-Hochberg al 10 %.

**Economía.** `EV_cierre` por contrato con `lib/ev.js`. El archivo de cierres no expone la cara contraria
fuera de Render, así que se usa `evDesdeMargen` con la **Q medida** de cada casa (`lib/margen.js`: Pinnacle
2,21 % por lado, Cloudbet 3,13 %). Es la fórmula correcta con una Q aproximada, no una resta de magnitudes
distintas; la aproximación está declarada.

### Resultado

#### Pinnacle · 239 apuestas · 106 series · acierto real 49,4 %

| aspirante | p media | log-score | Brier |
|---|---:|---:|---:|
| T0 *(actual)* | 0,5335 | **0,70769** | 0,25663 |
| S1 | 0,4326 | 0,70581 | 0,25582 |
| **MON (moneda)** | 0,5000 | **0,69315** | **0,25000** |
| MAP50 | 0,3063 | 0,78114 | 0,28755 |

| comparación | Δ | IC 95 % | t | p |
|---|---:|---|---:|---:|
| log-score S1−T0 | −0,00187 | [−0,0375; +0,0339] | −0,10 | 0,919 |
| log-score MON−T0 | −0,01454 | [−0,0445; +0,0153] | −0,94 | 0,351 |
| log-score MAP50−T0 | +0,07345 | [−0,0102; +0,1585] | +1,68 | 0,095 |
| Brier S1−T0 | −0,00082 | [−0,0180; +0,0166] | −0,09 | 0,927 |
| Brier MON−T0 | −0,00664 | [−0,0211; +0,0078] | −0,89 | 0,376 |
| Brier MAP50−T0 | +0,03092 | [−0,0068; +0,0689] | +1,58 | 0,117 |

#### Cloudbet · 137 apuestas · 63 series · acierto real 38,7 %

| aspirante | p media | log-score | Brier |
|---|---:|---:|---:|
| T0 *(actual)* | 0,5487 | 0,70096 | 0,25356 |
| **S1** | 0,4444 | **0,64689** | **0,22738** |
| MON (moneda) | 0,5000 | 0,69315 | 0,25000 |
| MAP50 | 0,3021 | 0,69177 | 0,24215 |

| comparación | Δ | IC 95 % | t | p |
|---|---:|---|---:|---:|
| log-score S1−T0 | −0,05407 | [−0,1169; +0,0140] | −1,62 | 0,110 |
| log-score MON−T0 | −0,00782 | [−0,0611; +0,0480] | −0,28 | 0,784 |
| log-score MAP50−T0 | −0,00919 | [−0,1913; +0,2197] | −0,09 | 0,931 |
| Brier S1−T0 | −0,02618 | [−0,0560; +0,0066] | −1,64 | 0,106 |
| Brier MON−T0 | −0,00356 | [−0,0288; +0,0231] | −0,26 | 0,793 |
| Brier MAP50−T0 | −0,01141 | [−0,0891; +0,0826] | −0,26 | 0,798 |

#### Benjamini-Hochberg al 10 % sobre las doce: **umbral 0. No sobrevive ninguna.**

El p más pequeño de los doce es 0,0953 y el primer escalón de BH exige 0,00833. **Ninguna comparación es
declarable, ni a favor ni en contra.** Eso se escribe tal cual: con 106 y 63 series no hay poder para
distinguir estos modelos entre sí.

### Las tres cosas que esto sí contesta

#### 1. El motor actual no le gana a una moneda sobre sus propias apuestas (E-012)

T0 puntúa **0,70769 en Pinnacle y 0,70096 en Cloudbet**, y los dos son PEORES que ln 2 = 0,69315, que es lo
que saca un modelo que no sabe nada. No es significativo (p 0,35 y 0,78) y por tanto no se puede declarar
que sea peor; **lo que no se puede declarar de ninguna manera es que sea mejor**. Sobre las apuestas que el
propio modelo eligió —que son aquellas en las que más confianza tenía— no hay evidencia de que su
probabilidad informe de nada.

S1 tampoco le gana a la moneda en Pinnacle (0,70581) y sí le gana en Cloudbet (0,64689). Y MAP50 —que solo
sabe cómo se reparten las rondas de un mapa parejo— pierde con claridad en Pinnacle (0,78114) y empata en
Cloudbet. Lectura: **la estructura de rondas sin saber quién juega no vale; y saber quién juega, con el
motor que tenemos, tampoco ha demostrado valer.**

#### 2. El sesgo del fallo va SIEMPRE a favor del lado apostado (E-011)

Es el número más sólido del expediente porque no depende de ningún contraste. Sobre las 376 apuestas:

| medida | valor | IC 95 % (racimos de serie) |
|---|---:|---|
| desviación del `p_map` que T0 jugaba frente al que decía creer | **+2,53 pp** | [+0,84; +4,13] |
| efecto de la corrección sobre la probabilidad publicada (S1 − T0) | **−10,21 pp** | [−10,93; −9,48] |

La desviación del `p_map` se reparte entre favoritos (positiva) y no favoritos (negativa) y por eso su media
es pequeña; su magnitud no lo es: **|desvío| > 3 pp en 359 de las 376 apuestas**, y el rango va de −12,3 a
+12,3 pp. Pero el efecto sobre la probabilidad publicada **no se reparte**: corregir el fallo baja la
probabilidad del lado apostado en **371 de 376 filas**. En un hándicap, la doble compresión hace más extremo
al favorito y menos extremo al no favorito, y en los dos casos eso favorece justo el lado que el motor
estaba eligiendo. Un fallo que se equivoca a favor del apostante en el 99 % de sus apuestas no es ruido.

**Comprobado que no depende del arrastre económico**, que es el único parámetro que la reconstrucción no
puede recuperar de cada apuesta (el motor lo calibra por mapa y el libro no guarda qué mapa se jugó):

| arrastre | desviación del `p_map` | efecto S1−T0 | log-score S1 (Cloudbet) |
|---|---:|---:|---:|
| 0,00 | +2,42 pp | −11,77 pp | 0,64162 |
| 0,03 | +2,47 pp | −10,85 pp | 0,64357 |
| **0,055 (por defecto)** | **+2,53 pp** | **−10,21 pp** | **0,64689** |
| 0,08 | +2,57 pp | −9,62 pp | 0,65031 |
| 0,12 | +2,58 pp | −8,71 pp | 0,65482 |

(La columna de log-score de Cloudbet se calcula sobre 129, 135, 137, 137 y 137 filas respectivamente: con
arrastres bajos, unas pocas probabilidades publicadas caen fuera de lo que la simulación puede producir en su
línea y esas filas se descartan contadas, nunca se rellenan. Pinnacle reconstruye las 239 con todos.)

#### 3. La economía es negativa en las dos casas, y no la salva ningún aspirante

| casa | EV_cierre del libro | IC 95 % | t | n |
|---|---:|---|---:|---:|
| Pinnacle | **−3,52 %** | [−4,52; −2,62] | −7,21 | 239 |
| Cloudbet | **−4,46 %** | [−6,56; −2,23] | −4,07 | 137 |

Coincide en orden de magnitud con lo ya publicado en `docs/METRICAS_RECALCULADAS_2026-09.md` sobre el libro
completo del motor (−3,28 % en Pinnacle, −1,36 % en Cloudbet); la diferencia es de universo, porque la
sombra espeja un subconjunto.

Con un listón común de 3 pp de ventaja, el subconjunto que cada aspirante conservaría:

| casa | aspirante | apuestas conservadas | EV_cierre | ROI realizado (stake plano) |
|---|---|---:|---:|---|
| Pinnacle | T0 | 239 de 239 | −3,52 % | +18,42 % [−1,05; +38,57] |
| Pinnacle | S1 | **53** | −3,14 % | +25,75 % [−17,95; +72,76] |
| Pinnacle | MAP50 | 4 | −2,38 % | −100 % |
| Cloudbet | T0 | 137 de 137 | −4,46 % | −11,36 % [−40,08; +19,56] |
| Cloudbet | S1 | **29** | −6,20 % | +0,11 % [−65,61; +66,29] |
| Cloudbet | MAP50 | 9 | −7,87 % | −36,56 % |

**S1 se carga entre el 78 % y el 79 % de las apuestas.** Y esa es la respuesta a la pregunta que el plan
dejaba escrita por adelantado —«si S1 elimina el ROI antiguo, se acepta y se escribe»—: no lo elimina, lo
deja sin decidir. El ROI del subconjunto que S1 conserva no se distingue del de T0 en ninguna de las dos
casas; sus intervalos miden 90 y 130 puntos de ancho. Lo único que queda medido es que **para conservar el
ROI de Pinnacle hay que quedarse con las 239, y 186 de esas 239 solo existen por el sesgo.**

## Lo que este trabajo NO dice

**No dice que S1 sea mejor.** Ninguna de las doce comparaciones sobrevive a BH, y la potencia lo explica
sin misterio: con la dispersión observada haría falta **189 series en Cloudbet** para detectar la diferencia
de log-score que se ve (hay 63; potencia actual **37 %**), y en Pinnacle el efecto es tan pequeño que harían
falta **79.622 series** (hay 106; potencia 5 %, que es decir «ninguna»). Declarar ganador aquí sería
exactamente el error que el registro de experimentos existe para impedir.

**No dice qué habría apostado S1 que T0 no apostó.** El universo son las apuestas que el motor congelado
decidió hacer: el archivo de cierres con el menú completo de líneas vive en el disco persistente de Render y
no sale por ninguna ruta de exportación. **S1 solo puede quitar, nunca añadir.** La comparación es honesta
en un sentido (S1 no puede inventarse aciertos) y está sesgada en el otro (no puede lucirse con lo que T0 se
perdió). Para cerrarlo hace falta exportar `closes-cs2.json`, y eso es una ruta nueva, no un análisis.

**No mide el veto contra nada.** La distribución sobre las 5.040 ramas es estructuralmente correcta y
está sin validar: no hay histórico de vetos reales accesible, así que el coeficiente 6 sigue siendo una
forma supuesta. Lo único demostrado es que la rama codiciosa se lleva menos del 1 % de la masa, o sea que
publicarla como «el veto» es una afirmación mucho más fuerte que la que los datos soportan.

**Y hay un 23 % de anulaciones que nadie ha explicado.** De las 500 apuestas de hándicap de rondas
liquidadas en el libro de la sombra, **115 acabaron en VOID** (57 en Pinnacle, 58 en Cloudbet). Quedan fuera
de toda la comparación por construcción —no tienen resultado que puntuar— pero una familia que anula una de
cada cuatro apuestas tiene un problema de contrato o de liquidación que este trabajo no ha mirado.

---

# Parte 3 — el contrato de Underdog (A18 / T2.9)

La ficha completa, con URLs, fechas, citas y lo que falta, está en `docs/CONTRATOS_CASA.md` § Underdog.
Aquí va lo que cambia una decisión.

## El hallazgo: el precio que medíamos no se puede comprar

`esports-engine/props.js` calculaba el listón de cada pierna como `1 / price_dec`, con el `american_price`
que publica la API (−112 ⇒ **52,83 %**). Eso solo sería correcto si existiera la pierna suelta a ese precio.
**No existe**: Underdog es un pick'em y la entrada mínima son dos piernas con un multiplicador de boleto.

El listón real de una entrada Standard de N piernas con multiplicador M es `p* = (1/M)^(1/N)`:

| piernas | multiplicador | listón por pierna | frente al 52,83 % |
|---:|---:|---:|---:|
| 2 | 3× | **57,74 %** | +4,91 pp |
| 2 | 3,5× | **53,45 %** | +0,62 pp |
| 3 | 6× | 55,03 % | +2,20 pp |
| 4 | 10× | 56,23 % | +3,40 pp |
| 5 | 20× | 54,93 % | +2,10 pp |

Con la tasa de acierto que la sombra lleva medida —`props_cs2_v2`: 178 de 330, **53,94 %**— el boleto:

| ticket | EV |
|---|---:|
| 2 piernas a 3× | **−12,71 %** |
| 2 piernas a 3,5× | **+1,83 %** |
| 3 piernas a 6× | −5,84 % |
| 4 piernas a 10× | −15,35 % |
| 5 piernas a 20× | −8,68 % |

Se reproduce exactamente el contraejemplo de la auditoría (2 piernas a 3× con p = 0,539 → −12,844 %), y está
fijado en `tests/props-contrato.test.js`.

## Lo que NO se ha podido verificar, y por qué importa tanto

**El multiplicador de dos piernas decide el signo del negocio y no lo hemos podido comprobar.** Una fuente
secundaria dice 3× y otra 3,5×; con la primera ningún boleto tiene esperanza positiva y con la segunda hay
uno que la tiene por 1,8 puntos. La fuente primaria no se pudo consultar:

- `underdogfantasy.com/rules` → 301 → `underdogsports.com/rules` → 301 → `app.underdogsports.com/rules`: **403**.
- `help.underdogsports.com` (artículos de payouts y de anulaciones): **403**.
- `api.underdogfantasy.com/beta/v5/over_under_lines`: **426 `upgrade_required`**, con y sin cabeceras de
  versión de cliente, y lo mismo en `beta/v3`, `beta/v4` y `beta/v6`.

Así que el veredicto escrito es: **el EV de la familia de props es NO MEDIBLE**, no «positivo». El `+2,2 %`
por pierna que publica la sombra no es el retorno de nada comprable. Y ni siquiera ese +2,2 % aguanta el
intervalo: con 330 tesis a cuota equivalente 1,893, el IC del ROI va de **−8,01 % a +12,35 %**.

Un detalle que conviene no pasar por alto: el **+1,83 %** de la tabla B sale de la submuestra `v2`. Con las
**472** tesis liquidadas completas (acierto 52,97 %), **hasta la tabla más favorable da −1,81 %**, y las
otras cuatro combinaciones van de −10,85 % a −21,30 %.

## Dos reglas del contrato que sí están claras y que nos afectan

> *«Entries that are reverted down to include only players on one team or just a single player will be void
> and refunded.»*

Una entrada que se quede con jugadores de un solo equipo **se anula**. La proyección de GP tiende justamente
a producir eso: cuando mide al cinco rival por encima, las piernas con ventaja salen todas del mismo lado.

> *«A player must play in all games/maps stated in their projection to be considered active.»*

Y una pierna anulada no devuelve la entrada: la **degrada** al número de piernas inmediato inferior con su
multiplicador, que es peor.

## El hallazgo lateral: el feed lleva caído (E-014)

`/api/internal/esports?props=1` en producción, el 15-sep: `board.available = false`, `n = 0`, **0 tesis
activas**. El endpoint de Underdog devuelve 426. La familia no está naciendo y **no lo decía ningún sitio**:
el track seguía publicando sus 472 liquidadas como si la sombra siguiera corriendo.

## Lo que se ha cambiado en el código

**`esports-engine/props.js`:**

- El EV del **ticket** (`evTicket`) y el listón del boleto (`listonTicket`) con las dos tablas de
  multiplicadores, la conservadora por defecto. **Se publican siempre** —en cada fila del tablero, en cada
  tesis anotada y en el agregado del track— pero **solo deciden con `GP_PROPS_EV_TICKET=1`**, que nace
  apagado. Cambiar el listón cambia qué tesis nacen, y `props_cs2_v2` está congelada desde el 20-ago
  justamente para que la muestra sea comparable; el número nuevo se escribe al lado para poder releer el
  track sin destruir la ventana.
- Cada lado lleva ahora `bar_pierna` / `edge_pierna` y `bar_ticket` / `edge_ticket` por separado, más el
  `ev_ticket` y un campo `decide` que dice cuál mandó.
- **Dedupe por `serie canónica | jugador | stat | lado | política`.** La clave era `día|jugador|stat|lado` y
  tenía dos agujeros: fundía dos series del mismo jugador el mismo día en una sola tesis (la segunda
  desaparecía sin contarse) y no llevaba la política de liquidación ni la versión de regla. La serie canónica
  la normaliza `lib/contrato.js` a partir de los dos nombres del cruce ordenados, así que «MOUZ vs NAVI» y
  «NAVI vs MOUZ» son la misma tesis. Se conserva lo que ya estaba bien: la **línea no entra en la clave**,
  porque el mismo over a 27,5, a 32,5 y a 34,5 es una tesis en tres precios.
- La clave vieja se sigue comprobando al anotar, para que el cambio no duplique una tesis existente.

**Nada de esto toca `esports-engine/cs2.js`, ni la regla `cs2_rounds_v1`, ni el ejecutor real.**

## Lo que queda abierto

1. **Exportar `closes-cs2.json`.** Sin el menú completo de líneas no se puede preguntar qué habría apostado
   S1 que T0 no apostó, que es la mitad que falta de E3. Es una ruta nueva en `server.js`, no un análisis.
2. **El 23 % de anulaciones** del hándicap de rondas: 115 de 500. Sin explicación todavía.
3. **El contrato de Underdog**, con tres cosas concretas: la tabla de multiplicadores de la propia casa con
   captura y fecha, un comprobante de pago real, y la regla de anulación de esports por escrito (qué pasa
   cuando la serie no llega al mapa 2 y la proyección era «mapas 1-2»).
4. **El arrastre económico por apuesta.** El motor lo calibra por mapa y el libro no guarda qué mapa del pool
   se jugó, así que la reconstrucción usa el valor por defecto. Se ha demostrado que la conclusión no cambia
   entre 0 y 0,12, pero guardar el mapa en la pick costaría un campo.
5. **El veto**, sin histórico real con el que validarlo.
6. **S2**, el modelo de ronda identificable con estados de marcador, lado, mitad y economía que pide la
   auditoría. S1 es la reparación mínima, no el modelo bueno.
