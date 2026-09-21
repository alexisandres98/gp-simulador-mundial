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
