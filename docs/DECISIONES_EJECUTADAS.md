# Registro de decisiones ejecutadas

Cada fila es un cambio que **ya está aplicado en producción**, con su fecha, quién lo ordenó, qué se tocó y
cómo se revierte. Existe porque un interruptor cambiado sin registro es indistinguible de un accidente seis
semanas después, y porque el track se lee por cohortes: sin la fecha exacta del cambio no se sabe qué parte
de la muestra corresponde a qué regla.

---

## 16-sep-2026 — Fase B2 del plan de rentabilidad

Ordenadas en `docs/PLAN_RENTABILIDAD_2026-09-16.md` §1.2 (R1, R2) y §1.1 (M9). El plan autoriza
expresamente a la sesión ejecutora a cambiar estos interruptores por la API de Render y desplegar.

| # | qué | antes | ahora | revertir |
|---|---|---|---|---|
| **R1** | Canal REAL de tenis de mesa | `GP_REAL_TT_ENABLED=true` | **`false`** | poner `true` y desplegar |
| **M9** | Listón de TT por familia | `GP_TT_UNC_FAMILIA` sin poner | **`1`** | borrar la var y desplegar |
| **M9** | Deduplicación de equivalentes en TT | `GP_TT_DEDUP_EQUIV` sin poner | **`1`** | borrar la var y desplegar |
| **R2** | CS2 como canal real | ya `GP_REAL_CS2_ENABLED=false` | sin cambio; **retirado formalmente** | — |

Verificado después del despliegue: `/api/internal/real-tt` devuelve `resumen.canal: "apagado"`.

### El estado que deja: no queda ningún canal real encendido

| canal | interruptor | estado |
|---|---|---|
| Tarjetas under | `GP_REAL_CARDS_ENABLED=false` | apagado (pausado desde el 13-sep, fondos fuera) |
| CS2 rondas | `GP_REAL_CS2_ENABLED=false` | apagado (R2, retirado) |
| Tenis de mesa | `GP_REAL_TT_ENABLED=false` | **apagado hoy (R1)** |

`GP_REAL_ENABLED` sigue en `true`: es la llave maestra del ejecutor, no de un canal. Con los tres canales
apagados no coloca nada, y dejarla encendida mantiene vivos la conciliación y el barrido de liquidación de
lo que ya está colocado, que es justo lo que hace falta para cerrar bien las posiciones vivas.

### El número real del canal de TT, medido al cerrarlo

El plan justifica R1 con **EV al cierre −7,6 % (t −6,16)**. Al apagarlo se leyó el libro real entero, y el
resultado **realizado** es otro y conviene que conste:

| | |
|---|---|
| Apuestas liquidadas | **60** (de 71 creadas; 11 caducaron) |
| Apostado | **300 USDT** (5 planos) |
| Ganadas / perdidas | 33 / 27 |
| Cuota real media | **1,8198** |
| Acierto | **55,0 %** |
| Equilibrio a esa cuota | **55,0 %** |
| **P&L neto** | **0,00 USDT** — +135,00 en las ganadas, −135,00 en las perdidas |

Es decir: el canal quedó **exactamente en tablas**, no perdiendo. No contradice R1 y no la reabre, por dos
motivos escritos en la doctrina: el veredicto se toma con el **EV contra el cierre**, no con el ROI
realizado (§ La vara), y **60 apuestas no certifican nada** — a cuota 1,82 el intervalo del ROI con esa
muestra es de decenas de puntos. Pero un canal que se apaga con la cuenta en cero no es lo mismo que uno que
se apaga sangrando, y el registro tiene que decir cuál de los dos fue.

Los pagos vienen de la propia casa (`fuente_estado: 'graphql'`, `casa_estado` WIN/LOSS, `importe_casa_semantica: 'neto'`),
no de nuestro liquidador, así que esta cifra es dinero contado, no estimado.

### Nota sobre un campo que parece decir otra cosa

Las 60 apuestas llevan `envios: 0` y aun así están colocadas y pagadas. **No es un fallo.** `envios` no
cuenta envíos: cuenta cuántas veces hubo que **estrenar referencia nueva tras un rechazo de la casa**
(`real-executor/store.js`, la referencia solo se quema si la casa llegó a hablar). Una apuesta aceptada a la
primera tiene `envios: 0` por definición. Queda anotado aquí porque el nombre invita a leerlo mal.

---

## 16-sep-2026 (noche) — el resto del plan

| # | qué | estado |
|---|---|---|
| **M1** (B1) | Encogimiento al precio. Módulo, sonda, y **doble corrida congelada** el 16-sep 21:32 UTC con 35 familias (3 con `c` > 0, las tres con el intervalo pegado al cero). | en sombra, **el feed no cambia** |
| **M4** (B4) | `TOTALS_DAMP` por familia, rejilla ampliada a [0 · 0,25 · 0,5 · 1]. | aplicado |
| **M6** (B3) | Dardos: `calibrate()` invierte la curva de censura del leg. `GP_DARTS_CENSURA=0` revierte. Las dos aproximaciones del DP siguen apagadas **para siempre**. | aplicado |
| **M7** (B3) | LoL: recorte del reparto 0,50 → 0,30, versión `lol-gen-3`. | aplicado |
| **M8** (B3) | Tenis: `shift` apagado **solo en WTA**. En ATP bo3 no se toca porque la producción es C6 y su tabla de residuos está medida alrededor del centro desplazado. | aplicado |
| **M11** (B3) | Valorant congelado. Nada que tocar: no tiene fuente de resultados. | declarado |
| **E1-E3** | G2, G3 y G4 en código. Antes eran una lista de lo que habría que comprobar. | aplicado |
| **E4 / R5** | Libro append-only con cadena de hashes (`lib/libro.js`), conectado al fill del ejecutor real y verificado desde `/api/internal/parada`. | aplicado |

**Orden de Alexis del 16-sep:** *«no bloquees las picks en el feed»*. La doble corrida de M1 vive
enteramente en sombra y **la creación de picks no se ha tocado**: el feed sigue publicando con la
probabilidad cruda. A los 14 días la decisión de qué publicar es suya, con los tres caminos escritos en
`docs/ENCOGIMIENTO_2026-09-16.md`.

---

## 17-sep-2026 — Alexis reabre el canal real de tarjetas («Abre, deposité»)

Decisión de Alexis, tomada con el número delante y en contra de mi recomendación de ese momento. El
registro tiene que decir las dos cosas.

**Lo que se le enseñó antes de decidir** (sombra `cards_under_v1`, cohorte EXACTA del ejecutor: primera
pick por partido, fuera de las 14 ligas que el motor tiene hoy en banda eficiente):

| | n | ROI | t | cuota media |
|---|---:|---:|---:|---:|
| toda | 169 | +23,72 % | 3,09 | 1,957 |
| agosto | 90 | +44,98 % | 4,09 | 2,065 |
| **septiembre (desde 31-ago)** | **79** | **−0,49 %** | −0,05 | 1,835 |

Por semana: +44 · +47 · +44 · +7 · −5 · −15. Mi lectura escrita: «en lo que vamos a ejecutar, la ventana
ya está en cero desde hace tres semanas; no depositaría hoy». Alexis decidió abrir para comprar la
información. Es su dinero y su decisión; queda anotada como tal.

**Dos correcciones mías que precedieron a esto y que conviene que consten:**
1. El 17-sep por la mañana presenté el real de tarjetas como «−2,21 %, perdió dinero» mezclando las
   apiladas (−311,72) y las ligas eficientes (−453,43) —los dos errores ya corregidos— con la regla vigente.
   Separado bien, la cohorte limpia real es **+492,75 sobre 2.415 (+20,40 %, 75 apuestas)**.
2. Después dije «positiva las seis semanas de seis» usando una lista de ligas armada a mano (premier,
   bundesliga, mls, rusia). Con el veto REAL del ejecutor (14 ligas, championship dentro, bundesliga fuera)
   septiembre es −0,49 %. La tabla de arriba es la buena.

**Configuración con la que abre** (verificada en `/api/internal/real` tras el despliegue):

| regla | valor | cómo |
|---|---|---|
| canal | **encendido** | `GP_REAL_CARDS_ENABLED=true` (era `false` desde el 13-sep) |
| saque máximo | **lunes 21-sep 08:00 UTC** | `GP_REAL_KICKOFF_MAX=2026-09-21T08:00:00Z` (orden de Alexis) |
| ligas eficientes | vetadas | `bandas_vetadas=["eficiente"]` (14 ligas el 17-sep) |
| una por partido | activo | `linea_ya_apostada` definitivo |
| stake | **30 USDT plano** | `GP_REAL_STAKE_FLAT=30` |

**Caja:** depósito de **399,99 USDT** (saldo 0,008 → 399,998 a las 15:06 UTC), anotado con
`run=movimiento&tipo=deposito`. Queda sin explicar la diferencia previa de **−49,49** entre el saldo que
esperaba el libro (49,50) y el real (0,01); no se ha cerrado y hay que preguntarle.

**Primera pasada del ejecutor encendido:** Rostov–Dinamo (rusia), QPR–Preston y Lincoln–Swansea
(championship) descartadas como `banda_eficiente`. El veto funciona.

**Parada:** las cuatro líneas de `real-executor/parada.js` siguen corriendo cada hora. Compromiso escrito
en el chat: si la línea del núcleo cruza, se apaga el canal sin preguntar y se avisa después.

### 17-sep, 15:25 UTC — dos ajustes de Alexis tras abrir

| # | qué | antes | ahora | revertir |
|---|---|---|---|---|
| — | Suelo de la línea de parada de **caja** | `GP_PARADA_SALDO` sin poner (=100) | **`5`** | poner `100` o borrar la var, y desplegar |
| — | Los **49,49 USDT** de diferencia previa al depósito | sin explicar | **retiro de Alexis**, anotado (`tipo=retiro`) | — |

Con el retiro anotado la conciliación cierra exacta: esperado 400, real 400, diferencia 0. Con el suelo en 5,
la línea de caja ya no puede parar el canal salvo que la cuenta esté prácticamente vacía; las otras tres
líneas (núcleo, mercado, calibración) siguen igual y empiezan a aplicar a las 60 apuestas.

**Primera colocación intentada (Betis–Getafe, under 5,5):** nació a 1,60 en la sombra, Cloudbet la cotizaba
a **1,49** al reabrirla; el ejecutor la rechazó por `precio_peor` (tolerancia 3 %, mínimo 1,552) y la
reintenta cada barrido hasta el saque. No se forzó: a 1,49 la ventaja que había se la comió el movimiento.

---

## 19-sep-2026 — The Odds API cae al plan gratis; y 388 USDT que el libro no ve

### The Odds API

Orden de Alexis: «se acabó el plan, baja al gratis y activa el plan de reserva en lo que puedo pagar».
Comprobado contra la propia API: la clave responde **401 `DEACTIVATED_KEY`** («a new subscription is
required»). Bajar al gratis no es un ajuste nuestro: el plan Starter (500 créditos/mes) da una **clave nueva**
al darse de alta por correo, y eso solo lo puede hacer Alexis. Mientras tanto, y para cuando esa clave exista:

| # | qué | antes | ahora | revertir (al volver a pagar) |
|---|---|---|---|---|
| — | Puerta única de The Odds API | dos sitios con guard, veinte sin él | **`lib/odds-gate.js`** envuelve `fetch` | `SPORTSBOOK_GATE=off` |
| — | Tope diario de créditos | ninguno | **`SPORTSBOOK_DAILY_CREDITS=16`** | `0` |
| — | Reserva | 2000 (defecto) | **`SPORTSBOOK_QUOTA_RESERVE=60`** | `2000` |
| — | Barrido de cuotas de clubes | cada 12 min | **`GP_CLUBS_SWEEP_MIN=180`** | `12` |

Lo que se apaga de facto sin clave: sombras de NFL/college/CFL, baloncesto, tenis, combate, F1, props y cuotas
de clubes por The Odds API. **El canal real de tarjetas no depende de The Odds API** (Cloudbet directo) y
sigue igual. Test: `node tests/odds-gate.test.js`.

### El dinero

Al revisar el canal se vio que el saldo de Cloudbet estaba en **11,63 USDT** desde al menos el **18-sep
23:20 UTC** (primera lectura anotada por el ejecutor), contra los 399,99 del depósito del jueves. **El
ejecutor no colocó ninguna apuesta desde el jueves** (0 filas PLACED, exposición 0, 15 señales frenadas por
`sin_fondos`), no hay retiros anotados, la cuenta solo tiene USDT y un polvo de ETH, y el historial de
apuestas de la casa (GraphQL) volvió vacío. Los **388,37 USDT** salieron por un camino que el libro no ve.
Pendiente de Alexis: decir si fue un retiro o apuestas a mano, para anotarlo y cerrar la conciliación.

### 21-sep — los 388,37 eran un retiro; reporte de la semana 39

Alexis confirmó el 21-sep que sacó el dinero de Cloudbet entre el 17-sep 15:06 y el 18-sep 23:20 UTC.
Anotado como retiro (`run=movimiento`); la conciliación cierra: esperado 11,63 = real 11,63. El ejecutor no
colocó ninguna apuesta con los 400; 49 señales quedaron en `sin_fondos` hasta el cierre de la ventana del
lunes 21 08:00. El contrafactual (28 liquidadas de 37, a la cuota de nacimiento, stake 30) da **+119,10
USDT, +14,18 %, t 0,62 — y −97,80 sin las seis de Liga MX**. Reporte completo: `docs/reportes/semana-39.md`.

---

## 21-sep-2026 (tarde) — tres órdenes de Alexis

| # | qué | antes | ahora | revertir |
|---|---|---|---|---|
| 1 | **Pinnacle · CS2 hándicap de rondas vuelve al feed.** Estaba retirada desde el 15-sep por un veredicto `cerrar` que salía del EV contra el cierre en una familia donde el cierre no aporta (`cierreAporta` t 0,98). Medido con las 381 liquidadas: ROI +13,1 % (t 2,03), CLV +0,92 % (t 2,76), 4/4 semanas positivas. Pinnacle sigue publicando el mercado (comprobado en su API). | retirada → `control` | **pick** | volver a añadirla a `POR_VEREDICTO` |
| 2 | **Correos de la prop firm**: Alexis no sigue con la prop firm y no quiere más órdenes manuales por correo. | `GP_PROPFIRM_ENABLED` sin poner (=on) | **`false`** — el barrido y el correo no arrancan | borrar la var y desplegar |
| 3 | **Ventana de saque del canal de tarjetas**: «déjalo que fluya». | `GP_REAL_KICKOFF_MAX=2026-09-21T08:00Z` | **borrada** (sin ventana) | volver a ponerla |

Sin cambios: stake plano 30, banda eficiente vetada, una por partido, suelo de caja 5, sin tope de
exposición (`exposicion_max` 1.000.000). Alexis fondea Cloudbet y paga The Odds API; avisará. **Pinnacle
con dinero: todavía no** — decisión suya pendiente; la prueba de ejecución manual queda propuesta.

### 21-sep, 13:00 UTC — The Odds API reactivada (plan 5M)

Clave nueva en Render (la anterior seguía `DEACTIVATED_KEY` tras el pago: una suscripción nueva trae clave
nueva). Verificado: `x-requests-remaining` 4.999.842, 0 bloqueadas, NFL con 31 casas, college 25, CFL 6.
Presupuesto: `SPORTSBOOK_DAILY_CREDITS=0`, `SPORTSBOOK_QUOTA_RESERVE=2000`, `GP_CLUBS_SWEEP_MIN=12`. La
puerta única sigue instalada solo como contador. **La clave pasó por el chat**: Alexis la rotará más adelante.

---

## 21-sep-2026 (noche) — el feed publica picks en todos los deportes, con o sin veredicto

**La orden de Alexis, literal:** «quiero que todas esas familias publiquen picks; al final los clientes pagan
por ver picks, entonces quiero que cuando entren a un deporte se les generen picks, independientemente de si
son rentables o no. A nivel de feed quiero que sigan publicando tanto dardos como cualquier otro que esté
similar.»

**Lo que había:** tres capas dejaban un deporte sin picks aunque el motor las generara.

| capa | qué escondía | dónde |
|---|---|---|
| retiradas por veredicto (15-sep) | CS2 rondas (Bovada, Pinnacle) y hándicap de rondas (Bovada); Valorant hándicap (Pinnacle); Dota 2 kills (Bovada); **LoL kills (Bovada) y hándicap de kills (Bovada, Cloudbet)** — en LoL eso era casi todo el feed, porque kills solo lo cotiza Cloudbet; ganador de combate | `lib/retiradas.js`, `esports-engine/store.js`, `server.js` (combate) |
| ganador como familia de referencia | dardos y tenis de mesa registraban el ganador en sombra «jamás pick» | `darts-engine/store.js`, `tt-engine/store.js`, `public/premium.js` |
| monitores privados | picks de baloncesto 404 para todo el que no fuera admin; ganador de combate oculto al público (`GP_COMBAT_FIGHT_MONITOR`) | `server.js`, `public/premium.js` |

**Lo que hay:** un interruptor, `GP_FEED_SIN_VEREDICTO` (`lib/feed.js`), **encendido por defecto** y apagable
con `0`. Con él puesto las tres capas publican. Cada pick que sale por esta vía lleva `sin_veredicto: true`
y la card enseña el chip **SIN VEREDICTO** con la lectura al pasar el ratón; en esports la retirada medida
(EV, t, muestra) sigue viajando en la fila. Las picks de baloncesto se abren en lectura a pro/sharp (free
recibe candado; los POST y el rendimiento siguen siendo solo admin).

**Lo que NO cambia:** la sombra sigue marcando `benchmark` y `control` igual que antes, la vara sigue dando
su veredicto, las puertas de calidad (ventaja mínima, ruido, ortogonalidad, precio rancio, calibración,
`ventaja_explicada_por_calibracion`) siguen cerrando lo que no es una tesis, y **el ejecutor real no lee
este módulo** (test: `tests/feed.test.js`). Las retiradas por error de cálculo (`derivadas_v1`, el EV agregado
del Boleto GP) no se publican ni con el interruptor: una cifra mal calculada no es una pick sin veredicto.
El feed de fútbol de clubes no se toca: ya publica en cada visita (tarjetas under, córners, anclas de goles,
combos); abrir tarjetas over / goles no-ancla (`regime: monitor`) es una decisión aparte y queda propuesta.

**Efecto colateral que hay que saber:** al volver LoL hándicap de kills en Cloudbet, el segmento en sombra
`lol_kills_hcp_v1` vuelve a tomar apuestas de papel (llevaba congelado de facto desde el 15-sep), y
`cs2_rounds_v1` verá filas de Bovada como no ejecutables. Ninguna mueve dinero.

**Lo que sigue en manos de Alexis:** props de jugador de fútbol (`GP_PROPS_PICKS_PUBLIC`, sin poner = solo
admin) y los derechos de datos que ya estaban expuestos antes de hoy y hoy lo están un poco más: LoL
(Leaguepedia CC BY-SA; la política de Riot prohíbe funcionalidad de apuestas), tenis (Sackmann NC), dardos y
tenis de mesa (sin contrato con la fuente). Ninguno bloquea el feed por código; están escritos en los
`RIGHTS.md` de cada motor.

### 23-sep, 09:23 UTC — API-Football renovada

Alexis pagó la suscripción. Verificado contra `/status` de la propia API: plan **Ultra**, activa, vence el
**23-oct-2026 09:21 UTC**, misma clave (no hay que tocar Render), 401 llamadas ya hechas hoy con la clave en
producción. Sigue pendiente rotar esa clave por haber pasado por chat en su día.

---

## 24-sep-2026 — Polymarket: la regla `pm_v2` en sombra y tres deportes nuevos

**La orden de Alexis:** «aplica las tres reglas que sí funcionan, ajústalo, y analiza si pudiésemos agregar
otro deporte; hay que seguir probando más deportes y mercados hasta dar con el que realmente es rentable».

**De dónde sale (autopsia de la sombra v1, 450 resueltas, 1-21 sep, −5,5 % neto):** cruzar el libro cuesta
≈ 4 pp por operación (deslizamiento 1,8 pp + comisión ≈ 2,3 % del nocional) contra ventajas declaradas de
4-6 pp; el consenso proporcional infla los longshots (banda 0,30-0,40: decía 35 %, ocurrió 22 %; lo comprado
bajo 0,40 perdió 925 USD en 201); entrar a más de 2 h del saque pierde (−12 % en 175) y a menos de 2 h gana;
fútbol *Yes*, empates, LoL, hándicap de mapas y CS2 tier 3 pierden. Dentro de la misma muestra: precio ≥ 0,40
y < 2 h → 103, +17,1 %, t 1,87; fútbol *No* con eso → 60, +24,1 %, t 2,02. **Aviso:** filtros encontrados
mirando la muestra; el rendimiento real será peor. Y el precio de Polymarket predijo mejor que nuestro
consenso (Brier 0,215 contra 0,219): compramos "desviaciones" del retail que muchas veces son el retail
teniendo razón.

**Lo que hay (`propfirm/v2.js`, `propfirm/scan.js`, `propfirm/polyshadow.js`):**

| # | regla | detalle |
|---|---|---|
| 1 | Shin en fútbol | por casa y mediana entre casas (`lib/devig.js`, existía y no se usaba aquí); viaja en la señal como `consenso_shin`; el proporcional de la v1 no se toca |
| 2 | listón neto | consenso − precio − comisión − deslizamiento esperado (1 pp) ≥ 3 pp al escanear; contra el precio del fill al entrar |
| 3 | perímetro | precio 0,40-0,70 · entrar a ≤ 2 h del saque (antes espera, estado `ESPERA`) · familias: fútbol *No* (no empate), CS2 mapa/serie tier 1-2, Valorant y Dota 2 mapa/serie, tenis ML, NFL/NCAAF ML |

Dos libros: **v1 sigue congelada como control** (no ve las señales `solo_v2`) y **v2 tiene su archivo y su
banco** (`poly-sombra-v2.json`, 2.000 simulados). Sonda: `/api/internal/propfirm` → `poly_sombra.v2`;
export `picks-export?poly=2`; a demanda `run=poly_sync&libro=v2`, `run=scan&dep=tenis`.

**Deportes nuevos (solo v2):** tenis (consenso par a par de The Odds API, ≥ 3 pares; ganador del partido en
gamma, dos salidas con apellidos), Valorant y Dota 2 (mismo escáner de esports, crossBook). Inventario
medido en gamma el 24-sep: tenis 1.614 mercados / 7,4 M de liquidez, NFL 2.523 / 11,2 M, MLB 2.727 / 8,8 M,
NHL 709 / 4,5 M, UFC 1.069 / 1,5 M, Valorant 997 / 1,6 M, fútbol 2.125 / 48,6 M. **Siguientes candidatos**
con consenso propio ya en casa: UFC (motor de combate) y baloncesto (NBA arranca en octubre); sin consenso
propio hoy: MLB y NHL.

**Hallazgo colateral:** `GP_PROPFIRM_ENABLED=false` (puesto el 21-sep para cortar los correos) apagaba el
barrido entero: la sombra de Polymarket estuvo muerta del 21 al 24-sep. Desde hoy el barrido va con
`GP_PROPFIRM_SCAN` (encendido por defecto) y el correo con `GP_PROPFIRM_ENABLED`.

**Puerta para dinero:** la de siempre. 100 resueltas en v2 y t ≥ 2 con el veredicto de la vara, por deporte.
Tests: `node tests/polymarket-v2.test.js`.

---

## 24-sep-2026 (tarde) — College al dinero real: totales y hándicaps en Cloudbet, $10 planos

**La orden de Alexis, literal:** «Abre college totales y spread en Cloudbet, con stake de 10 dólares en el
ejecutor real en Cloudbet, quiero ver cómo nos va este fin de semana.» Es decisión suya sobre la regla del
dinero del 13-sep, y queda registrada como tal.

**Lo medido antes de abrir** (libro entero de la sombra, 748 filas, a precio de Cloudbet en la MISMA línea):
TOTAL 86 · 62,8 % · +16,7 % · t 1,72 (dos sábados, +23,1 % y +12,4 %; la ganancia vive en ventaja ≥ 10 pp:
+28 % en 42, tramo 6-10 pp plano) · SPREAD 99 · 62,9 % · +19,0 % · t 2,07 (un solo sábado bueno: −2,0 % y
+27,7 %). Cloudbet cotiza el 40 % de lo que genera la sombra y paga 0,08-0,09 menos de cuota que la mejor
casa. CLV contra el propio cierre de Cloudbet plano (−1,5 % / +0,6 %). Ganador: −72 %, sigue cerrado.

**Lo que hay:** `real-executor/amfoot.js`, tercer canal del ejecutor sobre el molde de tenis de mesa. Señal =
tesis OPEN de la sombra de NCAAF (TOTAL/SPREAD), evento de Cloudbet casado por el resolutor de la liga,
selección EXACTA en `american_football.totals` (`total=<línea>`) / `american_football.handicap`
(`handicap = −línea`, hándicap del local en las dos selecciones; comprobado contra el evento 36420354 y
fijado en `tests/real-amfoot.test.js` con ese evento como fixture), solo partido entero. Referencia de precio
para el deslizamiento: la cuota de Cloudbet al nacer la pick si cotizaba la misma línea; si no, la mejor del
mercado (con la tolerancia del 3 % filtrando lo que Cloudbet paga muy por debajo). Una posición por partido y
familia. Mismos frenos, libro, confirmación y liquidación por referencia que tarjetas.

| var | valor | qué hace |
|---|---|---|
| `GP_REAL_AMFOOT_ENABLED` | on (defecto) | interruptor del canal; `false` lo pausa sin tocar lo colocado |
| `GP_REAL_AMFOOT_STAKE` | 10 | stake plano; el máximo de la casa si es menor |
| `GP_REAL_AMFOOT_EDGE_MIN` | 0 | 0 = todas las tesis de la sombra; `10` = solo el tramo donde vivió la ganancia |
| `GP_REAL_AMFOOT_FAMILIAS` | TOTAL,SPREAD | familias que entran |
| `GP_REAL_AMFOOT_LIGAS` | ncaaf | ligas (NFL/CFL quedan fuera) |

Job cada 10 min (`amfootRealJob`), sonda `/api/internal/real-amfoot?key=` (`&run=1` fuerza el barrido). La
parada vigila el canal `amfoot` con su stake. **Caja:** con 191 USDT y 10 por apuesta, el suelo de 5 frena
a la 18.ª colocada; la sombra tiene 140 abiertas para la jornada 4 y Cloudbet cubre ~40 %.

### 24-sep (noche) — college en la sombra de Polymarket (v2)

Orden de Alexis: «mételos a la sombra de Polymarket y déjalo correr ahí». Medido antes: los 15 partidos con
dinero del ejecutor están en Polymarket con hándicaps y totales a medio punto, 9.000-44.000 de liquidez por
línea y 5.000-20.000 disponibles a 5 ¢ del mejor precio (Cloudbet: 270-450 por selección); 17 de nuestras 31
líneas existen exactas (las enteras no). `escanearCollegePM` (`propfirm/scan.js`) toma las MISMAS tesis
OPEN de la sombra de NCAAF (TOTAL/SPREAD), casa el partido en gamma con nombres estrictos, mapea
"Spread: X (−n)" (línea = puntos que da el local) y "O/U n", y crea señales `tipo: 'modelo_college'` con el
`p_model` de la tesis como consenso (modelo contra precio, no consenso de casas; se lee aparte en el desglose
de la v2 por deporte y familia). Solo v2, listón neto ≥ 3 pp, precio 0,40-0,70, entra a ≤ 2 h del saque.

### 26-sep (noche) — selecciones entre Mundial y Mundial

Orden de Alexis, tras enterarse de que Inglaterra–España de Nations League se jugaba sin que generáramos
nada: «Empieza. Necesito que cubramos todo y generemos pick.» El hueco era de diseño: la lista de
descubrimiento de ligas salta a propósito todo lo de selecciones (`LEAGUE_DISCOVERY_SKIP`) y el motor del
Mundial solo conoce su cuadro. Entre Mundial y Mundial no cubríamos ni un partido de selecciones.

**Lo medido antes de abrir.** Track del Mundial: 104 partidos, 69 ganadores acertados (66 %), 10 marcadores
exactos, Brier 0,494 contra 0,667 del azar; eliminatorias 81 % de 32, grupos 60 % de 72. **Contra el mercado
perdió:** en los 82 con cuota, Brier del modelo 0,455 contra 0,430 del mercado, y el modelo ganó 33 de 82.
Acertó mucho, no le sacó ventaja al precio: la misma lección de los clubes, y por eso la Nations League entra
en banda eficiente (1X2 y goles anclados al consenso) y no con la probabilidad cruda. Base propia de
selecciones (`scripts/selecciones-harvest.js`, API-Football): 3.481 partidos 2023→hoy, 1.631 con estadísticas
por partido, 1.933 con árbitro. Tarjetas por partido: Nations League UEFA 4,90 · CONCACAF NL 4,34 ·
**amistosos 2,85** (córners 8,9 · 8,9 · 8,6). Ese 2,85 es el dato que importa para tarjetas under: en
amistosos se muestra la mitad de tarjetas que en una liga; si la casa pone la línea por encima de eso,
el under lo cobra la casa, no nosotros. Hay que medirlo en la sombra, no suponerlo.

**Lo que hay.** Pool `selecciones` en `ratings.json`: 222 selecciones absolutas, 2.319 partidos, Elo desde 1500
con K=30 (doble en los seis primeros), factor de margen y cancha neutral en torneos; hfa medido 55 en el pool,
**40 en Nations League, 10 en CONCACAF NL, 60 en amistosos** (`scripts/selecciones-fit.js`; España 1884,
Argentina 1823, Francia 1787, Marruecos 1785). Tres ligas virtuales por el patrón de las copas
(`clubs-engine/cups.js`): `uefanl` (clave The Odds API), `concacafnl`, `amistososel` (solo Cloudbet).
Calendario API-Football por FECHAS en ventana FIFA (no «los próximos 25»), marcadores ESPN, alias de nombres
(Czechia / Czech Republic, FYR Macedonia / North Macedonia, Türkiye / Turkey, South Korea / Republic of Korea,
USA / United States, Rep. Of Ireland / Ireland…), Cloudbet con prioridad para las tres competiciones.
Datos por competición en el disco de clubes: `props-history-<key>.json` (214 · 126 · 383 partidos con
tarjetas) y `results-<key>.json`.

**Bandas y dinero.** `uefanl` eficiente, `concacafnl` y `amistososel` intermedia (`LEAGUE_EFF_PRIOR`), fijadas a
mano: sin prior una liga nueva cae en `blanda` y sus tarjetas under habrían entrado al dinero real el primer
día. **El dinero real queda vetado por liga** (`GP_REAL_LIGAS_VETADAS`, defecto las tres, motivo
`liga_vetada` en el libro): la sombra `cards_under_v1` las toma como a cualquier liga y la decisión de abrirlas
es de Alexis con 60 liquidadas. Lo que NO se abre: torneos a cancha neutral (Mundial, Euro, Copa América),
porque el motor no tiene sede neutral y aplicaría el hfa de la competición a todo.

Test `tests/selecciones.test.js`. Export nuevo `picks-export?mundial=1` (picks diarias del Mundial con su
liquidación) para medir familia a familia cómo fue con selecciones.
