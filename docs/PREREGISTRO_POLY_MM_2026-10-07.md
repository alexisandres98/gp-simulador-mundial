# Preregistro — Market making en sombra sobre Polymarket (`mm_v1`)

**Fecha:** 7 de octubre de 2026 · **Orden:** Alexis («procede, vamos a hacerlo») · **Código:** `propfirm/mm.js`,
`propfirm/cotizables.js`, ganchos en `propfirm/scan.js` · **Sonda:** `/api/internal/polymm?key=` · **Test:**
`node tests/poly-mm.test.js`.

Escrito ANTES de la primera pasada en producción. Lo que no está aquí no se decide con esta sombra.

## 1. La hipótesis

Dos meses de medición dicen que el modelo no le gana al precio en ningún deporte salvo tarjetas under, y que
cruzar la horquilla cuesta 3-5 % por lado en las casas y 0,8-2,7 pp de deslizamiento en Polymarket. Todo el
sistema ha jugado de taker. La hipótesis es estructural, no predictiva: **reposar órdenes a los dos lados del
consenso sharp sin margen en los binarios de partido de Polymarket cobra más horquilla de la que pierde por
selección adversa.** Si es cierta, es la primera fuente de ingreso del proyecto que no depende de batir al
mercado. Si es falsa, el markout lo dirá en cuatro semanas.

## 2. Las dos reglas, congeladas

Corren las dos a la vez, con el mismo universo, los mismos cruces y el mismo libro, cada una con su fichero, su
banco de 2.000 y su P&L (`mm_ancho` en `poly-mm.json`, `mm_libro` en `poly-mm-libro.json`). La segunda nació a
la hora de arrancar la primera, y el porqué está medido: en los binarios de partido de fútbol y tenis el libro de
Polymarket ya está a UN céntimo de horquilla (Inter Turku 0,57/0,58, Internacional 0,42/0,43, Remo 0,45/0,46).
Una orden a ±2 pp reposa dos céntimos por detrás del mejor precio y solo se llena cuando el precio la atraviesa,
es decir, cuando el mercado se movió en contra: todo selección adversa y nada de horquilla. Pegarse al libro es lo
que hacen los makers que ya están ahí, y es lo que hay que medir.

| | `mm_ancho` | `mm_libro` |
|---|---|---|
| Cotización | bid = justo − 2 pp − sesgo · ask = justo + 2 pp − sesgo, recortados para no cruzar el libro | bid = mejor bid del CLOB si está por debajo del justo · ask = mejor ask si está por encima; sin libro, no se cotiza |
| Sesgo por inventario | (inventario / 200) × 2 pp, restado a las dos | con el inventario a más de ±100, se apaga ese lado |
| Fill al precio exacto | a prorrata: 50 / (50 + lo que el libro enseñaba en ese nivel al cotizar) | igual (y aquí casi siempre hay cola: es el mejor precio) |


| parámetro | valor | variable |
|---|---|---|
| Precio justo | mezcla a partes iguales del consenso sharp (Shin por casa en fútbol; desvigado del escáner en tenis, esports y NFL) y del medio del libro del CLOB en ese momento | `GP_POLYMM_PESO_LIBRO` (0,5) |
| Discrepancia | si consenso y medio del libro se separan más de 8 pp, uno de los dos está rancio o roto: no se cotiza (pausa) | `GP_POLYMM_DISCREPANCIA_PP` |
| Nunca cruzar el libro | el bid se recorta a mejor ask − tick y el ask a mejor bid + tick; como mucho se mejora el libro un tick | — |
| Medio spread | 2 pp a cada lado del justo | `GP_POLYMM_SPREAD_PP` |
| Tamaño | 50 shares por lado y por intervalo | `GP_POLYMM_SIZE` |
| Sesgo por inventario | (inventario / 200) × medio spread, restado a las dos cotizaciones | `GP_POLYMM_INV_MAX` |
| Inventario máximo | ±200 shares netas por mercado; al tope se apaga ese lado | `GP_POLYMM_INV_MAX` |
| Ventana | se cotiza entre 36 h y 15 min antes del saque; a los 15 min se retira todo | `GP_POLYMM_H_MAX/H_MIN` |
| Banda de precio | justo entre 0,08 y 0,92 | `GP_POLYMM_PRECIO_MIN/MAX` |
| Liquidez mínima | 500 USD de liquidez en gamma | `GP_POLYMM_LIQ_MIN` |
| Frescura | consenso con más de 75 min no cotiza (pausa, no retirada) | `GP_POLYMM_FRESCURA_MIN` |
| Banco | 2.000 USDC simulados; cada lado necesita su colateral en caja | `GP_POLYMM_BANCO` |
| Cadencia | una pasada cada 5 min; el consenso se refresca cada 10 (el barrido de la firm) | `GP_POLYMM_MIN` |
| Universo | todo mercado binario que el escáner empareja con consenso: fútbol 1X2 (Yes/No), tenis ML, esports (mapa, serie, hándicaps, totales), NFL ML | `propfirm/cotizables.js` |

Por qué el justo lleva el libro: el precio de Polymarket contiene información (medido en la sombra v1: comprar
el consenso contra PM rinde +0,2 % en 129 posiciones de fútbol·No, o sea, PM acierta tanto como las casas), y un
maker que solo mira su consenso cotiza de lado cada vez que los dos discrepan: acumula inventario direccional, que
es apostar con pasos de más. En el ensayo del 7-oct (Inter Turku), el consenso decía 0,527 y el libro 0,56/0,57:
cotizar ±2 pp sobre 0,527 habría puesto nuestra venta DEBAJO del mejor bid, que no reposa, se ejecuta como taker.

Un mercado nace con su cotización y se llena **a partir de la pasada siguiente**, siempre contra la cotización
que estaba vigente durante el intervalo, nunca contra la recién calculada.

## 3. Cómo se simula un fill, y por qué es conservador

Polymarket publica cada cruce real (`data-api /trades`: lado del taker, outcome, precio, tamaño, segundo).
Todo se traduce a coordenadas del outcome 0 (comprar NO a q es vender YES a 1−q).

- Nuestra **compra** a `bid` se llena cuando un taker **vendió** a precio ≤ bid. Si el cruce fue por debajo
  de nuestro precio, entero (por prioridad de precio nos habrían llenado antes). Si fue **exactamente** a
  nuestro precio, **a prorrata**: nuestras 50 entre 50 más lo que el libro enseñaba en ese nivel cuando
  cotizamos (la cola). Con 150 delante, un cruce de 100 nos da 25.
- La **venta** a `ask`, espejada.
- Cada lado tiene 50 shares por intervalo; consumidas, no hay más fills hasta la pasada siguiente.
- El P&L se liquida con la **resolución del propio Polymarket** (gamma), como los dos libros de sombra.

Sesgos conocidos, todos en contra nuestra: (a) el maker simulado reprecia cada 5 min con un consenso de 10,
así que mide a un maker **lento**, y el maker real sería más rápido, no más lento; (b) el feed de trades se
lee con tope de 200 por mercado y pasada, así que en un mercado muy activo se pierden fills, nunca se
inventan; (c) la prorrata supone que la cola no cambió entre pasada y pasada, y no modela prioridad temporal: con 0 en cola nos llena entero, que es generoso.

## 4. Lo que se mide

Por mercado y agregado por deporte y familia: fills, nocional cruzado, inventario final, **horquilla cobrada**
(precio frente al justo en el momento de cotizar), **markout a 30 min** de cada fill (si el justo se movió en
nuestra contra después de llenarnos, nos eligieron: es la selección adversa en dinero), **P&L realizado** a la
resolución, P&L marcado al justo de lo abierto, minutos cotizados y minutos dentro del perímetro de las
recompensas de liquidez.

**No suma al P&L**, y se publica aparte como tope: las recompensas de liquidez (tasa diaria del CLOB × fracción
del día elegible, como si fuéramos el único maker) y el rebate de comisión del maker (`rebateRate` de la
tarifa del mercado sobre la comisión del taker que nos cruzó). Los dos dependen de cuánta otra liquidez hubo,
que no se ve desde fuera.

## 5. La puerta, escrita hoy

- **Lectura:** lunes 3 de noviembre de 2026, con el reporte semanal. Antes no se lee con veredicto.
- **Muestra mínima para leer un deporte y una regla:** 60 mercados resueltos con al menos un fill y 300 fills.
- Las dos reglas se leen por separado; si una confirma y la otra descarta, manda la que confirma SOLO si su markout también cumple.
- **Se confirma** un deporte si el P&L realizado SIN recompensas es positivo con t ≥ 2 sobre el ROI por
  mercado (P&L / nocional) Y el markout a 30 min no se come más de la mitad de la horquilla cobrada.
- **Se descarta** si el markout supera a la horquilla (el maker lento pierde contra quien cruza) o si el P&L
  tiene t ≤ −2 con la muestra mínima.
- Entre medias, sigue en sombra. Las recompensas no deciden nada: si solo con ellas saliera positivo, es un
  negocio de subsidio, y se dice así.

## 6. Qué haría falta para que fuera real (y que hoy no está)

1. Un servidor fuera de Estados Unidos: la sonda `poly_geo` del 13-sep dice que desde Render (Oregón) el
   trading de Polymarket está bloqueado por región aunque la lectura funcione. Hetzner (ya hay cuenta) sirve.
2. Una wallet propia con USDC en Polygon y la firma de órdenes EIP-712 contra el CLOB (`/order`), con
   cancelación y reposición en segundos, no en minutos.
3. Capital: con 2.000 USDC el techo son decenas de dólares al mes; el ingreso escala con el capital y con la
   velocidad, y los dos cuestan. Eso se decide después de la lectura, no antes.

## 7. Lo que NO cambia

Ni las señales, ni los dos libros de sombra de Polymarket (v1, v2), ni la vara, ni el ejecutor real, ni el feed.
`propfirm/cotizables.js` es una salida lateral del escaneo; `tests/feed.test.js` y `tests/poly-mm.test.js` lo
comprueban. Ningún dinero real.
