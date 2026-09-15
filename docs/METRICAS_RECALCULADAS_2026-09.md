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

## 5. Lo que falta para cerrar la Fase 1

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
| T1.11 comisiones de Polymarket | pendiente |
| T1.13 replay completo de todos los tracks | este documento cubre las familias con cierre; faltan los motores que no pasan por la vara |
| T1.14 Pinnacle sin eventos de tenis de mesa | pendiente |
