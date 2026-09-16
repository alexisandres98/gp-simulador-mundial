# Métricas recalculadas con la vara nueva — 15 de septiembre de 2026

> Entregable de la Fase 1 del `PLAN_TRABAJO_AUDITORIA_2026-09-15.md`. Compara, familia por familia, el veredicto
> que daba la vara anterior con el que da la nueva. Los datos salen de `/api/internal/vara` en producción el
> 15-sep a las 09:20 UTC, con el código del commit `8a7bd67`.

## 0. El resultado en una línea

**Ninguna familia es invertible.** Diez piden cierre, una es explícitamente no invertible, cuatro tienen muestra
corta y seis no se pueden juzgar porque su archivo de cierres no guarda las dos caras del mercado.

| Veredicto | Familias |
|---|---:|
| `invertible` | **0** |
| `cerrar` (el precio le gana al modelo con significancia) | 10 |
| `no_invertible` | 1 |
| `muestra_corta` | 4 |
| `sin_cierre_valorable` (no se puede saber) | 6 |

## 1. Qué cambió en el cálculo

La vara anterior restaba el margen por lado a la media del CLV recortado y llamaba «neto» al resultado. Son
magnitudes en unidades distintas y su resta no es el retorno esperado de nada. La nueva calcula, ticket a
ticket, el retorno esperado a la cuota que de verdad se aceptó contra la probabilidad sin margen del cierre:

```
EV_cierre = cuota_entrada × q_cierre − 1        con q_cierre = (1/cuota_cierre) / Q
```

y agrega después, con la incertidumbre por racimos de evento en vez de por tickets. Dos líneas del mismo
partido no son dos observaciones: medido en `tests/inferencia.test.js`, con veinte filas por racimo el error
estándar se multiplica por 4,4, así que un t de 4 era en realidad un t de 0,9.

La diferencia no es de precisión, es de signo. En la tabla de abajo hay familias con CLV recortado positivo y
significativo —CS2 rondas-hándicap en Pinnacle da +1,04 % con t 8,19— cuyo retorno esperado real es −3,28 %.
Le ganábamos al cierre y perdíamos contra la casa, que es justo lo que la resta anterior no sabía distinguir.

## 2. Familia por familia

La columna «veredicto anterior» se reconstruye aplicando la fórmula vieja a los mismos datos de hoy, para que
la comparación sea limpia. El CLV se conserva como diagnóstico de movimiento de línea, nunca como veredicto.

|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| `tt · POINTS_TOTAL · cloudbet` | muestra_corta (neto -3.53) | **muestra_corta** | -6.58 | -50.06 | 63 | 50 | -0.19 | -3.76 | 3.34 |
| `cs2 · RONDAS · bovada` | no_invertible (neto -2.96) | **cerrar** | -5.52 | -23.34 | 190 | 129 | 0.37 | 4.3 | 3.33 |
| `cs2 · RONDAS_HANDICAP · bovada` | no_invertible (neto -2.85) | **cerrar** | -5.21 | -14.56 | 311 | 150 | 0.17 | 2.03 | 3.02 |
| `valorant · RONDAS_HANDICAP · pinnacle` | no_invertible (neto -2.75) | **cerrar** | -5.07 | -13.87 | 150 | 57 | -0.27 | -1.14 | 2.48 |
| `tt · GAME_POINTS_HCP · cloudbet` | muestra_corta (neto -2.38) | **muestra_corta** | -4.75 | -12.2 | 76 | 72 | 0.19 | 1.91 | 2.57 |
| `cs2 · RONDAS · pinnacle` | no_invertible (neto -2.30) | **cerrar** | -4.43 | -27.41 | 309 | 148 | 0.42 | 9.04 | 2.72 |
| `dota2 · KILLS · bovada` | no_invertible (neto -1.74) | **cerrar** | -3.37 | -20.71 | 123 | 37 | 0 | — | 1.74 |
| `cs2 · RONDAS_HANDICAP · pinnacle` | no_invertible (neto -1.17) | **cerrar** | -3.28 | -9.55 | 412 | 148 | 1.04 | 8.19 | 2.21 |
| `valorant · RONDAS · pinnacle` | muestra_corta (neto -1.44) | **muestra_corta** | -2.98 | -19.45 | 96 | 51 | 0.29 | 4.46 | 1.73 |
| `lol · KILLS · bovada` | no_invertible (neto -1.26) | **cerrar** | -2.84 | -4.02 | 147 | 38 | 1.09 | 5.6 | 2.35 |
| `lol · KILLS_HANDICAP · bovada` | no_invertible (neto -1.10) | **cerrar** | -2.26 | -10.35 | 228 | 46 | 0.03 | 0.41 | 1.13 |
| `lol · KILLS_HANDICAP · cloudbet` | no_invertible (neto -0.98) | **cerrar** | -1.37 | -2.18 | 153 | 32 | -0.6 | -4.2 | 0.38 |
| `cs2 · RONDAS_HANDICAP · cloudbet` | no_invertible (neto -1.39) | **no_invertible** | -1.36 | -1.15 | 292 | 129 | 1.74 | 6.54 | 3.13 |
| `lol · KILLS_HANDICAP · pinnacle` | muestra_corta (neto -0.94) | **muestra_corta** | -1.3 | -3.81 | 87 | 11 | -0.7 | -4.81 | 0.24 |
| `sombra · lol_kills_hcp_v1` | — | **cerrar** | — | — | 0 | — | -0.98 | -7.04 | — |
| `lol · KILLS_DNB · cloudbet` | — | **sin_cierre_valorable** | — | — | 0 | — | -1.01 | -4.49 | — |
| `tt · GAME_ML · cloudbet` | — | **sin_cierre_valorable** | — | — | 0 | — | 0.21 | 1.42 | — |
| `tt · ML · cloudbet` | — | **sin_cierre_valorable** | — | — | 0 | — | 0.38 | 0.27 | — |
| `sombra · cards_under_v1` | — | **sin_cierre_valorable** | — | — | 0 | — | -0.62 | -3.69 | — |
| `sombra · corners_over_v1` | — | **sin_cierre_valorable** | — | — | 0 | — | -1.24 | -4.96 | — |
| `sombra · cs2_rounds_v1` | — | **sin_cierre_valorable** | — | — | 0 | — | 0.99 | 6.58 | — |

Notas de lectura:

- **Las seis familias `sin_cierre_valorable`** no tienen las dos caras del mismo mercado guardadas en el
  archivo de cierres, así que no se puede medir cuánto cobra la casa ni calcular el retorno esperado. Antes
  caían al camino viejo y podían recibir un veredicto; ahora dicen la verdad, que es que no se sabe. Entre
  ellas están los cuatro segmentos congelados de la sombra, incluido `cards_under_v1`.
- **`cs2 · HANDICAP · cloudbet`** aparece con un CLV recortado de +23,81 %: es un archivo de cierres roto, no
  una ventaja. Es el mismo tipo de artefacto que motivó el recorte al 10 % en septiembre.
- **Los `muestra_corta`** ya tienen retorno esperado calculado y todos son negativos; les falta muestra para
  que el veredicto sea firme, no para cambiar de signo.

## 3. Las dos cohortes del dinero real

`dias` mezclaba dos relojes: lo apostado se anotaba por fecha de colocación y el P&L por fecha de liquidación.
Dividir uno por otro no es el ROI de nada. Ahora van separadas.

**Rendimiento por fecha de decisión** (el P&L de las mismas filas que se colocaron ese día):

| Día | Colocadas | Apostado | Maduras | Abiertas | P&L | ROI de cohorte |
|---|---:|---:|---:|---:|---:|---:|
| 10-sep | 34 | 245 | 34 | 0 | −80,75 | −32,96 % |
| 11-sep | 12 | 110 | 12 | 0 | −34,65 | −31,50 % |
| 12-sep | 24 | 470 | 24 | 0 | −32,80 | −6,98 % |
| 13-sep | 12 | 285 | 12 | 0 | +113,50 | +39,82 % |
| 14-sep | 3 | 90 | 2 | 1 | +27,60 | parcial |
| 15-sep | 1 | 30 | 0 | 1 | 0 | parcial |

**Movimiento de caja por fecha de liquidación** (lo que cuadra con la casa):

| Día | Liquidadas | P&L | Devuelto |
|---|---:|---:|---:|
| 10-sep | 30 | +4,85 | 154,85 |
| 11-sep | 15 | +11,80 | 111,80 |
| 12-sep | 23 | −206,70 | 283,30 |
| 13-sep | 12 | +71,70 | 306,70 |
| 14-sep | 4 | +58,80 | 178,80 |
| 15-sep | 3 | +64,50 | 154,50 |

El 12-sep ilustra por qué importa la distinción: como cohorte de decisión pierde 32,80 sobre 470 apostados,
y como caja pierde 206,70, porque ese día se liquidaron apuestas colocadas días antes.

## 4. La reconciliación del dinero

La ecuación de caja es `saldo = depósitos − retiros + P&L realizado − expuesto`. Con el libro de hoy:

| Concepto | USDT |
|---|---:|
| Depósitos anotados | 0 |
| Retiros anotados (4 y 5 de septiembre) | 1.485,00 |
| P&L realizado sobre 283 liquidadas | −172,63 |
| Expuesto en 2 apuestas abiertas | 60,00 |
| Saldo real leído de la casa el 15-sep a las 09:05 | 0,00216 |

De ahí salen dos cifras que hacen falta para cerrarla:

1. **Los depósitos acumulados tienen que sumar unos 1.717,63 USDT.** No hay ninguno anotado, así que la
   ecuación nunca ha cerrado. Hace falta el total real para fijar la línea de partida.
2. **Entre el 14-sep a las 13:15 y el 15-sep a las 09:05 salieron 563,29 USDT que no explica ninguna apuesta.**
   En esa ventana se colocaron 120 en dos apuestas y entraron 243,90 de cinco ganadas, así que el saldo
   esperado era 563,29 y el real es 0,00216. No hay retiro anotado. Sin confirmación no se anota nada: inventar
   un movimiento para cuadrar la ecuación es peor que dejarla abierta.

Con el saldo en cero, la línea de caja de la parada está saltada y bloquea órdenes nuevas en los tres canales,
que es el comportamiento correcto.

## 5. Polymarket con comisión

Entregable de **T1.11** (hallazgo A09). La sombra de Polymarket anotaba el P&L de cada posición como
`acciones − coste` y no restaba lo que la casa cobra al taker por cruzar. Cruzamos siempre: la sombra
camina los asks del libro y el ejecutor coloca al límite del consenso menos un céntimo. Todo lo publicado
de esa sombra —incluido el +3,86 % que estaba a punto de encender el ejecutor real sobre `futbol:No`— venía
inflado por esa cantidad.

La tarifa está verificada contra dos fuentes de la propia casa el 15-sep y anotada en
`docs/CONTRATOS_CASA.md`: `fee = C × tasa × p × (1 − p)`, solo taker, **por mercado**. La documentación dice
0,05 para la categoría Sports; el `feeSchedule` que gamma publica en los binarios de partido que usamos dice
0,03. Se publican las dos, porque elegir una sería esconder que la casa no se pone de acuerdo consigo misma.

Como fracción del nocional la comisión es `tasa × (1 − p)`, así que muerde más cuanto más barata es la
acción y es máxima en dólares alrededor de 0,50, que es donde está nuestro precio medio.

**Antes y después, con tasa 0,05 (el defecto, el peor de los dos valores creíbles):**

| Corte | n | Apostado | P&L antes | ROI antes | Comisión | P&L después | ROI después |
|---|---:|---:|---:|---:|---:|---:|---:|
| Sombra completa, desde el inicio | 341 | 9.304,10 | +358,90 | +3,86 % | 268,17 | **+90,73** | **+0,98 %** |
| Sombra completa, semana 38 | 190 | 5.311,42 | +363,58 | +6,85 % | 150,45 | +213,13 | +4,01 % |
| `futbol:No`, desde el inicio | 101 | 3.029,46 | +262,54 | +8,67 % | 76,95 | **+185,59** | **+6,13 %** |
| CS2, semana 38 | 112 | 2.837,57 | +653,43 | +23,03 % | 83,19 | +570,24 | +20,10 % |
| Fútbol, semana 38 | 69 | 2.174,47 | −211,47 | −9,73 % | 59,85 | −271,32 | −12,48 % |
| LoL, semana 38 | 9 | 299,38 | −78,38 | −26,18 % | 8,21 | −86,59 | −28,92 % |

**Con tasa 0,03 (la que hoy devuelve el `feeSchedule` de nuestros mercados):**

### El recuento EXACTO, posición a posición (15-sep, 15:35 UTC)

El ledger sí era alcanzable: `/api/internal/picks-export?key=…&poly=1` lo exporta entero. Se corrió
`node scripts/poly-comision-recalc.js --ledger` sobre las **459 posiciones** del almacén vivo, de las que
**358 están liquidadas**, aplicando `fee = C·tasa·p·(1−p)` con el precio y las acciones **reales** de cada
fill y la tasa guardada en cada posición.

| corte | n | apostado | P&L bruto | ROI bruto | comisión | P&L neto | ROI neto |
|---|---:|---:|---:|---:|---:|---:|---:|
| `futbol · No` | 106 | 3.194,73 | +169,27 | +5,30 % | 82,73 | **+86,54** | **+2,71 %** |
| `cs2 · away` | 85 | 2.114,80 | +41,20 | +1,95 % | 61,73 | −20,53 | −0,97 % |
| `cs2 · home` | 83 | 2.190,85 | −35,85 | −1,64 % | 62,81 | −98,66 | −4,50 % |
| `futbol · Yes` | 46 | 1.375,90 | −248,90 | −18,09 % | 43,61 | −292,51 | −21,26 % |
| `cs2 · over` | 12 | 240,30 | +281,70 | +117,23 % | 8,14 | +273,56 | +113,84 % |
| `lol · over` | 10 | 287,83 | −144,83 | −50,32 % | 9,52 | −154,35 | −53,63 % |
| `lol · under` | 5 | 141,83 | −11,83 | −8,34 % | 4,87 | −16,70 | −11,78 % |
| `lol · home` | 4 | 116,13 | +81,87 | +70,50 % | 3,78 | +78,09 | +67,24 % |
| `cs2 · under` | 4 | 68,67 | −10,67 | −15,54 % | 1,33 | −12,00 | −17,47 % |
| `lol · away` | 3 | 92,00 | +17,00 | +18,48 % | 2,33 | +14,67 | +15,94 % |
| **TOTAL** | **358** | **9.823,04** | **+138,96** | **+1,41 %** | **280,86** | **−141,90** | **−1,44 %** |

**La comisión cambia el signo de la sombra entera.** Bruto +1,41 %, neto **−1,44 %**. Y la estimación
anterior se quedaba corta, exactamente como advertía: decía +0,98 % y el número real es −1,44 %.

Tres cosas que esto deja claras:

- **La sombra de Polymarket no es un negocio.** Lo que parecía un +3,86 % era el bruto de un libro que, con
  lo que cobra la casa, pierde dinero. La comisión —280,86 sobre 9.823 apostados— es **el doble del P&L
  bruto**.
- **`futbol:No` sobrevive, y es lo único que sobrevive con muestra.** +2,71 % neto sobre 106 posiciones.
  Era la familia que el ejecutor real iba a tomar y sigue en pie, pero con un tercio de la ventaja que se
  le atribuía (+8,67 % publicado → +5,30 % bruto → +2,71 % neto) y con un t que ya antes no era
  significativo.
- **Los dos lados de CS2 pierden en neto** (−0,97 % y −4,50 %) pese a que uno de ellos ganaba en bruto. Es
  el caso exacto que la puerta nueva `ev_tras_comision` existe para frenar: ventaja positiva más pequeña
  que la comisión.

`cs2 · over` con +113,84 % sobre 12 posiciones y `lol · home` con +67,24 % sobre 4 no son resultados: son
muestras de doce y de cuatro. Se listan para que la tabla cuadre, no para leerlos.

**Lo que ya está en el código** (no hay que volver a decidirlo):

- `lib/comisiones.js` — la fórmula, con la tasa y el exponente parametrizados (`GP_PM_FEE_RATE`,
  `GP_PM_FEE_EXP`) y el defecto documentado.
- `propfirm/polyshadow.js` — el presupuesto de cada fill incluye la comisión, el efectivo la descuenta, el
  P&L la resta y cada posición guarda `comision` y `tasa_comision`. `estado()` publica el bruto al lado del
  neto para que nadie compare un número nuevo contra uno viejo sin darse cuenta.
- `polymarket/ejecutor.js` — lo mismo, más **la puerta nueva**: una señal cuya ventaja declarada por acción
  no supera a la comisión de esa acción **no genera orden** y se cuenta aparte (`ev_tras_comision`). A
  precio 0,50 y tasa 0,05 el listón mínimo es 1,25 pp de ventaja; por debajo de eso lo que parecía una
  oportunidad pequeña era una pérdida esperada.

## 5b. El replay de los motores que no pasaban por la vara (T1.13)

`node scripts/replay-vara.js --dir <volcados de ?motor=> --md`

### Por qué faltaba, y no era pereza

Los ocho motores que quedaron fuera del apartado 2 **no tenían forma de sacar su libro ticket a ticket**.
`track()` devuelve agregados —n, ROI, CLV medio— y el EV contra el cierre no se puede calcular con
agregados: es un cálculo ticket a ticket contra la cara contraria del MISMO contrato en la MISMA casa. La
ruta `?motor=` (15-sep) los abre; `libroCrudo()` hace lo propio en tenis, tenis de mesa, dardos, NFL y
derivadas. Son **6.202 picks, 5.352 liquidadas**, que hasta hoy no se podían juzgar desde fuera.

### El resultado

| motor | picks | liquidadas | con cierre propio | **con la cara contraria** | veredicto | CLV recortado | ROI a stake plano (IC por evento) |
|---|---:|---:|---:|---:|---|---:|---|
| `esports:cs2` | 2.412 | 1.973 | 1.794 | **0** | `cerrar` | +1,07 % | +0,32 % [−7,93, +8,76] |
| `esports:lol` | 1.257 | 1.187 | 919 | **0** | `cerrar` | +0,12 % | +0,80 % [−5,87, +8,47] |
| `tenis` | 811 | 776 | 323 | **0** | `sin_cierre_valorable` | −11,26 % | +4,42 % [−7,86, +17,92] |
| `esports:valorant` | 449 | 430 | 393 | **0** | `cerrar` | +0,20 % | −5,01 % [−20,42, +10,06] |
| `tt` | 444 | 444 | 114 | **0** | `sin_cierre_valorable` | +0,13 % | −19,51 % [−32,51, −6,81] |
| `esports:dota2` | 396 | 283 | 228 | **0** | `cerrar` | −0,01 % | −7,51 % [−21,35, +6,52] |
| `hoops` | 188 | 187 | 136 | **0** | `sin_cierre_valorable` | −0,24 % | +2,19 % [−23,26, +27,97] |
| `dardos` | 181 | 41 | 19 | **0** | `sin_cierre_valorable` | −6,36 % | −36,47 % [−64,40, −5,36] |
| `nfl` | 64 | 31 | 0 | **0** | `sin_cierre_valorable` | +7,90 % | −23,00 % [−62,18, +17,29] |
| `derivadas` | 0 | 0 | 0 | 0 | `sin_liquidadas` | — | — |

### Nueve de nueve: una sola causa, no ocho problemas

**Ningún motor guarda la cara contraria del cierre.** Guardan el suyo —y algunos muy bien: CS2 lo tiene en
el 91 % de sus picks— pero sin el contrario no se puede quitar el margen, y sin quitar el margen no se puede
saber si hay dinero. Es exactamente lo que deja a tarjetas sin veredicto. **Es una tarea, no nueve**, y es
la que desbloquea todo lo demás.

### Los cuatro `cerrar` no vienen del CLV

Los cuatro juegos de esports reciben `cerrar` por la **prueba directa** —¿acierta más la probabilidad del
modelo o la del precio?— y no por el CLV. CS2 es el caso que resume la auditoría entera en una fila: **CLV
recortado +1,07 %, y el precio le gana al modelo con t −3,49**. Le ganamos al cierre y perdemos contra la
casa. Esa es la distinción que la vara vieja no sabía hacer.

### Y una advertencia sobre el −19,51 % de tenis de mesa

Ese número **no es del canal con dinero**. Desglosado por familia:

| familia | n | ROI | IC por evento |
|---|---:|---:|---|
| `POINTS_TOTAL` *(la que tiene dinero real, 5 USD planos)* | 105 | **−4,30 %** | **[−28,66, +20,09]** |
| `GAME_POINTS_TOTAL` | 42 | −37,39 % | [−62,83, −8,50] |
| `GAME_POINTS_HCP` | 86 | −30,56 % | [−51,59, −7,64] |
| `GAME_ML` | 75 | −24,69 % | [−45,39, −3,05] |
| `POINTS_HCP` | 21 | −22,29 % | [−63,60, +16,83] |
| `ML` | 64 | −18,17 % | [−38,91, +2,07] |
| `GAMES_HCP` | 51 | −10,41 % | [−36,73, +15,41] |

La familia con dinero es la **menos mala de las siete** y su intervalo contiene el cero con holgura: no hay
evidencia de que esté perdiendo. Las que sangran de verdad, con el intervalo fuera del cero, son las **tres
familias de GAME** —el mercado dentro de un game— y ninguna de ellas lleva dinero. Leer el agregado del
motor como si hablara del canal real habría sido justo el error de mezclar familias que ya escondió tarjetas
durante semanas.

Dardos (−36,47 % con el intervalo fuera del cero) tiene 41 liquidadas: es una señal, no una conclusión.

---

## 5c. La cara contraria del cierre: ya estaba guardada (16-sep)

El §5b dejó nueve motores de nueve sin veredicto por falta de la cara contraria del cierre, y lo anotó como
la tarea que desbloqueaba todo lo demás. **Al ir a hacerla resultó que el dato ya estaba en casi todos.** No
era un problema de captura: era de lectura.

| motor | guardaba las dos caras | lo que fallaba |
|---|---|---|
| esports (4 juegos) | **sí**, `c.rows` con el mercado entero por casa | `closeOddsFor` leía solo el lado de la pick |
| tenis de mesa, dardos | **sí**, `c.rows` | igual |
| **tarjetas** (dinero real) | **sí** — la consulta ya traía las dos | un `x.side === side` tiraba una, y el refresco pedía `lower(side)=$4` |
| tenis ATP | **sí**, `bb[casa][lado]` desde el 9-sep | ya estaba leído desde el 15-sep |
| NFL | **no**: la mediana de un solo lado | único caso real de captura; arreglado, solo hacia adelante |

### Lo recuperado

| motor | liquidadas | con la cara contraria | % | margen medio por lado |
|---|---:|---:|---:|---:|
| `esports:cs2` | 1.987 | 1.505 | 75,7 % | 4,01 % |
| `esports:lol` | 1.188 | 892 | 75,1 % | 4,55 % |
| `esports:dota2` | 283 | 225 | 79,5 % | 3,86 % |
| `esports:valorant` | 430 | 242 | 56,3 % | 4,90 % |
| `tt` | 449 | 114 | 25,4 % | 4,70 % |
| `dardos` | 41 | 18 | 43,9 % | 3,46 % |
| **total** | **4.378** | **2.996** | **68,4 %** | |

En tenis de mesa y dardos el 25,4 % y el 43,9 % **son el techo, no un fallo**: solo 117 y 19 picks tenían
cierre guardado, y de esas se recuperaron 114 y 18. Prácticamente todas.

### El hándicap tenía dos convenciones de signo y solo conocíamos una

Los totales salieron a la primera con márgenes de 3,1-3,5 % —el 3,13 % que Cloudbet tiene medido— y los
hándicaps daban **Q menor que 1 en 294 picks de CS2**. Una Q menor que 1 es un arbitraje de una casa contra
sí misma: no existe, así que el emparejado estaba mal.

Mirando las filas reales (hubo que abrir una sonda para verlas): **Bovada publica las dos caras del hándicap
con la MISMA línea** —`home −2,5 @ 2,05` y `away −2,5 @ 1,741`— porque el signo lo lleva implícito el lado.
Sus cuotas dan Q = 1,062, o sea 3,1 % por lado: son la pareja buena. `lib/contrato.js` asume la convención
estándar (`home −2,5` ↔ `away +2,5`), así que no las encontraba y en eventos con varias líneas acababa
cogiendo otra fila.

El arreglo **no es relajar el emparejado**: es admitir la segunda convención y **dejar que decida la Q**. Un
mercado de dos caras, en una casa, en un momento, tiene siempre margen pequeño y positivo, así que se exige
que la Q caiga entre 1,0005 y 1,15 —donde están todos los márgenes medidos de esta casa—. Si no cae ninguna
candidata, o caen dos, no se empareja y se dice el motivo. Un hueco declarado es mejor que un margen
inventado, que es el error que infla el EV en la dirección que nos conviene.

### Tenis: el problema no era la cara contraria

De las 583 picks de total y hándicap liquidadas, **453 tienen su línea fuera de la foto del cierre**. El
síntoma se vio ayer —el 78 % sin CLV, con 3 juegos de distancia mediana al consenso— y se leyó como «el
mercado no cotiza nuestra línea». La causa real es otra: la foto del cierre se recortaba a las **12** líneas
más cercanas al consenso, y hemos apostado **71 líneas distintas**. La nuestra se quedaba fuera.

Subido a 40. **El histórico de tenis no se recupera**: eso ya está perdido y hay que decirlo.

### Lo que sigue sin tener cierre valorable

- **NFL**: solo hacia adelante, era el único con un problema de captura de verdad.
- **Tenis histórico**: la línea no está en la foto. Irrecuperable.
- **El ganador**, en todos los deportes: sus dos caras se guardan como la mejor cuota por lado ENTRE casas,
  y desvigar eso fabrica un mercado que no existió. Se declara, no se aproxima.
- **Tarjetas**: el arreglo está puesto pero **todavía no hay muestra**, porque la captura solo ocurre en la
  ventana de ≤95 min antes del saque. El contador del preregistro de `cards_under_v2` empieza a subir desde
  hoy, no hacia atrás.

---

## 5d. El replay, otra vez, ya con EV (16-sep)

Con 2.996 picks recuperadas, la vara por fin puede juzgar. `node scripts/replay-vara.js --dir <volcados>`.

| motor | liquidadas | con contraria | **EV al cierre** | t | eventos | veredicto | ROI a stake plano |
|---|---:|---:|---:|---:|---:|---|---|
| `esports:cs2` | 1.988 | 1.506 | **−3,46 %** | −6,61 | 349 | `cerrar` | +0,17 % [−7,97, +8,39] |
| `esports:lol` | 1.188 | 892 | **−7,67 %** | −21,09 | 115 | `cerrar` | +0,71 % [−6,60, +8,10] |
| `esports:valorant` | 430 | 242 | **−7,61 %** | −14,41 | 69 | `cerrar` | −5,01 % [−20,42, +10,06] |
| `esports:dota2` | 283 | 225 | **−5,27 %** | −3,98 | 48 | `cerrar` | −7,51 % [−21,35, +6,52] |
| `tt` | 449 | 114 | **−7,60 %** | −6,16 | 35 | `cerrar` | −18,77 % [−31,73, −4,99] |
| `dardos` | 41 | 18 | −10,96 % | −3,24 | 15 | `muestra_corta` | −36,47 % [−64,40, −5,36] |
| `tenis`, `hoops`, `nfl` | 1.002 | 0 | — | — | — | `sin_cierre_valorable` | |

**Las cinco familias que se pueden medir tienen esperanza negativa, y ninguna por poco.** Es la respuesta a
la pregunta con la que empezó la auditoría, y ahora está medida sobre racimos de evento en vez de sobre
tickets: CS2 con 349 eventos y t −6,61 no es una racha.

### El ROI no dice nada, y aquí se ve de un vistazo

CS2 tiene **ROI +0,17 %** y **EV −3,46 %**. LoL, **+0,71 %** y **−7,67 %**. Los dos ROI son positivos y los
dos intervalos contienen el cero con quince puntos de holgura; los dos EV son negativos con t de −6 y −21.
Esto es exactamente lo que la auditoría vino a corregir: durante meses se leyó el ROI y el CLV, que son
ruido a estas muestras, y no el retorno esperado, que es señal.

### Tenis de mesa: la familia con dinero, y lo que de verdad dice el número

`POINTS_TOTAL` es la que lleva los 5 USD planos. Su EV es **−8,85 % sobre 21 tickets en 18 eventos**, el
peor de las siete familias de TT. Pero el número hay que leerlo con cuidado, porque **la cuota de entrada es
idéntica a la del cierre en 17 de esos 21 tickets** (y en el 48,7 % de todo el tenis de mesa con cierre).

Cuando entrada y cierre coinciden, el EV se reduce exactamente a menos el margen de la casa:
`EV = o·(1/o)/Q − 1 = 1/Q − 1`. Así que ese −8,85 % **no es evidencia de que el modelo pierda contra una
línea que se mueve**: es lo que cuesta pagar el margen sin capturar ningún movimiento.

Y el margen es el hallazgo de verdad:

| margen por lado en TT (n = 114) | p10 | mediana | p90 |
|---|---:|---:|---:|
| | 4,09 % | **4,95 %** | 5,08 % |

**Casi el 5 % por lado.** El margen medido de Cloudbet en el resto de sus mercados es 3,13 %. En el total de
puntos de tenis de mesa cobra un 58 % más. Para salir a cero en esa familia hace falta una ventaja de unos
5 puntos porcentuales, y nunca hemos medido tenerla.

Eso es un argumento contra el canal de dinero de TT mucho más fuerte que su ROI, porque no depende de la
muestra de resultados: el margen se mide con las dos caras de la misma foto, y ahí n = 114.

### Lo que este replay NO dice

- **De tenis, baloncesto y NFL sigue sin saberse nada.** Tenis porque su línea no cabía en la foto del
  cierre (§5c), los otros dos porque no guardan la cara contraria. No es que salgan mal: es que no salen.
- **El `cerrar` de tenis de mesa no está probado como fallo de modelo.** Lo que está probado es que, a esos
  precios y con ese margen, la esperanza es negativa. Distinguir «el modelo falla» de «la casa cobra
  demasiado» hace falta un cierre que de verdad se mueva, y en esta familia la línea apenas se mueve.
- **Dardos tiene 18 tickets.** Se lista para que la tabla cuadre.

---

## 6. Lo que falta para cerrar la Fase 1

| Tarea | Estado |
|---|---|
| T1.1 vara sobre el retorno esperado | hecho |
| T1.4 cuartos asiáticos por pagos | hecho |
| T1.5 inferencia por racimos | hecho |
| T1.7 dos cohortes | hecho |
| T1.8 parada por canal y vinculante | hecho |
| T1.10 frenos de saldo y Kelly | hecho |
| T1.12 puertas de baloncesto | hecho |
| T1.2 el precio como tupla | `lib/contrato.js` escrito y probado; **falta conectarlo** en el tablero, en el selector de mejor precio y en los dos motores de fútbol americano |
| T1.3 cierres prepartido | el cubo T−1 ya no admite lecturas posteriores al inicio; **falta conectar** `estadoCaptura` en cada motor |
| T1.6 tablero sin etiqueta de confirmada | pendiente |
| T1.11 comisiones de Polymarket | **hecho**: tarifa verificada, código desplegado y recálculo EXACTO corrido sobre las 358 liquidadas del ledger (§5). La sombra pasa de +1,41 % bruto a −1,44 % neto |
| T1.13 replay completo de todos los tracks | **hecho** (§5b): diez motores, 6.202 picks, 5.352 liquidadas. Nueve de nueve sin la cara contraria del cierre — una sola causa |
| T1.14 Pinnacle sin eventos de tenis de mesa | hecho — ver §7 |

## 7. Fuentes: qué está vivo y qué no (15-sep)

La auditoría señaló que `pinnacle()` de tenis de mesa devolvía cero eventos y aun así publicaba
`available: true`. Al comprobarlo contra la API resultó que **el fallo no era de los ids ni de los endpoints**:
el deporte 32 ES Table Tennis y el 10 ES Darts, las dos rutas contestan HTTP 200, y lo que traen es `[]`. El
catálogo del propio Pinnacle lo confirma desde el otro lado: `/0.1/sports` devuelve
`{"id":32,"name":"Table Tennis","matchupCount":0}` y `{"id":10,"name":"Darts","matchupCount":0}`, mientras el
control de la misma llamada —deporte 33, Tennis— trae 348 matchups y 1,88 MB de mercados. O sea: **Pinnacle
sencillamente no está publicando ni tenis de mesa ni dardos**. No se fuerza nada; se documenta y se etiqueta.

Lo que sí era un fallo nuestro es que las tres causas de un cero se publicaban igual. Cero filas porque la
casa no cubre el deporte, cero filas porque la red se cayó y cero filas porque falta la credencial son tres
problemas distintos con tres arreglos distintos, y los tres se leían como `available: true` o como un `false`
mudo. El caso más descarado era Kalshi: `available: Array.isArray((j && j.markets) || [])` es **siempre**
`true`, porque ese `|| []` fabrica un array aunque la llamada haya fallado.

### La tabla

| Fuente | Deporte | Estado real comprobado | Evidencia (HTTP · filas) | Acción tomada |
|---|---|---|---|---|
| Pinnacle (guest arcadia, deporte 32) | Tenis de mesa | `sin_eventos` — id y endpoint correctos, la casa no publica | 200 · `[]` · 0 eventos; catálogo `matchupCount: 0` | `available: false` + `estado: sin_eventos`; comentario con la evidencia en el código |
| Pinnacle (guest arcadia, deporte 10) | Dardos | `sin_eventos` — idéntico caso | 200 · `[]` · 0 eventos; catálogo `matchupCount: 0` | igual que arriba |
| Pinnacle (control, deporte 33) | Tenis | `viva` — prueba de que la llamada y la clave están bien | 200 · 348 matchups · 1,88 MB de mercados | ninguna; es el control |
| Pinnacle `/sports/32/leagues` | Tenis de mesa | 403 `BAD_LOCATION` reproducible 3/3 desde el sandbox (salida US) | 403 · `{"reason":"location"}` | ninguna: el motor no usa esa ruta, usa `/matchups`, que sí contesta 200 |
| Bovada (cupón `table-tennis`) | Tenis de mesa | `viva` | 200 · 985 KB · 149 eventos · 2.390 filas | `estado: viva` |
| Bovada (cupón `darts`) | Dardos | `viva` | 200 · 233 KB · 16 eventos + 107 outrights · 559 filas | `estado: viva`; los outrights cuentan como fila utilizable |
| Polymarket (gamma, serie 12754) | Dardos | `viva` | 200 · 119 KB · 16 eventos con precio | `estado: viva`; un evento sin filas de precio no cuenta |
| Kalshi (`KXPDCDARTS`) | Dardos | `viva` | 200 · 31 KB · 18 mercados abiertos | **corregido el `available` siempre-true**: ahora `respondio: !!j` |
| Cloudbet (`/fixtures?sport=table-tennis`) | Tenis de mesa | `no_configurada` en el sandbox (la clave vive en Render) | 401 sin clave | `estado: no_configurada`, que ya no se confunde con caída |
| Cloudbet (`/fixtures?sport=darts`) | Dardos | `no_configurada` en el sandbox | 401 sin clave | igual |
| Cloudbet (`/fixtures?sport=counter-strike`) | Esports | `no_configurada` en el sandbox | 401 sin clave | igual; además la casa apagada **aparece** en el parte, antes se filtraba y desaparecía |
| Pinnacle (deporte 12, E Sports) | Esports | `viva` | 200 · 68 matchups en catálogo · 24 eventos de CS2 | `estado: viva` |
| Bovada (esports) | Esports | `viva` | 200 · 26 eventos de CS2 | `estado: viva` |

### El arreglo

`lib/fuente.js` (nuevo) fija la regla en un sitio: **`available` solo es true si la llamada respondió Y trajo
al menos una fila utilizable**, y cuando no lo es, `estado` dice cuál de las cuatro cosas pasa —
`viva` · `sin_eventos` · `error_red` · `no_configurada`. Se aplicó en `data-providers/tt/books.js`,
`data-providers/darts/books.js`, `data-providers/esports/cloudbet.js` y el agregador
`data-providers/esports/books.js`, y se propaga a `tt-engine/store.js` y `darts-engine/store.js`.

Dos detalles que valía la pena arreglar de paso: un bucle de fixtures de Cloudbet que falla los seis u ocho
días seguidos ahora sale como `error_red` y no como "hoy no hay partidos"; y la agenda unificada de esports
declara `available` por **partidos fundidos**, no por "alguna casa contestó con las manos vacías".

Se ve en las sondas sin abrir sesión:

- `/api/internal/tt?key=` → `snapshot.odds.estado` y, con `&odds=1`, `estado` junto a `books`.
- `/api/internal/darts?key=` → `snapshot.odds.estado` y `snapshot.odds.eventos`; con `&odds=1`, lo mismo.
- `/api/internal/esports?key=` → `books_estado` (por casa) y cada entrada de `books` con `estado` y `por_que`.

Medido el 15-sep a las 14:12 UTC. Que Pinnacle no publique estos dos deportes **hoy** no significa que los
haya retirado para siempre: el día que vuelva a abrirlos, el estado pasará solo a `viva`. Lo que ya no puede
pasar es que sigamos leyendo `available: true` de un canal que lleva días sin traer un solo precio.
