# Cierre Semana 39 — GP Simulador

**Reporte semanal · semana 39 (14 – 20 sep 2026).** Cifras leídas de las sondas internas de producción el
lunes 21 de septiembre entre las 06:41 y las 06:45 UTC. Vara de decisión: la de `lib/vara.js` (EV contra el
cierre sin margen cuando el cierre aporta; prueba directa modelo-contra-precio cuando no). Los ROI de la
sombra son en unidades de 1; los del ejecutor real y del banco simulado son USDT.

**En una línea:** el canal real se reabrió el jueves con 400 USDT y **no colocó ni una apuesta**, porque el
dinero salió de la cuenta esa misma noche; las 28 señales que habrían entrado y ya están liquidadas
**habrían dejado +119,10 USDT**, con seis apuestas de Liga MX cargando todo el resultado. En la sombra fue
una semana **mala para el banco simulado (−963,93)** y **buena para la única cohorte que importa** (cards con
las reglas del ejecutor: +14,93 %). Y dos fuentes de datos se caen: The Odds API ya está muerta y
**API-Football vence el miércoles 23 — y de API-Football depende liquidar las tarjetas.**

---

## Resumen ejecutivo

### Las tres cosas que decidí mirar esta semana

**1. Qué pasó con el dinero real.** Jueves 17, 15:06 UTC: depósito de 399,99; 15:13 canal encendido con
las reglas nuevas (saque hasta el lunes 21 08:00, sin ligas eficientes, una por partido, stake 30, suelo de
caja 5). La primera señal (Betis–Getafe) se rechazó por precio: nació a 1,60 y la casa cotizaba 1,49-1,51,
por debajo del mínimo tolerado (1,55). A las 23:20 del jueves el saldo ya era 11,63: Alexis retiró 388,37
(confirmado hoy; anotado; conciliación cerrada a diferencia 0). Desde entonces el ejecutor vio **49 señales
buenas y las frenó todas por `sin_fondos`**. Colocadas en la semana: **cero**.

**2. Cuánto habría dejado ese dinero.** Con las reglas exactas del ejecutor (una por partido, la primera
nacida) quedan 37 apuestas; 28 ya están liquidadas y 9 (las del domingo por la tarde y noche) todavía no.
Las 28: **15-13, 840 USDT apostados, +119,10 USDT, ROI +14,18 %**. Con 400 en caja habrían cabido todas
(saldo mínimo simulado 273,10; final 519,10). **Pero el detalle manda:** Liga MX aporta +216,90 con 6
apuestas a cuotas 2,77-3,67; **sin Liga MX el resultado es −97,80 sobre 22**. El t del conjunto es 0,62.
Es una buena semana, no una prueba de nada.

**3. Las dos fuentes de datos.** The Odds API cayó el sábado (clave `DEACTIVATED_KEY`, hace falta clave
nueva del plan gratis, solo Alexis puede pedirla); se instaló la puerta única `lib/odds-gate.js` para que
500 créditos/mes duren un mes. Consecuencia: NFL, college, CFL, baloncesto, tenis, combate, F1, props y
cuotas de clubes **sin cuotas nuevas desde el sábado**. Y **API-Football vence el miércoles 23-sep**: es la
fuente de las estadísticas de tarjetas con las que se liquida `cards_under` — sin ella, ni la sombra ni el
canal real pueden cerrar una apuesta. Esto es lo único de esta semana que bloquea dinero de verdad.

---

## Dinero real en Cloudbet

### Desde el inicio (24-ago), que es lo que decide

| | |
|---|---:|
| Liquidadas (todos los canales) | **285** (145-124) |
| Apostado | 6.158,04 USDT |
| **P&L** | **−183,13 USDT** |
| ROI | −2,97 % |

Por canal: **tarjetas** 155 liquidadas, −116,20 (92-63) · **tenis de mesa** 60, 0,00 exacto (33-27, cerrado el
16-sep) · **CS2** 68, −66,93 (retirado el 16-sep).

Tarjetas, separado por lo que hoy sabemos que estaba mal y ya no se hace:

| cohorte | n | W-L | apostado | P&L | ROI |
|---|---:|---:|---:|---:|---:|
| apiladas (2+ líneas mismo partido y lado) | 60 | 30-30 | 2.083 | −311,72 | −14,97 % |
| ligas eficientes (lista del 13-sep) | 32 | 12-20 | 1.139 | −453,43 | −39,81 % |
| **sueltas, fuera de eficientes — la regla vigente** | **75** | **55-20** | **2.415** | **+492,75** | **+20,40 %** |

### Esta semana: la cronología, hora a hora

| UTC | qué |
|---|---|
| jue 17 15:06 | depósito 399,99 (saldo 0,008 → 399,998) |
| jue 17 15:11 | `GP_REAL_KICKOFF_MAX = 2026-09-21T08:00Z`, stake 30, veto eficientes, una por partido — desplegado |
| jue 17 15:13 | `GP_REAL_CARDS_ENABLED = true`; primer barrido descarta Rostov, QPR, Lincoln, Millwall (eficientes) |
| jue 17 15:14-17:00 | Betis–Getafe under 5,5: 13 intentos, `precio_peor` (1,49-1,51 contra mínimo 1,552); caduca al saque |
| jue 17 15:25 | suelo de caja de la parada 100 → 5 (orden de Alexis); los 49,49 previos anotados como retiro |
| jue 17 ~20:00 | **retiro de 388,37** (entre 15:06 y 23:20; confirmado el 21-sep) |
| jue 18 23:20 → lun 21 | 49 señales frenadas por `sin_fondos`; 39 descartadas por banda eficiente; 9 por `sin_ventaja`; 7 de TT por canal apagado |
| lun 21 08:00 | fin de la ventana de saque; el canal sigue encendido con 11,63 en caja |

Conciliación al cierre: depósitos 2.680,91 − retiros 2.486,15 − 183,13 realizado = **11,63 esperado; 11,63
real; diferencia 0**.

### Lo que no llegó a colocarse: el contrafactual

Las 49 señales frenadas, pasadas por la regla de una por partido (la primera nacida), son 37. Liquidadas 28.

| | |
|---|---:|
| Apuestas | 28 (15-13) |
| Apostado (a 30) | 840,00 |
| **P&L a la cuota de nacimiento** | **+119,10 USDT** |
| ROI | +14,18 % · t 0,62 |
| Con 400 en caja: cabían todas | saldo mínimo 273,10 · final 519,10 |
| Sin liquidar todavía | 9 (Atlético–Real Madrid, Villarreal–Levante, Depor–Betis, Schalke–Elversberg, Paderborn–Hoffenheim, Paranaense–Bahia, Pachuca–Tijuana, Toluca–Santos, Vélez–Tigre) |

Por liga: **Liga MX +216,90 (6)** · Serie B +44 (3) · Brasileirão +19 (7) · LaLiga +13 (3) · Brasil B −30 (1)
· Bundesliga −40 (3) · LaLiga 2 −44 (3) · Argentina −60 (2).

Tres avisos para leerlo bien:
- **Sin Liga MX: −97,80 en 22 apuestas.** Tres unders 3,5 a 3,33-3,67 hicieron la semana.
- Es P&L **a la cuota con la que nació la señal**. El ejecutor real rechaza cuando la casa ha movido el
  precio más de un 3 % (le pasó a Betis el jueves); alguna de estas 28 habría muerto igual por precio.
- Con las bandas **de hoy** (LaLiga 2 acaba de pasar a eficiente) serían 25 apuestas y +162,60: el veto
  habría quitado justo las tres que perdieron.

---

## Banco simulado de $2.000 (cuatro reglas congeladas)

| | desde el 12-ago | últimos 7 días |
|---|---:|---:|
| Liquidadas | 1.469 (698-630) | 304 (144-152) |
| Apostado | 82.389,08 | 14.429,98 |
| **P&L** | **+157,23** | **−963,93** |
| ROI | +0,2 % | **−7,4 %** |
| Banco | 2.157,23 | (el jueves estaba en 3.104,99) |

La semana se llevó casi mil del banco. Por segmento, semana 14-20 (stake plano, unidades):

| segmento | n | W-L | ROI | t | cuota |
|---|---:|---:|---:|---:|---:|
| `cards_under_v1` | 89 | 49-40 | −1,36 % | −0,13 | 1,838 |
| `corners_over_v1` | 74 | 36-38 | **−13,78 %** | −1,30 | 1,770 |
| `cs2_rounds_v1` | 72 | 27-45 | +1,94 % | 0,11 | 2,931 |
| `lol_kills_hcp_v1` | 75 | 37-38 | **−16,29 %** | −1,65 | 1,741 |

Y acumulado desde el 12-ago: cards 424 · +10,18 % (t 2,19) · corners 218 · −8,97 % · cs2 450 · +6,19 %
(Pinnacle solo: 240 · +17,92 % · t 2,17; **esta semana no nació ninguna en Pinnacle**) · lol 236 · −8,87 %.

**La cohorte que importa — cards con las reglas exactas del ejecutor** (una por partido, fuera de las 16
ligas hoy en banda eficiente):

| | n | W-L | ROI | t | cuota |
|---|---:|---:|---:|---:|---:|
| **acumulado desde 12-ago** | **198** | 126-72 | **+21,32 %** | **2,89** | 1,989 |
| semana 14-20 sep | 41 | 24-17 | +14,93 % | 0,86 | 1,967 |
| semana 7-13 sep | 36 | 20-16 | −8,47 % | −0,55 | 1,914 |
| septiembre (desde 31-ago) | 108 | 61-47 | +1,60 % | 0,17 | 1,926 |
| agosto | 90 | 65-25 | +44,98 % | 4,09 | 2,065 |

Lectura honesta: agosto sigue siendo el que sostiene el acumulado; septiembre va en +1,6 % con 108, esta
semana rebotó a +14,9 % con 41. La cuota media ha caído de 2,07 a 1,93.

---

## Tablero de ventaja: todas las familias, todos los deportes

24 familias en la vara. **Invertibles: 0.** Cerrar: 13 · muestra corta: 7 · sin cierre valorable: 3 · no
invertible: 1.

| familia | n | veredicto | ROI | t ROI | CLV | EV al cierre |
|---|---:|---|---:|---:|---:|---:|
| sombra · cs2_rounds_v1 | 455 | sin cierre valorable | +6,19 % | 1,02 | +0,93 | — |
| cs2 · RONDAS_HANDICAP · pinnacle | 412 | cerrar | +12,4 % | 1,84 | +1,04 | −4,89 % |
| cs2 · RONDAS_HANDICAP · cloudbet | 403 | cerrar | −8,3 % | −1,24 | +1,81 | −2,54 % |
| cs2 · RONDAS_HANDICAP · bovada | 317 | cerrar | +1,1 % | 0,19 | +0,14 | −5,90 % |
| cs2 · RONDAS · pinnacle | 310 | cerrar | +1,5 % | 0,20 | +0,41 | −5,79 % |
| **sombra · cards_under_v1** | 302 | sin cierre valorable | **+13,42 %** | **2,43** | −1,05 | — |
| sombra · lol_kills_hcp_v1 | 234 | cerrar | −9,7 % | −1,72 | −0,38 | — |
| lol · KILLS_HANDICAP · bovada | 228 | cerrar | −3,6 % | −0,61 | +0,03 | −6,52 % |
| cs2 · RONDAS · bovada | 193 | cerrar | −4,4 % | −0,61 | +0,37 | −5,64 % |
| sombra · corners_over_v1 | 160 | sin cierre valorable | −5,9 % | −0,81 | −0,72 | — |
| lol · KILLS_HANDICAP · pinnacle | 156 | cerrar | −6,1 % | −0,86 | −0,01 | −7,69 % |
| lol · KILLS_HANDICAP · cloudbet | 153 | cerrar | −7,5 % | −1,04 | −0,60 | −9,40 % |
| valorant · RONDAS_HANDICAP · pinnacle | 150 | cerrar | −9,8 % | −0,85 | −0,27 | −4,96 % |
| lol · KILLS · bovada | 147 | cerrar | +4,5 % | 0,47 | +1,09 | −4,74 % |
| dota2 · KILLS · bovada | 123 | cerrar | −5,4 % | −0,57 | 0,00 | −6,52 % |
| cs2 · RONDAS · cloudbet | 122 | no invertible | −4,4 % | −0,33 | +2,59 | −1,80 % |
| lol · KILLS_DNB · cloudbet | 119 | cerrar | −0,7 % | −0,11 | −1,44 | −11,83 % |
| valorant · RONDAS · pinnacle | 96 | muestra corta | +0,1 % | 0,01 | +0,29 | −6,52 % |
| cs2 · RONDAS_EQUIPO · pinnacle | 91 | muestra corta | −12,1 % | −1,10 | +1,03 | −6,28 % |
| tt · GAME_POINTS_HCP · cloudbet | 84 | muestra corta | −21,5 % | −2,11 | +0,17 | −5,95 % |
| tt · GAME_ML · cloudbet | 82 | muestra corta | −17,2 % | −1,57 | +0,20 | −8,04 % |
| tt · ML · cloudbet | 73 | muestra corta | −18,7 % | −1,83 | +0,50 | −10,01 % |
| cs2 · HANDICAP · cloudbet | 68 | muestra corta | −18,5 % | −1,13 | +26,71 | +29,38 % |
| tt · POINTS_TOTAL · cloudbet | 67 | muestra corta | −10,4 % | −0,93 | −0,17 | −6,69 % |

**Nota de método pendiente de aprobar (17-sep):** el camino del EV contra el cierre se evalúa ANTES de
preguntar si el cierre aporta. En `cs2 · RONDAS_HANDICAP · pinnacle` el cierre no predice mejor que nuestra
entrada (t 0,98) y aun así se le condena por EV al cierre. Con el orden corregido pasaría de «cerrar» a «sin
evidencia» (ROI +12,4 %, t 1,84). No cambia qué se financia; cambia la etiqueta. El arreglo está descrito y
no aplicado.

### El encogimiento, día 4,4 de 14

3.210 liquidadas nacidas después del congelado. Log-loss ponderado: crudo 0,7375 · **encogido 0,6732** ·
precio 0,6729. La encogida gana en 26 de 32 familias — pero **las tres con `c` > 0 ya no le ganan al
precio**: cs2 · RONDAS +0,00012 (nada), lol · KILLS **−0,00095**, lol · KILLS_DNB **−0,00735**. Lo que el
17-sep era «las únicas donde el modelo aporta» hoy es «empate o peor que el precio». 988 de 6.110 picks
habrían nacido con la encogida (16 %). Decisión de Alexis el ≈ 30-sep, con los tres caminos de
`docs/ENCOGIMIENTO_2026-09-16.md`; la lectura de hoy empuja hacia el camino 1.

---

## Fútbol

### Tarjetas
Arriba entero. Lo nuevo de esta semana, en una frase: la cohorte ejecutable volvió a positivo (+14,9 %, 41)
tras una semana negativa, y el contrafactual del fin de semana dio +119 con Liga MX y −98 sin ella.

### Derivadas
`corners_over_v1` −13,78 % la semana, −8,97 % acumulado (218): sigue el camino de cerrar. Las quince
derivadas de mitad (`derivadas_v2`) siguen en sombra sin lectura publicable esta semana.

### Bandas de eficiencia por liga
**16 ligas en eficiente** (eran 14 el jueves): entraron **LaLiga 2, Liga 3 y Bundesliga 2**; Bundesliga sigue
en intermedia. Cada cambio de banda cambia la cohorte ejecutable, y por eso el contrafactual se da con las
dos listas.

### Fuentes
El archivo de resultados de clubes sigue sano (ESPN día a día + API-Football). **API-Football vence el
23-sep.** Sin ella no hay conteo de tarjetas: la sombra no liquida y el canal real no cierra apuestas. Es la
renovación más urgente de todas las que hay sobre la mesa.

---

## Esports

- **CS2** (`cs2_rounds_v1`): 72 esta semana, +1,94 %; 450 acumulado, +6,19 %. Pinnacle acumulado +17,92 %
  (240, t 2,17) pero **cero apuestas nuevas en Pinnacle esta semana** — toda la semana entró por Cloudbet,
  que acumula −11 %. Hay que mirar por qué el feed de Pinnacle dejó de producir.
- **LoL** (`lol_kills_hcp_v1`): −16,29 % la semana (75), −8,87 % acumulado (236). La vara dice cerrar. Y en
  el encogimiento, las dos familias de kills que tenían `c` > 0 ya van por debajo del precio.
- **Valorant / Dota 2:** todas las familias «cerrar» o «muestra corta», ROI negativo en todas.
- Props de CS2 en Underdog: retiradas (C5) — la tabla de pagos no se pudo verificar.

## Tenis
Sin cierre valorable por construcción (el cierre se guarda como mejor cuota entre casas), y desde el
sábado sin cuotas nuevas (The Odds API). La sombra queda congelada donde estaba.

## Baloncesto
Picks apagadas por doctrina; value/arb/caídas/middles dependen de cuotas entre casas que vienen de The
Odds API: **congelado desde el sábado**. La sonda `/api/internal/hoops` no existe con ese nombre.

## Fútbol americano
- **College (NCAAF):** 608 liquidadas, ROI +9,08 %, CLV suelto +4,34 %. TOTAL: 217, acierto 62,2 %, +47,29
  u. **La parte ejecutable — Cloudbet, misma línea:** 86 apuestas, acierto 62,8 %, **ROI +16,73 %, t 1,73,
  IC 95 % [−2,3 · +35,7] %**; CLV contra la misma casa **−1,23 %** (n 46). SPREAD en Cloudbet: 99, +18,98 %.
  Sigue siendo lo más prometedor del tablero y sigue sin cruzar t 2. La instrumentación «nacer solo al
  precio de Cloudbet» sigue pendiente.
- **NFL:** 72 liquidadas, todo en sombra. **CFL:** 106.
- Desde el sábado, `books: 0` — sin cuotas nuevas hasta que haya clave de The Odds API.

## Combate
Pool 14 eventos / 75 peleas (UFC). Las cuotas venían de The Odds API: congelado. La agenda persiste.

## F1 y Dardos · Tenis de mesa
- F1 en `PRE_QUALI`, sin señales.
- Dardos: sombra viva (Pinnacle/Bovada/Cloudbet directo, no depende de The Odds API).
- Tenis de mesa: canal real cerrado el 16-sep en 0,00 exacto; en la vara las cuatro familias de TT tienen
  ROI −10 a −21 % con muestra corta. Nada que reabrir.

## Polymarket y prop firm
Sombra de Polymarket (banco 2.000 desde el 12-ago): equity **1.311,39**, P&L **−687,27 (ROI −5,78 %)**,
182-267, comisiones 54,78. Por familia: `fútbol · No` 129 · +0,21 % · t 0,06 (C1, sin nada); `cs2 · home`
−12,1 %; `cs2 · away` −5,8 %; `fútbol · Yes` −17,0 %. La prop firm no tiene señales de modelo (0). La
sonda `propfirm` publica además un bloque propio con 570 señales, 96-110 y +1.783,58 en papel que **no cuadra
con la sombra**; hay que ver qué mide antes de citarlo.

---

## Físicas, afiliados, costes y plataforma

| | estado |
|---|---|
| Plataforma | `/api/health` 200, versión `63c9311`; Render Starter |
| Libro de hashes | 5 asientos, cadena verifica (3 interruptores, 2 decisiones) |
| Parada | VERDE, ninguna línea salta; suelo de caja 5 |
| LLM | 15,91 de 20 USD (79,6 %), 0,53/día, 45 llamadas hoy |
| Observación de prensa | 243 señales vivas (amfoot 161, tenis 46, esports 28, hoops 8) |
| **The Odds API** | **clave desactivada**; puerta única activa (16 créditos/día, reserva 60); hoy 500 llamadas cortadas sin coste, 116 gratis |
| **API-Football** | **vence el 23-sep** — bloquea la liquidación de tarjetas |
| Rotaciones pendientes (manos de Alexis) | clave de Render, token de Hetzner, `GP_REAL_RELAY_TOKEN`, `API_FOOTBALL_KEY` |

---

## Decisiones que quedan, en orden

1. **Renovar API-Football antes del miércoles 23.** Sin esto no se liquida ninguna tarjeta, ni en papel ni
   con dinero.
2. **Clave gratis de The Odds API** (alta por correo; ponerla en Render). Hasta entonces, siete sombras
   congeladas.
3. **¿Se vuelve a depositar y se abre otra ventana?** El canal está encendido con 11,63. Los números para
   decidir están arriba: +21,3 % acumulado (t 2,89) en la cohorte ejecutable, +1,6 % en septiembre, +14,9 %
   esta semana, y un fin de semana contrafactual de +119 que sin Liga MX es −98.
4. **30-sep, encogimiento:** la lectura del día 4 dice que las tres familias con `c` > 0 ya no baten al precio.
5. **Orden de la vara** (EV al cierre detrás de «¿aporta el cierre?»): descrito, no aplicado.
6. **College totals solo a precio de Cloudbet**: instrumentación pendiente; a 86 con t 1,73.
