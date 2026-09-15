# GP Simulador — Dossier de auditoría externa de modelos

**Fecha de corte:** 14 de septiembre de 2026 · **Commit del código descrito:** `056e37e` (rama `main`, gpsimulador.com en producción)
**Preparado para:** auditoría externa e independiente de los modelos predictivos, la generación de picks, la ejecución y la medición.
**Propósito:** que una auditora sin acceso al código entienda, hasta el último detalle, cómo funciona cada modelo, dónde gana, dónde pierde dinero y dónde puede haber una deficiencia corregible.

> Todo lo que aquí se afirma sale del código fuente y de los documentos versionados en el repositorio en la fecha de corte. Cada afirmación relevante cita `archivo:línea`. Donde el código no permite afirmar algo, el texto dice "no encontrado en el código". Ninguna métrica de resultados es de memoria: todas llevan su fuente (endpoint, archivo de datos o reporte semanal con fecha).

---

## 0. Si solo se lee una parte, que sea la 12

Este dossier se escribió leyendo el código línea a línea, y ese ejercicio destapó defectos que el equipo no conocía. Están reunidos en la **parte 12**, y tres de ellos condicionan la lectura de todo lo demás:

1. **El modelo de tarjetas —el único con dinero real en fútbol— casi no modela el total.** Con el amortiguador de totales en cero, el total esperado es la media de la liga; el multiplicador de árbitro está construido pero desconectado; y a la familia se le levantan las puertas de calidad que se aplican al resto. La ventaja que ganó dinero durante ocho semanas probablemente no era del modelo.
2. **El tablero de ventaja mide un CLV inflado por construcción**, comparando el mejor precio de unas 26 casas contra la mediana del cierre, y con la línea del consenso frente al precio de otra línea. Cualquier ranking de "familias prometedoras" que salga de ahí es ruido, incluido el que el equipo ha venido usando para decidir.
3. **Hay dos liquidadores defectuosos más**, sumados a los tres que ya se habían descubierto: el ganador de fútbol americano no se liquida nunca, y el canal de tenis de mesa puede duplicar posiciones en el mismo partido.

## 0.1 Cómo leer este dossier

El documento tiene doce partes. Las partes 1 a 9 describen los modelos deporte por deporte y la capa transversal de ejecución y medición; la parte 10 recoge el historial completo de resultados y métricas; la parte 11 lista los interrogantes que el propio equipo tiene abiertos y que la auditora debería priorizar.

Cada sección de modelo sigue la misma plantilla de diez puntos, para que la comparación entre deportes sea directa:

1. Propósito y alcance
2. Fuentes de datos (proveedor, endpoint, frecuencia, caché, fallback)
3. Datos históricos de calibración
4. Rating / estado del modelo (fórmulas y constantes)
5. Del rating a la probabilidad (distribución, simulación, ajustes)
6. Del modelo a la pick (umbrales, filtros, stake, casas, devig)
7. Liquidación
8. Medición (CLV, Brier, ROI, t)
9. Parámetros y variables de entorno
10. Debilidades, supuestos y riesgos visibles en el código

Tres advertencias de lectura, en orden de importancia:

- **Dinero real, sombra y backtest no se mezclan.** Solo hay dinero real en Cloudbet, en dos canales: tarjetas *under* en fútbol (`cards_under_v1`, stake plano) y total de puntos de tenis de mesa a 5 USD planos. Todo lo demás es papel: sombras con banco simulado, o backtests. En las tablas de la parte 10 cada cifra está marcada como REAL, SOMBRA o BACKTEST.
- **El ROI y el CLV, a secas, mienten.** El equipo lo aprendió a base de perder dinero y lo formalizó en la "vara" (`lib/vara.js`, `lib/margen.js`, `real-executor/parada.js`), descrita en la parte 9. Una familia solo se considera invertible si le gana al precio después de descontar el margen de la casa, con muestra suficiente; y antes de mirar el CLV hay que comprobar que el cierre de esa familia predice mejor que el precio de entrada, cosa que en los mercados de la plataforma no ocurre en ninguna de las diez familias medidas.
- **La regla vigente del dinero (13-sep-2026):** no entra dinero nuevo en ningún sitio hasta que una familia cruce el listón escrito en `real-executor/parada.js`. El punto de decisión está fijado alrededor del 20 de octubre, cuando el núcleo limpio de tarjetas llegue a 100 apuestas liquidadas.

---

## 1. Qué es la plataforma y cómo está construida

GP Simulador nació como simulador del Mundial 2026 (Elo → Poisson → Monte Carlo de 10.000 torneos, comparado contra Polymarket y Kalshi) y creció hasta once deportes con modelos propios. Es una plataforma de *sports intelligence* en español para audiencia latinoamericana, con ~980 usuarios registrados por email, alojada en Render (un solo servicio Node), con persistencia en un único archivo `db.json` en disco persistente y un relay en Frankfurt para colocar apuestas en Cloudbet.

**Stack.** Node puro sin framework ni dependencias de npm (salvo `pg`, no usado en producción). Un único proceso `server.js` (~27.900 líneas) que contiene los trabajos programados, las rutas HTTP, la generación de picks de fútbol de clubes, el ejecutor en la sombra y buena parte de la lógica de baloncesto y combate. Los deportes más recientes viven en directorios propios (`esports-engine/`, `basketball-engine/`, `nfl-engine/`, `amfoot-engine/`, `tennis-engine/`, `tt-engine/`, `darts-engine/`, `combat-engine/`, `f1-engine/`), cada uno con su motor, su almacén (`store.js`) y sus proveedores de datos en `data-providers/`.

**Flujo general de una pick, común a todos los deportes:**

```
fuente de datos ─► rating / estado del modelo ─► probabilidad por mercado
      │                                                   │
      │                                     cuotas de una o varias casas
      │                                                   │
      └──────────────────────────────►  ventaja = p_modelo − p_mercado (sin margen)
                                                          │
                                        puertas: listón por familia, unc_pp, ligas vetadas,
                                        ventana, cuota mín/máx, una posición por partido
                                                          │
                                       ┌──────────────────┼──────────────────┐
                                    feed público      sombra (papel)      ejecutor real
                                                          │                   │
                                       cierre T−x contra la MISMA casa ─► CLV, Brier, ROI, t
                                                          │
                                            la vara: margen, CLV recortado,
                                            cierreAporta, modeloContraPrecio, parada
```

**Persistencia.** `db.json` en `/data/db.json` (disco persistente de Render). Las sombras de los deportes nuevos guardan sus propios archivos en el mismo disco (`/data/esports`, `/data/tt`, `/data/darts`, `<dbdir>/implicito/`, `props-cs2.json`, …). Los históricos de calibración viven versionados en `data/` dentro del repositorio.

**Infraestructura de ejecución.** El servidor de Render (Oregón, EE. UU.) no puede colocar apuestas en Cloudbet por geografía; lo hace a través de un relay propio en Frankfurt (`gp-relay-eu`, GraphQL de Cloudbet). Para Polymarket se construyó un brazo en Helsinki (Finlandia, jurisdicción permitida según la lista publicada por la casa), probado de punta a punta contra la casa real con una cuenta de prueba y a la espera de cuenta y fondos reales; su banco hoy es simulado.

---

## 2. Inventario de modelos y estado a la fecha de corte

| # | Deporte / dominio | Motor | Familias que cotiza | Estado del feed | Sombra | Dinero real |
|---|---|---|---|---|---|---|
| 1 | Fútbol Mundial 2026 | `engine.js` | 1X2, campeón, avance | Público (origen del producto) | — | No |
| 2 | Fútbol de clubes | `server.js` (`buildClubDailyPicks`) + `clubs-engine/` + `goal-engine/` | 1X2, totales, BTTS, córners, tarjetas, props | Público (con familias medidas como peores que el mercado, decisión abierta) | `cards_under_v1`, `corners_over_v1`, `derivadas_v1`, `derivadas_v2`, `implicito_v1` | **Sí: tarjetas under (Cloudbet)** |
| 3 | Esports CS2 | `esports-engine/cs2.js` | rondas, hándicap de rondas, rondas por equipo, total de mapas, hándicap de mapas | Admin | `cs2_rounds_v1` | Canal construido, **pausado** |
| 4 | Esports LoL | `esports-engine/lol.js` + `lol-gen.js` | kills, hándicap de kills, hándicap de mapas | Admin | `lol_kills_hcp_v1`, `lol_gen` | No |
| 5 | Esports Valorant y Dota 2 | `valorant.js`, `dota2.js` | rondas, kills, duración | Admin | sombra de la casa | No |
| 6 | Props de jugador CS2 (Underdog) | `esports-engine/props.js` | kills mapas 1-2 | Admin | `props_cs2_v1`, `props_cs2_v2` | No |
| 7 | Baloncesto (NBA/WNBA) | `basketball-engine/` | spread, total, ML, props | Picks apagadas; se publican valor/arbitraje/caídas/middles (de precio) | sombra | No |
| 8 | NFL | `nfl-engine/` | spread, total (ML cerrado por doctrina) | Admin | todas las familias | No |
| 9 | NCAAF y CFL | `amfoot-engine/` | spread, total | Admin | todas las familias | No |
| 10 | Tenis | `tennis-engine/` | ganador, hándicap de games, totales (preregistro de totales) | Pro | sombra | No |
| 11 | Tenis de mesa | `tt-engine/` | ganador, hándicap de games/puntos, total de puntos, marcador exacto | Público desde 9-sep (motor admin) | sombra | **Sí: total de puntos a 5 USD (Cloudbet)** |
| 12 | Dardos | `darts-engine/` | ganador, legs, 180s, checkout, marcador exacto | Público desde 9-sep (motor admin) | sombra | No |
| 13 | Combate (UFC, PFL, boxeo) | `combat-engine/` | ganador (favorito/perro), preregistro favorito | Público/Pro | track propio | No |
| 14 | Fórmula 1 | `f1-engine/` | duelos, "takes" | Pro | track propio | No |
| 15 | Polymarket fútbol | `polymarket/` + `propfirm/` | "Sí/No" de partido | Sombra | banco simulado 2.000 | No (brazo listo) |
| — | Capa transversal | `lib/vara.js`, `lib/margen.js`, `implied-engine/`, `real-executor/`, `metrics-engine/`, `signal-registry/` | — | — | — | — |

---

## 3. Decisiones vigentes que condicionan la lectura

Estas decisiones están escritas en `CLAUDE.md`, `HANDOFF.md` y `PROJECT_STATE.md` y son las que gobiernan el sistema a la fecha de corte. La auditora debe conocerlas porque explican por qué muchas familias con "buen ROI" no tienen dinero y por qué otras con mal resultado siguen publicándose.

1. **No entra dinero nuevo** hasta que una familia cruce el listón de `parada.js` (decisión del 13-sep tras tres días de auditoría interna). Hoy no hay una sola familia de la que se pueda decir con seguridad "mete dinero ahí".
2. **La vara** (11-13 sep): invertible = CLV recortado al 10 % menos el margen por lado > 0, con t ≥ 2 y n ≥ 100; y solo si `cierreAporta()` dice que el cierre predice mejor que la entrada. Si no, manda `modeloContraPrecio()`: ¿acierta más la probabilidad del modelo que la del precio?, con el ROI medido contra las cuotas que de verdad pagaron. Márgenes medidos por lado: Pinnacle rondas-hándicap 2,21 %, Pinnacle rondas 2,83 %, Bovada kills 2,35 %, Cloudbet rondas-hándicap 3,13 %, Cloudbet TT hándicap de puntos 1,97 %, total de goles de fútbol 0,69 %.
3. **Una posición por partido y lado** en dinero real (13-sep): under 4,5 y under 5,5 del mismo partido no son dos apuestas. Las sueltas ganaban (+3,85 %), las apiladas perdían (−17,63 % con dos, −45,83 % con tres).
4. **Esperar no es fallar** (12-sep): un intento frenado por saldo o exposición no gasta reintento; el tope de reintentos se estira con las horas que faltan al saque.
5. **Veto de bandas de liga** en dinero real: `bandas_vetadas: ['eficiente']`. Llegó tarde: cuatro ligas (Premier, Bundesliga, MLS, Rusia) se clasificaron como eficientes después de apostadas y costaron −453,43 USDT. Propuesto y sin aprobar: veto por pérdida.
6. **El error de calibración entra en el listón** (13-sep): antes de abrir un mercado se mide cuánto se desvía su probabilidad contra resultados reales y ese error se suma al listón base de 3 pp (de 3,8 pp en "ambos marcan del 1T" a 8,8 pp en "total del 1T").
7. **Las cuatro correcciones acordadas del 23-ago** y la **autopsia del 2-sep**: con los libros completos, el Brier del modelo pierde contra el mercado en todas las familias salvo tarjetas y total de tenis; lo que gana, gana por precio y momento. Fórmula operativa propuesta: `p* = σ(logit(p_mkt sin margen) + c·[logit(p_gp) − logit(p_mkt)])` con `c` por familia fuera de muestra.
8. **Cinco familias con veredicto "cerrar"** siguen abiertas porque cerrarlas es cambio de lógica y no se ha ordenado: LoL kills-hándicap (Bovada t −3,42, Cloudbet t −3,52, sombra t −3,65), CS2 rondas-hándicap Cloudbet (t −3,31), TT hándicap de puntos Cloudbet (t −2,95).
9. **Segmentos de sombra congelados** (regla fija durante la ventana de medición): `cards_under_v1`, `cs2_rounds_v1`, `lol_kills_hcp_v1`, `corners_over_v1`. No se tocan sin orden.
10. **Tres liquidadores mentían** (descubierto el 2-sep): tenis liquidaba 0-0, kills sin voltear el lado, totales en cubos de 5. Antes de leer cualquier track hay que comprobar que el marcador con el que se liquidó es coherente.

---

## 4. Glosario

| Término | Significado en este sistema |
|---|---|
| **Familia** | Un tipo de mercado dentro de un deporte (p. ej. `CARDS` under, `RONDAS_HANDICAP`, `POINTS_TOTAL`). La unidad sobre la que se mide y se decide. |
| **Segmento** | Una familia con una regla de selección congelada y un nombre versionado (`cards_under_v1`). Es la unidad del paper-trading. |
| **Ventaja / edge** | `p_modelo − p_mercado`, con el mercado sin margen (devig). Se expresa en puntos porcentuales (pp). |
| **Listón** | Ventaja mínima para que nazca una pick. Base de 3 pp más el error de calibración de la familia. |
| **unc_pp** | Incertidumbre de la probabilidad del modelo por tamaño de muestra, en pp. Veredicto de puerta = 0,75 × unc; solo etiqueta, no bloquea. |
| **Devig / sin margen** | Retirada del margen de la casa de las cuotas para obtener probabilidades implícitas justas. Método por defecto multiplicativo; Shin medido en `docs/DEVIG_SHIN_MEDIDO.md`. |
| **Cierre / closing** | Última cuota disponible antes del saque, guardada en cubos T−60/−30/−10/−5/−1 minutos contra la **misma casa** de la pick. |
| **CLV** | Closing line value: cuánto mejor es la cuota tomada que la de cierre, en % de cuota o en probabilidad. `clv_exec` = CLV en la casa donde se ejecutó. |
| **CLV recortado** | Media del CLV recortando el 10 % de cada cola; evita que cierres rotos (hay un +148 % en Cloudbet) destrocen la media. |
| **Margen por lado** | Sobre-redondeo de la casa emparejando las dos caras del mismo mercado. `null` si solo hay una cara. |
| **cierreAporta** | Prueba de si el cierre predice mejor que la entrada (Brier pareado). Si no, el CLV no aplica. |
| **modeloContraPrecio** | Vara de repuesto: acierto de la probabilidad del modelo frente a la del precio, con ROI y t. |
| **Vara / veredicto** | Etiqueta por familia: `invertible`, `invertible_por_acierto`, `clv_no_aplica`, `sin_evidencia`, `cerrar`; en el tablero: confirmada (t ≥ 2), promete, plana, en contra, sin muestra. |
| **Parada** | Las cuatro líneas de `real-executor/parada.js`: percentil 1 del núcleo limpio, rodante de 100 contra `market_prob` ≤ 0 dos veces seguidas, Brier pareado con t ≤ −2, saldo < 100 USDT. Miden y avisan; no apagan. |
| **Banda de liga** | Clasificación de cada liga de fútbol por Brier del mercado: eficiente, intermedia, ineficiente/blanda. El dinero real veta las eficientes. |
| **Núcleo limpio** | Apuestas reales de tarjetas under que cumplen los filtros actuales (una posición por partido, liga no eficiente). Es la muestra sobre la que aplica la parada. |
| **Sombra** | Paper-trading con banco simulado, mismas reglas que el dinero, sin colocar. |
| **Ejecutable / no ejecutable** | Una señal es ejecutable si alguna casa conectable (`exec_books`: cloudbet, polymarket, myriad, kalshi) cotiza ese mercado en ese momento. |
| **Boleto GP** | Combinador de piernas: cuota combinada, probabilidad GP, EV y ¼ Kelly con tope del 2 %. |
| **Market-blind** | Modelo en el que ninguna cuota entra a la probabilidad (NFL, NCAAF, CFL, dardos, TT). |
| **Preregistro** | Hipótesis escrita antes de mirar los datos, con su regla y su tamaño de muestra objetivo (`docs/PREREGISTRO_*.md`). |

---

## Índice de partes

1. [Fútbol: modelo núcleo (Elo, goles, mitades, tarjetas, córners)](#parte-1-futbol-modelo-nucleo-elo-goles-mitades-tarjetas-corners)
2. [Fútbol: generación de picks, derivadas, eficiencia de ligas, tablero de ventaja](#parte-2-futbol-generacion-de-picks-derivadas-eficiencia-de-ligas-tablero-de-ventaja)
3. [Esports: motor común, CS2, Valorant y Dota 2](#parte-3-esports-motor-comun-cs2-valorant-y-dota-2)
4. [Esports: League of Legends, generador de kills y props de jugador](#parte-4-esports-league-of-legends-generador-de-kills-y-props-de-jugador)
5. [Baloncesto: posesiones, ratings, simulación, props y familias de precio](#parte-5-baloncesto-posesiones-ratings-simulacion-props-y-familias-de-precio)
6. [Fútbol americano: NFL, NCAAF y CFL](#parte-6-futbol-americano-nfl-ncaaf-y-cfl)
7. [Tenis, tenis de mesa y dardos](#parte-7-tenis-tenis-de-mesa-y-dardos)
8. [Combate (UFC, PFL, boxeo) y Fórmula 1](#parte-8-combate-ufc-pfl-boxeo-y-formula-1)
9. [Capa de ejecución y medición: sombra, ejecutor real, Polymarket y la vara](#parte-9-capa-de-ejecucion-y-medicion-sombra-ejecutor-real-polymarket-y-la-vara)
10. [Historial y métricas de todos los modelos](#parte-10-historial-y-metricas-de-todos-los-modelos)
11. [Guía para la auditora: dónde perdemos dinero y qué está abierto](#parte-11-guia-para-la-auditora-donde-perdemos-dinero-y-que-esta-abierto)
12. [Hallazgos detectados al escribir este dossier](#parte-12-hallazgos-detectados-al-escribir-este-dossier)

---

# Parte 1 · Fútbol: modelo núcleo (Elo, goles, mitades, tarjetas, córners)

**Alcance de esta sección:** el motor probabilístico de fútbol de GP Simulador de punta a punta — Elo,
conversión Elo→goles, Poisson + Dixon-Coles, Monte Carlo del torneo, modelo de goles por liga, mitades,
**tarjetas** (el único segmento con dinero real), córners, y toda la capa de calibración, de-vig y medición
que decide si una familia publica o no. Lo que se afirma aquí sale del código o de los documentos del repo;
cada punto clave lleva `archivo.js:línea`.

---

## 1.0 Mapa de piezas

| Bloque | Archivos | Qué hace |
|---|---|---|
| Núcleo Mundial | `engine.js`, `data/tournament.js`, `data/fixtures-real.json` | Elo→λ→Poisson+DC→calibración→Monte Carlo de 10.000 torneos |
| Elo de clubes | `clubs-engine/ratings.js`, `clubs-engine/cups.js`, `clubs-engine/eloOdds.js`, `server.js:6386-6514` | Rating por liga, prior por división en copas, rating paralelo alimentado con cuotas |
| Goles de clubes | `clubs-engine/goalsModel.js`, `server.js:5798` (`clubGoalsFit`) | Ataque/defensa Dixon-Coles por liga sobre xG |
| Distribución de goles | `goal-engine/distribution.js`, `markets.js`, `negativeBinomial.js`, `contextualLambdas.js` | Matriz de marcador → todos los mercados de goles |
| Mitades y censo | `goal-engine/mitades.js`, `goal-engine/descanso.js`, `futbol-derivadas.js` | 15 familias nuevas en sombra con listón por familia |
| Córners y tarjetas | `prop-engine/model.js`, `markets.js`, `calibrate.js`, `clubs-engine/referees.js` | Binomial Negativa por equipo con árbitro y paridad |
| Valoración y picks | `pick-engine/curate.js`, `server.js:8305` (`buildClubDailyPicks`) | Del modelo a la pick: umbrales, bandas, régimen |
| Liquidación | `goal-engine/settlement.js`, `server.js:9135/9245/9363` | Marcador reglamentario, push/void, fallbacks |
| Medición | `calibration/*`, `lib/devig.js`, `lib/bandas.js`, `lib/vara.js`, `lib/margen.js`, `real-executor/parada.js` | Brier, CLV recortado, margen, bandas, líneas de parada |
| Dinero real | `real-executor/store.js` (`cards_under_v1`) | Único canal con dinero de verdad en fútbol |

---

## 1.1 El núcleo del Mundial (`engine.js`)

### 1.1.1 Propósito y alcance
Simula el Mundial 2026 completo (48 selecciones, 12 grupos, 72 partidos de grupo + 32 de eliminatoria) y
produce probabilidades de campeón/final/ronda por equipo, más el 1X2 y la distribución de goles de cualquier
cruce. Es **público** (es el producto principal de la web) y **no genera dinero real**: ninguna pick con
dinero sale de aquí. Sus constantes y su matemática las **reutiliza** toda la fase de clubes
(`clubs-engine/ratings.js:3-6` lo dice explícitamente: «La conversión rating→probabilidades REUSA
engine.matchProbs (misma matemática Elo→Poisson→Dixon-Coles→calibración λ)»).

### 1.1.2 Fuentes de datos
- **Ratings iniciales:** hardcodeados en `data/tournament.js:4` — 48 objetos `{id,name,flag,elo,group,host,aliases}`
  con «Elo al 8-jun-2026 (fuentes: eloratings.net / Wikipedia)» (`data/tournament.js:1`). Ejemplo:
  `ESP 2155`, `ARG 2114`, `FRA 2062`, `QAT 1423` (`data/tournament.js:41,51,46,14`).
- **Calendario:** `data/fixtures-real.json` — array de 72 fixtures `{id,stage,group,matchday,home,away,datetime,espnId}`
  y 32 llaves de eliminatoria con resolución simbólica `{t:'W'|'R'|'T3'|'M'|'L', g, m}` (`data/tournament.js`
  exporta `TEAMS/GROUPS/GROUP_FIXTURES/KNOCKOUT`).
- **Resultados en vivo:** ESPN `site.api.espn.com/.../fifa.world/scoreboard` (declarado en `CLAUDE.md`);
  el marcador llega a `db.results[fixtureId] = {hg,ag,status,minute}`.
- **Fallo de la fuente:** si no hay resultado, el fixture simplemente se simula (`engine.js:262`: si
  `r.status==='final'` usa el marcador real, si no llama a `simMatch`). No hay degradación visible.

### 1.1.3 El rating: Elo con reglas de eloratings.net
Constantes, todas en cabecera de `engine.js:4-13`:

| Constante | Valor | Dónde | Qué hace |
|---|---|---|---|
| `HOME_BONUS` | 75 | `engine.js:4` | Elo efectivo extra para los 3 anfitriones (MEX/CAN/USA) en **todo** el torneo |
| `TOTAL_GOALS` | 2.6 | `engine.js:5` | media de goles esperada en un partido parejo |
| `K_WC` | 60 | `engine.js:6` | factor K de actualización para Copas del Mundo |
| `ELO_NOISE` | 55 | `engine.js:7` | desvío gaussiano que se suma al Elo de cada equipo **en cada torneo simulado** |
| `GOAL_FLOOR` | 0.65 | `engine.js:8` | piso de λ del equipo débil |
| `DC_RHO` | −0.13 | `engine.js:12` | corrección Dixon-Coles de marcadores bajos |
| `CALIB_LAMBDA` | 0.15 | `engine.js:70` | atenuación del 1X2 hacia uniforme |
| `RED_CARD_ELO` | 150 | `engine.js:104` | penalización de Elo por tarjeta roja en vivo |

La actualización de Elo tras un resultado final (`engine.js:356-364`):
```
we    = 1 / (1 + 10^(-((eloH+dh) − (eloA+da))/400))      // dh/da = 75 si es anfitrión
W     = 1 si gana local, 0.5 empate, 0 si pierde
G     = 1 si |margen|≤1 ; 1.5 si =2 ; (11+margen)/8 si ≥3
delta = K_WC · G · (W − we)
```
`recomputeElos()` (`server.js:1066`) **reconstruye** los Elo desde el prior de `TEAMS[].elo` replicando todos
los resultados finales en orden, para que editar o borrar un resultado no corrompa los ratings.

**Comentarios del autor que documentan recalibraciones:**
- `GOAL_FLOOR` pasó de 0.45 a 0.65 en jun-2026 «tras medir 72 partidos del Mundial: el 0.45 (calibrado vs
  Catar 2022, torneo de pocos goles) subestimaba BTTS/Over ~10pp en este torneo de alto goleo»
  (`engine.js:8-11`).
- `CALIB_LAMBDA`: «Calibración medida (jun 2026): el 1X2 estaba sobreconfiado (lo dado al 60-80% ocurría
  ~47%)» (`engine.js:68-69`). El comentario aclara que **solo afecta al 1X2 mostrado y a los edges, no al
  Elo ni al Monte Carlo**.

### 1.1.4 Del rating a los goles
`lambdas(eloH, eloA)` (`engine.js:26-31`):
```
we = 1/(1+10^(-(eloH−eloA)/400))
λh = clamp(2.6 · we^0.93,     0.65, 4.8)
λa = clamp(2.6 · (1−we)^0.93, 0.65, 4.8)
```
El exponente **0.93** y los topes 0.65/4.8 están hardcodeados sin justificación escrita en el archivo. La
autopsia señala el efecto de esta forma funcional: «la curva λ satura (dif 400 Elo → 0,687) y regala empates
y goles al perro» (`docs/AUTOPSIA_MODELOS_2026-09-02.md` §4.1).

### 1.1.5 De los goles a la probabilidad
`probsFromLambdas` (`engine.js:78-91`): rejilla Poisson 0..12 × 0..12, cada celda multiplicada por la τ de
Dixon-Coles (`engine.js:34-40`, que solo toca las cuatro celdas 0-0, 0-1, 1-0, 1-1), normalización y
atenuación `calib()`. Devuelve `{home,draw,away,xgHome,xgAway,likelyScore}`.

**En vivo** (`engine.js:119-137`): `liveProbsFromLambdas` condiciona al marcador actual simulando solo el
tiempo restante `remain = (ft − minuto)/90` con `ft=90` o 120 en prórroga, y aplica la τ **sobre el marcador
final**, no sobre los goles restantes (`engine.js:130`). `liveEventAdjustments` (`engine.js:105-114`) cuenta
rojas y devuelve deltas de Elo: −150 por la primera, ×1.7 por la segunda, tope 2 por lado. El servidor usa
además multiplicadores sobre λ en `liveGpProbs` (`server.js:~4067-4079`): `redMul = 0.70^n` para el equipo
sancionado y `oppBoost = 1 + 0.12·n` para el rival.

### 1.1.6 El Monte Carlo del torneo
`simulateTournament(elos, results, N=10000)` (`engine.js:229-353`):
- `N_SIMS = Number(process.env.SIMS || 10000)` (`server.js:83`).
- **PRNG:** LCG determinista con `seed = 42` (`engine.js:237`) — la misma semilla en cada corrida, así que dos
  ejecuciones con el mismo estado dan el mismo resultado. (`makeRng` mulberry32 en `engine.js:52` es para el
  sandbox v2, separado.)
- **Ruido de forma:** en cada torneo simulado, a cada equipo se le suma `gauss·55` de Elo
  (`engine.js:242-246`) — Box-Muller a mano.
- Grupos: se juegan los 72 fixtures; si hay resultado final se usa, si no se simula con `simMatch`
  (`engine.js:259-268`). Desempate: `cmpRows` = puntos → diferencia de goles → goles a favor → tie-break
  aleatorio congelado por torneo (`engine.js:195-197`).
- **Los 8 mejores terceros** se asignan a los slots `T3` por backtracking respetando los grupos permitidos
  (`assignThirds`, `engine.js:200-221`), con reserva greedy si no hay emparejamiento perfecto.
- Eliminatoria: empate → `penaltyWin` = `clamp(0.5 + (eloH−eloA)/4000, 0.35, 0.65)` (`engine.js:190-193`).
- Salida por equipo: `champion` con **IC al 95 % binomial** `1.96·√(p(1−p)/N)` (`engine.js:339`), probabilidad
  de cada ronda, oponentes más probables en R32 y hasta 15 «muestras» de caminos al título.
- `runSims()` (`server.js:1084`) guarda cada corrida en `db.history` (tope 1000 entradas) para la vista de
  evolución.

### 1.1.7 Replay point-in-time y métricas de calibración
`calibration/replay.js:15` reconstruye los Elo pre-partido replayando los resultados finales en orden
cronológico desde `TEAMS[].elo` (snapshot 8-jun-2026) — «para cada partido la predicción usa SOLO Elos de
partidos anteriores; el resultado real se usa únicamente para PUNTUAR» (`calibration/replay.js:3-5`). El
update de Elo se aplica **después** de registrar el record (`calibration/replay.js:36`).

Sobre esos registros, `calibration/metrics.js` calcula:
- 1X2: Brier multiclase, log-loss, **ECE** por buckets de 0.1, tasas base observadas vs predichas,
  `draw_bias`, hit-rate del favorito y segmentación por `|elo_diff|` (0-60 / 60-150 / 150+)
  (`calibration/metrics.js:25-45`).
- Goles: Brier y log-loss de O/U por línea, BTTS, **RPS/CRPS discreto** sobre el total, varianza predicha por
  la distribución vs varianza observada, hit-rate del marcador modal y top-3
  (`calibration/metrics.js:49-91`).
- `fitCalibration` busca la λ de atenuación que minimiza el log-loss en rejilla de 51 puntos sobre [0, 0.5]
  (`calibration/metrics.js:94-104`).

`calibration/validation.js` es explícitamente **conservador**: rolling out-of-sample temporal
(`validation.js:10`), leave-one-match-out (`:25`), y **shrinkage** del λ ajustado hacia el prior 0.15 con
k=30 pseudo-partidos (`validation.js:28`). Devuelve una recomendación versionada
`gp-base-calibrated-2.0.0-shadow` que **no** promueve nada, y con `n<60` escribe «MUESTRA INSUFICIENTE para
un cambio agresivo» (`validation.js:48`). **No se encontró en el código ningún resultado numérico guardado de
estas validaciones** — son funciones que se corren bajo demanda.

---

## 1.2 Elo de clubes

### 1.2.1 El fit por liga (`clubs-engine/ratings.js`)
Elo clásico secuencial, base **1500** (`ratings.js:16`), con:
- `K = 28` por defecto (`ratings.js:23`), **doblado (×2) durante los 6 primeros partidos** de cada equipo
  (`ratings.js:24,41-42`) para converger rápido desde el prior plano.
- **Ventaja de local ajustada a la liga**: `hfa` se resuelve iterativamente (4 iteraciones) moviendo
  `hfa += (obsAvg − expAvg)·700`, acotado a [0,160], hasta que |gap| < 0.002 (`ratings.js:52-60`). El
  comentario lo justifica: «cada liga tiene su localía: MLS viaja, Sudamérica pesa» (`ratings.js:12`).
- El empate cuenta 0.5 en el fit; «el 1X2 fino lo pone matchProbs, no el fit» (`ratings.js:13`).

Valores reales medidos, en `data/clubs/ratings.json` (`_meta.fitted_at = 2026-08-08`), **47 competiciones**:
hfa va de **0** (kleague, aleague) a **95** (finlandia), pasando por premier 48, laliga 85, brasileirao 79,
ligamx 49, seriea 17, suiza 17.

### 1.2.2 El gate walk-forward del 1X2
`ratings.backtest` (`ratings.js:80-141`) es walk-forward **por construcción** — el pase secuencial predice
cada partido con los ratings pre-partido — excluyendo el warm-up de ambos equipos. Inyecta
`engine.matchProbs` como `opts.probs` para medir «el modelo COMPLETO Elo→Poisson→DC→calibración, no solo el
Elo» (`ratings.js:75-77`).

**Política `clubs-gate-1`** (`ratings.js:139`): `approved` si `n ≥ 120` **y** `Brier(3-way) ≤ 0.63` **y**
`cal_err ≤ 0.06`. Referencias declaradas: uniforme 0.667, mercado típico 0.58-0.60 (`ratings.js:78`).

Estado real hoy (`data/clubs/ratings.json`): **14 de 47 ligas aprobadas** para 1X2. Ejemplos:

| Liga | n | Brier | cal_err | status |
|---|---:|---:|---:|---|
| saudi | 612 | 0.5615 | 0.0597 | approved |
| portugal | 309 | 0.5725 | 0.0532 | approved |
| bundesliga | 308 | 0.5831 | 0.0555 | approved |
| premier | 380 | 0.6213 | 0.0156 | approved |
| colombia | 228 | 0.6111 | 0.0269 | approved |
| ligamx | 194 | 0.6252 | **0.0851** | shadow |
| argentina | 303 | 0.6531 | **0.0998** | shadow |
| csl | 165 | **0.6670** | 0.0995 | shadow |
| frauen | 324 | 0.4942 | **0.1433** | shadow |

### 1.2.3 Elo dinámico en producción
- `CLUB_ELO_K = 30` (`server.js:6387`), frente a 60 del Mundial.
- `clubBaseElo` lee el fit de `ratings.json` con 1500 de reserva (`server.js:6388`).
- `db.clubElos` es un **overlay global por equipo**; `clubEloResults` lo suma al prior de copa
  (`server.js:6421`), y `applyClubElo` (`server.js:6492-6508`) aplica exactamente la misma fórmula que el
  Mundial (we logística + G por margen) con `K=30` y la `hfa` de la liga, guardando el overlay **sin** el
  prior de copa.
- `clubEloReconcileFit` (`server.js:6509`) resetea el overlay cuando cambia `_meta.fitted_at`.
- **Deuda declarada:** la autopsia dice que «el overlay en vivo (K=30 × margen) deriva un mes sin
  reconciliar» (`docs/AUTOPSIA_MODELOS_2026-09-02.md` §4.1, punto d).

### 1.2.4 Copas: prior por división (`clubs-engine/cups.js`)
El problema medido: antes las copas fusionaban **por referencia** los pools de Elo de las ligas de origen sin
recalibrar escalas, «un equipo de 2ª que domina su liga (Elo 1650 en su pool) se cruzaba con uno de 1ª de la
zona baja (1450 en SU pool) y el modelo le daba favorito al de 2ª»; la discrepancia modelo−mercado en copas
era el doble que en liga: **+22,0 pp cuando cruzan divisiones (n=47) vs +10,1 pp** (`cups.js:5-8`).

La solución: cada copa recibe **copias** de los ratings y a los equipos de nivel *k* se les resta
`GAP·(k−1)`, con `GAP = GP_CUP_TIER_GAP_ELO` (default **150**) declarado explícitamente como «PRIOR
DECLARADO, NO AJUSTADO: 150 Elo ≈ 70/30 a cancha neutral entre un equipo medio de 1ª y uno medio de 2ª»
(`cups.js:15-17`). El nivel lo da el orden de `from`; un elemento que es lista agrupa ligas del mismo nivel
(`cups.js:43-47`). Se cablean 12 copas (`cups.js:20-33`).

Medición del efecto (`docs/impl/futbol-REPORT.md` §4.1, 92 SOLID de copas fusionadas):

| Tramo | n | modelo−mercado GAP=0 | GAP=150 | Brier mercado / GAP=0 / GAP=150 |
|---|---:|---:|---:|---|
| Todas | 92 | +10,4 pp | **+2,8 pp** | 0,127 / 0,195 / **0,138** |
| Cruzan división | 49 | +15,7 pp | **+1,5 pp** | 0,090 / 0,185 / **0,091** |
| Misma división | 43 | +4,4 pp | +4,4 pp | 0,184 / 0,210 / 0,210 |
| DFB-Pokal | 18 | +21,7 | +1,8 | 0,080 / 0,171 / 0,079 |

### 1.2.5 El rating paralelo alimentado con cuotas (`clubs-engine/eloOdds.js`)
Idea (Wunderlich & Memmert, PLoS ONE 2018, citada en `eloOdds.js:4`): el Elo de resultados aprende de un bit
ruidoso por partido; el cierre sin margen resume mucha más información. El «resultado observado» pasa a ser
la **esperanza implícita del cierre** `p_local + ½·p_empate` con de-vig de Shin (`eloOdds.js:41-46`).

- `K_ODDS = 250` (`eloOdds.js:18`), elegido porque «cada partido cierra ≈72 % de la brecha Elo↔mercado; con
  K≥350 sobrepasa y empeora»; override `GP_CLUB_ELO_ODDS_K`.
- `K_RESULT = 30` (= `CLUB_ELO_K`), `W_HYBRID = 0.75`.
- `combinedDelta` (`eloOdds.js:65-77`) soporta modos `odds` / `hybrid` / `results` y **cae al resultado si no
  hay cierre** — «el rating nunca se queda parado».
- `regressSeason` (`eloOdds.js:81`) implementa regresión entre temporadas `elo' = mean + (1−α)(elo − mean)`.

**Resultado del backtest** (33.335 partidos, 18 divisiones, 5 temporadas, `docs/impl/elo-odds-REPORT.md` §2),
log-loss en evaluación:

| Temporada | n | Cierre (Shin) | A = resultados (producción) | B = cuotas K=250 | Δ B vs A |
|---|---:|---:|---:|---:|---|
| 2425 | 6.589 | 0,9905 | 1,0213 | **1,0032** | −0,0180, **t −7,69** |
| 2526 | 6.554 | 0,9967 | 1,0243 | **1,0095** | −0,0148, **t −6,03** |

Veredicto del propio informe: sí bate al Elo de resultados, pero **ninguna variante se acerca al cierre**
(B queda a +0,013, t 7-8), y de esa distancia «+0,005 la pierde el transform `matchProbs` (calibración
λ=0,15 + Poisson) incluso con el rating implícito del propio cierre». La regla `lead` pierde bajo todos los
ratings y **más** con B: ROI −13,1 % (2425) y −27,0 % (2526).

En producción vive **apagado**: `clubElo()` solo lee el paralelo con `GP_CLUB_ELO_SOURCE=odds`
(`server.js:6427-6430`, default `results` en `eloOdds.js:98-101`). El criterio declarado para encenderlo:
`t ≤ −2` con `n ≥ 300` en `with_closing` (`docs/impl/elo-odds-REPORT.md` §4).

### 1.2.6 Simulador de temporada
`clubs-engine/seasonSim.js:10` (`projectSeason`): reconstruye el calendario restante de los **resultados**
(round-robin, `hostEach = round(meetings/2)`), pre-calcula el 1X2 de cada fixture con `matchProbs(elo+hfa, elo)`
y corre **4.000-5.000** simulaciones (`server.js:5856` pasa `sims: 5000`) → prob de campeón / top-N /
descenso, puntos y puesto esperados. Formatos no doble-RR declarados en `CLUB_MEETINGS`
(irlanda 4, finlandia/dinamarca/suiza 3, `server.js:5835`). Hay un fallback que reconstruye la tabla desde
los resultados cuando `ratings.json` quedó con la tabla de un torneo terminado (`server.js:5858-5867`).

---

## 1.3 El modelo de goles

### 1.3.1 Ataque/defensa por liga (`clubs-engine/goalsModel.js`)
**Por qué existe**, en palabras del archivo: «El goal engine base deriva los λ SOLO del Elo → predice ~51%
over en TODAS las ligas (un equipo fuerte marca más pero concede menos → el TOTAL queda ~constante), lo que
está mal: el over real va de 34% (argentina) a 64% (csl/bundesliga)» (`goalsModel.js:2-4`).

Ajuste proporcional iterativo con shrinkage:
- `TAU = 20` pseudo-partidos hacia λ neutral, `ITERS = 60`, `CLAMP = [0.25, 2.8]` (`goalsModel.js:14-16`).
- `atk[t] = clamp((golesA favor + τ·esperado_por_partido) / (esperado + τ·esperado_por_partido))`,
  idem `def` (`goalsModel.js:41-45`).
- `goalLambdas`: `λh = muH·atk[h]·def[a]·hfaScale`, `λa = muA·atk[a]·def[h]`, piso 0.15
  (`goalsModel.js:51-58`). Equipo desconocido → multiplicadores neutrales.

**Limitación declarada por el autor:** «esto ARREGLA la calibración de NIVEL (cal_err O/U 2.5 baja de ~0.13 a
~0.03) pero el SKILL de discriminación a nivel partido sigue ~0 (el total de goles es Poisson-ruidoso y el
mercado de totales es eficiente — límite fundamental). Sirve para proyecciones REALISTAS del cockpit, NO
habilita picks de goles por sí solo» (`goalsModel.js:8-11`).

### 1.3.2 De dónde salen los datos del fit
`clubGoalsFit(league)` (`server.js:5798-5830`), memo de 30 min:
1. **Preferente: xG.** Lee `props-history-<liga>.json`, exige `≥40` partidos FT, cobertura de xG `≥60 %` y
   `≥40` partidos con xG; escala xG→goles con `sumG/sumX` y fitea sobre eso. Justificación: «ÚNICO modelo de
   goles con skill positivo medido (+0.0020 walk-forward vs −0.0007 del fit sobre goles; mejor en 5/7
   ligas). Un 2-0 con suerte ya no infla al equipo» (`server.js:5803-5809`).
2. **Reserva:** fit sobre goles reales de `results-<liga>.json`.

### 1.3.3 El gate de goles por liga
`ratings.goalsBacktest` (`clubs-engine/ratings.js:149-193`): walk-forward con **re-fit cada 10 partidos** y
warm-up del **35 % de la temporada** (mínimo 40). Mide O/U 2.5 y BTTS contra el resultado y calcula el
**skill** contra el base-rate de la liga (`base_brier = p(1−p)`).

**Política `clubs-goals-gate-1`** (`ratings.js:192`): `approved` si `n ≥ 120` **y** `cal_err ≤ 0.04` **y**
`skill ≥ 0.005`. El comentario es explícito sobre por qué se pide skill y no solo calibración: «Sin skill
positivo, una pick "de valor" en O/U es ruido y sale -EV tras el margen» (`ratings.js:188-191`).

Estado real: **2 de 47 ligas aprobadas** (`suiza` skill +0.0067, `ligue2` skill +0.0068). El resto tiene
skill entre **−0.0137** (noruega) y +0.0038 (dinamarca). Es decir: **en 45 de 47 ligas el modelo de goles no
le gana a predecir siempre el porcentaje de over de la liga.**

### 1.3.4 La distribución y sus mercados (`goal-engine/distribution.js` + `markets.js`)
`distribution.js` replica **exactamente** las constantes del motor (`DC_RHO=-0.13`, `CALIB_LAMBDA=0.15`,
`distribution.js:11-12`) y construye la matriz de marcador con **truncamiento dinámico**: empieza en 10×10 y
crece de 2 en 2 hasta cubrir `targetMass = 0.9999` o llegar a `maxGoals=15` (`distribution.js:33-52`). De
ahí salen: 1X2 crudo y calibrado, distribución del total, O/U en 0.5–4.5, BTTS, totales de equipo, top-5
marcadores, e indicadores de incertidumbre (entropía normalizada, concentración top-1/top-3,
`distribution.js:111-119`).

`markets.js` añade, **sobre la misma matriz** (coherencia total, «no un modelo por mercado»,
`markets.js:10`):
- **Totales asiáticos** en `[0.5, 1.5, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 4.5]` (`markets.js:44`) con tres
  tratamientos de línea: media (binaria), entera (push → `over_fair = P(>L)/(1−P(=L))`) y cuarto (promedio de
  las dos condicionales adyacentes) (`markets.js:46-67`).
- **Margen de victoria** (`markets.js:88-104`), **marcador exacto** en rejilla 0..5 + `ANY_OTHER`
  (`markets.js:109`), **13 combinaciones** coherentes (`markets.js:121-155`).
- **Doble oportunidad, empate no válido y hándicap asiático** (líneas −2..+2 en cuartos, `markets.js:206`),
  añadidos el 20-ago con el argumento de que «NO son modelos nuevos: son la MISMA distribución de marcador
  leída por otra rendija» (`markets.js:158-161`).
- La regla que gobierna las tres: «donde el mercado DEVUELVE el dinero… la probabilidad que se compara contra
  el precio es la CONDICIONAL… Comparar una probabilidad bruta contra un precio que devuelve en el empate es
  regalarle al mercado exactamente la masa del empate, y en fútbol eso es una cuarta parte del partido»
  (`markets.js:163-167`).

### 1.3.5 Binomial Negativa y desacuerdo entre familias
`goal-engine/negativeBinomial.js` existe porque «la varianza observada (3.51) supera a la del Poisson (2.77)»
(`negativeBinomial.js:2-3`). `buildMatrixNB` usa `r = 8` por defecto (`negativeBinomial.js:31`) y
`familyDisagreement` (`:44-50`) mide la media de |Δ| entre Poisson+DC y NB en O/U 2.5, BTTS y 1X2. El archivo
declara: «Se evalúa en SHADOW contra Poisson+DC; NO sustituye el modelo oficial automáticamente». **No se
encontró en el código ningún sitio donde el NB sustituya al Poisson para goles** — sí se usa, en cambio, como
distribución base de córners y tarjetas (§1.5).

### 1.3.6 Ajuste contextual de λ
`goal-engine/contextualLambdas.js` ajusta en **log-space** con caps `maxPerFactor = 0.25` y `maxTotal = 0.45`
(`contextualLambdas.js:10`). Convención de signo documentada en `:13-16`:
`λ_home += home_attack + away_defense + tempo`. Cada factor se pondera por su `confidence ∈ [0,1]`.
`goalkeeperFactor` (`:41-51`) usa shrinkage `n/(n+20)` sobre tiros enfrentados y **devuelve impacto 0 si no
hay datos** — «El caso Cabo Verde se resuelve como CAPACIDAD GENERAL… No hardcodea ningún equipo»
(`contextualLambdas.js:4-5`).

En clubes el único ajuste contextual que llega a λ es el del observador de prensa:
`clubObserverLambdaFactor` (`server.js:7962-7993`), memo de 5 min, **clamp [0.75, 1.0]** — «una baja SOLO baja
o queda neutral. (El fit de clubes es ruidoso y suele proyectar que sacar a un titular flojo "mejora" la
generación — eso NO se muestra como boost, sería engañoso)» (`server.js:7984-7986`). Está detrás de
`GP_OBSERVER_LAMBDA`.

El **descanso** entra **solo** al 1X2: `clubRestContext` (`server.js:8280-8304`),
`c = clamp((min(dh,7) − min(da,7))·2.5, ±10)` Elo, ignorado si `|c| < 3` o si algún equipo lleva >45 días sin
jugar. La restricción es explícita: «DECISIÓN EXPLÍCITA (Alexis, 25-ago): tarjetas, córners, goles y props NO
tocan esto… La familia con dinero real (cards under) y corners over no se contaminan»
(`server.js:8276-8279`).

### 1.3.7 Valoración y gate de las picks de goles
- `goal-engine/goalValue.js` (política `goal-value-policy-shadow-1`): umbrales `strong 0.05`, `lean 0.03`,
  `watch 0.015`, **buffer conservador de 0.03 restado a la prob del modelo**, `minGroups 3`
  (`goalValue.js:11-19`). Incluye una **prueba de sensibilidad**: recalcula con λ_total ± 0.15 y, si la
  clasificación `strong` cambia, la degrada a `lean` (`goalValue.js:57-65`).
- `calibration/goalGates.js`: calibración **por familia** (TOTALS, BTTS, TEAM_TOTALS, WINNING_MARGIN) sobre
  el replay point-in-time, con push/void excluidos del scoring (`goalGates.js:41`). Gate `goal-gate-1`:
  `minSample 40`, `maxBrier 0.25`, `maxCalErr 0.06` (`goalGates.js:59-64`). `EXACT_SCORE` **siempre**
  informativo (`goalGates.js:78`).
- `goal-engine/goalPick.js` es el gate editorial, más estricto: `minEdgePp 0.04`, `minEv 0.03`,
  `minBooks 3`, `minCompleteness 0.5`, `minOddsBuffer 0.07` y **familia aprobada obligatoria** por defecto
  (`goalPick.js:13-21`). Construye la cuota mínima como `fair_odds · 1.07`.
- Todo esto vive detrás de `GP_GOAL_PICKS_ENABLED`, **default OFF** (`server.js:4562`), y persiste a
  `db.goalPicks` sin exponerse a usuarios.

---

## 1.4 Mitades y el censo de mercados (13-sep-2026)

### 1.4.1 El censo
«Cloudbet publica **43 mercados distintos** por partido de fútbol y nosotros leíamos 9. De los 34 que
faltaban, 15 los sabe valorar el motor hoy» (`futbol-derivadas.js:20-23`). Los **19 que siguen fuera** están
en `FUERA` con su motivo escrito (`futbol-derivadas.js:76-84`), y dos de esos motivos son mediciones:
- **Córners:** «los córners entre local y visitante están correlacionados NEGATIVAMENTE (**−0,249** medido) y
  sobredispersos (var/media 1,18): dos Poisson independientes no valen» (`futbol-derivadas.js:80`).
- **Tarjetas:** «las tarjetas van al revés: correlación POSITIVA (**+0,201**) y el visitante recibe más
  (cuota local 0,466)» (`futbol-derivadas.js:81`).

### 1.4.2 La medición de las mitades (`goal-engine/mitades.js`)
Base: **football-data.co.uk, 33.364 partidos con marcador al descanso, 18 divisiones, temporadas 2021-22 a
2025-26** (`mitades.js:9-10`, congelado en `MEDICION`, `mitades.js:68-80`). Tres hechos medidos:

1. **La cuota del primer tiempo es 0,446 y no se mueve.** Goles 1T 1,199 · 2T 1,489 · total 2,688. Entre las
   18 divisiones (total de 2,371 a 3,176) la cuota va de **0,431 a 0,463**, y la correlación entre lo
   goleadora que es una liga y su cuota de 1T es **0,265 con t = 1,1**, o sea ninguna (`mitades.js:12-16`).
2. **Las dos mitades son casi independientes:** correlación 1T↔2T = **0,05** (t=9,2 con 33 mil partidos, y
   el autor razona explícitamente que «por eso el t no es el criterio aquí: 0,05 no mueve un precio»,
   `mitades.js:18-21`).
3. **La ventaja local es la misma en las dos mitades:** cuota del local 0,556 (1T), 0,552 (2T), 0,554 (FT)
   (`mitades.js:22-25`).

### 1.4.3 La decisión de NO aplicar Dixon-Coles a las mitades
Se probaron ρ = −0,13, −0,065 y 0 sobre las mismas 33 mil mitades (`mitades.js:41-55`):

| Caso | ρ = −0,13 | ρ = 0 |
|---|---|---|
| 1T empate | 0,052 (−0,026) | 0,027 (−0,001) |
| 2T empate | 0,036 (−0,036) | 0,009 (−0,006) |
| 1T gana local | 0,043 (+0,011) | 0,027 (−0,001) |

«Con la corrección completa, el empate de mitad se sobrestima entre 2,6 y 3,6 puntos DE FORMA SISTEMÁTICA.
Un sesgo con signo fijo es mucho peor que una desviación por tramo: fabrica ventaja falsa siempre del mismo
lado». Sin corrección el sesgo cae a ±0,006 en los nueve casos. Por eso `RHO_MITAD = 0`
(`mitades.js:122`) y `matrizMitad` es Poisson puro (`mitades.js:123-128`).

### 1.4.4 El listón por familia — la regla nueva
Se validaron las 15 familias resolviendo λ_local y λ_visita **del cierre real de Pinnacle** (1X2 sin vig para
el reparto, O/U 2,5 sin vig para el ritmo) y comparando por tramos contra lo ocurrido. Como vara se usaron
dos familias **que ya se publican**: «gana el local» (peor tramo 0,034) y «más de 2,5 goles» (0,029) — ese es
el suelo de ruido del método (`mitades.js:27-33`, `CONTROL` en `:88`).

`ERROR_CAL` (`mitades.js:90-109`), peor desviación por tramo de cada familia:

| Familia | error | Familia | error |
|---|---:|---|---:|
| `h1_total` | 0,058 | `h2_total` | 0,039 |
| `h1_1x2` | 0,036 | `h2_1x2` | 0,022 |
| `h1_btts` | 0,008 | `h2_team_total` | 0,032 |
| `h1_team_total` | 0,044 | `h2_ah` | 0,022 |
| `h1_double_chance` | 0,036 | `htft` | 0,047 |
| `h1_draw_no_bet` | 0,025 | `exact_score` | 0,023 |
| `h1_ah` | 0,027 | `clean_sheet` | 0,045 |
| `btts` (FT, ya abierta) | 0,009 | `win_to_nil` | 0,034 |

Y la regla: `listonDe(familia, base=0.03) = base + ERROR_CAL[familia]` (`mitades.js:113-116`). «Una familia
que se desvía 5pp no puede cobrar una ventaja de 3pp, porque esos 3pp caben enteros dentro de su error»
(`mitades.js:110-112`). Es una doctrina explícitamente **general**, no solo de mitades (`CLAUDE.md`, §
`goal-engine/mitades.js`).

### 1.4.5 Las líneas que se emiten
El catálogo se fijó **mirando lo que cotiza la casa**, medido sobre 29 partidos de Cloudbet: «en las mitades
NO cotiza solo medias. Cotiza CUARTOS (total=1.25, handicap=0.25) y ENTERAS (total=1, handicap=0)»
(`mitades.js:199-203`). De ahí: totales de 1T en cuartos 0,25–3; de 2T 0,25–4; totales de equipo
[0.5,1,1.5,2,2.5,3,3.5]; hándicaps en cuartos −3..+3 (`mitades.js:205-210`). Las probabilidades justas
descuentan la devolución igual que en el partido completo (`totalJusto`, `ahJusto`, `mitades.js:169-197`).

`descansoFinal` (`mitades.js:222-236`) convoluciona las dos mitades como independientes; el error declarado:
«la peor celda (visitante ganando al descanso y al final) se desvía 2,0pp… El error tiene signo conocido: el
modelo se queda corto en las remontadas, porque asumir mitades independientes ignora que ir perdiendo cambia
cómo se juega la segunda parte» (`mitades.js:217-221`).

`idDe`/`gira` (`mitades.js:291-346`) viven en el mismo archivo a propósito: «si el id se construye en un
sitio y se gira en otro, tarde o temprano uno de los dos se queda atrás. Y girar mal no se nota — una pick
invertida paga como ganadora justo cuando pierde» (`mitades.js:287-289`).

### 1.4.6 El marcador al descanso (`goal-engine/descanso.js`)
El archivo de resultados solo guarda el final, así que el descanso se reconstruye de los `keyEvents` de ESPN
(gol = evento con `scoringPlay: true`, periodos 1 y 2; prórroga y penaltis quedan fuera solos,
`descanso.js:31-43`). **Doble puerta** antes de valer (`descanso.js:14-18`):
1. el local de ESPN tiene que resolver a nuestro local con el normalizador del sistema;
2. **los goles de las dos mitades sumados tienen que dar EXACTAMENTE el marcador final ya conocido**.

«La segunda puerta es la que de verdad protege: aunque el nombre se resolviera al revés, un marcador final
asimétrico no cuadraría y la pick se anularía» (`descanso.js:20-22`). Si falla cualquiera, devuelve `null` y
la pick se queda sin liquidar — «que es un coste de muestra, no un error de contabilidad».

### 1.4.7 Las dos reglas congeladas (`futbol-derivadas.js`)
- **`derivadas_v1`** (congelada 2026-08-20): `edge_min 0.03`, `edge_cap 0.15`, `books_min 1`, familias
  `double_chance, draw_no_bet, asian_handicap, team_total, btts` (`futbol-derivadas.js:43-51`).
- **`derivadas_v2`** (congelada 2026-09-13): `edge_base 0.03` **+ error de calibración por familia**, mismo
  cap y books, 15 familias nuevas (`futbol-derivadas.js:59-71`).
- Las dos coexisten a propósito: «Aplicarles ahora el listón por familia sería cambiar la regla a mitad de la
  ventana y tirar veinticuatro días de muestra» (`futbol-derivadas.js:38-42`). Cada pick guarda
  `rule_version`.
- **Una posición por (partido, familia)**, pero **solo en la v2**: «"menos de 1,75 en el segundo tiempo" y
  "menos de 2,0 en el segundo tiempo" no son dos apuestas… meter observaciones correlacionadas en una muestra
  que luego se juzga como si fueran independientes… infla el estadístico y la vara deja de medir»
  (`futbol-derivadas.js:159-173`). La v1 sigue apilando **y se dice**.
- El precio de mercado se saca sin vig con el lado contrario (`contrario()`, `futbol-derivadas.js:102-135`)
  o, en familias de varias vías, normalizando sobre todas sus salidas con la **masa declarada**
  `MASA_MULTIVIA = { h1_1x2:1, h2_1x2:1, htft:1, exact_score:1, h1_double_chance:2 }`
  (`futbol-derivadas.js:144`) — la doble oportunidad suma 2 porque cada resultado cae en dos de ellas.
- **Bug de origen confesado en el código:** «`twoWayNoVig` espera OBJETOS de cuota con `odds_decimal`, y aquí
  se le pasaban dos números sueltos… la función devolvía null SIEMPRE. Resultado: desde el 20-ago ninguna
  pick de esta sombra se ha valorado contra el precio sin vig — todas se compararon contra la cuota cruda»
  (`futbol-derivadas.js:99-110`). El error empujaba al lado seguro (menos picks, no peores) y la muestra se
  puede partir por `market_basis`.
- Jobs: `derivadasJob` a los 5 min del arranque y luego cada **20 min**, con throttle interno de 15 min
  (`server.js:8239-8265`). Interruptores `GP_DERIV_NUEVAS` (on) y `GP_DERIV_NUEVAS_HORAS` (48)
  (`server.js:5743-5744`).
- Liquidación: `settle` pasó a asíncrona porque las mitades necesitan ir a buscar el descanso; una búsqueda
  **por partido** (no por pick) y tope `GP_DERIV_TOPE_DESCANSOS = 30` por pasada
  (`futbol-derivadas.js:388-389`). Sin descanso **no se liquida con el marcador final** — VOID a las 72 h.
- La tabla de rendimiento (`futbol-derivadas.js:468-549`) trae una columna que casi ningún tablero tiene:
  `error_cal_pp`. «Sin ella un ROI del +8 % en una familia que se desvía 5,8 pp parece una mina, cuando lo
  único que dice es que todavía no hay con qué distinguirlo de su propio error»
  (`futbol-derivadas.js:468-471`). El veredicto lo pone `lib/vara.js`.

**Estado: TODO en sombra.** No tocan `db.clubDailyPicks` ni `curate`, no publican picks y no mueven un dólar
(`futbol-derivadas.js:8-11`, `:551` `doctrina`).

---

## 1.5 TARJETAS — la pieza con dinero real (`cards_under_v1`)

Es, según `CLAUDE.md`, el único segmento de fútbol con dinero real: **~258 USDT en Cloudbet**. Merece el
detalle más fino.

### 1.5.1 El modelo (`prop-engine/model.js`)
Diseño declarado: **Binomial Negativa a nivel equipo** con fuerzas multiplicativas for/against + shrinkage
bayesiano, multiplicador de árbitro y acople opcional al *game state* (`model.js:1-7`). «Tarjetas» = conteo
simple **amarillas + rojas** (definición del mercado estándar "total cards", `model.js:6`). Los partidos
AET/PEN se **excluyen** del ajuste porque sus stats incluyen prórroga (`model.js:7,44`).

Constantes (`model.js:37`):
```
DEFAULTS = { PRIOR_MATCHES: 4, REF_PRIOR: 14, REF_CLAMP: 0.2,
             GAME_STATE_WEIGHT: 0.5, GS_CLAMP: 0.25, TOTALS_DAMP: 0, PHASE_PRIOR: 10 }
```
- **Dispersión NB por método de momentos:** `r = μ²/(var−μ)` acotado a [2, 400]; si `var ≤ μ` devuelve el
  máximo (≈ Poisson) (`model.js:16-20`).
- **Fuerzas por equipo con shrinkage al prior de liga:** `ratio = (K·μ_liga + Σx)/(K + n)/μ_liga` con
  `K = PRIOR_MATCHES = 4` (`model.js:83-95`). Se guardan cuatro: `cornersForRatio`, `cornersAgainstRatio`,
  `cardsForRatio`, **`cardsDrawnRatio`** (las tarjetas que un equipo *provoca* en el rival).
- **Árbitro (solo tarjetas):** `shrunk = (14·μ_liga + Σcards)/(14 + n)`, multiplicador `= shrunk/μ_liga`
  **clampeado a ±20 %** (`model.js:98-103`). Justificación: «research: efecto real del árbitro ±20%; con ~2
  partidos por árbitro en un Mundial, el shrinkage evita sobreajustar».
- **Paridad del partido:** `closeMult = clamp(1.06 − 0.25·|p_home − p_away|, 0.9, 1.1)` — partido parejo sube
  tarjetas hasta +10 % (`model.js:132-136`).
- **Multiplicador de fase aprendido** (no hardcodeado): `1 + w·(media_fase/media_liga − 1)` con
  `w = n/(n+PHASE_PRIOR)` (`model.js:73-81`). El comentario da la medición del Mundial: la eliminatoria trae
  más córners (10.0 vs 8.7) y más tarjetas (**3,07 vs 2,61**) que grupos (`model.js:31-34`).
- **`TOTALS_DAMP`:** el parámetro más importante y el peor entendido. `dampTotal(rawSum, μ_liga) =
  μ_liga·(rawSum/μ_liga)^DAMP` (`model.js:145`). Con **DAMP = 0 el total del partido ES la media de la liga**
  multiplicada por árbitro, paridad y fase; las fuerzas de equipo **no entran al total**. El comentario lo
  justifica: «Los córners/tarjetas de ambos lados están negativamente correlacionados… a nivel TOTAL las
  fuerzas individuales aportan más ruido que señal. CALIBRADO POR LOO EN EL MUNDIAL 2026: el óptimo es 0…
  RE-TUNEAR con datos de clubes post-Mundial» (`model.js:24-30`).
- **Importante:** el damp aplica **solo** a la parte de fuerzas de equipo; árbitro y paridad multiplican el
  total completo (`model.js:137-138,155`).

### 1.5.2 El auto-tune de `TOTALS_DAMP` en clubes
`clubPropsFit(league)` (`server.js:6081-6112`), memo por mtime del `props-history`:
- Exige ≥20 partidos.
- **Grid-search sobre DAMP ∈ {0, 0.25, 0.5}**, eligiendo el de mejor **skill combinado** (córners + tarjetas)
  contra el baseline de liga, **solo si no empeora la calibración** (`cal_err ≤ 0.06` en ambas familias).
  Default 0 si nada mejora (`server.js:6092-6105`).
- Los números que motivaron el grid están en el comentario: «con clubes las TARJETAS ganan señal de
  equipo/árbitro (verificado: J1 +0.010, Brasileirão +0.003 con DAMP~0.5)» (`server.js:6093-6094`).
- **Riesgo declarado en la investigación de córners:** el grid elige por skill *combinado*, y el backtest de
  córners recomienda separarlos: «re-tunear `TOTALS_DAMP`/`PRIOR_MATCHES` de córners hacia K_team ≈ 40,
  DAMP 0,5 — NO se implementó» (`docs/impl/corners-ref-REPORT.md` §2, §5).

### 1.5.3 El gate LOO (`prop-engine/calibrate.js`)
Backtest **leave-one-out**: para cada partido FT se re-fitea el modelo sin ese partido y se proyecta con el
árbitro real (`calibrate.js:34-38`). Mercados evaluados: córners total 8.5 y 9.5, córners de equipo 4.5
(local y visitante), **cards total 2.5 y 3.5** (`calibrate.js:14-21`). Baseline: la media de liga constante.
Gate: `MIN_SAMPLE 40`, `MAX_BRIER 0.25`, `MAX_CAL_ERR 0.06` (`calibrate.js:11`). Se reporta
`skill_vs_baseline = brier_baseline − brier`. El gate viaja en la pick como `gate_status`
(`server.js:8590`, `clubPropsGate`).

### 1.5.4 Las cuotas: de dónde vienen y cada cuánto
- **Cloudbet** es la casa de las tarjetas: `soccer.total_bookings` (con reserva `soccer.total_cards`),
  parseado en `market-scanner/venues/cloudbet.js:131` y persistido como familia `cards_total` con ids
  `CARDS_OVER_<línea>` / `CARDS_UNDER_<línea>` (`server.js:5615-5629`). El comentario declara por qué se
  ingieren: «13-ago: los dos últimos son los mercados EJECUTABLES del ejecutor en la sombra; sin ellos la
  capacidad real es 0» (`server.js:5613-5615`).
- **Barrido:** `clubsQuotesSweep` corre a los 90 s del arranque y luego cada **10 min**
  (`server.js:27659-27660`), con throttle `GP_CLUBS_SWEEP_MIN` (default 12 min, `server.js:4769`).
- **Barrido de cercanía** (`cloudbetCercania`, `server.js:5062`): cuando hay partidos de **ligas de ventana
  corta** a menos de `GP_CERCANIA_H` (3 h) del saque, fuerza el barrido. Las ligas de ventana corta se
  **derivan del histórico** de picks CARDS-under: mediana de horas entre creación y saque ≤ 6, con ≥5 picks
  (`ligasVentanaCorta`, `server.js:5041-5060`). El motivo escrito: «la cartera se llena por defecto de las
  ligas donde no ganamos, porque son las únicas cuyo mercado está abierto cuando barremos… ese cambio de
  mezcla explica el **26 %** de la caída de ROI de las dos últimas semanas» (`server.js:5029-5032`). Suelo
  propio de 3 min (`GP_CERCANIA_MIN`). Sonda: `/api/internal/ventana-tarjetas?key=&h=`.

### 1.5.5 De la proyección a la pick
En `buildClubDailyPicks` (`server.js:8480-8532`), por evento y línea:
1. `clubPropsFit(lg)` → `project(fit, {home, away, lambdas, closeness1x2})` (`server.js:8489`). Las λ salen
   del modelo de goles de la liga, con reserva Elo; la paridad sale de `matchProbs(elo+hfa, elo)`.
   **Obsérvese que `project` se llama SIN `referee`** — el multiplicador de árbitro de tarjetas del
   prop-engine **no se usa en clubes** (confirmado también por la autopsia: «el modelo de árbitros existe y
   no se usa: `project` se llama sin `referee`», `docs/AUTOPSIA_MODELOS_2026-09-02.md` §4.2).
2. Consenso de mercado: `noVig.consensus(quotes,'over','under',{minGroups:1})` — de-vig **proporcional a dos
   lados** por casa (`goal-engine/noVig.js:9-16`), con el mínimo de grupos bajado a 1 porque «las líneas de
   córners/tarjetas de clubes hoy cotizan en 1-2 casas» (`server.js:8507-8509`).
3. Probabilidad del modelo: `nbOver(mu, r_total, line)` (`server.js:8513`), es decir NB con la dispersión de
   la liga.
4. `edgePp = modelo − mercado`; se emite una fila por lado con `bestOdds`, `bestBook`, `books`,
   `familyApproved`, `mu` y la muestra por equipo (`server.js:8522-8531`).

**Gates de `curate`** (`pick-engine/curate.js`, familia props):

| Parámetro | Valor | Línea |
|---|---|---|
| `propsMinEdgePp` | 0.04 (4 pp) | `curate.js:51` |
| `propsMinBooks` | 3 (clubes lo bajan a **1** vía `propsMinBooks:1`, `server.js:8569`) | `curate.js:52` |
| `propsOddsMin / Max` | 1.35 / 4.6 — en modo monitoreo el piso baja a **1.25** | `curate.js:53`, `:101` |
| `propsRequireFairPrice` | true, **pero desactivado por `propsMonitoringMode`** en clubes | `curate.js:54`, `:112` |
| `alphaProps` | 0.6 (confianza = 0.6·modelo + 0.4·mercado) | `curate.js:59` |

El comentario de `propsMonitoringMode` explica el trade-off: «Con córners/tarjetas hiper-eficientes casi
nunca hay precio que le gane al consenso → con el gate estricto NACEN 0 picks en 30+ partidos»
(`curate.js:107-111`).

Después, **1 pick por (evento, familia), la de mayor edge** (`server.js:8721-8723`).

### 1.5.6 Blend, stake y el gate de publicación
Sobre las picks frescas (`server.js:8823-8865`):
```
blend_prob = 0.5·modelo + 0.5·mercado          // "el modelo crudo sobreconfía ~5pp (393 picks)"
kelly      = max(0, (blend·(o−1) − (1−blend))/(o−1)) / 4
stake_pct  = clamp(kelly·100, 0.25, 3) %
```
Luego el régimen:
- Si no es **segmento público** → `monitor` (`server.js:8840`).
- **CARDS over → siempre `monitor`** (`server.js:8860`). La medición que lo decidió: «8-18 histórico, −12,6u
  (ROI −48 %) — la imagen invertida de la familia estrella. El edge de tarjetas es DIRECCIONAL: cuando el
  modelo pide "menos" gana (68 % a cuota 1,75); cuando pide "más" pierde casi la mitad de lo apostado»
  (`server.js:8856-8859`).
- Segmento público restante: `regime = 'edge'` si `(blend − mercado)·100 ≥ 2` (⇔ edge crudo ≥ 4 pp), si no
  `monitor` (`server.js:8865`). «81/82 cards-under históricas lo cumplían» (`server.js:8862`).

**Bandas de liga.** `SEGMENT_BANDS['CARDS|under'] = ['intermedia','blanda']` (`server.js:7308`): **en ligas
eficientes cards-under no se publica**. El racional: «Cards-under se validó en intermedias (n=76, +21,6 %) y
su racional (público over + líneas perezosas) aplica AÚN MÁS en blandas; en ligas eficientes el mercado de
cards también está bien puesto» (`server.js:7302-7305`). `PUBLIC_SEGMENTS` por defecto incluye
`CARDS:under` (`server.js:7249`); la validación original que lo metió: «p=0.005, +10,4 pp de selección sobre
el base-rate de liga/línea» (`server.js:7244-7245`).

### 1.5.7 Los tres frenos automáticos
1. **Stop-loss + CLV rolling** (`clubFamilyStopped`, `server.js:7325-7369`): sobre las **últimas 30
   liquidadas públicas** del segmento, se frena si `hit < break_even` **o** (solo en mercados líquidos) el
   CLV medio < 0 con ≥15 CLV. El CLV **no aplica a props**: «en props de mercados PEREZOSOS (cards/córners)
   el cierre no es autoridad — su vara es el stop-loss + la validación continua contra resultados (bug
   27-jul: el CLV −0.34 % frenaba cards-under con hit 76,7 % y validación p=0.026 aprobando)»
   (`server.js:7350-7353`). Hay override manual por env `GP_GATE_OVERRIDE_SEGMENTS`.
2. **Validación continua de cards-under** (`cardsValidationRun`, `server.js:7401-7436`): toma las **últimas
   50** CARDS-under liquidadas, calcula para cada una el base-rate histórico de su liga y línea
   (`cardsBaseRates`, `server.js:7382-7399`: los totales de tarjetas de `props-history-<liga>.json`, mínimo
   30 partidos por liga), y hace un **z-test de Poisson-binomial** con corrección de continuidad:
   `z = (obs − Σp − 0.5)/√Σp(1−p)`, `p = ½·erfc(z/√2)` (`server.js:7414-7417`, `erfc` de Abramowitz-Stegun en
   `server.js:7376`). Si **dos evaluaciones diarias seguidas** con `n≥30` dan `p > 0.5`, marca
   `db.cardsValidation.failed = true`, **saca el segmento del feed** (`server.js:7360`) y manda correo al
   admin (`server.js:7429`). Historial de 12 entradas, una por día.
3. **Banda de liga** (`lib/bandas.js`, §1.7.2): si la liga se mide como eficiente, cards-under deja de
   publicarse ahí y **el dinero real no entra** (§1.5.9).

### 1.5.8 El ejecutor en la sombra
`db.shadow` (`server.js:13792-13803`): bankroll inicial **$2.000**, un solo segmento
`cards_under_v1` — «REGLA CONGELADA: toda CARDS under que publique el motor (mismos gates internos) · stake
kelly/4 cap 1.5 % · entrada al precio de publicación». Stake: `min(0.015, kelly/4)·bankroll`, piso $5
(`server.js:13790-13791,13804-13808`).

**Precio ejecutable, no mejor precio** (corrección de Alexis, 13-ago): la sombra solo «apuesta» al precio vivo
de casas conectables por API — `GP_SHADOW_EXEC_BOOKS`, default `cloudbet,polymarket,myriad,kalshi`
(`server.js:13828`) — leído con frescura ≤60 min (`server.js:13830-13844`). Sin cuota ejecutable, la señal se
registra como **no ejecutable**, y hay tres diagnósticos tipados del porqué
(`solo_casas_no_conectables` / `cotizacion_vieja` / `mercado_no_cotizado`, `server.js:13846-13856`).
Pinnacle se evaluó y se **descartó** como casa ejecutable: cerró su API al público el 23-jul-2025
(`server.js:13818-13827`).

### 1.5.9 El ejecutor REAL (`real-executor/store.js`)
**El perímetro está en el código, no en configuración** (`store.js:39-44`):
```
SEGMENTO   = 'cards_under_v1'
FAMILIA    = 'CARDS'
LADO       = 'under'
CASA       = 'cloudbet'
MARKET_KEY = 'soccer.total_bookings'
```
«Un ejecutor de dinero real cuyo alcance se pueda ampliar poniendo una variable en un panel es un accidente
esperando a que alguien se equivoque de casilla» (`store.js:16-17`).

**Stake** (`store.js:131-146`): Kelly/4 sobre banco nocional vivo con tope `GP_REAL_STAKE_CAP_PCT` (1,5 %),
mínimo 5, máximo 45; **o plano** si `GP_REAL_STAKE_FLAT > 0` (hoy **40**, orden de Alexis del 2-sep según
`CLAUDE.md`). El autor conserva una arista de la fórmula **a propósito**: `f || C.stakePct` cae al tope con
`f = 0`, porque «Cambiarla aquí rompería la única cosa que este ejecutor existe para medir —la diferencia
entre papel y dinero sería la diferencia entre dos fórmulas» (`store.js:140-143`).

**Orden de frenos** (`store.js:201-239` + `colocar`, `store.js:452-573`):
0. **Veto de banda eficiente** — antes que nada, ni una petición a la casa (`store.js:477-480`).
   `GP_REAL_BANDAS_VETADAS` default `eficiente` (`store.js:357-362`). Medición que lo motivó: «47 liquidadas
   de papel en eficientes, 57 % de acierto con 54 % de break-even, ROI +0,4 % — ruido, no edge —, mientras
   que **26 de las 41 apuestas reales vivas (1.040 de 1.640 USDT) estaban justo ahí**»
   (`store.js:344-350`).
1. `apagado` (`GP_REAL_ENABLED`, default **false**), `sin_api_key`.
2. **Ventana de saque** `GP_REAL_KICKOFF_MAX`: bloquea también **sin saque conocido** — «una orden de no
   exponerse se cumple con el silencio, no con una suposición optimista» (`store.js:172-177`).
3. `parada_diaria` (`GP_REAL_DAY_STOP_PCT`, 6 % del nocional), `exposicion_maxima` (`GP_REAL_MAX_OPEN`, 400),
   `cuenta_restringida` (3 rechazos RESTRICTED/VERIFICATION_REQUIRED seguidos), `puerta_cerrada`
   (cortafuegos: 3 seguidos → silencio de 30 min), `sin_fondos` (suelo `GP_REAL_MIN_BALANCE` = 40).
   Saldo `null` **no** frena: «"no lo sé" no es "está vacía"» (`store.js:234-236`).
4. **Una posición por PARTIDO + LADO** (13-sep). La autopsia de las 139 liquidadas del libro real
   (`store.js:190-206`):

   | Configuración | acierto | P&L | ROI |
   |---|---:|---:|---:|
   | una sola apuesta en el partido | 62,7 % | +106,12 | **+3,85 %** |
   | partido con dos apuestas | 48,0 % | −303,72 | **−17,63 %** |
   | partido con tres o más | 33,3 % | −110,00 | **−45,83 %** |

   «En doce partidos se perdieron TODAS las apuestas apiladas a la vez: −847,65.» Revertible en caliente con
   `GP_REAL_UNA_POR_PARTIDO=off` (`store.js:332`).
5. Resolución del evento en la casa: índice del colector, y si falla, **por nombre** con cuatro condiciones
   obligatorias — los dos equipos casan, saque a ≤6 h, partido no empezado y **un solo candidato**
   (`store.js:377-397`). «Con dos, no se apuesta: dos partidos del mismo par en la misma ventana es
   exactamente el caso en el que una máquina se equivoca con toda confianza» (`store.js:383-385`).
6. Precio vivo releído de la casa, estado de la selección, **deslizamiento** máximo
   `GP_REAL_MAX_SLIP_PCT` (3 %), profundidad (`maxStake` de la casa recorta el stake y se anota
   `recorte_pct`).
7. `dry` (`GP_REAL_DRY`, default **true**) → escribe la petición exacta y no envía.

**Idempotencia:** referencia derivada de `(pick_id, nº de envío)`; el número de envío **solo sube cuando la
casa rechazó explícitamente** (`betStatus: REJECTED` con cuerpo). La causa está documentada: una doble
colocación real de 40 USDT en Parma–Monza el 5-sep, porque un «no ok» con HTTP ≥200 se trataba como rechazo
(`store.js:596-609`).

**Esperar no es fallar** (12-sep): `sin_fondos`, `exposicion_maxima` y `parada_diaria` **devuelven el
reintento** (`store.js:285`, `:506`), y el tope se estira con las horas hasta el saque:
`max(80, min(1200, ceil(horas·6)+80))` (`store.js:286-292`). Motivo: tres picks de Brasileirão se perdieron
por `demasiados_intentos` con el saque a dos y tres días de distancia.

### 1.5.10 Liquidación de tarjetas
Tres fuentes, en cascada:
1. `props-history-<liga>.json` por par de equipos y fecha ±2 días: `yellows + reds` de ambos lados
   (`server.js:9177-9187`).
2. **Fallback TSA** solo para CARDS: suma de `yc + rc` del `player-history` agrupando por `match` id, exigiendo
   filas de **ambos** equipos (`server.js:9189-9202`). Motivo: «18-jul, API-Football caído a plan Free →
   props-history congelado».
3. `settleClubPropsViaAf` (`server.js:9363-9398`), asíncrono, para finales recientes: estadísticas de
   API-Football (`yellowCards + redCards` de los dos equipos) y, si falla, overview de TheStatsAPI.
4. Sin dato a las **72 h** → `VOID` («mismo criterio honesto que PLAYER», `server.js:9174`).

Las líneas son siempre `.5` en este mercado (`prop-engine/markets.js:9`), así que **no hay push** por diseño.

### 1.5.11 Medición de tarjetas
`captureClubPicksClosing` (`server.js:9500-9575`): para CARDS/CORNERS/GOALS toma todas las cuotas de esa línea
con `observed_at ≤ kickoff + 30 min`, calcula el justo **proporcional por casa** y su mediana, y guarda
`closing = {fair_prob, odds, at, own_odds, own_book, pin_odds}` (`server.js:9558-9561`). Desde el 9-sep se
guarda además el CLV **contra la misma casa de creación** (`clv_own_pct`) y contra Pinnacle (`clv_pin_pct`)
para eliminar el sesgo de mezcla (`server.js:9568-9571`).

Los resultados medidos del libro (`docs/AUTOPSIA_MODELOS_2026-09-02.md` §2 y §4.2):

| | n | Acierto | ROI | CLV medio (t) |
|---|---:|---:|---:|---|
| Fútbol CARDS | 361 | 64,8 % | **+11,2 %** | −0,5 (**t −3,7**) |
| — unders 4,5/5,5 | 210 | 72-77 % | | |
| — overs | | | **−36 %** | |

Y el dato que hace de CARDS la excepción del sistema: en la regresión
`P(gana) = σ(a + b·logit(p_mkt) + c·[logit(p_gp) − logit(p_mkt)])`, **CARDS tiene c = 1,41 con t = 2,8** —
la única familia de fútbol donde el modelo aporta información donde discrepa
(`docs/AUTOPSIA_MODELOS_2026-09-02.md` §3). En todas las demás, `c ≤ 0,19`.

Lectura del propio documento: «el cierre de tarjetas no es eficiente (mercado fino, sesgo público al over), y
aquí el CLV no es la vara. Riesgo: los unders son también lo que gana cuando los árbitros pitan menos de la
media — vigilar la deriva por liga y por árbitro» (§4.2).

---

## 1.6 CÓRNERS

### 1.6.1 El modelo
Es el **mismo** `prop-engine/model.js` que tarjetas, con dos diferencias: no hay multiplicador de árbitro en
la rama de córners del prop-engine, y sí hay acople al *game state*:
`gs(side) = clamp((λ_side/1.4)^0.5, 0.75, 1.25)` (`model.js:121-126`) — dominio esperado en ataque → más
córners. `LEAGUE_LAMBDA = 1.4` está hardcodeada (`model.js:122`).

Líneas emitidas: total 7.5–11.5, por equipo 3.5–5.5 (`prop-engine/markets.js:7-8`).

### 1.6.2 El efecto árbitro: medido y descartado (`clubs-engine/referees.js`)
Modelo: efecto aleatorio multiplicativo con encogimiento empírico-Bayes.
`mult = (K·1 + Σ r_i)/(K + n)` con `r_i = total_i / media_liga_i` **de ese momento**, «así el efecto viaja
entre divisiones: el mismo árbitro pita en Premier y Championship» (`referees.js:5-9`).

`DEFAULTS = { REF_PRIOR: 400, REF_CLAMP: 0.05, MIN_N: 1 }` (`referees.js:20-24`). El K=400 está justificado
número a número en el comentario: «es σ²_dentro/τ²_entre del backtest sobre **11.158 partidos** (E0-E3 + SC0,
2021-2026): σ² = 11,53 córners², τ² = 0,028 → **412**. Léase bien: el árbitro explica el **0,24 %** de la
varianza residual del total de córners; con 150 partidos dirigidos el efecto encogido se queda en ~27 % de su
desvío crudo (±1 %)» (`referees.js:15-19`).

**Veredicto del backtest** (`docs/CORNERS_ARBITRO_BACKTEST.md`, walk-forward por fecha, desarrollo 2122-2223,
test 2324-2627 = 6.938 partidos, bootstrap pareado 2.000 remuestreos):

| Par | Δ MAE | t | Δ CRPS | IC 95 % | t | Δ Brier | t |
|---|---:|---:|---:|---|---:|---:|---:|
| **M1−M0** (equipos, K_team=40, DAMP=0,5) | −0,0142 | −4,08 | **−0,0114** | [−0,0154, −0,0072] | **−5,44** | −0,00149 | −4,42 |
| **M2−M1** (árbitro, K=6.428 EB) | +0,0000 | 0,44 | −0,0000 | [−0,0001, +0,0000] | −0,65 | +0,00000 | 0,02 |

Y qué costaría un prior más agresivo (test):

| K_ref | Δ CRPS (M2−M1) | t | Δ Brier | t | mult p10 / p90 |
|---:|---:|---:|---:|---:|---|
| **14** (el `REF_PRIOR` de tarjetas) | **+0,0087** | **+3,04** | +0,00158 | +3,60 | 0,960 / 1,048 |
| 40 | +0,0040 | +2,02 | +0,00081 | +2,63 | 0,971 / 1,035 |
| 100 | +0,0013 | +1,08 | +0,00033 | +1,70 | 0,981 / 1,023 |
| **400** (producción) | −0,0000 | −0,03 | +0,00004 | +0,62 | 0,993 / 1,009 |

ANOVA de efectos aleatorios sobre el residuo: **τ² = 0,028 córners² (τ = 0,17), ICC = 0,24 %**, F = 1,17,
p de permutación 0,079; fiabilidad mitad/mitad del efecto por árbitro **ρ = 0,03** (test: −0,016). Los
equipos explican el **0,9 %** de la varianza del total.

Contraste con la literatura, escrito en el documento: «Dawson/Boyko encuentran variación robusta entre
árbitros en **tarjetas**; nada de eso aparece en córners, que dependen de la posesión y el juego de ataque,
no de la interpretación del árbitro» (§1.4).

**Consecuencia en producción:** la capa está **apagada** (`GP_CORNERS_REF`, default off,
`server.js:6127`). Con ella apagada la proyección es byte-idéntica; solo se **anotan** `ref_name`,
`ref_effect`, `ref_n`, `ref_applied` en la pick de córners para medir lo mismo en las ligas LATAM cuando haya
muestra (`server.js:8494-8501`, `:8736`). **CARDS no lleva nada de esto** (`server.js:8735`). Umbral escrito
para reabrir: «ICC > 1 % con p < 0,01 en ≥2.000 partidos de una liga»
(`docs/CORNERS_ARBITRO_BACKTEST.md` §2).

El índice de árbitros (`clubRefereeIndex`, `server.js:6130-6165`) se construye de los `props-history` de
todas las ligas **∪** las picks CORNERS liquidadas con `ref_name`, con dedup por `liga|equipos|día`, y se
persiste en `<disco>/clubs/referees.json`. El nombre del árbitro llega gratis con la siembra de API-Football
(`fixture.referee`), con reserva de una llamada cacheada 6 h y **presupuesto de 200 llamadas no cacheadas al
día** (`clubRefereeFor`, `server.js:6168-6185`).

### 1.6.3 Rendimiento medido de CORNERS
`docs/AUTOPSIA_MODELOS_2026-09-02.md` §2/§4.2: **n=587, 64,4 % de acierto, ROI +0,1 %, CLV −0,05 (t −1,6)**.
El diagnóstico es demoledor y está escrito: «`TOTALS_DAMP=0` ⇒ el total proyectado es **la media de la liga**
por multiplicadores… Acierto 64 % a cuota 1,59 = breakeven exacto. El "edge" es la línea de la casa menos la
media de la liga; **la casa ya sabe la media de la liga**». Y `c = −0,17` (t −0,4).

El preregistro abierto (`docs/PREREGISTRO_CORNERS_2CASAS.md`, congelado 2-sep): etiqueta
`prereg_corners_2books = books_at_create ≥ 2` (`server.js:8778`). A favor: ROI +12,1 % (n=204, SE 6,1,
t 1,95; clúster liga×semana 2,01), exceso de +20 pp frente al nulo (p 0,0003), sobrevive la multiplicidad de
18 filtros. En contra: con el `books` de creación n=142 y +9,4 % (t 1,23), y **Liga MX** (25 overs, +59 %)
aporta 14,8 de las 24,6 unidades — sin ella +5,5 % (t 0,97). Vara primaria: **ROI a cuota de creación**, no
CLV, porque `closing.odds == best_odds` en **544/587** córners, así que el ROI a cierre «no era comprobación
independiente». Muestra objetivo ~225 picks.

---

## 1.7 Calibración, de-vig y medición transversal

### 1.7.1 De-vig
Hay **tres** métodos en uso y están deliberadamente separados (`docs/impl/futbol-REPORT.md` §3):

| Familia | Método | Dónde |
|---|---|---|
| **SOLID (1X2)** | **Shin (1993)** por casa + mediana entre casas | `lib/devig.js:22,66`; `server.js:8356` |
| GOALS | proporcional a dos lados (scanner) | `server.js:8360+` |
| **CORNERS y CARDS** | proporcional a dos lados | `goal-engine/noVig.js:9`; `server.js:8509` |
| Cierre de GOALS/CORNERS/CARDS | proporcional por casa, mediana | `server.js:9545-9550` |

`shinDevig` resuelve `z` por **bisección** en `f(z) = Σp_i(z) − 1` con
`p_i(z) = (√(z² + 4(1−z)q_i²/β) − z)/(2(1−z))`, `q_i = 1/o_i`, `β = Σq_i`, tolerancia 1e-12, 200 iteraciones
(`lib/devig.js:22-51`). Si no hay margen o no hay cambio de signo, **cae a potencia y luego a proporcional**;
nunca devuelve null con cuotas válidas.

**La medición** (`docs/DEVIG_SHIN_MEDIDO.md`, **19.850 partidos → 59.550 resultados**, 18 divisiones,
temporadas 2324-2526, cierre de Pinnacle; z medio de Shin **0,0216**):

| Tramo de cuota | n | Prop. | Shin | Real | Error prop. (pp) | Error Shin (pp) |
|---|---:|---:|---:|---:|---:|---:|
| ≤1,50 | 2.892 | 72,7 % | 74,0 % | 75,1 % | −2,47 | **−1,15** |
| 1,50-2,00 | 6.807 | 54,5 % | 55,2 % | 55,7 % | −1,18 | −0,49 |
| 2,00-2,50 | 7.523 | 42,8 % | 43,1 % | 44,1 % | −1,29 | −1,00 |
| 2,50-3,20 | 11.057 | 33,2 % | 33,2 % | 32,7 % | +0,55 | +0,53 |
| 3,20-5,00 | 23.852 | 25,6 % | 25,4 % | 25,3 % | +0,35 | +0,11 |
| 5,00-8,00 | 5.218 | 16,1 % | 15,5 % | 15,1 % | +0,99 | +0,43 |
| >8,00 | 2.201 | 8,7 % | 7,9 % | 6,4 % | +2,36 | **+1,58** |
| **Total** | 59.550 | | | | Brier 0,1972 | Brier **0,1971** |

Log-loss: proporcional 0,57919 · Shin 0,57894. Shin corrige **algo más de la mitad** del sesgo
favorito-longshot y no empeora ningún tramo, pero **no lo cierra**: por encima de 8,00 sigue +1,6 pp.

`publishableProb(p_mkt, p_gp, c) = σ(logit(p_mkt) + c·[logit(p_gp) − logit(p_mkt)])` (`lib/devig.js:92-102`)
con `c = GP_SOLID_C`, **default 0** (`server.js:8650`). Con c=0 la ventaja del régimen `lead` es **cero por
construcción** y el 1X2 no genera picks de modelo — «el Elo NO añade información al 1X2, así que lo que se
publica es el consenso Shin» (`server.js:8650-8655`). El ajuste que lo fijó: `c = −0,14 (SE 0,22)`
(`docs/BACKTESTS_FAMILIAS_2026-09-02.md` §3.1).

### 1.7.2 Bandas de eficiencia (`lib/bandas.js`)
Umbrales sobre el **Brier del consenso de mercado** en los eventos liquidados de la liga:
`eficiente < 0,230`, `blanda > 0,260`, margen de histéresis **0,005**, `N_MIN = 40` (`bandas.js:24-27`).

El fallo corregido el 5-sep está escrito: la histéresis protegía solo la banda del **prior**, así que «MLS
estaba justo ahí (0,2292 acumulado): un mal fin de semana la devolvía a intermedia —abriendo cards-under y el
dinero real— y el siguiente la sacaba otra vez» (`bandas.js:10-15`). Ahora el margen protege la banda
**actual** (`bandaConMargen`, `bandas.js:39-55`), y la primera evaluación se siembra con la regla antigua para
que el despliegue no cambie ninguna banda (`bandas.js:65`). Cada cambio queda registrado en
`db.leagueBand[liga].cambios` y en el log de ops (`server.js:7298`), «porque mueve picks y dinero real».

Priors estructurales en `LEAGUE_EFF_PRIOR` (`server.js:7268-7280`): las big-5 + championship + suecia
eficientes; MLS, Brasileirão, Argentina, Colombia, Brasil B, Liga MX intermedias; **default `blanda`** para
lo no listado.

### 1.7.3 La vara (`lib/margen.js` + `lib/vara.js`)
Es el juez común de todas las familias del sistema, y su tesis es que **ni el ROI ni el CLV a secas valen**.
- **`margen.js`**: empareja las dos caras del mismo mercado y saca `sobre_redondeo = 1/o_A + 1/o_B − 1`; el
  margen por lado es **la mediana** (no la media: «los archivos tienen capturas sueltas con una cara vieja
  que disparan el sobre-redondeo», `margen.js:82-84` del archivo = líneas 276-278 del listado) partida por 2.
  Cuidado con los hándicaps: se indexan por el **valor absoluto** de la línea (`margen.js:33`). Si solo hay
  una cara, devuelve `null` — «Un margen supuesto es peor que ninguno: haría pasar por invertible algo que no
  lo es» (`margen.js:18-20`). Márgenes medidos y citados en `CLAUDE.md`: pinnacle RONDAS_HANDICAP 2,21 %/lado,
  cloudbet 3,13 %, bovada KILLS 2,35 %, **total de goles de fútbol 0,69 %** — «el más barato = el más
  eficiente = el peor sitio para buscar ventaja».
- **`vara.js`**: CLV **recortado al 10 %** por cola (`recorta`, `vara.js:25`), serie por semana
  (`semanal`, `:42`), rodante de 100 con 8 pasos (`rodante`, `:54`), y — antes de todo eso — la pregunta de
  método: `cierreAporta` (`vara.js:77-95`) compara el Brier del **precio de entrada** contra el del
  **cierre**, pareado; si `|t| < 2`, «el CLV no mide nada en esta familia». La vara de repuesto es
  `modeloContraPrecio` (`vara.js:100-116`): ¿acierta más la probabilidad del modelo que la del precio?
  **Ahí no se resta margen**, porque el ROI ya está medido contra las cuotas que pagaron.
- **Veredicto como regla escrita** (`vara.js:123-165`), con `MIN_N = 100`, `MIN_T = 2`: `clv_no_aplica`,
  `cerrar`, `invertible_por_acierto`, `sin_evidencia`, `sin_margen_medido`, `muestra_corta`,
  `no_invertible`, `en_observacion`, `invertible`. Y el tamaño: **¼ Kelly** sobre la ventaja neta
  (`tamano`, `vara.js:169-177`).
- Según `CLAUDE.md`: «En NUESTROS mercados el cierre NO predice mejor que la entrada en ninguna familia
  (|t| < 2 en las diez)».

### 1.7.4 Las líneas de parada del dinero real (`real-executor/parada.js`)
Cuatro líneas independientes, basta que salte una; **no apaga nada**, mide y avisa (`parada.js:20-21`).
Calibradas con **Monte Carlo de 60.000 corridas** con los parámetros reales del libro (stake 30, cuota media
1,81, break-even 55,2 %) (`parada.js:7-14`):
```
con ventaja REAL de +7pp   → tras 100 apuestas: mediana +367, percentil 1 en −231
sin NINGUNA ventaja        → tras 100 apuestas: mediana  −13, percentil 5 en −448
```
| # | Línea | Métrica | Dispara |
|---|---|---|---|
| 1 | El núcleo limpio deja de pagar | P&L acumulado desde el 13-sep, solo filas sin `familia` | por debajo del percentil 1 interpolado: [60→−225, 100→−231, 150→−210, 200→−81, 300→+200] (`parada.js:30`) |
| 2 | La ventaja sobre el mercado se apaga | media de `(WIN?1:0) − market_prob` en las últimas 100 CARDS-under | ≤0 en **dos lecturas seguidas** (`parada.js:75`) |
| 3 | El precio le gana al modelo | t de Brier pareado modelo vs `1/best_odds`, n≥100 | `t ≤ −2` (`parada.js:90`) |
| 4 | La caja | saldo de Cloudbet | < `GP_PARADA_SALDO` (100) (`parada.js:98`) |

La quinta (el plazo, 15-oct) está declarada como **no automatizable** porque «depende de qué quiere Alexis
hacer con su tiempo» (`parada.js:116-117`).

---

## 1.8 Parámetros y variables de entorno (fútbol)

| Variable | Default | Efecto | Dónde |
|---|---|---|---|
| `SIMS` | 10000 | torneos Monte Carlo del Mundial | `server.js:83` |
| `GP_CLUBS_SWEEP_MIN` | 12 | throttle del barrido de cuotas de clubes (min) | `server.js:4769` |
| `GP_CERCANIA` / `GP_CERCANIA_MIN` / `GP_CERCANIA_H` | on / 3 / 3 | barrido forzado cerca del saque en ligas de ventana corta | `server.js:5063-5069` |
| `GP_CUP_TIER_GAP_ELO` | 150 | prior de Elo por división en copas | `clubs-engine/cups.js:38` |
| `GP_CLUB_ELO_SOURCE` | `results` | `odds` enciende el rating alimentado con cuotas | `clubs-engine/eloOdds.js:98` |
| `GP_CLUB_ELO_ODDS_K` / `_W` / `_MODE` | 250 / 0.75 / `odds` | parámetros del rating paralelo | `eloOdds.js:102-110` |
| `GP_SOLID_C` | 0 | peso del modelo en la prob publicable del 1X2 | `server.js:8650` |
| `GP_CORNERS_REF` / `GP_CORNERS_REF_K` | off / 400 | aplica el efecto árbitro al total de córners | `server.js:6127-6128` |
| `GP_DERIV_NUEVAS` / `_HORAS` | on / 48 | las 15 familias nuevas del censo | `server.js:5743-5744` |
| `GP_DERIV_TOPE_DESCANSOS` | 30 | descansos buscados por pasada de liquidación | `futbol-derivadas.js:389` |
| `GP_PUBLIC_SEGMENTS` | `CARDS:under,SOLID,GOALS,CORNERS,COMBO` | qué segmentos pueden llegar al feed | `server.js:7249` |
| `GP_GATE_OVERRIDE_SEGMENTS` | — | salta el stop-loss de un segmento | `server.js:7365` |
| `GP_OBSERVER_LAMBDA` | off | ajuste de λ por bajas (clamp 0.75-1.0) | `server.js:7963` |
| `GOAL_PICK_MIN_EDGE_PP` / `_EV` / `_BOOKS` / `_COMPLETENESS` / `_ODDS_BUFFER` | 0.04 / 0.03 / 3 / 0.5 / 0.07 | gate editorial de picks de goles | `goal-engine/goalPick.js:13-21` |
| `GOAL_STRONG/LEAN/WATCH_MIN_EDGE_PP` | 0.05 / 0.03 / 0.015 | clasificación de Value de goles | `goalValue.js:13-15` |
| `GOAL_CONSERVATIVE_BUFFER_PP` | 0.03 | buffer restado a la prob del modelo | `goalValue.js:16` |
| `GOAL_GATE_MIN_SAMPLE` / `_MAX_BRIER` / `_MAX_CAL_ERR` | 40 / 0.25 / 0.06 | gate por familia de goles | `calibration/goalGates.js:60-63` |
| `GP_GOAL_PICKS_ENABLED` | off | enciende picks de goles (admin) | `server.js:4562` |
| `GP_SHADOW_EXEC_BOOKS` | cloudbet,polymarket,myriad,kalshi | casas ejecutables de la sombra | `server.js:13828` |
| `GP_REAL_ENABLED` | **false** | interruptor maestro del dinero real | `store.js:54` |
| `GP_REAL_DRY` | **true** | ensayo: todo menos enviar | `store.js:57` |
| `GP_REAL_NOTIONAL` / `_STAKE_CAP_PCT` / `_STAKE_MIN` / `_MAX_STAKE` / `_STAKE_FLAT` | 2000 / 1.5 % / 5 / 45 / 0 | tamaño de apuesta | `store.js:59-66` |
| `GP_REAL_MAX_OPEN` / `_MIN_BALANCE` / `_DAY_STOP_PCT` / `_MAX_SLIP_PCT` | 400 / 40 / 6 % / 3 % | frenos | `store.js:67-71` |
| `GP_REAL_BANDAS_VETADAS` | `eficiente` | bandas donde el dinero real no entra | `store.js:357-360` |
| `GP_REAL_UNA_POR_PARTIDO` | on | una posición por partido+lado | `store.js:332` |
| `GP_REAL_KICKOFF_MAX` | — | ventana de saque (corte de exposición) | `store.js:179` |
| `GP_PARADA_DESDE` / `GP_PARADA_SALDO` | 2026-09-13 / 100 | líneas de parada | `parada.js:27,98` |
| `API_FOOTBALL_KEY` / `_HOST` / `_LEAGUE` / `_SEASON` | — / v3.football.api-sports.io / 1 / 2026 | proveedor de stats (córners, tarjetas, árbitro) | `.env.example:7-10` |

---

## 1.9 Debilidades, supuestos y riesgos observados en el código

**Del núcleo del Mundial**
1. **Semilla fija.** `simulateTournament` usa un LCG con `seed = 42` (`engine.js:237`). Dos corridas con el
   mismo estado dan idénticas probabilidades — no hay varianza de simulación visible, y el IC que se publica
   (`engine.js:339`) es binomial sobre N, no captura la incertidumbre del modelo.
2. **Constantes sin fecha ni muestra.** El exponente 0.93 y los topes [0.65, 4.8] de `lambdas`
   (`engine.js:28-29`) no tienen procedencia escrita, a diferencia de `GOAL_FLOOR` o `CUOTA_1T`. El propio
   proyecto reconoce la regla contraria en `mitades.js:65-67`: «una constante sin fecha ni muestra es una
   opinión con aspecto de número».
3. **`ELO_NOISE = 55` fijo para todos**: un equipo con 40 partidos recientes y uno con 6 reciben el mismo
   ruido de forma.
4. **La calibración λ=0,15 se aplica al 1X2 de clubes sin re-medir.** El informe del rating con cuotas lo
   señala como pendiente: «El transform pierde +0,005 contra el propio cierre: re-medir `CALIB_LAMBDA=0,15` y
   el Poisson/DC del 1X2 de clubes… Es la mitad de la distancia al cierre y no depende del rating»
   (`docs/impl/elo-odds-REPORT.md` §6.3).

**Del Elo de clubes**
5. **Sin prior de mercado ni regresión entre temporadas en producción.** `regressSeason` existe
   (`eloOdds.js:81`) pero no se llama desde `server.js`. La autopsia lo enumera como causa raíz: «un
   ascendido nace 1500 = media de la liga» (§4.1).
6. **El overlay `db.clubElos` deriva** sin reconciliar hasta que cambia `_meta.fitted_at`
   (`server.js:6509`), y `ratings.json` está fechado en **2026-08-08** — más de un mes de deriva al día de
   hoy.
7. **El gate por liga es una etiqueta, no una puerta, en SOLID.** El gate viaja en `gate_status` pero la
   generación de SOLID no lo consulta (`server.js:8663-8690`): lo que decide es la **banda**. La autopsia lo
   dice igual: «el gate `approved/shadow` es una etiqueta que la publicación no consulta» (§4.1).
8. **Solo 14/47 ligas aprobadas en 1X2 y 2/47 en goles**, y aun así se generan picks en todas para
   monitoreo (`propsRequireApprovedFamily:false`, `goalsRequireApprovedFamily:false`,
   `server.js:8569`).

**Del goal engine y las derivadas**
9. **Bug de de-vig confesado y vigente en la muestra v1**: desde el 20-ago hasta el 13-sep **ninguna** pick
   de la sombra de derivadas se valoró contra el precio sin vig (`futbol-derivadas.js:99-110`). La muestra v1
   existe pero no se generó con la regla que su propia ficha declara.
10. **La v1 sigue apilando posiciones correlacionadas** en el mismo partido y familia
    (`futbol-derivadas.js:170-173`): su estadístico está inflado, y el código lo admite.
11. **Convolución de mitades como independientes** con error de signo conocido en las remontadas
    (`mitades.js:217-221`), declarado pero no corregido.
12. **Marcador exacto normalizado contra masa 1** cuando la casa no cotiza la cola de goleadas
    (`futbol-derivadas.js:141-144`); el autor elige el error que **quita** picks, pero es un sesgo.
13. **`descansoDesde` depende de que ESPN haya publicado todos los goles**; si el resumen llega incompleto la
    pick espera y muere en VOID a las 72 h (`futbol-derivadas.js:418-420`). El coste es muestra, no
    contabilidad, pero es una fuga de muestra en las familias nuevas.
14. **`sensitivity` de `goalValue` tiene código muerto**: la función `scaled` declarada en
    `goalValue.js:42` no se usa (la que actúa es `at(mult)` en `:43`).
15. **`goal-engine/repository.js` escribe a Postgres** y su cabecera dice «INERTE (nada lo invoca desde el
    pipeline)» (`repository.js:1-2`) — pero `server.js:4369,4399,4444` sí lo invocan. El comentario está
    desfasado.

**De tarjetas y córners (lo más importante)**
16. **El multiplicador de árbitro de tarjetas EXISTE y NO SE USA.** `prop-engine/model.js:98-103` lo calcula,
    pero `server.js:8489` llama a `project()` sin `referee`. En la familia con dinero real, la única capa de
    información específica del partido que el modelo tiene medida queda apagada. La autopsia lo señala
    (§4.2) y sigue así.
17. **Con `TOTALS_DAMP = 0`, el total de tarjetas es la media de la liga** por árbitro (=1), paridad y fase.
    O sea: el «modelo» de la familia que gana dinero es, en la mayoría de ligas, **la media de la liga con un
    ajuste de paridad de ±10 %**. Que funcione dice más del mercado que del modelo, y el propio proyecto lo
    escribe: el dinero «gana por precio y momento» (`CLAUDE.md`, autopsia §2).
18. **El auto-tune de DAMP mezcla córners y tarjetas** en un solo score (`server.js:6103`), así que una
    familia puede arrastrar a la otra a un DAMP que no le conviene. Está identificado y no corregido
    (`docs/impl/corners-ref-REPORT.md` §5).
19. **CLV de tarjetas negativo y significativo** (−0,5 %, t −3,7) con ROI +11,2 %. El sistema decide que aquí
    el CLV no es la vara (`server.js:7350-7353`) — decisión defendible y documentada, pero **es una excepción
    hecha a la única familia con dinero**, y esa es exactamente la forma que tiene el sesgo de confirmación
    en un sistema de medición.
20. **`propsMinBooks` se baja a 1 en clubes** (`server.js:8569`) y el de-vig se hace con **una sola casa**
    (`minGroups: 1`, `server.js:8509`): la «probabilidad de mercado» contra la que se mide la ventaja es, en
    muchos casos, el propio precio de Cloudbet sin más contraste que su lado contrario.
21. **`propsRequireFairPrice` está desactivado** por `propsMonitoringMode` (`curate.js:112`), así que la pick
    puede nacer con la mejor cuota por debajo de la justa del consenso.
22. **Selección de línea por máximo edge** (`server.js:8721-8723`): se elige la línea donde el modelo más
    discrepa del mercado, que es exactamente el mecanismo del *winner's curse* que la autopsia documenta en
    §3 para todas las demás familias.
23. **La validación continua de tarjetas usa un base-rate que incluye los propios partidos**: `cardsBaseRates`
    lee todos los FT de `props-history-<liga>.json` (`server.js:7386-7396`), incluidos los de las picks que
    está evaluando. Con 30-300 partidos por liga el efecto es pequeño, pero es contaminación.
24. **Liquidación con tres fuentes distintas** (props-history AF, player-history TSA, AF statistics en vivo,
    `server.js:9177-9202`, `:9363-9398`) y sin conciliación entre ellas. `CLAUDE.md` avisa de que **tres
    liquidadores mintieron** en otros deportes; aquí no hay comprobación cruzada escrita.
25. **El veto de bandas llega tarde**: `CLAUDE.md` lo dice sin rodeos — «ya costó −453,43 en cuatro ligas
    (premier, bundesliga, mls, rusia) clasificadas como eficientes DESPUÉS de haberlas apostado. Propuesto y
    sin aprobar: veto por pérdida».
26. **`refreshClubPickPrices` reescribe `best_odds`** en la ventana final (KO ≤2 h) y el ROI se mide con esa
    cuota; la de creación queda en `odds_at_create`. El backtest avisa: «a esa cuota todos los ROI de SOLID
    empeoran 4-6 pp» (`docs/BACKTESTS_FAMILIAS_2026-09-02.md` §3.5).
27. **Sesgo de selección en la muestra liquidada:** «276 SOLID, 353 GOALS y 479 CORNERS **SUPERSEDED sin
    resultado**: la regla `lead` poda cuando el mercado se acerca al modelo, así que la muestra decidida está
    seleccionada **en contra** del modelo» (`docs/BACKTESTS_FAMILIAS_2026-09-02.md` §3.5).
28. **65 SOLID y 40 GOALS tienen cierre capturado 0-17 min DESPUÉS del saque** (precios in-play) — el CLV de
    esas picks está medido contra un precio que ya no es de cierre (mismo §3.5). El código tolera
    `KO + 30 min` (`server.js:9515`).

**Transversales**
29. **No hay suite de test.** `CLAUDE.md`: «No hay build, lint ni test suite. "Tests" = `node --check` +
    verificación manual en preview + scripts ad-hoc». La única prueba de equivalencia formal citada es la de
    `distribution.js` contra `engine.probsFromLambdas` (`distribution.js:6`), y los humos de
    `scripts/smoke/*`.
30. **`server.js` tiene ~27.900 líneas** y aloja el modelo, el pipeline de picks, la liquidación, la medición
    y las rutas HTTP. Las funciones puras están bien separadas en módulos, pero la orquestación no.
31. **La doctrina «una posición por partido» se aplicó en el ejecutor real y en `derivadas_v2`, pero NO en el
    ejecutor en la sombra ni en `derivadas_v1`**, que siguen apilando — y son las muestras con las que se
    juzgan las reglas.

---

# Parte 2 · Fútbol: generación de picks, derivadas, eficiencia de ligas, tablero de ventaja

> Todo lo que sigue sale de la lectura del código del repositorio `/home/user/gp-simulador-mundial` (rama de
> trabajo al 15-sep-2026) y de `CLAUDE.md`. Cada afirmación lleva su `archivo.js:línea`. Donde el código no
> contiene el dato, se dice explícitamente "no encontrado en el código".

---

## 0. Mapa de piezas y quién llama a quién

El fútbol tiene **cinco pipelines distintos** que conviven y que NO comparten almacén:

| # | Pipeline | Almacén | Público | Entrada | Archivo(s) |
|---|---|---|---|---|---|
| 1 | Picks del **Mundial** | `db.dailyPicks` | sí (feed efímero) | `value_evaluations` + `goal_value_shadow` (Postgres) | `pick-engine/dailyPicks.js`, `pick-engine/curate.js`, `server.js:4592` |
| 2 | Picks de **clubes** | `db.clubDailyPicks` | sí, por segmento | `sportsbook_goal_quote_current` + ratings/fits propios | `server.js:8305` (`buildClubDailyPicks`) + el mismo `curate` |
| 3 | **Derivadas** v1/v2 (sombra) | `<dir(DB_FILE)>/derivadas/futbol-derivadas.json` | no | cuotas de Cloudbet de 20 familias | `futbol-derivadas.js`, `goal-engine/mitades.js` |
| 4 | **Proceso implícito** (sombra de PRECIO) | `<dir(DB_FILE)>/implicito/futbol.json` | no | 1X2 + totales de todas las casas | `implied-engine/{football,sombra,closes,uncertainty,run-futbol}.js` |
| 5 | **Value engine** (Sprint 7, 1X2 canónico) | `value_evaluations` / `candidate_factory` / `internal_picks` | no (admin, conversión manual) | cuotas canónicas | `value-engine/*` |

Por encima de los cinco hay dos capas de JUICIO que no generan nada:

- **`edge-board.js`** — el tablero de familias de los ocho deportes, con una sola vara (CLV + t).
- **`lib/vara.js` + `lib/margen.js`** — la vara "invertible o no" (CLV recortado, neto de margen, con las dos
  pruebas de método). La usa `futbol-derivadas.tabla()` (`futbol-derivadas.js:474`) y el endpoint
  `/api/internal/vara` (`server.js:25257`).

Cadencias (todas en `server.js`):

| Job | Primer disparo | Intervalo | Throttle interno |
|---|---|---|---|
| `clubsQuotesSweep` (cuotas 1X2/totales de The Odds API) | — | ver `GP_CLUBS_SWEEP_MIN` | 12 min por defecto (`server.js:4769`) |
| `evaluateClubDailyPicks` (build + settle + refresh + closing) | 180 s | 15 min (`server.js:10302-10304`) | lock `_clubPicksRunning` |
| `derivadasJob` (derivadas + implícito) | 5 min | 20 min (`server.js:8264-8265`) | 15 min (`server.js:8241`) |
| `clubPicksCloseBuckets` (cubos T−60…T−1) | — | 3 min (`server.js:9489`) | lock `_clubBucketsBusy` |
| `userValueAlertsSweep` | 300 s | 15 min (`server.js:10306-10307`) | — |

---

## 1. El generador principal: `buildClubDailyPicks` (`server.js:8305-8898`)

### 1.1 Propósito y alcance

Genera las picks de **fútbol de clubes** (47 ligas y copas configuradas en `data/clubs/ratings.json`; verificado
ejecutando el JSON: `ligamx, brasileirao, mls, …, champions, europa, saudi, aleague, frauen`). Cinco familias:
`SOLID` (1X2), `GOALS` (total de goles), `CORNERS`, `CARDS`, `PLAYER` (gol/asistencia) y `COMBO` (1X2 + goles).
Parte va al feed público, parte nace en régimen `monitor` (track privado de admin). La puerta general es
`dailyPicksOn() && clubsShadowOn()` (`server.js:10255`).

### 1.2 Fuentes de datos

1. **Universo de eventos**: `db.clubsQuoteEvents`, el mapa que escribe `clubsQuotesSweep` con `league`,
   `home`, `away`, `kickoff`, `oa_id` (`server.js:4803-4804`). Se filtra el baloncesto con
   `nonHoopsEvents()` (`server.js:8313`). Poda: eventos con saque de hace >36 h o sin refrescar 48 h
   (`server.js:4837-4842`).
2. **Cuotas 1X2 y totales**: `market-scanner/quotes.loadClubsMarkets` sobre `sportsbook_goal_quote_current`
   (`server.js:8316`), con `freshQuotes(..., 75*60e3)` — ventana de frescura de **75 minutos**
   (`server.js:8335`) y consenso `market-scanner/scanner.consensus` con
   `minGroups = marketScanner.params.minIndependentGroups` (default **4**, `market-scanner/config.js:37`).
   El consenso es: mediana de la probabilidad implícita CRUDA dentro de cada grupo de independencia →
   mediana entre grupos → de-vig **proporcional** (`market-scanner/scanner.js:55-108`).
3. **Cuotas de props de equipo** (`corners_total`, `cards_total`): query propia con ventana de **12 horas**
   (`server.js:8466-8470`). Tiene su propio universo de eventos con *fallback* al sweep cuando la query de
   1X2 muere (`server.js:8461-8464`) — el comentario documenta que este mismo bug (early-return matando
   props) se repitió dos veces (`server.js:8318-8323`, `server.js:8394-8398`).
4. **Cuotas de props de jugador** (`player_assist`, `player_goal`): ventana 12 h (`server.js:8403-8407`).
5. **Proveedor de precios**: The Odds API, 5 regiones `us,us2,uk,eu,au` tanto en scan como en props
   (`server.js:4666`, `server.js:4670`), con guardia de créditos `oddsBudgetOk(reserve)` y reserva
   `SPORTSBOOK_QUOTA_RESERVE` (default 2000, `server.js:4688`). Cloudbet entra por su propio barrido
   (`server.js:5512-5629`).

**Si la fuente falla**: la función NO aborta. Con `markets` vacío loguea y sigue con props
(`server.js:8323`); con `db` no configurada devuelve `{skipped:'sin DB'}` (`server.js:8309`); sin
`ratings.json` devuelve `{skipped:'sin ratings'}` (`server.js:8310`).

### 1.3 Rating y estado del modelo

- **Elo de clubes**: base en `ratings.json` (`clubBaseElo`, `server.js:6388-6392`) + overlay dinámico
  `db.clubElos`, con **K = 30** para ligas domésticas (`CLUB_ELO_K`, `server.js:6387`; el Mundial usa 60).
  `clubElo()` puede leer el rating paralelo alimentado con cuotas si `EloOdds.eloSource() === 'odds'`
  (`server.js:6427-6430`) — por defecto el de resultados.
- **Ventaja local**: `L.hfa` por liga, default 60 (`server.js:8347`). Medida por liga en el artefacto: p. ej.
  Premier `hfa: 48`, `n_matches: 380`, `home_score_avg: 0.563`.
- **Copas**: liga virtual con ratings COPIADOS y un prior por división, `GP_CUP_TIER_GAP_ELO` (default **150**
  Elo por nivel), aplicado como `tier_offset` que se suma al leer y se resta al escribir para no filtrarse a
  la liga de origen (`server.js:4701-4706`, `server.js:6404-6409`).
- **Descanso (solo 1X2)**: `clubRestContext` (`server.js:8280-8304`).
  `c = clamp(±10, (min(d_home,7) − min(d_away,7)) × 2.5)` en Elo; se ignora si `|c| < 3`; devuelve `null` si
  algún equipo no jugó en 45 días. Se aplica SOLO al `matchProbs` del ramal 1X2 (`server.js:8347`) — decisión
  explícita citada en el código: *"tarjetas, córners, goles y props NO tocan esto"* (`server.js:8276-8278`).

### 1.4 Del rating a la probabilidad

**1X2** (`engine.js:94-97` → `engine.js:26-31` → `engine.js:78-91`):

```
we  = 1 / (1 + 10^(-(eloH - eloA)/400))          // engine.js:17-19
lh  = clamp(0.65, 4.8, 2.6 · we^0.93)            // GOAL_FLOOR=0.65, TOTAL_GOALS=2.6, engine.js:5,8,28
la  = clamp(0.65, 4.8, 2.6 · (1-we)^0.93)
P(h,a) ∝ Poisson(lh,h)·Poisson(la,a)·τ_DC(h,a)   // DC_RHO = −0.13, engine.js:12,34-40
p1X2 = (1−0.15)·p + 0.15/3                       // CALIB_LAMBDA = 0.15, engine.js:70-74
```

La calibración λ=0.15 se documenta como corrección medida de sobreconfianza (`engine.js:68-69`).

**Totales de goles** (`server.js:8360-8386`): las λ NO salen del Elo si hay fit de liga. Orden:
1. `clubGoalsFit(lg)` → `clubs-engine/goalsModel.goalLambdas(fit, hId, aId)`. El fit se hace sobre **xG por
   partido escalado a goles de la liga** cuando `FT ≥ 40`, cobertura xG ≥ 60 % y `withXg ≥ 40`
   (`server.js:5807-5818`); el comentario cita el torneo de modelos: *"+0.0020 walk-forward vs −0.0007 del fit
   sobre goles; mejor en 5/7 ligas"* (`server.js:5803-5806`). Memo 30 min (`server.js:5801`).
2. Fallback: `lambdas(elo_h + hfa, elo_a)` (`server.js:8364`).
3. Ajuste del observador: `λ × clubObserverLambdaFactor(lg, teamId)` por lado (`server.js:8365-8366`).
4. La distribución completa sale de `goal-engine/distribution.goalModelOutput` — Poisson + Dixon-Coles con
   truncamiento dinámico hasta masa 0.9999 (`goal-engine/distribution.js:33-53`).

**Córners y tarjetas** (`server.js:8453-8535`): `prop-engine.project(fit, {home, away, lambdas, closeness1x2})`
devuelve `proj.corners.total` / `proj.cards.total` (μ) y su dispersión `r_total`; la probabilidad de over sale
de una **binomial negativa** `nbOver(mu, r, line) = 1 − Σ_{k≤⌊L⌋} nbPmf(mu,r,k)`
(`server.js:8456`, `goal-engine/negativeBinomial.js:8-20`). Solo líneas `.5` (`server.js:8476`).
Opcional: efecto del árbitro encogido, ANOTADO siempre y aplicado solo con `GP_CORNERS_REF=1`
(`server.js:8493-8501`, `server.js:6118-6128`).

**Props de jugador** (`server.js:8410-8447`): `prop-engine/players.projectTeam(fit, teamId, {teamLambda, top:40})`
→ `anytime_goal` / `anytime_assist`. El "mercado" es la **mediana de 1/odds entre casas SIN de-vig**
(`server.js:8434-8435`) — el propio `curate` declara que eso sobreestima 3-5 pp parejo
(`pick-engine/curate.js:234-236`).

**Qué NO entra**: en `SOLID` y `GOALS` no entra ninguna cuota dentro de la probabilidad del modelo; lo que sí
entra es el **consenso de mercado** en el blend de publicación (§1.6). En córners/tarjetas tampoco entra el
precio en μ.

### 1.5 Del modelo a la pick: el selector `curate`

`curate` es puro, sin DB ni red (`pick-engine/curate.js:1-7`). Clubes lo invoca con overrides
(`server.js:8569`):

```js
curate({ events, goalMarkets, propMarkets, playerMarkets, config: {
  goalsRequireApprovedFamily: false, propsRequireApprovedFamily: false,
  playerMinBooks: 1, propsMinBooks: 1, goalsAnchorEnabled: true, propsMonitoringMode: true } })
```

Parámetros por familia (`pick-engine/curate.js:10-72`), con el valor efectivo en clubes:

| Familia | Parámetro | Default (Mundial) | Clubes | Efecto |
|---|---|---|---|---|
| SOLID | `alpha1x2` | 0.25 | 0.25 | peso del modelo en el blend de confianza |
| SOLID | `solidMinConfidence` | 0.45 | 0.45 | confianza mínima del favorito |
| SOLID | `solidMinBooks` | 3 | 3 | profundidad mínima |
| SOLID | `solidMaxOdds` | 3.2 | 3.2 | por encima "no es favorito claro" |
| SOLID | coherencia | dirección | idem | rechaza si `model(fav) < model(rival)` (`curate.js:94`) |
| GOALS | `goalsMinEdgePp` | 0.03 | 0.03 | edge mínimo modelo−consenso |
| GOALS | `goalsMinBooks` | 3 | 3 | |
| GOALS | `goalsRequireApprovedFamily` | true | **false** | el gate viaja en la pick, no bloquea |
| GOALS-ancla | `goalsAnchorEnabled` | false | **true** | régimen dual |
| GOALS-ancla | `goalsAnchorMinBooks` / `MinMarketProb` / `MaxDivergencePp` / `MaxVigPp` | 4 / 0.55 / 0.05 / 0.02 | idem | |
| GOALS-ancla | `alphaGoalsAnchor` | 0.25 | 0.25 | |
| COMBO | `comboMinConfidence` | 0.28 | 0.28 | |
| PROPS | `propsMinEdgePp` | 0.04 | 0.04 | 1 pp más que goles |
| PROPS | `propsMinBooks` | 3 | **1** | |
| PROPS | `propsOddsMin/Max` | 1.35 / 4.6 | 1.25 (monitor) / 4.6 | `propsOddsMinMonitor`, `curate.js:205` |
| PROPS | `propsRequireFairPrice` | true | **no bloquea** (`propsMonitoringMode`) | viaja como `belowConsensus` |
| PROPS | `alphaProps` | 0.6 | 0.6 | |
| PLAYER | `alphaPlayer` | 0.3 | 0.3 | |
| PLAYER | `playerMinBooks` | 5 | **1** | |
| PLAYER | `playerOddsMin/Max` | 1.4 / 4.0 | idem | |
| PLAYER | `playerMinProb` | 0.5 | 0.5 | solo picks "ganadoras" |
| PLAYER | `playerMaxModelDeficitPp` | 0.15 | 0.15 | coherencia |
| PLAYER | `playerDoubtBlockMiss` | 0.3 | 0.3 | duda del observer |

El régimen de goles (`efficiency.marketEfficiency`, `pick-engine/efficiency.js:13-29`) clasifica el lado como
`efficient` con ≥4 casas y CV de la implícita < 5 %, `soft` con ≤2 casas o CV ≥ 8 %, `mixed` en medio.

### 1.6 La capa de decisión POST-`curate` (lo que de verdad decide qué se publica)

`curate` produce elegibles; después `buildClubDailyPicks` aplica su propia doctrina:

**SOLID — 1X2 de régimen por banda** (`server.js:8650-8686`):
- `SOLID_C = Number(process.env.GP_SOLID_C ?? 0)` (`server.js:8650`).
- `p_pub = σ( logit(p_mkt_shin) + c·(logit(p_gp) − logit(p_mkt_shin)) )` (`lib/devig.js:92-102`).
  Con **c = 0 se publica el consenso Shin tal cual** y el Elo solo se guarda en `model_prob_raw`.
- El consenso 1X2 se de-viga con **Shin por casa + mediana entre casas** (`lib/devig.js:66-87`,
  `server.js:8354-8357`); el proporcional se conserva al lado en `market_prob_prop`. Motivo escrito: el
  proporcional sobreestima el longshot (*"cuota >5: mercado 17,1 % vs observado 13,1 %, n=84"*,
  `lib/devig.js:4-6`).
- **Banda intermedia → no se genera nada** (`server.js:8654`).
- **Banda eficiente → ANCLA**: exige `p_mkt ≥ 0.55`, `books ≥ 5`, `bestOdds > 1` y que el blend crudo no
  contradiga (`blendEdge = ((0.5·m + 0.5·k) − k)·100 ≥ −2`) (`server.js:8663-8667`). `regime: 'anchor'`.
- **Banda blanda → MODELO LÍDER**: el lado (home/away, jamás empate ni doble chance) con
  `(p_pub − p_mkt)·100 ≥ 2` y `books ≥ 3` (`server.js:8673-8684`). `regime: 'lead'`.
  **Con `GP_SOLID_C = 0` esa ventaja es 0 por construcción → `lead` no genera picks**, y el comentario lo dice
  explícitamente (`server.js:8646-8648`).

**GOALS** (`server.js:8691-8719`): una por evento; la ancla gana al edge por `goalRank` (`server.js:8692`);
y **solo se crea si `regime === 'anchor'`** — `if (g.regime !== 'anchor') continue` (`server.js:8702`), con el
motivo histórico escrito (*"7-14 histórico, sin edge"*).

**CORNERS / CARDS** (`server.js:8720-8740`): una por (evento, familia), la de **mayor edge**. `regime = 'edge'`
si `bestOdds > 1/market_prob`, si no `'monitor'` cuando nació en modo monitoreo.

**PLAYER** (`server.js:8741-8747`): una por (evento, sub-familia), la de mayor confianza.

**COMBO** (`server.js:8748-8766`): pata 1X2 + pata de goles del mismo evento, **solo en ligas de banda
eficiente**. La regla del Mundial de no publicar el combo si sus dos patas salen sueltas NO aplica aquí
(decisión explícita, `server.js:8751-8753`).

**Blend, stake y segmento público** (`server.js:8822-8865`):

```
blend_prob = 0.5·model_prob + 0.5·market_prob                        // server.js:8829
kelly      = max(0, (blend·(o−1) − (1−blend))/(o−1)) / 4             // ¼ Kelly, server.js:8833
stake_pct  = clamp(0.25, 3, kelly·100)                                // % de bankroll, server.js:8834
```

Después:
- si `!isPublicSegment(family, side, league)` → `regime = 'monitor'` (`server.js:8839`);
- `GOALS` y `CORNERS`-en-eficientes: ancla si `p_mkt ≥ 0.55 && books ≥ 5 && (blend − k)·100 ≥ −2`; si no,
  `CORNERS` sale igual como `'edge'` y `GOALS` baja a `'monitor'` (`server.js:8846-8851`);
- `CORNERS` en intermedias/blandas exige `gate_status === 'approved'` (`server.js:8854`);
- **`CARDS` lado `over` → siempre `monitor`** desde el 17-ago, con la medición citada: *"8-18 histórico,
  −12,6 u (ROI −48 %)"* (`server.js:8855-8860`);
- resto: `regime = 'edge'` si `(blend − k)·100 ≥ 2`, si no `'monitor'` (`server.js:8864`).

**Deduplicación, cap y prune**:
- Cap de **3 picks públicas por evento**, prioridad `SOLID > GOALS > resto por confianza`
  (`server.js:8793-8803`). `monitor` y props quedan EXENTOS del cap (`server.js:8796`).
- Una sola ACTIVE por (evento, familia): la nueva SUPERSEDE a la anterior (`server.js:8870-8873`).
- Prune de SOLID/GOALS activas que ya no pasan el filtro nuevo, **solo si el evento se re-escaneó** y el saque
  está a >15 min (`server.js:8804-8821`).
- Prune extra de SOLID `anchor` por sus propias probabilidades congeladas: fuera si `mkt < 0.55` o
  `mdl > mkt + 0.05` (`server.js:8887-8888`).
- `solid_lever` marca el caso `mdl < mkt − 0.05` para evaluarlo aparte (`server.js:8889`).

**Etiquetas de medición que NO deciden** (`server.js:8771-8789`):
- `prereg_goals_late` (≤48 h del saque y `best_odds ≥ 1/market_prob`), `price_vs_fair`.
- `prereg_corners_2books` (`books_at_create ≥ 2`).
- **Incertidumbre por muestra**: `unc_pp = 100·0,28·√(1/(nH+2)+1/(nA+2))` y el veredicto que habría dado la
  puerta `edge ≥ 0,75 × unc_pp` (`implied-engine/uncertainty.js:19-40`). `nH`/`nA` son los partidos de la
  proyección de props o, si no, `clubTeamGames` (`games` del rating, `server.js:6395-6400`). Es etiqueta pura:
  *"ninguna pick se bloquea"* (`server.js:8778-8788`).

**Congelado y publicación** (`clubFreezePublished`, `server.js:8068-8093`): a ≤15 min del saque una pick
no-`monitor` nacida antes del kickoff pasa a `published = true`. Corre SIEMPRE, fuera de
`buildClubDailyPicks`, porque el bug anterior (vivía tras el early-return) congeló el cuadro público del
29 al 31-jul (`server.js:8062-8066`).

**Reclasificación** (`reclassifyClubSegments`, `server.js:10194-10253`): repite la misma lógica de régimen
sobre las ACTIVE viejas y retira las `not_*` (doble chance) migradas. El propio comentario avisa de que este
reclasificador corre DESPUÉS del de generación y ya devolvió a `monitor` cosas recién promovidas
(`server.js:10233-10245`).

**Stop-loss por segmento** (`clubFamilyStopped`, `server.js:7325-7369`): ventana de las **últimas 30
liquidadas** del segmento; sale del feed si `hit < break-even` (con `break-even = 1/cuota_media`) o si el CLV
medio (mínimo 15 valores) es < 0. El corte por CLV **solo aplica a mercados líquidos**: se excluye props y
`|lead` (`server.js:7353-7357`). Override manual sin deploy: `GP_GATE_OVERRIDE_SEGMENTS`
(`server.js:7365-7367`). Además `db.cardsValidation.failed` fuerza el corte de `CARDS|under`
(`server.js:7360`), alimentado por la validación continua z-test contra el base-rate de la liga
(`server.js:7371-7399`).

---

## 2. Eficiencia de ligas: bandas, Brier y umbrales (`server.js:7286-7316`, `lib/bandas.js`)

La banda gobierna la estrategia: en eficientes se ancla, en blandas manda el modelo, en intermedias no se
genera 1X2; y **el ejecutor real no entra en la banda eficiente** (`lib/bandas.js:6-8`).

**Prior estructural** (`LEAGUE_EFF_PRIOR`, `server.js:7268-7279`): `mundial, premier, laliga, bundesliga,
seriea, ligue1, suecia, championship → eficiente`; `mls, brasileirao, argentina, colombia, brasilb, ligamx,
league1, league2, serieb, laliga2, portugal, belgica, turquia, grecia → intermedia`; **el default de cualquier
liga no listada es `blanda`** (`server.js:7288`).

**Medición**: Brier del **consenso de mercado** sobre las picks de esa liga ya liquidadas con WIN/LOSS:

```
brier = (1/n) · Σ (market_prob − [WIN ? 1 : 0])²          // server.js:7289-7292
```

**Umbrales y decisión** (`lib/bandas.js:24-55`):

| Constante | Valor | Uso |
|---|---|---|
| `UMBRAL_EFICIENTE` | 0.230 | por debajo, eficiente |
| `UMBRAL_BLANDA` | 0.260 | por encima, blanda |
| `MARGEN` (histéresis) | 0.005 | para SALIR de la banda actual hay que cruzar con margen |
| `N_MIN` | 40 | por debajo manda el prior |

Desde el 5-sep la histéresis protege la **banda actual**, no la del prior: de intermedia a eficiente hace falta
`< 0.225`; de eficiente a intermedia `> 0.235`; de intermedia a blanda `> 0.265`; de blanda a intermedia
`< 0.255` (`lib/bandas.js:16-19`, `lib/bandas.js:39-55`). La primera evaluación con muestra se siembra con la
regla legacy para que el despliegue no mueva ninguna banda (`lib/bandas.js:65`). La memoria vive en
`db.leagueBand` y cada cambio queda en `ficha.cambios` (últimos 10) y en `opsLog('banda_liga_cambia', …)`
(`server.js:7297-7298`).

**Segmentos publicables por banda** (`SEGMENT_BANDS`, `server.js:7308`):

```
'CARDS|under': ['intermedia','blanda']     'SOLID': ['eficiente','blanda']
'GOALS':       ['eficiente']               'CORNERS': ['eficiente','intermedia','blanda']
```

y la lista de segmentos públicos es `GP_PUBLIC_SEGMENTS`, default
`CARDS:under,SOLID,GOALS,CORNERS,COMBO` (`server.js:7249`).

**Estado de los gates de liga** (leído del artefacto `data/clubs/ratings.json`): 1X2 → 14 `approved`,
29 `shadow`, 4 sin gate; goles → 2 `approved`, 41 `shadow`, 4 sin gate. Ejemplo Premier (`backtest`):
`n=320, brier=0.6213` (multiclase) contra `brier_uniform=0.6667`, `logloss=1.0326`, `cal_err=0.0156`,
`status: approved`. Su `goals_backtest`: `over25 → brier 0.2573 vs base 0.2485, skill −0.0088`;
`btts → brier 0.2440 vs base 0.2438, skill −0.0002`. Es decir: **en goles el modelo de esa liga NO bate al
base-rate**, y eso es coherente con que GOALS solo publique anclas.

---

## 3. Liquidación, cierres y CLV de las picks de clubes

### 3.1 Liquidación (`settleClubDailyPicks`, `server.js:9135-9239`)

| Familia | Fuente del resultado | Regla |
|---|---|---|
| SOLID / GOALS / COMBO | `db.clubResults` (sync ESPN) → fallback `results-<liga>.json` por par + fecha ±2 días | `dailyPicks.settleOne` (`pick-engine/dailyPicks.js:322-351`) |
| CORNERS / CARDS | `props-history-<liga>.json` por par + fecha ±2 días; fallback CARDS desde `player-history` agrupando por `match`; fallback AF/TSA en `settleClubPropsViaAf` | `over = total > line`; solo líneas .5 → sin push |
| PLAYER | `player-history-<liga>.json`, `|fecha − ko| < 4 días` | `WIN` si `goals/assists > 0` |

- **VOID honesto a las 72 h** sin dato, en las tres ramas (`server.js:9168-9169`, `9205-9207`, `9229-9230`).
- `units` se fija en el mismo paso: `WIN → cuota−1`, `LOSS → −1`, resto `0` (`server.js:9142-9147`), con
  reparación idempotente de las liquidadas antes del fix del 31-jul (`server.js:9150-9156`).
- `settleOne` para GOALS devuelve `PUSH` si `total === line` (`pick-engine/dailyPicks.js:334`), y para COMBO
  la regla es "si alguna pata pierde → LOSS; si ninguna pierde y hay push → PUSH"
  (`pick-engine/dailyPicks.js:338-349`), tras el bug documentado de un `return 'PUSH'` que cortaba el bucle.
- **Recuperación de VOID** retroactiva: `recoverVoidClubPicks` (`server.js:8916`), en seco por defecto
  (`apply=false`), motivada por *"43 picks de fútbol quedaron en VOID —24 de las últimas 30 liquidadas—"*
  (`server.js:8902-8915`).
- **Recuperación de SUPERSEDED**: `recoverClubSupersededResults` reactiva la última superseded dentro de la
  ventana de freeze si no dejó hermano liquidado (`server.js:9278-9306`).
- **Medición de SUPERSEDED en sombra**: `measureClubSupersededShadow` (`server.js:9315-9360`) escribe
  `shadow_result = {code, units, score, odds, at}` en SOLID/GOALS/CORNERS superseded, **sin tocar `status` ni
  `result_code`**, valorado a `odds_at_create`. El motivo está escrito: *"la regla `lead` poda cuando el
  mercado se acerca al modelo, así que la muestra decidida del libro está seleccionada EN CONTRA del modelo"*
  (`server.js:9307-9312`).

### 3.2 Refresco de precio y cierre

- **`refreshClubPickPrices`** (`server.js:9401-9441`): en la ventana final (KO ≤ 2 h, cada ≥20 min) reemplaza
  `best_odds/best_book/books` por el mejor precio actual (cuotas de ≤3 h). Congela `odds_at_create`,
  `books_at_create`, `best_book_at_create` la primera vez (`server.js:9427-9429`) y anota `books_final`.
- **Cubos de cierre** (`clubPickCloseRecord`, `server.js:9446-9455` + `clubPicksCloseBuckets`,
  `server.js:9457-9488`, cada 3 min): guarda UNA lectura por cubo **T−60 / T−30 / T−10 / T−5 / T−1** con tres
  referencias — `own` (la casa donde nació), `best` y `pinnacle` — con `age_min`. Las ventanas están en
  `implied-engine/closes.js:20-26`: `T60=(45,90]`, `T30=(20,45]`, `T10=(7,20]`, `T5=(3,7]`, `T1=(−2,3]`.
  Candidatas: familias SOLID/GOALS/CORNERS/CARDS con `−3 < minutos ≤ 95` (`server.js:9464-9469`), cuotas
  `is_live = FALSE` y observadas en los últimos 40 min (`server.js:9472-9474`).
- **`captureClubPicksClosing`** (`server.js:9500-9575`): tras el saque, con tolerancia KO+30 min,
  reconstruye el cierre:
  - SOLID: de-vig **proporcional** por casa con los tres lados y mediana entre casas → `fair_prob`;
    `odds` = máximo entre casas; además guarda `fair_prob_shin` al lado *"para medir; el CLV sigue
    calculándose con el proporcional para no romper la serie histórica"* (`server.js:9530-9533`).
  - GOALS/CORNERS/CARDS: par over/under por casa, `pOver = (1/o_over)/(1/o_over + 1/o_under)`, mediana.
  - PLAYER: mediana de `1/odds` **con vig** (`server.js:9551-9555`).
  - Guarda `own_odds`/`own_book` y `pin_odds`.
- **CLV**: `computeClv(takenOdds, closing)` (`pick-engine/metrics.js:54-65`):
  `clv_pct = (takenOdds/closing.odds − 1)·100` y `ev_close_pp = (takenOdds·fair_prob − 1)·100`, con un guarda
  de cordura: si `|1/closing.odds − fair_prob| > 0.25` el precio de cierre se considera no fiable y solo se da
  el EV. Además `clv_own_pct` y `clv_pin_pct` se calculan desde `odds_at_create` contra el cierre de la MISMA
  casa (`server.js:9567-9570`).

### 3.3 Track record (`clubDailyPicksTrackRecord`, `server.js:9615-9689`)

Agrega por `overall`, liga, familia, `gate:`, `regime:`, `era:` (`CLUB_PICKS_ERA`, default
`v2-2026-09-02`, `server.js:6386`), `solid_lever:`, los preregistros y **`unc:pass|fail`**
(`server.js:9629-9643`). Cada bloque trae DOS P&L: `pnl` a `best_odds` y `pnl_at_create` a `odds_at_create`,
porque *"a esa cuota los ROI de SOLID salían 4-6 pp mejores de lo real"* (`server.js:9617-9619`).
Añade el bloque `superseded_medido` (`server.js:9650-9667`) y `tt_transfer` por familia
(`server.js:9668-9687`): CLV contra la misma casa, la curva por cubo (`closes.summarize`) y la muestra
partida por la puerta de incertidumbre (`uncertainty.splitByGate`).

El **cuadro oficial** es otra función: `officialClubRecord` (`server.js:9584-9613`), que exige
`published === true && regime !== 'monitor'` post-corte (o liquidación anterior a `2026-07-23T12:00Z`), aplica
el **esquema actual retroactivamente** (SOLID solo ancla con `mkt≥0.55`, `books≥5`, `mdl≤mkt+0.05`; `lead`
entra entera; GOALS solo ancla) y deduplica CORNERS/CARDS a una por (evento, familia).

---

## 4. Picks del Mundial (`evaluateDailyPicks`, `pick-engine/dailyPicks.js`)

Es el pipeline original y sigue vivo. Diferencias relevantes frente a clubes:

- **Fuente**: `value_evaluations` (1X2 canónico, la evaluación MÁS FRESCA por `(evento, selección)` de los
  últimos 2 días, descartando `gp_probability ∉ (0,1)`) — `pick-engine/dailyPicks.js:48-56` — más
  `goal_value_shadow` para goles, props y jugador (`:74-81`, `:103-111`, `:137-146`).
- **Dedup doble**: por `canonical_event_id` y por **par de equipos**, porque el mismo partido existe bajo id
  canónico y sintético (`pick-engine/dailyPicks.js:73-97`, `:129-132`).
- **Selección dentro de familia**: GOALS = mayor edge (desempate por confianza); PROPS = **mayor confianza, no
  mayor edge** (backtest 9-jul: 60→73 % de acierto y +26.8→+30.1 % de ROI, `pick-engine/dailyPicks.js:249-251`);
  PLAYER = la más probable.
- **Reglas de publicación** (`pick-engine/dailyPicks.js:285-297`): el COMBO no sale si sus dos patas ya salen
  sueltas, y máximo **3 picks por evento** con prioridad `SOLID > GOALS > COMBO`. Motivo escrito: la autopsia
  France-England del 18-jul, donde *"ML+U3.5+combo cayeron JUNTAS — una sorpresa contó como 3 derrotas"*.
- **Anti-contradicción** en `evaluateDailyPicks` (`server.js:4609-4627`): una ACTIVE por (par de equipos,
  familia); lo demás pasa a `SUPERSEDED`; lo `editorial` gana sobre lo que emita el motor.
- **Liquidación** (`settleDailyPicks`, `server.js:6960-6979`): solo con marcador de 90' reglamentario
  (`regulationScoreFor`); si el partido se definió en prórroga o penales → `VOID`. `reg90For`
  (`server.js:4638-4659`) prioriza el dato manual verificado y exige `minute ≥ 85` en el snapshot automático.
- **Cierre** (`captureDailyPicksClosing`, `server.js:6984-7026`): la última fila de `goal_value_shadow`
  con `created_at ≤ kickoff` ES el cierre; en COMBO se multiplican las patas (`fair` producto, `odds`
  producto).
- **Quant** (`pick-engine/metrics.js:117-167`): Brier, log-loss, calibración por tramos
  `[0, .4, .5, .6, .7, .8, 1]` y `skill = brier_market − brier_model` sobre los MISMOS pares.
  `EXPERIMENT_FAMS` está hoy **vacío** (`server.js:7785`), así que no hay familias fuera del headline.

---

## 5. Value engine (Sprint 7): la evaluación 1X2 canónica

Es la capa que alimenta `value_evaluations` y la fábrica de candidatos; **nunca publica sola**.

**Cadena** (`value-engine/evaluate.js:38-112`): cuotas por casa → `normalizeQuote` → **no-vig por casa**
(proporcional, `OFFICIAL_NO_VIG = 'no-vig-proportional-1'`, `value-engine/config.js:8`, con `power` calculado
en paralelo como sensibilidad, `value-engine/noVig.js:36-45`) → **consenso** por mediana con un voto por grupo
de independencia (`value-engine/consensus.js:11-48`) → **ensemble por weighted logit pooling**
(`value-engine/ensemble.js:13-42`) con pesos:

| Fuente | Peso | Env |
|---|---|---|
| consenso de sportsbooks | 0.55 | `VALUE_WEIGHT_SPORTSBOOK_CONSENSUS` |
| modelo GP | 0.20 | `VALUE_WEIGHT_GP_MODEL` |
| prediction markets | 0.25 | `VALUE_WEIGHT_PREDICTION_MARKETS` |
| sharp reference | 0.0 | `VALUE_WEIGHT_SHARP_REFERENCE` |
| tope GP con muestra insuficiente | 0.10 | `VALUE_MAX_GP_WEIGHT_WITH_INSUFFICIENT_SAMPLE` |

→ **incertidumbre** (12 factores, score 0-100, buffer `= score/100 × 0.05`, tope 5 pp,
`value-engine/uncertainty.js:6-32`) → `conservativeProb = ensembleProb − buffer`
(`value-engine/evaluate.js:60`) → **value** (`value-engine/valueFormulas.js:8-27`):

```
break_even = 1/d ; raw_edge = p − 1/d ; adjusted_edge = p_conservadora − 1/d
raw_ev = p·d − 1 ; adjusted_ev = p_conservadora·d − 1
minimum_acceptable_odds = (1 + minEv)/p_conservadora     // minEv default 0.02
```

con la nota explícita de que **no se resta el overround como fee adicional** porque sería doble conteo
(`value-engine/valueFormulas.js:20-22`) → **quality score** 0-100 (`value-engine/qualityScore.js:6-29`) →
**clasificación** `pass|watch|lean|strong` (`value-engine/classification.js:10-66`) con umbrales
(`value-engine/config.js:63-75`): watch 0.01, lean 0.02, strong **0.035** de edge y 0.04 de EV, quality ≥ 65,
incertidumbre ≤ 45, ≥3 fuentes y ≥3 grupos independientes. Un `hard_conflict` **nunca** puede ser superado por
un edge alto (`value-engine/classification.js:2`).

**Candidatos y conversión**: `candidateFactory.run()` solo lee `classification='strong'` con
`pick_candidate_eligible=true` (`value-engine/candidateFactory.js:145-147`), calcula `price_state`
(`AVAILABLE|BELOW_MINIMUM|AT_MINIMUM|ABOVE_MINIMUM|STALE|SUSPENDED|EVENT_STARTED`,
`value-engine/candidateFactory.js:29-38`) y un `readiness` con 9 bloqueos, incluido mapping ESPN aprobado y
deep link (`:54-74`). La conversión a Pick es **manual, superadmin y atómica**, con revalidación en el
instante (`value-engine/pickConversion.js:33-51`). La auto-publicación está **forzada a false como invariante**
(`value-engine/config.js:36-37`) y V2 tiene peso 0 (`value-engine/config.js:40`).

---

## 6. `futbol-derivadas.js` — las familias que la casa ya cotizaba y no leíamos

### 6.1 Propósito, aislamiento y alcance

Sombra propia en `<dir(DB_FILE)>/derivadas/futbol-derivadas.json` (`futbol-derivadas.js:86-94`). **No toca
`db.clubDailyPicks` ni `curate`**: *"si algo aquí se rompe, el feed que ven los usuarios no se entera"*
(`futbol-derivadas.js:8-11`). Dispara `derivadasJob` (`server.js:8239-8263`): `record` → `closes` → `settle` →
proceso implícito, cada 20 min con throttle de 15.

El censo que lo originó está escrito: Cloudbet publica **43 mercados** por partido de fútbol y se leían **9**;
de los 34 que faltaban se abren **15** (`futbol-derivadas.js:20-23`).

### 6.2 Las dos reglas congeladas

**`RULE` (v1, congelada el 2026-08-20)** — `futbol-derivadas.js:43-51`:

| Campo | Valor |
|---|---|
| `edge_min` | 0.03 (3 pp sobre el precio sin vig) |
| `edge_cap` | 0.15 (por encima "la ventaja es NUESTRO error") |
| `books_min` | 1 |
| familias | `double_chance, draw_no_bet, asian_handicap, team_total, btts` |

**`RULE2` (v2, congelada el 2026-09-13)** — `futbol-derivadas.js:59-71`:

| Campo | Valor |
|---|---|
| `edge_base` | 0.03 |
| `edge_cap` | 0.15 |
| `books_min` | 1 |
| familias (15) | `h1_total, h1_1x2, h1_btts, h1_team_total, h1_double_chance, h1_draw_no_bet, h1_ah, h2_total, h2_1x2, h2_team_total, h2_ah, htft, exact_score, clean_sheet, win_to_nil` |
| listón | `mitades.listonDe(familia, 0.03)` = **0.03 + error de calibración medido de esa familia** |

La razón de que sean DOS reglas está escrita: aplicar el listón nuevo a la v1 *"sería cambiar la regla a mitad
de la ventana y tirar veinticuatro días de muestra"* (`futbol-derivadas.js:38-42`). Cada pick guarda
`rule_version` y `rule_edge_min` (`futbol-derivadas.js:333`).

### 6.3 El listón por familia y el error de calibración (`goal-engine/mitades.js`)

La medición (`goal-engine/mitades.js:68-80`): **football-data.co.uk, 33.364 partidos, 18 divisiones,
temporadas 2021-22 a 2025-26**, medido el 2026-09-13.

| Hecho medido | Valor |
|---|---|
| goles 1T / 2T / total | 1.199 / 1.489 / 2.688 |
| **cuota del primer tiempo `CUOTA_1T`** | **0.446** (rango entre ligas 0.431–0.463) |
| correlación "liga goleadora ↔ cuota 1T" | 0.265, t = 1.1 → ninguna |
| correlación 1T ↔ 2T | 0.05 (t=9.2, y el código dice que el t **no** es el criterio aquí) |
| cuota del local 1T / 2T / FT | 0.556 / 0.552 / 0.554 |

**Dixon-Coles NO se aplica a las mitades** (`RHO_MITAD = 0`, `goal-engine/mitades.js:121`) con la tabla de
prueba transcrita en el código (`:45-48`): con ρ=−0.13 el empate de 1T se desvía 0.052 (sesgo −0.026) y el de
2T 0.036 (−0.036); con ρ=0 caen a 0.027 (−0.001) y 0.009 (−0.006). El razonamiento: *"un sesgo con signo fijo
[…] fabrica ventaja falsa siempre del mismo lado"* (`:50-53`).

**`ERROR_CAL`** (`goal-engine/mitades.js:89-109`) — peor desviación por tramo contra 33.335 partidos con λ
resuelta del cierre; el suelo de ruido del método son las dos familias de control publicadas
(`CONTROL = {gana_local: 0.034, mas_2_5: 0.029}`, `SUELO_METODO = 0.034`):

| Familia | error | listón v2 (3 pp + error) |
|---|---|---|
| `h1_total` | 0.058 | 8.8 pp |
| `h1_1x2` | 0.036 | 6.6 pp |
| `h1_btts` | 0.008 | 3.8 pp |
| `h1_team_total` | 0.044 | 7.4 pp |
| `h1_double_chance` | 0.036 | 6.6 pp |
| `h1_draw_no_bet` | 0.025 | 5.5 pp |
| `h1_ah` | 0.027 | 5.7 pp |
| `h2_total` | 0.039 | 6.9 pp |
| `h2_1x2` | 0.022 | 5.2 pp |
| `h2_team_total` | 0.032 | 6.2 pp |
| `h2_ah` | 0.022 | 5.2 pp |
| `htft` | 0.047 | 7.7 pp |
| `exact_score` | 0.023 | 5.3 pp |
| `clean_sheet` | 0.045 | 7.5 pp |
| `win_to_nil` | 0.034 | 6.4 pp |
| `btts` (ya en v1) | 0.009 | — (la v1 sigue en 3 pp) |

`listonDe(familia, base)` devuelve `base + SUELO_METODO` para una familia sin error medido
(`goal-engine/mitades.js:112-115`).

### 6.4 Catálogo de líneas emitidas (`goal-engine/mitades.js:198-283`)

Medido sobre 29 partidos de Cloudbet: *"en las mitades NO cotiza solo medias. Cotiza CUARTOS […] y ENTERAS"*
(`:199-202`). Por eso:
- totales 1T: 0.25…3.00 en pasos de 0.25; totales 2T: 0.25…4.00 (`:203-205`);
- totales de equipo: `[0.5, 1, 1.5, 2, 2.5, 3, 3.5]` (`:209`);
- hándicaps: −3…+3 en pasos de 0.25 (`:210`).

Las probabilidades **justas descuentan la devolución**: `totalJusto` y `ahJusto` condicionan a que no haya
push en las enteras y promedian las dos medias en los cuartos (`:168-196`). El motivo escrito: comparar la
probabilidad cruda de una entera contra un precio que devuelve *"haría parecer ventaja a todas las líneas
enteras del catálogo"* (`:166-167`).

`descansoFinal` convoluciona las dos mitades como independientes; la peor celda (visitante-visitante) se
desvía 2.0 pp y el sesgo tiene signo conocido: *"el modelo se queda corto en las remontadas"*
(`:216-220`).

`mercadosFt` añade lo que el motor ya calculaba y nadie leía —marcadores exactos, portería a cero y ganar a
cero **con su lado NO**— porque sin el complementario la probabilidad de mercado sale de la cuota cruda, *"que
lleva el margen entero dentro"* (`:347-353`).

### 6.5 Cómo nace una pick derivada (`futbol-derivadas.record`, `futbol-derivadas.js:149-348`)

1. Universo: eventos de `qevents` con `kickoff > ahora` (solo prepartido, `:153-156`).
2. Query única a `sportsbook_goal_quote_current` por `market_family ∈ (v1 ∪ v2)`, `quote_status='open'`,
   `observed_at > now() − 6h` (`:159-164`).
3. Índice de probabilidades **por evento**, no por línea (`:174-219`): una sola matriz por partido con
   `dist.marketProbabilities` + `mk.extendedMarkets` + `mitades.todas`.
4. Precio de mercado, en tres niveles (`:229-283`):
   - **par complementario** → `twoWayNoVig` y se guarda el sobre-redondeo en `over_pct`;
   - **familias de varias vías** (`MASA_MULTIVIA = {h1_1x2:1, h2_1x2:1, htft:1, exact_score:1,
     h1_double_chance:2}`, `:144`) → normalización sobre todas las salidas, exigiendo `n ≥ 3` y
     `suma > masa·1.005`. La masa de la doble oportunidad es **2** y está declarada, no supuesta (`:265-268`);
   - **sin par** → implícita cruda `1/best.o`, contado por familia (`:279-283`).
5. `edge = p_modelo − p_mercado`; veto si `edge > 0.15`; descarte si `edge < listón` o `casas < books_min`
   (`:285-296`).
6. **Una posición por (partido, familia), solo en v2** (`:298-321`): se queda la de más ventaja de la pasada.
   La v1 **sigue apilando** y eso se declara: *"su muestra tiene el mismo problema que destapamos en card
   under y hay que leerla con esa advertencia"* (`:310-312`).
7. La pick guarda `p_gp`, `p_market`, `edge_pp`, `market_basis`, `over_pct`, `error_cal_pp`, `rule_version`,
   `rule_edge_min`, `born_at` (`:322-336`).

**El bug de origen, documentado en el propio código** (`futbol-derivadas.js:238-249`): desde el 20-ago
`twoWayNoVig` recibía dos números sueltos en lugar de objetos con `odds_decimal`, devolvía `null` SIEMPRE y
**ninguna pick v1 se valoró contra el precio sin vig**. El error empuja al lado seguro (menos picks, no
peores), y la muestra se puede partir por `market_basis`.

### 6.6 Cierre, liquidación y tabla

- **Cierre** (`futbol-derivadas.js:354-377`): se refresca en cada pasada mientras el partido no haya empezado;
  la última lectura antes del saque es el cierre. `clv_pct = (odds/close_odds − 1)·100`.
- **Liquidación** (`:391-438`): exige `ahora − ko ≥ 2.5 h`; VOID a las 72 h sin marcador. Las familias
  `H1_*`, `H2_*` y `HTFT_*` (`NECESITA_DESCANSO`, `:388`) exigen además el marcador al descanso, buscado **una
  vez por partido** y con tope `GP_DERIV_TOPE_DESCANSOS` (default 30) por pasada (`:389`, `:407-422`). Sin
  descanso **no se liquida con el marcador final** — eso "sería resolver otro mercado" (`:417-418`).
  Unidades: `won → o−1`, `lost → −1`, `push/void → 0`, `half_won → (o−1)/2`, `half_lost → −0.5` (`:382`).
- **El descanso** (`goal-engine/descanso.js`): se reconstruye de `keyEvents` de ESPN (periodos 1 y 2,
  `scoringPlay === true`), con **dos puertas**: el nombre tiene que resolver y **la suma de las dos mitades
  tiene que dar exactamente el marcador final conocido** (`goal-engine/descanso.js:48-65`). El razonamiento
  está escrito: *"aunque el nombre se resolviera al revés, un marcador final asimétrico no cuadraría"*
  (`:20-22`). El liquidador además rechaza `h1 > h || a1 > a` (`goal-engine/settlement.js:107`).
- **Tabla de rendimiento** (`futbol-derivadas.tabla()`, `:468-549`): una fila por familia con `liston_pp`,
  `error_cal_pp`, n/w/l/push, `units`, `roi_pct`, `hit_pct`, `clv_recortado_pct`, `clv_t_recortada`,
  `margen_lado_pct` (**mediana** de `over_pct`/2, nunca la media, `:492-494`), `clv_neto_pct`,
  `cierre_aporta`, `modelo_contra_precio` y `veredicto` — los tres últimos de `lib/vara.js`.
  Nota de método importante: `gano()` devuelve 1/0/null y **excluye las devoluciones**, porque en JavaScript
  `0.25` es verdadero y devolver 0.25 por un medio-perdida contaba como acierto — *"el test directo del
  hándicap decía ROI +5,19 % mientras las unidades decían −263"* (`:479-484`).

### 6.7 Lo que sigue FUERA, con su motivo (`futbol-derivadas.js:76-84`)

| Mercado | Motivo escrito |
|---|---|
| intervalos de "cuándo se marca" | necesita la tasa de gol dentro de la mitad; no medido |
| primer/último goleador (orden) | necesita el proceso temporal, no solo el conteo |
| goleador en cualquier momento | nivel jugador → prop-engine |
| córners derivados (hándicap, 1X2, último, 1T) | **correlación local-visita −0,249** y sobredispersión var/media 1,18 → dos Poisson independientes no valen |
| tarjetas derivadas (1X2, hándicap, puntos) | **correlación +0,201** y el visitante recibe más (cuota local 0,466) |
| total exacto por periodo | calculable pero con márgenes muy anchos |
| descanso/final en otras casas | solo Cloudbet → sin precio sin vig cruzado |

### 6.8 Ingesta de las familias nuevas

Las cuotas de las 15 familias nuevas las escribe el barrido de Cloudbet (`server.js:5595-5612`), con dos
salvaguardas declaradas: se pueden apagar con `GP_DERIV_NUEVAS=off` y **solo se escriben partidos dentro de
`GP_DERIV_NUEVAS_HORAS` (48 h)**, porque son ~100 filas más por partido sobre un barrido que ya tarda 191 s
(`server.js:5590-5594`). El giro de lado cuando el local de Cloudbet es nuestro visitante se hace con la
**única** función de giro que existe, `mitades.gira` (`goal-engine/mitades.js:313-346`), y los ids con
`mitades.idDe` (`:290-311`) — decisión explícita para que el signo no se quede atrás en un sitio
(`server.js:5584-5588`). En el hándicap, girar **no** cambia el signo de la línea, y el porqué está escrito
(`goal-engine/mitades.js:324-326`).

---

## 7. El proceso implícito (`implied-engine/`)

### 7.1 La idea y qué NO es

Traído de tenis de mesa: el 1X2 y el total salen de UN solo proceso (el par de tasas de gol); si se invierte
cada precio a ese proceso y no coinciden, **la casa se contradice a sí misma** — y eso es señal de PRECIO, no
opinión del modelo (`implied-engine/football.js:1-20`). *"Aquí no entra ninguna λ nuestra"* (`:18-20`); el
motor de goles solo aporta la FORMA (Poisson + DC).

Tres familias: `IMPLIED_TOTAL`, `IMPLIED_1X2` (tesis espejo) y `BOOK_DEV` (desviación de una casa frente a la
mediana de ≥3 casas, puro precio).

### 7.2 Mecánica

- **De-vig**: **Shin** por defecto para el 1X2 (tres vías) y proporcional para los pares
  (`implied-engine/football.js:32-56`, `:113`). El z de Shin se resuelve por punto fijo, 60 iteraciones.
- **Inversión 1X2 → (λh, λa)** (`:62-86`): bisección alternada sobre `T = λh+λa` (por el empate) y
  `s = λh/T` (por el reparto local), 10 rondas × 40 pasos. Se descarta el partido si `fit_err > 0.02` —
  *"un 1X2 que la Poisson no puede reproducir no se usa"* (`:117`).
- **Inversión total → λ_T** (`:89-96`): bisección de 45 pasos con el reparto `share` fijado por el 1X2.
- **Incertidumbre de la inversión** (`:118-124`): `uncT = min(5, 0.005/|∂p_empate/∂T|)` en goles, porque
  *"0,5 pp de precio del empate mueven T un gol entero"* y sin esto la incoherencia *"es ruido de precio
  amplificado (+14 pp en MLS)"*. De ahí sale `unc_total_pp = 100·|∂P(over)/∂T|·uncT`.
- **La línea de base es la del PARTIDO, no la del tablero** (v2, `:174-179`): se descuenta la **mediana** de la
  incoherencia entre las casas del mismo partido, con `n_books ≥ 3`. El motivo: en un partido muy desigual
  (Barcelona-Feyenoord) la Poisson+DC solo reproduce el empate del mercado con λ absurdas (5,5+0,6) y la
  incoherencia sale +14 pp **en todas las casas** — error de forma, no señal.
- **Autocomprobación** (`selfTest`, `:231-249`): un 1X2 generado por la propia Poisson debe volver a sus λ
  (`errL < 0.01`), un total coherente debe dar edge 0 (`< 0.6 pp`) y tres casas coherentes entre sí con
  márgenes distintos deben dar tesis ≈ 0. Se expone en `/api/internal/implicito` (`server.js:22314`).

### 7.3 La sombra (`implied-engine/sombra.js`)

Regla `implicito_v3`, congelada el 2026-09-09 (`implied-engine/sombra.js:20-32`):

| Parámetro | Valor | Efecto |
|---|---|---|
| `unc_ratio` | 0.75 | **la puerta**: se descarta si `edge_pp < 0.75 × unc_pp` (`:83`) |
| `edge_min_pp` | 3 | ventaja mínima |
| `edge_cap_pp` | 15 | por encima "es un error nuestro o una casa rota" |
| `odds_min` / `odds_max` | 1.25 / 6.0 | |
| `dev_min_books` | 3 | solo para `BOOK_DEV` |
| `baseline_min_obs` | 8 | observaciones mínimas para re-estimar la base global |
| `baseline_ema` | 0.7 | memoria de la base entre pasadas |
| `max_new_per_pass` | 60 | tope por pasada, **ordenado por ventaja descendente** (`:76`) |

Una tesis viva nacida con otra versión de la regla **se anula con motivo** en vez de mezclarse (`:72`).
Cierres por cubo contra `own`/`best`/`pinnacle` en la ventana de 95 min (`:107-123`); liquidación a partir de
150 min tras el saque y VOID a las 72 h (`:127-153`); track por familia y por familia+casa, con la curva de
cierre (`:170-185`). Doctrina escrita: *"Con < 150 liquidadas por familia todo es ruido"* (`:183`).

### 7.4 El cableado (`implied-engine/run-futbol.js`)

- Universo: eventos de `qevents` con saque en las próximas **48 h** (`:67`).
- Cuotas: `match_winner` + `match_total`, `is_live = FALSE`, `observed_at > now() − 6h`, agrupadas por
  (evento, casa) (`:29-45`). Una casa solo entra si tiene **los dos mercados** (`:54`).
- **Solo medias líneas (x,5)** en v1: la entera devuelve en el empate y la de cuarto parte el stake, y el
  liquidador no sabe de medias ganancias (`:50-53`). Las tesis nacidas antes de esa regla se anulan con
  `voidNonHalf` (`:18-26`).
- Liquidación: `IMPLIED_1X2` por el resultado; totales con `PUSH` si `total === line` (`:127-141`).

### 7.5 Cierres por cubo, transversales (`implied-engine/closes.js`)

Cubos `T60/T30/T10/T5/T1` con ventanas anchas a propósito (`:20-26`); una lectura por cubo, `last` siempre
refrescado. `clvPct(entry, close) = (entry/close − 1)·100`.

Dos piezas de auditoría del propio registro:
- **`rescatar`** (`:103-118`): el 11-sep se descubrió que la liquidación buscaba el CLV en `rows` (la última
  foto, machacada hasta 60 min DESPUÉS del saque, o sea con precios en vivo) y las familias CON línea se
  quedaban sin CLV (`GAMES_HCP 0/26`, `POINTS_TOTAL 4/62` frente a `ML 16/35`). El rescate lo reconstruye del
  cubo más tardío con precio y marca `clv_rescatado`.
- **`salud`** (`:123-135`): cuenta las tesis con dos o más cubos escritos **en la misma pasada** — en ellas
  *"la CURVA no se puede leer, el CLV sí"*.

---

## 8. El tablero de ventaja (`edge-board.js`)

### 8.1 Qué es y cuál es su unidad

Una sola pantalla para los ocho deportes con una sola vara. La razón está escrita: con ocho tableros separados
la pregunta se contesta de memoria, *"y de memoria se contesta mal — pasó con tarjetas, que se recordaba como
'+19 %' cuando ya era '+4,8 % con CLV negativo'"* (`edge-board.js:5-7`).

**La unidad es familia + lado + banda**, no la familia sola (`edge-board.js:18-20`, implementado en
`dePicks`, `:110-134`): para fútbol, `family | side | league_band`. Sumar tarjetas under en mercado blando con
tarjetas over en mercado eficiente *"fue exactamente el error que escondió la familia estrella durante
semanas"*.

### 8.2 El veredicto (`edge-board.js:50-76`)

| Constante | Valor |
|---|---|
| `N_MIN` | 30 liquidadas — por debajo no se juzga |
| `N_CONFIRMA` | 100 — mínimo para DESCARTAR |
| `SD_MIN` | 0.5 pp de dispersión del CLV |
| t de confirmación / descarte | +2 / −2 |

```
t    = clv / (clv_sd / √clv_n)
n*   = (2·sd/media)²          // muestra a la que ese CLV llegaría a t=2
```

Estados: `SIN_MUESTRA` (n<30) · `SIN_CLV` (menos de 30 con cierre) · **`SIN_MOVIMIENTO`** (sd < 0.5 pp: *"no
hay movimiento contra el que medirse […] es un libro quieto"*, guarda contra el falso positivo que apareció en
córners under de ligas intermedias) · `CONFIRMADA` (t≥2, clv>0) · `PROMETE` (t≥1, clv>0, con
`faltan_liquidadas`) · `DESCARTAR` (t≤−2 y n≥100) · `EN_CONTRA` (t≤−1) · `PLANA`.

### 8.3 Cortes por casa (`edge-board.js:99-107`, `:236-283`)

El mismo tablero, agrupado además por casa, porque *"CS2 hándicap de rondas daba +2,44 % de media y era
+3,53 % en la afilada y −3,13 % en la única conectable por API"* (`:96-98`). Casas conectables por API:
`cloudbet, polymarket, kalshi, myriad` (`:239`). De ahí salen dos listas: `ejecutable_con_ventaja`
(conectable, CLV>0, `clv_n ≥ 10`) y `ventaja_inalcanzable` (no conectable, t≥1, `clv_n ≥ 10`).

### 8.4 Qué fuentes de fútbol entran

- `db.dailyPicks` + `db.clubDailyPicks` liquidadas con WIN/LOSS (`:144-154`), con `clvDe = pickClvNum`
  (`server.js:7318`), `ladoDe` y `bandaDe = p.league_band`.
- Las **derivadas** entran como deporte `futbol-deriv` desde `futbol-derivadas.track().by_family` (`:190`).
- El **objetivo** incluye `futbol_tarjetas` (CARDS under) y `futbol_corners` (CORNERS over) (`:29`, `:35`).
- El proceso implícito **no está cableado a `edge-board`** (no encontrado en el código): se lee por
  `/api/internal/implicito`.

Endpoint: `/api/internal/edge-board?key=` (`server.js:22496-22503`), con filtro `n ≥ 5` salvo `?full=1`.

---

## 9. La vara (`lib/vara.js`, `lib/margen.js`) aplicada al fútbol

### 9.1 Las tres piezas del CLV

`lib/vara.js:9-16`: **recorte** (media recortada al 10 % por cola, `recorta`, `:25`), **semana**
(`semanal`, `:42-50`) y **neto** (menos el margen por lado). El ejemplo que justifica el recorte está en el
encabezado: CS2 en Pinnacle pasaba de "+2,82 % a +0,05 %" en crudo y de "+2,04 → +1,80 → +0,68 → +0,55 con t
entre 2,7 y 4,5" recortado, porque *"hay un CLV de +148 % en cloudbet, que es un cierre roto"* (`:5-8`).

### 9.2 Las dos pruebas de método

**`cierreAporta`** (`lib/vara.js:77-95`) — ¿el cierre predice mejor que nuestra entrada? Test pareado de Brier
sobre las mismas liquidadas, con las implícitas desvigadas por `overPct`:

```
d_i = (dv(odds_entrada) − y)² − (dv(odds_cierre) − y)²      // > 0 ⇒ el cierre acertó más
aporta = |t| ≥ 2 && t > 0        (n ≥ 40; por debajo "muestra corta para saberlo")
```

También devuelve `sin_mover_pct`: el porcentaje de apuestas en que el cierre es idéntico a la entrada. El
comentario da los números medidos: *"lo es en el 78,8 % de los totales de tenis de mesa, el 60 % de los
hándicaps de bovada y el 55 % de los kills"* (`:70-71`).

**`modeloContraPrecio`** (`:100-116`) — la vara de repuesto: Brier pareado entre `p_modelo` y `1/odds`, más el
ROI observado y su t. *"Aquí NO hay que restar margen: el ROI y el acierto ya están medidos contra lo que de
verdad pasó"* (`:97-99`).

### 9.3 El veredicto (`lib/vara.js:122-165`)

`MIN_N = 100`, `MIN_T = 2`. El orden importa: **primero se pregunta si la vara sirve**.

| Veredicto | Condición |
|---|---|
| `clv_no_aplica` | el cierre no aporta y no hay muestra para la prueba directa |
| `cerrar` | el cierre no aporta y el PRECIO acierta más que el modelo (t ≤ −2) |
| `invertible_por_acierto` | el cierre no aporta pero el modelo acierta más (t≥2) y ROI>0 con t_roi≥2 |
| `sin_evidencia` | el cierre no aporta y la prueba directa empata |
| `sin_margen_medido` | no hay las dos caras guardadas → no se puede saber cuánto cobra la casa |
| `muestra_corta` | n < 100 |
| `no_invertible` | CLV neto ≤ 0 (*"Ganar al cierre no es ganar dinero"*) |
| `en_observacion` | neto > 0 pero t < 2 |
| `invertible` | neto > 0, t ≥ 2, n ≥ 100 → `tamano()` = ¼ Kelly |

### 9.4 El margen (`lib/margen.js`)

`sobre_redondeo = 1/o_A + 1/o_B − 1`, el **margen por lado es la mitad**, y se usa la **mediana** porque
*"los archivos tienen capturas sueltas con una cara vieja que disparan el sobre-redondeo"* (`:82-84`).
Filtro de cordura: se descartan pares con `over ∉ (−0.02, 0.6)` (`:71`). En hándicaps la clave indexa por
**valor absoluto** de la línea (+2.5 y −2.5 son el mismo mercado) y en totales por la línea tal cual
(`:32-42`). Si solo hay una cara, devuelve `null` — *"Un margen supuesto es peor que ninguno"* (`:18-20`).
Margen de fútbol medido y citado en `CLAUDE.md`: **total de goles 0,69 %** (el mercado más barato y por tanto
el peor sitio donde buscar ventaja).

En fútbol, `lib/vara` se aplica por dos caminos: la tabla de `futbol-derivadas` (`futbol-derivadas.js:496-522`)
y, en `/api/internal/vara`, los segmentos del ejecutor en la sombra (`server.js:25314-25323`), donde
`cards_under_v1` no tiene archivo de cierres con las dos caras y por eso su margen sale `null` — *"que es
justo el punto de este endpoint"* (`server.js:25312-25313`).

---

## 10. Variables de entorno relevantes al fútbol

| Variable | Default | Efecto | Ref |
|---|---|---|---|
| `GP_DAILY_PICKS_ENABLED` | off | maestro de picks diarias | `server.js:4593` |
| `GP_CLUBS_SHADOW_ENABLED` | off | maestro del pipeline de clubes | `server.js:4762` |
| `GP_CLUBS_SWEEP_MIN` | 12 | minutos entre barridos de cuotas | `server.js:4769` |
| `GP_QUOTES_ALL_SOCCER` | on | capa AUTO de ligas no configuradas | `server.js:4747` |
| `SPORTSBOOK_PROVIDER_API_KEY` | — | The Odds API | `server.js:4764` |
| `SPORTSBOOK_QUOTA_RESERVE` | 2000 | reserva de créditos (props frena a 3×) | `server.js:4688` |
| `GP_PUBLIC_SEGMENTS` | `CARDS:under,SOLID,GOALS,CORNERS,COMBO` | segmentos publicables | `server.js:7249` |
| `GP_GATE_OVERRIDE_SEGMENTS` | — | salta el stop-loss de un segmento | `server.js:7365` |
| `GP_SOLID_C` | **0** | peso del Elo como desviación del consenso en el 1X2 | `server.js:8650` |
| `GP_CUP_TIER_GAP_ELO` | 150 | prior Elo por nivel de división en copas | `server.js:4706` |
| `GP_CORNERS_REF` / `GP_CORNERS_REF_K` | off / prior del backtest | aplica el efecto del árbitro a córners | `server.js:6127-6128` |
| `GP_PICKS_ERA` | `v2-2026-09-02` | marca de era en el track | `server.js:6386` |
| `GP_DERIV_NUEVAS` | on | familias del censo 13-sep en el barrido de Cloudbet | `server.js:5743` |
| `GP_DERIV_NUEVAS_HORAS` | 48 | ventana de escritura de esas familias | `server.js:5744` |
| `GP_DERIV_TOPE_DESCANSOS` | 30 | búsquedas de marcador al descanso por pasada | `futbol-derivadas.js:389` |
| `MARKET_SCANNER_MIN_GROUPS` | 4 | grupos independientes mínimos del consenso | `market-scanner/config.js:37` |
| `MARKET_SCANNER_MAX_QUOTE_AGE_MS` | 30 min | frescura del scanner | `market-scanner/config.js:39` |
| `VALUE_ENGINE_ENABLED` / `_WRITE_ENABLED` / `_SCHEDULER_ENABLED` | off | value engine y su dry-run | `value-engine/config.js:15-26` |
| `VALUE_STRONG_MIN_ADJUSTED_EDGE_PP` | 0.035 | umbral STRONG | `value-engine/config.js:66` |
| `VALUE_MIN_SPORTSBOOK_SOURCES` / `VALUE_MIN_INDEPENDENCE_GROUPS` | 3 / 3 | | `value-engine/config.js:72-73` |
| `PICKS_AUTO_PUBLICATION_ENABLED` | irrelevante | **invariante: bloqueada siempre** | `value-engine/config.js:36-37` |
| `GP_EXPORT_KEY` | — | llave de todas las sondas internas | `server.js:22270` etc. |
| `DB_FILE` | `./db.json` | su directorio ancla `derivadas/` e `implicito/` | `futbol-derivadas.js:87`, `implied-engine/sombra.js:35` |

---

## 11. Debilidades, supuestos y riesgos VISIBLES en el código

Se listan separando lo que el propio código admite de lo que se deduce leyéndolo.

### 11.1 Admitidas en comentarios (y por tanto ya conocidas)

1. **El de-vig de las derivadas v1 nunca funcionó** entre el 20-ago y el 13-sep: `twoWayNoVig` recibía números
   en vez de objetos y devolvía `null` siempre (`futbol-derivadas.js:238-249`). Toda la muestra v1 se valoró
   contra la cuota cruda. Empuja al lado seguro, pero la ficha de la regla no describe la muestra que produjo.
2. **La v1 apila posiciones correlacionadas** del mismo partido y familia (`futbol-derivadas.js:310-312`), lo
   que infla el estadístico de su propio tablero.
3. **El error de calibración de las mitades se midió con λ resueltas del CIERRE de Pinnacle**, no con las λ que
   el motor usa en producción (`goal-engine/mitades.js:28-33`, `:84-86`). El listón por familia hereda ese
   supuesto: es el error de la *estructura de mitad*, no el error del *modelo completo*.
4. **`descansoFinal` asume mitades independientes** y el sesgo tiene signo conocido: el modelo se queda corto
   en las remontadas (`goal-engine/mitades.js:218-220`).
5. **`refreshClubPickPrices` reescribe `best_odds`** en las 2 h previas, y el track a esa cuota daba ROI de
   SOLID 4-6 pp mejor de lo real (`server.js:9617-9619`). Sigue existiendo `pnl` a `best_odds` junto a
   `pnl_at_create`, así que el número "bonito" sigue publicándose al lado del honesto.
6. **El stop-loss juzga con picks `monitor` incluidas** — se evaluó y se descartó cambiarlo, con el
   razonamiento escrito (`server.js:7326-7330`): sin ellas `CARDS|under` se quedaba con n=28 y sin freno.
7. **`clubFamilyStopped` no aplica CLV a props ni a `lead`** (`server.js:7353-7357`): en esas familias el único
   juez es el resultado, que es exactamente lo que `lib/vara.js` llama "el ROI es lo último en enterarse".
8. **`officialClubRecord` aplica el esquema actual retroactivamente** (`server.js:9578-9583`), lo que es una
   forma de selección hacia atrás: el cuadro "oficial" pasó de 102→66 picks de clubes y de −6,43 u a +2,36 u
   al aplicarlo.
9. **`GP_SOLID_C = 0` deja el ramal `lead` sin picks por construcción** (`server.js:8646-8648`). Es decir, el
   1X2 de ligas blandas está efectivamente apagado aunque la banda siga existiendo en el código y en la UI.
10. **Los props de jugador usan una mediana implícita CON vig** (`pick-engine/curate.js:234-236`,
    `server.js:8434-8435`): el blend sobreestima 3-5 pp parejo, y el `edge_pp` que publica esa familia es
    informativo, no medible.
11. **El CLV de fútbol se calcula con de-vig proporcional al cierre mientras la entrada usa Shin**
    (`server.js:9530-9533`): la comparación mezcla dos métodos, y se conserva a propósito para no romper la
    serie histórica.
12. **La curva por cubo de muchas tesis no se puede leer** porque varios cubos se escribieron en la misma
    pasada antes del 11-sep (`implied-engine/closes.js:123-135`).
13. **`cs2`, `nfl`, `dardos` y `tt` están en sombra y el fútbol de clubes es lo único con dinero real**
    (`CLAUDE.md`, "LA REGLA DEL DINERO"): solo `cards_under_v1` (~258 USDT) y tenis de mesa a 5 USD.

### 11.2 Deducidas de la lectura (no señaladas en el código)

14. **Sesgo de selección en la banda de eficiencia.** `leagueEfficiency` calcula el Brier del mercado **sobre
    las picks que nosotros hicimos** (`server.js:7289-7292`), no sobre una muestra aleatoria de la liga. Los
    lados elegidos son precisamente aquellos donde el modelo discrepaba del precio, así que el Brier medido no
    es el del mercado de la liga: es el del mercado *en los sitios donde apostamos*. Y esa banda decide
    régimen, publicación y entrada de dinero real.
15. **`leagueEfficiency` tiene efectos secundarios dentro de un getter**: escribe `db.leagueBand` y emite
    `opsLog` (`server.js:7293-7298`). Se la llama dentro de bucles por pick (`server.js:8653`, `:8756`,
    `:8836`, `isPublicSegment` en `:7315`), y cada llamada recorre **todo** `db.clubDailyPicks`. Es O(picks ×
    ligas) por ciclo y, peor, un cambio de banda puede quedar registrado a mitad de una generación y aplicarse
    de forma distinta a dos picks del mismo ciclo.
16. **Doble puerta de régimen con reglas duplicadas.** La misma lógica de `anchor/edge/monitor` está escrita
    dos veces —en la generación (`server.js:8846-8864`) y en `reclassifyClubSegments`
    (`server.js:10223-10249`)— y el propio código documenta dos ocasiones en que una quedó atrás respecto de la
    otra. Es una fuente estructural de divergencia silenciosa.
17. **El consenso de córners/tarjetas puede ser de UNA sola casa**: `noVig.consensus(..., {minGroups: 1})`
    (`server.js:8509`). Con una casa, el "consenso sin vig" es el precio de esa casa desvigado contra sí mismo,
    y el `edge_pp` que alimenta el listón de 4 pp mide modelo-contra-esa-casa, no modelo-contra-mercado. La
    familia con dinero real vive en ese régimen.
18. **`clubGoalsFit` se re-ajusta cada 30 minutos con la temporada completa** (`server.js:5798-5818`). Para
    picks prospectivas no hay *look-ahead*, pero cualquier backtest que use el fit vigente sobre partidos ya
    incluidos en él sí lo tendría. No se encontró en el código una marca temporal del fit que impida ese uso.
19. **`futbol-derivadas.settle` puede dejar picks colgadas para siempre**: si `settlement.settle` devuelve
    `'void'` por incoherencia (`h1 > h`), se cuenta como `esperando_descanso` y se reintenta
    (`futbol-derivadas.js:427`), pero el corte de 72 h solo se evalúa en las ramas de "sin marcador" y "sin
    descanso" (`:403`, `:419`), no en esta.
20. **`contrario()` devuelve `null` para `double_chance` del partido completo** y `MASA_MULTIVIA`
    (`futbol-derivadas.js:144`) solo declara `h1_double_chance`. Resultado: la doble oportunidad de partido
    completo (familia v1) se valora contra la implícita cruda, con el margen entero dentro, y su
    `margen_lado_pct` sale `null` para siempre → veredicto `sin_margen_medido`. Está admitido a medias en
    `:131-133`, pero la consecuencia sobre la tabla no.
21. **`BOOK_DEV` usa `unc_pp = 0.5` hardcodeado** (`implied-engine/football.js:221`), un número que no viene de
    ninguna medición; con la puerta `edge ≥ 0,75 × unc` eso equivale a no tener puerta para esa familia
    (el listón efectivo es 0,375 pp contra un `edge_min_pp` de 3).
22. **La sombra implícita solo guarda tesis que YA pasaron la puerta** y les escribe `unc.passes = true`
    (`implied-engine/sombra.js:92`). `splitByGate` sobre ese archivo no puede comparar "con puerta" contra "sin
    puerta" — la comparación que justifica la puerta no es computable con lo que se guarda.
23. **El `edge_cap` de 15 pp es un veto silencioso**: en derivadas (`futbol-derivadas.js:295`) y en el
    implícito (`implied-engine/sombra.js:82`) se descarta sin registrar cuál era la tesis. Si el veto estuviera
    mal calibrado, la evidencia para saberlo no se guarda (solo el contador `vetadas`).
24. **`clubTeamGames` devuelve los partidos del RATING, no de la proyección** (`server.js:6395-6400`), y se usa
    como muestra para `unc_pp` en SOLID/GOALS (`server.js:8785-8786`). Un equipo con 38 partidos de rating
    puede tener una λ de goles estimada con muy pocos partidos con xG; la incertidumbre etiquetada será
    optimista.
25. **La cobertura de las familias v2 depende de dos ventanas encadenadas**: Cloudbet solo escribe a ≤48 h
    (`server.js:5597`) y `derivadas.record` solo lee cuotas de ≤6 h (`futbol-derivadas.js:163`). Con el job
    cada 20 min eso está bien, pero una caída del barrido de Cloudbet deja a las 15 familias nuevas sin
    inventario sin que ningún contador lo distinga de "no había mercado".
26. **`/api/internal/vara` no cubre las picks públicas de clubes** (`server.js:25282-25323`: esports, tenis de
    mesa, dardos y los segmentos del ejecutor en la sombra). Las familias del feed de fútbol se juzgan por
    `edge-board` (CLV + t, sin restar margen) y por `clubDailyPicksTrackRecord` (ROI). La vara que el proyecto
    declara como oficial —CLV neto de margen con las dos pruebas de método— **no se aplica hoy a SOLID, GOALS,
    CORNERS ni CARDS en el feed**, solo a sus equivalentes en la sombra del ejecutor.
27. **`dailyPicksTrackRecord` cuenta stake 1 u por pick** (`server.js:7210-7222`) mientras la pick publica un
    `stake_pct` de ¼ Kelly (`server.js:8833`). El ROI publicado y el que obtendría un usuario que siga el
    sizing recomendado no son la misma magnitud.
28. **Ningún camino de fútbol consume `value-engine/candidateFactory`**: las picks de clubes se construyen en
    `server.js` con su propio consenso y su propio de-vig. El value engine queda como un segundo sistema
    paralelo, con umbrales distintos (`strongEdge 0.035` frente al 2 pp post-blend de clubes) y sin conexión
    con el feed. Es deuda de arquitectura, no un error.

---

## 12. Sondas para auditar cada pieza

| Endpoint | Qué devuelve | Ref |
|---|---|---|
| `/api/internal/futbol-derivadas?key=[&run=1][&tabla=1]` | pasada + track completo, o solo la tabla por familia con veredicto de `lib/vara` | `server.js:22269-22278` |
| `/api/internal/implicito?key=[&run=1][&hoops=1][&buckets=1]` | track del proceso implícito, `selfTest` de los dos inversores y el bloque `tt_transfer` de clubes | `server.js:22304-22319` |
| `/api/internal/edge-board?key=[&full=1]` | el tablero de familias de los ocho deportes, `por_casa`, `ejecutable_con_ventaja` | `server.js:22496-22503` |
| `/api/internal/vara?key=&bankroll=&min=` | veredicto de invertibilidad por familia (esports, TT, dardos, sombra) | `server.js:25257-25342` |

---

*Documento generado por lectura directa del código. Ninguna métrica de resultados vivos (ROI, CLV, n) se
transcribe aquí salvo las que están escritas como constantes o comentarios en el propio repositorio; las
tablas de rendimiento reales viven en los endpoints de arriba y en los artefactos de `data/`.*

---

# Parte 3 · Esports: motor común, CS2, Valorant y Dota 2

> Alcance de esta sección: el núcleo compartido de los cuatro juegos (`esports-engine/core.js`), los tres
> motores CS2 / Valorant / Dota 2 y sus capas de datos, el mostrador de casas (`data-providers/esports/*`),
> la capa que convierte modelo en pick, la liquidación y la medición (`esports-engine/store.js`, `lib/margen.js`,
> `lib/vara.js`, `implied-engine/*`), y el canal de dinero real de CS2 (pausado). **LoL y las props de jugador
> las cubre otro lector y no se repiten aquí.** Todo lo afirmado sale del código o de los documentos citados;
> donde algo no está, se dice "no encontrado en el código".

---

## 3.0 Mapa general: qué es, para quién, en qué estado

| Aspecto | Estado (código) |
|---|---|
| Deporte | "Esports", 5º deporte de la casa; cuatro juegos con **un motor por juego** despachado en `ENGINES` (`store.js:43-49`): `cs2`, `lol`, `valorant`, `dota2`. Orden fijo `GAME_ORDER` (`store.js:49`). |
| Público / admin | Toda la ruta `/api/esports/*` devuelve 404 salvo admin o `GP_ESPORTS_PUBLIC_ENABLED` verdadero (`server.js:20969-20972`). Con público encendido hay tres tiers: free (pizarra/fichas/catálogo), pro (picks, brief, sim), sharp (props, evidencia, arbitraje/middles/caídas) (`server.js:20973-21004`). Los POST de liquidación/snapshot son siempre admin (`server.js:20983-20985`). |
| Sombra / real | Todas las picks viven en SOMBRA (`picks-<juego>.json` en disco persistente, `store.js:84-88`) con etiqueta `regime: 'monitor'` (`store.js:1064`). Solo una familia entró al dinero: `cs2_rounds_v1` (CS2 · `RONDAS_HANDICAP`) por el ejecutor real, **pausada desde el 7-sep** (`GP_REAL_CS2_ENABLED=false`, `real-executor/store.js:1126-1129`; HANDOFF.md:712-713). |
| Derechos | Valorant y Dota 2 llevan `RIGHTS.md` con clase `research_only`: "NINGUNA pick pública nace de aquí" (`data/esports/valorant/RIGHTS.md`, `data/esports/dota2/RIGHTS.md`). CS2 nace de bo3.gg, cuyo `robots.txt` "desaconseja el acceso automatizado a `/api/`" (`data-providers/esports/bo3.js:18-24`). |
| Doctrina de familias | Las picks solo salen de `PICK_FAMILIES` (`store.js:63-68`): `TOTAL_MAPAS, HANDICAP, RONDAS, RONDAS_EQUIPO, RONDAS_HANDICAP, PRORROGA, KILLS, KILLS_EQUIPO, KILLS_HANDICAP, KILLS_DNB, SERIE`. `SERIE` entra "con prior en contra" y queda vetada por ortogonalidad cuando ancló la probabilidad (`store.js:51-77`). `MAPA`, `MARCADOR` y `PAR_IMPAR` se leen pero nunca generan pick. |

La frase que define la arquitectura está en la cabecera de `core.js:11-18`: *"el mercado de GANADOR es donde se pierde dinero y los mercados DERIVADOS son donde hay señal … la fuerza de los equipos se ANCLA al consenso del mercado, y el motor solo manda donde aporta estructura que el precio no tiene — el reparto por mapa, la duración, las rondas y los kills"*.

---

## 3.1 Fuentes de mercado: tres casas, un mostrador (`data-providers/esports/books.js`)

### 3.1.1 Casas, endpoints y frecuencia

| Casa | Módulo | Endpoint | Papel declarado | Disponibilidad |
|---|---|---|---|---|
| Cloudbet | `cloudbet.js` | `https://sports-api.cloudbet.com/pub/v2/odds` (`cloudbet.js:22`): `/fixtures?sport=<key>&date=<día>` día a día (`:58-83`, freno 220 ms), `/events/<id>` para mercados (`:150-196`) | "cobertura: la única presente en los cuatro juegos" (`books.js:39`) | requiere `CLOUDBET_API_KEY` (`books.js:37`) |
| Pinnacle | `pinnacle.js` | `https://guest.api.arcadia.pinnacle.com/0.1` (`:28`), deporte 12 (`:29`), clave de invitado pública sobreescribible por `PINNACLE_GUEST_KEY` (`:33`); ligas → `/leagues/<id>/matchups` (`:70-92`, freno 150 ms); mercados `/matchups/<id>/markets/related/straight` (`:145`) y `/related` para el hijo de kills en MOBA (`:154-159`) | "referencia: márgenes bajos … su cierre es el baremo del CLV" (`books.js:45`); `sharp: true` | siempre "ready" (`books.js:44`) |
| Bovada | `bovada.js` | `https://www.bovada.lv/services/sports/event/coupon/events/A/description/esports/<juego>` (`:29-33,59`); detalle por `provider_ref` = enlace del evento (`:169-175`) | "anchura: prórroga, par/impar, kills y marcador exacto" (`books.js:51`) | siempre "ready" |

`GP_ESPORTS_BOOKS` (lista separada por comas) apaga casas sin desplegar (`books.js:57-61`). Se probaron 26 proveedores el 16-ago y el registro queda en `BOOKS_PROBED` (`bovada.js:231-240`): The Odds API sin esports, Kalshi sin esports, Polymarket solo futuros de torneo, PandaScore/Abios/BetsAPI con clave, el resto bloqueado por Cloudflare o portal.

**Conversión de precios.** Pinnacle publica en americano y se convierte con `amToDec`: `n>0 → 1+n/100`, `n<0 → 1+100/−n` (`pinnacle.js:118-122`); el comentario advierte que confundirlo "da una ventaja inventada del orden de 10 pp en cada favorito".

### 3.1.2 Taxonomía de familias por casa

Las tres casas se normalizan a la misma fila `{family, family_label, period, map, team, line, side, odds, max_stake, book}`:

- **Cloudbet** mapea por clave de mercado (`FAMILIES`, `cloudbet.js:115-134`): `winner→SERIE`, `map_winner→MAPA`, `map_handicap/handicap→HANDICAP`, `total_maps/totals→TOTAL_MAPAS`, `correct_score_in_maps→MARCADOR`, `map_total_kills→KILLS`, `map_team_total_kills→KILLS_EQUIPO`, `map_kill_handicap→KILLS_HANDICAP`, `map_kill_draw_no_bet→KILLS_DNB`, `total_rounds/map_total_rounds→RONDAS`, `map_team_total→RONDAS_EQUIPO`, `map_round_handicap→RONDAS_HANDICAP`, `map_will_there_be_overtime→PRORROGA`, `map_odd_even_rounds→PAR_IMPAR`. La línea vive en `sel.params` (handicap/total), no en la clave del submercado (`:165-173`).
- **Pinnacle** mapea por `(type, period, juego)` (`familyOf`, `pinnacle.js:133-141`): periodo 0 = serie (`moneyline→SERIE`, `spread→HANDICAP`, `total→TOTAL_MAPAS`); periodo N = mapa N; en shooters `spread→RONDAS_HANDICAP`, `total→RONDAS`, `team_total→RONDAS_EQUIPO`; en MOBA (`lol`, `dota2`) esas mismas claves son `KILLS_HANDICAP`, `KILLS`, `KILLS_EQUIPO` (`:132`). Los bloques con `matchupId` distinto del padre se descartan salvo el hijo de kills (`:162-169`).
- **Bovada** mapea por la terna (grupo, descripción, ¿serie?) (`familyOf`, `bovada.js:104-129`): `Kill Props`→`KILLS`/`KILLS_HANDICAP`; `Map Props`→`PRORROGA`/`PAR_IMPAR`; `Match Props/Correct Score`→`MARCADOR`; `Game Lines`/`Alternative`→ moneyline/spread/total según serie o mapa. Player props se ignoran (`:186`).

**Convención de la línea, común a todo el motor:** *"la línea es SIEMPRE la del local"* (`pinnacle.js:176-189`, `bovada.js:163-167,200`, `store.js:587-593`). En un hándicap, el lado `away` juega la negación de esa línea. El comentario de `store.js:587-593` documenta la comprobación con un partido real (BASEMENT BOYS vs INOX) y advierte que leerlo al revés fabricaba "una ventaja de 38,8 pp".

### 3.1.3 Fusión de agendas e identidad canónica

`slate()` (`books.js:92-166`) pide las tres agendas en paralelo y funde eventos por `pair_key` (par de equipos normalizados) y hora de inicio con tolerancia `NEAR_MS = 8 h` (`:85`). La clave de equipo sale de `teamKey` (`:78-82`): si hay resolutor propio (solo CS2, `store.js:115-118`) es `gp:<id>`; si no, `norm()` (`:68-69`, quita `esports|gaming|team|club|cs2|the`) más una tabla corta `ALIAS` (`:73-77`: `nip, navi, na, tl, vit, g2esports, mouz, faze, …`).

El **id canónico** es `${game}:${YYYY-MM-DD}:${pair}` (`canonicalId`, `:173-176`), con la hora más temprana entre casas (`:147-153`). El comentario `:133-143` explica que la primera versión (id de Cloudbet cuando lo tenía) "cambiaba de id entre pasadas" y dejaba el CLV "SIEMPRE NULO". Migraciones de un solo uso re-indexan picks y cierres (`store.js:1363-1414`).

### 3.1.4 Orientación local/visitante — la guardia de precio

Cada casa elige su "local". `markets()` (`books.js:210-279`) reorienta cada fila si `teamKey(home_de_la_casa) ≠ teamKey(home_fundido)` (`orient`, `:193-208`: cambia `side`, `team`, invierte el marcador exacto y **niega la línea** en `HANDICAP/RONDAS_HANDICAP/KILLS_HANDICAP`). Como el nombre "ya falló" (arbitraje del +269 % el 19-ago), hay una **segunda pasada por precio** (`:226-265`): se calcula la probabilidad del local sin margen de cada casa sobre sus mercados de dos salidas; la casa con más mercados (a igualdad, la afilada) es referencia, y a otra casa se le da la vuelta si `|inv − ref| < |dir − ref| − 0,15` (`:259-262`).

`orientationCheck` (`:382-418`) bloquea todas las superficies cruzadas de un partido si dos casas discrepan en más de `ORIENT_MAX_PP = 25` puntos (`:381`). `retireCrossedPicks` (`store.js:1494-1519`) cierra como `SUPERSEDED` (0 unidades) las picks nacidas en eventos así.

### 3.1.5 Superficies que no pasan por el modelo

`crossBook` (`books.js:287-341`) agrupa por `(familia, mapa, equipo, línea)` y publica por lado: casas, mejor precio, mediana de la implícita, dispersión en pp; consenso sin margen y arbitraje solo en mercados de **dos** lados (`:322-333`). `arbitrages` exige casas distintas y techo `ARB_MAX_PCT = 8 %` (`:349-361`). `middles` con hueco mínimo por familia (`MIDDLE_GAP`, `:432-433`: 1 mapa, 2 rondas/kills) y coste ≤ 6 % (`:436`). `dropping` compara la apertura guardada contra ahora **solo en la casa afilada** con caída ≥ 5 % (`:497-538`).

---

## 3.2 El núcleo común (`esports-engine/core.js`)

### 3.2.1 Sin margen y consenso

- `noVig(prices)` (`core.js:32-38`): normalización proporcional `p_i = (1/o_i) / Σ(1/o_j)`; devuelve también `overround = Σ − 1`. **Es el único devig del deporte** (proporcional; no Shin, no potencia).
- `consensus(rows, sides)` (`:42-55`): **mediana** de la implícita por lado entre casas, renormalizada; el comentario justifica la mediana porque "una casa dormida con un precio viejo mueve una media y no mueve una mediana".

### 3.2.2 El ancla: de dónde sale P(serie) (`marketAnchor`, `core.js:65-143`)

Orden de preferencia, cada escalón declara `from`:
1. `SERIE` (≥2 filas): consenso directo (`:69-73`).
2. `MARCADOR` (≥3 marcadores `x:y`): se suman las implícitas de los marcadores donde gana el local sobre el total (devig multi-resultado) (`:77-88`).
3. `HANDICAP` de mapas (≥2 filas): se toma la línea de menor |valor|, se saca el consenso y se **invierte la simulación de serie por bisección** (16 pasos, 4.000 sims, semilla 733) hasta que P(local cubre) reproduce la implícita; la serie sale de simular esa p por mapa con 8.000 sims (`:92-126`). El comentario `:94-101` documenta el fallo del signo (agrupar por `Math.abs(line)` daba "un favorito del 62 % donde el mercado decía 90 %" y "una ventaja de 41 pp que no existía").
4. `MAPA` (ganador del primer mapa cotizado): consenso → serie por simulación (`:130-141`).

### 3.2.3 Anclaje del modelo al mercado

```
w = clamp( maxModel · n / (n + nFull), 0, maxModel )      nFull = 60, maxModel = 0,45
p = marketP · (1 − w) + modelP · w
```
(`anchoredProbability`, `core.js:150-159`). Sin mercado → solo modelo (`w=1`); sin modelo → solo mercado. `eloProbability(ra, rb) = 1/(1+10^((rb−ra)/400))` (`:162-165`).

### 3.2.4 Simulación de serie

`simulateSeries(pMapA, bo, {momentum=0,06, perMap, n=20.000, seed=17})` (`:172-199`): Monte Carlo al mejor de N con **momento explícito**: quien gana el mapa anterior llega con `+0,06` y quien lo pierde con `−0,06` sobre la p del siguiente mapa; si se pasa `perMap`, manda la lista y se ignora `pMapA` (`:181`). Devuelve `p_series_a`, distribución de marcadores, `expected_maps`. `seriesToMap` (`:203-211`) invierte por bisección (18 pasos, 4.000 sims, semilla 991). El generador es un PRNG mulberry32 determinista (`rng`, `:320-328`).

### 3.2.5 Ventaja, listón y "no pick"

`evaluateEdge({pGp, odds, uncertaintyPp=6, minEdgePp=3, marketBooks, freshMin})` (`:225-247`):
```
pMarket = 1/odds                       ← CON margen (no se quita aquí)
edgePp  = (pGp − pMarket)·100
bar     = minEdgePp + (marketBooks < 2 ? 2,5 : 0)      SINGLE_BOOK_PENALTY_PP = 2,5  (:223)
NO PICK si edgePp < bar
NO PICK si edgePp < 0,75 · uncertaintyPp               (:235)
NO PICK si freshMin > 90                               (:236)
```
`confidenceOf` (`:249-262`) es solo etiqueta (estabilidad `1 − unc/18`, profundidad `books/4`, tamaño `|edge|/10`).

### 3.2.6 Incertidumbre epistémica

`uncertainty({p, sampleMatches, marketBooks, missing})` (`:267-283`):
```
sampleTerm  = 14 / √max(1, sampleMatches)
marketTerm  = 1,5 (≥3 casas) · 3,5 (≥1) · 6 (0)
missingTerm = 2,2 · |missing|
epistemic_pp = √(sample² + market² + missing²)
aleatoric_pp = √(p(1−p))·100  (se publica, no gobierna)
```

### 3.2.7 Distribuciones consultables

`histOf` construye el histograma de una simulación; `pOver/pUnder` leen la masa por encima/abajo de una línea; `pHandicap(d, line)` cuenta `win` y `push` (empate exacto) y devuelve `win/(1−push)` (`:300-318`). El comentario `:295-299` explica que se lee el histograma "sea cual sea la línea" para no interpolar colas.

---

## 3.3 COUNTER-STRIKE 2

### 3.3.1 Propósito y alcance

Motor `esports-engine/cs2.js` + base propia `cs2-data.js`. Familias cotizadas: `SERIE, MAPA, HANDICAP, TOTAL_MAPAS, RONDAS, MARCADOR`; familias de ventaja declaradas `TOTAL_MAPAS, RONDAS, HANDICAP` (`cs2.js:36-44`). En la práctica las picks del track salen de `RONDAS`, `RONDAS_HANDICAP`, `RONDAS_EQUIPO`, `PRORROGA`, `TOTAL_MAPAS`, `HANDICAP` (todas en `PICK_FAMILIES`). Cabecera honesta: "GP **no tiene acceso a demos todavía** … NO hay heatmaps, ni posiciones, ni tiempos de rotación" (`cs2.js:12-18`).

### 3.3.2 Datos históricos: cosecha bo3.gg

- Proveedor `data-providers/esports/bo3.js`: `https://api.bo3.gg/api/v1` (`:30`), 100 filas/página (`:32`), freno 260 ms (`:33`). Colecciones: `matches` (status finished, tiers `s,a,b,c`, `:77-84`), `games` (state done, `:90-96`), `teams`, `players`, `tournaments`, `maps`. Cifras medidas el 16-ago en la cabecera: 78.804 partidos, 142.139 mapas, 8.359 equipos (`:8-14`).
- Script `scripts/cs2-harvest.js`: crudo al disco persistente `<dir(DB_FILE)>/esports/cs2-raw/` y agregados al repo `data/esports/cs2/` (`:7-13, 26-34`). Incremental desde `meta.last_match_at` (`:48-50`).
- Cobertura real del agregado (`data/esports/cs2/meta.json`, fechado 2026-08-19): `games 88.620 · matched 84.523 · unmatched 4.097 · teams 1.700 · maps 15 · pairs 32.311`. Tamaños: `team-maps.json` 1,4 MB, `pairs.json` 3,5 MB, `form.json` 1,2 MB, `players.json` 0,9 MB, `rosters.json` 0,9 MB, `maps.json` 28 KB (`ls -la data/esports/cs2`).
- Job en producción: `cs2DailyJob` (`server.js:517-548`) corre cada hora, una vez al día tras las 09 UTC, con guardia de memoria (`opsMemOk(150)`), y encadena `cs2-harvest.js` (heap 240 MB, 40 min), `cs2-roster.js` y `cs2-players-harvest.js --max=400`. Apagable con `GP_CS2_HARVEST_ENABLED=0`.

**Asignación de mapa a equipo** (`cs2-harvest.js:121-146,176-188`): el mapa trae nombres de clan, no ids; se elige entre los DOS equipos del partido (`pickSide`, contención con mínimo 3 caracteres) y solo como último recurso el índice global; si es ambiguo se descarta ("asignar mal un mapa … envenena su fuerza por mapa para siempre").

### 3.3.3 Agregados y rating (`cs2-harvest.js:148-334`)

Constantes (`:104-110`): `HALF_LIFE_DAYS = 180`, `PRIOR_MAPS = 12`, `TIER_W = {s:1, a:0,95, b:0,8, c:0,5, d:0,35}`, `RECENT_DAYS = 100`, `MAP_EFFECT_PRIOR = 20`.

- Peso de cada mapa: `wt = 0,5^(días/180) · TIER_W[tier]` (`decay`, `:112-116`; `:212`).
- **Elo global** (columna vertebral): `ELO0 = 1500`, `K = 26`, actualización cronológica con `k = K · tierW · margin`, `margin = min(1,5, 1 + ln(1+|rondas_g − rondas_p|)/4)` (`:165, 231-239`). El Elo por mapa se conserva "como DIAGNÓSTICO, no como motor" (`:224-226`).
- Tasa de victoria encogida: `wr = (ww + 12·0,5·pbar) / (wn + 12·pbar)` con `pbar = wn/n` (`shrunk`, `:271-275`).
- **Efecto de mapa**: `effect = (wr_mapa − wr_global) · n/(n+20)` (`:321`); `rd` = diferencial medio de rondas (`:322`).
- Perfil por mapa: `mean_rounds`, `overtime_p`, `blowout_p` (perdedor ≤ 4), `loser_distribution`, `total_distribution`, `by_order` (mapa 1/2/3), `decider_mean_rounds`; la versión reciente (100 días) solo si `recent_n ≥ 120` (`:249-264`); `in_pool = recent_n ≥ 60` (`:251`).
- Ranking GP: equipos con ≥ 30 mapas por Elo; foto semanal en `rankings-history/` (`:370-382`; hoy hay un solo archivo, `2026-W34.json`).

**Modelo jerárquico calibrado** (`cs2-data.js:161-225`):
```
pBase = 1/(1+10^((elo_B − elo_A)/400))                     ELO_SCALE = 400
logit(p_mapa) = CAL_SLOPE · [ logit(pBase) + LAMBDA · (efecto_A − efecto_B) ]
LAMBDA = 1,6 · CAL_SLOPE = 0,873 · p_mapa acotada a [0,10, 0,90]
```
(`:185-188, 210-213`). El comentario `:162-184` reproduce la tabla de validación que tumbó el modelo anterior: `elo_global 6,88 % · elo_mapa 3,04 % · wr_mapa 1,00 % · modelo anterior 2,12 % · jerárquico calibrado 7,28 %` de skill de Brier.

**Validación** (`scripts/cs2-validate.js`): walk-forward estricto, "para cada mapa se predice con el estado que existía ANTES de jugarlo" (`:129-135`); replica las constantes (`:178-185`) con `LAMBDA`, `MAP_EFFECT_PRIOR`, `CAL_SLOPE` sobreescribibles por `GP_LAMBDA`, `GP_MAP_PRIOR`, `GP_CAL_SLOPE`. Métricas guardadas en `MODEL_CARD` (`cs2.js:504-540`): ventana `2024-01-09 → 2026-08-16 · 48.678 mapas · 40.432 puntuados`; confirmación 2026 sin retocar: `14.297 mapas · skill 7,28 % · AUC 0,652 · ECE 0,0081 · pendiente 0,999 · logloss 0,6554`. `market_baseline: 'NO DISPONIBLE — GP no tiene histórico de cuotas de CS2'` (`:518`). Nota: `meta.json` dice 88.620 mapas pero la card 48.678 puntuados — son la base completa vs. la ventana de validación.

### 3.3.4 Resolución de nombres (`cs2-data.js:91-152`)

`norm` quita `esports|gaming|team|club|cs2` **pero no** `academy|junior` (`:91-96`) porque "Spirit Academy" y "Spirit" colapsaban. Índice `byName` con regla "el nombre exacto manda sobre el alias" (`:67-85`; caso MOUZ→MOUZ NXT del 7-sep). `FILIAL_RE` (`:123`) marca filiales; `resolveTeam` (`:128-152`) va exacto → `ABREVIATURAS` (`navi`) → contención **por prefijo** con ≥4 caracteres y misma marca de filial en ambos lados; con varios candidatos exige que el primero doble en historial al segundo, si no devuelve `null`.

### 3.3.5 Veto, rondas y economía (`cs2.js`)

- **Pool activo**: no se hardcodea; `poolOf` (`cs2-data.js:100-113`) ordena por `recent_n · (0,7 + 0,3·recent_n/n)` y toma 7. `MAP_POOL` (`cs2.js:25-34`, versión `2026-08`) es solo respaldo.
- **Árbol de veto** (`vetoTree`, `cs2.js:51-104`): probabilidad de ban de A en el mapa m ∝ `exp(−6·(p_A − p_B))`, de pick ∝ `exp(+6·(p_A − p_B))` (`:60-75`); secuencia BO3 ban-ban-pick-pick-ban-ban-decider; la rama más probable se elige greedy. El coeficiente 6 está etiquetado `experimental — SIN histórico de vetos` (`:528`).
- **Impacto del veto** (`vetoImpact`, `:114-133`): serie sobre el pool plano vs. serie sobre los mapas probables (12.000 sims, semilla 811); veredicto FAVORABLE/DESFAVORABLE si |shift| > 2,5 pp.
- **Rondas** (`mapRounds`, `:179-224`): carrera a 13 con **máximo 24 rondas** (`:193`), prórroga en bloques MR3 (primero a 4, hasta 6 bloques, `:197-205`); arrastre económico `p_ronda = clamp(pRoundA + st·eco, 0,05, 0,95)` con racha `st ∈ [−2, 2]` que se **refuerza** (signo +, `:183-187`). Salida: `mean_rounds`, `overtime_p`, `loser_distribution`, totales y los histogramas `dist.{total, home, away, margin}`.
- **Calibración del arrastre por mapa** (`calibrateDrag`, `:152-177`): bisección de `eco ∈ [0, 0,16]` (12 pasos, 6.000 sims, semilla 4127) para que la prórroga simulada a p=0,5 iguale la observada del mapa (`mapProfile`, requiere `n ≥ 40`, `cs2-data.js:243-260`); respaldo `ECO_DRAG = 0,055` (`:147`). Publica `rounds_residual = media simulada − media observada` (`:172`), que luego cobra `calibrationPp` (§3.6.2). Comentario `store.js:657-665`: residuos medidos `dust2 −0,10 · mirage −0,53 · ancient +0,09 · nuke +0,34 · inferno +0,37 · anubis +0,11 · cache +0,16`.
- **De mapa a ronda**: `clampRound(pMap) = clamp(0,5 + (pMap − 0,5)·0,42, 0,32, 0,68)` (`:545`).
- **Economía**: solo estructura descriptiva sin datos (`ECONOMY_MODEL`, `:229-238`).

### 3.3.6 `analyze()` de CS2, paso a paso (`cs2.js:291-499`)

1. Ancla de mercado (`marketAnchor`) → `marketP` (`:298-300`).
2. Resuelve nombres a ids, carga fichas y fuerza por mapa `matchupMaps` (≥ 3 mapas con dato) (`:303-319`).
3. Veto sobre esa fuerza; `ownP` = serie simulada sobre los mapas probables (20.000 sims, semilla 5501) (`:321-340`).
4. `modelP = ownP ?? eloP`; `ownSample = max(sample, min(mapas_A, mapas_B))`; `anchoredProbability(marketP, modelP, {n: ownSample})` → `pSeries`; `pMap = seriesToMap(pSeries)` (`:341-348`).
5. **Anclaje de los mapas a la serie anclada** (`:352-386`): se busca por bisección (14 pasos, 2.500 sims, semilla 8171) el desplazamiento `mapShift` de los logits de `clampRound(p_a)` tal que `simulateSeries(perMap)` reproduce `pSeries`. El comentario explica que igualar la media de logits "dejaba la serie simulada en 0,39 cuando la anclada decía 0,26". `map_anchoring` publica el `shift_logit`.
6. Rondas del primer mapa con `mapRounds(clampRound(pRoundBase), {eco})` (`:391-400`) y **una distribución por mapa de la serie** `rounds_by_map[1..N]` con su perfil, su arrastre y semilla `23 + i·101` (`:414-427`): Pinnacle cotiza mapas 1, 2 y 3 por separado y "el precio salía idéntico en los tres" antes de esto (`:403-413`).
7. **Ventana de shock de roster** (`:437-456`): si un equipo tiene `changed_recently` (quinteto estable < `SHOCK_DAYS = 45`, `scripts/cs2-roster.js:143-176`) se suma en cuadratura `2,6 pp` por equipo a la epistémica; el historial **no** se repesa ("PENDIENTE", `:478`). `history_weight = 0,55 + 0,45·min(1, días/45)` se calcula en el roster (`cs2-roster.js:175-176`) pero **no encontrado en el código** que el motor lo aplique.
8. `missing` incluye siempre `'datos de ronda (demos)'` (`:445-447`), lo que añade 2,2 pp fijos a la epistémica.
9. Serie final simulada con los mapas anclados (`:463`).

### 3.3.7 Ficha de modelo publicada

`MODEL_CARD` (`cs2.js:504-540`) declara el estado de cada constante: aprendidas (`LAMBDA 1,6`, `CAL_SLOPE 0,873`, `MAP_EFFECT_PRIOR 20`, arrastre por bisección), convención (`HALF_LIFE 180`, `PRIOR_MAPS 12`, `TIER_W`, `ELO K 26`), experimental (`coeficiente de veto 6`, `momentum 0,06`), doctrina (`peso propio máx 0,45`, `listón 3 pp +2,5`). Pendientes: "baseline de mercado y CLV", "histórico de vetos reales", "roster", "demos". La ruta pública solo enseña evidencia, no composición ("caja negra", `server.js:21121-21137`).

---

## 3.4 VALORANT

### 3.4.1 Propósito y alcance

Motor `esports-engine/valorant.js` + base `valorant-data.js`. Familias cotizadas `SERIE, MAPA, HANDICAP, TOTAL_MAPAS, RONDAS, MARCADOR`; de ventaja `RONDAS, TOTAL_MAPAS, HANDICAP` (`valorant.js:45-51`). Tres diferencias declaradas frente a CS2 (`:3-17`): agentes/composición, asimetría ataque/defensa más fuerte, prórroga por parejas. Admin-only y todo en sombra por derechos (`RIGHTS.md`).

### 3.4.2 Datos: cosecha vlr.gg

- `scripts/valorant-harvest.js`: dos tablas, `series.json` (índice completo de resultados, `/matches/results/?page=N`, ~660 páginas desde 2020) y `maps.json` + `players-raw.json` (detalle por serie desde `--since=2024-01-01`: mapa, marcador, mitades `t/ct/ot`, duración, scoreboard) (`:8-14`). Ritmo 1 req/2,5 s con UA identificado (`:29-31`), reanudable, HTML parseado por regex (`:72-96, 135-172`). Directorio: `GP_VAL_DIR` o `/data/val-raw` (`:25`).
- `scripts/valorant-aggregate.js` → `map-stats.json`, `agents.json`, `player-stats.json`, `comps.json`, `meta.json`, escritos en `GP_VAL_OUT` / `/data/val-agg` (`:292-297`); el lector prefiere disco a repo archivo a archivo (`valorant-data.js:20-28`).
- `map-stats` (`valorant-aggregate.js:55-81`): mapas con total < 13 rondas se descartan; prórroga = total > 25; `atk_round_share = rondas ganadas atacando / rondas sin OT`; solo mapas con `n ≥ 25`; `in_rotation = recent_n ≥ 12` (180 días); fuerza por equipo y mapa en ventana de 365 días.
- Estado en el repo (`data/esports/valorant/meta.json`): `series 33.073 · detail_series 1.073 · player_rows 27.152 · last_at 2026-08-17`; `series.json` 9,1 MB. `map-stats.json`: Lotus n 494 (OT 12,1 %, ataque 0,532), Haven 448, Split 426, Breeze 357, Ascent 327 (ataque 0,469), Pearl 231 (OT 8,7 %), Fracture 185 (OT 8,6 %), Sunset 125, Summit 85 (OT 15,3 %), Bind 38.
- Liquidación lee la **misma cosecha** (`results.js:258-308`), eligiendo entre cuatro rutas candidatas la copia con la serie más reciente (`:266-280`).

### 3.4.3 Rating: Elo de serie validado

`valorant-data.js:77-108`: Elo walk-forward en `load()` sobre `series.json` con las constantes de `priors.json`:
```
p = 1/(1+10^((elo_b−elo_a)/400))
margin = |s1−s2| / max(1, s1+s2)          (2-0 → 1 · 2-1 → 0,33)
scale  = 1 + (margin_boost − 1)·margin
elo_a += K · (idle_a ? idle_boost : 1) · scale · (y − p)     idle = > idle_days sin jugar
```
`priors.json`: `K = 32 · margin_boost = 1,7 · idle_boost = 1,5 · min_n = 10 · idle_days = 60` (nótese que el fallback en código es `K 20 · 1,35 · 1,5`, `valorant-data.js:45`). Validación (`scripts/valorant-validate.js`, grid `K∈{12..32} × mb∈{1,1,35,1,7} × ib∈{1,1,5,2}` elegido en desarrollo, `:108-113`; ventana intacta 120 días evaluada una vez, `:104,116`): desarrollo `gp n 14.116 · skill 12,69 % · AUC 0,699 · ECE 0,026`; **holdout 120 d**: `gp n 893 · skill 7,96 % · AUC 0,664 · ECE 0,050` contra `elo_plain skill 8,02 %` — es decir, margen y óxido **no** baten al Elo plano fuera de muestra (`priors.json`). Ranking: élite activa con ≥ 8 series en 120 días (`valorant-data.js:109-117`).

Resolución de nombres: `byName` exacto, `byAlias` sin la palabra de organización solo si un único equipo lo reclama (`:206-221`), y prefijo con guardia `SQUAD` (GC/academy/challengers/…, `:237-244`). `datasetFor` exige `pair_sample ≥ 15` series (`:425-433`) — es la puerta de `TOTAL_MAPAS/HANDICAP` (§3.6.3).

### 3.4.4 Fuerza por mapa y veto

`vetoInput` (`valorant-data.js:395-422`): por mapa en rotación, `wr_enc = (wr·n + 0,5·8)/(n+8)` para cada equipo y `map_strength.a = clamp(0,5 + (wr_A − wr_B)/2, 0,05, 0,95)` (`:400, 414`); `agent_depth` = cuota de la composición más usada (≥3 apariciones, `:402-409`). Requiere ≥ 3 mapas (`:420`).

`vetoTree` (`valorant.js:57-114`): preferencia `exp(sign·(6·edge − 6·gap))` con `gap = (1 − depth)·0,35` (`:67-83`); el comentario (2-sep) documenta que el término de composición tenía el signo invertido en el veto. No se veta el último mapa en pie (`:88-90`). Sin `map_strength` devuelve solo estructura (`structure_only`, `:345-350`).

### 3.4.5 Rondas con asimetría de lado

`mapRounds(pRoundA, mapBias, {eco})` (`:179-235`): 12 rondas defendiendo con `pDef = pRoundA + (bias − 0,5)` y 12 atacando con `pAtk = pRoundA − (bias − 0,5)` (acotadas a [0,10, 0,90]); prórroga por parejas hasta ganar por dos, tope 10 parejas y desempate a `pDef` para que "UN MAPA NUNCA ACABA EMPATADO" (`:201-211`). `bias` = `def_round_share = 1 − atk_round_share` medido (`valorant-data.js:366-376`, `MIN_MAPAS = 40`) o el del pool escrito a mano (`MAP_POOL`, `:29-37`). Arrastre: `ECO_DRAG = 0,065` de respaldo (`:146`) y `calibrateDrag` por bisección en `[0, 0,18]` contra la prórroga observada (`:155-177`, exige `n ≥ 40`).

**De mapa a ronda por bisección** (`pRoundFor`, `:246-260`): busca `pRound ∈ [0,20, 0,80]` (12 pasos, 6.000 sims, semilla 911) tal que `mapRounds(...).p_win_a = p_mapa`; sustituye al `×0,44` heredado (retirado el 2-sep, `:475`). El backtest citado (`docs/BACKTESTS_FAMILIAS_2026-09-02.md:136-148`): con `clampRound` un equipo con p 0,70 ganaba el mapa simulado el 82 %; la bisección baja el Brier del hándicap de rondas −0,0148 (SE 0,0055, n=128) y "0 de las 80 under" habrían nacido; pero "un control que ignora p (pRound 0,5) iguala o supera a la bisección fuera de muestra" (`:141-143`).

### 3.4.6 `analyze()` de Valorant (`valorant.js:307-474`)

- Nivel de serie templado: `modelP = σ(0,85·logit(Elo))` y `anchoredProbability(..., {maxModel: 0,25})` (`LEVEL_TEMPERATURE = 0,85`, `LEVEL_MAX_MODEL = 0,25`, `:316-327`), porque el backtest midió que "el favorito de producción ganó el 45 % de los mapas" (`:394`).
- Pool medido `circuitPool` (≥ 5 mapas en rotación con `n ≥ 40`) o el escrito (`:335-338`).
- Anclaje por mapa (`:353-395`): igual que CS2, `mapShift` por bisección; si el mercado cotiza el mapa 1 directamente (`anchor.p_map`, familias `MAPA`/`HANDICAP`), ese precio **fija** el mapa 1 y los demás se desplazan alrededor (`:363-366`). Sin forma (p_a nulos) cada mapa toma la implícita de la serie.
- Rondas del mapa 1 con `roundsAt(pMap1, bias, {eco})` (20.000 sims); si no hay veto simulable, `map_assumed: true` y el residuo de calibración se ensancha en cuadratura con la **dispersión de rondas medias entre mapas del pool** (`:404-417`).
- `rounds_by_map` solo con veto simulable (`:432-449`): "cotizar la línea del 3 contra el tercero más jugado sería inventarse el orden".
- Incertidumbre con `missing` = fuerza por mapa (si falta), perfil (si falta) y siempre `'composiciones de agentes'` (`:451-457`).

### 3.4.7 Informe de implementación

`docs/impl/valorant-REPORT.md` documenta los commits del 2-sep (bisección, anclaje, temperatura, signo del ban, incertidumbre de nivel, `valPickMeta`) y el humo `scripts/smoke/valorant-smoke.js` (p_win_a ≈ objetivo ±0,015; `RONDAS_EQUIPO` con n=40 → 5,14 pp en Valorant vs 4,64 pp por el camino de CS2). Pendientes declarados: reponer insumos del backtest, guardar ambos lados del mercado de rondas al nacer, revisar `by_dist_method` tras una semana.

---

## 3.5 DOTA 2

### 3.5.1 Propósito y alcance

Motor `esports-engine/dota2.js` + base `dota2-data.js`. Familias `SERIE, MAPA, HANDICAP, TOTAL_MAPAS, MARCADOR, KILLS`; de ventaja `TOTAL_MAPAS, HANDICAP, KILLS` (`dota2.js:27-33`). Tres diferencias declaradas con LoL (`:5-16`): partidas más largas y con cola, sin rendición, buyback/Roshan hacen la ventaja reversible. **La cabecera (`:18-22`) sigue diciendo "sin mercados abiertos… hasta entonces las constantes son perfiles de circuito"** aunque la capa de datos existe desde el 17/18-ago — comentario desactualizado.

### 3.5.2 Datos: OpenDota

- `scripts/dota-harvest.js`: `/api/proMatches` paginado hacia atrás con `less_than_match_id` (`:30, 78-96`), 1,2 s entre llamadas, 365 días por defecto; guarda diez campos por partida (`slim`, `:58-65`: ids/nombres de radiant y dire, liga, `series_id`, `series_type`, `r_score`/`d_score` = kills, `r_win`, `dur`). Escribe en disco persistente o repo (`:35-38`).
- `scripts/dota-strategic-harvest.js`: Explorer SQL de OpenDota (`picks_bans`, `player_matches`, `notable_players`, `match_patch`, `constants`) (`:8-16`), 1,7 s entre llamadas.
- `scripts/dota-aggregate.js` → `hero-meta.json` (por parche con ≥ 250 partidas, wr encogida `K=25`, `:41-70`), `team-doctrine.json` (pools con medio-vida 60 picks, `:73-96`), `player-stats.json` (posición 1-5 inferida del rango de GPM en el equipo, rating `z = 0,35·KP + 0,30·KDA(tope 8) + 0,20·GPM − 0,15·muertes → 1 + 0,14·z`, `:99-161`).
- Estado del repo (`data/esports/dota2/meta.json`, 18-ago): `matches 49.645 · drafts 1.239.402 · player_rows 524.000`; `matches.json` 12,5 MB, `player-stats.json` 3,7 MB, `team-doctrine.json` 1,5 MB.

### 3.5.3 Rating: Elo + ventaja de lado online

`dota2-data.js:64-91`:
```
p = 1/(1+10^((elo_b − elo_a − sideElo)/400))       a = radiant, b = dire
elo_a += K·(y − p); elo_b −= K·(y − p);  sideElo += side_step·(y − p)
```
`priors.json`: `K = 12 · min_n = 8 · side_step = 2 · side_advantage_elo = 3,7 · radiant_wr 51,3 %`. Validación (`scripts/dota-validate.js:120-143`, 4 predictores walk-forward): sobre `n = 39.434` cualificadas (ambos ≥ 8 partidas previas): `moneda 0 % · lado 0,04 % · elo 2,27 % (AUC 0,580) · elo_lado 2,22 % (AUC 0,580, ECE 0,019, acierto 55,35 %)`. El comentario de cabecera (`:19-39`) explica el barrido de K (12 maximiza; 48 → −0,64 %) y la hipótesis de por qué es bajo (`/proMatches` mezcla tier-1 con ligas de tier-3 y bo1). Ranking GP restringido al circuito principal por regex `T1DOTA` (`dota2-data.js:98-107`). Identidad: cinco equipos "Team Spirit"; `byName` resuelve al de más historial (`:166-177`).

### 3.5.4 Del rating a los derivados (`dota2.js`)

- `tempoOf(competition)` clasifica por regex en perfiles `TI, MAJOR, DPC_EU, DPC_CN, DPC_SEA, DPC_SA, DEFAULT` con `kpm` y `minutes` hardcodeados (`:38-57`, p. ej. DEFAULT `1,38 kpm · 37,0 min`), todos `measured: false`.
- `calibrateTempo(base, observed)`: `w = games/(games+25)`; `kpm = base·(1−w) + obs·w`; `measured = w > 0,35` (`:58-67`). El observado viene de `tempoFor(competition)` (`dota2-data.js:300-312`): ritmo por liga en 180 días con `n ≥ 12` (partidas > 600 s con kills), el nombre más específico gana; si no, el agregado del circuito con `n ≥ 200` (`:137-155`). Se conecta en `dotaOwnInput` (`store.js:441-454`).
- **Duración** (`durationModel`, `:103-128`): lognormal con `μ = ln(minutes·(1 − 0,09·gap))`, `σ = 0,26 + 0,05·(1−gap)`, `gap = |pMap − 0,5|·2`, acotada a [20, 85] min, 20.000 sims. Constantes de autor.
- **Kills** (`killsModel`, `:159-204`): `kpm = tempo.kpm·(1 + 0,07·gap)`; por simulación `mins` lognormal (σ 0,27), `λ = kpm·mins·U(0,88, 1,14)`, `k = round(λ + √λ·z)`; reparto `sh = clamp(0,5 + (pMap−0,5)·0,66 + 0,10·z, 0,14, 0,86)`; histogramas `total/home/away/margin`. Constantes de autor.
- **Lado**: `SIDE_EDGE = 0,021` fijo (`:73`) → `radiant_p = pBase + 0,021`; la ventaja medida (`side_advantage_elo 3,7`) viaja en `ratingsFor` (`dota2-data.js:246`) pero **`analyze()` no la usa** (`dota2.js:232-233` calcula `eloProbability(elo_a, elo_b)` sin lado).
- **Comeback** (`comebackModel`, `:134-152`): curva `0,42·e^(−t/34) + 0,06` "declarada como estructura del juego, no medida".
- Anclaje: `anchoredProbability` con `maxModel` por defecto 0,45 (`:234`); serie con `simulateSeries(pMap, bo)` sin `perMap` (`:251`).
- Incertidumbre: `missing` = `'ritmo medido del circuito'` (si no medido) + siempre `'detalle por jugador de cada partida'` (`:243-249`).

---

## 3.6 Del modelo a la pick (`esports-engine/store.js`)

### 3.6.1 Entrada y caché

`slate()` funde agendas con TTL 10 min (`SLATE_TTL`, `:100`); `market()` por evento con TTL 3 min (`MARKET_TTL`, `:101`). `boOf` (`:386-401`): manda `ev.bo` declarado por Pinnacle; si no, se deduce (hándicap ±2,5 o total ≥ 3,5 → BO5; ±1,5 o 2,5 → BO3). `ownInputFor` (`:455-456`) enchufa la capa propia en `lol`, `valorant`, `dota2`; CS2 resuelve dentro de su motor con `teams`. El Elo genérico `ratings(game)` (`:229-255`, `K0 = 32` decreciente hasta `K_FLOOR = 12`) se alimenta de `results-<juego>.json`, que "está vacío en los cuatro juegos" (`:173-182`).

### 3.6.2 Probabilidad por familia y línea (`probFor`, `:556-652`)

| Familia | Cómo | Cita |
|---|---|---|
| `TOTAL_MAPAS` | masa de marcadores con `x+y > línea` en `model.simulation.scores` | `:574-584` |
| `HANDICAP` | margen de mapas `(x−y)+línea`; push renormalizado | `:586-603` |
| `RONDAS`, `RONDAS_EQUIPO` | `pOver/pUnder` sobre `R.dist.total` o `R.dist[team]` del mapa cotizado (`rounds_by_map[map]`, si no existe → `null`, nunca el mapa 1) | `:561-569, 605-615` |
| `RONDAS_HANDICAP` | `pHandicap(R.dist.margin, línea)`; el visitante vía histograma negado `negHist` y `−línea` | `:616-621, 696-701` |
| `PRORROGA` | `R.overtime_p` | `:622-626` |
| `KILLS*` | histogramas de `model.kills` (LoL/Dota) | `:628-649` |

**Error de calibración cobrado** (`calibrationPp`, `:672-691`): `pp = |rounds_residual| · share · densidad(línea) · 100`, con densidad = media de la masa en `floor(línea)` y `ceil(línea)`, `share = 0,5` en `RONDAS_EQUIPO`; en `PRORROGA` es `|got_ot − target_ot|·100`. El comentario `:655-671` cuenta que las tres únicas picks que salían eran "menos de 20,5/21,5/22,5 rondas en mirage" con 5,8-9,6 pp que "eran el residuo de nuestra propia calibración".

### 3.6.3 Los vetos y la incertidumbre por familia

- `basisFor` (`:737-748`): **un supuesto no genera picks**. `KILLS*` exige `model.tempo.measured`; `RONDAS*`/`PRORROGA` exigen `R.measured` (perfil de mapa medido); `TOTAL_MAPAS`/`HANDICAP` exigen `model.dataset.available` (CS2: base cargada; Valorant/Dota: `pair_sample ≥ 15`). Sin base la fila se calcula "y se enseña igual" pero `pick = false` con código `estructura_no_medida` (`:837-842`).
- `uncertaintyFor` (`:749-755`): las familias de VOLUMEN (`VOLUME_FAMILIES`, `:714`: `RONDAS, RONDAS_EQUIPO, KILLS, KILLS_EQUIPO, PRORROGA`) **no** pagan la incertidumbre del par sino `√(perfil² + mercado²)` con `perfil = 3,0` (medido) / `6,5` (supuesto) y `mercado = 1,5/3,5/6` por casas **que cotizan esa línea** (`depthOf`, `:795-799`). Las de margen pagan la `epistemic_pp` del modelo.
- Solo Valorant: `RONDAS_EQUIPO` suma además en cuadratura el término de muestra del par (`valUncertaintyFor`, `:763-771`).
- `uncF = √(uncFam² + calPp²)` entra en `evaluateEdge` con `minEdgePp = 3` (`:829-834`); veto extra si `edge_pp ≤ calPp` (`ventaja_explicada_por_calibracion`, `:845-849`).
- Familia que ancló → excluida ("medirse contra ella sería medirse contra uno mismo", `:801-813`).
- Misma línea y lado en varias casas → se valora contra el **mejor precio** (`:817-822`).
- **Una tesis, una pick** (`thesisOf`, `:1077-1092`; agrupación `:870-899`): volumen (`mapa · volumen · side`), margen (`mapa · margen · local/visitante`), duración de serie, prórroga; sobrevive la de mayor `edge_pp`, las demás cuelgan como `same_thesis`.

### 3.6.4 Stake, ids y nacimiento

- Stake en la card: Kelly/4 sobre `p_gp` con tope `STAKE_CAP = 2 %` (`:1016-1024`).
- `pick_id = es_<juego>_<evento>_<familia>_<side>_<línea|x>_<mapa|0>` (`:1049`); `family_raw` conserva la familia liquidable (`:1036`).
- `recordPicks(game, {withinMin 720, cap 10})` (`:1416-1481`): cada 20 min (`esChain`, `server.js:13286-13306`) recorre hasta 10 eventos entre −30 min y 12 h, re-analiza y guarda cada pick **una sola vez** ("si el motor cambia de opinión mañana, esa es otra pick", `:1355-1356`) con `odds, book, books_quoting, p_gp, p_market, edge_pp, uncertainty_pp, calibration_pp, thesis, stake_pct`, más (9-sep) `sample_n`, `unc_sample_pp = uncPp(nA, nB)` y `unc.passes` (`:1450-1462`; `implied-engine/uncertainty.js:22-40`: `100·0,28·√(1/(nA+2)+1/(nB+2))`, puerta `edge ≥ 0,75·unc`, **solo etiqueta**), y en Valorant `p_map_market, p_map_model, shift_logit, p_round_solved, dist_method` y `era = GP_PICKS_ERA || 'v2-2026-09-02'` (`:783, 1465-1471`).

---

## 3.7 Liquidación

### 3.7.1 Fuentes de resultado (`data-providers/esports/results.js`)

| Juego | Fuente | Qué trae | Qué NO trae |
|---|---|---|---|
| CS2 | bo3.gg (`cs2Results`, `:60-139`): partidos + mapas unidos por `match_id`; nombres desde `winner_clan_name/loser_clan_name` | marcador por mapa, rondas, prórroga (`ov_index > 0`), nombre del mapa | kills (`has_kills: false`) |
| Dota 2 | OpenDota `/proMatches` paginado hasta 12 páginas (`dota2Results`, `:144-198`) agrupado por `series_id`; "local" = radiant del primer mapa (`:171-172`) | ganador por partida, `kills_a/b` (= `radiant_score/dire_score`), duración | rondas |
| Valorant | cosecha propia `series.json` + `maps.json` (`valorantResults`, `:258-308`) | marcador de serie; por mapa marcador y `ot` si hay tramo `ot` en `halves` | hora real (`day_only: true`, mediodía de relleno) |
| LoL | Leaguepedia → lolesports | (otro lector) | — |

bo3 marca partidos `parsed_status: rejected` (~19 %, `:110-117`); esos se emiten como fila de serie `parse_rejected: true` con nombres extraídos del slug y **solo pueden anular**, nunca decidir (`store.js:1839-1849`).

### 3.7.2 Emparejar pick con resultado (`settlePicks`, `store.js:1693-1913`)

1. Repesca de CLV en liquidadas sin cierre (`:1697-1706`).
2. Pendientes: `ACTIVE` con `start_at < ahora − 20 min` (`:1708-1709`).
3. Ventana de la fuente desde la pendiente más antigua, tope 30 días, filas `min(1500, max(300, días·60))` (`:1712-1725`).
4. Clave de equipo: resolutor propio del juego → `gp:<id>` (`resolverParaLiquidar`, `:131-140`) o normalización plana (`:1730-1733`).
5. Casado exacto por par y ventana ±12 h (±30 h si `day_only`) (`:1737-1743, 1777-1778`); si falla, **casado aproximado** con candidato único (`ladoAprox`: contención ≥ 5 letras o id prefijo, `:1758-1784`), anotado `casado_por: 'aproximado'`.
6. Orientación: si la fuente lista al revés se voltea **todo** lo que tiene lado (`score`, `kills`, `winner`), `:1826-1837` (el volteo a medias de kills fue el bug del 2-sep, `docs/AUTOPSIA_MODELOS_2026-09-02.md:37-44`).
7. Veredicto `settleOne` (`:1525-1591`): `PUSH` en línea entera clavada; `TOTAL_MAPAS`/`HANDICAP` sobre `maps_a/maps_b`; el resto exige el mapa `n = pk.map` en la fila; `PRORROGA` con `m.ot`; `RONDAS_HANDICAP` con `(score_a − score_b) + línea`. Verificado a mano en `scripts/esports-settle-check.js` (Basement Boys 2-1 INOX: ancient 16-12 OT, nuke 7-13, dust2 13-11).
8. Casos raros: **mapa no jugado** en serie terminada según `bo` → `VOID` (`:1851-1866`); **parseo rechazado** → `VOID` (`:1844-1849`); **caducidad** a los 21 días sin aparecer → `VOID` (`:1786-1798`); sin dato de la familia → sigue `ACTIVE` con `unsettleable_why` (`:1868-1876`).
9. Unidades: `WIN → odds − 1`, `LOSS → −1`, `PUSH → 0` (`:1879`).
10. Diagnóstico guardado en `last_settle` (`:1889-1900`): `sin_casar` con si el par existe en la fuente, horas de diferencia, por competición.

`resettleKills` (`:1666-1691`) reabre y re-liquida `KILLS_HANDICAP/EQUIPO/DNB` (idempotente). Retrasos conocidos: bo3 parsea "en ~2 días" (`:1788`).

---

## 3.8 Medición: cierres, CLV, track y la vara

### 3.8.1 El archivo de cierres (`snapshot`, `store.js:273-365`)

Cada 20 min (`esChain`) y cada 2 min para juegos con picks a ≤ 65 min (`server.js:13307-13320`), para eventos entre **−15 min y 720 min** del inicio (`:276-280`, hasta 14 eventos): se guarda `rows` con `book, family, line, side, period, map, team, odds, at, pre_min` (`:294-297`); `open_rows` congelada en la primera pasada y `tape` del ganador de serie (30 puntos) (`:301-318`); **cubos** `snaps[T60|T30|T10|T5|T1]` (primera lectura dentro de cada ventana, `implied-engine/closes.js:20-40`: T60 = 90-45 min, T30 = 45-20, T10 = 20-7, T5 = 7-3, T1 = 3 a −2) con hasta 400 filas (`:319-327`); y **fusión** de `rows` por `(casa·familia·línea·lado·periodo·mapa·equipo)` conservando la última observación de lo que la casa dejó de cotizar (`:328-350`, tope 1.200 filas). Motivo medido: "115 de las 165 picks liquidadas sin CLV tenían su cierre guardado y sin su propia familia dentro".

### 3.8.2 El cierre de una pick y su CLV

`closeOddsFor` (`:1624-1658`): línea exacta, misma familia/lado/mapa/equipo, **preferencia por la misma casa** (si no hay, cualquier casa: `pool = mine.length ? mine : rows`, `:1632-1636`), mejor cuota; si no hay línea exacta, **interpolación en probabilidad implícita** sobre la escalera de la misma casa dentro de `CLOSE_MAX_GAP = 3` puntos, sin extrapolar (`:1642-1657`), marcada `src: 'interpolada'`. CLV: `clv_pct = (odds_tomada / odds_cierre − 1)·100` (`:1884`; `closes.js:63-67`). Extras 9-sep (`closeExtrasFor`, `:1612-1622`): `close_own`/`clv_own_pct` contra la MISMA casa y `close_series` por cubo con `own/best/pinnacle`.

### 3.8.3 El track (`track`, `:1979-2116`)

Publica `settled, w, l, push, units, roi_pct = 100·units/(n sin push)`, `hit_pct`, `clv_avg_pct`, `clv_src` (exacta/interpolada), `clv_lag` (p50 de `pre_min`, cuántos ≤ 60 min y > 180 min), `by_family` (n, hit, units, CLV medio y **sd**), **`by_family_book`** (`:2001-2014, 2042-2044`; el comentario `:1999-2000`: "el hándicap de rondas daba +3,53 % en la casa afilada y −3,13 % en la única conectable"), `tt_transfer` por familia (`clv_own`, curva por cubo `CL.summarize`, `gate = splitByGate` con/sin puerta), `by_dist_method` (Valorant), `clv_diag`, `open_vencidas`. Advertencia embebida: con < 30 liquidadas "el ROI todavía es ruido" (`:2084-2086`). `marketEvidence` (`:2129-2176`) añade cobertura apertura→cierre y CLV por casa.

### 3.8.4 Margen y vara (`lib/margen.js`, `lib/vara.js`, `/api/internal/vara`)

- **Margen medido** (`margen.js`): empareja las dos caras del mismo mercado en `closes-<juego>.json` por `(casa, familia, mapa, periodo, |línea| en hándicap / línea en totales)` (`claveMercado`, `:33-42`), mejor cuota de cada cara, `sobre = 1/oA + 1/oB − 1` filtrado a (−2 %, 60 %) (`:47-77`); `margen_lado = mediana(sobre)/2` (`:85-102`); sin las dos caras → `null`.
- **Vara** (`vara.js`): CLV **recortado al 10 %** con t (`serie`, `:30-37`), serie semanal (`:42-50`), rodante de 100 (`:54-64`); `cierreAporta` (`:77-95`): Brier pareado de la implícita de entrada vs. cierre (con devig por `overPct`), `n ≥ 40`, `aporta` si `t ≥ 2`; `modeloContraPrecio` (`:100-116`): Brier pareado `1/odds` vs `p_modelo` + ROI con t; `veredicto` (`:122-165`): si el cierre no aporta → `clv_no_aplica / cerrar / invertible_por_acierto / sin_evidencia`; si aporta → `sin_margen_medido / muestra_corta (n<100) / no_invertible (neto ≤ 0) / en_observacion (t<2) / invertible`; `tamano` = ¼ Kelly sobre el neto (`:169-177`).
- `/api/internal/vara` (`server.js:25257-25342`) aplica todo por `juego · familia · casa` sobre `track(game).recent` con `clv_pct`, `p_gp` como `pModelo` y `close_odds` como cierre, mínimo 60 (`:25263, 25282-25296`).

### 3.8.5 Resultados medidos que guardan los documentos

- **Sombra `cs2_rounds_v1`** (regla congelada 25-ago, `server.js:13981-14006`): base 158 picks, +17,57 u, CLV +2,39 % sobre 106 medidas; por casa `Pinnacle n=79 +12,22 u CLV +2,82 % · Bovada n=55 +5,76 u CLV +2,04 % · Cloudbet n=24 −0,40 u CLV +1,48 %`; la familia hermana `RONDAS` (totales) "104 picks, −8,65 u" (`:13997`).
- **Autopsia 2-sep** (`docs/AUTOPSIA_MODELOS_2026-09-02.md`): CS2 todas `n 738 · 47,6 % · ROI +4,0 % · CLV +2,2 · Brier 0,252 vs 0,244 (mercado)`; `RONDAS_HANDICAP` perro `n 183 · 54,1 % · +18,6 %`; RONDAS_HANDICAP conserva +5,7 % al cierre (n 374); "Pinnacle cotizando solo (bq1): 287 picks, +15,6 %, CLV +1,7 (t 4,4)"; Cloudbet bq1 −9,1 % con CLV +3,6 (n 91) (`:63-64, 179-191`). Valorant todas `n 304 · 35,2 % · −8,2 % · Brier 0,248 vs 0,221`; en `RONDAS_HANDICAP` el equipo elegido "ganó el mapa solo el 38 %" (`:65, 164-171`). Dota `KILLS/KILLS_H` `n 122 · 50 % · −6,9 % · Brier 0,273 vs 0,252` (`:67`). Peso `c` del modelo: `CS2 RONDAS −0,91 (t −1,0) · CS2 RONDAS_HANDICAP 0,35 (t 0,9) · Valorant −0,35 (t −0,7)` (`:103-107`). Calibración CS2 tramo 60-70: modelo 64,3 · mercado 54,0 · observado 50,2; Valorant ≥ 70: 74,5 · 58,2 · 42,3 (`:87-88`).
- **HANDOFF 13-sep** (`HANDOFF.md:308-336, 451`): márgenes por lado `pinnacle RONDAS_HANDICAP 2,21 % · pinnacle RONDAS 2,83 % · cloudbet RONDAS_HANDICAP 3,13 % · bovada KILLS 2,35 %`; la línea no se mueve en `dota2 KILLS bovada 92,8 % · CS2 RONDAS bovada 56,2 % · CS2 RONDAS_HCP pinnacle 19,0 %`; "en NINGUNA de las diez familias el cierre predice mejor que nuestro precio de entrada (|t| < 2)"; veredicto `cerrar` para `CS2 RONDAS_HANDICAP cloudbet (t −3,31)`; CS2 rondas hándicap Pinnacle: `CLV +0,92 · t 2,96 · n 450 · 4 semanas de ROI positivo (+15,5/+33,7/+4,5/+9,0)` pero "el margen es 2,21 % y el CLV 0,92 %. Le ganamos al cierre, no a la casa".

---

## 3.9 El canal real de CS2 (pausado) — `real-executor/store.js`

- Entrada: solo señales de la sombra `cs2_rounds_v1` con mejor cuota en Cloudbet (`crearManualCs2`, `:1060-1087`), fila `familia: 'CS2_RONDAS', canal: 'manual', motivo: 'solo_manual'` fuera del perímetro de tarjetas.
- Gemelo automático (`ensayoCs2`, `:1170-1227`): resuelve el evento en Cloudbet, busca la selección exacta del mercado `map_round_handicap(.vN)` (`CS2_MARKET_RE`, `:1102`) por **nombre de equipo** y no por posición (`ladoEnLaCasa`, `:1109-1119`; "la casa reordena local/visitante"), arma el payload y con `GP_REAL_CS2_AUTO=true` lo envía por el brazo pasando por los mismos frenos que tarjetas.
- Stake plano `GP_REAL_CS2_STAKE` = 5 USD, "o el máximo de la casa si es menor; jamás más" (`:1120-1125`).
- Llave maestra `GP_REAL_CS2_ENABLED` (`cs2RealOn`, `:1129`): pausada el 7-sep tras "dos semanas en rojo (−66,9 sobre 600) y el fallo de identidad MOUZ/Spirit" (`:1126-1128`; HANDOFF.md:712-713: 20G/34P). El barrido (`server.js:14292-14336`) crea filas manuales y ensaya solo si `cs2RealOn()`.
- Liquidación real: usa el mismo veredicto que la sombra (`server.js:14281-14290`); bug del 7-sep con `ref_id` vacío (TODO_NEXT.md:292-296).

---

## 3.10 Parámetros y variables de entorno

| Nombre | Default | Efecto | Dónde |
|---|---|---|---|
| `GP_ESPORTS_PUBLIC_ENABLED` | off (admin-only) | abre `/api/esports/*` al público por tiers | `server.js:20971` |
| `GP_ESPORTS_BOOKS` | todas | lista de casas activas (`cloudbet,pinnacle,bovada`) | `books.js:57-61` |
| `CLOUDBET_API_KEY` | — | sin ella Cloudbet no está "ready" | `books.js:37` |
| `PINNACLE_GUEST_KEY` | clave pública del cliente web | cabecera `x-api-key` de Pinnacle | `pinnacle.js:33` |
| `GP_ESPORTS_CLOSES_ENABLED` | true | enciende `esChain` (picks → cierres → retiradas → liquidación) cada 20 min y el barrido fino cada 2 min | `server.js:13278-13320` |
| `GP_CS2_HARVEST_ENABLED` | 1 | cosecha diaria bo3 + roster + scoreboards | `server.js:517` |
| `GP_LAMBDA`, `GP_MAP_PRIOR`, `GP_CAL_SLOPE` | 1,6 · 20 · 0,873 | solo en `cs2-validate.js` (producción usa constantes fijas) | `cs2-validate.js:183-185` |
| `GP_VAL_DIR`, `GP_VAL_OUT` | `/data/val-raw`, `/data/val-agg` | crudo y agregados de Valorant | `valorant-harvest.js:25`, `valorant-aggregate.js:297`, `valorant-data.js:24` |
| `GP_DOTA_DIR` | `data/esports/dota2` | agregados de Dota | `dota-aggregate.js:16` |
| `GP_PICKS_ERA` | `v2-2026-09-02` | marca de era en picks de Valorant | `store.js:783` |
| `GP_REAL_CS2_ENABLED` | true (hoy `false`) | canal CS2 al dinero | `real-executor/store.js:1129` |
| `GP_REAL_CS2_AUTO` | false | envío automático del payload ensayado | `real-executor/store.js:1174` |
| `GP_REAL_CS2_STAKE` | 5 | stake plano CS2 | `real-executor/store.js:1125` |
| `GP_EXPORT_KEY` | — | llave de `/api/internal/esports`, `/api/internal/vara` | `server.js:22505, 25258` |
| Constantes de código | `SINGLE_BOOK_PENALTY_PP 2,5` · `minEdgePp 3` · `nFull 60` · `maxModel 0,45` (Valorant 0,25) · `momentum 0,06` · `STAKE_CAP 2 %` · `CLOSE_MAX_GAP 3` · `NEAR_MS 8 h` · `ORIENT_MAX_PP 25` · `ARB_MAX_PCT 8` · `SHOCK_DAYS 45` · `MIN_N 100 / MIN_T 2` (vara) · `K_DEFAULT 0,28 / RATIO 0,75` (unc) | | citadas arriba |

---

## 3.11 Debilidades, supuestos y riesgos observados en el código

1. **La ventaja se mide contra `1/cuota` CON margen** (`core.js:227`) aunque el ancla use consenso sin margen. El listón de 3 pp no es homogéneo entre casas (la Autopsia lo señala: `p_market = 1/cuota con margen`, `:174`, y pide `p_mkt = consenso sin margen (Shin o proporcional)`, `:258`). El único devig implementado es proporcional (`noVig`).
2. **Doble compresión en CS2.** `clampRound` se aplica dentro del anclaje de mapas (`cs2.js:375, 385`) y otra vez al simular rondas (`:396, 421`); además `mapProbsA.p_a` (ya comprimida) entra como probabilidad de mapa en `simulateSeries` (`:463`). La Autopsia lo llama "`clampRound` aplicado dos veces (0,42² ≈ 0,18 de la ventaja real) … hándicaps de mapa y totales de mapas achatados" (`:189-191`) y aconseja "Corregir la doble compresión solo tras validarlo walk-forward" — sigue en el código.
3. **Circularidad entre ancla y familias derivadas.** Solo se excluye la familia que ancló (`store.js:805-813`); todas las demás dependen de `pSeries` anclada al mismo tablero, de modo que una discrepancia entre casas en el ganador se propaga a "ventajas" en rondas/mapas. La guardia de orientación (25 pp) atrapa solo el caso extremo.
4. **Etiqueta `unc_sample_pp` inservible en CS2.** `recordPicks` toma `matches_a/b` de `out.rating`; para CS2 (sin `ownInputFor`) eso viene del Elo genérico `ratings('cs2')` sobre `results-cs2.json`, vacío (`store.js:526-528, 173-182`) → `uncPp(0,0) = 28 pp` y `unc.passes` siempre falso. En Valorant/Dota `matches_a = matches_b = own.sample` (el mínimo del par), no el n de cada lado (`:527`).
5. **Muestra "del par" que no es del par.** `core.uncertainty` etiqueta `sampleTerm` como "muestra propia del par", pero CS2 pasa `min(mapas_A, mapas_B)` (cientos) (`cs2.js:345`) y Valorant/Dota `min(series_A, series_B)`; con eso el término es casi nulo y la epistémica la dominan `marketTerm` y los `missing` fijos (2,2 pp por ítem, incluyendo siempre "demos"/"composiciones"/"detalle por jugador").
6. **Constantes de autor sin validación en Dota 2 y en la serie**: `SIDE_EDGE 0,021` (mientras la medida 3,7 Elo no se usa en `analyze`), duración `σ 0,26+0,05`, kills `×(1+0,07·gap)`, reparto `0,66 ± 0,10·z`, curva de comeback; `momentum 0,06` y coeficiente de veto 6 declarados "experimentales" (`cs2.js:528-530`). La cabecera de `dota2.js:18-22` está desactualizada respecto a la capa de datos.
7. **Calibración con un grado de libertad y dos objetivos**: `calibrateDrag` ajusta solo la prórroga a `p = 0,5`; el sesgo de rondas medias se cobra después como incertidumbre (`calibrationPp`), no se corrige. La Autopsia añade "calibración medida-no-ajustada para mapas con 40-79 muestras" (`:191`).
8. **Liquidación de Dota 2 puede ser prematura.** `dota2Results` agrupa partidas por `series_id` conforme aparecen en `/proMatches`; `settleOne` liquida `TOTAL_MAPAS`/`HANDICAP` con `maps_a + maps_b` sin comprobar que la serie esté terminada (`store.js:1536-1544`); una BO3 en 1-0 al momento del barrido (pendiente ≥ 20 min tras el inicio) casaría como serie de 1 mapa. No encontrado en el código un guardia equivalente al de "mapa no jugado" para estas dos familias.
9. **`rows` de cierres admite lecturas hasta 15 min después del inicio** (`snapshot`, `store.js:279`) y la fusión conserva precios viejos: el "cierre" puede ser un precio en vivo o de horas antes; se mitiga con `pre_min`/`clv_lag` y los cubos, pero `clv_pct` (la métrica histórica) sigue saliendo de `rows`. `closeOddsFor` cae a **otra casa** si la propia no cotiza la línea (`:1632-1636`).
10. **Ids canónicos dependen del resolutor solo en CS2** (`resolverFor`, `store.js:115-118`); en Valorant/Dota el id sale de `norm()` + `ALIAS` de `books.js`, así que un cambio de nombre en una casa parte el histórico de ese evento (riesgo reconocido en `:108-114`).
11. **Ventana de casado ±30 h en Valorant** (`day_only`) admite confundir dos series del mismo par en días contiguos (el comentario `:1738-1743` lo asume "en la práctica").
12. **Selección por discrepancia con un modelo más ruidoso que el mercado** (Autopsia §3): el observado cae por debajo del mercado en los tramos donde el modelo más discrepa; el peso `c` es ≤ 0 en CS2 RONDAS y Valorant. Aun así el motor publica `p_gp` tal cual (no hay blend `c` en esports, `:123-124`).
13. **Point-in-time en producción.** Los agregados de CS2 (`team-maps`, `team-global`, `maps`) y el Elo de Valorant/Dota se calculan sobre todo el histórico en cada carga; para predecir en vivo es correcto, pero cualquier re-lectura del track con `p_gp` recalculado sería look-ahead. La validación sí es walk-forward (`cs2-validate.js:129-135`, `dota-validate.js:3-6`, `valorant-validate.js:3-4`).
14. **Muestras y sesgo de supervivencia del track**: `retireCrossedPicks` y los `VOID` por parseo/caducidad/mapa no jugado sacan filas del ROI (0 unidades); el 19 % de partidos "rejected" de bo3 y la muestra de CS2 "contaminada por el fallo de identidad" hasta el 7-sep (`TODO_NEXT.md:301-305`) forman parte del histórico de `cs2_rounds_v1`.
15. **Derechos de fuente**: bo3.gg desaconseja el acceso automatizado; vlr.gg y OpenDota son `research_only`; ninguna fuente es `betting_commercial_ok` (`RIGHTS.md`). El código lo declara, pero la línea de producto (pública por env) y la sombra conviven con esa restricción solo por configuración.
16. **Constantes duplicadas** entre cosecha y validación "a propósito" (`cs2-validate.js:175-177`) y valores por defecto de `priors` en código distintos de los archivos (`valorant-data.js:45` vs `priors.json`): riesgo de divergencia silenciosa si falta el archivo.
17. **Hardcodes de producto**: `MAP_POOL` de CS2 y Valorant con versión `2026-08`, `TEMPO` de Dota, `AGENT_CLASS` de Valorant, `T1DOTA` regex, `ALIAS` de casas; todos requieren mantenimiento manual y no llevan test.

---

# Parte 4 · Esports: League of Legends, generador de kills y props de jugador

> **Qué cubre esta sección y qué no.** La sección 03 describe el núcleo común de esports: el mostrador de
> casas (`data-providers/esports/books.js`), el sin-margen y el consenso, el ancla de mercado
> (`core.marketAnchor`), el anclaje modelo↔mercado (`core.anchoredProbability`), `core.evaluateEdge`, la
> simulación de serie, el archivo de cierres, el `track` y la vara. **Aquí no se repite nada de eso**: se
> describe lo que es exclusivo de League of Legends (motor, base propia de Leaguepedia, familias de kills,
> la familia congelada `lol_kills_hcp_v1`), el **modelo generativo de kills** (`lol-gen.js` + su sombra), las
> **props de jugador de CS2 contra Underdog** (`props.js`) y el **Boleto GP** del frontend. Donde una pieza
> es compartida se cita y se remite a 03.

---

## 4.0 Mapa de la sección

| Pieza | Archivos | Estado | Público |
|---|---|---|---|
| Motor LoL (mapa, serie, duración, kills, objetivos, draft) | `esports-engine/lol.js`, `lol-data.js` | vivo, genera picks | admin-only (`GP_ESPORTS_PUBLIC_ENABLED`) |
| Familia congelada `lol_kills_hcp_v1` | `server.js:14016-14026` | ejecutor en la **sombra** (paper) | interno |
| Generador de kills liga×parche | `esports-engine/lol-gen.js`, `lol-gen-shadow.js` | **sombra propia**, nunca pick | interno |
| Props de jugador CS2 | `esports-engine/props.js`, `data-providers/esports/underdog.js` | **sombra propia**, nunca pick | vista "Props" (plan **sharp**) |
| Boleto GP | `public/premium.js:2532-2615` | producto | plan Pro |

Tres registros **separados por completo**, con tres archivos distintos en disco y tres reglas congeladas
distintas: las picks de LoL (`<disk>/esports/picks-lol.json`, vía `esports-engine/store.js`), el generador
(`<disk>/implicito/lol_gen.json`, vía `implied-engine/sombra.js`) y las props (`<disk>/esports/props-cs2.json`).
Ninguno escribe en el otro (`props.js:9-17`, `lol-gen-shadow.js:1-9`).

---

## 4.1 LEAGUE OF LEGENDS — propósito y alcance

`esports-engine/lol.js:1-21` declara por qué LoL no es "CS2 con otro nombre" y cuál es la cadena causal que
modela:

```
fuerza relativa → ritmo de la liga → duración esperada → kills por minuto → total de kills
```

Y el comentario del autor explica la tesis de producto (`lol.js:18-21`):

> "Modelar el total de kills como un número plano por liga es lo que hace todo el mundo y por eso el mercado
> ya lo tiene metido en el precio. La estructura está en el ACOPLE: una partida que se alarga no suma kills
> linealmente […] y una paliza corta tiene MENOS kills totales pero MÁS desequilibrio."

Las tres diferencias estructurales frente a CS2, escritas en el propio archivo (`lol.js:5-14`):
1. **No hay veto de mapas** — hay *draft* (bans y picks de campeón), que es veto de herramientas, no de terreno.
2. **No hay rondas** — la unidad derivada es la **duración** y los **objetivos** (torres, dragones, barones, heraldo).
3. **Es el único de los cuatro juegos con mercado de kills abierto**, medido el 16-ago contra el proveedor.

**Familias declaradas** (`lol.js:29`): `SERIE`, `MAPA`, `HANDICAP`, `TOTAL_MAPAS`, `MARCADOR`, `KILLS`,
`KILLS_EQUIPO`, `KILLS_HANDICAP`, `KILLS_DNB`.
**Familias donde el motor dice mandar** (`lol.js:31`, `edge_families`): `KILLS`, `KILLS_EQUIPO`,
`KILLS_HANDICAP`, `TOTAL_MAPAS`. El ganador queda **anclado al mercado por doctrina** (comentario en
`lol.js:30`).

**Alcance de competiciones:** sin lista blanca. El motor procesa lo que el mostrador de casas publique para
`lol`; el nombre de competición se usa para resolver el perfil de ritmo (`tempoOf`, `lol.js:54-59`) y la liga
de la base propia (`lol-data.tempoFor`, `objectivesFor`). No hay veto de ligas ni bandas de eficiencia en el
motor de esports — **no encontrado en el código**.

**Derechos (determinante del alcance).** `data/esports/lol/RIGHTS.md` establece la regla LOL-0038: *"una pick
pública solo puede nacer de features cuyo linaje sea `betting_commercial_ok`"*, y **ninguna** de las fuentes
de LoL lo es. Consecuencia escrita: *"LoL es admin-only, todas sus familias corren en SOMBRA, y la
probabilidad publicada sigue ANCLADA A MERCADO"*. Riot Developer Tools aparece marcada como
`prohibited_betting` ("la política de Riot prohíbe funcionalidad de apuestas"); GRID figura como
`upgrade_path` (con contrato, sí).

---

## 4.2 Fuentes de datos de LoL

### 4.2.1 Mercado
Las tres casas (Pinnacle, Cloudbet, Bovada) y su normalización viven en `data-providers/esports/books.js`
→ **sección 03**. Lo específico de LoL: **el mercado de kills lo cotiza sobre todo Cloudbet**; la nota que
congela la familia dice literalmente *"Kills lo cotiza solo Cloudbet y la línea casi no se mueve"*
(`server.js:14012-14013`).

### 4.2.2 Base histórica propia — Leaguepedia (Cargo API)
`scripts/lol-harvest.js`. Tres tablas con ventanas distintas (`lol-harvest.js:22-29`):

| Archivo | Tabla Cargo | Ventana | Campos |
|---|---|---|---|
| `games.json` | `ScoreboardGames` | 2020-01 → | equipo1 (= lado **azul**), equipo2, ganador, fecha, parche, duración, kills/dragones/barones/torres/oro por lado, torneo (`OverviewPage`) |
| `players.json` | `ScoreboardPlayers` | 2023-01 → | por partida y jugador: campeón, rol, K/D/A, CS, oro, lado |
| `drafts.json` | `PicksAndBansS7` | 2024-01 → | bans y picks **con orden** |

Transporte: `Special:CargoExport` (modo `--export`), 5.000 filas por llamada, frente a las 500 de `api.php`
para anónimos (`lol-harvest.js:44-48`). El limitador de Fandom es **un cubo de fichas**, no un límite por
tamaño: *"comprobado que una petición pasa y la siguiente no"* (`lol-kills-backfill.js:26-28`). Ante 429 se
**espera la ventana entera** hasta ~2 h por llamada y, si no pasa, se **lanza error** para que el job salga
con código ≠ 0 y la siguiente pasada reanude desde el cursor — la versión anterior daba la tabla por
terminada con 0 filas, que *"es PEOR que fallar: contamina el estado con un LISTO falso"* (`lol-harvest.js:56-62`).

**Dónde corre** (`server.js:713-735`, `lolHarvestJob`): solo con `GP_LOL_HARVEST` en on; escribe en
`GP_LOL_DIR` o `/data/lol-raw` (disco persistente de Render) porque *"el checkout se BORRA en cada deploy"*
(`lol-harvest.js:35-37`). Corre como proceso hijo (`opsSpawn`) con `heapMb: 900` porque *"players.json completo
pesa 145 MB planos"* (`server.js:729-730`), `timeoutMin: 60`, y **se reprograma sola a los 20 min** si
`state.json` no dice `complete` (30 min si hubo excepción). Primer disparo a los 6 min del arranque
(`server.js:735`). Recogida y subida: `GET/POST /api/internal/lolraw?key=&file=` (`server.js:21737-21783`),
cuatro archivos permitidos, gzip, y **una subida se rechaza con 409 si trae menos filas que el disco**
("una subida nunca puede degradar el estado").

Estado documentado en HANDOFF.md:951: la cadena está **apagada** (`GP_LOL_HARVEST=0`) porque *"con 145 MB de
players el hijo de 220 MB moría y en Render no aporta"*; el refresco es un chore mensual manual.

### 4.2.3 Resultados para liquidar — Leaguepedia, con lolesports de respaldo
`data-providers/esports/leaguepedia.js`. La cabecera (`:1-15`) documenta el motivo exacto:

> "LoL llevaba 18 picks generadas y CERO liquidadas. No era un fallo de emparejamiento ni de nombres — era
> estructural. […] la fuente de resultados que teníamos —lolesports— solo publica el MARCADOR DE SERIE. Sin
> kills por partida, `settleOne` devolvía null y la pick se quedaba abierta para siempre."

`cargo()` (`leaguepedia.js:26-41`) pide `Team1, Team2, Team1Kills, Team2Kills, Team1Score, Team2Score,
Gamelength_Number, WinTeam, DateTime_UTC` sobre `ScoreboardGames`, ordenado por fecha descendente, límite
5.000. `lolGamesWithKills()` (`:47-81`) agrupa **partidas en series** por `día|par de equipos normalizado`,
orienta todas las partidas al primer equipo visto (`flip`, `:64-65`) y devuelve una fila por serie con
`maps[]` (kills_a, kills_b, kills_total, minutes, winner). Caché: `since` + `ttlMs = 30 min`, ventana por
defecto **5 días**. El comentario justifica el cacheo fuerte: *"Liquidar no es urgente […] y gastar fichas
aquí se las quita al rellenado histórico"* (`:14-15`).

Registro de fuentes (`results.js:321-322`): `lol: { fn: lolResultsWithKills, name: 'leaguepedia' }`, con
`lolResults` (lolesports, `results.js:204-230`) de respaldo si Leaguepedia devuelve vacío o falla
(`results.js:232-238`). El respaldo **solo permite liquidar ganador de mapa y totales de mapas**, no kills
(`results.js:315-322`).

**Qué pasa si falla la fuente:** `settleOne` devuelve `null`, la pick queda `ACTIVE` con su motivo; si el mapa
no se jugó y la serie está terminada, se anula con `VOID` (`store.js:1851-1866`). Retraso conocido y medido:
*"Leaguepedia tarda ~1 día en cargar los scoreboards"* (HANDOFF.md:1033).

### 4.2.4 Interruptor de emergencia
`RIGHTS.md` (LOL-0046): borrar `data/esports/lol/*.json` degrada el motor a **mercado-solo** sin romper nada
(`lol-data.load()` devuelve `available:false`, `lol-data.js:38`; `available` exige > 500 partidas, `:220`).

---

## 4.3 La base propia: archivos, tamaños y rangos

Directorio `data/esports/lol/` (medido en el repo):

| Archivo | Bytes | Contenido |
|---|---|---|
| `games.json.gz` | 4.607.136 | **97.588 partidas**. Claves de meta: `rights_class, source, cursor, at, done, done_at` |
| `drafts.json.gz` | 2.234.147 | **33.185 drafts** con orden |
| `player-stats.json` | 5.985.805 | agregado: **2.883 jugadores** (de 535.478 filas crudas) |
| `champions.json` | 1.406.907 | **18.695 filas** patch×rol×campeón + **7.933** filas de bans + `games_by_patch` + `shrink_k` |
| `assets.json` | 346.556 | manifiesto de escudos y fotos auto-hospedadas |
| `priors.json` | 1.674 | constantes del Elo + validación walk-forward |
| `gen-priors.json` | 2.929 | validación walk-forward del generador de kills |
| `meta.json` | 382 | ventanas y licencia |
| `RIGHTS.md` | 4.531 | registro de derechos |

`meta.json` (transcrito literal):

```json
{"at":"2026-09-02T08:07:10.489Z","source":"Leaguepedia (lol.fandom.com) Cargo API",
 "license":"CC BY-SA — atribución a Leaguepedia requerida",
 "rights_class":"research_attribution_ccbysa","games":97588,"players_rows":535478,"drafts":33185,
 "players_window":{"from":"2023-01-06 06:20:00","to":"2026-09-01 22:47:00"},
 "window":{"from":"2020-01-03 07:33:00","to":"2026-09-01 22:47:00"}}
```

Forma de una fila de `games` (última del archivo):

```json
{"id":"Liga Regional Sur/2026 Season/Split 2 Playoffs_Round 3_2_4","t1":"Golden Lions","t2":"Maze Gaming",
 "win":"Golden Lions","at":"2026-09-01 22:47:00","patch":26.17,"len":27.716666666667,
 "k1":26,"k2":7,"d1":4,"d2":0,"b1":1,"b2":0,"tw1":11,"tw2":1,"g1":58450,"g2":48151,
 "page":"Liga Regional Sur/2026 Season/Split 2 Playoffs"}
```

`t1` es **siempre el lado azul** (`lol-harvest.js:23`, `lol-validate.js:90`). La liga se deriva del primer
segmento de `page` (`lol-data.js:48`).

**Scripts del linaje:**
- `scripts/lol-harvest.js` — cosecha (§4.2.2).
- `scripts/lol-kills-backfill.js` — rellenó kills y objetivos sobre la base vieja (espejo de HuggingFace) que
  traía *"84.586 partidas con duración y con TODO LO DEMÁS NULO"* (`:3-4`). Cruza por **clave natural**
  (instante exacto + los dos equipos) porque el espejo re-numeraba las filas y *"un cruce por id daba 0 de 500
  en la primera página"* (`:18-23`). Con el cambio del 2-sep a la cosecha propia este script queda histórico.
- `scripts/lol-aggregate.js` — del crudo a los agregados que viajan en el repo: `player-stats.json` (rating GP
  **normalizado por rol**, LOL-0007), `mastery.json`, `champions.json` (posterior por parche mayor × rol con
  encogimiento, LOL-0183, + presencia pick+ban, LOL-0187) y opcionalmente `comps.json`. Con `--base` embarca
  también `games.json.gz` y `drafts.json.gz`.
- `scripts/lol-validate.js` — la validación que produce `priors.json` (§4.4).
- `scripts/lol-gen-fit.js` — la validación que produce `gen-priors.json` (§4.10).

---

## 4.4 El rating: Elo walk-forward con lado azul y recencia por parche

### 4.4.1 El script de validación (`scripts/lol-validate.js`)

Cuatro predictores sobre exactamente las mismas partidas (`:11-14`): `moneda` (0,5 siempre), `lado` (solo la
tasa del azul), `elo` (Elo global sin lado) y `gp` (Elo + lado + recencia por parche).

Fórmulas (`lol-validate.js:93-116`):

```js
pElo = 1 / (1 + 10^((rb - ra) / 400))
pGp  = 1 / (1 + 10^((rb - ra - sideElo) / 400))        // sideElo: ventaja de lado azul, en puntos Elo, ONLINE
kEff = (parche mayor cambió) ? K * patchDecay : K       // recencia por parche
upd  = kEff * (y - pGp);  elo[t1] += upd; elo[t2] -= upd
sideElo += sideStep * (y - pGp)
```

Disciplina metodológica (`:81-92`): barrido de constantes **solo** en desarrollo (`K ∈ {12,16,20,26,32}`,
`patchDecay ∈ {1, 1.5, 2}`, `sideStep ∈ {1,2}`), ventana intacta = **últimos 120 días**, evaluada **una única
vez** con las constantes ganadoras. Solo se puntúa el partido si **ambos** equipos tienen ≥ `MIN_N` = 10
partidas (`:99`). La actualización del Elo se hace **siempre después** de predecir (`:105`).

Métricas: Brier, `skill_pct = 100·(1 − Brier/0,25)`, AUC (rango medio con empates, `:47-59`), ECE en 10 bins
(`:60-71`) y acierto.

### 4.4.2 `priors.json` transcrito

```json
{ "at": "2026-09-02T08:05:07.766Z", "model_version": "lol-elo-side-patch-1",
  "source": "base propia (Leaguepedia, research_attribution_ccbysa)",
  "constants": { "K": 32, "patch_decay": 1, "side_step": 1, "min_n": 10 },
  "side_advantage_elo": 24.5, "blue_wr_pct": 52.79, "games": 97588, "teams": 3251 }
```

| ventana | predictor | n | Brier | skill % | AUC | ECE | acierto % |
|---|---|---|---|---|---|---|---|
| desarrollo | **gp** | 72.903 | 0,22443 | **10,23** | 0,6814 | 0,0127 | 63,34 |
| desarrollo | elo | 72.903 | 0,22517 | 9,93 | 0,6816 | 0,0307 | 63,00 |
| desarrollo | lado | 72.903 | 0,24915 | 0,34 | 0,4964 | 0,0010 | 52,94 |
| **intacta 120 d** | **gp** | 4.372 | 0,22059 | **11,76** | 0,6893 | 0,0161 | **64,41** |
| intacta 120 d | elo | 4.372 | 0,22172 | 11,31 | 0,6894 | 0,0365 | 63,17 |
| intacta 120 d | lado | 4.372 | 0,24780 | 0,88 | 0,5062 | 0,0250 | 55,31 |

Nota del propio archivo, importante para una auditoría:

> "walk-forward estricto; constantes elegidas SOLO en desarrollo; la ventana de 120 días se evaluó una única
> vez. **Brier skill NO es rentabilidad**: sin histórico de cuotas propio de LoL, esto dice que el modelo
> predice, no que gane dinero — por eso la probabilidad publicada sigue anclada a mercado."

Lectura honesta del resultado: `gp` gana a `elo` por **0,45 pp de skill** en la ventana intacta (11,76 vs
11,31) — casi todo lo que aporta el modelo es el Elo, y el lado azul solo mejora la **calibración**
(ECE 0,0161 vs 0,0365). Como predictor solo, el lado azul es ruido (AUC 0,5062).

### 4.4.3 El rating en runtime (`lol-data.js:69-96`)

Se recalcula **en cada carga** recorriendo las 97.588 partidas en orden cronológico con las constantes de
`priors.json` (K=32, patch_decay=1, side_step=1), actualizando `sideElo` online. Caché en memoria de **10
minutos** (`lol-data.js:36`). Estado inicial 1500. Se acumulan además: winrate global, forma (últimos 10
partidos con marcador de kills), pares head-to-head (`pairs`).

**Ranking GP** (`:98-116`): se limita al **circuito principal**. El comentario documenta el fallo que lo
obligó (`:103-105`):

> "el Elo se INFLA en piscinas cerradas de tier-2 (ERL/academias juegan solo entre sí y nadie las corrige
> hacia abajo) → el ranking lo encabezaban Galions/Solary por delante de LCK/LPL."

Filtro: regex `TIER1` (`:106`) sobre LCK/LPL/LEC/LCS/LTA/LCP/LLA/CBLOL/Worlds/MSI/First Stand/EWC, ≥ 6
partidas en 90 días; si salen menos de 15 equipos se cae al filtro genérico ≥ 10 partidas en 90 días. Top 60.

**Resolución de nombres** (`:255-275`): exacto → alias → prefijo. Los alias solo se indexan **cuando una sola
marca los reclama** (`:233-248`): *"si dos equipos comparten alias, el alias se descarta antes que arriesgar
confundirlos"*. Y el prefijo tiene guardia `SQUAD` (`:266`) contra academias y filiales
(`challengers|academy|youth|rookies|prospects|female|fe|gc|2|ii|b`), porque *"darle a la academia el quinteto y
el Elo del primer equipo es darle el pasado de otro"*.

**Puerta de estructura por par** (`datasetFor`, `:425-433`): `available` solo si ambos equipos resuelven **y**
`min(matches_a, matches_b) ≥ 15`.

### 4.4.4 Tempo y objetivos **medidos** por liga (`lol-data.js:181-217`)

En la misma pasada, sobre los **últimos 180 días**:
- `leagueTempo[liga] = { n, kpm = Σkills/Σmin, mean_min }`, solo si `n ≥ 20`.
- `leagueObjectives[liga] = { n, mean_min, dragons, barons, towers }` (medias por partida), cada contador solo
  si tiene ≥ 20 partidas con ese campo. El heraldo **no viene en la base** y se queda como supuesto (`lol.js:166`).

Casado del nombre de liga (`tempoFor`, `:308-324`): **el exacto gana siempre**; entre parciales gana el más
largo. El comentario cuenta el fallo: *"con la competición 'LCK' el más largo es 'LCK Academy Series' y el
partido de la liga principal se llevaba el ritmo de la academia"*.

---

## 4.5 Del rating a la probabilidad — `lol.js: analyze()`

`analyze({ market, ratings, bo, sample, competition, observedTempo, observedObjectives })`, `lol.js:270-312`.

**Paso 1 — ancla de mercado.** `C.marketAnchor(bookRows, bo)` (núcleo, §03) recorre SERIE, MARCADOR, HÁNDICAP
y ganador de mapa. `marketP` es la probabilidad sin margen resultante.

**Paso 2 — probabilidad del modelo.** `C.eloProbability(elo_a, elo_b)` si hay rating propio.

**Paso 3 — anclaje.** `C.anchoredProbability(marketP, modelP, { n: sample })` → `pSeries`. El peso del modelo
`w_model` lo fija el núcleo por muestra (§03); `whatMatters` (`lol.js:260-263`) imprime el caso
`w_model === 0`: *"El ganador es el del mercado sin margen, no una opinión de GP: aquí el motor no aporta y no
finge que sí."*

**Paso 4 — de serie a mapa.** `pMap = C.seriesToMap(pSeries, bo)`.

**Paso 5 — ritmo.** `tempo = calibrateTempo(tempoOf(competition), observedTempo)`.

Perfiles de arranque (`lol.js:40-50`), declarados explícitamente como **SUPUESTO, no medición** (`:39`, `:51`):

| liga | kpm | minutos |
|---|---|---|
| LCK | 0,62 | 32,5 |
| LPL | 0,94 | 30,0 |
| LEC | 0,86 | 30,5 |
| LCS | 0,82 | 31,5 |
| LTA | 0,88 | 30,5 |
| PCS | 0,90 | 30,0 |
| VCS | 1,02 | 28,5 |
| WORLDS | 0,70 | 33,0 |
| DEFAULT | 0,84 | 31,0 |

Encogimiento hacia lo medido (`calibrateTempo`, `:63-73`), con `PRIOR_GAMES = 25`:

```
w = games / (games + 25)
kpm     = base.kpm * (1−w) + observed.kpm * w
minutes = base.minutes * (1−w) + observed.minutes * w
measured = (w > 0.35)        // ⇔ games > 13,46
```

**`measured` es la llave de todo el producto de LoL**: la puerta `basisFor` (§4.6) solo abre las familias de
kills cuando `tempo.measured === true`.

**Paso 6 — duración** (`durationModel`, `:112-138`). Lognormal por Monte Carlo, **20.000 iteraciones**,
semilla determinista 41 (`C.rng`), Box-Muller:

```
gap   = |pMap − 0,5| · 2                  // 0 parejos … 1 paliza
mu    = ln( tempo.minutes · (1 − 0,16·gap) )   // el desequilibrio acorta hasta un 16 %
sigma = 0,20 + 0,05·(1 − gap)                  // las parejas también son más variables
min   = clamp( exp(mu + sigma·z), 18, 62 )
```

Salida: media, p10/p50/p90 y P(over) en 26,5 / 28,5 / 30,5 / 32,5 / 34,5.

**Paso 7 — kills** (`killsModel`, `:189-238`). **20.000 iteraciones**, semilla 53:

```
gap    = |pMap − 0,5|·2
kpm    = tempo.kpm · (1 + 0,13·gap)              // el desequilibrio calienta el ritmo
mins   = clamp( exp( ln(duration.mean_min) + 0,22·z ), 18, 62 )
lam    = kpm · mins · (0,86 + 0,30·U)            // sobre-dispersión uniforme [0,86 ; 1,16]
k      = Poisson(lam)                            // normal si lam > 30 (el caso normal)
shBase = clamp( 0,5 + (pMap − 0,5)·0,72 , 0,24 , 0,76 )
sh     = clamp( shBase + 0,085·z' , 0,12 , 0,88 )   // ruido del reparto
kA = round(k·sh);  kB = k − kA;  margen = kA − kB
```

El ruido del reparto está justificado en el comentario (`:203-205`): *"Sin ese ruido, el hándicap de kills
sale artificialmente seguro y es justo la familia con más líneas cotizadas."*

Salida: media, p10/p50/p90, `kpm_used`, `share_a`, medias por equipo, `handicap_mean`, P(over) en
20,5/22,5/24,5/26,5/28,5/30,5 y — lo que de verdad usa el valorador — **histogramas completos**
`dist.{total, home, away, margin}` (`:228`), *"lo que permite valorar CUALQUIER línea que publique la casa sin
interpolar colas"*.

**Paso 8 — objetivos** (`objectiveModel`, `:149-180`). Medias medidas de la liga cuando existen, escaladas por
el cociente entre la duración de este partido y la típica de la liga, acotado a [0,7 ; 1,4]; fórmula cuando no
hay muestra (dragones `min(6, m/6,2)`, barones `max(0, (m−20)/9)`, heraldo `m>14 ? 1,4 : 0,7`, torres
`4,6 + 0,20·m`). Cada ítem viaja con `measured` y `n`: *"Nunca se mezcla en silencio"* (`:148`).

**Paso 9 — lado y draft.** `sideModel` (`:88-96`) con `SIDE_EDGE = 0,025` en probabilidad (azul 52,5 %); el
`draftModel` (`:98-105`) es **narrativo**: fases, prioridad y un `missing` declarado. Las tasas de ban/pick por
campeón y equipo existen en la base (`championsBoard`, `draftIntel`) pero **no entran en la probabilidad**.

**Paso 10 — incertidumbre.** `C.uncertainty({ p, sampleMatches, marketBooks, missing })`. El array `missing`
(`lol.js:297`) cobra por: `'ritmo de kills medido de la liga'` (solo si `!tempo.measured`) y, **siempre**,
`'scoreboard por partida (kills y oro por jugador)'`.

**Qué NO entra en la probabilidad de LoL** (market-blind parcial): parche vigente como variable del modelo,
composición/draft, lineups y stand-ins, descanso, viajes, importancia del partido. Las señales de prensa del
observador (`observer/deportes.js`) son **DISPLAY, nunca modelo** (CLAUDE.md). El precio **sí** entra, por
construcción: la probabilidad publicada está anclada a mercado.

### 4.5.1 El puente store → motor: `lolOwnInput` (`store.js:407-421`)

Cuando la base propia resuelve a los **dos** equipos, sustituye:
- el Elo de resultados liquidados (~30 partidas) por el Elo propio de 97.588 partidas,
- el perfil de circuito asumido por el **tempo medido** de la liga,
- la aritmética de objetivos por los **conteos reales** de la liga.

`sample = min(matches_a, matches_b)`. Si no resuelve devuelve `null` y *"todo cae al camino anterior sin
romperse — el ancla de mercado absorbe la diferencia"* (`store.js:404-406`). Es exactamente este puente el que
convierte `tempo.measured` en `true` y **abre** las familias de kills.

---

## 4.6 De la probabilidad a la pick (lo específico de LoL)

El pipeline común (`store.js:800-900`) está en §03. Lo que toca a LoL:

**Familias con precio** (`probFor`, `store.js:628-651`), todas contra los histogramas de `killsModel`:

| familia | cómo |
|---|---|
| `KILLS` | `pOver/pUnder(dist.total, line)` — "ritmo del circuito × duración esperada" |
| `KILLS_EQUIPO` | `pOver/pUnder(dist[home|away], line)` |
| `KILLS_HANDICAP` | `pHandicap(dist.margin, line)`; el lado visitante usa `negHist(margin)` con `−line` |
| `KILLS_DNB` | `pHandicap(margin, 0)`, con el empate exacto renormalizado como push |

**La convención del hándicap**, comprobada contra precios reales (`store.js:588-597`): *"la línea se aplica
SIEMPRE al local, y el lado dice a quién apuestas con esa línea puesta"*. Y el comentario deja el diagnóstico:
leyéndolo al revés salía una ventaja de 38,8 pp — *"Una ventaja de 38 puntos contra una casa nunca es una
ventaja: es un fallo de lectura."*

**El espejo del histograma** (`negHist`, `store.js:663-669`): para valorar el lado visitante se **da la vuelta
al histograma** en lugar de restar de 1, porque restar de 1 *"cuenta el empate exacto para el lado equivocado"*.

**La incertidumbre por familia** (`uncertaintyFor`, `store.js:749-755`). Las familias de **volumen**
(`VOLUME_FAMILIES`, `store.js:714`: RONDAS, RONDAS_EQUIPO, KILLS, KILLS_EQUIPO, PRORROGA) pagan la del
**perfil**, no la del emparejamiento:

```
profile = measured ? 3,0 : 6,5      (pp)
market  = books ≥ 3 ? 1,5 : books ≥ 1 ? 3,5 : 6
unc     = √(profile² + market²)
```

Obsérvese un detalle con consecuencias: **`KILLS_HANDICAP` no está en `VOLUME_FAMILIES`**, así que paga la
incertidumbre **epistémica entera** (la del par). Es la familia más exigente de las cuatro de kills… y sin
embargo es la que más picks produjo.

**La puerta que más picks mata** (`basisFor`, `store.js:737-748`, con la nota larga de `:697-736`):

> "UN SUPUESTO NO GENERA PICKS. Solo la estructura MEDIDA genera picks."

Para las cuatro familias de kills, `measured = !!(model.tempo && model.tempo.measured)`. Si es falso,
`ev2.pick = false` con el código `estructura_no_medida`. El comentario documenta el caso que lo obligó
(`store.js:722-730`): una pick de LoL con **37,83 pp de ventaja**, cuando el modelo esperaba 28 kills y la casa
cotizaba 38 — *"no estaban en desacuerdo sobre este partido, estaban en desacuerdo sobre cuántos kills tiene un
mapa de LoL, y de los dos el que ha visto los partidos es la casa"*.

**Umbral y filtros** (`store.js:830-836`): `C.evaluateEdge({ pGp, odds, uncertaintyPp: uncF, minEdgePp: 3,
family, marketBooks, freshMin })`. `uncF = √(uncFam² + calPp²)`, donde `calPp` es el error de calibración de
rondas — **cero en LoL**, porque `calibrationPp` (`store.js:672-690`) exige `R.calibration.fitted`, que solo
produce el motor de CS2. Con una sola casa cotizando, el listón sube 2,5 pp (`store.js:1000`, núcleo §03).

**Ortogonalidad** (`store.js:806-813`): la familia que **ancló** la probabilidad queda excluida de la
valoración — *"medirse contra ella sería medirse contra uno mismo"*. Como en LoL el ancla suele ser SERIE o
MAPA, las familias de kills quedan libres, lo que explica por qué LoL produce picks donde CS2 no.

**Una opinión, una pick** (`store.js:870-899`): agrupación por **tesis** (`thesisOf`, `store.js:1077-1090`);
sale la de mejor ventaja y las demás se cuelgan como `same_thesis`. Motivo escrito: *"es cómo una cartera acaba
con todo el riesgo en una sola idea creyendo que está diversificada"*.

**Dedup**: `byKey = [family, line, side, period, map, team]`, quedándose con el **mejor precio** entre casas
(`store.js:816-821`). La pick nace una sola vez por `pick_id` (`store.js:1436`: *"ya nació: no se reescribe"*).

**Etiqueta de incertidumbre por muestra** (`store.js:1452-1461`, 9-sep): cada pick guarda `sample_n`,
`unc_sample_pp` (`implied-engine/uncertainty.uncPp`) y el veredicto que **habría** dado la puerta
`edge ≥ 0,75 × unc`. El comentario es tajante: *"SOLO etiqueta: qué picks nacen no cambia (cs2_rounds_v1 y
lol_kills_hcp_v1 siguen congeladas)"*.

**Stake**: `stake_pct` sale del núcleo (§03). En el segmento congelado del ejecutor en la sombra es
**Kelly/4 con tope 1,5 %** (`server.js:14023`).

---

## 4.7 `lol_kills_hcp_v1` — el cuarto segmento del ejecutor en la sombra

`server.js:14007-14027`. Entrada **nueva** anotada, nunca edición de un segmento vivo. Configuración:

```js
{ key: 'lol_kills_hcp_v1', sport: 'esports', game: 'lol', family: 'KILLS_HANDICAP',
  frozen_at: <ISO>, auto_books: ['cloudbet'], manual_books: ['pinnacle'] }
```

Nota congelada (`server.js:14024`): *"toda KILLS_HANDICAP de LoL que publique el motor · stake kelly/4 cap
1.5 % · mismo enrutado de casas que cs2_rounds_v1. Base: 221 picks, 60,6 %, +15,96 u. Aviso: CLV plano
(+0,04 % n=86) — mercado de una sola casa que no se mueve; la vara son los resultados, no el cierre."*

El comentario que la precede (`server.js:14007-14015`) es una pieza clave para la auditoría:

> "su CLV es PLANO (+0,04 % sobre 86 medidas, sd 1,8). Kills lo cotiza solo Cloudbet y la línea casi no se
> mueve — en un mercado muerto el CLV no informa, así que aquí la vara del experimento son los RESULTADOS
> contra el juice real, no el cierre. […] Además: rating propio walk-forward (Fase 3) pendiente — **dinero
> real NI HABLAR** hasta ese cierre."

La familia hermana `HANDICAP` (mapas) tenía mejor CLV (+11,2 %) pero n = 29, *"demasiado chica para congelar una
regla"*.

**Estado de dinero:** ninguno. CLAUDE.md es explícito: el dinero real vive solo en Cloudbet `cards_under_v1`
(~258 USDT) y tenis de mesa a 5 USD; CS2 real está pausado y LoL nunca se abrió.

---

## 4.8 Liquidación de LoL

### 4.8.1 `settleOne` para las familias de kills (`store.js:1567-1590`)

```js
kA = m.kills_a; kB = m.kills_b; kTot = (kA!=null && kB!=null) ? kA+kB : m.kills_total
KILLS           → cmp(kTot, line, isOver)
KILLS_EQUIPO    → cmp(team==='home' ? kA : kB, line, isOver)
KILLS_HANDICAP  → v = (kA − kB) + line;  v===0 → PUSH;  home: v>0 ; away: v<0
KILLS_DNB       → kA===kB → PUSH ; home: kA>kB ; away: kB>kA
```

`cmp` devuelve **PUSH** si el valor iguala exactamente la línea (línea entera clavada, `store.js:1530`).
Si la fuente no trae el dato, **null** — y la pick se queda sin liquidar con su motivo. La doctrina está
escrita (`store.js:1521-1524`): *"una pick mal liquidada envenena el histórico para siempre y no deja rastro"*.

Casos raros cubiertos:
- **Mapa no jugado**: si la serie terminó (alguien alcanzó `ceil(bo/2)`) y el mapa de la pick no existe → `VOID`
  con `unsettleable_why` (`store.js:1851-1866`). Antes se quedaban `ACTIVE` para siempre: *"así se apilaron 154
  picks de CS2 inliquidables"*.
- **Parseo rechazado por la fuente** → `VOID`, nunca WIN/LOSS (`store.js:1843-1849`), porque el resolutor de
  nombres *"acierta a medias"* con filiales y academias.

### 4.8.2 EL FALLO HISTÓRICO: "kills sin voltear" (2-sep)

`store.js:1819-1833`. Cuando la fuente lista la serie con los equipos invertidos, el emparejador voltea el
resultado. Hasta el 2-sep **solo se intercambiaban `score_a`/`score_b`**: `kills_a`, `kills_b` y `winner` se
quedaban en la orientación de la fuente. Consecuencia: *"en toda serie que la fuente listara al revés,
KILLS_HANDICAP / KILLS_EQUIPO / KILLS_DNB se liquidaban con los kills del equipo CONTRARIO"*.

La huella que lo delató, transcrita del comentario (`store.js:1825-1828`):

> "en LoL el 'local +x,5 kills' ganaba el 85 % y el 'visitante +x,5' el 41 % con la misma p_gp (0,72); en
> Dota 2, al revés (26 % / 68 %). **Ninguna asimetría real de mercado produce eso — un volteo a medias sí.**"

El arreglo (`store.js:1829-1833`) voltea **todo lo que tiene lado**: `maps_a/maps_b`, `score_a/score_b`,
`kills_a/kills_b` y `winner`.

**La re-liquidación** (`resettleKills`, `store.js:1666-1691`): reabre a `ACTIVE` las picks `SETTLED` de las
tres familias con lado (WIN/LOSS/PUSH; las VOID no se tocan), guarda lo que decían en `resettled_from`, y
vuelve a pasarlas por `settlePicks` con ventana larga (`maxDias = 45`). `KILLS` (total) no tiene lado y no se
toca. Es idempotente y devuelve un recuento `antes`/`despues`/`cambiaron`. Disparo:
`POST /api/esports/settle?game=lol&resettle=kills` (HANDOFF.md:922).

**El daño medido** (HANDOFF.md:907-909): *"85 de 245 picks de LoL cambiaron de veredicto; KILLS_HANDICAP pasa
de +14,7 u a +4,7 u"*. Es decir: **el track que justificó congelar `lol_kills_hcp_v1` el 31-ago estaba
inflado**, y la propia entrada congelada (que cita "221 picks, 60,6 %, +15,96 u") sigue llevando la cifra
anterior al arreglo.

### 4.8.3 Advertencia de la casa
CLAUDE.md lo generaliza: *"tres liquidadores mentían (tenis 0-0, kills sin voltear, totales en cubos de 5) —
antes de leer un track, comprobar que el marcador con el que se liquidó es coherente"*.

---

## 4.9 Medición: CLV, track y la vara

### 4.9.1 El CLV de una pick de LoL

`clv_pct = cuota_tomada / cuota_cierre − 1` (`store.js:1592-1594`), la misma fórmula de baloncesto *"para que
las cifras de los cuatro deportes se puedan poner en la misma tabla sin nota al pie"*.

**La interpolación de hándicaps** (`store.js:1595-1607`), otra pieza nacida de un problema medido en LoL:

> "El hándicap de kills de LoL lleva 132 picks liquidadas y solo ONCE con CLV. No es que falte el cierre —hay
> 149 cierres guardados—: es que la línea se mueve. Nacemos en +2,5 y la casa cierra en +3,5, y como este
> casador exigía la línea EXACTA, el 92 % de la familia se quedaba sin medir."

Reglas de la corrección: se interpola en **probabilidad implícita**, no en cuota; se marca la procedencia
(`exacta` / `interpolada`); y **no se interpola más allá de `CLOSE_MAX_GAP = 3` puntos** de línea porque
*"a esa distancia ya no es la misma apuesta"*.

Además (9-sep, `closeExtrasFor`, `store.js:1612-1625`): cierre de la **misma casa** en la línea exacta
(`close_own`, `clv_own_pct`) y curva por cubo T−60/−30/−10/−5/−1 desde `snaps`. El barrido fino de cierres corre
cada 2 min para juegos con picks a ≤ 65 min del saque (`server.js:13307-13312`).

### 4.9.2 El veredicto de la vara sobre LoL

`lib/vara.js` (§ "LA VARA" de CLAUDE.md). El orden es: **primero se pregunta si el CLV sirve**
(`cierreAporta`, `vara.js:78-95`), comparando el error de Brier del precio de entrada contra el del cierre
sobre las mismas liquidadas; exige ≥ 40 observaciones y `|t| ≥ MIN_T = 2`. Si el cierre **no** predice mejor,
manda `modeloContraPrecio` (`vara.js:100-116`): ¿la probabilidad del modelo acierta más que `1/odds`? Con
`t ≤ −2` el veredicto es **`cerrar`** (`vara.js:135-138`).

Lo medido y documentado en HANDOFF.md:321-336:

| familia | `cierre_t` / movimiento | `modelo_t` | veredicto |
|---|---|---|---|
| LoL `KILLS_HANDICAP` · bovada | línea sin mover el **56,9 %** | **−3,42** | **cerrar** |
| LoL `KILLS_HANDICAP` · cloudbet | — | **−3,52** | **cerrar** |
| sombra `lol_kills_hcp_v1` | — | **−3,65** | **cerrar** |
| LoL `KILLS` · bovada | CLV +2,00 · t 4,38 · n 124 | — | no invertible: **margen bovada KILLS 2,35 %** > CLV |

Y el resumen del estado de la evidencia (HANDOFF.md:456): *"TT, dardos, **LoL hcp**, baloncesto, NFL —
negativo o sin evidencia"*.

### 4.9.3 **Por qué el código sigue generando estas picks** (pregunta explícita de la auditoría)

Tres razones, todas verificables en el código:

**(a) La vara no está cableada al pipeline de picks.** `lib/vara.js` se requiere en exactamente **dos** sitios
del repositorio (`grep -rn "lib/vara"`): `server.js:25261` — el endpoint de solo lectura
`/api/internal/vara?key=&bankroll=` — y `futbol-derivadas.js:474`, que la usa para su propio informe. **Ningún
módulo de esports lo importa.** `esports-engine/store.js` no conoce la vara: sus puertas son `basisFor`
(estructura medida), `calibrationPp`, `uncertaintyFor` y `evaluateEdge` con `minEdgePp: 3`, y ninguna consulta
el veredicto por familia. Arquitectónicamente, la vara es un **instrumento de diagnóstico**, no un interruptor.

**(b) La decisión está tomada y es humana, no automática.** HANDOFF.md:334-336: *"La vara dice **cerrar**.
**Siguen abiertas: es cambio de lógica de picks y Alexis no lo ha ordenado.**"* Y en la lista de lo abierto
(HANDOFF.md:490): *"1. Cerrar las cinco familias con veredicto `cerrar` (LoL kills hcp ×3, CS2 rondas hcp
cloudbet, TT game points hcp). Es cambio de lógica de picks."*

**(c) La regla congelada lo prohíbe expresamente.** `lol_kills_hcp_v1` es un segmento **congelado**
(`frozen_at`), y la doctrina de la casa —repetida en `props.js:58-62`, en el segmento de CS2 y en el
PENDIENTE FIJO de CLAUDE.md— es que **cambiar la regla a mitad de la ventana destruye la muestra**:
*"Cambiarla a mitad de la ventana destruye lo único que la ventana produce, que es una muestra comparable."*
`store.js:760-762` lo dice para el caso concreto: *"CS2 y LoL no pasan por aquí: `cs2_rounds_v1` y
`lol_kills_hcp_v1` están congelados."* La etiqueta de incertidumbre del 9-sep (§4.6) se añadió precisamente
como **etiqueta y no como puerta** para respetar esa congelación.

Riesgo residual honesto: el coste de mantenerlas abiertas es **cero dinero** (nada de LoL es real) pero **no
es cero producto** — las picks de LoL se sirven a usuarios sharp cuando `GP_ESPORTS_PUBLIC_ENABLED` está en on,
y HANDOFF.md:465-467 reconoce el problema equivalente en fútbol: *"que 966 personas sigan viendo picks de
familias medidas como peores que el mercado es una decisión de producto que sigue ABIERTA"*.

---

## 4.10 EL GENERADOR DE KILLS — `esports-engine/lol-gen.js`

### 4.10.1 Propósito

La cabecera (`lol-gen.js:1-16`) es la mejor descripción posible y conviene citarla:

> "El modelo de kills que publica la casa (`lol.js: killsModel`) tiene la cadena correcta —fuerza → ritmo →
> duración → kills— pero sus constantes son de PERFIL: un kpm por circuito escrito a mano (**LCK 0,62 cuando
> la base mide 0,90**), una dispersión uniforme inventada (0,86-1,16) y un reparto lineal con pMap. La
> autopsia del 2-sep lo midió: **20-30 pp de sobreconfianza y peso del modelo c = −0,65**. Y prescribió esto:
> 'una distribución de kills calibrada en la base propia: media y varianza por LIGA y PARCHE, no por equipo'."

Es **DISPLAY/SOMBRA**: no toca `lol.js` ni `lol_kills_hcp_v1`.

### 4.10.2 Constantes congeladas (`lol-gen.js:31-44`)

| constante | valor | efecto |
|---|---|---|
| `version` | `lol-gen-2` | 2 = casado de liga por alias (LCK Challengers League → LCK CL) + liga desconocida con `n_eff` 20 |
| `window_days` | 365 | ventana de la celda liga×parche |
| `league_days` | 240 | ventana de la liga (sin parche) |
| `shrink_k` | 30 | partidas de prior en cada salto celda → liga → circuito |
| `min_cell` | 8 | por debajo, la celda no aporta |
| `recent_days` | 60 | ventana del centro reciente de la liga |
| `recent_min` | 25 | partidas mínimas para corregir el centro |
| `recent_days_2` / `recent_min_2` | 120 / 40 | ventana de respaldo |
| `recent_max_shift` | 0,15 | tope del desplazamiento del centro (en log) |
| `sims` | 20.000 | iteraciones |
| `seed` | 77 | semilla determinista |

Nota del autor: *"scripts/lol-gen-fit.js las valida; cambiarlas sin re-validar es mentir"* (`:30`).

### 4.10.3 Estadísticos de una celda (`stats`, `lol-gen.js:48-74`)

Filtros de fila: `8 < len < 90`, `k1`/`k2` finitos, `k1+k2 ≥ 2`, ganador identificable. Para cada partida:

```
share = kills_del_ganador / total ;  d = |share − 0,5|
llen  = ln(minutos) ;  lkpm = ln(total/minutos)
```

Y se ajusta por **OLS** el acople con la paliza:

```
b_len = Cov(d, llen) / Var(d)
b_kpm = Cov(d, lkpm) / Var(d)
sd_len, sd_kpm = desviación de los residuos
rho   = correlación de los dos residuos
```

Valores medidos y publicados en HANDOFF.md:602: **b_len −0,98 · b_kpm −0,38 · ρ −0,47** (una paliza es más
corta y — contra lo que asume `lol.js` — también **más lenta** en kills/min, no más rápida).

### 4.10.4 Encogimiento (`blend`/`paramsFor`, `lol-gen.js:111-126`)

Diez parámetros (`P_KEYS`) se encogen con `w = n / (n + 30)`: **circuito → liga → celda liga×parche**.
`n_eff` = `n_cell + min(n_league, 30)` cuando hay celda; `n_league` cuando solo hay liga; `min(n_global, 400)`
en el circuito. Una liga **desconocida** o que cae al circuito se recorta a `n_eff ≤ 20` (`:212-214`), con el
motivo escrito: *"La incertidumbre tiene que decirlo (n_eff 20 → ≈ 8 pp), no fingir las 400 partidas del prior."*

### 4.10.5 Simulación (`simulate`, `lol-gen.js:137-165`)

```
aWins  ~ Bernoulli(pMapA)                               // pMapA viene ANCLADA A MERCADO
shareW = clamp( share_win + share_win_sd·z , 0,5 , 0,95 )
d      = shareW − 0,5
z1 ~ N(0,1) ;  z2 = ρ·z1 + √(1−ρ²)·N(0,1)              // residuos correlados
llen   = llen + b_len·(d − d_mean) + sd_len·z1
lkpm   = lkpm + b_kpm·(d − d_mean) + sd_kpm·z2
len    = clamp( exp(llen), 12, 75 )
k      = max(2, round( exp(lkpm) · len ))               // SIN Poisson encima
shareA = aWins ? shareW : 1 − shareW
kA = round(k·shareA) ; kB = k − kA
```

La decisión de **no** añadir Poisson está documentada (`:150-152`):

> "el residuo de log-ritmo se midió sobre el ritmo REALIZADO […] así que ya lleva dentro el ruido de conteo.
> Sumar Poisson otra vez duplicaba la varianza (**107 simulada contra 65 medida en LCK**) y salía un modelo
> subconfiado."

**Calibración del centro** (`simulateCalibrated`, `:169-180`): se corre un piloto de ≤ 4.000 simulaciones, se
calcula `shift = ln(objetivo / media_piloto)` acotado a ±0,15, y se re-simula con `lkpm + shift`. El objetivo es
la media **reciente** de la liga si hay muestra, si no la aritmética de la celda. Motivo: *"la forma log-normal
ajustada por OLS reproduce la MEDIANA, no la media: sin esto el generador nacía ~1 kill bajo"* (`:170-171`).

**Precio de una línea** (`price`, `:185-193`): mismas cuatro familias, misma convención de hándicap del local
y mismo espejo `negHist`.

**Incertidumbre de nacimiento** (`uncPp`, `:197`), traída de tenis de mesa:

```
unc_pp = 100 · 0,28 · √( 2 / (n_eff + 2) )     // n_eff 30 → 7,0 pp ; 100 → 3,9 ; 300 → 2,3
```

### 4.10.6 `gen-priors.json` transcrito (validación walk-forward)

Producido por `scripts/lol-gen-fit.js` (`--write`). Método (`lol-gen-fit.js:3-9`): mes a mes desde 2024-01, se
ajusta con las partidas **anteriores** al mes (ventana 365 d) y se predice cada partida del mes con
**pMap = 0,5** (sin información de fuerza: lo que se mide es la distribución, que es lo que cotiza un total).
Competidores: **liga plana** (Poisson con la media de la liga a 240 d) y **circuito**; y un tercero, el
**histograma empírico** de la liga, *"el competidor honesto de un over/under"* (`:34`).

```json
{ "version":"lol-gen-1", "at":"2026-09-09T07:48:55.036Z", "from":"2024-01", "to":"2026-09",
  "n_pred": 38761, "variante": {"k":30,"window":365,"lwindow":240},
  "source": {"celda":4469, "liga":29867, "circuito":4425} }
```

| modelo | MAE kills | log-loss mediana | Brier mediana | ll +3 | ll −3 |
|---|---|---|---|---|---|
| **generador** | 7,65 | 0,6966 | 0,2517 | 0,6811 | 0,6418 |
| liga plana (Poisson) | 7,62 | 0,6927 | 0,2498 | 0,6761 | 0,6694 |
| liga histograma (n = 32.464) | **7,46** | 0,6948 | — | 0,6664 | 0,6551 |
| circuito | 8,05 | 0,6923 | 0,2496 | — | — |

Multi-línea (mediana ± {0,3,6,9}): `gen 0,5766` · `liga_plana 0,6167` · `liga_hist 0,5755` ·
`gen_misma_muestra 0,5738`. De ahí:
- **skill multilínea vs liga plana: +6,5024 %**
- **skill multilínea vs histograma de liga: +0,2954 %**
- `skill_vs_liga_pct` (solo línea +3): **−0,74 %**; `skill_vs_liga_hist_pct`: **−0,11 %**
- `var_ratio` (varianza observada / predicha): **0,98**

Calibración por decil (solo deciles con masa): decil 3 → p 0,3624 vs obs **0,4097**; decil 6 → p 0,6225 vs obs
**0,6779**; decil 4 → p 0,4045 vs obs 0,2959 (n = 517).

**Veredicto escrito en el propio archivo** (transcrito):

> "El generador (liga×parche, acople paliza→duración/ritmo, reparto del ganador) bate a la Poisson plana de
> liga en un 6,5 % de log-loss multilínea (dispersión), pero al histograma empírico de la liga solo en un
> 0,3-0,5 %: **la estructura no aporta sobre la FORMA de la liga cuando pMap = 0,5**. Sesgo conocido: en las
> colas (mediana ± 3) **el over realizado supera al predicho en 4-5 pp** en walk-forward (la tendencia al alza
> de kills se come la ventana). La sombra mide contra el mercado, que es la pregunta; leer las tesis under con
> ese sesgo delante."

HANDOFF.md:606-607 añade que el sesgo se intentó corregir con centro a 120 d, 60 d y media aritmética, **y no
se corrige**.

---

## 4.11 La sombra del generador — `lol-gen-shadow.js`

**Deporte** `lol_gen`, sobre `implied-engine/sombra.js`; archivo `<dbdir>/implicito/lol_gen.json`.
Familias: `KILLS`, `KILLS_EQUIPO`, `KILLS_HANDICAP`, `KILLS_DNB` (`:22`).

**Pasada** (`run`, `:53-102`):
1. Anula las tesis `ACTIVE` nacidas con otra `model_version` (`:59`) — *"no se mezclan muestras"*.
2. Agenda: `ES.slate('lol', { days: 2 })`, eventos con saque entre **+5 min y +720 min**, ordenados por hora,
   tope **12** eventos por pasada.
3. Mercado por evento (`ES.market`), filas de las cuatro familias con `odds > 1` y `map ≥ 1`.
4. Liga: `leagueOf(competition, known)` (`:32-42`) — exacto, luego contenido (normalizando
   `challengers league → cl`), luego `LD.tempoFor`, y si nada casa, liga **desconocida**.
5. `pMapFrom(rows, bo)` (`:45-50`): mediana del sin-margen de **MAPA** por casa; si no hay, **SERIE** →
   `seriesToMap`; si no, 0,5 con `from: 'sin ancla'`. **La probabilidad de mapa es de mercado, no del modelo.**
6. `G.analyze({ games, dataAt, league, pMapA, sims: 12000, unknownLeague })`.
7. Para cada fila: se busca **el lado contrario de la MISMA casa, misma línea, mismo mapa, mismo equipo**
   (`:80-82`). Sin el par **no hay precio sin margen** y se descarta. `pMkt = devig2` (two-way proporcional:
   `(1/oa)/(1/oa+1/ob)`, `:26`).
8. `edge = 100·(pGen − pMkt)`; se registran **solo las de ventaja positiva** (`:100`), *"el otro lado del mismo
   par tiene la ventaja en negativo"*.

**Puertas de registro** (heredadas de `implied-engine/sombra.js`, `RULE = implicito_v3`, congelada el 9-sep):
`odds ∈ [1,25 ; 6,0]` · `edge ≥ 3 pp` · `edge ≤ 15 pp` (veto) · **`edge ≥ 0,75 × unc_pp`** · máximo 60 tesis
nuevas por pasada, ordenadas por ventaja descendente (`sombra.js:24-30, 78-84`).

**Cierres** (`closesOnly`, `:106-118`): del archivo de cierres de esports (`closes-lol.json`), casando familia,
lado, mapa, equipo y línea exacta; guarda `own`, `best`, `pinnacle` y la edad del dato, por cubos T−60…T−1.

**Liquidación** (`settle`, `:122-148`): a partir de 2,5 h del saque; resultados de `RES.results('lol')`
(Leaguepedia); emparejado por nombre resuelto contra la base (`keyName`, `:121`) con ventana de **±30 h**, y
**solo si hay exactamente un candidato** (`:135`). Si la orientación está invertida se aplica *"el bloque del
2-sep, copiado tal cual"* (`:137-141`) — el mismo volteo completo de kills/winner. El veredicto lo da
`ES.settleOne`, o sea **el mismo liquidador de la casa**.

**Track** (`:157-165`): además del track genérico, calcula **Brier del generador vs Brier del mercado** sobre lo
liquidado (PUSH fuera) — que es la pregunta de fondo.

**Job y sonda**: se ejecuta al final de la cadena de esports, cada 20 min (`server.js:13302`), *"Aparte, sin
tocar picks"*. Sonda: `/api/internal/lol-gen?key=[&run=1]` (`server.js:22290-22299`), que además devuelve
`gen-priors.json` (sin el bloque de calibración).

**Resultado de la primera pasada en producción** (HANDOFF.md:612-615, 9-sep 08:40Z, `lol-gen-2`): 2 eventos con
kills cotizados, **90 pares evaluados**, **7 tesis** (KILLS over 31,5/32,5 en LCK CL con 4-5 pp de ventaja y
1,85 pp de incertidumbre) y **12 muertas por incertidumbre** (Ultraliga, que la base no tiene).

---

## 4.12 PROPS DE JUGADOR DE CS2 CONTRA UNDERDOG — `esports-engine/props.js`

### 4.12.1 Propósito y qué NO es

Del análisis del competidor "LCS Larry" (17-ago). La tesis (`props.js:3-8`): el flanco blando del mercado de
esports no es el ganador de serie sino **los props de jugador en libros DFS**, que publican "kills en mapas
1-2" con precio por pierna y mueven la línea tarde.

Lo que **no** es, escrito antes que nada (`props.js:9-17`):
- No toca el ejecutor en la sombra de la casa: *"su propio registro, su propio archivo en disco y cero contacto
  con la lógica de decisión congelada"*.
- **No publica picks.** Todo lo que pasa el listón se anota en su sombra y se liquida solo.
- **Solo CS2 proyecta.** LoL y Valorant se **listan** (para ver el mercado) sin proyección: *"no hay base propia
  de jugador en esos títulos y no se disimula"*. En la pizarra salen con `veto: 'sin_base_propia'`
  (`props.js:194`).

### 4.12.2 La fuente: `data-providers/esports/underdog.js`

Endpoint público único: `https://api.underdogfantasy.com/beta/v5/over_under_lines` (`:19`). Reintentos: 3, con
back-off de 1,5 s·(i+1) en 429/5xx y 0,9 s·(i+1) en excepción; timeout 20 s (`:32-45`). Devuelve **siempre la
misma forma**, aunque el libro no responda (`available: false`), *"la capa de arriba tiene que poder decir
'libro sin señal' sin reventar"* (`:47-48`).

Lo que lo hace utilizable (`:9-13`): *"cada opción trae `american_price` — precio real por pierna, no solo el
multiplicador del boleto pick'em. Con precio por pierna hay listón de equilibrio (1/decimal) y por tanto
ventaja medible. **PrizePicks se probó el mismo día y bloquea con captcha (DataDome): queda fuera.**"*

Mapa de deportes (`:24`): `CS → cs2`, `LOL → lol`, `VAL → valorant`; el resto del payload se ignora a propósito.
Normalización: se unen `over_under_lines` con `appearances`, `players` y `games`; el nick competitivo viaja en
`last_name` (`:75`). Salida por fila: `book, game, player_nick, stat, stat_label, line, line_type, sides[{side,
price_dec, american}], match{id,title,short,start_at,status}`. `americanToDec` (`:26-30`):
`n>0 → 1+n/100`, `n<0 → 1+100/|n|`.

Regla de la casa (`:14-16`): *"este archivo es lo ÚNICO que sabe que Underdog existe. Cambiar de libro blando es
reescribir este adaptador, no el motor."*

### 4.12.3 La base propia y el modelo

`ownBase()` (`props.js:93-129`) carga `cs2-data` y construye:
- índice **nick normalizado → slug**, descartando la entrada entera si dos jugadores colisionan
  (`:97-106`): *"adivinar identidades es como se liquidan props del jugador equivocado"*;
- slug → equipo desde los quintetos;
- medias poblacionales **ponderadas por rondas** de `kpr`, `dpr` y `hs_pct` (defaults 0,66 / 0,70 / 0,45);
- `expRounds` = media **reciente** de rondas por mapa del pool activo (fallback 21,4).

**Proyección de kills en mapas 1-2** (`projectKills12`, `:151-166`):

```
kpr_hat = (kpr·rondas + kpr_pob·250) / (rondas + 250)          SHRINK_ROUNDS = 250
mu      = kpr_hat · expRounds · 2 · rival_factor
sd1     = desviación muestral de los kills de sus últimos 12 mapas
sigma   = max( sd1·√2 , √mu · 1,15 , 4,0 )
P(over) = 1 − Φ( (línea − mu) / sigma )                         // erf de Abramowitz-Stegun, :85-90
```

El suelo `×1,15` está justificado (`:161-162`): *"los kills por mapa sobredispersan respecto a Poisson puro
(rachas, cierres 13-2, prórrogas), y un sigma optimista fabrica ventajas."*

**Factor rival** (`rivalFactor`, `:137-148`): media de `dpr` del cinco rival contra la poblacional, **exigiendo
≥ 3 jugadores medidos** y **recortado a ±12 %** — *"el resolvedor de equipos puede confundir filiales
(MOUZ→MOUZ NXT, comprobado) y un factor recortado limita el daño de una identidad equivocada"*.

**Headshots** (`projectHs12`, `:172-180`): derivada de la de kills, `mu_hs = mu_kills · hs_hat` con `hs_hat`
encogida igual (K=250), `sigma = max(sigma_k·hs_hat·1,1, √mu·1,15, 3,0)`. La aproximación se **declara**.

**El rival se guarda con el nombre CRUDO del libro** (`:201-216`): el resolvedor solo se usa para decidir qué
lado del cruce es el equipo del jugador. Motivo comprobado en vivo: *"'MOUZ' del libro resolvía a MOUZ NXT (la
trampa de las filiales, otra vez)"*.

### 4.12.4 La regla congelada y los vetos

`RULE` (`props.js:69-75`):

```json
{ "version": "props_cs2_v2", "frozen_at": "2026-08-20", "edge_min": 0.10, "edge_cap": 0.20 }
```

El razonamiento del cambio v1→v2 (`:62-68`) es auditable y vale la pena transcribir:

> "v1 entraba desde 6 pp. Era demasiado bajo para esta familia y por dos razones distintas: Underdog es un
> libro DFS que cobra por pierna a −112 (**listón 52,83 %**), así que 6 pp de ventaja bruta dejan muy poco
> después del listón; y la proyección de kills a dos mapas tiene una dispersión propia grande (sigma de 5 a 10
> kills), de modo que a 6 pp la mitad de lo que entra es ruido con nombre."

**Vetos** (`:29-32`, aplicados en `:194-239`):

| veto | condición |
|---|---|
| `sin_base_propia` | el juego no es CS2 |
| `stat_no_modelada` | la stat no está en `MODELED` = {`kills_on_maps_1_2`, `headshots_on_maps_1_2`} |
| `jugador_no_resuelto` | el nick no casa con la base (ventana 180 días) |
| `muestra_corta` | `< 500` rondas de ventana (`MIN_ROUNDS`) o `< 6` mapas recientes (`MIN_RECENT_MAPS`) |
| `ventaja_no_creible` | ventaja **> 20 pp**: *"La lección de LoL (37,83 pp que eran un fallo de lectura): una ventaja así contra una casa nunca es ventaja, es error propio"* |

Estados posibles: `SOMBRA` (≥ 10 pp), `SIN_VENTAJA`, `VETO`, `LISTADA`. **Listón por lado**:
`bar = 1/price_dec` si hay precio por pierna; si no, *"el listón honesto del pick'em es 50 %"* y se marca
(`:228`).

### 4.12.5 El registro: una anotación por TESIS

`recordShadow` (`:268-302`). Clave de tesis: **`día | slug | stat | lado`** — no por línea. Motivo (`:263-267`):

> "La lección de las 29 'picks' que eran 8 opiniones: el mismo over de REZ a 27,5 / 32,5 / 34,5 es UNA tesis en
> tres precios, y anotarla tres veces infla la muestra con copias correladas."

De cada tesis se queda **la línea de más ventaja** y **la primera lectura** (*"la ventaja de un libro lento se
mide contra la línea que publicó, no contra la que corrige después"*). Solo series **futuras** (`:275`). La
tesis guarda `mu`, `sigma`, `p_gp`, `bar`, `edge`, `price_dec`, `rule_version` y `rule_edge_min` — congelar la
proyección es lo que hace medible el CLV después.

Disco: `<dirname(DB_FILE)>/esports/props-cs2.json` (persistente en Render), con caída al repo en desarrollo
(`:42-45`). Lectura/escritura vía `lib/jsonstore` — *"una lectura fallida NUNCA se guarda como almacén vacío, y
la escritura es atómica"* (`:46-48`).

**Cierres** (`updateCloses`, `:308-331`): en cada barrido, para cada tesis activa se busca la fila del libro del
mismo jugador/stat/día con la **línea más cercana** y se guardan `close_line`, `close_price_dec`, `close_bar`,
`close_p_gp`, `close_edge`, `close_at`. La última pasada antes del saque queda como cierre.

### 4.12.6 Liquidación (rehecha el 20-ago) — `settleShadow` (`:345-434`)

La autopsia del liquidador viejo está escrita entera (`:333-344`):

> "La versión anterior filtraba la bitácora del jugador por fecha (±36 h) y rival y se quedaba con 'las dos
> últimas filas del montón', asumiendo que el montón era UNA serie y que venía en orden cronológico. **Las dos
> cosas eran falsas**: ±36 h abarca tres días de calendario […] y el orden del log no era cronológico sino de
> inserción de la cosecha. El resultado eran **sumas imposibles para dos mapas —44, 51 kills— contra líneas de
> 27,5 y 31,5**."

El liquidador `v3` (`SETTLE_VERSION = 'v3'`, `:78`):
1. Solo a partir de **6 h** del saque.
2. Ventana **±20 h** contra el **saque** (no el día suelto), *"ya cubre cualquier huso sin abarcar el día
   siguiente entero"*.
3. Filtro de rival por nombre crudo (inclusión en cualquier dirección).
4. **Agrupación por serie** usando `mid` de la bitácora. Casos:
   - una sola serie con id → se usa;
   - varias → se elige la más cercana al saque **solo si la siguiente está ≥ 4 h más lejos**; si empatan, no se
     liquida;
   - sin `mid` (bitácora vieja) → se acepta **solo** si el grupo tiene exactamente 2 filas.
5. Dentro de la serie se toman los mapas **1 y 2 por su número** (`num ≤ 2`).
6. Se guardan las dos filas exactas que se sumaron en `settle_rows` (`:416-417`): *"una suma de 56 kills en dos
   mapas hay que poder comprobarla sin adivinar"*.
7. **VOID a los 7 días** sin poder identificar la serie, con el motivo escrito: *"una prop liquidada contra los
   mapas equivocados es peor que una prop sin liquidar, porque entra en la muestra"* (`:343-344`).

`reopenLegacySettled` (`:440-454`) devuelve a `ACTIVE` todo lo liquidado con una versión anterior del
liquidador — *"Las 60 primeras liquidaciones salieron del montón […] su WIN/LOSS no significa nada"*. Se
dispara a mano por `/api/internal/esports?key=&props=1&props_reopen=1` (`server.js:22560-22574`), que además
re-agrega la bitácora con `cs2-players-harvest.js --aggregate-only` y vacía la caché de `cs2-data`.

### 4.12.7 El CLV de un libro DFS (`perf`, `:460-509`)

El hallazgo que obligó a rehacer la métrica (`:468-475`, confirmado en HANDOFF.md:2122): las tesis vivas estaban
anotadas **22 de 24 al MISMO precio** (1,893 → listón 0,5283).

> "Underdog es un libro DFS y casi no mueve precio, mueve la LÍNEA. El CLV que había medía solo
> `close_bar − bar` y encima descartaba las tesis cuya línea se había movido → **medía cero por construcción
> justo en los casos informativos**."

CLV con dos componentes, publicados por separado:

```
clv_línea  = P(nuestro lado en la línea anotada) − P(nuestro lado en la línea de cierre)
             ambas con mu/sigma CONGELADOS al anotar   → aísla el libro de la deriva del modelo
clv_precio = close_bar − bar
clv_total  = clv_línea + clv_precio
```

Signos comprobados (HANDOFF.md:2126-2127): *"over 26,5 que cierra en 28,5 = **+13,2 pp**; el mismo que cierra en
24,5 = **−12,8 pp**"*. Se publica también `sd_clv_line` *"para que el tablero de familias pueda calcular el
estadístico y no solo la media"* (`:503-504`) y `perf_open` — el CLV **provisional** de las tesis abiertas,
porque *"esperar a la primera liquidación […] deja la familia a ciegas justo en sus primeros días"* (`:456-459`).

`track()` (`:511-531`) parte además la muestra **por versión de regla** (`by_rule`): *"v1 y v2 no son la misma
familia y no se pueden sumar"*.

### 4.12.8 Jobs, rutas y control de acceso

| pieza | dónde | frecuencia |
|---|---|---|
| Barrido de anotación `esPropsSweep` | `server.js:689-697` | primer disparo a los **8 min**, luego cada **2 h**; solo si `opsMemOk('es_props_sweep', 150)` |
| Liquidación | dentro de `cs2DailyJob` (`server.js:538-544`) | diaria (el job se reintenta cada hora, marcado por día) |
| Caché de pizarra | `props.js:53` `BOARD_TTL` | **10 min** |
| `GET /api/esports/props` | `server.js:21067-21071` | pizarra (con `?force=1`) |
| `GET /api/esports/propstrack` | `server.js:21072-21075` | track |
| `GET /api/internal/esports?key=&props=1` | `server.js:22560-22580` | track + resumen, sin sesión de navegador |

**Acceso:** todo `/api/esports/*` exige admin o `GP_ESPORTS_PUBLIC_ENABLED`; y `props`/`propstrack`/`evidence`
exigen además **plan sharp** (`server.js:20977-20979`), porque *"salen de precios entre casas"*
(`server.js:20974-20976`). La UI (`public/premium.js:9830-9924`) pinta la vista "Props" con panel de bloqueo
para planes inferiores.

**Por qué no genera picks**, escrito para cuando lo pregunten (HANDOFF.md:2172-2178): *"doctrina de la casa —
toda familia nueva acumula muestra fuera de muestra en sombra y se revisa con Alexis ANTES de publicar; el
modelo v1.1 no está validado contra resultados aún"*. El listón vive en el propio `track().doctrine`
(`props.js:529`).

---

## 4.13 BOLETO GP — `public/premium.js:2532-2615`

Combinador de piernas de **cualquier deporte** de la casa, en el navegador. Persistencia: `localStorage`
(`gp_slip`), **máximo 6 piernas** (`slipSave`, `:2539`). *"Vive en localStorage: sobrevive navegación, no
cuentas"* (`:2537`).

Cada pierna guarda `{ k: pickKey, m: "local vs visitante", r: texto de la recomendación, o: cuota,
pr: p_gp (`signals.win_prob`), b: casa, f: familia }` (`:2542-2544`).

Matemática (`slipFab`, `:2555-2562`):

```js
comb  = Π odds_i
dup   = hay dos piernas del MISMO partido
probOk= !dup && todas las piernas traen probabilidad
prob  = probOk ? Π p_i : null
ev    = prob·comb − 1
kelly = (ev > 0 && comb > 1) ? min( 0,02 , ((prob·comb − 1)/(comb − 1)) / 4 ) : null
```

Es decir: **¼ de Kelly con tope duro del 2 %** del bankroll, la misma regla conservadora de la calculadora de
stake (`:2535-2536`).

**Las dos guardas honestas**, que es lo que distingue esto de un combinador cualquiera:
1. **Correlación** — si dos piernas son del mismo partido, `prob`, `ev` y `kelly` se **suprimen** (no se
   multiplican) y se pinta el aviso `slip_corr`: *"Dos piernas de la misma partida van correlacionadas: el EV
   combinado no es fiable"* (`premium.js:337`). El comentario lo dice igual (`:2535`): *"solo si las piernas son
   de partidas distintas: piernas correlacionadas no multiplican"*.
2. **Piernas sin probabilidad** — si alguna no trae `p_gp`, se enseña solo la cuota combinada, con aviso
   `slip_noprob`.

Interacción: un único listener delegado **en fase de captura** (`:2591`) sobre
`[data-slipadd],[data-sliprm],[data-slipfab],[data-slipclear],[data-slipcopy]`; el mismo botón añade y quita
(`:2599`). `slipText()` (`:2586-2590`) copia al portapapeles el boleto con sus piernas, casas, cuota combinada
y el **disclaimer** (`disclaimer_short`), que también se pinta en el panel (`:2578`).

Comercialmente es una prestación **Pro** (`public/founder.html:152, 180`).

---

## 4.14 Nota sobre `data/props-history.json` y `data/player-props-history.json`

Estos dos archivos **no pertenecen al pipeline de props de esports**: son del pipeline de props de **fútbol**
(Mundial y clubes), construidos por `scripts/props-backfill.js` y `scripts/player-props-backfill.js` desde
**TheStatsAPI**. Se documentan aquí porque la lista de lectura los incluía.

- `data/props-history.json` (63.544 bytes) — claves de nivel superior: `generated_at`, `league`, `season`,
  `matches`.
- `data/player-props-history.json` (548.814 bytes) — claves: `matches`, `generated_at`, `competition`. Cada
  partido: `{match_id, date, home, away, home_tsa, away_tsa, players:[{pid, name, team, pos, started, min,
  goals, shots, sot, xg, npxg, xa, assists, fouls, yc, rc}]}`. Competición `comp_6107` (FIFA World Cup),
  ventana 2026-06-01 → 2026-07-31, incremental e idempotente, throttle 5,5 s por el límite de 12 req/min
  (`player-props-backfill.js:1-5, 26-34`). Lo consume `prop-engine/players.fitPlayers` vía
  `scripts/player-props-project.js`.

**El almacén de las props de CS2 NO viaja en el repo**: es `props-cs2.json` en el disco persistente
(`props.js:42-45`).

---

## 4.15 Parámetros y variables de entorno

| variable | default | efecto |
|---|---|---|
| `GP_ESPORTS_PUBLIC_ENABLED` | sin poner = **solo admin** | abre `/api/esports/*` al público (`server.js:20971`) |
| `GP_LOL_HARVEST` | off (`0` en producción, HANDOFF.md:951) | enciende `lolHarvestJob` (`server.js:722`) |
| `GP_LOL_DIR` | `/data/lol-raw` si existe `/data`, si no `data/esports/lol` | destino del crudo (`server.js:723`, `lol-harvest.js:36`) |
| `GP_EXPORT_KEY` | — | llave de `/api/internal/{lolraw, lol-gen, esports, vara}` |
| `DB_FILE` | `./db.json` | su **directorio** fija dónde viven `esports/props-cs2.json` e `implicito/lol_gen.json` |
| `GP_MEM_RESTART_MB` | 2600 | reinicio preventivo; afecta a los jobs pesados de LoL (`server.js:~742`) |

**Constantes del código** (no configurables por entorno):

| constante | valor | archivo |
|---|---|---|
| Elo LoL: `K` / `patch_decay` / `side_step` / `min_n` | 32 / 1 / 1 / 10 | `data/esports/lol/priors.json` |
| ventaja de lado azul | 24,5 pts Elo (52,79 % azul) | `priors.json` |
| `SIDE_EDGE` (display) | 0,025 en probabilidad | `lol.js:80` |
| `PRIOR_GAMES` (encogimiento del tempo) | 25 | `lol.js:63` |
| umbral `measured` | `w > 0,35` ⇔ > 13,5 partidas | `lol.js:71` |
| sims duración / kills | 20.000 (semillas 41 / 53) | `lol.js:112, 189` |
| listón de tempo/objetivos medidos por liga | n ≥ 20, ventana 180 d | `lol-data.js:206, 210` |
| `minEdgePp` de esports | 3 pp | `store.js:832` |
| incertidumbre de volumen | 3,0 (medido) / 6,5 (supuesto) pp | `store.js:751` |
| `CLOSE_MAX_GAP` | 3 puntos de línea | `store.js:1607` |
| generador: `shrink_k`/`min_cell`/`sims`/`seed` | 30 / 8 / 20.000 / 77 | `lol-gen.js:31-44` |
| sombra `implicito_v3`: edge / cap / cuotas / unc | ≥ 3 pp / ≤ 15 pp / [1,25 ; 6,0] / `0,75 × unc` | `implied-engine/sombra.js:24-30` |
| props: `SHRINK_ROUNDS`/`MIN_RECENT_MAPS`/`MIN_ROUNDS` | 250 / 6 / 500 | `props.js:55-57` |
| props: `edge_min` / `edge_cap` | 0,10 / 0,20 | `props.js:72-73` |
| Boleto GP: fracción de Kelly / tope | ¼ / 2 % / 6 piernas | `premium.js:2539, 2562` |

---

## 4.16 Debilidades, supuestos y riesgos observados en el código

**Sobre LoL (motor y picks)**

1. **La familia que produce picks es la que la medición manda cerrar.** `KILLS_HANDICAP` tiene `modelo_t` de
   −3,42 (bovada), −3,52 (cloudbet) y −3,65 (la sombra congelada). Sigue abierta por decisión humana explícita
   y porque la vara no está cableada al pipeline (§4.9.3). El riesgo no es de dinero (no hay) sino de producto
   y de contaminación de la muestra que se está acumulando.
2. **La base con la que se congeló `lol_kills_hcp_v1` estaba corrompida.** La regla cita "221 picks, 60,6 %,
   +15,96 u" (31-ago), y el 2-sep el arreglo del volteo de kills hizo que *"85 de 245 picks de LoL cambiaran de
   veredicto; KILLS_HANDICAP pasa de +14,7 u a +4,7 u"* (HANDOFF.md:907-908). **La nota congelada no se
   actualizó** y sigue publicando la cifra previa.
3. **Constantes de `killsModel` sin validar contra nada.** `0,13` (calentamiento del ritmo con la paliza),
   `0,72` (pendiente del reparto), `0,085` (ruido del reparto), `0,22` (dispersión de minutos), `0,86+0,30·U`
   (sobre-dispersión), `−0,16` y `0,20+0,05·(1−gap)` de la duración: **ninguna aparece en `priors.json` ni en
   ningún fit**. El propio `lol-gen.js:5-6` las llama *"una dispersión uniforme inventada"* y mide el resultado:
   **20-30 pp de sobreconfianza, c = −0,65**. El signo del acople kpm↔paliza del motor publicado (**+**0,13) es
   **contrario al medido** en la base (`b_kpm = −0,38`).
4. **El perfil de circuito se contradice con la base propia.** `lol.js` fija LCK en 0,62 kills/min cuando la
   base mide 0,90 (`lol-gen.js:5`). El encogimiento lo corrige solo cuando hay ≥ 20 partidas de esa liga en 180
   días; por debajo, la pick sale de un número mal escrito a mano (aunque el veto `estructura_no_medida` cierra
   la puerta en ese caso — la contradicción vive en el `display`).
5. **El umbral `measured` es bajísimo.** `w > 0,35` ⇔ **14 partidas** de esa liga en 180 días. Con 14 partidas
   el kpm medido tiene un error grande, y sin embargo eso ya abre las cuatro familias de kills y baja la
   incertidumbre de perfil de 6,5 a 3,0 pp. Es el punto de apalancamiento más delicado del motor.
6. **`KILLS_HANDICAP` recibe un trato de incertidumbre inconsistente.** No está en `VOLUME_FAMILIES`
   (`store.js:714`) pese a ser hermana de las otras tres, así que paga la epistémica entera mientras que
   `KILLS` y `KILLS_EQUIPO` pagan solo el perfil. Esto sesga qué familia de kills sobrevive al listón — y la
   superviviente resultó ser la peor medida.
7. **Cero error de calibración cobrado en LoL.** `calibrationPp` solo funciona si `R.calibration.fitted`
   (motor de rondas de CS2). El pasaje de CLAUDE.md sobre `goal-engine/mitades.js` establece que *"el error de
   calibración de cada familia entra en su listón"* — en LoL ese término es **estructuralmente 0**, aunque
   `gen-priors.json` documenta un sesgo de **4-5 pp** en las colas del total de kills. Una ventaja de 4-5 pp en
   `KILLS` puede ser enteramente ese sesgo.
8. **El emparejamiento de nombres sigue siendo el eslabón débil**, y el código lo sabe: guardia `SQUAD` contra
   academias (`lol-data.js:266`), alias descartados si dos equipos los reclaman (`:233-248`), volteo por
   `ladoAprox` en la liquidación (`store.js:1812`). Cada una de esas guardas existe porque el fallo ya ocurrió.
9. **Calidad del agregado de jugadores:** en `player-stats.json` se observan nicks numéricos
   (`{"id":"13","nick":13,…}`), síntoma de filas de Leaguepedia mal parseadas. Afecta a fichas y Draft Room, no
   a picks — pero es una señal de que la agregación no valida tipos.
10. **Dependencia de una sola casa.** El mercado de kills lo cotiza esencialmente Cloudbet; con `books_quoting = 1`
    el listón sube 2,5 pp pero **no hay consenso contra el que contrastar**, y el CLV es estructuralmente
    inservible (la línea no se mueve el 56,9 % de las veces).
11. **Derechos.** Toda la base es `research_attribution_ccbysa` y **ninguna fuente de LoL es
    `betting_commercial_ok`**. `RIGHTS.md` deja la revisión legal formal (LOL-0049) **pendiente** *"ANTES de
    cualquier lanzamiento público de picks de LoL"*. La atribución a Leaguepedia es obligatoria allí donde se
    muestre el dato.
12. **La cosecha está apagada.** `GP_LOL_HARVEST=0`: la base se congeló el 2026-09-01 y el refresco es un chore
    manual mensual. `lol-aggregate.js` avisa de que *"mastery y forma son features de 365 d: sin refresco se
    apagan"*. El Elo, el tempo de 180 días y el ranking de 90 días **envejecen en silencio**.

**Sobre el generador de kills**

13. **La propia validación dice que no aporta.** `+6,5 %` de log-loss multilínea contra la Poisson plana, pero
    **+0,30 %** contra el histograma empírico de la liga, y `skill_vs_liga_pct` **−0,74 %** (negativo). El
    veredicto escrito lo admite: *"la estructura no aporta sobre la FORMA de la liga cuando pMap = 0,5"*.
14. **Sesgo de cola conocido, medido y no corregido:** el over realizado supera al predicho **4-5 pp** en
    mediana ± 3; se probaron tres correcciones de centro y ninguna funciona. El archivo pide *"leer las tesis
    under con ese sesgo delante"* — pero el registro no aplica ninguna penalización asimétrica a las tesis
    under.
15. **La calibración por deciles está prácticamente vacía**: solo cinco deciles tienen masa y dos concentran
    casi todo (38.226 en el decil 3 y 30.447 en el 6). La curva no permite juzgar la calibración en los
    extremos, que es donde viven las líneas alternativas.
16. **La validación se hace con `pMap = 0,5`**, es decir, midiendo la **forma** sin fuerza; en producción la
    sombra usa `pMap` anclada a mercado. **Lo validado y lo desplegado no son el mismo objeto.**
17. **Versión de las constantes desalineada:** `gen-priors.json` dice `"version":"lol-gen-1"` mientras el
    código está en `lol-gen-2` (`lol-gen.js:32`) y la sombra anula las tesis nacidas con otra versión. Los
    números de validación publicados **no son los de la versión en producción**.
18. **Caché del fit con clave débil** (`fitCached`, `:201-206`): la clave es `dataAt + '|' + games.length`, y
    `fit()` usa `asOf = Date.now()` por defecto. Dos pasadas separadas por horas sobre la misma carga de datos
    **reutilizan el mismo ajuste**; no es look-ahead, pero sí una desincronización silenciosa.
19. **`n_eff` mezcla muestras heterogéneas**: `n_cell + min(n_league, 30)` suma partidas de la celda con un
    tope de partidas de liga, y de ahí sale la incertidumbre que gobierna la puerta `0,75 × unc`. Es una
    heurística sin derivación.

**Sobre las props de CS2**

20. **Muestra liquidada muy pequeña y reabierta dos veces.** Las 60 primeras liquidaciones se anularon por
    venir de un liquidador roto (`reopenLegacySettled`), y la regla cambió de v1 a v2 el 20-ago anulando
    también las liquidaciones de v1. El `track` parte la muestra por versión, lo cual es correcto — pero
    significa que **la familia lleva meses sin acumular una muestra continua**.
21. **El listón implícito del libro no se comprueba.** El cálculo asume `bar = 1/price_dec`, que es el listón
    **con el margen dentro**. En un libro DFS a −112 por pierna el vig es del orden del 5,7 % por par; el
    código **no calcula un sin-margen de dos caras** (a diferencia de `lol-gen-shadow`, que sí exige el par).
    Se compara P(modelo) contra un precio cargado, y el `edge_min` de 10 pp es la única defensa.
22. **Normalidad para una variable de conteo con cola.** `P(over)` sale de una normal continua sobre kills en
    dos mapas, sin corrección de continuidad y sin tratar el caso de línea entera (push). Los suelos de sigma
    lo mitigan pero no lo arreglan.
23. **`expRounds` viene del pool de CS2 en general, no del emparejamiento**: un mapa de 13-2 y uno con dos
    prórrogas cuentan igual en la media. La estructura que el motor de CS2 sí modela (distribución de rondas
    por mapa) **no se usa aquí**.
24. **El factor rival solo mira `dpr`** y está recortado a ±12 % por miedo a la resolución de identidades: es
    una defensa contra un bug, no un modelo.
25. **La "primera lectura" puede no ser la primera.** El barrido corre cada 2 h con caché de 10 min; una línea
    que aparece y se mueve dentro de esa ventana se anota ya movida. El CLV de línea se mide contra esa lectura
    como si fuera la apertura.
26. **Dependencia de un endpoint no documentado con `User-Agent` de navegador falseado**
    (`underdog.js:20`): es frágil ante cualquier endurecimiento del libro, y PrizePicks ya bloqueó por captcha.
    Si Underdog cae, `available: false` y la familia se queda ciega sin más aviso que un contador.

**Sobre el Boleto GP**

27. **La detección de correlación es por título de partido exacto** (`mset[l.m]`, `:2557-2558`). Dos piernas
    del **mismo torneo**, de la **misma serie** con títulos distintos, o correlacionadas por vía indirecta
    (mismo equipo en dos partidos, mismo mercado en mapas distintos de una serie) **multiplican como si fueran
    independientes**. La guarda cubre el caso más obvio, no la familia del problema.
28. **La probabilidad de la pierna es `signals.win_prob`**, es decir la probabilidad **anclada a mercado**, no
    una probabilidad independiente del modelo. El EV que se muestra es en buena parte una consecuencia del
    propio precio del que salió.
29. **El ¼ Kelly se calcula con la probabilidad combinada**, que hereda todos los errores de calibración de
    cada pierna multiplicados; el tope del 2 % es lo único que limita el daño.

**Transversal**

30. **Ninguna de estas tres familias tiene dinero real y el código lo respeta**, pero también significa que
    **ninguna ha sido sometida a la prueba que importa**: pagar comisiones, límites y rechazos de un libro real.
31. **El cumplimiento de la regla de derechos depende de una variable de entorno.** Si
    `GP_ESPORTS_PUBLIC_ENABLED` se pone en on, las picks de LoL —cuya base es CC BY-SA y explícitamente **no**
    `betting_commercial_ok`— se sirven a usuarios de pago. No hay en el código una puerta que ate la
    publicación de LoL al `rights_class` de su base; la única defensa es la env var y la nota en `RIGHTS.md`.

---

# Parte 5 · Baloncesto: posesiones, ratings, simulación, props y familias de precio

### 5.0 Mapa de la sección y estado en una frase

Baloncesto es el "4º deporte" de GP Simulador. Vive en `basketball-engine/` (23 módulos puros, sin red ni disco salvo `store.js`), `data-providers/basketball/espn.js` (colector), `implied-engine/hoops.js` + `run-hoops.js` (proceso implícito de precio) y una franja de `server.js` (jobs y rutas `/api/hoops/*`). Estado vigente, tal como lo declara el código:

- **Picks del modelo: APAGADAS para el público.** Nacen, se liquidan y se miden en un **monitor privado** (`db.hoopsPicks`, `monitor_only: true`, solo admin) porque el modelo **no bate al cierre**: skill fuera de muestra **−0,0079 ± 0,0067 (t = −1,18) en WNBA** y **−0,0205 ± 0,0040 (t = −5,16) en NBA** (`server.js:12625-12634`, `TODO_NEXT.md:932-942`, `CLAUDE.md:72`).
- **Familias de precio (value, arbitraje, caídas, middles): SÍ se publican** (tier `sharp`), porque "no dependen del modelo — salen de precios reales entre casas" (`server.js:20100`, `basketball-engine/markets.js:9-18`).
- **Proceso implícito (IMPLIED_ML / IMPLIED_SPREAD / BOOK_DEV_*): en sombra propia** (`<dbdir>/implicito/hoops.json`), regla `implicito_v3`, sin ninguna probabilidad del modelo (`implied-engine/sombra.js:21-33`).
- **Acceso:** toda `/api/hoops/*` es 404 salvo admin o `GP_HOOPS_PUBLIC_ENABLED=1`; dentro, `opps` exige plan sharp, `brief/sim/read` plan pro, `picks/perf` solo admin (`server.js:20074-20084`).
- **Dinero real: ninguno.** `lib/vara.js` y `real-executor/parada.js` no mencionan baloncesto (grep sin resultados); no hay canal real ni sombra de ejecutor para hoops.

Aclaración de alcance: el directorio `prop-engine/` **no es de baloncesto**: es el motor de córners/tarjetas y props de jugador de **fútbol** (Binomial Negativa sobre `data/props-history.json`, TheStatsAPI) (`prop-engine/model.js:1-7`, `prop-engine/players.js:1-6`, `prop-engine/index.js:1-3`). Los props de jugador de baloncesto viven en `basketball-engine/props.js` y la captura de su mercado en `hoopsPropsCapture` (`server.js:4880`). Se describe `prop-engine` brevemente en 5.9 solo para dejar constancia de que no interviene aquí.

---

### 5.1 Propósito y alcance

| Dimensión | Valor | Fuente |
|---|---|---|
| Ligas con dataset y rating | `nba`, `wnba` | `data/basketball/games-{nba,wnba}-2026.json` |
| Ligas configuradas sin dataset | `ncaam`, `ncaaw` (esperan a noviembre) | `espn.js:20-25`, `TODO_NEXT.md:1161` |
| Ligas solo en superficies de precio | Euroliga, NBL, NCAA M/F, NBA pretemporada/Summer League (claves The Odds API) | `markets.js:23-29`, `server.js:4855-4856` |
| Mercados del modelo | Ganador (moneyline), hándicap (spread), total de puntos; prórroga como derivado | `simulate.js:122-140` |
| Mercados de props | pts, reb, ast, tpm, P+R+A por jugador (solo proyección; no hay pick) | `props.js:20-26` |
| Familias de precio | value, arbitraje, caídas, middles (total y hándicap) | `markets.js:121-259` |
| Familias implícitas | IMPLIED_ML, IMPLIED_SPREAD, BOOK_DEV_SPREAD/ML/TOTAL | `implied-engine/hoops.js:87-143` |
| Público/admin | admin por defecto; `GP_HOOPS_PUBLIC_ENABLED` abre por tiers | `server.js:20076-20084` |
| Sombra/real | monitor privado (papel) + sombra implícita; sin real | `server.js:12631`, `sombra.js:1-15` |

---

### 5.2 Fuentes de datos, jobs y cachés

#### 5.2.1 ESPN (partidos, box, play-by-play, lesiones, cuotas de cierre)

Colector: `data-providers/basketball/espn.js`. "PURO en red: no toca db, no escribe archivos, nunca lanza" (`espn.js:12`). Endpoints:

- Scoreboard: `https://site.api.espn.com/apis/site/v2/sports/<path>/scoreboard?dates=YYYYMMDD[-YYYYMMDD]&limit=` (`espn.js:26,76`). Normaliza id, fecha, `season`, `season_type`, `neutral`, `venue`, estado, periodo/reloj, `line` (marcador por periodo), récord y logos (`espn.js:45-69`). **Tope silencioso de 100 eventos por llamada**: la cosecha de temporada trocea por quincenas y avisa si un tramo llega a 100 (`espn.js:196-211`).
- Summary: `.../summary?event=<id>` → stats de equipo aplanadas, líneas de jugador (zip de `labels`/`stats`, con `starter`, `dnp`), jugadas (tipo, reloj, marcador, autor, `shootingPlay`, `pointsAttempted`, coordenadas `x,y`, `wallclock`), terna arbitral, asistencia, **parte de lesiones estructurado** y cuotas `pickcenter` (spread, over/under, moneylines) (`espn.js:83-146`).
- Equipos y plantillas (`espn.js:149-191`).
- Reintentos: 3 intentos, backoff 900 ms·(i+1) en 429/5xx, timeout 25 s; ante fallo devuelve `null`/`[]` (`espn.js:29-39`).

Parámetros por liga (`espn.js:20-25`): NBA 48 min, 4 periodos, OT 5, `ppg` 115; WNBA 40/4/5/85; NCAA 40 min en 2 mitades, `ppg` 74/67. El `ppg` "escala el umbral de garbage time" (`espn.js:17-19`).

#### 5.2.2 Cosecha diaria (`hoopsHarvestJob`)

`server.js:561-583`. Corre 9 min tras arrancar y cada hora, pero **una sola vez por día UTC** (`db.ops.hoops_day`), gated por `GP_HOOPS_HARVEST` (default on) y por memoria libre (`opsMemOk(...,200)`). Lanza `scripts/hoops-backfill.js --league=<wnba|nba> --season=<añoUTC> --out=disk --max=120` en proceso aparte (heap 320 MB, timeout 25 min). El backfill "re-ajusta el artefacto del modelo al terminar" (`server.js:558`). Escribe en el **overlay del disco persistente** `<dirname(DB_FILE)>/hoops/` que "MANDA partido a partido" sobre la base del repo (`store.js:17-29`).

**Riesgo derivable del código:** `espn.season(nba, año)` cubre de octubre del año−1 a junio del año (`espn.js:199-200`); con `--season=2026` fijado por `new Date().getUTCFullYear()` (`server.js:569`), la temporada NBA 2026-27 (arranca octubre de 2026) no entraría a la cosecha hasta que el año UTC sea 2027. No encontré corrección en el código.

#### 5.2.3 The Odds API (cuotas de casas)

- `hoopsQuotesSweep` (`server.js:4954-5013`): 90 s tras arrancar y cada 12 min (`server.js:27662,27666`), throttle 12 min. Por cada clave de `HOOPS_ODDS_KEYS` (`server.js:4855-4856`) pide `/v4/sports/<key>/odds?regions=us,us2,uk,eu,au&markets=h2h,spreads,totals` (`ODDS_REGIONS_SCAN`, `server.js:4670`), toma hasta 60 eventos, siembra `db.clubsQuoteEvents[ceid]` con `sport:'basketball'` y escribe en la tabla `sportsbook_goal_quote_current` (`grepo.upsertGoalQuote`) con `market_family` ∈ {`match_winner`, `match_total`, `spread`}; el spread se guarda con la línea de cada lado tal como viene (`server.js:4980-5001`). Sin `SPORTSBOOK_PROVIDER_API_KEY` o sin Postgres → no-op (`server.js:4955-4956`).
- `hoopsPropsCapture` (`server.js:4878-4952`): 150 s tras arrancar y cada 30 min. Mercados `player_points, player_rebounds, player_assists, player_threes`, solo eventos que empiezan en ≤30 h (máx. 12 por clave). Guarda el crudo en el data-fabric (`putRaw`) y, por línea con ≥3 casas con dos lados, la mediana de la probabilidad justa **Shin** por lado, el mejor precio y `ev_pct` (`server.js:4923-4942`). Declarado: "NO genera picks ni toca el motor de decisión" (`server.js:4867`). Coste ~1.200 créditos/día (`server.js:4875`).

#### 5.2.4 Lectura de cuotas para el modelo

`markets.loadQuotes` (`markets.js:68-86`): consulta por lotes de 80 ceids (lección del 12-ago: 300 ids mueren por timeout), `quote_status='open'`, `is_live=FALSE`, `observed_at > now() − 75 min` por defecto, agrupando `max(odds_decimal)` por (evento, casa, familia, línea, lado). `groupMarkets` normaliza el hándicap a la **línea del local** (la fila del visitante trae la línea espejo) y agrupa por `ceid|fam|línea` (`markets.js:91-106`).

#### 5.2.5 Parte de lesiones y prensa

`hoopsInjuries(league, gameId)` (`server.js:11948-11981`): lee `sum.injuries` de ESPN, cache 30 min en `db.hoopsObs[liga:partido]`, severidad `out:3, doubtful:2, questionable/probable/day-to-day:1`, y **registra cada cambio como evento** en el data-fabric dominio `injuries` ("qué sabíamos a las 19:00 es una consulta y no una conjetura", `server.js:11966-11969`). Un job diario vuelca `db.hoopsObs` a `<disco>/hoops/injuries-history.jsonl`, una fila por equipo-día con `players_out`/`players_doubtful`, idempotente por `día|liga|partido|equipo|hash` (`injuries-history.js:19-69`, `server.js:13236-13245`). La prensa (`observer/deportes.js`, dominio `hoops`) entra al panel **solo como display** (`server.js:20398-20407`).

#### 5.2.6 Tabla de jobs y cachés

| Job / caché | Cadencia | Fuente |
|---|---|---|
| `hoopsHarvestJob` | +9 min, cada 1 h, 1×/día UTC | `server.js:582-583` |
| `hoopsQuotesSweep` | +90 s, cada 12 min | `server.js:27662,27666` |
| `hoopsPropsCapture` | +150 s, cada 30 min | `server.js:27664-27665` |
| `hoopsChain` (migrar CLV → build → settle → closeline → implícito → bajas) | +200 s tras arranque, encadenado por memoria | `server.js:13253-13261` |
| `buildHoopsPicks` + `settleHoopsPicks` + `hoopsImpliedJob` | cada 30 min | `server.js:13262` |
| `hoopsPicksCloseline` | cada 5 min | `server.js:13263` |
| `hoopsCloseSnapshots` (cubos T−60…T−1 + cierres del implícito) | cada 2 min | `server.js:13264` |
| `hoopsInjuriesHistoryJob` | cada 24 h | `server.js:13266` |
| `store.load` (dataset + rating) | cache 30 min | `store.js:36` |
| `hoopsInjuries` | cache 30 min | `server.js:11951` |
| `hoopsBrief` | memo 5 min | `server.js:12062` |
| `/api/hoops/perf` | memo 1 h | `server.js:20480` |
| `/api/hoops/officials` | memo 12 h | `server.js:20666` |

Comentario del autor sobre por qué la cadena va en serie: "Estaban los tres lanzados sin `await` en el mismo tick, así que sus picos de memoria se SUMABAN. El proceso reventaba por falta de memoria a los ~215 s del arranque" (`server.js:13247-13252`).

---

### 5.3 Datos históricos y artefactos de ajuste

Medido sobre los archivos del repo (script ad hoc de lectura, 14-sep):

| Archivo | Contenido | Rango | n | Tamaño |
|---|---|---|---|---|
| `data/basketball/games-nba-2026.json` | partidos derivados (four factors, tiros con zona, líneas de jugador, tramos, cuotas ESPN) | 2025-10-02 → 2026-06-14 | 1.292 (1.292 con tramos, 977 con cuotas; `season_type` 1: 71, 2: 1.130, 3: 85, 5: 6) | 23 MB |
| `data/basketball/games-wnba-2026.json` | ídem | 2026-04-25 → 2026-08-15 | 275 (275 con tramos, 263 con cuotas; tipo 1: 18, 2: 257) | 4,1 MB |
| `teams-nba.json` / `teams-wnba.json` | catálogo oficial | — | 30 / 15 | 6 / 3 KB |
| `players-nba.json` / `players-wnba.json` | plantillas ESPN con lesión | — | 546 / 212 | 184 / 72 KB |
| `fit-nba.json` / `fit-wnba.json` | RAPM, contexto, mezcla 70/30, valor por zona, ajustes por rival | ajustado 2026-08-15 | games_n 1.292 / 275 | 82 / 38 KB |
| `validation-nba.json` / `validation-wnba.json` | veredicto de capas (ventana expandida) | 2026-08-15 | n 772 / 164 | <1 KB |

El derivado por partido lo produce `possessions.deriveGame` (`possessions.js:101-180`): "el crudo pesa ~1MB por partido y no tiene sentido versionarlo; lo derivado son ~8KB" (`possessions.js:12`). Guarda también las **cuotas de cierre de ESPN** porque "son el ÚNICO rival que importa: batir la tasa base es fácil, batir al mercado es el gate" (`possessions.js:159-163`).

**Scripts:** `scripts/hoops-backfill.js` (cosecha idempotente), `scripts/hoops-fit.js` (RAPM + contexto + mezcla fuera de línea, "un ajuste se hace UNA vez, se versiona y se sirve", `hoops-fit.js:9-15`), `scripts/hoops-validate.js` (ablaciones fuera de muestra), `scripts/hoops-strategy-backtest.js` (ROI al cierre), `scripts/smoke/hoops-smoke.js` (39 comprobaciones, `docs/impl/hoops-REPORT.md:79`).

**Métricas guardadas en los artefactos (transcritas):**

- `validation-nba.json`: n 772, `brier_market` 0,18779; skill base −0,02023, +contexto −0,02039, +plantilla −0,02236, +mezcla −0,00185; capas: contexto **off** (Δ −0,00016), plantilla **off** (Δ −0,00197), mezcla **on** con w = **0,134**.
- `validation-wnba.json`: n 164, `brier_market` 0,1953; skill base −0,00749, +contexto −0,011, +plantilla −0,00872, +mezcla −0,00405; contexto **off** (Δ −0,00351), plantilla **on** (Δ **+0,00228**), mezcla **on** w = **0,233**.
- `fit-nba.json`: RAPM λ = 1000 (curva CV: 200→63,67, 1000→63,57, 16000→63,76 RMSE), 728 jugadores, 31.360 tramos, hca 1,446, media liga 111,8; contexto n 1.264, rmse 18,1, coeficientes: b2b −1,03 (t −0,66, no usado), rest_days +0,14 (t 0,18, no usado), three_in_four −1,23 (t −1,25, **usado a la mitad: −0,616**), travel +0,39 (t 0,92, no usado), altitud −10,6 (t −3,52, **descartada por signo**); mezcla 70/30: **w = 0**, Brier modelo 0,19208 vs mercado 0,16683 (n 388); zonas: aro 1,285 pts/tiro, esquina 1,153, frontal 1,028, media corta 0,877, media larga 0,816 (230.065 tiros).
- `fit-wnba.json`: RAPM λ 1000, 324 jugadoras, 6.079 tramos, hca 2,03, media 103,7; contexto n 261, rmse 14,2: three_in_four −2,24 (t −1,09, usado −1,118), travel +0,65 (t 1,18, usado +0,325), altitud −28,2 (descartada), resto 0; mezcla 70/30 **w = 0** (Brier modelo 0,1847 vs mercado 0,16732, n 82); zonas: aro 1,227, esquina 1,062, frontal 1,011, media corta 0,783, larga 0,76.

Obsérvese la **discrepancia entre las dos estimaciones del peso de mezcla**: el corte 70/30 del artefacto dice w = 0 en ambas ligas (el modelo no aporta nada), mientras la ventana móvil de validación da 0,134/0,233. El código decide que "manda la validación y el otro queda como diagnóstico" (`store.js:108-117`).

Otros números fuera de muestra publicados en documentos: acierto 67,0 % NBA / 67,7 % WNBA, MAE de margen 12,11 / 9,80 (`TODO_NEXT.md:932-939`); backtest al cierre con simulador base: **−7,27 % de ROI en NBA, t = −2,72** (`server.js:12734-12735`); walk-forward con media vida 45 → skill −0,0079, con 14 → −0,0128 (`TODO_NEXT.md:580-583`); β(desacuerdo modelo−cierre → residuo) ≈ 0: WNBA total −0,22 [−1,01; 0,52], NBA −0,05 [−0,29; 0,18] (`docs/BACKTESTS_FAMILIAS_2026-09-02.md:177-182`).

---

### 5.4 Del play-by-play al rating

#### 5.4.1 Posesiones, four factors, zonas de tiro, garbage time

- Posesiones (Oliver): `POS = FGA − ORB + TOV + 0,44·FTA`, promedio de los dos equipos (`possessions.js:63-66`).
- Four factors por lado: `ortg = 100·pts/pos`, `efg = (fgm + 0,5·tpm)/fga`, `tov_pct = tov/pos`, `orb_pct = orb/(orb + drb_rival)`, `ftr = fta/fga`, `tpa_rate = tpa/fga` (`possessions.js:120-127`).
- Zona de tiro con **aro calibrado en (25, 1)** contra 238 mates/bandejas ("no en (25, 5) como asumí primero", `possessions.js:34-41`): triple de esquina si `dy ≤ 8 && |dx| ≥ 20`, si no `atb3`; dos puntos: `rim` ≤ 4,5, `short_mid` ≤ 14, `long_mid` (`possessions.js:42-53`). Los tiros libres se excluyen: "el primer conteo daba 33% de triples cuando la liga está en ~42% justamente por esto" (`possessions.js:131-134`).
- Garbage time a nivel partido: umbrales 25/20/15 puntos a falta de 12'/9'/6', escalados por `ppg/115`, se dejó caer la regla de 10 a falta de 3' (`possessions.js:84-97`). **Estado declarado:** "marca el 64% de los partidos WNBA... `garbage` es INFORMATIVO... el rating todavía no lo usa para filtrar posesiones" (`possessions.js:78-83`). A nivel de tramo existe una **segunda definición** (`lineups.markGarbage`, `lineups.js:115-137`) que sí incluye 10 puntos a falta de 3' y que es la que usa el RAPM (`players.js:79`). Dos definiciones distintas de basura conviven.
- Tramos (quintetos): reconstruidos desde `Substitution` con titulares del box, auditados contra los minutos del acta (`quality.ok` si MAE ≤ 4 min; medido 0,25 min según `rotations.js:16`), sin "arreglar" fantasmas porque "`athletes` de una falta incluye al jugador del OTRO equipo" (`lineups.js:68-75`). Posesiones por tramo prorrateadas por tiempo, "aproximación declarada" (`lineups.js:140-146`).

#### 5.4.2 Rating de equipo (`ratings.fitRatings`)

No es Elo. "En baloncesto cada partido son ~85 posesiones... tirarla para quedarse con 'ganó/perdió' es un desperdicio" (`ratings.js:3-8`). Modelo aditivo tipo KenPom (`ratings.js:23-27`):

```
ORtg(i vs j, casa)  = lgORtg + off_i + def_j + hca/2
ORtg(j vs i, fuera) = lgORtg + off_j + def_i − hca/2
POSES(i vs j)       = lgPace + pace_i + pace_j
```

Constantes (`ratings.js:34`): `halfLifeDays = 45` (peso `0,5^(días/45)`), `iters = 60`, `priorGames = 6` (encogimiento `n/(n+6)`), `minGames = 5`, `validTeams` = catálogo oficial (elimina All-Star y amistosos; los partidos contra un no-equipo también se caen, en hasta 3 pasadas, `ratings.js:38-51`). Amortiguación del 50 % por iteración y recentrado de off/def/pace (`ratings.js:92-101`). La ventaja de cancha `hca` se **estima** como media ponderada de `ortg_local − ortg_visitante` (`ratings.js:68-69`); **no excluye partidos en sede neutral** del ajuste (el flag `neutral` solo se usa al proyectar, `ratings.js:142-145`). El ajuste tampoco filtra por `season_type`: pretemporada, play-in y playoffs entran con el mismo peso (solo decae por antigüedad); la clasificación sí filtra a `season_type === 2` (`standings.js:38-41`).

Residuos → barras de error (`ratings.js:104-129`): `sdPoss` (desviación del residuo de posesiones), `sdEnv = √cov(res_local, res_visita)` (shock compartido, "correlación positiva entre los puntos de ambos equipos, 0.391 medido en WNBA"), `sdInd = √(sdTot² − sdEnv²)`.

`project`/`decompose` devuelven medias y el reparto del margen por causa (`ratings.js:142-173`).

#### 5.4.3 RAPM (impacto de jugador)

`players.fitRAPM` (`players.js:130-165`): cada tramo produce dos filas `puntos/100 = media + Σoff(5 atacantes) + Σdef(5 defensores) ± hca/2`, ponderadas por `poss · 0,5^(edad/240 días)`, excluyendo basura (`players.js:64-102`). Cresta resuelta por gradiente conjugado sin formar XᵀX (`players.js:24-56`); λ elegido por bloques temporales 75/25 entre {200…16000} (`players.js:108-127`). `teamFromMinutes` compone el equipo como suma ponderada por `min/240`, con nivel de reemplazo −2,5 para desconocidos (`players.js:171-184`).

#### 5.4.4 Minutos y bajas

`minutes.rotationProfile`: media exponencial de los últimos 15 partidos, media vida 5, **dividiendo por la ventana entera** ("quien se perdió 10 de los últimos 15 partidos no espera sus minutos habituales", `minutes.js:48-51`). `projectMinutes`: techo por jugador `min(TOTAL/5 + 6, max + 6)`, reparto proporcional de los minutos liberados en ≤6 pasadas, normalización a 240/200 minutos-jugador, `__repl__` si sobran >1 min (`minutes.js:62-105`). Estados de ESPN a probabilidad de jugar: `out 0, doubtful 0,25, questionable 0,5, probable 0,85, day-to-day 0,7` ("convenciones de la industria... a la vista para poder discutirlas", `minutes.js:110`).

#### 5.4.5 Contexto de calendario

`context.fitContext` (`context.js:83-141`): regresión OLS del residuo de margen sobre [Δb2b, Δdescanso saturado a 4, Δ3-en-4, Δviaje/1000 km, log1p(altitud−500 m)/1000], ridge 1e-6·n. Encogimiento por evidencia: |t| < 1 → 0, 1–2 → ½, ≥ 2 → entero; **signo esperado obligatorio** (`SIGN`, `context.js:125-131`): "Sin esta regla el ajuste devolvió altitud = −10,6 puntos (t = −3,5): con solo dos sedes en altura, ese término no mide altura, mide el residuo de Denver y Utah". Sedes con coordenadas y altitud en `VENUES` (`context.js:19-34`). El autor documenta la corrección: la media cruda decía que el back-to-back cuesta 1,56 puntos; controlando por calidad, −1,03 ± 1,55 (t −0,66), "no distinguible de cero en 1.264 partidos" (`context.js:6-10`).

#### 5.4.6 Árbitros

`officials.fitOfficials` mide el residuo de tiros libres y faltas contra la línea base de los dos equipos, encoge `n/(n+20)`, exige |t| ≥ 2 y control Benjamini-Hochberg q = 0,10; `points_per_fta = 0,77`; **`applies: false` — "GATE DURO: no entra al modelo hasta que scripts/hoops-validate.js lo respalde"** (`officials.js:58-131`).

---

### 5.5 De la probabilidad al mercado: el simulador y la pila

#### 5.5.1 Monte Carlo (`simulate.simulate`)

`simulate.js:42-116`. Por iteración: `poss ~ max(55, N(μ_pace, σ_poss))`, `env ~ N(0, σ_env)`, `ppp_i = max(0,55, μ_i + env + N(0, σ_ind))`, puntos `round(poss·ppp)`; empate → prórroga resuelta con `op = max(4, poss·5/regMin)` posesiones y ruido 0,12 en ppp, hasta 6 prórrogas; luego moneda de ±2 (`simulate.js:57-78`). PRNG mulberry32 con semilla determinista `hash(home:away:R.at)` (`simulate.js:21-38,54`). Salidas: `win`, `win_ci` (error binomial de la simulación + `seFit = 0,5·√(1/max(3,nH) + 1/max(3,nA))` convertido con `0,028 ≈ dP/dpuntos`, topado a 0,18; `simulate.js:82-86`), `ot_prob`, cuantiles y bandas de margen, `margin_hist` recortado a ±30 y **`total_hist` a resolución de 1 punto** — la corrección del 2-sep: "el cubo 165 recoge los totales 163 y 164, que NO superan la línea... 22 de sus 31 totales eran overs en esas líneas, con 17-27 % de acierto" (`simulate.js:108-113`). `conf` = alta si ambos ≥ 15 partidos, media ≥ 8, baja si no (`simulate.js:114`).

`simulate.markets` deriva de la MISMA simulación moneyline, spread (`P(margen > línea)`, con `home_spread = −line`) y total (`P(total > línea)`) solo en líneas .5, más prórroga (`simulate.js:122-140`).

Número de simulaciones según superficie: picks 20.000 (seed 13, `server.js:12743`), dossier de la pick 6.000 (`server.js:12750`), GP Take en value 12.000 (seed 7, `markets.js:283`), brief 8.000 (seed 5, `server.js:12080`), validación `/api/hoops/perf` 4.000 (seed 21), panel de partido 20.000 (2.000–60.000 por parámetro, `server.js:20384`). Al usar semillas y tamaños distintos, el mismo cruce puede mostrar probabilidades ligeramente distintas en pantallas distintas.

#### 5.5.2 La pila (`model.projectGame` / `simulateGame`)

"SE USA EL DELTA, NO EL ABSOLUTO": el ajuste de plantilla es la diferencia entre el equipo habitual y el de esta noche según RAPM × minutos, "si juegan los de siempre el ajuste es cero y manda el rating" (`model.js:7-11`, `availabilityDelta` `model.js:25-53`). Cada capa se aplica **solo si `validation-<liga>.json` la enciende** (`model.js:61-69`): hoy en NBA plantilla y contexto apagadas; en WNBA plantilla encendida (Δ +0,00228 sobre 164 partidos) y contexto apagada. Las capas apagadas siguen calculándose y viajan al panel con `applied:false` (`model.js:74-75,88`).

Mezcla con el mercado en log-odds: `p = σ(w·logit(p_modelo) + (1−w)·logit(p_mercado))` (`model.js:136-141`); `fitBlend` elige w en una rejilla de 21 puntos minimizando el Brier, exige ≥ 50 filas (`model.js:106-135`). En `simulateGame`, si hay `market` y la capa está encendida, se publica la mezcla y el intervalo se transforma con la misma mezcla (`model.js:154-167`).

#### 5.5.3 Escenarios, sensibilidad e incertidumbre

`scenarios.js`: jugadores en duda con ≥ 12 min esperados (máx. 3, `scenarios.js:33-48`); tres ramas (juega ×1 / limitado ×0,6 / no juega) con probabilidades `p·0,65, p·0,35, 1−p` (`scenarios.js:53-64`); mezcla asumiendo independencia ("la cola mala queda algo subestimada", `scenarios.js:95-106`). Tornado: titulares fuera, ritmo ±3 posesiones, cancha ×0,5/×1,5, mezcla 0 %/100 % (`scenarios.js:129-191`). `uncertainty`: aleatoria = mitad del ancho de `win_ci`; epistémica = √Σ(sd²) con sd = dispersión de ramas/3,29 y |Δ| máximo de cada palanca/2 (`scenarios.js:197-219`). **Este `epistemic_pp` es el `uncertainty_pp` que se guarda en cada pick** (`server.js:12755-12762,12949`).

#### 5.5.4 Qué NO entra

El rating es **market-blind** en su construcción (solo box score y tramos), pero la probabilidad publicada y la de las picks **sí incorporan el mercado** vía la mezcla (w 0,134/0,233). No entran: árbitros (`applies:false`), prensa (display), faltas acumuladas ni quinteto en cancha en el vivo (`live.js:201-207`), motivación, ni descanso/viaje en NBA (capa apagada).

#### 5.5.5 En vivo

`live.liveWin` simula solo el resto: posesiones restantes `fullPoss·frac`, ruido de ritmo `σ_poss·√frac`, **varianza por posesión 1,5** ("+6 a falta de 30 segundos = 100,0%, que es sencillamente falso", `live.js:85-92`), cola ×1,25 en los últimos 2' con margen ≤ 9 (`live.js:93-97`). Presupuesto de latencia: informar ≤ 90 s, recomendar ≤ 20 s; sin `wallclock` de la fuente no se acredita nada (`live.js:136-157`). Calibración declarada en constantes: WNBA 2026, 8.071 estados de 275 partidos, Brier 0,15006, log loss 0,45047, ECE 2,35 pp; último minuto 0,31 pp; sesgo conocido "entre 30% y 60% sobreestima al local ~6 pp; probado como ruido de muestra, no se corrige"; correcciones rechazadas (bayesiana con el marcador, escalar cancha, Platt) porque empeoraban en el 30 % reservado (`live.js:179-200`). No hay recomendaciones en vivo: `recommendations_enabled` solo con `mode === 'completo'` y, además, "no hay comparación con precios en vivo" (`live.js:172,206`).

---

### 5.6 Del modelo a la pick (monitor privado)

Función `buildHoopsPicks` (`server.js:12684-12994`). Paso a paso:

1. **Universo:** por liga con `fit`, eventos de `db.clubsQuoteEvents` de esa liga con saque en (0, +72 h] (`server.js:12707`); cuotas de ≤ 75 min; el partido ESPN se resuelve por nombres normalizados contra el calendario de −6 h a +4 días (`server.js:12716-12726`).
2. **Simulación:** `MD.simulateGame` con el parte real de bajas (`hoopsInjuries`), 20.000 sims, seed 13, **`market: null`** (la mezcla se hace después, por selección) (`server.js:12738-12745`).
3. **Incertidumbre:** `SC.uncertainty(sim, null, sens)` con tornado de 3.000 sims (`server.js:12755-12762`).
4. **Consenso:** exige ≥ 3 casas por lado (`server.js:12765`). Cuota mejor por lado dentro de [1,35; 4,5] (`HOOPS_PICK_MIN/MAX_ODDS`, `server.js:12636-12637,12769`).
5. **Probabilidad del modelo por familia:** moneyline = `sim.win`; total y hándicap con **lógica de empuje** `PRC.pushAware` sobre `total_hist`/`margin_hist` (gana/empuja/pierde; probabilidad efectiva `w/(w+l)`; `pricing.js:126-144`, `server.js:12778-12795`).
6. **Consenso sin margen:** mediana de las implícitas por lado y **Shin** (`PRC.novig(...,{method:'shin'})`; `pricing.js:58-81`; `server.js:12798-12804`). El método queda registrado en la pick (`novig_method:'shin'`, `server.js:12953`).
7. **Encogimiento al mercado:** `pModel = blend(pModel, pMarket, C.blend.w)` si `w > 0` (`server.js:12810-12811`). Aquí el peso w se estimó **solo con el moneyline** (`gates.js:179-181`, `hoops-validate.js`) y se aplica igual a spread y total.
8. **Ventaja y EV:** `edge_pp = 100·(pModel − pMarket)`, `ev = (1−push)·(o·p − 1)` (`server.js:12812-12813`); `priceRow` añade `min_playable = 1,02/p`, sensibilidad por ticks de 0,05 y `playable` (`pricing.js:149-167`).
9. **Compuertas (`gates.evaluate`)**: sin_consenso (<3 casas), edge < listón de familia (moneyline 2,5 pp / spread 2,0 / total 2,0 con EV mín. 2 %), **incertidumbre: `|edge| < 1,3·uncertainty_pp`**, precio rancio (≥ 75 min bloquea; `pricing.staleness`), precio no jugable, alineación sin resolver, modelo degradado (`familyHealth`), tesis repetida (`gates.js:27-39,60-114`). **Importante:** el veredicto se guarda en `pick.gate` y en `db.hoopsGates` (registro de "NO PICK"), pero **no bloquea la emisión**: la pick nace si `edge_pp ≥ 3` y `ev > 0` (`server.js:12824`) más los gates v2, sin comprobar `decision.pick` (`server.js:12839,12950-12952`). El comentario lo explica: "El monitor es MODO SOMBRA: se registra todo para medir, se publica nada" (`server.js:12943-12945`). `familyHealth` con `GP_HOOPS_MONITOR_ALL=1` (default) devuelve `status:'publica', regime:'monitor'` para todas las familias, es decir, nunca bloquea (`gates.js:171-187`).
10. **Gates v2** (`GP_HOOPS_V2`, default on; `server.js:12825-12837`), de la autopsia de 186 liquidadas del 31-ago: `edge_pp ≥ 5`; sin spreads con |línea| ≥ 8; totales solo under. **Defecto vigente:** la tercera regla compara `m.fam === 'total'` cuando la familia se llama `match_total` → **es código muerto y los overs sí pasan** (`server.js:12836`; reconocido en `docs/impl/hoops-REPORT.md:92-96` y `PREREGISTRO_WNBA_TOTALES.md:47-54`, y dejado así para no cambiar la regla a mitad de ventana).
11. **Dedup:** una por familia y partido, máx. 2 por partido (`HOOPS_PICK_MAX_PER_GAME`), tope de 12 por pasada; **una pick por tesis** (`fam|lado|partido`, viva o liquidada): si existe, se anota `requote` (máx. 20, sin copias idénticas) y no nace otra (`clv.js:79-101`, `server.js:12846-12866`).
12. **Stake sugerido:** Kelly/4 sobre `pShrunk = 0,35·pModel + 0,65·pMarket`, tope 2,5 % (`server.js:12930-12934`); `confidence` numérica con la misma mezcla ad hoc (`server.js:12896`). Nótese que `pricing.kelly` (Kelly sobre el límite inferior de confianza, tope 2 %, `pricing.js:183-191`) existe pero no lo usa el constructor. La autopsía lo señala: "el cierre entra solo como encogimiento (w=0,23) y luego la confianza encoge **otra vez** con 0,35/0,65 ad hoc" (`docs/AUTOPSIA_MODELOS_2026-09-02.md:209-211`).
13. **Etiquetas de medición** que viajan en la pick (`server.js:12906-12965`): `thesis`, `era`, `clv_v: 2`, `market_fair_at_create`, `line_at_create`, `consensus_line_at_create` (línea con más casas, `clv.mainLine`), `requotes`, descanso diferencial solo en TOTAL (`home_rest_days`, `away_rest_days`, `rest_diff`, `prereg_rest_over`), `regime: hoops_v2|hoops_v1`, `monitor_only: true`, `push_prob`, `min_playable`, `price_sensitivity`, `uncertainty_pp`, `gate`, y la transferencia de TT: `sample_n`, `unc_sample_pp = 100·0,28·√(1/(nH+2) + 1/(nA+2))` y `unc.passes = edge ≥ 0,75·unc` (`implied-engine/uncertainty.js:21-27,34-38`) — "medición, no decide" (`server.js:12954-12956`).

Casas y prioridad: no hay prioridad explícita en las picks; se toma la **mejor cuota** entre las que cotizan (`server.js:12768`). `pricing.consensus` tiene una jerarquía de casas (`pinnacle 3, betfair 2,5, circa 2,5… draftkings 1,6…`, `pricing.js:87-88`) pero el constructor de picks **no la usa** (usa mediana simple).

Caducidad: `gates.expiry` declara condiciones (cuota < mínimo jugable, cambio de alineación, línea movida ≥ 0,5) (`gates.js:145-155`) pero no encontré en el código un job que retire picks vivas por esas condiciones; solo `run=prune`/`refresh` manuales (`server.js:20151-20170`).

---

### 5.7 Liquidación y medición

#### 5.7.1 Liquidación (`settleHoopsPicks`, `server.js:12998-13038`)

Fuente: scoreboard ESPN de −6 días a +1 día por liga; solo `completed`. Reglas: MONEYLINE gana si el margen tiene el signo del lado ("en baloncesto la prórroga resuelve: no hay empate"); TOTAL `d = total − línea`, PUSH → `VOID` con `units 0`; SPREAD con línea **normalizada al local** `d = margen + línea`, PUSH → VOID. Unidades: `best_odds − 1` o −1, stake plano de 1 unidad. Riesgos: un partido con saque anterior a 6 días que aún no se liquidó queda `ACTIVE` indefinidamente (no hay VOID por tiempo ni por aplazamiento); las unidades usan la cuota de creación, no las re-cotizaciones.

#### 5.7.2 CLV (`hoopsPicksCloseline`, `server.js:13042-13092`, y `basketball-engine/clv.js`)

Se congela cuando faltan < 25 min (o hasta 3 h después) con cuotas de ≤ 40 min. Tres números:

- `close_line` y `line_moved_pts`: línea principal al cierre (la que más casas cotizan) y movimiento con signo a favor (under: `línea_creación − cierre`; over al revés; hándicap local `línea − cierre`, visitante al revés; ganador null) (`clv.js:105-123`).
- `close_odds` = consenso **proporcional** sin margen de nuestra línea exacta; `clv_price_pct = (best_odds/close_odds − 1)·100`, la fórmula vieja, que "arranca en ≈ −3 % aunque nada se mueva" (`clv.js:32-35`, `server.js:13076-13078`).
- **`clv_pct` (la vara) = (prob. justa Shin del consenso al cierre / prob. justa Shin al nacer − 1)·100** (`clv.js:27-30,40-50`; `server.js:13082-13087`). Migración idempotente `clv_v: 2` para picks viejas con `close_fair_method:'proporcional_desde_close_odds'` (`clv.js:55-74`, `server.js:13154-13161`).

Limitación documentada: si nuestra línea exacta ya no cotiza a 25 min, `clv_pct` queda null aunque se guarde `close_line` ("interpolar el cierre a otra línea sería inventar un número", `hoops-REPORT.md:97-99`).

Cubos T−60/−30/−10/−5/−1 contra la **misma casa** (`own`), la mejor (`best`) y Pinnacle (`hoopsCloseSnapshots`, `server.js:13099-13129`; `implied-engine/closes.js:22-60`), cada 2 min en la ventana ≤ 95 min.

#### 5.7.3 Track y etiquetas

`hoopsPicksTrack` (`server.js:13165-13230`): por familia y liga n, aciertos, unidades, ROI (stake plano), `clv_avg/clv_n/clv_positive/clv_sd` (v2), `clv_price_avg`, `line_moved_avg`, `theses` (tesis distintas), `clv_live`, y `tt_transfer` (CLV contra la misma casa por cubo y muestra partida por la puerta 0,75×unc). `metrics.scorecard` etiqueta el ciclo de vida: `production` si n ≥ 150, skill > 0, t ≥ 2 y CLV medio > 0; `candidate` si t ≥ 1; `shadow` en el resto; `research` por defecto ("una familia se GANA el derecho a publicar", `metrics.js:163-193`). Brier, log loss, nitidez, Murphy, calibración con Wilson (con la corrección de la tautología, `metrics.js:82-86`), CRPS de margen y total, segmentos por mes/rol (`metrics.js:29-161`).

`/api/hoops/perf` (`server.js:20477-20605`) recalcula la validación en **ventana expandida** (40 % inicial solo entrena, 3 bloques, `fitRatings` por bloque, 4.000 sims), skill contra el cierre de ESPN (`odds[0]`, devig proporcional `ih/(ih+ia)`), error estándar y t, MAE de margen y total, calibración por deciles, y un `verdict` textual; la memoria in-sample "daba skill +0.007 cuando el backtest honesto da negativo" (`server.js:20472-20476`). Ojo: esta ruta evalúa **solo el simulador base** (sin pila ni mezcla), y solo el moneyline.

#### 5.7.4 Preregistros vigentes

- **Totales WNBA/NBA** (`docs/PREREGISTRO_WNBA_TOTALES.md`): 60 picks liquidadas desde `created_at ≥ 2026-09-02T10:40Z`, muestra que empieza el 17-sep; vara `clv_pct` v2: éxito CLV medio > 0 y ≥ 40 % positivas; fracaso CLV < −1 % con t < −1,5; chequeo de `line % 5`.
- **Descanso diferencial WNBA** (`docs/PREREGISTRO_WNBA_DESCANSO.md`): regla `over si away_rest − home_rest > 0,9 d` (descanso saturado a 7, defecto 3), 60 disparos desde 2026-09-17, éxito ≥ 56 % de overs; **solo etiqueta**, evaluada en `/api/hoops/perf.preregistro_descanso` (`clv.js:128-182`, `server.js:20583-20596`). Origen: 13/18 en test pero p = 0,11 frente al over ciego (`BACKTESTS_FAMILIAS:196-199`).

Números del monitor a 2-sep (`docs/AUTOPSIA_MODELOS_2026-09-02.md:71-72,205-208`): WNBA SPREAD 79 picks, 55,7 %, ROI +6,6 %, **CLV −4,6 (t −6,1)**, solo 12 % con CLV positivo (de los cuales −3,16 son margen de casa por la fórmula vieja, `BACKTESTS_FAMILIAS:189-194`); WNBA TOTAL 31 picks, 35,5 %, −30,9 % (bug de cubos). Las 79 picks de hándicap eran **15 tesis**.

---

### 5.8 Familias de precio: value, arbitraje, caídas y middles

Módulo `basketball-engine/markets.js`, servido en `/api/hoops/opps` (`server.js:20091-20126`). Doctrina: "El modelo nunca crea una oportunidad: solo comenta la que el mercado ya creó" (`markets.js:17-18`). Módulo propio porque "el 1X2 de fútbol es un mercado de tres salidas y el ganador de baloncesto es de DOS. Mezclarlos rompe el de-vig" (`markets.js:3-7`).

Universo: eventos `sport:'basketball'` con saque entre −3 h y +240 h (`hoopsEvents`, `markets.js:43-55`); cuotas de ≤ 75 min.

| Familia | Regla exacta | Fuente |
|---|---|---|
| **Value** | ≥ 3 casas por lado; justa = **mediana de implícitas por lado normalizada a 1 (proporcional)**; `ev_pct = (mejor_cuota·justa − 1)·100 ≥ 2`; orden por EV | `markets.js:111-146` |
| **Arbitraje** | mejor precio de cada pata en **casas distintas** con `1/oA + 1/oB < 1`; `stake_pct` proporcional a la implícita; `executable` solo si ambas tienen `max_stake` y el tope ≥ 50 | `markets.js:148-161` |
| **Middles** | over en línea baja + under en alta (o local/visitante en hándicap) en casas distintas, hueco ≥ 2 puntos, coste `(1/oA + 1/oB − 1)·100 ≤ 6 %`; zona ganadora explícita; corrección de la versión anterior que "publicaba pares donde las dos patas PIERDEN juntas" | `markets.js:167-203` |
| **Caídas** | media de cuota de `SHARP_BOOKS` (pinnacle, cloudbet, betfair_ex_*, matchbook, polymarket, kalshi, novig, prophetx) ahora (≤ 75 min) vs hace 3–9 h; cae ≥ 5 % → se listan casas lentas con cuota ≥ 98,5 % de la vieja; top 30 | `markets.js:37,220-259` |

GP Take: `attachModel` resuelve nombres contra el catálogo y anota `model`, `model_odds`, `model_ev_pct`, `model_vs_market_pp`, `model_conf` desde una simulación base de 12.000 (sin bajas ni mezcla) — "Nunca crea filas" (`markets.js:261-306`).

Observaciones: (a) el de-vig de la superficie value es **proporcional** (`markets.js:116`), el de las picks es **Shin** y el del implícito es `devig2` proporcional; tres métodos conviven; (b) The Odds API no trae `max_stake`, así que `executable` solo puede ser verdadero con casas que aporten profundidad (Cloudbet/Myriad, en fútbol); en baloncesto, con las casas del sweep, quedará en `false`; (c) los middles no calculan la probabilidad de caer en la zona (solo hueco y coste); (d) `SHARP_BOOKS` incluye polymarket/kalshi que el sweep de hoops no escribe.

---

### 5.9 Props de jugador

#### 5.9.1 Modelo (`basketball-engine/props.js`)

Por jugador y categoría: tasa por minuto encogida hacia la media de la liga con `k = 300` minutos de prior (`rate = (m·r_j + 300·r_liga)/(m + 300)`, `props.js:44-54`), historial de los últimos 40 partidos (`props.js:30-39`), **factor del rival** = lo que concede por minuto relativo a la liga, encogido `n/(n+12)` hacia 1 (`props.js:70-87`), `μ = tasa·minutos·rival·paceFactor` con minutos proyectados por la pila (ya con bajas) y `paceFactor = poss_sim/lgPace` (`store.js:380-401`). Distribución **binomial negativa** con `r` por método de momentos acotado a [1,2; 60]; si no hay sobredispersión, Poisson (`props.js:93-115`). Salida: líneas ±3 alrededor de `round(μ·2)/2` con `P(>línea)`, cuantiles e histograma (`props.js:118-154`). Umbrales de familia previstos en gates (puntos 3,5 pp, rebotes/asistencias 4,0, triples 5,0; `gates.js:34-37`).

#### 5.9.2 Lo que NO hay

No encontré en el código ningún generador de candidatos de props (ninguna comparación automática entre `props.js` y las líneas capturadas en `props_market`), ni liquidación ni track de props de baloncesto. `hoopsPropsCapture` solo acumula el mercado "para contestar el domingo... ¿los props de las ligas menores son de verdad más explotables?" (`server.js:4866-4873`); la medición de una noche dio "vig del 6,98% frente al 4,71% del mercado principal, y solo el 1% de las líneas con valor de ejecución frente al 9%" (`server.js:4871-4872`). No hay validación fuera de muestra del modelo de props. Las tasas y factores usan **todo el dataset sin decaimiento temporal** (`leagueRates`, `opponentFactor`).

#### 5.9.3 `prop-engine/` (fútbol, no baloncesto)

Para evitar confusión: `prop-engine/model.js` ajusta córners y tarjetas de fútbol con Binomial Negativa, `PRIOR_MATCHES 4`, `REF_PRIOR 14`, tope de árbitro ±20 %, `TOTALS_DAMP 0` calibrado por LOO en el Mundial (`prop-engine/model.js:22-37`); `prop-engine/players.js` proyecta xG/remates por 90' con priors por posición (`players.js:15-28`); `calibrate.js` hace LOO con gate `n ≥ 40, Brier ≤ 0,25, |cal| ≤ 0,06` (`calibrate.js:11`). No se conecta con `basketball-engine`.

---

### 5.10 Proceso implícito de baloncesto (sombra de precio)

`implied-engine/hoops.js` + `run-hoops.js`, job `hoopsImpliedJob` (`server.js:13131-13149`), cada 30 min; cierres cada 2 min desde `hoopsCloseSnapshots`.

Idea (`hoops.js:1-15`): el margen ~ N(μ, σ) con σ casi constante por liga; una casa cotiza μ dos veces (hándicap y ganador). Con `z_ml = Φ⁻¹(p_ganador)`, `z_sp = Φ⁻¹(p_cubre)`: `σ_implícita = línea/(z_sp − z_ml)`. Constantes `SIGMA = { nba 12,4, wnba 11,6, ncaab 10,8, euroleague 11,2, default 12 }` ("valores de referencia de la literatura y de nuestros propios residuos", `hoops.js:21-23`); σ del total = 1,6·σ (`hoops.js:137`). De-vig proporcional de dos salidas (`devig2`, `hoops.js:47-51`). Φ por Abramowitz-Stegun, Φ⁻¹ por Acklam (`hoops.js:26-44`).

Tesis por casa (`hoops.js:72-97`): **IMPLIED_ML** (μ del hándicap → ganador coherente `Φ(μ_sp/σ)` vs `p_ml`) e **IMPLIED_SPREAD** (μ del ganador → cubre coherente `Φ((μ_ml + línea)/σ)` vs `p_cover`), con `unc_pp` derivada de 0,5 pp de ruido de precio amplificado por la inversión (`hoops.js:84-86`). Por partido, si ≥ 3 casas revelan σ implícita en (5, 25), la mediana pasa a ser la σ del partido y se recalcula (`hoops.js:103-110`); con ≥ 3 casas nacen **BOOK_DEV_SPREAD/ML/TOTAL** contra la mediana del tablero, `unc_pp = 0,5` fijo (`hoops.js:114-145`). `selfTest` reconstruye σ y μ sintéticos con error < 0,05 (`hoops.js:150-159`).

Cableado (`run-hoops.js`): usa `MK.loadQuotes` (≤ 90 min) y `groupMarkets`; por casa toma el hándicap y total **principales** (la línea con más casas) exigiendo las dos patas en la misma casa (`run-hoops.js:19-43`); σ de referencia = mediana de las σ implícitas del tablero con memoria EMA 0,7 (`sombra.updateBaseline`, `sombra.js:55-68`); las tesis de incoherencia interna solo nacen con σ del tablero ya estimada (`run-hoops.js:73-75`). Mapeo de liga: `wncaab → ncaab`, `euro → euroleague` (`run-hoops.js:16`).

Regla congelada `implicito_v3` (`sombra.js:21-33`): edge ≥ 3 pp y ≤ 15 pp, cuota 1,25–6,0, `edge ≥ 0,75·unc_pp`, BOOK_DEV con ≥ 3 casas, ≥ 8 observaciones para la base, máx. 60 nuevas por pasada ordenadas por ventaja; tesis vivas de otra versión se anulan (`sombra.js:80-100`). Cierres por cubo contra la misma casa; liquidación ≥ 150 min tras el saque con `verdictFactory` (ML sin empate, spread desde el lado apostado, total; PUSH exacto) (`run-hoops.js:118-134`), VOID a 72 h sin resultado (`sombra.js:122-145`). Los marcadores se casan por **nombre normalizado** entre The Odds API y ESPN (`server.js:13138-13147`); un nombre que no case termina en VOID. Vara: "CLV contra la MISMA casa por cubo; el ROI se anota y no decide. Con < 150 liquidadas por familia todo es ruido" (`sombra.js:track`).

---

### 5.11 Parámetros y variables de entorno

| Variable / constante | Default | Efecto | Fuente |
|---|---|---|---|
| `GP_HOOPS_PUBLIC_ENABLED` | unset (solo admin) | abre `/api/hoops/*` por tiers | `server.js:20076` |
| `GP_HOOPS_PICKS_ENABLED` | `true` | enciende la cadena de jobs del monitor | `server.js:13260` |
| `GP_HOOPS_PICK_MIN_EDGE` | 3 pp | listón v1 | `server.js:12635` |
| `GP_HOOPS_PICK_MIN_ODDS` / `_MAX_ODDS` | 1,35 / 4,5 | banda de cuota | `server.js:12636-12637` |
| `GP_HOOPS_PICK_MAX_PER_GAME` | 2 | tope por partido | `server.js:12638` |
| `GP_HOOPS_V2` | `true` | edge ≥ 5, sin spreads |línea| ≥ 8, (totales solo under: inoperante) | `server.js:12832-12837` |
| `GP_HOOPS_MONITOR_ALL` | `1` | familias sin validación entran en monitor en vez de bloquearse | `gates.js:171` |
| `GP_HOOPS_HARVEST` | on | cosecha diaria | `server.js:561` |
| `GP_HOOPS_OUT` | repo | `disk` escribe artefactos en el overlay | `hoops-fit.js:32` |
| `SPORTSBOOK_PROVIDER_API_KEY` | — | The Odds API (sweep y props) | `server.js:4881,4955` |
| `ODDS_REGIONS_SCAN` (const) | `us,us2,uk,eu,au` | regiones del sweep | `server.js:4670` |
| `DB_FILE` | `./db.json` | raíz del overlay `hoops/`, `implicito/`, `injuries-history.jsonl` | `store.js:25` |
| `GP_EXPORT_KEY` | — | `POST /api/hoops/refresh` | `server.js:20607` |
| `halfLifeDays 45, priorGames 6, minGames 5, iters 60` | código | rating | `ratings.js:34` |
| `k 300 (props), k 12 (rival), r ∈ [1,2; 60]` | código | props | `props.js:44,70,114` |
| RAPM λ candidatos 200…16000, halfLife 240 d | código | RAPM | `players.js:64,108` |
| Gates: listones por familia, ratio 1,3, stale 20/75 min | código | compuertas | `gates.js:27-39,75`, `pricing.js:172` |
| `SIGMA` por liga, σ_total = 1,6σ, `unc 0,5` BOOK_DEV | código | implícito | `hoops.js:23,137,124` |
| `RULE implicito_v3` | código | sombra de precio | `sombra.js:21-33` |
| `BUDGET info 90 s / pick 20 s`, `VAR_POSS 1,5` | código | vivo | `live.js:92,136` |
| Planes: `opps` sharp; `brief/sim/read` pro; `picks/perf` admin | código | tiers | `server.js:20081-20084` |

---

### 5.12 Debilidades, supuestos y riesgos observados en el código

1. **Regla de emisión distinta de la preregistrada.** El preregistro de totales dice que las "compuertas de `gates.js` (edge ≥ 1,3 × incertidumbre)" forman parte de la regla; en el código las compuertas son **solo registro** y la pick nace con `edge ≥ 5` (v2) sin mirar `decision.pick` (`server.js:12824-12839`). Y el filtro "totales solo under" es código muerto (`m.fam === 'total'` vs `match_total`, `server.js:12836`). La muestra v2 contiene, por tanto, overs y picks que las compuertas habrían rechazado.
2. **Doble encogimiento ad hoc.** Tras mezclar con w validado, `confidence` y `stake_pct` vuelven a mezclar 0,35/0,65 sin validación (`server.js:12896,12930-12934`); `pricing.kelly` (LCB) no se usa.
3. **w de moneyline aplicado a spread y total.** El peso de mezcla se estima solo con el ganador (`hoops-validate.js`, `gates.js:179-181`) y se aplica a las tres familias. En el backtest de estrategia los hándicaps/totales se mezclan contra `pMarket = 0,5` asumido a −110 (`hoops-strategy-backtest.js`), no contra el precio real.
4. **Dos "mercados" distintos según la etapa.** La validación usa `odds[0]` de ESPN (primer proveedor de `pickcenter`, casa no especificada) con de-vig proporcional; las picks usan mediana de casas + Shin; la superficie value usa proporcional; el implícito `devig2`. Comparar skill y CLV entre etapas mezcla definiciones.
5. **La capa de plantilla en producción nunca se backtesteó** con bajas reales: "la corrida `stack` es idéntica a `base` porque no hay parte de bajas histórico" (`BACKTESTS_FAMILIAS:184-187`). La validación reconstruye ausencias con el **box score del propio partido evaluado** (jugador con ≥ 8 min esperados y 0 minutos = fuera, `hoops-validate.js:117-121`): eso incluye decisiones técnicas y bajas de última hora que a la hora de la pick no se conocían — una fuga hacia el futuro que favorece la capa. Aun así, en NBA la capa empeora.
6. **Artefactos congelados el 15-ago.** `validation-*.json` (n WNBA 164) y `fit-*.json` datan del 15-ago; el overlay diario re-ajusta el fit según el comentario del job, pero **no encontré** un job que regenere la validación (capas encendidas/apagadas y w) con datos nuevos. `fit_artifact.stale` lo detecta pero no lo corrige (`store.js:70`).
7. **El peso de mezcla del artefacto (w = 0) contradice al de la validación (0,134/0,233)**; se elige el segundo por criterio de método (`store.js:108-117`), no por reconciliación de la diferencia.
8. **Rating sin filtros de fase ni de sede.** `fitRatings` mezcla pretemporada, play-in y playoffs (71 + 85 + 6 partidos en NBA) y estima `hca` incluyendo partidos neutrales (`ratings.js:35-36,69`). El garbage time no se filtra en el rating de equipo y hay dos definiciones distintas de basura (partido vs tramo).
9. **Riesgo de temporada NBA 2026-27 no cosechada hasta 2027** por `--season=<añoUTC>` y el mapeo octubre(año−1)–junio(año) (`server.js:569`, `espn.js:199-200`).
10. **Liquidación y CLV frágiles:** picks con saque > 6 días atrás sin resultado quedan ACTIVE; `clv_pct` null si la línea exacta desapareció; no hay VOID por aplazamiento; el implícito casa marcadores por nombre normalizado.
11. **Muestras pequeñas:** WNBA 275 partidos (validación 164); la capa de plantilla en WNBA se enciende con Δ +0,00228; el CLV del hándicap (−1,46 ± 0,73 de movimiento real por pick, −0,52 ± 0,39 por tesis) proviene de 15 tesis (`BACKTESTS_FAMILIAS:191-194`).
12. **Familias de precio sin liquidez verificada:** `executable` depende de `max_stake` que The Odds API no da; los middles no calculan la probabilidad de la zona; `staleness` no se aplica a la superficie value (ventana 75 min uniforme).
13. **Props sin validación ni pick:** el modelo de props no tiene backtest, no decae en el tiempo y no se compara con el mercado capturado.
14. **Constantes de σ del implícito por decreto** (12,4/11,6/…) y σ_total = 1,6σ sin cita de medición en el código; `unc_pp` de BOOK_DEV fijo en 0,5.
15. **Superficies con semillas y tamaños de simulación distintos** (12.000/20.000/8.000/6.000/4.000) producen números no idénticos para el mismo cruce.
16. **Nombres y catálogo:** el emparejamiento The Odds API ↔ ESPN por nombre normalizado (`server.js:12718-12726`) no tiene tabla de alias; un cambio de nombre deja partidos sin pick y sin liquidación.
17. **Comentarios del autor que admiten límites**, citados: "la regla marca el 64% de los partidos WNBA... NO quedó resuelta" (`possessions.js:78-80`); "las dudas se combinan como independientes; con dos bajas del mismo equipo la cola mala queda algo subestimada" (`scenarios.js:106`); "no ajusta por faltas acumuladas... no sabe qué quinteto está en cancha" (`live.js:201-207`); "ninguno de los N árbitros sobrevive al control de falsos descubrimientos... El entorno de faltas NO se usa" (`officials.js:125-128`); "el modelo NO bate al cierre. Por eso las picks de baloncesto están apagadas: publicarlas sería vender lo que ya sabemos que pierde" (`server.js:20601`).

**Cómo leerlo, en una línea para la auditora:** el motor de baloncesto está construido con bastante disciplina (semillas fijas, de-vig con método registrado, compuertas con código de rechazo, validación fuera de muestra, preregistros), pero **la única familia que hoy tiene una vara positiva es ninguna**: el modelo pierde contra el cierre en ambas ligas, las picks son papel privado, y lo que se publica al público es exclusivamente aritmética de precios entre casas.

---

# Parte 6 · Fútbol americano: NFL, NCAAF y CFL

> Tres ligas, dos motores, una sola doctrina: **el modelo es ciego al mercado por construcción y TODAS las
> familias nacen y siguen en sombra**. Nada de lo que hay en este capítulo genera una pick pública hoy.
> Motores: `nfl-engine/` (NFL) y `amfoot-engine/` (NCAAF + CFL, reusando el simulador y la posterior de NFL).

---

## 1) Propósito y alcance

| | NFL | NCAAF (College FBS) | CFL |
|---|---|---|---|
| Motor | `nfl-engine/{data,simulate,posterior,store}.js` | `amfoot-engine/store.js` (+ `nfl-engine/simulate.js`, `nfl-engine/posterior.js`) | ídem |
| Rutas | `/api/nfl/*` | `/api/amfoot/*?league=ncaaf` | `/api/amfoot/*?league=cfl` |
| Gate | `GP_NFL_PUBLIC_ENABLED` (sin poner = **solo admin**), `server.js:21359` | el MISMO flag de NFL, `server.js:21273` | ídem |
| Familias | SPREAD, TOTAL, MONEYLINE — **las tres en sombra** (`nfl-engine/store.js:683-688`) | SPREAD, TOTAL, MONEYLINE — todas en sombra (`amfoot-engine/store.js:996-1000`) | ídem |
| Props | estado `research`, no existen (`nfl-engine/store.js:687`) | no existen | no existen |
| Temporada en el código | `season 2026`, kickoff 9-sep-2026 | `season: 2026, kickoff: '2026-08-29'` (`amfoot-engine/store.js:53`) | `season: 2026, kickoff: '2026-06-11'` (`:59`) |

La doctrina está escrita como constante y viaja en cada respuesta de la API:

```js
// nfl-engine/store.js:38
const DOCTRINE = 'todas las familias de NFL están EN SOMBRA: el modelo (walk-forward 2017-2025) queda a
 ~0.45 puntos del cierre en margen — excelente para entender el partido, no probado para batir al mercado.
 Se registra todo en privado, se mide CLV por familia, y solo la evidencia fuera de muestra puede subir una
 familia de estado (blueprint NFL-1125).';
```

Las cuatro decisiones de cabecera están en el encabezado del store (`nfl-engine/store.js:6-17`): (1)
market-blind por construcción — *"La ortogonalidad no es un check: es que el camino de código no existe"*;
(2) todas las familias en sombra; (3) septiembre arranca sin muestra 2026 y *"el listón del noise gate es
casi infranqueable A PROPÓSITO"*; (4) cierres y picks viven en el **disco persistente**, porque *"un
histórico que se borra no es un histórico"*.

El origen documental del alcance está en `INVESTIGACION_AMFOOT.md` (18-ago): el veredicto fue *"SÍ para
College (NCAAF), con la misma arquitectura y datos GRATIS que son incluso mejores que los de NFL. CFL solo
como capa de mercado (sin modelo) hasta que su dato lo permita"* — la CFL acabó teniendo modelo porque los
cierres «imposibles» se rescataron del histórico de The Odds API (§3.3).

---

## 2) Fuentes de datos

### 2.1 Histórico (cosecha, offline)

**NFL — `scripts/nfl-harvest.js`.** Dos familias de CSV de nflverse, sin llave:

| Fuente | URL | Qué aporta |
|---|---|---|
| `games.csv` (nflverse/nfldata, Lee Sharpe) | `raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv` (`:86`) | 1999→hoy: marcador, **líneas de cierre históricas** (spread/total/moneyline), QB titular, coach, descanso, techo, superficie, temperatura, viento, árbitro, `espn` id, `location` |
| `stats_team_week_YYYY.csv` | `github.com/nflverse/nflverse-data/releases/download/stats_team/…` (`:90`), 2016→año actual | EPA de pase y carrera por equipo-semana, CPOE, explosivas, sacks |
| `stats_player_week_YYYY.csv` | ídem `stats_player` (`:99`), solo las **dos últimas** temporadas | directorio y bitácora de jugadores |

Crudo → `<disco>/nfl-raw/` (`:40-46`); agregado → `data/nfl/` o, con `--out=disk`, `<disco>/nfl-agg/`
(`:36-39`). La defensa **no se descarga**: se deriva de la fila del rival en el mismo partido
(`:174-177`) — *"la EPA ofensiva del rival ES la defensiva del equipo"*.

**NCAAF** — CollegeFootballData (CFBD), key gratis en `CFBD_API_KEY`; el harvester histórico no está en el
repo con ese nombre (no encontrado en el código: no hay `scripts/ncaaf-harvest.js`), pero el consumo en
caliente sí: `amfoot-engine/store.js:211` llama a `api.collegefootballdata.com/games?year=&seasonType=regular`
con `Authorization: Bearer`. `HANDOFF.md:2091` documenta la cosecha: 11.260 partidos FBS 2014-2026, 8.614
con cierre histórico, 38 llamadas de las 1.000/mes del plan gratuito.

**CFL — `scripts/cfl-harvest.js`.** Cosido de **cuatro** fuentes, cada una la mejor en su tramo (`:1-31`):

- 2021-2022 → ESPN scoreboard (*"ESPN soltó los derechos de la CFL después de 2022 y sus datos mueren ahí;
  verificado: 2023+ devuelve vacío"*), con transporte curl porque Akamai rechaza el `fetch` de Node.
- 2023-2025 → Wikipedia, página de temporada **por equipo**; cada partido aparece dos veces y el dedupe
  por `(fecha, local, visita)` **verifica que los dos marcadores coincidan** — *"parser con testigo, no a
  ciegas"*.
- 2026 → `cflscoreboard.cfl.ca/json/scoreboard/rounds.json` (sin llave).
- **Cierres** → The Odds API *historical*: `/historical/events` a mediodía (1 crédito) da los kickoffs del
  día y un snapshot de `/historical/odds` a **kickoff − 5 min** por cada hora de inicio captura el cierre.
  Antes de oct-2022 no hay snapshots: esos partidos *"quedan SIN cierre y el fit los usa solo para el
  rating, no para los residuos"*.

### 2.2 Mercado (en caliente)

- **The Odds API**, una llamada por liga y pasada, `regions=eu,us`, `markets=h2h,spreads,totals`,
  `oddsFormat=decimal`, timeout 20 s (NFL, `nfl-engine/store.js:104`) / 25 s (amfoot,
  `amfoot-engine/store.js:355`). Memo fuerte: `ODDS_TTL = 30 * 60e3` (`nfl:93`, `amfoot:348`). El contador
  global de créditos se actualiza leyendo la cabecera `x-requests-remaining` (`nfl:107`, `amfoot:357`) —
  *"el gasto de NFL no puede ser invisible"*.
- **Cloudbet** (solo amfoot, desde el 7-sep) — `data-providers/amfoot/cloudbet.js`. Competiciones:
  `american-football-usa-ncaa`, `american-football-usa-nfl`, `american-football-international-cfl` (`:18`).
  Dos llamadas por evento (lista + mercados), 150 ms entre eventos (`:136`), TTL 25 min (`:20`), reintentos
  con backoff y respeto al 429 (`:24-34`). Se funde como **una casa más** dentro de la fila de The Odds API
  (`:156`) — *"el resto de la sombra —mejor precio, consenso, cierres— los ve sin saber de dónde salieron"* —
  y añade `_cb` con la **escalera de líneas alternativas** y el `max_stake`, que The Odds API no da.
  Detalle de formato verificado en producción y anotado en el código: la clave de submercado llega como
  `period=ot&period=ft` (`:74`) y `handicap=3` *"viene IGUAL en las dos selecciones y es el hándicap del
  LOCAL"* (`:88-91`). Interruptor `GP_AMFOOT_CLOUDBET` (`:45`).
- **Resultados en caliente (amfoot)** — `refreshResults()` (`:181`): CFL del scoreboard oficial, College de
  CFBD; caché 6 h salvo `force` (`:184`), escritura al disco persistente y **invalidación del snapshot del
  modelo** (`:226`). La liquidación lee ese overlay, no ESPN (*"que ya no tiene CFL"*, `:22`).
- **Resultados NFL** — ESPN scoreboard `site.api.espn.com/.../football/nfl/scoreboard?dates=YYYYMMDD`,
  caché 10 min por día (`nfl-engine/store.js:520-525`).
- **Clima (solo NFL)** — open-meteo sin llave, solo para estadios al aire libre y a ≤8 días
  (`nfl-engine/store.js:195-221`), caché 3 h. Es **display**: *"El clima se ENSEÑA, no mueve el modelo:
  'lluvia = under' no es un modelo (§15)"* (`:217`).
- **Lesiones (solo NFL)** — ESPN core API, caché 6 h, etiquetado *"mejor esfuerzo — NO es el injury report
  oficial de la liga… la decisión del motor no lo consume todavía"* (`:806-807`).
- **Prensa** — `observer/deportes.js` dominio `amfoot`, con vocabulario propio (`:36-38`, `:60`) y tipos
  `QB/OUT/INJURY/DOUBT/SUSPENDED/COACH` con pesos `QB:3, OUT:3` (`:207`, `:222`). Entra solo al dossier del
  redactor marcado como PRENSA (`server.js:13537-13540`, `13576-13579`); **ninguna señal toca una
  probabilidad**.

### 2.3 Qué pasa cuando falla la fuente

- Sin `SPORTSBOOK_PROVIDER_API_KEY` → `refreshOdds` devuelve `null` y no hay mercado: la ficha se pinta
  con modelo y `edges: { candidates: [], verdict_note: 'sin mercado abierto todavía.' }`
  (`nfl-engine/store.js:312`).
- Fallo de red → se devuelve el último `G.odds` cacheado (`nfl:113`, `amfoot:367`), nunca una excepción.
- Cloudbet caído → `G.cb[lg] = { error }` y la sombra sigue con las casas de siempre (`amfoot:363`).
- Sin `CFBD_API_KEY` → `{ ok:false, why:'sin CFBD_API_KEY' }` (`amfoot:210`); el overlay no se actualiza y
  la liquidación de College se queda esperando (con VOID a los 7 días, §7).
- Lecturas/escrituras de disco: `lib/jsonstore.js` distingue **"no existe"** de **"no se pudo leer"** y
  bloquea la escritura en el segundo caso, para no repetir el incidente del 4-sep en el que *"no pude
  leer"* se trató como *"no hay nada"* y borró tracks enteros.

---

## 3) Datos históricos con los que se calibró

### 3.1 `data/nfl/`

| Archivo | Tamaño | Contenido | Rango |
|---|---|---|---|
| `games.json` | 1,67 MB | 3.033 partidos (**2.761 con resultado**) | 2016 → 2026 (calendario 2026 completo, hasta 2027-01-10) |
| `team-weeks.json` | 2,50 MB | 5.522 filas equipo-semana con `off{pass_epa,rush_epa,plays,pass_rate,cpoe,expl_pass,expl_rush,sacks_suffered}` y `def{pass_epa_allowed,rush_epa_allowed,expl_*_allowed,sacks_made}` | 2016 → 2025 |
| `players.json` | 1,59 MB | 434 jugadores con volumen (≥40 pases, ≥25 acarreos o ≥20 objetivos) + bitácora semanal | 2024-2025 |
| `venues.json` | 4,8 KB | 30 estadios con lat/lon/`roof`/altitud/huso (5 `closed`, 5 `dome`, 20 `outdoors`) | — |
| `model-priors.json` | 73 KB | constantes + pool + atlas + validación | fit del 2026-08-19 |
| `meta.json` | 354 B | temporadas y derechos: *"desarrollo/investigación (revisar antes de redistribuir crudo)"* | — |

**Transcripción íntegra de `data/nfl/model-priors.json`** (todo salvo los dos arrays de 2.761 filas):

```json
{ "at": "2026-08-19T07:59:55.347Z",
  "model_version": "nfl-margin-epa-1",
  "hfa": 1.74, "k_total": 18.68,
  "sigma_extra_margin": 3.57, "sigma_extra_total": 3.34,
  "resid_pool":    [2761 pares (margen−spread, total−línea); p.ej. [4,0.5] … [-11.5,-3.5]],
  "outcome_atlas": [2761 filas [spread_close, total_close, margen_real, total_real]; p.ej.
                    [-3,40.5,1,41] … [-4.5,45.5,-16,42]],
  "spec": "margen = rating(local) − rating(visita) + HFA (0 en neutral). total = base móvil de liga
           (200 partidos previos) + k·EPA compuesta de los cuatro lados. Distribución: mu + par de
           residuos (margen,total) muestreado del histórico vs cierre 2016-2025 … + ruido discreto por la
           varianza extra del modelo medida fuera de muestra." }
```

**Validación (`validation`), transcrita:**

```
note: "walk-forward semanal 2017→: cada partido predicho SOLO con lo anterior. El cierre es el benchmark,
       no el label (NFL-0757). El modelo NO lee ninguna cuota: es market-blind por construcción."
overall: n 2494 · MAE margen modelo 10.31 vs cierre 9.86 · MAE total modelo 10.80 vs cierre 10.51
         Brier modelo 0.224 vs cierre 0.210 · sd error margen modelo 13.28 vs cierre 12.79
```

| temporada | n | MAE margen mod / cierre | MAE total mod / cierre | Brier mod / cierre |
|---|---|---|---|---|
| 2017 | 267 | 10,54 / 10,08 | 11,57 / 11,26 | 0,2163 / 0,2031 |
| 2018 | 267 | 10,17 / 9,87 | 11,07 / 10,72 | 0,2193 / 0,2122 |
| 2019 | 267 | 10,54 / 10,18 | 10,88 / 10,78 | 0,2245 / 0,2140 |
| 2020 | 269 | 10,21 / 9,79 | 10,74 / 10,30 | 0,2247 / 0,2028 |
| 2021 | 285 | 11,10 / 10,67 | 11,19 / 10,81 | 0,2290 / 0,2189 |
| 2022 | 284 | 9,21 / 8,78 | 10,72 / 10,40 | 0,2275 / 0,2088 |
| 2023 | 285 | 10,44 / 9,98 | 10,63 / 10,17 | 0,2293 / 0,2186 |
| 2024 | 285 | 10,29 / 9,70 | 9,82 / 9,77 | 0,2200 / 0,2010 |
| 2025 | 285 | 10,25 / 9,67 | 10,59 / 10,42 | 0,2247 / 0,2104 |

**El modelo pierde contra el cierre en las nueve temporadas, en las tres métricas.** Ninguna excepción.

**Backtest de picks al cierre** (regla: *"entrar AL CIERRE cuando |modelo − cierre| ≥ umbral; -110 en
spread/total, precio real en ML"*, breakeven 52,4 %):

| familia | umbral | n | acierto | ROI |
|---|---|---|---|---|
| SPREAD | 2 pts | 1.346 | 50,2 % | **−4,04 %** |
| SPREAD | 3 pts | 898 | 51,0 % | **−2,51 %** |
| SPREAD | 4 pts | 575 | 53,2 % | +1,55 % |
| TOTAL | 2 pts | 1.279 | 50,1 % | **−4,22 %** |
| TOTAL | 3 pts | 827 | 51,5 % | **−1,67 %** |
| TOTAL | 4 pts | 483 | 52,4 % | +0,10 % |
| MONEYLINE | 3 pp | 1.945 | 33,2 % | **−9,81 %** |
| MONEYLINE | 5 pp | 1.617 | 32,8 % | **−7,24 %** |

### 3.2 `data/amfoot/` — NCAAF

`ncaaf-games.json` (3,5 MB): **11.260 partidos**, 2014→2026 (868-934 por temporada; 2020 solo 568 por
COVID; 2026 con 888 programados), **10.371 con resultado** y **8.614 con cierre**. Campos: `id, season,
week, type, date, start, home, away, hp, ap, neutral, conf_h, conf_a, fcs_opp`.
`ncaaf-teams.json`: 138 equipos con escuela, abreviatura, mascota, conferencia, color y logo CFBD.

**`priors-ncaaf.json` (íntegro salvo arrays):**

```
at 2026-08-19T08:11:49.782Z · model_version "ncaaf-margin-1"
hfa 3.82 · halflife 20 · carry 0.5 · K 5 · cap 45 · base_win 300 · fcs_prior −24 · sd_win 21
sigma_margin 17.25 · sigma_total 17.01 · sigma_extra_margin 7.22 · sigma_extra_total 5.24
resid_pool 6.797 pares · outcome_atlas 6.797 filas
validation.overall: n 7552 · n_close 7542 · MAE margen 13.59 vs 12.34 · MAE total 13.50 vs 12.85
                    Brier 0.2031 vs 0.1841 · sd error margen 17.25 vs 15.67
```

Backtest NCAAF al cierre: SPREAD −5,63 % (n 5.653, umbral 2) / −5,33 (3) / −6,35 (4) / **−7,54 % (6)**;
TOTAL −0,71 % (n 5.079) / −0,88 / −0,19 / **+1,04 % con umbral 6 (n 2.199, acierto 52,9 %)**. Ese +1,04 %
es la única cifra positiva de College y la doctrina la califica de *"dentro del ruido"*
(`amfoot-engine/store.js:54`).

### 3.3 `data/amfoot/` — CFL

`cfl-games.json` (123 KB): **453 partidos** 2021-2026 (68/86/88/84/85/42), **254 con `spread_close`**, con
`close_book` (p.ej. `pinnacle`) y `close_at` (kickoff−5 min). `roster-cfl.json`: 666 jugadores de los 9
clubes, cosechados de las webs oficiales (+ Wikipedia donde el club migró de CMS), `scripts/cfl-rosters.js`.

**`priors-cfl.json`:**

```
model_version "cfl-margin-1" · hfa 1.93 · halflife 18 · carry 0.45 · K 5 · cap 35 · base_win 50
fcs_prior 0 · sd_win 13.5 · sigma_margin 13.42 · sigma_total 13.82
sigma_extra_margin 3.89 · sigma_extra_total 1.92 · resid_pool 249 · outcome_atlas 249
validation.overall: n 373 · n_close 249 · MAE margen 10.55 vs 9.88 · MAE total 11.32 vs 11.20
                    Brier null (no hay moneyline histórico) · sd error margen 13.42 vs 12.84
```

Backtest CFL: SPREAD −0,34 % (n 140) / −3,40 (95) / +4,45 (64) / −4,50 (24); **TOTAL +8,93 % (n 43,
57,1 %) y +24,88 % (n 26, 65,4 %)** — la propia doctrina lo llama *"señal en muestras chicas… exactamente
lo que la sombra 2026 tiene que confirmar o matar"* (`amfoot-engine/store.js:60`).

---

## 4) Rating y estado del modelo (fórmulas y constantes)

### 4.1 Rating en puntos, point-in-time (NFL: `nfl-engine/data.js:84-135`)

Solucionador iterativo de margen ajustado por rival:

```
margen_cap   = clip(result, ±CAP)                      CAP = 28            (data.js:83)
peso w(t,i)  = 0.5^(back/halflife) · carry^(Δtemporadas)   halflife = 24 partidos del equipo,
                                                           carry = 0.60    (data.js:84, valores por defecto)
mAdj         = (±margen) − (neutral ? 0 : ±hfa)            hfa = priors.hfa = 1.74 (fallback 1.9, data.js:109)
R(team)      = Σ w·(mAdj + R(rival)) / (Σ w + K)           K = 6           (data.js:124)
30 iteraciones (data.js:111)
```

Comentarios del autor que conviene citar: el cap existe porque *"el basurero de las palizas no informa"*
(`:80`); el shrinkage bayesiano hacia 0 está para que *"con poca muestra efectiva, el rating no grite"*
(`:123`); y *"El HFA no vive aquí: vive en los priors ajustados y se aplica al armar el partido"* (`:81`).

**Atención de auditoría:** `halflife=24`, `carry=0.60`, `CAP=28` y `K=6` de NFL están **hardcodeados en el
código**, no en `model-priors.json`, y `nfl-fit.js` los usa por defecto (`:49`) sin barrerlos. Solo `hfa`,
`k_total` y las sigmas se ajustan.

### 4.2 Estados EPA (solo NFL, `data.js:140-172`)

Media recency-weighted por dimensión con `halflife = 10` semanas y `carry = 0.55`, sobre nueve
dimensiones: `pass_off, rush_off, pass_def, rush_def, pass_rate, plays, expl_pass, expl_rush, cpoe`. La
separación es doctrinal: *"NFL-0131: métricas de proceso (EPA) separadas de métricas de resultado
(margen). Las dos viajan"* (`:12`). En NCAAF y CFL **no hay EPA**: el ADN viaja `null` y se dice por qué
(*"la CFL no publica EPA: el ADN por dimensión no existe aquí y no se inventa"*,
`amfoot-engine/store.js:838`).

### 4.3 Rating de NCAAF/CFL (`amfoot-engine/store.js:232-273`)

Mismo solucionador, con las constantes **por liga** leídas del priors (`cap`, `halflife`, `carry`, `K`,
`hfa`) y una pieza extra: el rival de otra división (FBS vs FCS) se modela con `fcs_prior = −24` en vez de
con su propio rating, salvo que ya tenga ≥6 partidos propios (`:261`).

### 4.4 Del rating al centro del partido

**Margen** (idéntico en las tres ligas):

```
muMargin = R(local) − R(visita) + (neutral ? 0 : hfa)        nfl:61 · amfoot:317
```

**Total en NFL** (`nfl-engine/store.js:62-66`):

```
base    = media de totales de los ÚLTIMOS 200 partidos terminados          (store.js:50)
pr(t)   = pass_rate del equipo, o 0.58 si falta
offT(t) = (pass_off−μ_pass_off)·pr + (rush_off−μ_rush_off)·(1−pr)
defT(t) = (pass_def−μ_pass_def)·0.58 + (rush_def−μ_rush_def)·0.42
muTotal = base + k_total · [offT(H)+offT(A)+defT(H)+defT(A)]              k_total = 18.68
```

**Total en NCAAF/CFL** (`amfoot-engine/store.js:319-321`): sin EPA,

```
muTotal = base + 0.5·[(tendencia_local − base) + (tendencia_visita − base)]
```
con `tendencia` = media ponderada por recencia de los puntos TOTALES de los partidos del equipo
(`:274-288`) y `base` = media de los últimos `base_win` partidos (300 en NCAAF, **50 en CFL** porque
*"la liga cambió reglas en 2026 y anota +6 pts (53,0 → 59,1 medidos)"*, `scripts/amfoot-fit.js:32-33`). Si
algún equipo tiene menos de 6 partidos, `muTotal = base` a secas.

**Incertidumbre epistémica en puntos:**

```
NFL:    unc_pts = 4.2 / √(1 + gc)                                   (store.js:71)
amfoot: unc_pts = (sigma_margin / 3.7) / √(1 + gc)                  (store.js:324)
        → NCAAF 4.66/√(1+gc) · CFL 3.63/√(1+gc)
gc = min(partidos de ESTA temporada de los dos equipos); si el partido es de una temporada que aún no
     empezó, gc = 0 aunque el rating traiga 17 partidos del año anterior (nfl:70, amfoot:322)
```

### 4.5 Qué NO entra

Ninguna cuota entra en la probabilidad. El comentario es explícito: *"Ninguna función de probabilidad lee
una cuota… El 'edge' se mide DESPUÉS, comparando la distribución con el precio — jamás al revés"*
(`nfl-engine/store.js:7-9`). Tampoco entran: lesiones (se enseñan, no se consumen, `:807`), clima
(display, `:217`), prensa (dossier del redactor), árbitro, superficie ni descanso — `rest_home/rest_away`
solo alimentan el texto de "lo que importa" (`:308-309`).

**Matiz que el auditor debe ver:** el *centro* es market-blind, pero la *dispersión* no lo es del todo. El
pool de residuos es `(resultado − cierre)` y el atlas se indexa por la **línea de cierre** del partido
histórico (`scripts/nfl-fit.js:96-126`). El código lo declara: *"Se condiciona a NUESTRA media, nunca a la
línea de HOY: el atlas solo aporta la FORMA de los marcadores alrededor de un nivel de favoritismo"*
(`nfl-engine/simulate.js:56-57`). Es defendible, pero la calibración de la varianza está anclada a una
magnitud de mercado.

---

## 5) De la media a la distribución: el simulador conjunto

`nfl-engine/simulate.js` genera la conjunta **(margen, total)** con dos caminos:

### 5.1 El atlas (camino preferente, requiere muestra)

```
si outcome_atlas.length ≥ 900                                          (simulate.js:101)
   K vecinos = clip(round(atlas.length/22), 60, 300)                   (:103)
   por cada uno de los n sorteos:
     lineM = muMargin + N(0, kM) ;  lineT = muTotal + N(0, kT)
        kM/kT = sigma_extra_*        si marginalize = true
        kM/kT = ATLAS_SMOOTH = 1.8   si marginalize = false y smooth = null   (:61-63, :132-133)
     banda  = los K partidos históricos con la línea de hándicap más cercana a lineM (bisección, :72-84)
     filtro = de esa banda, los que tengan |total_close − lineT| ≤ TOTAL_TOL (7), con hasta 3 pasadas
              duplicando la tolerancia hasta juntar ≥24 candidatos                 (:155-166)
     se sortea UNO UNIFORME de esos candidatos y se copia su (margen real, total real) TAL CUAL  (:168-169)
```

El fichero documenta dos errores corregidos el mismo día en que se introdujo, y son los que explican el
diseño: (a) coger *"el más parecido de 12 candidatos"* colapsaba la muestra y daba una sd del margen de
**5,75 pts cuando la real de la NFL es 13,3** — *"Un simulador que se cree la mitad de disperso de lo que
es el deporte da probabilidades demasiado seguras"* (`:140-145`); (b) reintentar hasta aceptar tampoco
vale, porque *"los pocos partidos con el total más parecido se llevan casi todas las muestras"* y la
dispersión se quedaba en 9,75 (`:149-153`).

Por qué el atlas en vez de sumar residuos, con números medidos (`:45-49` y `scripts/nfl-fit.js:104-120`):
el margen real cae en |3| el **14,70 %** de las veces y en |7| el **8,48 %**, contra ~4,6 % en 1, 2 o 4;
sumando residuos el simulador daba **6,2 % en el 3 y 6,5 % en el 1** — casi plano justo donde vive toda
línea de hándicap — y *"la probabilidad de empuje en la línea 3 salía ~6 % contra el 9-10 % real, y la
compuerta de empuje (<6 %) dejaba pasar exactamente lo que debía frenar"*.

El suavizado de 1,8 pts está justificado con medición: la ventana de K partidos trae *"~1,1 puntos de ruido
en su media realizada (K=126, sd 12,3)"*, y la regresión global de resultado sobre línea da **pendiente
1,03 e intercepto 0,04**, o sea que *"la línea es insesgada y no hay nada que invertir"* (`:117-128`).

### 5.2 El camino viejo (CFL)

Con atlas < 900 filas —**es el caso de la CFL, 249**— se cae al pool:

```
m = round(muMargin + residuo[0] + ruido_discreto(sigma_extra_margin))
t = max(2, round(muTotal + residuo[1] + ruido_discreto(sigma_extra_total)))     (:170-174)
```
con el par de residuos tomado del mismo partido histórico, lo que conserva la correlación margen-total.

### 5.3 Salidas

`n = 20.000` sorteos por partido en la ficha (`nfl:74`; en amfoot `light:true` baja a 4.000 para el
listado, `:328`), semilla determinista derivada del id del partido (`nfl:73`, `amfoot:325`) — *"la misma
entrada reproduce la misma distribución, y una auditoría puede repetir el cálculo"* (`simulate.js:16-17`).
Devuelve `p_home`, cuartiles de margen y total, `key_mass` en 3/6/7/10/14, histogramas, y dos CDFs
cerradas sobre la muestra: `coverProb(line)` y `overProb(line)`, ambas con su probabilidad de **empuje**
(`:183-192`). De ahí salen las escaleras de líneas alternativas de la ficha (±9 pts de hándicap y ±12 de
total, paso 0,5: `nfl:330-347`, `amfoot:832-835`).

### 5.4 La posterior (`nfl-engine/posterior.js`)

Es la pieza que decide. No se decide con la probabilidad puntual sino con una **posterior sobre la
probabilidad**:

```
sigma_epistémico = √(sigma_extra² + unc_pts²)                                (posterior.js:59-62)
abanico  = K = 240 simulaciones, cada una con el centro desplazado N(0,sigma),
           nPer = 800 sorteos por centro, semilla 991 + k·7919                (:72-83)
por cada línea/lado:  p_k = coverProb/overProb del centro k (invertida si el lado es away/under)
                      ev_k = (1−push)·[p_k·(cuota−1) − (1−p_k)]
salida: p_mean, p_p05, p_p95, edge_pp, P(ventaja>0) = #{p_k > 1/cuota}/K, ev_mean, ev_p05, ev_p25 (:88-119)
```

La elección de K está medida, no a ojo: *"contra una marginal de referencia de 50,94 %, K=48 da 47,06 %,
K=120 da 50,21 %, K=240 da 50,70 % y K=400 da 51,32 %"* (`:68-71`). El abanico se calcula **una vez por
partido** (~0,8-1,1 s) y de él se leen todas las líneas y familias (`nfl:80-85`).

Dos honestidades declaradas en el propio archivo: sumar en cuadratura `sigma_extra` y `unc_pts` es
*"LEVEMENTE CONSERVADOR… algo se cuenta dos veces. Se acepta a propósito: el error va en la dirección de
publicar MENOS"* (`:55-58`); y **la posterior no arregla la calibración**: *"Si el modelo dice 59 % y pasa
el 49 %, la posterior estará centrada en el sitio equivocado y P(ventaja>0) saldrá alta y falsa"*
(`:29-32`). La capa isotónica que lo corregiría **no existe todavía** — *"va después"*.

---

## 6) Del modelo a la pick (sombra)

### 6.1 Qué se evalúa

Por partido (`nfl:367-418`, `amfoot:459-494`): SPREAD (dos lados), TOTAL (dos lados) y MONEYLINE (dos
lados), siempre sobre la **línea de consenso** = mediana de líneas entre casas (`nfl:147`, `amfoot:439`),
con el **mejor precio ejecutable por lado** (`nfl:153-164`, `amfoot:443-454`). El moneyline se cotiza como
`coverProb(0)` — ganar = cubrir la línea 0, con el empate como push (`nfl:404`).

El devig es solo para el *consenso informativo*: `novig2(pa,pb) = (1/pa)/((1/pa)+(1/pb))`, proporcional a
dos vías (`nfl:144`, `amfoot:436`). **La compuerta no usa devig**: compara `p_model` contra
`p_implied = 1/cuota` cruda (`nfl:369`, `amfoot:467`), lo que hace el listón *más* exigente.

### 6.2 Las compuertas

```
si hay abanico (NFL siempre, NCAAF siempre; CFL nunca — sin atlas no hay fan, amfoot:337):
   existe_ventaja : P(ventaja>0) ≥ 0.75
   ev_esperado    : EV medio     ≥ 0.02
   peor_caso      : EV p05       ≥ −0.35   (guardia de catástrofe, "no gobierna, solo avisa")
si NO hay abanico (CFL):
   noise : edge_pp > unc_pp
   edge  : edge_pp ≥ 3 pp
siempre:
   orthogonality : pass = true (declarativo)
   push          : P(empuje) < 6 %
verdict = SHADOW_PICK si TODAS pasan; si no NO_PICK con el motivo de la primera que falla
```
(`posterior.js:136`, `nfl:419-469`, `amfoot:495-527`).

`unc_pp` no se convierte con una pendiente fija: se lee de la propia distribución evaluando la CDF en
`line ± unc_pts` y tomando la mitad de la diferencia (`nfl:423-431`) — *"un punto vale mucho más cruzando
el 3 —donde cae el 14,7 % de los partidos— que moviendo −8 a −9"*. Y el efecto del cambio está cuantificado:
*"una ventaja nominal de 9 pp a cuota 2,40 solo tiene P(ventaja>0) = 75 %, y con las reglas viejas habría
salido como pick sin más. Ahora hay que llegar a 93 %"* (`nfl:438-439`).

Los cortes están **declarados, no ajustados sobre el holdout** — *"ajustarlos ahí sería elegir el umbral
que mejor queda en la única muestra que no debe tocarse"* (`posterior.js:128-130`).

### 6.3 Registro

`recordShadow()` (`nfl:474-508`, `amfoot:536-608`): ventana de **6 días** antes del saque, dedup por clave
`game|familia|lado|línea` (NFL) o `fecha|local|visita|familia|lado|línea` (amfoot). Cada fila guarda
`odds, book, p_model, p_implied, edge_pp, model_version, seed, unc_pts, kickoff, regime:'shadow'` y —si la
familia se abrió con prior en contra— el texto del prior **dentro de la fila**, porque *"la revisión tiene
que poder separar las que entraron con historia mala de las que entraron limpias"* (`nfl:501-502`).
En amfoot se añade `cb` = la cotización de Cloudbet para esa tesis, en la línea exacta si está en su
escalera y si no la principal marcada `misma_linea:false` (`amfoot:596`, `cloudbet.js:170-194`).

**No hay stake, ni Kelly, ni bankroll**: esto no es un ejecutor, es un registro. No hay filtro de liga, ni
banda de eficiencia, ni cuota mínima/máxima, ni caducidad más allá de la ventana de 6 días.

`recordShadow` de amfoot devuelve además un **diagnóstico completo de los descartes** (`eventos,
sin_nombre, fuera_de_ventana, sin_partido_propio, sin_modelo, sin_mercado, candidatas, no_shadow_pick,
ya_estaba`, con ejemplos), añadido porque *"College llevaba días con catorce partidos en la agenda,
veintidós casas cotizando y CERO picks en sombra… Son tres problemas distintos con tres arreglos distintos,
y sin contarlos hay que adivinar"* (`:530-535`).

### 6.4 Resolución de identidad (amfoot)

`resolveOddsName()` (`:138-147`): normaliza (minúsculas, sin acentos ni puntuación, apóstrofes pegados),
busca en un mapa de escuela y escuela+mascota, aplica 33 alias manuales (`NCAAF_ALIAS`, `:73-104`:
`'southern california'→USC`, `'mississippi'→Ole Miss`, `'miami oh'→Miami (OH)`…) y, si falla, casa por
prefijo **con la coincidencia más larga y solo en frontera de palabra** — *"si no, 'Ohio' se comería 'Ohio
State'"* (`:144`).

---

## 7) Liquidación

| | NFL | NCAAF / CFL |
|---|---|---|
| Disparo | kickoff + 3,2 h (`nfl:512`) | kickoff + 4 h (`amfoot:612`) |
| Fuente | ESPN scoreboard por `dates=YYYYMMDD`, cruzado por `espn` id, exige `status.type.name` = final (`nfl:522-529`) | overlay propio refrescado con `force` antes de liquidar (`amfoot:614`): CFBD / scoreboard CFL |
| SPREAD | `margin > line` gana; `== line` PUSH | idéntico (`amfoot:627`) |
| TOTAL | `total > line` gana; `== line` PUSH | idéntico (`:628`) |
| MONEYLINE | **no se liquida** (ver abajo) | **no se liquida** |
| Unidades | `+(cuota−1)` / `−1` / `0` en push | ídem |
| VOID | **no existe**: una pick sin resultado queda `OPEN` para siempre | `VOID` con motivo a los 7 días (*"partido movido/cancelado: VOID con motivo, no eternamente abierto"*, `:622`) |

**🔴 Hallazgo grave.** En los dos motores, `settleShadow` inicializa `win = null` y solo lo calcula para
`SPREAD` y `TOTAL` (`nfl-engine/store.js:534-535`, `amfoot-engine/store.js:627-628`). Cualquier pick de
`MONEYLINE` cae al `win == null` y se marca **`PUSH` con 0 unidades**. Es decir: la familia que se reabrió
el 19-ago con el argumento explícito de que *"cerrar la familia tenía un coste que no se estaba contando:
garantiza que jamás haya medición propia de NFL"* (`nfl:397-400`) **tampoco puede producir medición**, por
un hueco en el liquidador. Toda pick de ganador registrada desde entonces entra en el track como push,
diluye el `hit_pct` (cuyo denominador incluye pushes, `nfl:585`) y aporta 0 al ROI.

---

## 8) Medición

### 8.1 CLV

**NFL** (`nfl:540-546`): `clv_pct = (odds_de_la_pick / precio_de_cierre − 1)·100`, donde el cierre es la
**mediana** de precios entre casas guardada en el último snapshot previo al saque (`snapshotCloses`,
`:170-192`; la ventana es "cualquier evento que no haya empezado hace más de 1 h", y cada pasada de 30 min
sobrescribe). El cierre se localiza **buscando por nombre de equipo, sin comprobar la fecha**
(`:541`) — riesgo de cruzar el cierre de otro enfrentamiento del mismo par en otra temporada.

**NCAAF/CFL**: desde el 7-sep se guardan **tres** medidas, y el motivo está escrito:

```js
// amfoot-engine/store.js:377-380
// EL CIERRE POR CASA (7-sep). El cierre que había era la MEDIANA de precios de todas las casas en la
// línea de consenso, y el CLV comparaba contra eso el MEJOR precio de 26 casas: por construcción sale
// positivo (+6 % en spreads de College con ROI negativo). Un CLV honesto compara la pick con el cierre
// de SU casa en SU línea.
```
- `clv_pct` — el viejo (mejor precio vs mediana del cierre). **Inflado por construcción.**
- `clv_libro_pct` — mismo libro, **misma línea**, usando la escalera si hace falta; si no se puede, se
  anota el motivo en `clv_libro_falta` (`:640-650`).
- `clv_cb_pct` y `units_cb` — el CLV y el resultado que habría tenido la apuesta **colocada en Cloudbet**,
  solo cuando la línea coincidía (`:654-657`).

**El motor de NFL no recibió ese arreglo**: `snapshotCloses` de NFL no guarda `books` (`nfl:183-188`), así
que la única medida de NFL sigue siendo la inflada.

### 8.2 Track

`track()` (`nfl:555-606`, `amfoot:665-735`) devuelve, por familia y **por familia × casa**: `n`,
`hit_pct`, `units`, `roi_pct`, `clv_avg_pct`, `clv_n` y `clv_sd`. El desglose por casa se añadió con una
razón medida: *"en CS2 el hándicap de rondas daba +2,44 % de media y, partido por casa, era +3,53 % en la
afilada y −3,13 % en la única que podemos ejecutar por API. Un promedio así no informa, desinforma"*
(`nfl:563-566`). Y la sd viaja al lado de la media porque *"+0,5 % sobre 30 picks con sd 8 es ruido y sobre
300 con sd 2 es ventaja"* (`nfl:587-588`).

Guardia de lectura incluida en el DTO: con menos de 40 liquidadas, `reading` dice *"con N liquidadas TODO
es ruido: esta pantalla existe para acumular el registro, no para leerlo todavía"* (`nfl:604`).

### 8.3 El tablero de ventaja y el estadístico t

`edge-board.js` agrega las ocho disciplinas con **una sola vara**. NFL entra por `deByFamily('nfl', …)`
(`:193`) y las dos ligas de amfoot por el bucle de `AF.LEAGUES` (`:194-199`); `college` y `nfl` son dos de
las diez familias del objetivo declarado (`:30-31`).

```js
// edge-board.js:65-66
const t   = clv / (clvSd / Math.sqrt(clvN));
const nT2 = clv !== 0 ? Math.ceil((2 * clvSd / clv) ** 2) : null;
```

Estados: `CONFIRMADA` (t ≥ 2 y CLV > 0), `PROMETE` (1 ≤ t < 2), `PLANA`, `EN_CONTRA` (t ≤ −1),
`DESCARTAR` (t ≤ −2 con ≥100 liquidadas), más `SIN_MUESTRA` (<30), `SIN_CLV` y `SIN_MOVIMIENTO`
(`clv_sd < 0,5 pp`: *"no hay movimiento contra el que medirse… un libro quieto"*, `:57-64`).

---

## 9) ⚠️ Por qué NCAAF y CFL encabezan el tablero de ventaja y aun así están cerradas

Esta es la pregunta central del encargo, y la respuesta es que **ese `t` no mide lo que parece medir**, y
que **aunque lo midiera, en este código no existe la palanca que abriría la familia**. Cinco razones,
todas verificables en el código:

**(1) El `t` mide el CLV inflado por construcción, no ventaja.** El numerador es `clv_avg_pct` del track
de amfoot (`amfoot:700-703`), que compara el **mejor precio entre ~26 casas** en el momento de la pick
contra la **mediana de todas las casas** al cierre. Tomar siempre el extremo de una distribución y
compararlo con su centro da un número positivo aunque no haya ninguna ventaja. El propio repo lo dice con
el caso concreto: *"comparaba el MEJOR precio de 26 casas con la MEDIANA del cierre (por eso spreads daba
+6 % de CLV con ROI −9 %)"* (`TODO_NEXT.md:275-278`), y remata: *"La familia NO está confirmada hasta que
`clv_libro` lo diga con muestra nueva"*.

**(2) El denominador está minúsculo, y eso multiplica el t.** El sesgo del punto (1) es casi **constante**
entre picks (siempre mejor-precio vs mediana), así que aporta media sin aportar dispersión: `clv_sd` se
queda pequeña y `t = media/(sd/√n)` explota con n grande. Un t de 38 con n de varios cientos implica una
relación señal/ruido que ningún mercado de apuestas produce; es la firma aritmética de un sesgo
sistemático, no de una ventaja. La guardia `SIN_MOVIMIENTO` de `edge-board.js:60-64` existe justo para
este patrón, pero solo salta por debajo de 0,5 pp de sd, y aquí el sesgo es grande y la sd, sin serlo,
queda dominada por él.

**(3) Hay una segunda fuente de inflación aguas arriba: la línea y el precio no son del mismo sitio.** En
`evaluateEdges` la línea evaluada es la **de consenso** (mediana) y el precio es el **mejor de cualquier
casa** — pero `best()` devuelve la fila entera de esa casa, con **su propia línea**
(`nfl:153-158`, `amfoot:443-454`), y esa línea se descarta. Se calcula entonces
`p_model = coverProb(línea_consenso)` y se le enfrenta `p_implied = 1/precio_de_otra_línea`. Como el mejor
precio de un lado suele venir de la casa que ofrece la línea **menos favorable** para ese lado, la pareja
(probabilidad de la línea buena, precio de la línea mala) **sobreestima sistemáticamente la ventaja**. Esa
misma pareja se registra en la pick y se liquida contra la línea de consenso, así que el sesgo entra en el
edge, en el CLV y en el track. No encontrado en el código ningún filtro que exija que el precio y la línea
provengan de la misma casa (Cloudbet es la excepción: `quoteFor` sí busca la línea exacta,
`cloudbet.js:176-187`).

**(4) Lo único medido fuera de muestra contra el cierre dice lo contrario.** El backtest walk-forward al
cierre, que es *"la prueba ácida del blueprint: solo una familia que gane AQUÍ fuera de muestra merecería
salir de la sombra"* (`scripts/nfl-fit.js:170-174`), da para College **−5,63 / −5,33 / −6,35 / −7,54 % de
ROI** en SPREAD y como máximo **+1,04 %** en TOTAL con umbral 6 (n 2.199), y para la CFL cifras positivas
solo en muestras de **43 y 26** apuestas. Y el MAE del modelo pierde contra el cierre en las dos ligas
(13,59 vs 12,34 en College; 10,55 vs 9,88 en la CFL), igual que en NFL. Un t alto de CLV conviviendo con
un ROI negativo al cierre es exactamente el síntoma que el punto (1) predice.

**(5) Aunque todo lo anterior fuera limpio, el código no tiene interruptor para abrir la familia.** El
estado `shadow` está **hardcodeado** en el model card de los dos motores (`nfl:683-688`,
`amfoot:996-1000`); `recordShadow` escribe siempre `regime: 'shadow'` en disco privado (`nfl:499`,
`amfoot:589`); las rutas enteras están tras `GP_NFL_PUBLIC_ENABLED` y, dentro, el registro en sombra
requiere plan pro (`server.js:21278`, `21315`, `21364`); y ninguna de estas picks toca `db.dailyPicks` ni
`db.clubDailyPicks`, que son las listas que alimentan el producto público. **Subir una familia de estado
es un cambio de código, deliberadamente**: *"solo la evidencia fuera de muestra puede subir una familia de
estado (blueprint NFL-1125)"* (`nfl:38`).

**Dónde queda registrada la duda con fecha:** `TODO_NEXT.md:266-278` fija la lectura pendiente —
*"si `cloudbet.roi_pct` y `clv_avg_pct` de TOTAL siguen positivos con n ≥ 40, se puede colocar por API; si
no, seguir manual en otra casa"*. Es decir: la decisión está condicionada al CLV **contra la casa donde se
puede ejecutar**, no al t del tablero.

**Nota de coherencia documental:** `CLAUDE.md` afirma *"el moneyline cerrado por doctrina"* y las cadenas
`doctrine` de NCAAF y CFL terminan con *"Moneyline cerrado por doctrina."* (`amfoot:54`, `:60`), pero el
código **lo reabrió en sombra el 19-ago** (`nfl:392-412`, `amfoot:479-491`) con prior en contra declarado
(*"pérdidas medidas en el ganador en baloncesto (−11,87 % de ROI) y en combate (−8,34 % de CLV), y el
Brier de este modelo (0.224) es peor que el del cierre (0.210)"*). Las dos frases conviven en el mismo
archivo. Y, como dice §7, esas picks se liquidan siempre como PUSH.

---

## 10) Jobs, cadencias y presupuesto de llamadas

| Job | Dónde | Cadencia | Qué hace |
|---|---|---|---|
| `nflChain` | `server.js:13328-13345` | +380 s del arranque, luego **cada 30 min** | si hay partido a ≤9 días (`Math.abs(fecha−ahora) < 9 días`): `refreshOdds(force)` → `recordShadow` → `settleShadow` |
| `amfootChain` | `server.js:13349-13367` | +420 s, luego **cada 30 min** | **en serie** por liga: `refreshResults` → (si hay partido a ≤9 días) `refreshOdds(force)` → `recordShadow` → `settleShadow` |
| `nflHarvestJob` | `server.js:594-606` | +12 min, reintento cada hora, **una vez al día** | `scripts/nfl-harvest.js --out=disk` en proceso aparte (`heapMb:380`, 30 min de tope) |
| `amfootRostersJob` | `server.js:614-683` | +12 min y cada 6 h | plantillas de College desde ESPN; **la CFL quedó fuera del job** (31-ago) porque su plantilla buena viaja en el repo y una cosecha pobre la pisaría (`:661-664`) |
| lecturas LLM | `server.js:13654+` | pasada de fondo con cuota por deporte | `nflGameRead` / `amfootGameRead` |

La ventana de ≤9 días existe porque *"fuera de temporada la liga duerme y gastar créditos de The Odds API
en dormir es tirarlos"* (`server.js:13324-13326`). Coste: **3 llamadas a The Odds API cada 30 min** (nfl +
ncaaf + cfl) más, en amfoot, `1 + nº de eventos` llamadas a Cloudbet cada 25 min.

Las guardias de memoria del job de plantillas merecen mención porque documentan un incidente:
*"lo que tumbó la plataforma el 15-ago fueron exactamente trabajos de fondo concurrentes… La plataforma
está EN VIVO durante el Mundial: una cosecha de plantillas no vale un minuto de caída"* (`:617-620`), y el
contador de frenos se guarda **en disco** porque en memoria *"cualquier deploy devolvía los frenos a cero
y el escape no llegaba a dispararse nunca"* (`:640-644`).

---

## 11) Parámetros y variables de entorno

| Variable | Default | Efecto |
|---|---|---|
| `GP_NFL_PUBLIC_ENABLED` | sin poner | abre `/api/nfl/*` **y** `/api/amfoot/*` al público; sin ella, solo admin (`server.js:21273`, `21359`) |
| `GP_NFL_JOBS_ENABLED` | `true` | `=false` apaga las dos cadenas (NFL y amfoot) (`server.js:13327`) |
| `GP_NFL_HARVEST` | `1` | `0/false/no/off` apaga la cosecha diaria de nflverse (`server.js:593`) |
| `GP_NFL_OUT` | — | `disk` hace que `nfl-harvest` escriba en `<disco>/nfl-agg` (`scripts/nfl-harvest.js:38`) |
| `GP_AMF_ROSTERS` | sin poner (off) | `1` enciende la cosecha de plantillas de College (`server.js:616`) |
| `GP_AMFOOT_CLOUDBET` | `true` | `0/false/no/off` saca a Cloudbet de la fusión (`cloudbet.js:45`) |
| `SPORTSBOOK_PROVIDER_API_KEY` | — | The Odds API; sin ella no hay mercado ni cierres |
| `CFBD_API_KEY` | — | CollegeFootballData; sin ella no se refrescan los resultados de College |
| `CLOUDBET_API_KEY` | — | cotización y escalera de Cloudbet |
| `GP_EXPORT_KEY` | — | abre `/api/internal/nfl`, `/api/internal/edge-board` |
| `DB_FILE` | `./db.json` | su **directorio** define dónde viven `nfl/`, `nfl-agg/`, `nfl-raw/`, `amfoot/` |
| `GP_LLM_READS_CAP` | 12 | tope de lecturas por pasada, con cuota por deporte (`server.js:13654-13657`) |

Constantes del modelo que **no** son env vars: `CAP 28`, `halflife 24`, `carry 0.60`, `K 6`
(`nfl-engine/data.js`), `TOTAL_TOL 7`, `ATLAS_SMOOTH 1.8`, umbral de atlas `900`
(`nfl-engine/simulate.js`), `K 240 / nPer 800 / seed 991`, `min_p_edge 0.75`, `min_ev 0.02`,
`min_ev_p05 −0.35` (`nfl-engine/posterior.js`), push `<6 %`, ventana de registro `6 días`, TTL de cuotas
`30 min`.

**Sondas:** `/api/internal/nfl?key=` responde por las **tres** ligas en un solo curl (slate, ficha, model
card, track y `amfoot:<liga>`); `&rec=1` ejecuta el registro en sombra y devuelve su diagnóstico;
`&cbprobe=ncaaf[&dump=1]` enseña lo que Cloudbet cotiza y cuántos eventos casan con The Odds API
(`server.js:21490-21544`). `/api/internal/edge-board?key=` da el tablero de familias
(`server.js:22496-22503`).

---

## 12) Debilidades, supuestos y riesgos detectados en el código

**Graves**

1. **El moneyline nunca se liquida** (`nfl:534-535`, `amfoot:627-628`): cae al `win==null` → PUSH, 0
   unidades. La familia reabierta para "tener muestra propia" no puede generarla. *(§7)*
2. **Línea de consenso emparejada con precio de otra casa/otra línea** (`nfl:153-158+371-390`,
   `amfoot:443-454+461-478`): sesgo sistemático al alza en `edge_pp`, en el CLV y en el track. *(§9.3)*
3. **CLV de NFL inflado por construcción** (mejor precio vs mediana del cierre) y **sin** el arreglo por
   casa/línea que amfoot recibió el 7-sep (`nfl:170-192` no guarda `books`).
4. **Cierre localizado por nombre sin comprobar fecha** en NFL (`nfl:541`): puede casar con el cierre de
   otro cruce del mismo par en otra temporada, ya que `closes.json` es acumulativo.
5. **Picks de NFL sin caducidad**: `settleShadow` no tiene el VOID a 7 días que sí tiene amfoot
   (`amfoot:622`). Una pick sin resultado en ESPN queda `OPEN` indefinidamente e infla `open`.

**De método**

6. **Selección de hiperparámetros dentro de la muestra de evaluación (amfoot)**: `scripts/amfoot-fit.js:154-161`
   barre `halflife × carry` y se queda con el mínimo MAE **sobre el mismo conjunto** que luego reporta como
   validación walk-forward. Las predicciones son point-in-time, pero la elección de constantes no lo es.
   Además los ganadores están **en el borde de la rejilla**: NCAAF `halflife 20` (máximo de [10,14,20]) y
   `carry 0.5` (máximo de [0.25,0.35,0.5]); CFL `carry 0.45` (mínimo de [0.45,0.55,0.65]) — señal de que el
   óptimo puede caer fuera del barrido.
7. **`sigma_extra` con supuesto inventado cuando faltan cierres**: si `n_close ≤ 50`, se asume que la
   varianza del mercado es el **85 %** de la del modelo (`amfoot-fit.js:206-207`). No aplica hoy (NCAAF
   7.542, CFL 249), pero quedaría activo con cualquier liga nueva.
8. **Calibración sin corregir, admitida por el autor**: *"la posterior mide cuánto NO sabemos; no corrige
   lo que creemos saber mal"* (`posterior.js:29-32`). No hay isotónica. Con el Brier del modelo peor que el
   del cierre en las tres ligas, esto no es teórico.
9. **Dispersión anclada al mercado**: residuos y atlas se construyen contra la línea de cierre
   (`nfl-fit.js:96-126`). El centro es market-blind; la forma, no.
10. **La CFL decide con reglas distintas**: sin atlas (249 < 900) no hay posterior y manda `edge ≥ 3 pp` +
    `edge > unc`, un listón mucho más laxo que `P(ventaja>0) ≥ 75 % + EV ≥ 2 %`. El código lo reconoce:
    *"CFL sigue con las reglas viejas y lo dice, que es más honesto que fingir una posterior sobre una
    distribución que no la soporta"* (`amfoot:332-333`). Consecuencia práctica: **la liga con menos datos
    es la que tiene la compuerta más floja**.
11. **`hit_pct` con pushes en el denominador** (`nfl:585`, `amfoot:702`): con el moneyline liquidando
    siempre PUSH, el acierto por familia queda mecánicamente deprimido.

**De datos y operación**

12. **Husos horarios**: el kickoff se construye como `g.date + 'T' + g.time + ':00Z'` (`nfl:198`, `:484`),
    tratando la hora de `games.csv` como UTC. El primer partido de la base (`2016-09-08 20:30`) fue el
    jueves por la noche en hora del Este, no a las 20:30 UTC. No encontrada en el código ninguna conversión
    de huso. Impacto principal: `weatherFor` pide el pronóstico de **la hora equivocada** (4-5 h antes) y
    las ventanas de registro/liquidación se corren otro tanto.
13. **Roster 2026 sin fuente licenciada**: el equipo y la posición de cada jugador son *"el ÚLTIMO
    visto"* (`nfl-harvest.js:225`); el QB de la ficha es el del último partido jugado en la base
    (`nfl:659-661`). El propio autor apunta a NFL-0069 (feed licenciado) como lo que falta.
14. **Derechos de datos sin resolver**: `meta.json` marca nflverse como *"desarrollo/investigación (revisar
    antes de redistribuir crudo)"*; para NCAAF/CFL no encontrado en el repo un `RIGHTS.md` equivalente a
    los de dardos o LoL. La base de la CFL incluye **Wikipedia** raspada por equipo.
15. **Base de la CFL cosida a mano y con testigo parcial**: 2023-2025 dependen de un parser de Wikipedia
    (254/257 confirmados según `HANDOFF.md:2093`); los cierres anteriores a oct-2022 no existen.
16. **Doble camino de datos NFL (repo vs disco)**: `data.js:24-36` prefiere el disco **fichero a fichero**
    y la caché mira los dos sitios; si la cosecha semanal escribe `games.json` pero falla en
    `team-weeks.json`, el rating y el estado EPA quedan desalineados en el tiempo sin que nada lo señale.
17. **Comentario obsoleto**: `simulate.js:130` habla de *"el abanico de la posterior, que sortea 48 centros
    distintos"* cuando `buildFan` usa **K = 240** (`posterior.js:72`).
18. **`nfl-engine/store.js:239`** conserva una línea muerta con su propia corrección a medias
    (`const gpSpread = … // no: mantenemos margen`), nunca usada.
19. **`OKBUF` es un buffer global de 4.096** compartido por todas las llamadas a `simulate`
    (`simulate.js:65`): hoy es seguro porque el código es síncrono, pero una banda de más de 4.096 vecinos
    lo desbordaría silenciosamente (el máximo actual, K=300, está lejos).
20. **Cloudbet sin resultados propios**: como en esports, la casa no publica liquidación; el emparejamiento
    evento↔evento se hace por nombre resuelto **y** ≤12 h de diferencia en el kickoff (`cloudbet.js:145`),
    heurística razonable pero no verificada contra un identificador común.

---

## 13) Resumen de una línea para el auditor

Tres ligas con base histórica propia y point-in-time real (nflverse 2016-2025, CFBD 2014-2026, CFL cosida
de cuatro fuentes), un simulador conjunto margen/total honesto que copia marcadores reales en vez de
inventar una Normal, una compuerta que decide con una posterior sobre la probabilidad, y una medición que
—salvo en el CLV por casa que amfoot estrenó el 7-sep— **está sesgada al alza por dos construcciones
concretas** (mejor-precio vs mediana, y línea de consenso con precio de otra línea). Por eso College y la
CFL encabezan el tablero de ventaja con `t` imposibles mientras el backtest al cierre, que no tiene esos
sesgos, las deja en negativo. El código no las abre porque abrir es un cambio de código y la doctrina
—escrita, fechada y repetida en cada DTO— exige evidencia fuera de muestra que hoy no existe.

---

# Parte 7 · Tenis, tenis de mesa y dardos

> Los tres deportes "de compilador exacto". Comparten una misma tesis de diseño: **el átomo es el punto (o la
> visita), y todo mercado —ganador, totales, hándicaps, marcador exacto— se COMPILA del mismo estado, de modo
> que dos familias del mismo partido no pueden contradecirse**. Los tres son **market-blind por construcción**
> (ninguna cuota entra a la probabilidad) y los tres tienen **todas las familias en sombra**, con el ganador
> como familia de referencia. La excepción es una sola: **el total de puntos de tenis de mesa en Cloudbet, que
> desde el 9-sep-2026 mueve dinero real a 5 USD planos** — uno de los dos únicos sitios del sistema con dinero
> de verdad (CLAUDE.md §LA REGLA DEL DINERO).

---

## 0. Panorama y doctrina común

| | Tenis | Tenis de mesa | Dardos |
|---|---|---|---|
| Motor | `tennis-engine/` (compiler, data, store) | `tt-engine/` (rules, compiler, data, store) | `darts-engine/` (rules, kernel, compiler, data, modus, store) |
| Átomo | P(sacador gana el punto) | a = P(A gana punto sirviendo A), b = P(A gana punto sirviendo B) | decisión de objetivo + resultado de dardo |
| Base propia | 63.036 partidos ATP+WTA 2015→2026 | 192.460 partidos WTT/ITTF 1992→2026 | 103.908 resultados PDC 2023→2026 |
| Rating | Elo general + Elo por superficie + saque/resto ajustado | Elo de partido (L0) + rating de punto θ (L1) | Elo cronológico + vector de habilidad (media, 180s, dobles) |
| Visibilidad | **admin-only** (`GP_TENNIS_PUBLIC_ENABLED` sin poner) | **público** desde 9-sep (`GP_TT_PUBLIC_ENABLED=0` lo cierra) | **público** desde 9-sep (`GP_DARTS_PUBLIC_ENABLED=0` lo cierra) |
| Dinero real | no | **sí**: `POINTS_TOTAL` en Cloudbet, $5 planos | no |
| Job | `tennisJob` cada 30 min | `ttJob` cada 10 min | `dartsJob` cada 10 min |
| Cola de base | `tennisTailJob` diario (ESPN) | `ttTailJob` diario (ITTF/WTT) | `dartsTailJob` diario (PDC + Orakel) |

Los tres declaran la misma doctrina en texto servido por API. Tenis: *"todas las familias de tenis están EN
SOMBRA… El ganador se registra como familia de referencia (benchmark de calidad), jamás como pick"*
(`tennis-engine/store.js:20`). Tenis de mesa: idéntico más *"Solo competiciones VERIFICADAS (WTT/ITTF); las
ligas privadas de apuestas se enseñan con aviso y nunca se modelan"* (`tt-engine/store.js:35`). Dardos:
`darts-engine/store.js:34`.

---

## 1. TENIS (ATP + WTA)

### 1.1 Propósito y alcance

Terminal admin-only de tenis: agenda, tablero de mercado, ficha de partido con el duelo saque/resto,
simulador, catálogo de jugadores y **registro en sombra**. Tres familias:

| Familia | Estado | Fuente de la probabilidad |
|---|---|---|
| `ML` (ganador) | **referencia/benchmark, jamás pick** (`store.js:401`, `1270`) | ensamble Elo mixto + compilado |
| `TOTAL` (juegos del partido) | sombra | PMF de juegos (C6 o desplazamiento) |
| `SPREAD` (hándicap de juegos) | sombra | PMF del margen del compilador |

El universo son los torneos que The Odds API publica con clave `tennis_atp_*` / `tennis_wta_*` activa. La
superficie se deduce por expresión regular sobre la clave (`SURF_BY_KEY`, `store.js:33-37`: arcilla para
French Open/Montecarlo/Madrid/Roma/Barcelona/Múnich/Hamburgo/Charleston/Estrasburgo/Stuttgart, hierba para
Wimbledon/Halle/Queens/Bad Homburg/German Open, **el resto dura por defecto**). Formato bo5 solo en los
cuatro Grand Slams masculinos (`bo5Keys`, `store.js:38`).

**Derechos (`data/tennis/RIGHTS.md`)**: la base deriva del proyecto de Jeff Sackmann, **CC BY-NC-SA 4.0**,
clase `research_attribution_noncommercial`. Consecuencia dura escrita: *"tenis queda admin-only
(`GP_TENNIS_PUBLIC_ENABLED` sin poner), las familias van TODAS en sombra y ningún pick de tenis se publica a
usuarios. Antes de abrir tenis al público o cobrar por él, esta base se reemplaza por una fuente licenciada"*.

### 1.2 Fuentes de datos

1. **The Odds API** (`SPORTSBOOK_PROVIDER_API_KEY`) — lado mercado. Descubrimiento dinámico de torneos
   activos: `GET /v4/sports/?apiKey=&all=true`, filtrado `active && /^tennis_(atp|wta)_/`, cacheado 12 h en
   memoria **y en disco** (`sports-cache.json`), `SPORTS_TTL = 12*3600e3` (`store.js:42-58`). Después una
   llamada por torneo: `/v4/sports/{key}/odds?regions=eu,us&markets=h2h,totals,spreads&oddsFormat=decimal`,
   TTL 30 min (`ODDS_TTL`, `store.js:60-78`). Timeout 20 s. Los créditos restantes se leen de la cabecera
   `x-requests-remaining`. Si la llamada de descubrimiento falla, se devuelve la caché anterior; si falla la
   de un torneo, ese torneo simplemente no aparece (catch vacío, `store.js:73`).
2. **ESPN** (`site.api.espn.com/apis/site/v2/sports/tennis/{atp|wta}/scoreboard?dates=YYYYMMDD`) — agenda del
   día y **liquidación**. Caché 10 min por (tour, día). **User-agent medido**: `curl/8.5.0`, porque ESPN
   devuelve 403 al UA por defecto de Node, a uno de navegador y a uno propio (`store.js:633-636`); sin esto
   *"el liquidador de tenis se quedó ciego (334 picks vencidas con sin_fuente)"*.
3. **Espejo archivístico de Sackmann** (`Aneeshers/tennis-sackmann-archive`) — base histórica, vía
   `scripts/tennis-harvest.js`. Los repos originales fueron **retirados de GitHub** (comprobado 18-ago-2026);
   el espejo es una **instantánea**, no un flujo.

### 1.3 Base histórica, cosecha y costura

- `scripts/tennis-harvest.js` baja los CSV anuales 2015–2026 + catálogos a `GP_TEN_DIR` (`/data/tennis-raw`),
  escritura atómica, `state.json` de completitud, 6 reintentos con esperas de 30-120 s, idempotente salvo el
  año en curso.
- `scripts/tennis-aggregate.js` los compacta a `data/tennis/matches.json` (array de arrays + `SCHEMA` de 36
  columnas con estadística de saque de los dos jugadores). **W/O y DEF se excluyen; RET se conserva con
  `ret=1`** (cuenta para Elo, no para stats de saque).
- **Estado actual (`data/tennis/meta.json`)**: 63.036 filas, 2.632 jugadores, 1.846 torneos, ventana
  2015-2026, `last_match_date` = 20260820 (ATP y WTA).
- **La costura, declarada en producto** (`store.js:1253-1263`): la base son *"dos cosas pegadas"* — una
  **espina** con saque/resto/break points hasta **20260525** y una **cola diaria de ESPN** desde 20260526
  (1.614 filas) que trae ganador, sets y juegos y **nada de saque**. Por tanto: *"el Elo se actualiza entero
  con la cola; los índices de saque y resto se quedan congelados donde acabó la espina"*.
- Cola: `scripts/tennis-espn-tail.js --apply --paso=2`, lanzada por `tennisTailJob` **en proceso aparte**
  (`server.js:1006-1038`), con freno de memoria (`opsMemOk('tennis_tail', 200)`), timeout 25 min, y
  reconstrucción del estado **solo si se escribió algo** (`/escrito en/` en la salida).

### 1.4 Rating: fórmulas y constantes

`tennis-engine/data.js:33-106` reproduce todo el historial en orden cronológico:

```
K(n) = kScale · 250 / (n + 5)^0.4                       (estilo 538)
Elo general:    e' = e ± K(n)·(1 − pGen),  pGen = 1/(1+10^(−Δe/400))
Elo superficie: igual, con su propio tablero por superficie (dura, arcilla, hierba, moqueta)
Saque/resto (EWMA con α = ln2 / halfLife, halfLife en PARTIDOS):
   spw = (1stWon + 2ndWon)/svpt  (solo si svpt > 30 en los dos)
   tourSpw = media móvil del circuito (arranque 0,63 ATP / 0,57 WTA, tope de peso 4.000)
   srv[A] ← spw_A − tourSpw + dev(ret, B)     ret[A] ← tourSpw + dev(srv, B) − spw_B
   dev(m, id) = (v/w)·(w/(w+shrinkK))  si w ≥ 3, si no 0
```

Probabilidad del duelo (`data.js:109-120`):

```
pMix = σ( (1−surfW)·logit(pGen) + surfW·logit(pSurf) )
paSrv = clamp(tourSpw + dev(srv,A) − dev(ret,B), 0.45, 0.80)      (ídem pbSrv)
```

**Constantes congeladas** (`data/tennis/model-priors.json`, `model_version: "tennis-sr-1"`, `dev_end`
20250101). Nota: los defaults del código (`data.js:46`) son otros y **solo actúan si faltan los priors**.

| Constante | ATP | WTA | Papel |
|---|---|---|---|
| `kScale` | 0,8 | 0,8 | escala de K |
| `surfW` | **0,45** | **0,30** | peso del Elo de superficie en el logit |
| `halfLife` | 30 | 30 | semivida del EWMA de saque/resto (partidos) |
| `shrinkK` | 15 | 15 | contracción de la desviación de saque/resto |
| `shock` | **0,11** | **0** | choque de ejecución en el hold (§1.5) |
| `ensembleU` | **0,45** | **0,15** | peso del compilado frente al Elo mixto |
| `tourSpwStart` | 0,63 | 0,57 | arranque del saque medio del circuito |
| `gamesCal.bo3` | [−10,9847; 1,38630] | [3,11673; 0,77900] | calibración lineal de juegos esperados |
| `gamesCal.bo5` | [−18,9238; 1,38245] | [0; 1] (no hay) | ídem bo5 |

### 1.5 El compilador (`tennis-engine/compiler.js`)

Todo cerrado, sin Monte Carlo.

- **Juego**: fórmula cerrada con deuce —
  `gameHold(p) = p⁴(1 + 4q + 10q²) + 20p³q³·(p²/(1−2pq))`, `q = 1−p` (`compiler.js:15-19`).
- **Tiebreak**: DP exacta con la **alternancia real** (1 punto A, luego bloques de 2), memoizada, y cierre
  analítico en 6-6: `P(A|6-6) = pa(1−pb) / [pa(1−pb) + (1−pa)pb]` (`compiler.js:23-40`).
- **Set**: recursión sobre el marcador con poda a 1e-12, TB en 6-6 promediando los dos órdenes de saque
  (`setDist`, `compiler.js:45-76`); devuelve `pA` y la distribución de juegos partida por ganador.
- **Choque de ejecución (T-0374)**: si `shock > 0`, el hold no es `gameHold(p)` sino
  `(gameHold(p+sh) + gameHold(p−sh))/2` — *"el juego se sirve en un estado bueno o malo con igual prob:
  captura la varianza intra-partido que el supuesto IID plancha y que infla los holds"* (`compiler.js:46-50`).
  Activo solo en ATP (0,11).
- **Partido**: DP sobre sets + convolución de los marcadores exactos de set, condicionada a ganador; produce
  `pA`, `pSetA`, `totalGames`, `margin` (gA−gB), `setScores`, `expGames` y `tbAny` (`matchDist`,
  `compiler.js:81-161`).
- **Aproximaciones declaradas en cabecera** (`compiler.js:8-11`): *"puntos IID dentro del partido (la no-IID
  es hipótesis de investigación)"*, *"quién saca primero en cada set se promedia"*, *"el super-tiebreak de
  set final se trata como tiebreak normal"*.
- `matchLite` es una vía rápida cacheada en rejilla de 0,002 en p ("error < 3e-3 en pA") para la validación
  masiva.

Ensamble final (`store.js:254-259`):
`p_base = σ((1−u)·logit(pMix) + u·logit(p_compilado))`, con `u = ensembleU`.

### 1.6 La distribución de juegos con la que se puntúa TOTAL (método C6)

`gamesPmf()` (`store.js:283-303`). El comentario es explícito sobre por qué se cambió: *"La distribución
desplazada … está mal en FORMA: la real es bimodal por número de sets y el desplazamiento predecía over
45,1 % donde ocurría 40,7 %"*.

- `calG = gamesCal[0] + gamesCal[1]·expGames`.
- **C6** (`method: 'c6'`): residuo empírico `R = round(juegos reales − calG)` tabulado por formato × **tercil
  de `expGames` crudo**, medido en desarrollo 2018-01-01 → 2024-12-31 por `scripts/tennis-resid.js`. La masa
  de `calG + R` se reparte entre los dos enteros vecinos y la PMF se renormaliza (la tabla viaja a 6
  decimales).
- **Solo se usa en ATP bo3** (`store.js:288`). La tabla de bo5 y la de WTA se guardan y **no se usan**:
  `used_in_production: ["bo3"]` en ATP, `[]` en WTA (`model-priors.json`).
- Cortes ATP bo3: **24,726 / 25,044**; n por tercil 4.960 / 4.978 / 4.979. WTA bo3: 23,969 / 24,377 (n 5.634
  / 5.639 / 5.638). ATP bo5: 40,112 / 41,119 (n 1.155/1.156/1.156).
- Comprobación en holdout 2025→ transcrita en `docs/impl/tenis-REPORT.md`:

| tour | formato | n | P(real>mediana) shift | P(real>mediana) c6 | ΔBrier abanico | t | ΔBrier línea fija | t |
|---|---|---|---|---|---|---|---|---|
| atp | bo3 | 3.931 | 0,419 | 0,456 | 0,00328 | **5,38** | 0,00527 | **5,56** |
| atp | bo5 | 975 | 0,475 | 0,508 | 0,00082 | 0,61 | 0,00044 | 0,32 |
| wta | bo3 | 4.488 | 0,444 | 0,494 | 0,00056 | 1,03 | 0,00105 | 1,26 |

- **SPREAD sigue con el desplazamiento sobre el margen, no medido** (comentario literal, `store.js:280`).

### 1.7 Ajustes contextuales al ganador (solo ATP)

`ajustesGanador()` / `aplicarAjustes()` (`store.js:189-228`). Dos términos **aditivos en el logit**, sin
intercepto y simétricos, ajustados en desarrollo 2018-2024 y evaluados una vez en holdout 2025→:

```
AJUSTES_ATP = { edad_por_5a: −0.103, dias_log: −0.137, n7: 0.012, dias_tope: 60 }
age_logit      = −0.103 · (edadA − edadB) / 5
calendar_logit = −0.137 · (log1p(díasA) − log1p(díasB)) + 0.012 · (n7A − n7B)
```

- **Edad**: *"el Elo sobreestima a los veteranos… t 5,8; coeficiente negativo y estable los nueve años. SOLO
  ATP: en la WTA empeora (t −1,6 / −2,7) y NO se aplica"* (`store.js:176-178`). Requiere `dob` en los dos
  (2.517 de 2.632 jugadores lo tienen).
- **Calendario**: exige que el último partido de **ambos** venga de la cola ESPN (`prof.lastDate ≥
  meta.tail.from`), porque *"la espina de Sackmann fecha el torneo entero con el día de inicio"*. Si no:
  `calendar: 'sin fecha real'` y no se aplica.
- Se publica en la ficha `what_matters` con los pp que movió cada término, y `p_a_base` viaja junto a `p_a`.

### 1.8 Del modelo a la tesis: puertas, stake, dedup

`gate()` (`store.js:348-378`) y `evaluateEdges()` (`store.js:380-425`):

| Puerta | Regla | Nota |
|---|---|---|
| `edge` | `edge_pp ≥ 3` | listón mínimo, con signo |
| `noise` | `edge_pp > uncPp` | `uncPp = min(10, |p_compilado − p_ensamble|·100 + 2 + lagUncPp)` |
| `orthogonality` | siempre pasa | "market-blind por construcción" |
| `push` | `push_p < 0,06` | |
| `freshness` | ningún jugador con >124 días sin jugar **medidos contra el último partido de la base**, no contra hoy | `store.js:384-398` |
| `base_al_dia` | **informativa**, nunca cierra | publica el retraso de la base |

**El impuesto por base vieja**: `lagUncPp(lag) = min(4, lag/30)` — *"un punto porcentual de incertidumbre
extra por cada 30 días de retraso, con tope de 4. No pretende ser una medición —no hay muestra para medirla—
sino un impuesto honesto y acotado"* (`store.js:323-346`).

- **Precio**: mejor cuota por lado entre todas las casas (`marketOf().best`), en la **línea del consenso**
  (mediana entre casas). Implícita **cruda `1/cuota`, sin devig** (`dec2p`, `store.js:382`) — a diferencia de
  tenis de mesa, que sí hace devig por pares.
- **Stake** (`tenStake`, `store.js:469-475`): Kelly completo `k = (p·b − (1−p))/b`, se publica **¼ de Kelly**
  (`100·k/4`) con tope **2 %**.
- **Dedup**: clave `event_id|family|side|line`; una tesis por clave (`recordShadow`, `store.js:602`).
- **Ventana**: la tesis nace con el partido **por jugarse** y a menos de 6 días (`store.js:599`).
- **Era**: `GP_PICKS_ERA` o `'v2-2026-09-02'`.
- **Preregistro TOTAL** (`docs/PREREGISTRO_TENIS_TOTAL.md`): las TOTAL guardan `edge_pp_at_create` y
  `prereg_total8 = (edge ≥ 8 pp)`. Unidad de cuenta = **evento**, no pick. Vara = **CLV medio contra Pinnacle
  en la línea exacta**; objetivo 60 eventos; *"El ROI se anota pero NO decide"*.

### 1.9 Cierres y CLV

`snapshotCloses()` (`store.js:146-168`): el último snapshot antes del comienzo es el cierre. Guarda, por
evento: consenso ML sin vig, mejores cuotas ML/total/spread, y —desde el 2-sep— **`totals_all` /
`spreads_all` con hasta 12 líneas** (`MAX_LINEAS_CIERRE`), cada una con la mejor cuota por lado + su casa,
**Pinnacle aparte** (`pin_over`/`pin_under`) y, desde el 9-sep, **cada casa con su precio** (`bb`) para el CLV
contra la misma casa. Motivo escrito: *"El cierre guardaba una sola línea… Cuando el mercado se movía medio
juego, la pick se quedaba sin cierre: 9 de 77 TOTAL tenían CLV"* (`store.js:120-124`). Purga a 30 días.

En liquidación se calculan `clv_pct` (mejor cuota de cierre de la línea exacta), `clv_pin_pct` (Pinnacle,
misma línea) y `clv_own_pct` (misma casa donde nació). Si la línea no está cotizada al cierre se anota
`close_missing` y **no se inventa CLV**.

### 1.10 Liquidación (`settleShadow`, `store.js:665-860`)

Fuente: ESPN. Es el liquidador con más cicatrices documentadas del repo:

1. **"Un marcador solo vale si está entero" (2-sep)** — `marcadorCoherente()` exige tantos sets como hacen
   falta, mismo número en los dos y que el que más ganó llegue al número exacto. El comentario cuantifica el
   desastre anterior: *"ESPN marca STATUS_FINAL antes de colgar los sets… **268 de 429 picks se liquidaron
   con 0-0** y otras 56 con sets sueltos. Con 0-0, 'b −5,5' GANA, 'over' PIERDE y la 'a' nunca gana. **El
   track de tenis (+44 % de ROI, 80 % de acierto en hándicap) era ese artefacto**"* (`store.js:649-655`).
   Éste es el "tenis liquidaba 0-0" del encargo: está corregido y además re-liquidado.
2. **`resettleShadow()`** (`store.js:865-882`) reabre las SETTLED cuyo `final` no es coherente y las vuelve a
   pasar con plazo de VOID de 60 días. Idempotente.
3. **Tres días de ESPN, no uno** (7-sep): ESPN agrupa por fecha **local** del torneo; con un solo día *"28
   picks vencidas del US Open figuraban 'sin cruce'"*. Se piden día ±1 y el vecino que falla no bloquea.
4. **Apellidos compuestos** (7-sep): cualquier token del apellido (≥3 letras) vale para casar; desempate por
   inicial y luego por día propio.
5. **Cuadro cambiado** (7-sep): si uno de los dos aparece en un partido FINAL/RETIRED/WALKOVER de ±30 h contra
   **otro** rival, se anula ya con motivo (`cuadro_cambiado`) en vez de esperar 10 días.
6. **Reglas de resultado**: `RETIRED|WALKOVER` → **VOID** (*"las casas difieren; T-0442"*). TOTAL y SPREAD
   dan **PUSH** en igualdad exacta. `units = odds−1` / `−1` / `0`.
7. **Plazo de VOID 10 días** (subió de 4 porque ahora se espera al marcador completo). Las reabiertas no se
   anulan por plazo en la pasada normal.
8. **Parte de diagnóstico** `settle-diag.json` con motivos (`vencidas`, `sin_fuente`, `sin_cruce`,
   `no_final`, `sin_marcador`, `marcador_incompleto`, `ok`, `void_tiempo`, `cuadro_cambiado`) + una muestra
   con los apellidos buscados y los nombres vistos. **Se guarda siempre, aunque no se liquide nada**.
   `tennisJob` lo emite a `opsLog` aunque `settled = 0` si hay vencidas (`server.js:905-911`).

### 1.11 Medición (`track`, `store.js:884-989`)

- Agregados por familia y **por familia × casa**: *"el CLV de una familia promediado entre casas esconde lo
  único que decide si se puede ganar dinero"* (`store.js:894-897`).
- **Por evento** (`porEvento`): *"77 picks de TOTAL eran 43 eventos… el ROI por pick contaba tres veces el
  mismo acierto"*. Una unidad por evento repartida entre sus picks; acierto = signo de esa unidad; CLV
  promediado dentro del evento y después entre eventos; SE y t.
- Bloques: `todas`, `edge8` (histórico) y `preregistradas` (solo con la bandera), más `abiertas_prereg`.
- `tt_transfer`: CLV contra la misma casa por familia + la muestra partida por el veredicto de la puerta
  0,75×unc de tenis de mesa — **etiqueta de medición, la puerta de tenis no cambia**.
- `reading`: *"con {n} liquidadas TODO es ruido"* por debajo de 40.
- `modelCard()` publica la validación (§1.12) y la costura de la base.

### 1.12 Validación walk-forward (`scripts/tennis-fit.js` → `model-priors.json`)

Protocolo: constantes barridas **solo** en 2015→2024-12-31; holdout 2025-01-01→fin de base leído **una vez**;
ATP y WTA por separado; los retiros actualizan ratings pero **no se puntúan** (T-0290). Candidatos B0 moneda →
B1 ranking → B2 Elo → B3 mezcla → B4 compilado → B5 ensamble.

**Holdout ATP (n = 4.141)**

| Candidato | log-loss | Brier | acc | AUC | skill % |
|---|---|---|---|---|---|
| ranking | 0,63223 | 0,22099 | 0,6457 | 0,7035 | 8,79 |
| Elo general | 0,62616 | 0,21832 | 0,6462 | 0,7080 | 9,66 |
| Elo mixto | 0,62263 | 0,21716 | 0,6440 | 0,7092 | 10,17 |
| compilado | 0,63040 | 0,22095 | 0,6312 | 0,6930 | 9,05 |
| **ensamble** | **0,62035** | **0,21634** | 0,6433 | **0,7107** | **10,50** |

`games_mae` 5,502 vs naif 5,576 · `tb_brier` 0,2311.

**Holdout WTA (n = 3.641)**

| Candidato | log-loss | Brier | acc | AUC | skill % |
|---|---|---|---|---|---|
| ranking | 0,63166 | 0,22075 | 0,6292 | 0,7002 | 8,87 |
| Elo general | 0,61579 | 0,21370 | 0,6556 | 0,7206 | 11,16 |
| Elo mixto | 0,61279 | 0,21259 | 0,6581 | 0,7225 | 11,59 |
| compilado | 0,62074 | 0,21583 | 0,6520 | 0,7123 | 10,45 |
| **ensamble** | **0,61196** | **0,21220** | 0,6603 | **0,7235** | **11,71** |

`games_mae` 4,797 vs naif 4,859 · `tb_brier` 0,18605.

La nota del propio `modelCard()` es la correcta: *"skill = mejora del log-loss sobre la moneda; el ranking
oficial se queda en ~8,8 %. **Skill ≠ rentabilidad**: contra el mercado decide la sombra"* (`store.js:1268`).
Obsérvese que el margen del ensamble sobre el **Elo mixto solo** es de 0,23 pp (ATP) y 0,12 pp (WTA) de skill:
el compilador aporta poco al ganador, y su valor real declarado está en la FORMA (juegos, tiebreak).

### 1.13 Variables de entorno (tenis)

| Variable | Default | Efecto |
|---|---|---|
| `SPORTSBOOK_PROVIDER_API_KEY` | — | sin ella no hay mercado ni sombra (`refreshOdds` devuelve null) |
| `GP_TENNIS_PUBLIC_ENABLED` | sin poner | abre el deporte al público; hoy **no se pone** por derechos |
| `GP_TEN_DIR` | `/data/tennis-raw` | crudo de Sackmann |
| `GP_TEN_DEV_END` | 20250101 | corte de desarrollo en `tennis-fit.js` |
| `GP_PICKS_ERA` | `v2-2026-09-02` | etiqueta de era en cada pick |
| `GP_EXPORT_KEY` | — | sonda `/api/internal/tennis` (`?settle=1`, POST `?run=resettle`) |
| `DB_FILE` | `db.json` | define `DISK_DIR` de la sombra y de la base en disco |

### 1.14 Debilidades y riesgos que se ven en el código (tenis)

1. **La base no avanza en saque/resto.** Espina congelada el 20260525: el Elo se mueve, los índices de saque
   no. El compilador —que es el que produce TOTAL y SPREAD— se alimenta **exclusivamente** de `paSrv`/`pbSrv`,
   o sea de estadística congelada. El impuesto `lagUncPp` cubre el ganador, pero la FORMA de la distribución
   de juegos se está calculando con saque de mayo.
2. **La superficie se adivina por regex sobre la clave del torneo**, con "dura" como default. Un torneo de
   arcilla cuyo nombre no case entra como pista dura y usa el Elo de superficie equivocado con `surfW` 0,45.
3. **No hay devig en tenis**: la implícita es `1/cuota` de la **mejor** cuota. Comparar la probabilidad del
   modelo contra un precio **con margen dentro** sesga el `edge_pp` sistemáticamente al alza en todas las
   familias — y la puerta es un umbral fijo de 3 pp. (El resto del sistema ya midió esto: `lib/margen.js`,
   CLAUDE.md §LA VARA.)
4. **La línea de las tesis es la del consenso, pero la cuota es la mejor de cualquier casa**, que puede estar
   cotizando otra línea distinta a la mediana: `best()` filtra por `line === consensus.total_line`, así que
   una casa con línea propia queda fuera del candidato aunque su precio sea el ejecutable.
5. **Riesgo de look-ahead residual en los residuos C6**: `tennis-resid.js` reutiliza `gamesCal` **de
   producción** (ajustado en desarrollo) y los terciles se calculan sobre el mismo desarrollo; el informe lo
   declara, pero la tabla es un objeto ajustado a datos que después se usa como si fuera estructura.
6. **Selección por diferencia máxima.** Como en el resto de la casa, la tesis nace donde `modelo − mercado` es
   máximo; con un modelo cuyo skill sobre el ranking es de 1,7 pp, esa selección recoge sobre todo error del
   modelo. El propio `uncertainty.js` lo llama "la ley común de las familias que pierden".
7. **El track histórico está contaminado** por la liquidación 0-0 anterior al 2-sep; `resettleShadow` lo
   repara pero solo donde ESPN conserva el día, y los cierres antiguos **no llevan `totals_all`**, así que
   *"solo las picks liquidadas desde el deploy tendrán `close_source` distinto de consenso"*
   (`docs/impl/tenis-REPORT.md`).
8. **Pendiente declarado sin resolver**: guarda por retraso de la base en el término de calendario — con la
   base N días atrás, el Δlog1p se comprime y `n7` sale 0 para ambos; hoy *"se anota y no se bloquea"*.

---

## 2. TENIS DE MESA (11º deporte) — y el canal de DINERO REAL

### 2.1 Propósito, alcance y alcance verificado

Terminal completo (agenda WTT, tablero, cockpit "Visual OS", catálogo, ranking propio, eventos, simulador,
sombra). **Diez familias** (`tt-engine/store.js:40-51`):

| Familia | Etiqueta | Estado |
|---|---|---|
| `ML` | Ganador | **referencia/benchmark** |
| `GAMES_TOTAL` / `GAMES_HCP` | total/hándicap de games | sombra |
| `POINTS_TOTAL` / `POINTS_HCP` | total/hándicap de puntos del partido | sombra (**y dinero real en POINTS_TOTAL**) |
| `CORRECT_SCORE` | marcador exacto | **solo display** |
| `GAME_ML`, `GAME_POINTS_TOTAL`, `GAME_POINTS_HCP`, `GAME_DEUCE` | mercados del **1er game** | sombra |

**Alcance verificado (`tt-engine/rules.js:92-116`)** — el candado más duro del módulo. `integrityOf(competition)`
clasifica cada competición en cuatro estados:

- `VERIFIED_SCOPE` (WTT/ITTF/olímpico/continental): **único estado que entra al modelo y a la sombra**.
- `WATCH` (Bundesliga, T.League, ligas nacionales con federación): solo mercado.
- `RESTRICTED` — *"ligas privadas creadas para el mercado de apuestas (Liga Pro, Setka Cup, TT Cup, TT Elite
  Series…). Sin cuerpo oficial, sin resultado independiente y sin plantilla en la base: se ENSEÑAN con su
  aviso y **NUNCA se modelan ni se registran en la sombra**"*. La regex incluye además Moscow, Ukraine,
  Belarus, Armenia, Russia, Czech, Poland TT, Hungary TT.
- `QUARANTINED` / `BLOCKED`: gramática reservada.

La puerta se aplica dos veces: en `eventModel()` (*"competición {X}: el modelo no entra"*, `store.js:275`) y
en la lectura de Cloudbet, que **solo pide mercados de competiciones verificadas** (`store.js:190`).
**Importante**: si `competition` viene vacío, `integrityOf` devuelve `RESTRICTED` — falla cerrado.

**Derechos (`data/tt/RIGHTS.md`)**: tabla triestado por fuente; *"UNKNOWN falla cerrado"*. WTT da `display`
ALLOW con atribución pero `commercial: UNKNOWN`; ITTF `commercial: DENY`. La apertura al público del 9-sep
está registrada como **decisión del dueño con riesgo asumido**: *"La tabla no lo autoriza… Mitigación
aplicada: `/api/tt/model` y las vistas de motor y rendimiento quedan admin-only… Si la fuente reclama, se
apaga con `GP_TT_PUBLIC_ENABLED=0` sin desplegar"*.

### 2.2 Fuentes

| Fuente | Qué da | Frecuencia / caché |
|---|---|---|
| WTT CMS (`…azurefd.net/primary/api/cms/`) | eventos activos, agenda por evento (hora **local**, IttfId, país, cabeza de serie, dob), retratos, ficha (mano, empuñadura, estilo) | `slate` TTL 4 min, stale-while-revalidate |
| WTT score (`liveeventsapi/…GetOfficialResult_Minimal`) | **match card oficial**: bo N, **puntos por game**, tiempos muertos, duración, hora UTC | caché en `results.json`, poda 45 días |
| WTT live | ids en juego + card en vivo (puntos, servidor) | 30 s (ids) / 8 s (card) |
| ITTF gateway (`…/ttu/`) | ranking semanal e **historial por jugador con los puntos de cada game** (2012→) | cola diaria `ttTailJob` |
| Flashscore (deporte 25) | vivo de respaldo | **display, jamás input del modelo** (RIGHTS) |
| Pinnacle (deporte 32) | ML, hándicap, total; por game | referencia de precio |
| Bovada (cupón `table-tennis`) | ML, game spread, point spread, total points, correct score, 1er game (ML/spread/total), **"to go to extra points"** = deuce | la superficie más rica |
| **Cloudbet** (clave) | `table_tennis.winner` · `totals` · `correct_score` · `game_point_handicap.v2` · `game_total_points.v2` · `game_winner.v2` | **venue ejecutable** |

Odds: TTL 3 min, **stale-while-revalidate** con Cloudbet leído **de 6 en 6** y tope 60 eventos por pasada,
los más próximos primero (`CB_MAX_PER_PASS`, `CB_PAR`, `store.js:177-201`). Motivo escrito: *"la primera
pasada del tablero tardaba 39 s porque leía los 71 mercados de Cloudbet en serie DENTRO de la petición y el
móvil corta a los 30"*. Lo que no entra en la pasada **conserva las filas de la anterior**.

Zona horaria: la agenda da hora local; se convierte con tabla de sedes y se **certifica** con el primer match
card oficial del evento (`certifyTz`, `tz.json`).

Distinción puntos/games por **magnitud de la línea**: total ≥ 15 → puntos; |hándicap| ≥ 4 → puntos
(`data-providers/tt/books.js:40-41`).

### 2.3 Base histórica y cosecha

`scripts/tt-harvest.js` (`--rank --events --photos --history=N --refresh=7 --cards=200 --build --gz`).
Crudo en `GP_TT_RAW` (`/data/tt-raw`), compacto versionado en `data/tt/`.

**`data/tt/meta.json`**: 192.460 filas, **30.644 con fecha exacta** (`dated`), 15.732 jugadores, 1.604
torneos, 2.226 archivos crudos, 1.697 retratos, ventana **1992-2026**, `last_match_date` 20260908.
**Descartes declarados**: `test` 3.884, `doubles` 13.314, `nowin` 6.584, `nogames` 8.945, **`dup` 50.233**.

`data/tt/formats.json` guarda la frecuencia real de formatos por `tier|round` (p. ej. `ittf_tour|Q`:
{5: 3.745, 7: 14.976}); `formatFor()` usa el más frecuente si hay ≥ 8 observaciones, si no cae a la plantilla
de `templateBestOf`.

**Incidente registrado** (HANDOFF): la primera cola en producción recibió el ranking ITTF **vacío** (404 desde
Render), no bajó historiales y escribió un compacto de **cero filas** que pisó al del repo ~6 min. El candado
resultante vive en `tt-engine/data.js:54`: si el compacto del disco tiene `< 1000` filas, **se cae al del
repo** y se marca `source_note`.

**Memoria**: la reproducción absorbe todo el historial, pero en RAM solo se conservan las filas **≥
20200101** y 12 partidos recientes por ficha (`data.js:64-68`) — Render Starter, 512 MB.

### 2.4 Rating: Elo de partido (L0) + rating de punto (L1)

`replay()` (`tt-engine/data.js:75-124`), cronológico, con `onPredict` que entrega la predicción **antes** de
actualizar (walk-forward puro):

```
peso del partido  w = TIER_WEIGHT[tier] · (youth ? youthWeight : 1)
Elo:   K(n) = kScale · 200 / (n+5)^0.4 ;  e' = e ± w·K(n)·(1 − pElo)
Rating de punto (solo con marcador completo, n ≥ 11 puntos y sin retirada):
   pPt  = σ(θA − θB)
   grad = (pw − n·pPt) / n^pointNorm
   η(n) = pointEta · (1 + 6/(n+3))
   θA ← θA + w·η(nA)·grad ;  θB ← θB − w·η(nB)·grad
```

`TIER_WEIGHT` (`rules.js:90`): grand_smash/finals/worlds/olympics 1,15 · champions/world_cup 1,10 ·
star_contender/contender 1,0 · continental 0,95 · feeder/ittf_tour 0,90 · other 0,80 · **youth 0,60**.

Del θ a la probabilidad de punto (`data.js:131`, `148-159`):

```
pPoint      = 0.5 + pointScale     · (σ(θA−θB) − 0.5)     → entra al GANADOR
pPointDist  = 0.5 + pointScaleDist · (σ(θA−θB) − 0.5)     → entra a las DISTRIBUCIONES
a = clamp(p + serveDelta, .02, .98)   b = clamp(p − serveDelta, .02, .98)
p_a = σ( (1−u)·logit(p_Elo) + u·logit(p_compilado) )
unc_pp = 100 · 0.28 · sqrt(1/(nA+2) + 1/(nB+2))
```

**Constantes congeladas** (`data/tt/model-priors.json`, `tt-l1-1`, ajustadas 2026-09-08): `kScale` **1,4** ·
`pointEta` **0,08** · `pointNorm` 0,5 · `pointScale` **1,0** · `pointScaleDist` **1,0** · `serveDelta` 0,03 ·
`ensembleU` **0,25** · `youthWeight` 0,5 · `warmN` 8.

**Resolución L1 declarada** (`data.js:10-11`): *"El reparto saque/recepción (L2) NO está identificado con esta
fuente: se aplica un prior de población (serveDelta) y se dice en pantalla. Nunca se inventa."* En la ficha
se publica literalmente: `serve_split: 'prior de población (δ = 0.03)'`.

### 2.5 El compilador exacto (`tt-engine/compiler.js`)

Es la pieza más rigurosa de los tres deportes.

- **Reglas como código** (`rules.js`): 11 puntos, 2 de diferencia, servicio en bloques de 2, **alternancia
  punto a punto desde 10-10**, primer servidor alterna por game. De ahí tres verdades que el mercado a veces
  ignora: *"un game no puede acabar 11-10, el total 21 no existe, y 'más de 20,5 puntos' y 'más de 21,5
  puntos' en un game son EXACTAMENTE la misma apuesta"* (`rules.js:5-7`).
- **Game**: masa hacia delante sobre estados no terminales + **cola de deuce analítica**:
  ```
  u = ab ,  v = (1−a)(1−b) ,  r = 1 − u − v
  P(A gana | deuce) = u/(u+v)     E[puntos extra] = 2/(u+v)
  P(extra = 2k ∧ gana A) = r^(k−1)·u          (KMAX = 600 bloques, EPS_TAIL = 1e−11)
  ```
  *"Las colas truncadas llevan su ε explícito: NUNCA se asigna la masa residual a un ganador"*
  (`compiler.js:17`). `eps` viaja en la salida y se publica en la ficha.
- **Lattice de game** `P(A gana el game | i–j)` y `gameProbFrom` para estados más allá de 10-10 (solo importa
  la paridad) → alimenta el "Game State Lattice" y el "Leverage Spine".
- **Partido**: convolución de games llevando por cada estado `(ga, gb)` la **PMF de puntos totales** y la de
  **margen de puntos** (`Float64Array` de 1.024 y 2.048 posiciones, poda 1e-12). De ahí salen a la vez:
  ganador, marcador exacto, total y hándicap de games, total y hándicap de puntos, y los mercados del 1er
  game. Más `match_lattice` para el leverage por game.
- **Primer servidor desconocido** → se compilan los dos escenarios y se publica la **mezcla 50/50** más cada
  uno por separado (`scenarios`). Si se ve en vivo el 0-0 del game 1, se guarda (`firsts.json`) y se usa.
- **`selfTest()`** (`compiler.js:296-326`) reproduce la tabla sintética del blueprint **a 6 decimales**:
  a=b=0,5 → 18,828453 puntos/game y P(deuce)=0,176197; a=0,6/b=0,5 → P(game)=0,687816, P(BO5)=0,820431;
  a=0,7/b=0,3 → P(game)=0,5 con 19,246538 puntos. Comprueba además marcadores legales (11-10 ilegal, 12-10
  legal, 13-12 ilegal) y las dos identidades de pago. Expuesto en `/api/internal/tt?key=&selftest=1`.
- **`payoffEquivalences()`**: publica las apuestas que pagan igual por reglamento (over 20,5 = over 21,5 =
  P(deuce); hándicap de game ±1,5 = ganador del game; "menos de need+0,5 games" = suma de las dos barridas).

**`impliedProcess()`** (`store.js:463-472`) — la hipótesis de edge del blueprint 9.0. Por bisección (30
iteraciones) se busca **qué probabilidad de punto reproduce** el consenso del ganador y **qué desigualdad de
punto hace moneda al aire** la línea de total. Si las dos no coinciden, el mercado está cotizando **dos
procesos de punto distintos** en el mismo partido:

```
gap_pp > 1  → "la línea de total cotiza un duelo MÁS desigual que el ganador: hay masa de puntos que el ML no identifica"
gap_pp < −1 → "la línea de total cotiza un duelo MÁS parejo que el ganador (cola de deuce cargada)"
```

### 2.6 Del modelo a la tesis

`gate()` (`store.js:280-296`) — **`EDGE_MIN_PP = 3`, `ODDS_MAX = 6.5`**:

| Puerta | Regla |
|---|---|
| `familia` | no `display_only` (excluye CORRECT_SCORE) |
| `ventana` | `status === 'scheduled'` y saque en el futuro |
| `cuota` | `1,15 < odds ≤ 6,5` |
| `probabilidad` | `0,05 < p_model < 0,95` |
| `ventaja` | `edge_pp ≥ 3` |
| **`ruido`** | **`edge_pp ≥ 0,75 × unc_pp`** ← la puerta que después se transfirió a todo el sistema |
| `muestra` | ninguno "frío" (`n < warmN = 8` partidos) |
| `frescura` | ninguno sin partidos en 8 meses (`stale`, 240 días) |
| `formato` | certificado **o** `share ≥ 0,95` con `n ≥ 30` en el histórico |
| `primer game` | solo `game === 1` se anota prematch |
| `vivo` | no líneas en vivo |

**Devig real**: `impliedOf()` (`store.js:259-267`) busca la **contraparte exacta en la misma casa, misma
familia, mismo game y misma línea en valor absoluto**, y devuelve `p = i/(i+j)` con `vig = i+j−1`. Si no hay
pareja, cae a `1/cuota` y marca `devig: false`. Esto es más riguroso que tenis.

**Dedup**: una candidata por `family|side|line|game`, **la de mejor cuota** (`store.js:315-317`). Clave de
pick: `event_id|family|side|line|game`. **Stake** ¼ Kelly, tope 2 % (`STAKE_CAP`). Ventana de nacimiento: < 6
días. Era: `tt-v1-2026-09-08`.

### 2.7 Cierres, liquidación y CLV

**Cierres** (`snapshotCloses`, `store.js:510-535`): cinco cubos **T−60 / T−30 / T−10 / T−5 / T−1**
(`implied-engine/closes.js` con ventanas `[90,45] [45,20] [20,7] [7,3] [3,−2]` minutos), **una sola lectura
por cubo**, más `rows` (la foto completa). Dos correcciones citadas en el propio código:

- *"EL CIERRE SE CONGELA EN EL SAQUE (11-sep). Antes `rows` se machacaba en cada pasada, incluida la hora
  POSTERIOR al saque… las familias con línea se quedaban sin CLV: **POINTS_TOTAL 4 de 62, GAMES_HCP 0 de
  26**"* (`store.js:519-524`).
- *"cada cubo solo acepta la lectura que cae DENTRO de su ventana… Con el `minsTo <= bkt` de antes, un partido
  visto por primera vez a T−10 rellenaba T60, T30 y T10 con la MISMA foto: **las 264 tesis vivas tenían dos o
  más cubos con idéntico sello de tiempo y la curva salía plana por construcción**"* (`store.js:525-528`).

`closes.rescatar()` reconstruye a posteriori el CLV desde los cubos congelados (T−1 primero, T−60 el último),
marcando `clv_rescatado`; **retroactivo, en memoria, sin re-liquidar**. Efecto medido (HANDOFF): **38 → 300 de
321 en TT y 4 → 15 de 24 en dardos**. `closes.salud()` cuenta las tesis con cubos escritos "en bloque" para
que la pantalla *"no presuma de una curva que todavía no se puede leer"*.

**Liquidación** (`settleOne` / `settleShadow`, `store.js:564-628`): fuente única = **match card oficial de la
WTT**, con `games` (puntos de cada game), `score_a/b`, `points_a/b`, `winner`, `best_of`, duración y tiempos
muertos. La orientación H/A del card se compara contra a/b de la agenda y se **voltea si hace falta**
(`fetchResult`, `store.js:152-153`). Reglas: over/under con **PUSH** en igualdad; hándicap con push en 0;
`GAME_*` se resuelven con `games[0]`; `GAME_DEUCE` es `g1[0]+g1[1] ≥ 22`. Sin card → `no_final` y se
reintenta; **VOID a los 10 días**. Vencidas = OPEN con saque hace > 40 min. Diagnóstico en
`settle-diag.json`. **No hay tratamiento explícito de retirada/walkover** (a diferencia de tenis): si el card
no es `final`, simplemente no se liquida hasta el plazo.

**Track** (`store.js:629-658`): por familia, **familia × casa**, **tier** y **sub** (MS/WS); `clv_avg_pct`
(mejor), `clv_own_avg_pct` + `clv_own_beat_pct` (misma casa), `clv_curve` por cubo × referencia
(own/best/pinnacle) y `clv_salud`.

### 2.8 Validación walk-forward (`scripts/tt-fit.js --write`)

Protocolo: rejilla **solo** en desarrollo 20230101→20260101; holdout 2026 leído una vez; solo MS/WS de
mayores, sin retiradas, con **ambos ≥ `warmN` partidos previos**; orientación aleatoria pero determinista
(paridad de los dos últimos dígitos de los ids) *"para que el ganador no sea siempre A"*. Rejilla: `kScale ∈
{0,7; 1; 1,4} × pointEta ∈ {0,02; 0,04; 0,08} × pointNorm ∈ {0,5; 1} × pointScale ∈ {0,5; 0,65; 0,8; 1} × u ∈
{0; 0,25; 0,5; 0,75; 1}`, elegida por log-loss del **ganador**; 2ª etapa `pointScaleDist ∈ {0,8…1,7}` elegida
por un score mixto de MAE de games/puntos + sesgo de barridas/deuce/over.

**Desarrollo (n = 17.227)**: ensamble log-loss 0,5230 · skill 24,55 % · Brier 0,1764 · AUC 0,813; Elo solo
0,5322 / 23,22 %; compilado solo 0,5745 / 17,12 %.

**Holdout 2026 (n = 4.557)** — transcrito literal de `data/tt/model-priors.json`:

| | log-loss | skill % | Brier | AUC |
|---|---|---|---|---|
| Elo | 0,5372 | 22,505 | 0,1811 | 0,803 |
| compilado | 0,5789 | 16,480 | 0,1908 | 0,796 |
| **ensamble** | **0,5273** | **23,924** | **0,1777** | **0,810** |

Superficies de forma en el mismo holdout:

| Magnitud | modelo | real | naif |
|---|---|---|---|
| games totales (MAE) | 0,653 | media 3,893 (modelo 3,881) | 0,704 |
| puntos totales (MAE) | 14,302 | media 71,885 (modelo 71,232) | 15,475 |
| tasa de deuce | 0,1489 | **0,1578** | — |
| over de la línea de referencia | 0,5799 | **0,5912** | Brier 0,2326 vs naif 0,2417 |
| barrida (sweep) | 0,4117 | 0,4005 | — |
| marcador exacto (log-loss) | 1,6327 | — | uniforme 1,7918 |

> **Discrepancia detectada**: `HANDOFF.md:642` afirma *"Elo solo 0,5340; compilado solo 0,5310"* para el
> holdout, mientras `data/tt/model-priors.json` guarda 0,5372 y **0,5789**. El archivo de priors es la fuente
> que el motor lee (`modelCard()` publica `d.priors.holdout`); el HANDOFF está equivocado en la cifra del
> compilado, y por un margen grande (el compilado solo es **peor** que el Elo solo, no mejor).

### 2.9 EL CANAL DE DINERO REAL: `real-executor/tt.js`

> Uno de los dos únicos lugares del sistema con dinero (CLAUDE.md). Orden literal de Alexis del 9-sep:
> *"Coloca total points de table tenis en el ejecutor de dinero real en Cloudbet, apostando siempre 5 dólares."*

**Constantes de identidad** (`real-executor/tt.js:20-31`):

```
FAMILIA = 'TT_POINTS'   SEGMENTO = 'tt_points_total_v1'
MARKET_KEY = 'table_tennis.totals'   CASA = 'cloudbet'   FAMILIA_SOMBRA = 'POINTS_TOTAL'
STAKE() = GP_REAL_TT_STAKE ?? 5      REINTENTOS_MAX = 60
CON_DINERO = { PLACED, EN_ACEPTACION, SETTLED }
```

**Qué señal dispara una apuesta** (`sweep`, `tt.js:149-174`) — cinco condiciones, todas obligatorias:

1. La tesis está **OPEN** en la sombra de tenis de mesa (`tt-engine/store.openPicks()`).
2. `family === 'POINTS_TOTAL'` — **total de puntos del PARTIDO**, no de un game.
3. `book === 'cloudbet'` (la casa que dio el precio en la sombra debe ser la ejecutable).
4. `start_at > ahora + 5 min`.
5. `!p.benchmark` (nunca el ganador).
6. Tiene `cb_event_id` — el id del evento en Cloudbet, que `openPicks()` (`tt-engine/store.js:867-888`) cuelga
   de la tesis casando el partido por nombre contra la agenda de cuotas viva (±36 h) y la fila exacta por
   familia/lado/línea/game, persistiendo `cb_event_id`, `cb_flipped`, `market_key`, `params` y `max_stake`.

O sea: **el ejecutor no decide nada**. Hereda íntegra la decisión de la sombra —incluidas las diez puertas del
§2.6, con la de ruido `edge ≥ 0,75·unc_pp`— y solo se ocupa de colocar.

**Por qué esta familia** (comentario de cabecera, `tt.js:12-14`): *"Cloudbet cotiza los totales de tenis de
mesa con una plantilla (73,5 / 75,5) y no los mueve hasta el saque (CLV propio plano en los cinco cubos), y
nuestro compilador los saca del proceso de punto validado fuera de muestra. El ganador queda fuera: es el
mercado eficiente."* Confirmado por la medición transversal: **TT POINTS_TOTAL tiene la línea quieta el
78,8 % de las veces** (CLAUDE.md §LA VARA / HANDOFF:321) — lo que significa que **el CLV no es vara válida en
esta familia** y la medición debe hacerse por `modeloContraPrecio()`.

**Colocación paso a paso** (`colocar`, `tt.js:58-144`), en orden:

| # | Comprobación | Efecto si falla |
|---|---|---|
| 1 | saque ya pasado | `CADUCADA` |
| 2 | `intentos > 60` | `CADUCADA` / `demasiados_intentos` |
| 3 | `ttOn()` (`GP_REAL_TT_ENABLED`) | `PENDIENTE` / `canal_apagado` |
| 4 | `cb_event_id` presente | `sin_id_de_evento` |
| 5 | lado ∈ {over, under} | **DESCARTADA** (definitivo) |
| 6 | `line > 0` | **DESCARTADA** |
| 7 | `ocupada(L, fila)` — ya hay dinero en **mismo evento + mismo lado + misma línea** | **DESCARTADA** / `linea_ya_apostada` |
| 8 | `CB.eventRaw()` legible | `evento_ilegible` |
| 9 | `CB.selectionFor(ev, 'table_tennis.totals', línea, lado)` | `linea_no_cotizada` (+ lista de mercados vistos) |
| 10 | estado de la selección no `DISABLED/SUSPENDED/CLOSED` | `seleccion_cerrada` |
| 11 | `price > 1` y `marketUrl` presente | `sin_precio` / `sin_market_url` |
| 12 | **deslizamiento**: `price ≥ odds_sombra · (1 − minOddsSlipPct)` | `precio_peor` (reintenta luego) |
| 13 | stake = `min(5, maxStake de la casa)`, redondeado a céntimos | `minimo_de_la_casa` / `tope_de_la_casa_muy_bajo` si < 1 |
| 14 | **`RE.frenos(stake, kickoff_at)`** | `freno:<motivo>` |
| 15 | `C.dry` (`GP_REAL_DRY`) | `ensayo` (no envía) |
| 16 | `CB.placeBet(peticion)` con `referenceId = ref_id` idempotente y `acceptPriceChange: 'BETTER'` | según respuesta |

**Los frenos compartidos** (`real-executor/store.js:201-239`), en orden de gravedad — son los mismos que
protegen el canal de tarjetas:

1. `apagado` — `GP_REAL_ENABLED` no encendido.
2. `sin_api_key` — falta `CLOUDBET_API_KEY`.
3. `fuera_de_ventana` — `GP_REAL_KICKOFF_MAX`; **sin saque conocido tampoco se apuesta** si hay ventana.
4. `parada_diaria` — pérdida del día ≤ −`dayStopPct · nocional` (default **6 %**).
5. `exposicion_maxima` — expuesto + stake > `GP_REAL_MAX_OPEN` (default **400**).
6. `cuenta_restringida` — ≥ 3 rechazos seguidos `RESTRICTED`/`VERIFICATION_REQUIRED`: *"el problema no es el
   partido: es la cuenta… el premio por insistir es que nos bloqueen una semana"*.
7. `puerta_cerrada` — ≥ 3 cortafuegos seguidos → silencio de 30 min (`GP_REAL_CF_ESPERA_MIN`).
8. `sin_fondos` — `saldo − stake < GP_REAL_MIN_BALANCE` (default 40). **Saldo `null` no frena**: *"'no lo sé'
   no es 'está vacía'"*.

**Gestión de la respuesta de la casa** (`tt.js:105-143`), calcada de tarjetas:

- `cortafuegos` → contador `L.cortafuegos.seguidos`; una respuesta normal lo reabre.
- `DUPLICATE_REQUEST` → `EN_ACEPTACION` con `stake_comprometido`, **jamás se reenvía**.
- Respuesta sin veredicto legible con HTTP ≥ 200 → `EN_ACEPTACION` (*"puede haber dinero puesto → se pregunta
  por la referencia, jamás se reenvía"*).
- `RESTRICTED` / `VERIFICATION_REQUIRED` / `MALFORMED_REQUEST` → `DESCARTADA` + contador de cuenta.
- **La referencia solo se quema si la casa llegó a hablar**: `ref_id = RE.refIdDe(pick_id, envios)` solo
  incrementa `envios` con HTTP ≥ 200 (`tt.js:128-129`).
- `PENDING_ACCEPTANCE` → `EN_ACEPTACION`; éxito → `PLACED` con `odds_real`, `slippage_pct`, descuento del
  saldo estimado y anotación en el día.

**Liquidación**: la hace el barrido general de `real-executor/store.js::liquidar()` **por referencia contra el
estado de la casa** (`CB.betByReference` → `betStatus` ∈ `ESTADOS_LIQUIDADOS`), con el P&L calculado por la
aritmética de la apuesta y `returnAmount` usado solo como **contraste** (`discrepancia_importe`). Motivo
escrito: *"`returnAmount` es el RESULTADO de la apuesta… El código le restaba el stake otra vez, y la primera
ganada real quedó anotada como pérdida"*.

**Cableado**: dentro de `ttJob` (cada 10 min), sólo si `REx.CFG().enabled` (`server.js:966-973`). Sonda
`/api/internal/real-tt?key=[&run=1]`, que devuelve las señales abiertas POINTS_TOTAL de Cloudbet y el resumen
del canal.

**Variables del canal real**

| Variable | Default | Efecto |
|---|---|---|
| `GP_REAL_TT_ENABLED` | **encendido** | `0/false/no/off` apaga solo este canal |
| `GP_REAL_TT_STAKE` | **5** | stake plano en la divisa de `GP_REAL_CURRENCY` (USDT) |
| `GP_REAL_ENABLED` | false | apagado maestro de TODO el ejecutor real |
| `GP_REAL_DRY` | true | ensayo: calcula y no envía |
| `GP_REAL_MAX_SLIP_PCT` | 3 | deslizamiento máximo aceptado |
| `GP_REAL_MAX_OPEN` | 400 | exposición abierta simultánea |
| `GP_REAL_MIN_BALANCE` | 40 | suelo de cartera |
| `GP_REAL_DAY_STOP_PCT` | 6 | parada diaria |
| `GP_REAL_KICKOFF_MAX` | sin poner | ventana de saque máximo |
| `CLOUDBET_API_KEY` / `CLOUDBET_RELAY_URL` + `GP_RELAY_KEY` | — | acceso y relay geográfico |

### 2.10 Variables de entorno (tenis de mesa, módulo)

| Variable | Default | Efecto |
|---|---|---|
| `GP_TT_PUBLIC_ENABLED` | **abierto** (`pubOn`) | `=0` lo cierra al público sin desplegar |
| `GP_DARTS_TT_FREE_UNTIL` | `2026-09-17T00:00:00Z` | ventana libre para todos los planes |
| `GP_TT_TAIL` | true | `false` apaga la cola diaria |
| `GP_TT_RAW` | `<dbdir>/tt-raw` | crudo ITTF/WTT |
| `GP_TT_CONC` | 4 | concurrencia de la cosecha |
| `WTT_API_KEY` / `WTT_SEC_KEY` | claves públicas embebidas | acceso al CMS de la WTT |
| `GP_FETCH_VIA_CURL` | — | `=1` usa curl (el fetch de Node no atraviesa el proxy del sandbox) |
| `GP_PICKS_ERA` | `tt-v1-2026-09-08` | etiqueta de era |

### 2.11 Debilidades y riesgos (tenis de mesa)

1. **El compilador es exacto; los insumos no.** `a` y `b` salen de `p ± 0,03` con δ de población: el reparto
   saque/recepción **no está identificado**. Todos los mercados de 1er game (`GAME_ML`, `GAME_POINTS_*`,
   `GAME_DEUCE`) dependen de quién sirve, y prematch se promedian los dos sorteos. La casa lo declara, pero
   sigue siendo el supuesto que más carga el precio de esas cuatro familias.
2. **El modelo infra-predice la cola de deuce.** En holdout: deuce real 15,78 % vs modelo 14,89 %; over real
   59,12 % vs modelo 57,99 %. Es un **sesgo sistemático hacia el under** justo en la familia que mueve dinero
   real (`POINTS_TOTAL`). El signo va en contra de over, a favor de under — y el ejecutor apuesta el lado que
   diga la tesis.
3. **`pointScale = pointScaleDist = 1,0`** significa que el ganador y las distribuciones usan la misma escala:
   la hipótesis del blueprint (que un ganador calibrado no identifica la superficie de totales) queda sin
   explotar en producción, aunque el mecanismo esté construido.
4. **El compilado solo es peor que el Elo solo** en holdout (0,5789 vs 0,5372): la mezcla gana por el Elo, no
   por el compilador. Y el HANDOFF publica una cifra equivocada que hace parecer lo contrario (§2.8).
5. **`ocupada()` del canal real no aplica la doctrina "una posición por PARTIDO + LADO"** (CLAUDE.md, 13-sep).
   `real-executor/tt.js:33-38` exige coincidencia de **evento + lado + LÍNEA**, de modo que `over 73,5` y
   `over 75,5` del mismo partido pueden coexistir con dinero. En tarjetas eso mismo costó −17,63 % de ROI con
   dos posiciones y −45,83 % con tres (`real-executor/store.js:322-331`, `mismaPosicion` + `unaPorPartido`).
   **El canal de TT no pasa por `posicionOcupada`**: es un agujero abierto de la misma forma exacta que la
   doctrina prohíbe.
6. **Sin regla de retirada en la liquidación**: si un partido se abandona, el match card no será `final` y la
   tesis irá a VOID por plazo (10 días), pero el **dinero real** lo resuelve la casa por su cuenta, así que
   sombra y libro real pueden divergir sin que nada lo señale.
7. **Derechos en rojo declarado**: WTT `commercial: UNKNOWN`, ITTF `commercial: DENY`, y el deporte está
   abierto al público desde el 9-sep por decisión explícita del dueño *con el riesgo anotado*. Es el mayor
   riesgo **no técnico** del módulo.
8. **Casado por nombre**: `nameIs()` exige familia completa + nombre o inicial. Con nombres chinos
   transliterados de forma distinta por cada casa, un falso negativo deja el partido sin mercado (silencioso)
   y un falso positivo pondría dinero en el partido equivocado. El `cb_flipped` se persiste pero **no se
   vuelve a verificar** en la colocación.
9. **192.460 filas pero solo 30.644 con fecha exacta**; las anteriores a 2021 están fechadas **por año**
   (`known_gaps` del `modelCard`), así que el orden cronológico del walk-forward es aproximado en dos tercios
   de la base — aunque el fit solo usa 2023→ para desarrollo y 2026 para holdout, la reproducción del Elo
   arrastra todo el historial.

---

## 3. DARDOS (9º deporte)

### 3.1 Propósito y alcance

Terminal PDC + circuito MODUS. **Once familias** (`darts-engine/store.js:38-50`):

| Familia | Estado |
|---|---|
| `ML` | **referencia/benchmark** |
| `LEGS_TOTAL`, `LEGS_HCP`, `SETS_TOTAL`, `SETS_HCP` | sombra ("la más escalable") |
| `X180_TOTAL`, `X180_MOST`, `X180_PLAYER` | sombra ("la hipótesis principal") — liquidables **solo en Players Championship** |
| `X180_HCP`, `CORRECT_SCORE`, `HIGHEST_CHECKOUT` | **solo display** |

Universo (preregistro, `docs/PREREGISTRO_DARDOS.md`): agenda oficial de la PDC en torneos **no secundarios**
(fuera Q-School, Challenge Tour, Development Tour, Women's Series, juveniles) con **formato certificado por el
stage oficial**; prematch, entre 0 h y 6 días. Más **MODUS Super Series** como segunda agenda etiquetada
aparte (`circuit: 'modus'`), nacida porque *"del 7 al 10 de septiembre no hay un solo partido con cuadro
definido"* en la PDC (`modus.js:4-7`); MODUS juega 15 partidos diarios, formato fijo primero a 4 legs, y su
resultado lo da **Flashscore**. El track separa PDC y MODUS: *"MODUS y PDC nunca en la misma media"*
(`store.js:607`).

### 3.2 Fuentes

| Fuente | Qué da | Notas |
|---|---|---|
| API pública PDC (`*.darts.web.gc.pdcservices.co.uk/v2/`) | calendario, **formato POR RONDA certificado** (sets, legs/set, dos de diferencia), resultados con legs, participantes | sin clave; UA `curl/8.5.0`; `season` TTL 6 h, `slate` TTL 8 min, 150 ms entre torneos |
| Darts Orakel | **media de 3 dardos, 180s, % de dobles, checkout más alto** por jugador y **ventana de fechas arbitraria** | `app.dartsorakel.com/api/stats/player?rankKey=&dateFrom=&dateTo=`; `rankKey` 25=media, 26=180s, 1053=% dobles. Partidos solo de Players Championship |
| Pinnacle (deporte 10) | ganador + total de legs | referencia |
| Bovada | ganador, marcador exacto, **MOST 180s con empate**, TOTAL 180s, 180s por jugador | única fuente de precio de la familia de 180s |
| Polymarket (serie 12754) | ganador | **excluido del consenso y de la mejor cuota**: *"con $25 de liquidez y 26 puntos de spread es un intervalo, no un precio"* (`store.js:170-173`) |
| Kalshi (`KXPDCDARTS`) | campeón del Mundial | outrights |
| Cloudbet | mercados de dardos | venue; se leen los eventos de los próximos 3 días, máx. 40, uno a uno con 200 ms |
| Flashscore | legs en vivo + resultado MODUS | display (y liquidación de MODUS) |
| Wikipedia / Commons | retratos (la PDC solo tiene 318 de 4.942) | solo si la descripción dice "darts player" |

`ODDS_TTL` = 10 min.

### 3.3 Base histórica

`scripts/darts-harvest.js --pdc --orakel --photos --build`. Crudo en `GP_DARTS_RAW` (`/data/darts-raw`),
compacto en `/data/darts` (disco) con **el repo como línea de base**: *"Sin esto, la cola en Render —que solo
refresca la temporada en curso— habría reconstruido una base con un solo año y perdido 2023-2025"*
(`darts-harvest.js:22-25`). Los dos compactos grandes viajan en `.gz`.

**`data/darts/meta.json`**: 104.600 fixtures vistos, **103.908 resultados**, 4.942 jugadores, 896 torneos,
20230109 → 20260906, **62.559 campos de Orakel casados**, **68 ventanas** de Orakel.

### 3.4 Rating y vector de habilidad (`darts-engine/data.js`)

```
K(n) = kScale · 200 / (n+5)^0.4
fk   = clamp(sqrt(legs/9), 0.6, 1.6)          ← "los formatos cortos informan menos"
Elo:   e' = e ± fk · formatK · K(n) · (1 − pA)
Habilidad (EWMA por exposición en LEGS, decaimiento exp(−ln2/halfLifeMatches) por partido):
   avg     ← avg·decay + media·max(1, legs)          (solo si 40 < media < 125)
   per180  ← per180·decay + x180                     (peso: legs jugados)
   checkout ← hits / intentos
Contracción hacia la población:  shr(v, w, pop, k) = (v + pop·k)/(w + k)
   kLegs = shrinkK·9 para media y 180s ; shrinkK·20 para dobles
```

Constantes congeladas (`data/darts/model-priors.json`, `darts-l1-1`): `kScale` **1,0** · `ensembleU` **0,5** ·
`halfLifeMatches` **12** · `shrinkK` **8** · `formatK` **1**.

**En producción manda Orakel, no el EWMA** (`store.js:195-219`): la habilidad de hoy es la ventana de 365 días
**arrastrada hacia la de 90 días por exposición en dardos**, con `KD = 3000`:

```
avg = (avg365·3000 + avg90·dardos90) / (3000 + dardos90)       si dardos90 > 200
per180Visit = 180s / (dardos/3) de la misma ventana, mezclado igual
checkoutPct = (hits365 + hits90) / (intentos365 + intentos90)   si ≥40 y ≥20 intentos
cold = dardos365 < 1500
```
Si Orakel no tiene al jugador (`dardos365 ≤ 300`), se cae al EWMA de la base y `cold = n < 5`.

**Incertidumbre** (`uncertaintyPp`, `store.js:228-232`):
`min(12, 1,5 + thin(expoA) + thin(expoB) + |pElo − pComp|·50 + 1,5·coldA + 1,5·coldB)` con
`thin(e) = min(6, 6·e^(−e/2500))`.

### 3.5 El kernel de visita por dardo (`darts-engine/kernel.js`)

La pieza mecánicamente más ambiciosa de los tres deportes.

- **Alfabeto y reglamento** (`rules.js`): la diana como **orden** de números (`ORDER`), no como coordenadas —
  *"no tenemos coordenadas y no vamos a fingirlas"*. 63 resultados legales. `applyDart` implementa bust (pasar
  o dejar 1), salida exacta en doble y **double-in** del Grand Prix. **Los checkouts se ENUMERAN**, no se
  copian de una lista: `FINISHABLE[1..3]` y `NOT_FINISHABLE_3` = 159, 162, 163, 165, 166, 168, 169.
- **Kernel por dardo** (`dartKernel`, `kernel.js:26-72`): regional. Al triple, la masa que falla se reparte
  entre el single grande del mismo número (fracción `s`, "calidad del fallo") y los vecinos de la diana
  (12,5 % triple / 37,5 % single a cada lado). Al doble: 56 % single del mismo número, 36 % MISS, 4+4 % dobles
  vecinos. Estas proporciones son **priors declarados, no medidas de ningún jugador**.
- **Tres habilidades identificables + derivadas** (`skills`, `kernel.js:75-78`): `pT` (precisión al triple,
  0,05-0,75), `pD` (al doble, 0,08-0,75), `rho` (**arrastre dentro de la visita**: si acertó el triple
  anterior, `p = pT + rho·(1−pT)`), `s` (calidad del fallo, prior élite **0,88**). Derivadas:
  `pS = min(0,93; 0,62 + 0,5·pT)`, `pB = max(0,05; 0,72·pD)`.
- **Política de cierre por PROGRAMACIÓN DINÁMICA** (`policyFor`, `kernel.js:95-138`): `W(r,d)` = dardos
  esperados hasta cerrar desde `r` con `d` dardos en mano; 60 barridos o `Δ < 1e-7`; objetivo elegido entre
  las 62 acciones candidatas con podas de realismo: no se apunta a lo que sobrepasa, ni a dejar 1, ni a cerrar
  sin doble, y *"un single o el 25 solo se apuntan como PREPARACIÓN que deja un doble limpio (par ≤ 40 o
  50); nadie tira a un single para dejarse 43"*. Bust = vuelta a `r` + **medio dardo de penalización**
  (aproximación declarada: *"un bust devuelve a r (no al inicio real de la visita, que la política no
  conoce)"*). Por encima de 170 la política es T20. Caché por `(round(pT·10), round(pD·20))`.
- **Kernel de visita** (`visitKernel`): enumera hasta 3 dardos bajo la política; bust devuelve **exactamente**
  al marcador de inicio y termina la visita. Atajo exacto: desde `r ≥ 182` no hay bust ni cierre posibles, así
  que la distribución de la visita de puntuación pura se enumera **una vez por habilidad** y se reutiliza —
  *"es lo que hace que un leg entero cueste milisegundos"*.
- **El jugador solo ante el 501** (`soloLeg`): DP sobre `[n180][marcador]` hasta `KMAX = 36` visitas →
  `fin[k][n]` (cierra en la visita k con n 180s), `alive[k][n]`, PMF de dardos, `expDarts`, PMF del **valor
  del checkout terminal**, PMF del **doble de cierre**, `exp180`, y `avg3 = 1503/expDarts`. La masa residual
  se **declara** (`residual`), nunca se adjudica.
- **Calibración a lo observado** (`calibrate`, `kernel.js:268-301`): **dos observables, dos parámetros**. La
  media identifica `pT` por bisección; la tasa de 180s identifica `rho`. Se iteran cinco fases
  (`fitT(10) fitR(7) fitT(8) fitR(6) fitT(7)`). `pD` sale del % de dobles (que **es** precisión por dardo al
  doble) o, sin él, de la heurística `0,22 + 0,2·(avg−60)/45`. Sin tasa de 180s, `rho` se queda en el prior
  0,2 y se marca `identified: 'avg'`. Si el ajuste queda a más del 15 % del objetivo:
  `'avg (180s fuera de rango: rho en el tope)'`.
- **El muestreo existe solo para pintar**: *"No hay Monte Carlo en la probabilidad: el muestreo queda para
  pintar trayectorias, no para calcular precios"* (`kernel.js:12-13`).

### 3.6 La carrera del leg y el compilador de formatos (`darts-engine/compiler.js`)

- **Leg** (`legRace`): carrera alternada con absorción —
  `P(A gana | A sale) = Σ_k P(T_A = k)·P(T_B ≥ k)` — llevando **conjuntamente** la distribución de 180s de los
  dos (`n180[nA][nB]`), las visitas y la acumulada del checkout. La masa no cerrada en `KMAX` se reparte
  proporcionalmente y **se declara** (`residual`).
- **Estado de la DP**: masa, conjunta de 180s (hasta `NCAP = 40` por jugador), tres acumuladas de checkout
  (`ckA`, `ckB`, `ckAB` = `P(estado ∧ todos los checkouts ≤ c)`, `CKMAX = 170`) y masa × visitas.
- **Legs** (`runLegs`): primero a N, con o sin dos de diferencia y tope (`max_legs`); el saque **alterna por
  leg**. **Sets** (`runSets`): legs por set, el saque alterna por set, el set decisivo puede llevar extensión
  (`final_set_two_clear`, `final_set_max_legs`); los nodos con el mismo `(sa, sb)` se funden *"para que el
  árbol no crezca exponencialmente"*.
- **Salidas** (`summarize`): `p_a`, `exp_visits`, PMF de legs/sets totales, por jugador, margen y marcador
  exacto; marginales y conjunta de 180s con **"most" y su masa de empate**; `checkout_max` como acumulada.
- **Bull-off desconocido** → se compilan los dos escenarios y se publica la mezcla 50/50 más `scenarios`
  (*"prior simétrico explícito, bloque 4.2"*). Justificación en cabecera: *"Nada se promedia antes de tiempo:
  Eθ[F(p(θ))] ≠ F(Eθ[p(θ)])"*.
- **Formatos** (`rules.js:93-111`): plantillas históricas por torneo (Mundial por sets, Matchplay con dos de
  diferencia y topes 25/27/37/39/41, Grand Prix con **double-in**, UK Open, European Tour, Grand Slam…), todas
  con `certified: false`. En producción manda **el stage oficial de la PDC**, que sí certifica
  (`formatOf`, `store.js:110-121`).

Ensamble: `p_a = σ((1−u)·logit(p_Elo) + u·logit(p_compilado))`, `u = ensembleU = 0,5`.

### 3.7 Puertas, tesis y liquidación

`gate()` (`store.js:253-274`):

| Puerta | Regla |
|---|---|
| `edge` | `≥ 3 pp` |
| `noise` | `edge > unc_pp` (tope 12) |
| `orthogonality` | siempre |
| `push` | `< 8 %` |
| **`format`** | **formato certificado por el brief oficial de la ronda** — sin eso, sin tesis |
| `freshness` | **informativa** desde el 7-sep: *"la incertidumbre epistémica ya castiga al jugador frío… una segunda puerta que además vetaba la tesis dejaba a cero circuitos enteros (MODUS)"* |
| `settleable` | **informativa**: marca las familias de 180s fuera del Players Championship |

Stake ¼ Kelly, tope 2 %. Clave de pick: `event_id|family|participant+side|line`. Mejor cuota entre Pinnacle,
Bovada y Cloudbet (Polymarket excluido). Era `darts-v1-2026-09-06`.

**Liquidación** (`settleShadow`, `store.js:521-590`): resultado oficial de la PDC (`status === 'Result'`,
`score_a/b`) para ML/legs/sets; **MODUS por Flashscore**; **180s desde la base propia (Orakel, solo Players
Championship)**, casando por `fid` o por ±3 días + par de ids. Si la familia es `X180*` y no hay fila con
`x180`, `sin_stats` y se espera. **VOID a los 12 días**, con motivo distinto si era `unsettleable`. Cierres
por cubo idénticos a TT (own/best/pinnacle) desde el 9-sep, con la misma congelación en el saque del 11-sep.

**Track**: por familia, familia × casa y **circuito × familia**, con `clv_own`, `clv_curve` y `clv_salud`.

### 3.8 Validación (`scripts/darts-fit.js`, `data/darts/model-priors.json`)

Protocolo: habilidades **point-in-time** — la ventana de Orakel usada es *"la última con `to` anterior al
primer día del mes del partido"* (`windowBefore`), lo que evita mirar dentro del mes del partido. Desarrollo
desde **20240301** (*"antes no hay ventanas de Orakel cerradas"*) hasta 20260101; holdout 2026 leído una vez.
Rejilla `kScale ∈ {0,7; 1; 1,4} × u ∈ {0; 0,25; 0,5; 0,75; 1}`.

**Desarrollo (n = 13.922)**: log-loss 0,6111 · skill 11,84 % · Brier 0,2119 · AUC 0,724.

**Holdout 2026**

| | n | log-loss | skill % | Brier | AUC |
|---|---|---|---|---|---|
| Elo (todos) | 7.688 | 0,6167 | 11,03 | 0,2146 | 0,714 |
| Elo (mismo subconjunto) | 6.688 | 0,6174 | 10,92 | 0,2149 | 0,713 |
| compilado | 6.688 | 0,6071 | 12,41 | 0,2106 | 0,726 |
| **ensamble** | 6.688 | **0,6045** | **12,79** | **0,2096** | **0,729** |

Nota del archivo: *"El compilador aporta +1,5 pp de skill sobre el Elo en el mismo subconjunto (12,4 vs 10,9)
y la mezcla llega a 12,8 (AUC 0,729 vs 0,713)"*. **Es el único de los tres deportes donde el compilador
mejora al Elo fuera de muestra.**

Calibración del total de legs por formato (MAE vs naif), del mismo holdout:

| best_of | n | MAE | MAE naif | media de legs |
|---|---|---|---|---|
| 11 | **6.458** | 1,245 | 1,250 | 9,03 |
| 13 | 87 | 1,250 | 1,254 | 10,84 |
| 15 | 43 | 1,368 | 1,423 | 12,56 |
| 19 | 76 | 1,902 | 1,960 | 16,16 |
| 21 | 11 | 2,452 | 2,430 | 19,91 |
| 31 | 4 | 1,776 | 2,125 | 27,25 |
| 33 | 2 | 4,726 | 2,500 | 24,50 |
| 9 | 6 | 1,462 | 1,333 | 7,00 |

**Lectura honesta**: en el único formato con muestra (BO11, n = 6.458) la mejora sobre el naif es de **0,005
legs de MAE** — indistinguible de cero. Los formatos donde el modelo parece ganar tienen n ≤ 76.

### 3.9 Variables de entorno (dardos)

| Variable | Default | Efecto |
|---|---|---|
| `GP_DARTS_PUBLIC_ENABLED` | **abierto** (`pubOn`) | `=0` cierra al público |
| `GP_DARTS_TT_FREE_UNTIL` | 2026-09-17 | ventana libre |
| `GP_DARTS_TAIL` | true | `false` apaga la cola diaria |
| `GP_DARTS_MODUS` | encendido | `0/false/no/off` quita la segunda agenda |
| `GP_DARTS_RAW` / `GP_DARTS_OUT` | `/data/darts-raw`, `/data/darts` | crudo y compacto |
| `PINNACLE_GUEST_KEY` | clave de invitado embebida | Pinnacle deporte 10 |
| `CLOUDBET_API_KEY` | — | mercados de Cloudbet |

### 3.10 Debilidades y riesgos (dardos)

1. **El kernel es una construcción de priors, no una medición.** Los repartos del fallo (12,5/37,5 al triple;
   56/36/4/4 al doble), `s = 0,88`, `rho` prior 0,2, `pS = 0,62 + 0,5·pT`, `pB = 0,72·pD` y la penalización de
   "medio dardo" por bust **no están ajustados a datos**: son decisiones declaradas. El código lo dice, pero
   toda la distribución de 180s, checkout y duración descansa sobre ellos.
2. **Dos observables para tres parámetros.** `calibrate` declara que `s` *"con datos de partido no es separable
   de pT"*; y sin tasa de 180s (jugadores fuera de Orakel) `rho` se queda en el prior y la identificación baja
   a `'avg'`. En esos casos la familia de 180s se está cotizando con un parámetro no identificado.
3. **La familia principal es la menos liquidable.** Las 180s son *"la hipótesis principal"* (`store.js:37`) y
   sin embargo solo se pueden liquidar en **Players Championship**, porque es lo único que Orakel publica por
   partido. Fuera de ahí nacen `unsettleable` y mueren **VOID a los 12 días**: se anotan, cuestan cómputo y
   **no cuentan en la muestra**. El preregistro lo asume explícitamente.
4. **MODUS está fuera del preregistro**, que lo excluye del universo, y sin embargo es el circuito que más
   volumen aporta. El track los separa, pero la sombra los mezcla en `picks.json` con la misma regla. Además
   su liquidación depende de Flashscore, una fuente clasificada `DENY` para betting en `RIGHTS.md` (aquí se
   usa como resultado, no como input del modelo — el límite es fino).
5. **Casado por apellido simple** (`marketFor`, `store.js:146-158`): `lastName()` del nombre normalizado.
   Con dos "Smith" o dos "Mawson" en el mismo día, el filtro de ±36 h es lo único que separa. MODUS sí añade
   candados (apellido exacto + inicial, `modus.js:70-78`); el casado del mercado PDC **no**.
6. **Ventanas de Orakel mensuales**: `windowBefore` usa la última ventana cerrada **antes del mes** del
   partido. En producción, en cambio, `skillOf()` usa `o.latest` — la ventana más reciente disponible, **sin
   comprobar que sea anterior al partido**. Para partidos ya pasados dentro de la sombra eso no importa
   (la tesis nace prematch), pero **la validación y la producción no usan exactamente el mismo estado**.
7. **Elo sobre resultados solamente.** El Elo de dardos se alimenta de ganó/perdió con un factor por legs;
   no usa la media de la partida, que es el dato informativo. La habilidad sí usa la media, pero por el canal
   de Orakel, que solo cubre a los jugadores con exposición.
8. **Formatos con tope y "dos de diferencia" reconstruidos a mano** (`formatOf`, `store.js:114-116`): el stage
   de la PDC solo dice "dos legs de diferencia" y el código le pone `max_legs = best_of + 6` y, en la final
   del Mundial, `final_set_max_legs = 11`, de la plantilla. Si una edición cambia el reglamento, la
   distribución de duración estará mal y **la puerta `format` seguirá diciendo "certificado"**.
9. **Derechos**: Orakel es `commercial: DENY` y el deporte está abierto al público. La mitigación
   (`/api/darts/model` y las vistas de motor/rendimiento admin-only) protege lo derivado de Orakel, pero las
   tesis en sí nacen de habilidades de Orakel.

---

## 4. Riesgos transversales a los tres

1. **Ninguna de las tres familias tiene evidencia positiva.** La tabla del 13-sep (HANDOFF §📊) pone a *"TT,
   dardos, LoL hcp, baloncesto, NFL"* en la casilla **"negativo o sin evidencia"**. Y la vara del 11-sep marcó
   **`cerrar`** para `TT GAME_POINTS_HCP cloudbet` (t −2,95 en modelo-contra-precio) — *"Siguen abiertas: es
   cambio de lógica de picks y Alexis no lo ha ordenado"*.
2. **El CLV no es vara válida aquí.** `cierreAporta()` mide que en ninguna de las diez familias del sistema el
   cierre predice mejor que la entrada (|t| < 2), y en TT `POINTS_TOTAL` **la línea no se mueve el 78,8 % de
   las veces**. Los tres deportes declaran en su doctrina que *"la vara es el CLV por familia, no el ROI"* —
   una vara que la propia casa ya midió como no aplicable en la familia que tiene dinero real dentro.
3. **Las tres sombras nacieron con el CLV roto** (cubos en bloque + `rows` machacado con precios en vivo) y se
   arreglaron el 11-sep con rescate retroactivo. `closes.salud()` existe precisamente porque *"en esas la
   CURVA no se puede leer, el CLV sí"*: las curvas T−60→T−1 de las tesis anteriores al 11-sep **no miden
   movimiento de precio**.
4. **Umbral fijo de 3 pp en los tres.** Dos de los tres (TT y dardos) lo complementan con la puerta de ruido
   (`0,75·unc` y `edge > unc`); tenis lo hace con el desacuerdo interno del ensamble + el impuesto por base
   vieja. Ninguno descuenta el **margen de la casa**, que en estos mercados está medido entre 1,97 % (Cloudbet
   `GAME_POINTS_HCP` de TT) y 3,13 % (Cloudbet rondas) por lado — de forma que una ventaja de 3 pp puede ser
   negativa después de comisión.
5. **Muestra insuficiente y declarada.** Los tres `track()` devuelven la misma frase por debajo de 40
   liquidadas: *"con {n} liquidadas TODO es ruido: esta pantalla acumula el registro, no se lee todavía"*. Los
   preregistros piden 60 eventos (tenis TOTAL) y 60 eventos por familia + dos ediciones (dardos); tenis de
   mesa fija el listón en **150 liquidadas por `clv_own`**.
6. **Derechos**: los tres módulos tienen `commercial: UNKNOWN` o `DENY` en su fuente principal
   (Sackmann CC BY-NC-SA, WTT/ITTF, Orakel). Tenis respeta la consecuencia (admin-only). **Tenis de mesa y
   dardos no**, por decisión explícita del dueño registrada con fecha en los dos `RIGHTS.md`.

---

# Parte 8 · Combate (UFC, PFL, boxeo) y Fórmula 1

Esta sección cubre dos deportes que comparten una misma doctrina —**el modelo no manda en el mercado de
ganador**— y que llegaron a ella por caminos distintos y medidos. Combate tiene picks, track, CLV y un
preregistro vivo; F1 no tiene casi mercado y publica "llamadas" en vez de apuestas. Todo lo que sigue sale
del código del repositorio `/home/user/gp-simulador-mundial` y de los documentos que ese código cita.

---

## 8.1 COMBATE — propósito y alcance

### 8.1.1 Qué es y qué publica

Combate es el segundo deporte de la casa (tras fútbol) y el primero construido sobre un motor 1v1. Cubre
**tres organizaciones**, declaradas en un único catálogo (`server.js:10385-10389`):

| org | archivo de peleas | agenda ESPN | feed de cuotas | clave Cloudbet | pool de rating |
|---|---|---|---|---|---|
| `ufc` | `fights-ufc.json` | `ufc` | `mma_mixed_martial_arts` | `mma` | `ufc` + `mma` |
| `mma` (Bellator histórico + PFL activa) | `fights-mma.json` | `pfl` | `mma_mixed_martial_arts` | `mma` | `ufc` + `mma` + `regional` |
| `boxing` | `fights-boxing.json` | **null** (ESPN no tiene boxeo) | `boxing_boxing` | `boxing` | `boxing` |

El pool de rating **no es simétrico y eso está medido**, no elegido por estética
(`server.js:10377-10384`): añadir las 6.795 peleas regionales sube el skill de MMA (0,0318 → 0,0328, acc
63,7 % → 64,1 %) y lo **baja** en UFC (0,0161 → 0,0134, acc 60,9 % → 60,1 %), porque los peleadores del PFL
vienen de esos circuitos y los de UFC casi no. Cada org usa el pool que su propio backtest respalda.

**Tres familias de pick** conviven en `db.combatPicks`:

- **FIGHT** — ganador (h2h). Nace en `buildCombatPicksOrg` (`server.js:16049`).
- **METHOD** — ganador × método (KO/TKO, SUB, DEC), solo contra Cloudbet (`server.js:16183-16203`).
- **ROUNDS** — total de asaltos over/under, solo contra Cloudbet (`server.js:16204-16221`).

**Régimen**: todas nacen con `gate_status:'shadow'` y `regime:'monitor'` (`server.js:16157`), es decir
papel. El comentario de cabecera es explícito: *"TODO regime:'monitor' SIEMPRE (jamás feed público;
db.combatPicks separado, el cuadro público no lo ve)"* (`server.js:10360`). **No hay dinero real en
combate** — el perímetro del ejecutor real (CLAUDE.md, "La regla del dinero") solo incluye tarjetas de
fútbol en Cloudbet, CS2 pausado y tenis de mesa a 5 USD.

**Visibilidad**: desde el 17-ago **FIGHT volvió a monitor admin-only** (`server.js:23974-23977`), con este
motivo escrito en el código: *"el ganador de combate lleva CLV −5,66 % sobre 39 picks —el peor número de
toda la casa— y la semana del 10-17 cerró 2-11 con −9,2u […] Se SIGUE generando y midiendo (el monitor
existe para eso), pero el público deja de verlo"*. ROUNDS (CLV +1,75 %) y METHOD siguen públicos.
Interruptor: `GP_COMBAT_FIGHT_MONITOR` (default `true`).

### 8.1.2 Fuentes de datos, endpoints y frecuencias

| fuente | qué aporta | endpoint | frecuencia / caché |
|---|---|---|---|
| ESPN site API | carteleras futuras MMA/UFC/PFL: `comp_id`, nombres e ids de atleta, `main`, división, rounds pactados | `site.api.espn.com/apis/site/v2/sports/mma/<lg>/scoreboard?dates=…&limit=100` (`server.js:15649`) | ventana **90 días** (`GP_COMBAT_UPCOMING_DAYS`, min 7 / máx 180); memo 10 min en `C.upAt` |
| ESPN site API | **liquidación** MMA: ganador de cada competición | mismo scoreboard, ventana `−10 días → hoy` (`server.js:16294`) | en cada `settleCombatPicks`, tras el build |
| ESPN core API | método fino (KO/Sub/Dec) de una pelea liquidada | `sports.core.api.espn.com/…/competitions/<id>/status` (`server.js:16362`) | solo para picks METHOD/ROUNDS pendientes, con caché por `comp_id` |
| ESPN core API | árbitro y jueces | `…/competitions/<id>/officials` (`scripts/combat-officials-backfill.js:29`) | backfill offline, idempotente |
| ESPN core API | estado EN VIVO (round, reloj, cronología) | `…/competitions/<id>/status` y `/plays` (`server.js:15102`) | caché 20 s |
| The Odds API | consenso h2h (regiones `eu,us`) | `api.the-odds-api.com/v4/sports/<sport>/odds?…&markets=h2h` (`server.js:15762`) | memo **10 min por deporte** (no por org: UFC y PFL comparten feed = cero créditos duplicados) |
| The Odds API | resultados de boxeo (2ª fuente) | `/v4/sports/boxing_boxing/scores?daysFrom=3` (`server.js:16332`) | solo si hay picks de boxeo pendientes |
| Cloudbet Trading API | 2ª casa h2h + **los únicos mercados de método y de rounds** | `/pub/v2/odds/fixtures?sport=…&date=` y `/pub/v2/odds/events/<id>` (`server.js:15805-15828`) | memo **15 min**; máximo **30 detalles por ciclo**; backoff en 429 |
| Wikipedia | histórico completo de boxeo + resultados en caliente | `en.wikipedia.org/w/api.php` (`combat-engine/boxing-results.js:22`) | `boxingResultsSync` cada 30 min, backoff 40 min → 3 h |
| Wikipedia | **pesajes** (quién falló el peso y por cuánto) | backfill offline (`scripts/combat-weighins-backfill.js`) | archivo versionado |
| api-sports | estadística fina de striking/grappling por pelea, 2022+ | `data/combat/afstats-mma.json` (backfill) | join en memoria, invalidado por `mtime` |
| observer de prensa | señal de peso en vivo, layoffs, noticias | `db.combatObservations` (`server.js:10712`) | `GP_COMBAT_OBSERVER_ENABLED` |

**Qué pasa cuando falla la fuente.** Todo el pipeline está escrito para degradar sin romper:
`combatRefreshOdds` deja `C.odds = C.odds || []` en el `catch` (`server.js:15766`); Cloudbet marca su memo
**al inicio** para no martillar si falla (`server.js:15781`); `settleCombatPicks` devuelve
`{settled:0, error:'scoreboard'}` si ESPN no responde (`server.js:16309`); y el colchón final es el
**VOID a las 72 h** del kickoff cuando la pelea no aparece en ninguna fuente (`server.js:16408`).

### 8.1.3 Los datos históricos con los que se calibró

Todo vive en `data/combat/` (46 MB). Medidos hoy:

| archivo | tamaño | contenido | rango |
|---|---|---|---|
| `fights-ufc.json` | 3,8 MB | 9.247 peleas (9.149 completadas), 894 eventos | 1997-02-07 → 2026-10-18 (incluye futuras con `completed:false`) |
| `fights-mma.json` | 1,9 MB | 4.341 peleas (4.318 completadas), 451 eventos | 2009-04-03 → 2026-08-23 |
| `fights-regional.json` | 3,0 MB | 6.795 peleas (6.716 completadas), 1.435 eventos (LFA, Cage Warriors, KSW, RIZIN, M-1, Pancrase, Shooto, Strikeforce, WEC, DREAM…) | 2005-04-08 → 2026-06-19 |
| `fights-boxing.json` | 16,6 MB | **39.384 peleas** (39.292 completadas), `source: "wikipedia"`, `updated_at` 2026-08-17 | 1977-03-19 → 2026-08-16 |
| `fighters-{ufc,mma,regional,boxing}.json` | 1,0 / 1,0 / 1,9 / 0,5 MB | 3.036 / 3.015 / 5.674 / 1.417 fichas (dob, alcance, altura, guardia, campamento, headshot) | — |
| `espnstats-ufc.json` | 14,8 MB | **7.998 peleas** con 34 métricas por peleador (9 celdas de golpeo posición×objetivo intentadas/conectadas, derribos, control, avances, reversiones) | 2010+ |
| `afstats-mma.json` | 1,7 MB | 2.730 peleas de api-sports con 2.341 con filas de stats | 2022+ |
| `officials-ufc.json` | 622 KB | 9.139 peleas, **9.122 con árbitro**; 24 árbitros con ≥60 peleas | — |
| `officials-mma.json` | 68 KB | 4.296 peleas | — |
| `weighins-ufc.json` | 116 KB | 862 eventos: **581 `clean` · 151 `miss` · 130 `no_page`** | — |
| `weighins-mma.json` | 41 KB | 434 eventos: 30 `clean` · 20 `miss` · **384 `no_page`** (cobertura pobre) | — |
| `odds-history.json.gz` | 136 KB | **6.090 peleas de UFC con cuota de cierre** (4.180 fuera de muestra), del *Ultimate UFC Dataset* de Kaggle vía espejo GitHub | 2010-03-22 → 2024-12-14 |
| `calibracion-rutas-ufc.json` | 4,2 KB | temperatura medida del simulador de rutas | ventana 2016-2026 |
| `officials-priors-ufc.json` | 9,6 KB | efectos de árbitro y báscula + su validación | — |
| `market-aware-priors.json` | 4,0 KB | coeficientes del modelo consciente del mercado (**todos 0**) | — |

Detalle importante de procedencia: el histórico de **boxeo lo construyó un crawler de Wikipedia** partiendo
de los campeones, y por eso el propio motor documenta que **la mitad de los perfiles están truncados**
(1.376 boxeadores con página propia y récord completo frente a 1.391 que solo aparecen como rivales de los
anteriores — `combat-engine/boxing.js:63-95`).

---

## 8.2 El rating de peleador: Elo + rasgos (`combat-engine/ratings.js`)

### 8.2.1 El Elo, con sus constantes

```
expected(ra, rb) = 1 / (1 + 10^((rb − ra)/SPREAD))
K(id)            = max(K_MIN, K0 / sqrt(1 + N[id]))
R[ganador] += K(w) · mult · (1 − E)      R[perdedor] −= K(l) · mult · (1 − E)
mult = FINISH_BONUS si el método es KO/TKO/Sub, 1 si es decisión
```

| constante | valor | dónde | por qué (comentario del autor) |
|---|---|---|---|
| `BASE` | 1500 | `ratings.js:11` | prior |
| `SPREAD` | **280** | `ratings.js:12` | *"recalibrado 27-jul: barrido 230-400 → óptimo ~260-300 (skill +0.0062 vs +0.0058 del estándar 400)"* |
| `K0` / `K_MIN` | 64 / 24 | `ratings.js:13` | K alto inicial porque hay pocas peleas por carrera; piso veterano |
| `FINISH_BONUS` | 1,25 | `ratings.js:15` | *"KO/Sub pesan 25 % más que decisión"* |
| `RUST_PER_YEAR` | 28 puntos/año, tope 2 años | `ratings.js:16` | castigo de inactividad, aplicado **al predecir**, no al actualizar |
| `FEAT_LR` | 0,01 | `ratings.js:35` | tasa de aprendizaje del SGD de rasgos |

Empates y NC **no mueven el rating** (`ratings.js:149`).

### 8.2.2 La capa logística de rasgos (la que de verdad predice)

Sobre el logit del Elo se suma una combinación **antisimétrica y sin intercepto** de diferencias de rasgos
(`ratings.js:26-34`, `ratings.js:224-241`):

```
z  = w.elo · logit(p_Elo) + Σ_k w_k · Δfeat_k
p1 = σ(z)
```

Los pesos se aprenden **online, prediciendo antes de actualizar** (`ratings.js:151-165`), lo que hace el
walk-forward nativo y elimina el leakage por construcción. Tres bloques de rasgos:

- **FEATS (8)** — `reach, exp, years, age, chin, streak, mileage, misswt` (`ratings.js:36`). Pesos típicos
  documentados: `age −0,62` (la feature), `years −0,30`, `chin −0,17`, `streak +0,15`, `mileage +0,37`,
  `reach +0,22` (`ratings.js:31-33`). Resultado R2 (28-jul): UFC skill 0,0109 → 0,0166, acc 58,5 % →
  61,0 % (2020-26: 61,9 %); MMA 0,0226 → 0,0289, acc 64,8 %.
- **FEATS_FINE (5)** — `slpm, td15, tddef, ctrl, kdr` (`ratings.js:41`), solo activas cuando **los dos**
  tienen ≥2 peleas con métrica y ≥15 min; si no, valen 0 e **son inertes**. Backtest subset n=805: skill
  0,0220 → 0,0230, acc 62,4 % → 62,9 %, bootstrap P=0,983.
- **FEATS_X (5)** — interacciones de matchup `grap, power, absorb, age5, subth` (`ratings.js:59`).
  **APAGADAS** tras el backtest pareado del 12-ago: *"ninguna interacción mueve el Brier agregado (0.2332
  idéntico; bootstrap P: +absorb 0.773, +grap 0.593, FULL 0.370 — el gate de la casa que shippeó las finas
  fue P=0.983)"* (`ratings.js:52-58`). Se encienden con `COMBAT_X_FEATURES=true` (default off, byte-idéntico).

Las escalas de normalización son explícitas y están en el código: `age` dividido por 8 años, `reach` por 10
pulgadas, `mileage` log/3, `td15` /3, `kdr` /0,5, etc. (`ratings.js:103-128`).

**La señal de peso (`misswt`)** merece atención porque el enunciado del dossier la nombra. Se codifica
lineal y capada: `missW(over) = min(over, 5) / 2` (`ratings.js:85`), y el peso lo **aprende el modelo** —
el comentario dice expresamente que *"el PESO lo aprende el modelo — no se fija a mano el −9pp que midió el
backtest"* (`ratings.js:82-84`, script `scripts/combat-weighin-test.js`). El backfill distingue `clean`
(nadie falló) de `no_page` (desconocido), lo que hace el dataset usable como negativo real
(`scripts/combat-weighins-backfill.js:12-15`). Para una pelea **futura** el pesaje aún no está en
Wikipedia, así que la señal en vivo la pone el observer y se codifica como **2 lbs fijas**
(`combatWeighCtx`, `server.js:10712-10720`): *"la noticia no suele decir cuántas libras → 2 lbs (el umbral
donde el backtest muestra penalización real). Sin señal → null y el modelo queda byte-idéntico"*.

### 8.2.3 El bug de orden que se arregló, y por qué importa

ESPN lista primero al favorito y **f1 gana el 59,8 %** de las peleas. El modelo es antisimétrico sin
intercepto para ser inmune al orden, así que no puede expresar ese 59,8 %: el SGD lo compensaba deformando
los pesos y producía una probabilidad **inflada 7-10 pp hacia el peleador listado segundo — el underdog, que
es justo donde se apostaba**. La corrección: ordenar el pool por id antes de fitear
(`server.js:10467-10475`). Efecto medido: calibración de 0,0730 → 0,0182 con el mismo skill (0,0282).

### 8.2.4 Prior de debutante y explicabilidad

- **Prior de debutante** (`server.js:10506-10519`): para ids sin ninguna pelea en el pool,
  `Elo = 1500 + clamp(±60, 250·(winrate−0,5)·(n/(n+6)))` a partir del récord previo del overlay. Máximo ~8 pp,
  *"deliberadamente tímido — los récords regionales vienen inflados"*, y **jamás pisa un rating fiteado**.
  Se anota en `C.elo.PRIOR` para poder auditarlo.
- **`fightBreakdown`** (`ratings.js:246-262`): contribución exacta de cada factor por *leave-one-out* sobre
  la misma logística que predice (quitar el término i y medir cuántos pp se mueve). De ahí salen los textos
  de "lo que la inclina" (`server.js:16456-16468`), con un diccionario caja-negra que traduce `kdr` →
  "poder de nocaut", `misswt` → "condición en el pesaje", etc. (`server.js:16454-16455`).

### 8.2.5 Método, asaltos y probabilidad en vivo

`methodModel` / `methodProbs` (`ratings.js:297-384`) reparten KO/Sub/Dec con:

```
P(m) = p1·P(m | gana f1) + (1−p1)·P(m | gana f2)
P(m | gana x sobre y) ∝ off_x[m] · (def_y[m] / base[m])^γ
```

con `off`/`def` por peleador encogidos Dirichlet a la base **de su división** (`METHOD_TAU = 8`,
`METHOD_GAMMA = 1`, `TIMING_TAU = 10` — `ratings.js:287`). Backtest walk-forward 27-jul (n=5.817):
**skill multiclase +0,0199 vs base de división** (+0,0344 vs global), estable por era, calibración monótona;
rounds U2.5 3R +0,0086, U2.5 5R +0,0144, finish +0,0081. Grilla tau×γ con plateau 5-8×1 (no en el borde).

Un detalle fino: en **boxeo la sumisión no existe** y con prior fijo 1 el modelo repartía probabilidad a un
desenlace imposible (skill −0,0546); ahora una clase con cero ocurrencias entra con prior 0 y sale del
reparto (`ratings.js:298-305`).

`liveFightProbs` (`ratings.js:393-424`) **no es un modelo nuevo**: renormaliza el mismo reparto condicionado
al reloj. Y deja escrita una limitación: *"ESPN publica los eventos del combate SIN atribuir (un derribo no
dice de quién), así que la dirección la pone el modelo y el reloj; los eventos son contexto, jamás entran
acá"* (`ratings.js:391-392`).

---

## 8.3 El simulador de pelea por fases (`phases.js` + `style.js` + `fightsim.js`)

Esta capa es **análisis, no probabilidad de pick**: `intel.js:58-60` lo dice explícitamente —
*"NO DEVUELVE UNA PICK. […] esta probabilidad NO está anclada al mercado y el modelo de combate no ha
demostrado batir al cierre"*.

### 8.3.1 Perfiles por fase (`phases.js`)

Recorre el dataset granular de ESPN acumulando, por peleador, **lo que hizo y lo que le hicieron**
(`phases.js:50-114`), con **decaimiento temporal de vida media 900 días** (~2,5 años). Salen dos perfiles:

- **striking** (`phases.js:117-156`): ritmo, precisión, defensa (= 1 − precisión que concede, *"lo que el
  peleador controla, no cuánto le tiran"*), reparto por objetivo y por posición, proxy de poder
  (`kd_per15`, `kd_per_100_head`, `ko_rate`), durabilidad (`kd_absorbed_per15`), volatilidad, y las nueve
  celdas posición×objetivo.
- **grappling** (`phases.js:159-206`): derribo (intentos, precisión, defensa, concedidos), control
  (`min_per15`, `per_takedown`, `net_per15`), avance posicional (media guardia / lateral / montada /
  espalda), amenaza de sumisión por minuto de control, amenaza desde abajo, y **la cadena completa**
  derribo → control → avance → amenaza.

**Ajuste por rival** (`phases.js:211-248`): lo observado menos lo que ese rival concede de media, ponderado
por el peso con que se le enfrentó y **encogido por muestra** (`shrink = n/(n+4)`).

### 8.3.2 Vector de estilo y cruce (`style.js`)

Ocho ejes en **percentil de la división** (`style.js:42-51`) más ejes derivados (riesgo, iniciativa,
persistencia, transición) y una **confianza** explícita: `min(n/10, min/60)` acotada a [0,1]
(`style.js:75`) — *"con 3 peleas no se etiqueta a nadie"*. Los arquetipos son reglas legibles, no ML:
*"No es machine learning: es vocabulario"* (`style.js:84-85`).

El cruce (`style.js:114-191`) enfrenta **ataque de uno contra defensa del otro** en cinco dimensiones
(rango, poder-vs-mentón, clinch, derribo, control, sumisión), cada una asignada a una **fase**, y pondera
cada ventaja por la probabilidad de que la pelea llegue a esa fase (`phaseMass`, `style.js:221-244`). Dos
correcciones documentadas:

1. **Los intentos no bastan** (`style.js:224-228`): *"Quien ya domina en el suelo deja de intentar derribos
   —está controlando— así que su tasa de intentos por 15 minutos SUBESTIMA cuánto lleva la pelea al suelo.
   Con solo intentos, Makhachev salía con un 21 % de suelo y una probabilidad de 56 % contra el 75 % del
   mercado."* Se toma el **máximo** entre intentos y tiempo de control, no la media.
2. **El aviso de fase rara** (`style.js:193-217`): el umbral único de 0,40 hacía que el aviso saliera en el
   **100 %** de las rutas por clinch (cuya mediana es 0,103) y en el 41 % de las de suelo. Ahora cada fase
   se compara contra su propio percentil 25: `PHASE_P25 = { pie 0,164 · clinch 0,075 · lucha 0,237 ·
   suelo 0,276 }` (`style.js:212`).

Además publica **fragilidad del pronóstico** (`style.js:170-187`): concentración de la ventaja en una sola
dimensión (`>0,55` = alta).

### 8.3.3 El simulador de rutas (`fightsim.js`)

Simula la pelea asalto a asalto con **riesgos competitivos** (`fightsim.js:296-309`): en cada asalto
compiten cuatro peligros (KO de A, sub de A, KO de B, sub de B); se sortea si ocurre *algo*
(`1 − exp(−Σ)`) y, si ocurre, cuál. El comentario explica por qué: *"Un modelo que estima cada método por
separado y luego normaliza a 1 no captura eso y produce combinaciones imposibles (mucho KO temprano y mucha
decisión)"* (`fightsim.js:11-14`).

Otras piezas del núcleo:

- **Peligros por minuto** (`fightsim.js:48-74`): `KO = poder propio × fragilidad rival × conversión ×
  (0,35 + 0,65·standShare)`; `SUB = intentos por minuto de control × conversión × vulnerabilidad ×
  (0,25 + 0,75·p_suelo)`.
- **Fatiga** (`fightsim.js:282-283`), acelerada por el daño acumulado, y **ruido de noche** gaussiano
  (σ 0,35) común a todos los asaltos.
- **Jueces como distribución** (`fightsim.js:311-326`): tres tarjetas con ruido compartido (σ 0,55) y ruido
  propio (σ 0,42), con 10-8 cuando |seen| > 2,1. De ahí emergen unánime / dividida / mayoritaria / empate.
- **Incertidumbre** (`fightsim.js:385-404`): separa aleatoria (el propio combate) de epistémica (muestra
  corta + concentración de la ventaja).

**El anclaje, que es la decisión más importante del archivo.** La validación sobre 3.140 peleas con ventana
móvil midió (`fightsim.js:91-96`):

| pregunta | resultado |
|---|---|
| **quién gana** | Brier 0,276 contra 0,250 de decir siempre 50 % → **peor que una moneda**; cuando decía 93 % ganaba el 67 %; 7 de 8 tramos fuera de intervalo; resolución 0,004 |
| **cómo termina** | KO 29,4 % predicho vs 32,3 % real · sub 19,4 vs 17,6 · decisión 51,2 vs 50,1 · límite 51,3 vs 50,1 |

Conclusión aplicada: **el ganador lo fija el Elo, el método/asalto/duración los fija este motor**. Se busca
por bisección (12 iteraciones, 1.200 sims por paso) el desplazamiento `tilt` que hace que la simulación
reproduzca `priorA` (`solveTilt`, `fightsim.js:107-115`), y ese tilt entra **en los dos sitios donde se
decide una pelea**: los peligros (`e^{±0,55·tilt}`) y la puntuación del asalto (`fightsim.js:289-290, 312`).

**Calibración de la duración** (20-ago, `fightsim.js:117-172`). Sobre 3.886 peleas 2016-2026 reconstruidas
año a año solo con el pasado, el simulador crudo abría su escala **de 2,4 % a 94,1 %** cuando la realidad
solo se abre **de 42,3 % a 61,4 %** — y su Brier crudo (0,288) era **peor** que decir siempre 49 % (0,250).
La corrección es una temperatura sobre el logit, con parámetros medidos y guardados en
`data/combat/calibracion-rutas-ufc.json`:

```
logit(p') = a·logit(p) + b      a = 0,0985   b = −0,0072   measured: true
validación: n=3.278, 9 de 9 años mejoran, Brier 0,28812 → 0,24693 (−14,3 %)
```

Y no se aplica al número publicado sino **donde vive el error**: se busca por bisección el multiplicador de
los peligros que lleva la finalización simulada al objetivo calibrado (`solveFinish`, `fightsim.js:161-172`),
sobre un **piso de peligro** `PISO = 0,004` (`fightsim.js:150-158`) porque *"multiplicar cero por lo que sea
sigue siendo cero […] ninguna pelea real tiene cero"*.

**Contexto de oficiales y báscula** (`fightsim.js:174-213`). El enchufe existe y **está apagado por su propia
medición**: `officials-priors-ufc.json` trae `arbitros.measured = false` (walk-forward n=6.086, 1 de 12 años
mejora, Brier 0,24658 → 0,24702) y `peso.measured = false` (n=978, 3 de 9 años, Brier 0,2495 → 0,24958). El
comentario es un ejemplo de la doctrina de la casa: *"Dentro de muestra el árbitro parece tener efecto —John
McCarthy termina el 62,4 % frente al 56,9 % esperado, z=2,62— pero con 24 árbitros probados un z de 2,6 es lo
que sale por puro azar"*. `factorContexto` tiene además un **techo duro de ±15 %** (`fightsim.js:210-211`).

El ajuste (`scripts/combat-officials-fit.js`) merece nota metodológica: el efecto de cada árbitro se mide
**contra lo esperado de sus propias peleas** (estrato = división × asaltos pactados × lustro), no contra la
media global, para no medir *a qué peleas mandan al árbitro* (`combat-officials-fit.js:13-17`); los rasgos se
construyen punto-en-el-tiempo (`:61-64`); y el listón de publicación exige **mejorar en agregado Y en la
mayoría de los años** (`:194-195`). El script incluye un "banco de pruebas" que pasa por la misma puerta a
otros cuatro candidatos (tendencia de finalización, parón, edad media del cruce, experiencia del novato).

### 8.3.4 El motor de boxeo (`boxing.js`) — un motor propio, no MMA con guantes

Existe porque **el dataset granular de ESPN no cubre boxeo**: antes `fightIntel` devolvía `available:false`
y boxeo *"no tenía capa profunda, tenía un hueco"* (`boxing.js:4-9`). Lo que hay medido sobre 39.158 peleas
(29.839 desde 2010) son asaltos pactados, asalto y reloj de final, método y ganador. **No hay conteo de
golpes** y el archivo lo dice sin rodeos: *"Cualquier 'jab/power split' que diga salir de conteos de golpes
en este producto sería inventado, y no lo va a ser"* (`boxing.js:14-15`).

Tres mediciones ordenan el diseño (`boxing.js:17-34`):

1. **Que la pelea termine antes del límite es predecible**: AUC 0,665 fuera de muestra, calibración
   monótona (25,7 % en el decil bajo → 75,3 % en el alto).
2. **El calendario no aporta nada**: AUC 0,497 usando solo asaltos pactados — *"exactamente una moneda"*.
3. **El "poder" distingue el cuándo mucho mejor que el cómo**: KO seco vs TKO AUC 0,549; finalización
   temprana AUC 0,601. Por eso el reparto KO/TKO/RTD se publica **marcado como débil**.

**La guardia (zurdo/diestro) NO entra al modelo**: hay dato para 1.296 de 1.406 peleadores del índice, pero
en las peleas desde 2018 **los dos** tienen guardia conocida apenas el **19,5 %** de las veces
(`boxing.js:37-41`).

Piezas del motor:

- **Perfiles** con decaimiento de **1.100 días** (más largo que MMA a propósito: un boxeador pelea 2-3 veces
  al año — `boxing.js:169-171`) y **encogimiento empírico-bayesiano en asaltos**: `PRIOR_ROUNDS = 34`
  (`boxing.js:240-241`), sin el cual *"Usyk entraba al simulador con fragilidad exactamente cero"*.
- **Peligro de la liga medido de los totales**, no de una media de tasas: 18.204 finalizaciones en 172.765
  asaltos → 0,1054 por asalto y pelea, **0,0527 por lado y asalto** (`boxing.js:216-226`).
- **Cruce por tramos** (temprano 1-3 / medio 4-7 / profundo 8-12), con la masa por tramo derivada del
  peligro conjunto y no del calendario (`boxing.js:537-547`).
- **Simulador** con tarjeta de 10 puntos como esqueleto, derribo que reescribe el asalto (10-8 / 10-7 y
  ×3,2 sobre el peligro de ese asalto) y **RTD como familia propia** solo entre asaltos y del 3º en adelante
  (`boxing.js:563-580, 718-778`). `KAPPA_FIN = 0,50` está **ajustado contra la tasa real fuera de muestra**
  (predice 50,5 % contra 51,1 % real; la primera versión predecía 69,7 %) y `KD_RATIO = 1,15` es un
  **supuesto declarado** porque no existe conteo de caídas en el dato (`boxing.js:606-612, 627`).

Resultados fuera de muestra (2.768 peleas de 2017+, ventana móvil por bloques — `boxing.js:43-50`):
¿se rompe? AUC 0,694, Brier 0,221 vs 0,250; ¿cuándo? asalto medio 5,11 vs 5,30 real; ¿cómo? KO 16,3/17,1,
TKO 30,0/29,4, RTD 4,2/4,7, decisión 47,2/48,9; **¿quién gana? Brier 0,204 vs 0,250, 67,1 % de acierto**.

Y aquí está la decisión doctrinal más interesante de todo el módulo (`boxing.js:52-61`): **aunque en boxeo
el motor SÍ distingue al ganador, el ganador va anclado igual**, por dos razones que no son la de MMA:
*"(a) el principio que gobierna el sistema entero está medido en dos deportes: el mercado de ganador es
donde se pierde dinero, tenga o no habilidad el modelo. Discriminar no es batir a un cierre; (b) 3 de 8
tramos siguen descalibrados y el ECE es de 3,62 pp"*.

El **récord truncado** se midió, se intentó corregir y **se tiró** (`boxing.js:63-95`): la truncación sesga
la rotura propia −62,9 % (t −37,0) y la fragilidad +145,7 % (t +17,6), pero los perfiles truncados
**predicen mejor** (AUC 0,744 vs 0,685) porque *"que solo lo conozcamos por sus derrotas contra buenos es en
sí mismo información"*. El ajuste por calidad de rival rompió el nivel (28,8 % de finalización predicha
donde ocurre el 50,3 %) y se revirtió.

---

## 8.4 El modelo consciente del mercado (`market-aware.js`)

Nace de un hecho medido el 2-sep sobre 4.180 peleas de UFC con cuota de cierre: **el modelo market-blind no
añade información al cierre** (`docs/COMBATE_CUOTAS_HISTORICAS.md §3`):

| | n | Brier | log-loss | acierto |
|---|---|---|---|---|
| **Cierre del mercado** | 4.180 | **0,2120** | **0,6118** | 66,0 % |
| Elo puro | 4.180 | 0,2434 | 0,6797 | 57,0 % |
| Modelo actual (Elo + rasgos + finas) | 4.180 | 0,2343 | 0,6610 | 61,0 % |
| Blend 0,5 (el del monitor) | 4.180 | 0,2180 | 0,6263 | 65,5 % |

Pareado: modelo − cierre **+0,0223 (t +11,2)**; blend 0,5 − cierre **+0,0060 (t +6,1)**; y el peso óptimo de
la mezcla lineal es **w\* = 1,00 global**, con 0,90/0,85/0,95 en 2015-2017 y 1,00 de 2018 a 2024. *"En ningún
año hay un w interior que mejore al cierre."*

El módulo plantea la pregunta de forma honesta (`market-aware.js:1-17`): el cierre como **ancla** y cada
rasgo como **corrección residual sobre su logit**.

```
logit(p) = close · logit(p_cierre) + Σ feats[i] · x_i
```

con `x_i` los 13 rasgos de `featDiff` más `delo = logit(p_elo) − logit(p_cierre)`
(`market-aware.js:23`). Los coeficientes salen del backtest walk-forward por año (entrena < año, evalúa el
año; rasgo activo solo con ≥200 filas ≠0) y viven en `data/combat/market-aware-priors.json`. **Veredicto:
ninguno pasa**:

| variante | Δlog-loss vs cierre (t) | Δ vs cierre **recalibrado** (t) |
|---|---|---|
| cierre recalibrado (solo `a`) | −0,00084 (−2,37) | — |
| + `age` (el único candidato) | −0,00180 (−2,28) | **−0,00095 (−1,45)** |
| + `reach` | −0,00106 (−1,88) | −0,00021 (−0,48) |
| + `delo` | −0,00090 (−1,82) | −0,00006 (−0,16) |
| físicos (7) / rasgos (13) | −0,00193 (−1,85) | −0,00109 (−1,12) |
| full (delo + 13) | −0,00182 (−1,73) | −0,00098 (−1,00) |
| `misswt`, `slpm`, `td15`, `tddef`, `ctrl`, `kdr` | inertes (sin muestra con cuota) | 0 |

El archivo queda con `close = 1` y **todos los rasgos a 0**, `variante: "cierre_solo"` y el veredicto escrito
dentro. Con coeficientes nulos `marketAwareProb` devuelve `pClose` **exacto, sin pasar por clamp/logit**
(`market-aware.js:61`), y `loadPriors` con archivo ausente o roto devuelve ceros: *"el modelo nunca tumba la
creación de la pick"* (`market-aware.js:72-73`).

Lo único con |t| > 2 es **recalibrar el cierre**: `close = 1,1119` (t 28,7), que el archivo interpreta como
**sesgo favorito-longshot del de-vig proporcional**, no como un rasgo del modelo, y por eso no se publica
solo — es una decisión pendiente sobre `combatFightOdds` (`docs/impl/combat-mkt-REPORT.md`, Pendientes).

En la pick FIGHT se persisten `p_mkt_aware` y `edge_mkt_aware_pp` **dentro de un `try`** y de forma
puramente informativa (`server.js:16140-16152`): con coeficientes 0, `p_mkt_aware = k` y
`edge_mkt_aware_pp = 0`, así que hoy todo el track cae en el cubo `lt2`.

---

## 8.5 De modelo a pick: cómo nace exactamente una pick de combate

### 8.5.1 FIGHT (ganador) — la secuencia completa

`buildCombatPicksOrg(org, out, dryRun)` (`server.js:16049`), por cada evento y cada pelea:

1. **Solo prepartido** (`Date.parse(ev.date) > now`) y sin `date_tbd` (`server.js:16088-16089`).
2. **Guarda de placeholder** (`CBM.isPlaceholderDate`, `monitor.js:91-96`): una fecha `-12-31T22:` / `T23:`
   o **una pelea a más de 120 días** (`PLACEHOLDER_MAX_DAYS`) se salta entera. Motivo escrito: las 11 picks
   de boxeo del 10-17-ago sobre "Moses Itauma" nacieron así y **acabaron todas VOID** (`server.js:16090-16093`).
3. **Filtro anti-peleas-fantasma** (`server.js:16057-16085`): *"un peleador NO pelea dos veces en ±3 días.
   Si el calendario dice que sí, alguna de esas peleas es fantasma y no se apuesta NINGUNA de las dos —
   elegir cuál es la real sería adivinar"*.
4. **Regla de muestra**: `N[f1] ≥ 3 && N[f2] ≥ 3` (`server.js:16103`). Motivo: *"con <3 peleas el Elo es el
   prior 1500 disfrazado"* — el modo exacto de fallo de la cartelera del 31-jul (tres picks sobre
   peleadores con muestra 0-1, las tres perdidas).
5. **Cuotas** (`combatFightOdds`, `server.js:15909`): para cada casa de The Odds API se hace **de-vig 2-way
   proporcional** (`fair = (1/oH)/((1/oH)+(1/oA))`); el consenso es la **mediana** de esos fair; la mejor
   cuota por lado se guarda con su casa. Cloudbet entra como **una casa más** (`server.js:15945-15952`).
   Basta **1 casa** para el monitor (PFL solo cotiza en Cloudbet) y `books` viaja en la pick.
   El matching de nombres tiene dos pasos: índice global y, si falla, `combatPairMatch` — **apellido exacto
   o ≥2 tokens por lado, ambos lados a lados distintos, orientación ambigua → null**
   (`server.js:15893-15908`).
6. **Apertura**: la primera cuota vista de cada lado se congela en `db.marketOpenings`
   (`server.js:16109-16113`).
7. **El blend y el umbral** (`server.js:16116-16126`):
   ```
   blend = 0,5·modelo + 0,5·consenso_sin_vig
   eg    = (blend − consenso)·100          ← en puntos porcentuales
   se toma el lado con MAYOR eg, exigiendo  eg ≥ 2 pp   y   cuota < COMBAT_MAX_ODDS (3)
   ```
8. **El techo de cuota 3** tiene su autopsia escrita (`server.js:16032-16039`), sobre las 40 primeras
   liquidadas: `@1-3` n=15, 9-6, ROI **+30,7 %**, CLV +2,6 %; `@3-5` n=12, 2-10, ROI −31,4 %, CLV −5,4 %;
   `@5+` n=13, 1-12, ROI −37,5 %, CLV −7,0 %. Y el control: *"apostar el lado CONTRARIO en cuota ≥3 habría
   ido 22-3"*.
9. **Stake**: **cuarto de Kelly** sobre el blend, acotado a [0,25 %, 3 %] (`server.js:16127, 16166`).
10. **Etiquetas del preregistro** (`CBM.pickTags`, `monitor.js:37-55`) — ver §8.5.3.
11. **Modelo consciente del mercado** (informativo) — §8.4.
12. **Dedup y congelación** (`server.js:16265-16278`): una sola ACTIVE por (pelea, familia). Una pick nueva
    **supersede** a la vieja (`result_code:'SUPERSEDED'`) salvo que falten **≤15 min** para el kickoff, en
    cuyo caso la vieja queda **congelada** y la nueva no entra: *"la vieja quedó congelada cerca del KO → no
    se contradice"*.

El `pick_id` es determinista: `sha256('cb-' + comp_id + '|FIGHT|' + side)` truncado a 16
(`server.js:16056, 16155`).

### 8.5.2 METHOD y ROUNDS — solo contra Cloudbet

`server.js:16174-16221`. Diferencias con FIGHT:

- **Una sola fuente** (Cloudbet), de-vig del **mercado completo** (`mkt = (1/price)/Σ(1/price)`), no 2-way.
- **Umbral más alto: 2,5 pp** post-blend (mismo blend 0,5), mismo techo de cuota 3, una pick por familia y
  pelea.
- METHOD exige que el mercado tenga **≥4 selecciones** y descarta `draw` (`server.js:16186-16189`).
- ROUNDS convierte el modelo de método a P(over línea) con **interpolación uniforme dentro del asalto**
  (`combatModelOverRounds`, `server.js:16443-16451`), documentada como aproximación: *"suficiente para monitor"*.
- Las derivadas guardan menos etiquetas: solo `market_fair_at_create` y `hours_to_event`
  (`server.js:16425-16426`).

### 8.5.3 El preregistro `prereg_fav45` y el monitor degradado

Ambos viven en `combat-engine/monitor.js`, que es **puro** (sin db, sin red, `now` por parámetro) y que
**repite a propósito** las constantes de la compuerta en vez de importarlas, *"para que la regla
preregistrada quede congelada en su propio archivo"* (`monitor.js:11-13`).

| constante | valor | efecto |
|---|---|---|
| `BLEND_W` | 0,5 | peso del modelo, solo para juzgar la degradación |
| `EDGE_MIN_PP` | 2 | ventaja mínima post-blend, ídem |
| `DRIFT_MAX` | 0,05 | nuestro lado se alargó >5 % → degradada |
| `T24_WINDOW_H` | 26 | la foto se toma entre 26 h y 0 h del campanazo |
| `PREREG_FAV_K` | **0,45** | favorito "amplio" del mercado |
| `PLACEHOLDER_MAX_DAYS` | 120 | pelea más lejana = rumor de cartelera |
| `MKT_AWARE_EDGE_PP` | 2 | corte del track para `edge_mkt_aware_pp` |

**Etiquetas al nacer** (`pickTags`, `monitor.js:37-55`): `market_fair_at_create` (la k del consenso de
NUESTRO lado, 4 decimales), `fav_market` (k ≥ 0,50), **`prereg_fav45` (k ≥ 0,45)**, `espn_order_home`
(nuestro lado es el f1 que ESPN lista primero; `null` en boxeo, cuya agenda no sale de ESPN),
`weigh_signal` (`{over1, over2, sched}` tal cual `combatWeighCtx`), `press_signals` (claves `lado:codigo`
de `combatIntelFlags` + `combatNewsFlags`, deduplicadas) y `hours_to_event`.

**Por qué 0,45 y no 0,50**: *"el 0,45 y no el 0,50 es para no perder los pick'em"*
(`docs/PREREGISTRO_COMBATE_FAVORITO.md`). La evidencia que lo motiva: en las 48 FIGHT liquidadas al 2-sep,
comprar al **perro** dio CLV **−8,64 ± 2,47** (t −3,5, n=34) y al **favorito** **+3,31 ± 1,73** (t +1,9,
n=14), diferencia +11,95 ± 3,02 (t 4,0); y en 2.031 picks simuladas al cierre 2015-2024, favorito amplio
ROI **+5,2 ± 3,0 %** frente a perro **−4,8 ± 3,6 %**.

**La regla preregistrada, tal cual está declarada**: familia FIGHT, regla fija (blend 0,5, ≥2 pp, techo 3,
muestra ≥3, filtros de fantasma/placeholder), subconjunto `prereg_fav45 = true`, **muestra de las primeras
40 liquidadas** tras el corte, vara principal **CLV medio** con su error estándar. Éxito: CLV medio > 0.
Fracaso: CLV medio < −2 **con t < −1,5**. Entre medias: inconcluso, se extiende a 80. Y lo que **no** se
hace durante la muestra: *"ni tocar el peso del blend, ni el umbral, ni el techo, ni convertir la etiqueta
en compuerta"*.

**Re-evaluación a T−24 h** (`t24Eval`, `monitor.js:63-87`, llamada desde `server.js:16257`). Sobre picks
FIGHT **ACTIVE** cuya hora al evento cae en (0, 26] h, y **una sola vez** (`if (p.t24_at) return null` — la
foto no se mueve):

```
drift_t24_pct     = (odds_t24 / best_odds − 1) · 100           (>0 = nuestro lado se alargó)
edge_blend_t24_pp = (0,5·model_prob + 0,5·fair_t24 − fair_t24) · 100
degraded_monitor  = drift_t24_pct > 5   OR   edge_blend_t24_pp < 2
```

`degraded_reason` dice cuál de las dos. **No cambia el status**: la pick sigue ACTIVE y liquida igual.
`t24_hours_to_event` registra cuándo se tomó de verdad, *"si el servidor estuvo caído, puede ser T−3 h, y
eso hay que poder verlo"* (`monitor.js:58-60`). Un bug real encontrado por el smoke y corregido: `2,1/2,0−1`
da `0,05000000000000004` y degradaba una deriva exacta del 5 %; ahora se juzga sobre el valor redondeado a 2
decimales (`monitor.js:70-72`).

La hipótesis preregistrada de la regla 2 es que las degradadas tengan **peor** CLV, y el criterio de retirada
está escrito: si con 40 degradadas liquidadas su CLV medio no es peor con t > 1,5, *"la regla no vale como
veto y se retira"*.

---

## 8.6 Liquidación de combate

`settleCombatPicks` (`server.js:16283-16412`) toma todas las ACTIVE cuyo kickoff ya pasó y resuelve por
cascada de fuentes:

1. **MMA/UFC/PFL — ESPN scoreboard** de los últimos 10 días (`server.js:16289-16308`). Se indexa por
   `comp_id` **y por pareja ordenada de ids de atleta**: `results['par:' + ids.sort().join('~')]`. Esta
   segunda llave nació de una autopsia real (PFL Tampa, 25-ago): *"ESPN renumeró la competición —la pick
   guardaba 401881999 y el marcador publicó la misma pelea como 401913635"*. Los ids de atleta sí son
   estables.
2. **Boxeo — Wikipedia primero** (`server.js:16313-16328`), vía `db.boxingResults`, que rellena
   `boxingResultsSync` cada 30 min (`server.js:15488`). El parser resuelve **una** pelea concreta contra la
   tabla "Professional record" de los dos boxeadores, con tolerancia de ±3 días, y **nunca inventa**: si hay
   0 filas es "aún no publicada" y si hay >1 es ambiguo, y en ambos casos devuelve `null`
   (`boxing-results.js:155`). Distingue `null` (no está todavía → reintentar) de `undefined` (fallo de red).
   Esta fuente trae **ganador, método y round**, o sea que también liquida METHOD y ROUNDS, *"que con el
   /scores de la Odds API (marcador pelado) era imposible"*.
3. **Boxeo — The Odds API `/scores`** como segunda fuente (`server.js:16329-16351`), matcheada por par con
   candidato único, y solo con marcador numérico desigual.

**Reglas de resolución** (`server.js:16371-16408`):

| caso | resultado |
|---|---|
| hay resultado y **no hay ganador** (empate / NC) | `VOID`, 0 unidades |
| FIGHT: `winner_id == pickedId` | `WIN`, `units = best_odds − 1`; si no, `LOSS`, −1 |
| METHOD: ganador correcto **Y** clase de método correcta | `WIN`; si no, `LOSS` |
| ROUNDS: se calcula el tiempo transcurrido y se compara con `line · rlen` | `WIN`/`LOSS` |
| METHOD/ROUNDS sin método resoluble y **>72 h** desde el kickoff | `VOID` |
| ninguna fuente tiene la pelea **>72 h** después | `VOID` — *"cancelada/reprogramada — sin fuente no se inventa"* |

Un bug de liquidación ya corregido y documentado en ROUNDS: **el asalto dura 5 min en MMA y 3 en boxeo**;
con 5 fijos, *"un 'over 4.5 rounds' de boxeo se liquidaba contra un reloj que no existe"* (`server.js:16394-16397`).

Hay además un mecanismo **activo** de anulación: el **vigilante de cartelera** (`combatCardWatch`,
`server.js:15682`) diffea la cartelera contra el ciclo anterior y, con dos guardas (la cartelera madre sigue
en el feed **y** dos ciclos consecutivos sin ver la pelea), hace **VOID inmediato** sin esperar las 72 h. Su
origen: Powell vs Yagshimuradov se canceló y *"la pick se quedaba viva y VISIBLE tres días después de que la
pelea dejara de existir"*.

**CLV**, calculado en el momento de liquidar (`server.js:16373-16375`):

```
clv_pct = (best_odds / closing.odds − 1) · 100
```

donde `closing` es la **última foto pre-pelea** de la misma fuente que creó la pick (`combatFightOdds` para
FIGHT; Cloudbet para METHOD/ROUNDS), refrescada en cada ciclo de 30 min mientras la pelea sea futura
(`server.js:16224-16252`). Positivo = se tomó **mejor** precio que el cierre. El comentario añade la
doctrina: *"el dato se guarda SIEMPRE para el análisis"*.

**Jobs**: `buildCombatPicks()` + `settleCombatPicks()` a los 150 s del arranque y después **cada 30 minutos**
(`server.js:16498-16501`), tras el gate `GP_COMBAT_PICKS_ENABLED === 'true'`.

---

## 8.7 Medición: el track y sus desgloses

`combatPicksTrack` (`server.js:16470-16495`) agrega **solo** las SETTLED con `WIN`/`LOSS` (las VOID y
SUPERSEDED nunca cuentan) y devuelve:

- `total`, **`main`** (`card_slot === 'main'`) y **`prelim`** (el resto) — el "track separado en cartelera
  principal y preliminares" del enunciado. La partición nace con la pick: `card_slot` sale de si los
  apellidos de los dos peleadores aparecen en el nombre del evento (`server.js:15656`), y arrastra
  `league_band: 'eficiente' | 'blanda'` (*"main cards líquidas, prelims perezosas"*, `server.js:16159`).
- `active`.
- **`fight_breakdown`**, solo de FIGHT (`CBM.trackBreakdown`, `monitor.js:124-143`), con cuatro cortes:
  `prereg_fav45.{si,no}` · `degraded_monitor.{si,no,sin_t24}` · `clv_by_side.{favorito,perro}` ·
  `mkt_aware_edge.{ge2,lt2,sin_dato}`.

Cada cubo se agrega con `aggClv` (`monitor.js:99-115`):

```
hit      = wins/n · 100
units    = Σ units          roi_pct = units/n · 100
clv_avg  = media de clv_pct (solo los no nulos)
clv_sd   = sd muestral (n−1)     clv_se = sd/√n     clv_t = clv_avg / clv_se
```

Las picks anteriores al despliegue de las etiquetas **se derivan de `market_prob`**, que es la misma k
(`monitor.js:117-120`), y caen en `degraded_monitor.sin_t24` porque nunca tuvieron foto.

### 8.7.1 Lectura del dato medido a 14-sep-2026

El enunciado de esta auditoría aporta la foto del track a 14-sep. Así se reconstruye cada número desde el
código (los valores son los del dossier; el código es el que los produce):

| número | de dónde sale exactamente |
|---|---|
| **140 apuestas, 42,9 % de acierto, −10,12 unidades, CLV medio −1,35** | `combatPicksTrack().total` sobre `db.combatPicks` SETTLED WIN/LOSS; `units` con `best_odds − 1` / −1 (`server.js:16388, 16401, 16405`); `clv_avg` de `clv_pct` (`server.js:16486`) |
| **favoritos CLV +3,78 (t 1,67) vs perros −7,52 (t −3,62)** | `fight_breakdown.clv_by_side` (`monitor.js:133`), corte por `fav_market` (k ≥ 0,50) o, en picks viejas, por `market_prob` |
| **con `prereg_fav45` CLV +1,99 vs −7,91 sin él (t −3,51)** | `fight_breakdown.prereg_fav45.{si,no}` (`monitor.js:127`), corte por k ≥ **0,45** |
| **"sin señal a 24 h" CLV −5,16 (t −2,61)** | `fight_breakdown.degraded_monitor.sin_t24` (`monitor.js:131`): picks en las que `degraded_monitor` **no es booleano**, o sea que nacieron antes del despliegue del monitor o nunca llegaron a la ventana (26 h → 0 h) con el servidor vivo |

**Qué dice esto, leído con el código en la mano.**

1. El track completo (−10,12 u en 140, CLV −1,35) confirma la razón por la que FIGHT está en monitor
   admin-only desde el 17-ago y por la que el techo de cuota 3 existe.
2. **El corte por lado es el hallazgo robusto y el único que sobrevive**: +3,78 contra −7,52, con t −3,62 del
   lado del perro. Es exactamente el patrón que el preregistro declaró el 2-sep (entonces +3,31 vs −8,64) y
   que el backtest de 2.031 picks simuladas al cierre replicó (+5,2 % vs −4,8 %). Tres muestras
   independientes apuntando al mismo sitio.
3. **La regla `prereg_fav45` (0,45) sigue viva pero más floja que el corte estricto** (+1,99 frente a +3,78).
   Eso invierte, con más muestra, la relación que el backtest histórico mostraba (donde el amplio +5,2 %
   batía al estricto +1,0 %), y es información relevante para la revisión: la franja 0,45-0,50 podría estar
   aportando ruido en vivo aunque aportara valor en simulación. **El código no toma esa decisión** — es
   exactamente lo que el preregistro prohíbe cambiar a mitad de muestra.
4. **El cubo `sin_t24` (−5,16, t −2,61) NO es un resultado del monitor, es un artefacto de cobertura**: son
   picks que nunca pasaron por la re-evaluación, es decir en su mayoría picks **anteriores** al despliegue
   del 2-sep. Su CLV malo mide la era vieja, no la regla. Comparar `si` contra `no` (que sí son
   contemporáneas) es la única comparación limpia de la regla 2, y es la que el preregistro declara.
5. Ningún corte de `mkt_aware_edge` puede decir nada todavía: con coeficientes 0, `edge_mkt_aware_pp` es 0
   para todas y el 100 % cae en `lt2` (`monitor.js:134-141`).

### 8.7.2 Sondas y auditoría

- `GET /api/internal/combat-picks?key=$GP_EXPORT_KEY` → `enabled`, `track`, `active`, `total`, estado de
  Cloudbet por org, `card_watch` y `market_aware` (priors cargados) (`server.js:24723-24740`).
  `?picks=1` vuelca **el libro completo pick a pick** — *"sin esto no se puede hacer la autopsia del track"*.
  `POST` (o `?dry=1`) fuerza un ciclo build+settle.
- `GET /api/combat/state?org=…` (admin) sirve `picks_track.fight_breakdown`, que es como se lee el
  preregistro cada lunes (`docs/PREREGISTRO_COMBATE_FAVORITO.md`, "Cómo leerlo el lunes").
- **Archivo propio de cuotas** (`combatOddsArchive`, `server.js:10910-10953`): un snapshot por ciclo al
  disco persistente, **solo cuando algún precio se movió** (dedupe por firma), techo de 240 snapshots/día.
  Su razón de ser: *"No existe histórico comprable de líneas de MMA […] Cada día sin archivar es data
  perdida PARA SIEMPRE"*. De ahí se alimenta `combatLineMoves` (`server.js:15018`), que compara el
  movimiento del mercado con nuestro lado preferido (`with_us`).

---

## 8.8 Variables de entorno — combate

| variable | default | efecto |
|---|---|---|
| `GP_COMBAT_PICKS_ENABLED` | (vacío = off) | enciende el ciclo de 30 min de build+settle (`server.js:10366, 16498`) |
| `GP_COMBAT_MAX_ODDS` | **3** | techo de cuota para todas las familias (`server.js:16040`) |
| `GP_COMBAT_FIGHT_MONITOR` | `true` | FIGHT invisible para el público y fuera de su track (`server.js:23974-23977`) |
| `GP_COMBAT_PUBLIC_ENABLED` | off | pestaña de combate para no-admin |
| `GP_COMBAT_PUBLIC_SINCE` | `2026-08-05T00:00:00Z` | corte del track público: solo peleas con kickoff posterior (`server.js:16497`) |
| `GP_COMBAT_UPCOMING_DAYS` | **90** (min 7, máx 180) | horizonte de la agenda ESPN (`server.js:15646`) |
| `GP_COMBAT_OBSERVER_ENABLED` | off | observador de prensa de combate (`server.js:16528`) |
| `GP_COMBAT_FREE_UNTIL` | — | ventana libre de plan |
| `COMBAT_X_FEATURES` | off | enciende las 5 interacciones de matchup; **no pasaron el gate** (`ratings.js:60`) |
| `GP_BOXING_RESULTS` | `true` | sincronización de resultados de boxeo desde Wikipedia (`server.js:16505`) |
| `GP_BOXING_BACKFILL` | — | backfill histórico de boxeo |
| `SPORTSBOOK_PROVIDER_API_KEY` | — | The Odds API (cuotas h2h y `/scores` de boxeo) |
| `CLOUDBET_API_KEY` | — | sin ella no hay METHOD ni ROUNDS ni cuotas de PFL (`server.js:15780`) |
| `GP_EXPORT_KEY` | — | llave de todas las sondas internas |

---

## 8.9 Debilidades, supuestos y riesgos que se ven en el código (combate)

1. **El modelo pierde contra el cierre y el sistema lo sabe.** t +11,2 en Brier pareado sobre 4.180 peleas,
   y `w* = 1,00` en todos los años desde 2018. Aun así **la compuerta sigue siendo blend 0,5 + 2 pp**, es
   decir sigue naciendo picks con un modelo que está medido como peor que el precio. Es una decisión
   deliberada (no cambiar la regla a mitad de muestra), pero es una deuda abierta.
2. **El de-vig proporcional está medido como sesgado** (`close = 1,1119`, t 28,7 — sesgo favorito-longshot)
   y **no se ha corregido**. Afecta a la `k` de **todas** las picks, o sea al umbral, al lado elegido y al
   propio `prereg_fav45`. Está listado como pendiente en `docs/impl/combat-mkt-REPORT.md`.
3. **El "cierre" del backtest histórico no dice casa ni hora** (`docs/COMBATE_CUOTAS_HISTORICAS.md §5`), y
   nuestro `closing` real es la mediana de un consenso multi-casa minutos antes. No son la misma cosa y
   comparar CLV entre ambos mundos es delicado.
4. **Consenso con una sola casa.** `mo.books < 1` es el único filtro (`server.js:16105`): una pick puede
   nacer con la "mediana" de un solo libro (PFL, siempre Cloudbet). El campo `books` viaja en la pick, pero
   **no hay umbral mínimo de casas** y ninguna de las tablas del track segmenta por `books`.
5. **`weigh_signal` en vivo es una constante disfrazada de medición**: 2 lbs fijas si el observer detecta
   una noticia de peso (`server.js:10716`). Ni la magnitud ni la fiabilidad de la noticia se miden, y la
   feature `misswt` fue entrenada con las libras **reales** de Wikipedia. Hay, por tanto, un desajuste
   entrenar/servir en la única feature de contexto que entra al λ.
6. **La cobertura de pesajes de MMA es casi nula**: 384 de 434 eventos son `no_page` frente a 130 de 862 en
   UFC. La feature es efectivamente solo de UFC.
7. **El histórico de boxeo está truncado en la mitad de los perfiles** y el propio motor lo documenta con
   sesgos de −62,9 % y +145,7 %. Se decidió no corregir (con buen argumento y buena medición), pero el
   sesgo sigue ahí y afecta a todo lo que se publica de boxeo.
8. **`KD_RATIO = 1,15` es un supuesto declarado, no una medición** (`boxing.js:607-612`), calibrado a ojo
   para que la proporción de peleas con derribo caiga en la banda pública ~35-45 %. Toca el 10-8, las
   remontadas y el reparto KO/TKO.
9. **El motor de rutas y el Elo pueden discrepar del propio panel.** `fightIntel` ancla el ganador a
   `priorA` solo **si el llamador lo pasa**; sin ancla, el propio `disclaimer` avisa de que el ganador está
   *"medido PEOR que una moneda"* (`intel.js:93`). Es un pie de fallo silencioso si una vista futura olvida
   pasar el prior.
10. **La liquidación depende de una sola fuente por deporte** y el colchón es un VOID a 72 h. En MMA, un
    cambio de numeración de ESPN ya provocó una liquidación fallida (arreglada con la llave por pareja); en
    boxeo, Wikipedia puede tardar y el `/scores` de la Odds API depende de créditos que *"hoy están
    agotados"* (`boxing-results.js:5-7`).
11. **ROUNDS interpola uniformemente dentro del asalto** (`server.js:16448`) — es una aproximación
    reconocida, y es precisamente la familia con el único CLV positivo de combate, o sea la que más
    merecería un tratamiento exacto.
12. **`fight_breakdown` mezcla eras.** El track acumulado clasifica las picks viejas por `market_prob`, de
    modo que `prereg_fav45.si/no` **no es el preregistro**: para leerlo hay que filtrar además por
    `created_at ≥ corte`, y *"el script de revisión que lo haga"* sigue en Pendientes
    (`docs/impl/combate-REPORT.md`).
13. **Riesgo de caza de subconjuntos.** El breakdown ofrece cuatro cortes × tres cubos; con 140 picks
    liquidadas, mirar los doce y quedarse con el mejor es exactamente el error que el propio repositorio
    prohíbe en otros sitios. El preregistro protege **uno** de esos cortes; los demás no están protegidos.
14. **El archivo de cuotas es caro en memoria**: el propio código anota que el ciclo
    leer-gunzip-parsear-serializar-gzip *"materializa el archivo del día entero SEIS veces en memoria a la
    vez, y es SÍNCRONO"*, con ~1,4 GB transitorios entre las tres organizaciones (`server.js:10943-10946`).
15. **`fights-*.json` contiene peleas futuras con `completed:false`** (98 en UFC) que se comportaban como
    fantasmas al fusionar; se arregló con la regla "manda lo resuelto" (`server.js:10402-10418`), pero la
    contaminación de esas filas en cualquier script que lea el archivo directamente sigue siendo un riesgo.

---

## 8.10 FÓRMULA 1 — el gemelo de carrera

### 8.10.1 Propósito y alcance

F1 es un **terminal de inteligencia**, no un generador de picks — y es así **por falta de mercado, no por
falta de modelo**. La doctrina está escrita como una constante del propio módulo
(`f1-engine/store.js:22`): *"F1 corre como TERMINAL DE INTELIGENCIA: el modelo de carrera está validado
walk-forward (holdout 2025→) y su fuerza está ANTES de la clasificación […] Con la parrilla ya publicada la
casilla predice mejor que el modelo en todas las familias medidas, así que ahí no publica: es el mismo
criterio que cierra el mercado de ganador."*

Es **admin-only** (`GP_F1_PUBLIC_ENABLED` sin poner, `server.js:20722`) y **market-blind por construcción**:
*"ninguna cuota entra a la probabilidad"* es regla dura número 1 de `data/f1/RIGHTS.md`.

### 8.10.2 Fuentes y datos históricos

| fuente | qué da | licencia / clase |
|---|---|---|
| **Jolpica-F1** (`api.jolpi.ca`, sucesor de Ergast) | resultados, clasificación, parrilla, estado DNF/DSQ, puntos, vueltas, calendario, 1950→hoy | **CC BY 4.0** — `attribution_ok`, *"la mejor clase de derechos de todos los deportes de la casa"* |
| The Odds API | — | **comprobado 18-ago-2026: el plan no expone claves de F1/motorsport** |
| Kalshi | contratos `KXF1RACEPODIUM` y `KXF1TOP10` | mercado real con libro de órdenes |
| OpenF1 / FastF1 | telemetría | **`research_only`, fuera de v1 por doctrina** (no otorgan derechos comerciales) |
| ESPN racing | agenda en vivo | `informal_public_endpoint` |

Base compacta en `data/f1/`: **`races.json` (661 KB, 263 carreras, 63 pilotos, ventana 2014-2026**, última
completada ronda 11 de 2026, el GP de Hungría del 26-jul — `data/f1/meta.json`), `schedule.json`,
`assets.json` y `model-priors.json`. Los crudos **no se versionan** (regla 4 de `RIGHTS.md`); el harvest
(`scripts/f1-harvest.js`) los reduce en la misma pasada, y es educado con la tasa pública (limit=100,
~350 ms entre páginas, backoff de 20 s en 429).

**Overlay en disco**: `refreshSeason` (`store.js:63-101`) baja el año en curso cada 6 h y escribe
`<DISK_DIR>/overlay.json`, que **pisa** la base del repo al cargar (`store.js:43-62`). Con eso la
clasificación del sábado hace que el estado pase solo a POS-QUALI.

### 8.10.3 El rating Coche × Piloto (`f1-engine/ratings.js`)

Estado latente en línea, **walk-forward puro**:

- Las observaciones son **z-scores de campo** —posición final y clasificación normalizadas al tamaño de la
  parrilla— para ser comparables entre eras (`ratings.js:48-51`), mezcladas con peso `wq` para la quali.
- **El coche primero** (media de sus pilotos), **el piloto después** como *residual sobre el estado PREVIO
  del coche* (`ratings.js:61-73`). Usar el estado previo y no el actualizado evita que el piloto absorba su
  propia contribución.
- Medias exponenciales con vidas medias `hlCar` / `hlDrv` (α = ln2/hl).
- **Abandonos separados**: `carDnf` (fiabilidad) y `drvDnf` (incidentes), con α lento.
- **Corte de temporada y de reglamento** (`ratings.js:37-43`): al cambiar de año la **confianza** decae
  (`w *= seasonKeep`), y en un año con cambio de reglamento (`REG_BREAKS = {2022, 2026}`) el coche decae
  **más** (`seasonKeep · regimeKeep`) mientras el piloto conserva `+driverKeepBonus`: *"la mano viaja, el
  coche no"*. El **valor medio se conserva**, lo que decae es el peso.
- La predicción encoge por muestra: `v · w/(w+shrinkK)` (`ratings.js:28-32`).
- DNF esperado: `clamp(0,02; 0,45; dnfBase + 0,5·(carDnf+drvDnf)/2)` — *"el mismo evento no se cuenta dos
  veces"* (`ratings.js:88`).

**Constantes congeladas del fit** (`data/f1/model-priors.json`, `model_version: "f1-twin-1"`, construido el
2026-08-19):

| | valor fiteado | default del módulo |
|---|---|---|
| `hlCar` | **6** | 10 |
| `hlDrv` | **15** | 25 |
| `wq` | **0,35** | 0,45 |
| `regimeKeep` | **0,6** | 0,35 |
| `seasonKeep` / `driverKeepBonus` | 0,8 / 0,15 | igual |
| `hlDnf` / `shrinkCar` / `shrinkDrv` / `shrinkDnf` / `dnfBase` | 30 / 2 / 4 / 8 / 0,03 | igual |
| simulador: `sigma` / `gridW` / `sims` | **0,4 / 0,7 / 4.000** | — |
| `blendU` (peso del prior de casilla) | **0,4** | — |

### 8.10.4 El gemelo de carrera (`f1-engine/sim.js`)

Cada iteración muestrea **una carrera entera**, no 22 apuestas independientes (`sim.js:3-7`):

```
rendimiento_i = perf_i + gridW · z(parrilla_i) + sigma · N(0,1)
si U < dnf_i  → el piloto abandona (valor −∞)
orden final = ordenar el field superviviente
```

De **las mismas simulaciones** salen ganador, podio, top-6, puntos (top-10), posición esperada,
distribución completa de posición y DNF efectivo — *"no pueden contradecirse"*. El H2H entre compañeros usa
el mismo mecanismo con semilla desplazada (`sim.js:68-84`). El generador es **determinista por semilla**
(mulberry32), con semilla `season·100 + round` (`store.js:189`), lo que permite contrafactuales con *common
random numbers*.

El **ensamble de ganador** solo se aplica pos-quali (`store.js:196-207`):

```
p_win ∝ p_sim^(1−u) · gridPrior[casilla]^u        u = blendU = 0,4
```

con `gridPrior` = P(ganar | casilla) histórica construida **solo con desarrollo**.

### 8.10.5 Validación: `scripts/f1-fit.js` y sus resultados

Metodología (`f1-fit.js:1-13`): constantes barridas **solo en desarrollo (2014→2024)**, holdout intocable
(**2025→hoy**) evaluado **una sola vez**. El cambio de reglamento de 2022 **cae dentro del desarrollo**, y
ahí se mide `regimeKeep`, *"y esa constante medida es la que 2026 hereda"*. Se validan **dos estados de
información por separado**: PRE-QUALI (sin parrilla, `gridW = 0`) y POS-QUALI (parrilla real).

Resultados guardados en `data/f1/model-priors.json` (n = 35 carreras de holdout; los Brier por piloto sobre
n = 721 filas):

| familia | POS-QUALI modelo | POS-QUALI baseline | PRE-QUALI modelo | PRE-QUALI baseline |
|---|---|---|---|---|
| ganador (log-loss) | 1,3887 (ensamble **1,15**) | **1,058** (casilla) | 1,9981 | ln 20 = 3,00 (uniforme) |
| podio (Brier) | 0,0674 | **0,0619** | **0,0860** | 0,1244 |
| puntos (Brier) | 0,1745 | **0,1657** | **0,1907** | 0,2500 |
| DNF (Brier) | 0,1061 | 0,1068 | 0,1061 | 0,1068 |
| duelo de compañeros (acierto) | 72,5 % | **74,3 %** (casilla) | **66,2 %** | 60,2 % (forma del campeonato) |
| Spearman del orden | 0,687 | — | 0,687 | — |

La lectura está escrita literalmente en el código (`store.js:239-247`): *"DESPUÉS de la clasificación, la
casilla ya sabe todo lo que sabe el modelo y algo más […] El gemelo PIERDE contra mirar la parrilla. ANTES
de la clasificación no hay parrilla que mirar y ahí el modelo gana claro"*. Y la regla que se deriva:
**las llamadas SOLO salen en pre-clasificación**; con parrilla en la mano, `takesFor` devuelve
`available:false` con el motivo escrito (`store.js:344-348`). **El abandono queda fuera en los dos estados**:
0,1061 contra 0,1068 *"es un empate, y un empate no es una llamada"*.

### 8.10.6 De modelo a "llamada" y a pick

`takesFor(round)` (`store.js:325-490`) genera tres familias:

- **PODIO**: `p_podium ≥ 0,55` **o** apartarse ≥15 pp de la tasa de podio del piloto **esta temporada**
  (con `p_podium ≥ 0,30`).
- **PUNTOS**: solo si se aparta ≥15 pp de su temporada (con ≥3 carreras de referencia) **y el lado
  publicado es además el desenlace más probable del modelo**. Esta segunda condición se añadió por un fallo
  real: *"salían cosas como 'Hamilton NO puntúa' con GP dándole 76 % de puntuar — el hueco existía, pero el
  lado era el contrario"* (`store.js:367-371`).
- **DUELO de compañeros**: `h2hProb` sobre las mismas simulaciones, con umbral `p ≥ 0,62`
  (`store.js:389`), y se anota si contradice a la tabla del campeonato (`contra_referencia`).

La **referencia de temporada** (`seasonRates`, `store.js:497-518`) existe porque sin mercado es la única vara
honesta: *"'Stroll no puntúa' al 98 % no es una llamada, es el calendario"*.

**Cuando hay precio, la llamada se convierte en pick.** Kalshi cotiza justo las dos familias donde el modelo
bate al baseline pre-quali (`store.js:262-272`). `f1PickFrom` (`store.js:306-323`) exige:

| guardia | valor | motivo escrito |
|---|---|---|
| `F1_MIN_EDGE_PP` | **4 pp** | *"No se ajusta sobre el holdout — el holdout ya se gastó midiendo si el modelo sirve"* |
| `F1_MIN_OI` | **200** de interés abierto | *"Un precio que nadie sostiene no es una opinión contraria: es un hueco en la pantalla"* |
| `F1_MAX_RATIO` | **2,5×** p_mercado | *"el modelo daba 11,2 % de podio a un piloto que el libro paga a 1,5 % […] es que nuestra cola es más gorda que la suya justo donde tenemos menos datos"* — desconfianza declarada en la propia cola |

Con esas tres se calcula `is_pick`; si no pasa, `blocked` explica por qué y la tesis se queda en llamada.
El **stake** es cuarto de Kelly con **tope 2 %** (`store.js:472-480`), y solo se decora con la card de la
casa lo que tiene precio: *"Una llamada sin contrato detrás no es una pick […] ponerle la card de pick sería
sugerir que se puede jugar"*.

**Anotación y liquidación.** Las llamadas **se anotan solas** en el job, no al abrir la pantalla — *"una
llamada anotada después no vale nada"* (`server.js:1042-1044`). `f1Job` (`server.js:1038-1060`) corre a los
7 min del arranque y **cada 6 h**: refresca la temporada, comprueba cobertura de cuotas, emite llamadas para
las **próximas cinco rondas** y liquida. La memoria vive en `<DISK_DIR>/takes.json`, con dedup por clave
`season|round|familia|sujeto|lado` (`recordTakes`, `store.js:519-531`).

`settleTakes` (`store.js:532-563`) liquida contra el resultado oficial de Jolpica: PODIO = `pos ≤ 3`,
PUNTOS = `pos ≤ 10` (invertido si el lado es "no"), DUELO = `pos_a < pos_b` y **VOID si alguno de los dos no
clasificó**. `takeTrack` (`store.js:564-590`) publica n, acierto y **Brier por familia**, con una nota que
es puro estilo de la casa: *"con menos de veinte llamadas liquidadas ningún porcentaje significa nada
todavía. Se publica igual porque esconderlo hasta que luzca bien es exactamente lo que no hacemos"*.

**Lectura narrada**: `f1RaceRead` (`server.js:13490-13513`) arma un dossier con los seis favoritos y sus
probabilidades y lo pasa por `llm.escribirVerificado` (el verificador de lecturas de la casa), persistiendo
en `db.f1Reads`.

### 8.10.7 Debilidades y riesgos (F1)

1. **El holdout es minúsculo para el ganador**: n = 35 carreras. El log-loss del ensamble (1,15) sigue
   **peor que el baseline de casilla (1,058)** pos-quali, y las diferencias pre-quali, aunque grandes, se
   apoyan en las mismas 35 carreras y 721 filas.
2. **El barrido de constantes y el `blendU` se eligieron en desarrollo, pero `TAKE_MIN`, `MIN_GAP` y el
   umbral del duelo (0,62) no se validaron contra nada**: son cortes de producto elegidos a mano
   (`store.js:249, 355, 389`). El código es honesto sobre el listón de mercado (4 pp, sin tocar el holdout)
   pero no sobre estos.
3. **`currentField` usa la alineación de la última carrera completada** (`store.js:109-113`): un piloto
   sustituto, un debut o un cambio de asiento entre carreras no aparecen hasta que corren.
4. **El `dnfBase` y el shrink son globales**, sin distinción de circuito. No hay efecto de trazado en
   ninguna parte del modelo: el gemelo no sabe que Mónaco y Monza no son la misma carrera.
5. **La referencia de temporada tiene una autorreferencia sutil**: las llamadas se emiten por apartarse de
   la temporada del piloto y el track se puntúa (Brier) contra el resultado, pero la *referencia* también
   viaja en la llamada — si nunca se compara el Brier del modelo contra el de la referencia, el historial no
   demuestra que el modelo aporte sobre ella.
6. **Riesgo de derechos**: `RIGHTS.md` obliga a atribución CC BY 4.0 de Jolpica donde se enseñe la base.
   `ATTRIB` viaja en `raceBoard` (`store.js:225`), pero nada en el código garantiza que la UI lo pinte.
7. **Dos rutas de picks conviven** en `takesFor`: la de "anomalía contra la temporada" y la de "ventaja
   contra Kalshi" (`store.js:401-420`). Están deduplicadas por clave, pero son criterios distintos que
   producen el mismo objeto `pick`; el track no las separa.
8. **El `takes.json` vive en disco persistente**, no en `db.json`, y no hay copia: si el disco se pierde, el
   historial de llamadas —que es *"el único juez"* según el propio módulo— se pierde con él.

---

## 8.11 Resumen de la sección

- **Combate** tiene tres modelos encadenados: un **Elo de peleador con capa logística de rasgos**
  (el que predice al ganador, skill 0,0166 en UFC), un **modelo de método/asaltos** encogido a la división
  (skill +0,0199 multiclase) y un **simulador de rutas por fases** que está medido peor que una moneda para
  el ganador y muy bien para el método — por eso el ganador se **ancla** al Elo por bisección y el motor de
  fases manda solo donde sabe. Boxeo tiene su **propio motor** con datos y vocabulario propios.
- La pick nace de `blend = 0,5·modelo + 0,5·consenso`, umbral **2 pp** (2,5 en derivadas), **techo de cuota
  3**, cuarto de Kelly, y tres filtros de higiene (muestra ≥3, anti-fantasma ±3 días, placeholder >120 días).
- El sistema **sabe y documenta que su modelo no bate al cierre** (t +11,2 en 4.180 peleas), y en vez de
  cambiar la regla a mitad de muestra **preregistró** un corte (`prereg_fav45`, k ≥ 0,45, 40 liquidadas,
  vara = CLV) y un monitor de degradación a T−24 h que **etiqueta sin vetar**.
- El track a 14-sep (140, 42,9 %, −10,12 u, CLV −1,35) valida la decisión de tener FIGHT en monitor, y su
  corte más robusto sigue siendo el del lado del mercado (+3,78 favoritos vs −7,52 perros, t −3,62).
- **F1** es el caso extremo de la misma doctrina: un gemelo de carrera validado que **gana claro antes de la
  clasificación y pierde contra la casilla después**, y que por eso **no publica nada pos-quali**. Con
  contratos de Kalshi utilizables emite picks con tres guardias declaradas (4 pp, 200 de interés abierto,
  2,5× de cola); sin ellos, llamadas fechadas que se liquidan solas.

---

# Parte 9 · Capa de ejecución y medición: sombra, ejecutor real, Polymarket y la vara

Esta sección cubre **lo que ocurre después de que un motor decide una pick**: cómo se anota en papel, cómo (y si)
se convierte en dinero, cómo se liquida, cómo se mide y con qué vara se decide si una familia merece capital.
Todo lo que sigue sale del código citado; donde algo no está implementado se dice explícitamente.

El orden real de una señal es:

```
motor (pick) → ejecutor en la sombra (papel, precio ejecutable)
                    └─► ejecutor REAL (Cloudbet)  → relay en país permitido → casa
                            └─► confirmación → liquidación → reconciliación → contabilidad
                    └─► registro de cierres (CLV) → LA VARA (lib/vara.js) → línea de parada (parada.js)
```

Hay además dos ramas laterales que no cuelgan del sombra: el canal de **tenis de mesa** al dinero real
(`real-executor/tt.js`), el **ejecutor de Polymarket** (`polymarket/ejecutor.js`, con su sombra
`propfirm/polyshadow.js`), y un **escáner de mercado/arbitraje** (`market-scanner/`, `arb-engine/`,
`exec-opportunities/`) que está apagado por defecto y nunca publica solo.

---

## 9.1 Ejecutor en la sombra (paper-trading) — `server.js:13783-14344`, `14804-14935`

### Propósito y alcance
Paper-trading del edge candidato: simula, con el precio real de publicación, lo que un apostador habría hecho
con **bankroll inicial de $2.000** siguiendo SOLO los segmentos en verificación (`server.js:13783-13789`). No
coloca nada en ninguna casa: registra, liquida con el resultado real de la pick y compone el bankroll. Corre
desde el 12-ago.

Estado inicial (`shadowInit`, `server.js:13792-13803`):

```js
db.shadow = { start_bankroll: 2000, bankroll: 2000, currency: 'USD',
              cfg: [ {key:'cards_under_v1', sport:'futbol', family:'CARDS', side:'under', frozen_at, note:'REGLA CONGELADA…'} ],
              bets: [], reports: [], last_report_week: null }
```

**Regla de gobierno declarada:** «agregar un segmento = entrada NUEVA anotada, jamás edición silenciosa ni
retroactiva» (`server.js:13786-13787`). Las enmiendas se anotan en el propio `cfg` (`amended_exec`,
`server.js:13962-13965`).

### Segmentos congelados
Se añaden dentro de `shadowSweep()` de forma idempotente:

| Segmento | Deporte/juego | Familia · lado | Casas | Congelado | Base declarada en el código |
|---|---|---|---|---|---|
| `cards_under_v1` | fútbol | CARDS · under | ejecutables | 12-ago (`13797`) | regla congelada, todos los gates internos del motor |
| `corners_over_v1` | fútbol | CORNERS · over | ejecutables | 17-ago (`13973-13979`) | 60 picks, 68 % acierto a cuota media 1,93, +23 % ROI, 5 semanas en verde, CLV neutro. El espejo: CORNERS *under* acierta 66 % y **pierde**, porque a 1,51 ese acierto es el punto de empate |
| `cs2_rounds_v1` | esports · cs2 | RONDAS_HANDICAP | auto `cloudbet`, manual `pinnacle` | 25-ago (`13998-14005`) | 158 picks, +17,57 u, CLV +2,39 % sobre 106 medidas. **Aviso escrito**: Pinnacle n=79 +12,22 u CLV +2,82 %; Bovada n=55 +5,76 u CLV +2,04 %; Cloudbet n=24 **−0,40 u** CLV +1,48 % → «la ventaja vive en Pinnacle… si el segmento solo pudiera ejecutar en Cloudbet estaríamos midiendo la esquina donde el edge no está» |
| `lol_kills_hcp_v1` | esports · lol | KILLS_HANDICAP | auto `cloudbet`, manual `pinnacle` | 31-ago (`14016-14023`) | 221 picks, 60,6 % acierto, +15,96 u. **Aviso**: CLV plano (+0,04 % sobre n=86, sd 1,8): «en un mercado muerto el CLV no informa, así que aquí la vara son los RESULTADOS contra el juice real» |

La maquinaria de **combate** está lista pero apagada: se enciende añadiendo un segmento `{sport:'combate',
family:'ROUNDS'|'FIGHT'|'METHOD'}` (`server.js:14030-14033`). La familia hermana de CS2 (`RONDAS`, totales sin
hándicap) se excluye por medición: 104 picks, −8,65 u (`server.js:13997`).

### Stake
`shadowStake` (`server.js:13804-13808`), con `SHADOW_STAKE_CAP = 0.015` y `SHADOW_STAKE_MIN = 5`
(`13790-13791`):

```js
f     = max(0, (p·odds − 1)/(odds − 1)) / 4           // Kelly/4
stake = min(0.015, f || 0.015) · bankroll             // tope 1,5 % del bankroll VIVO
stake = max(5, round(stake, 2))
```

> Arista documentada y conservada a propósito: `f || CAP` hace que **Kelly = 0 caiga al tope**, no a cero
> (`real-executor/store.js:140-143`). Se conserva para que papel y dinero usen la fórmula idéntica.

### Precio de entrada: solo lo ejecutable
Corrección de Alexis del 13-ago: «a la mejor cuota no tiene sentido» (`server.js:13809-13812`). La entrada es el
precio **vivo de las casas conectables por API**, con frescura ≤ 60 min, leído de
`sportsbook_goal_quote_current` (`shadowExecQuote`, `server.js:13830-13844`). Lista por defecto:
`GP_SHADOW_EXEC_BOOKS = cloudbet,polymarket,myriad,kalshi` (`server.js:13828`). Mapa de familias:
`{CARDS→cards_total, CORNERS→corners_total, GOALS→match_total, SOLID→match_winner}` (`13829`).

**Pinnacle evaluada y descartada como venue** (17-ago, `server.js:13817-13827`): cerró su API pública el
23-jul-2025; solo la da por solicitud a apostadores de alto volumen. Sigue siendo **fuente de precio y baremo
del CLV del sector**, pero no venue.

Sin cuota ejecutable, la señal se sella como **no ejecutable** con su porqué (`shadowUnexecDiag`,
`server.js:13855-13875`), en tres diagnósticos:

- `solo_casas_no_conectables` — el mercado existe y está fresco, pero solo en casas sin API (se listan cuáles).
- `cotizacion_vieja` — una casa conectable lo cotizó, pero la última observación pasa de 60 min.
- `mercado_no_cotizado` — nadie cotiza esa familia/línea: «la pick nació de un precio que ya no existe».

La ventana de reintento es hasta **30 minutos antes del saque** (`server.js:14133`, y equivalentes en esports
`14094` y combate `14057`); pasada esa ventana se sella.

### Liquidación en la sombra (`server.js:14179-14264`)
- Se copia el `result_code` de la pick; `pnl = stake·(odds−1)` si WIN, `−stake` si LOSS, 0 si PUSH/VOID.
- **«Una apuesta colocada no se des-coloca»** (19-ago, `server.js:14183-14204`): antes, si el motor re-emitía la
  señal, la pick quedaba `SUPERSEDED` y la apuesta heredaba ese código con pnl 0 — «9 de 30 apuestas figuraban
  sin desenlace… su stake entraba al denominador del ROI aportando cero». Ahora una `SUPERSEDED` se liquida
  contra el **total real del partido y SU PROPIA línea**; si no hay dato, queda abierta y solo a las **72 h**
  del saque se anula (`14195-14199`). **Excepción**: el arreglo excluye los segmentos `cs2_*`
  (`if (code === 'SUPERSEDED' && b.segment && !/^cs2_/.test(b.segment))`, `server.js:14192`).
- Dos reparaciones retroactivas: re-liquidación de `SUPERSEDED` viejas ajustando el bankroll **por la
  diferencia** (`14222-14238`) y re-liquidación cuando la pick de esports se corrige (`resettled_from`,
  volteo de kills, `14239-14256`).
- **Dos CLV por fila** (`server.js:14207-14218`):
  - `b.clv` = el de la **pick** (mejor cuota al publicar contra mejor cuota al cierre).
  - `b.clv_exec = ((odds_ejecutada / closing) − 1) · 100` = el de **esta operación**.
  Motivo escrito: copiar el CLV de la pick producía filas imposibles como «entrada 1,96 → cierre 2,47 → CLV 0».

### Agregados
`shadowBySegment` (`server.js:14804-14841`) por segmento: señales, apostadas, no ejecutadas, ritmo/día desde el
`frozen_at` **acotado a la ventana pedida**, vía (auto/manual), W-L, staked, pnl, `roi_pct`, cuota media, stake
medio, `clv_exec_avg`.

`shadowSummary` (`server.js:14843-14902`) añade:
- `haircut_avg_pct` = media de `100·(odds_ejecutable/ref_best_odds − 1)` — «el costo real de ejecutar».
- `exec_rate_pct` = apostadas / (apostadas + no ejecutables).
- Bloque **`capacidad`** (20-ago, `14873-14900`), que separa dos cosas que llevan a decisiones opuestas:
  `sin_via_de_ejecucion` (nadie conectable cotiza: «no se arregla con ingeniería») frente a `fallos_propios`, y
  publica `exec_rate_conectable_pct` = apostadas / (apostadas + fallos propios). Medido en el comentario: las
  tarjetas y córners de MLS «solo viven en DraftKings, BetRivers, MyBookie y LeoVegas, y ninguna tiene API
  pública de apuestas».

`shadowWeeklyReport` (`server.js:14903-14935`): correo al admin los **lunes UTC**, dedup por semana ISO
(`last_report_week`), con 7 días + desde el inicio + capacidad + el bloque de la sombra de Polymarket.

### Reloj
`shadowSweep` + `shadowWeeklyReport` cada **10 minutos**, con arranque a los 150 s, solo si
`GP_CLUBS_SHADOW_ENABLED` está encendido (`server.js:14953-14959`, `clubsShadowOn` en `server.js:7869`).
Los dos correos diarios del ejecutor real (plan 08:00, parte 23:30 hora local UTC−4) se comprueban cada 5 min con
memoria por fecha (`server.js:14936-14951`).

---

## 9.2 Ejecutor REAL de Cloudbet — `real-executor/store.js` (1.393 líneas)

### Qué es y qué no decide
«Es el hermano gemelo del ejecutor en la sombra… con UNA sola diferencia: al final hay una llamada que mueve
dinero» (`store.js:1-8`). **No elige partidos, no calcula probabilidades, no valora nada**: recibe una apuesta
ya decidida por el sombra y contesta «¿se puede colocar esto, ahora, con seguridad?» (`store.js:10-11`).

El enganche es literal: el ejecutor real se llama **dentro del bucle del sombra**, sobre la misma fila que el
sombra acaba de anotar (`server.js:14153-14166`). El comentario explica por qué: «así, por construcción, el papel
y el dinero ven la misma señal al mismo precio en el mismo instante, y toda diferencia entre los dos registros es
ejecución —deslizamiento, rechazos, topes de la casa— y no dos criterios distintos discutiendo».

### El perímetro, cerrado por código
`store.js:39-44`: `SEGMENTO='cards_under_v1'`, `FAMILIA='CARDS'`, `LADO='under'`, `CASA='cloudbet'`,
`MARKET_KEY='soccer.total_bookings'`. No son variables de entorno: «un ejecutor de dinero real cuyo alcance se
pueda ampliar poniendo una variable en un panel es un accidente esperando a que alguien se equivoque de casilla»
(`store.js:13-17`). La puerta `intentar()` comprueba las cinco condiciones y sale si falla alguna
(`store.js:776-781`).

### Configuración y frenos (`CFG()`, `store.js:51-72`)

| Variable | Default | Efecto |
|---|---|---|
| `GP_REAL_ENABLED` | **false** | interruptor maestro; apagado por defecto a propósito |
| `GP_REAL_DRY` | **true** | ensayo: hace todo y en el último paso escribe la petición en vez de enviarla |
| `GP_REAL_CURRENCY` | `USDT` | moneda de la cuenta |
| `GP_REAL_NOTIONAL` | 2000 | banco **nocional** sobre el que se calcula el stake (sube/baja con el P&L) |
| `GP_REAL_STAKE_CAP_PCT` | 1,5 % | tope del Kelly/4 |
| `GP_REAL_STAKE_MIN` / `GP_REAL_MAX_STAKE` | 5 / 45 | suelo y tope duro en dólares |
| `GP_REAL_STAKE_FLAT` | 0 (=off) | stake **plano** que manda sobre la fórmula (CLAUDE.md: hoy 40) |
| `GP_REAL_MAX_OPEN` | 400 | exposición abierta simultánea |
| `GP_REAL_MIN_BALANCE` | 40 | suelo de cartera |
| `GP_REAL_DAY_STOP_PCT` | 6 % | pérdida diaria que apaga hasta mañana |
| `GP_REAL_LOW_BALANCE` | 150 | umbral de aviso por correo |
| `GP_REAL_MAX_SLIP_PCT` | 3 % | deslizamiento máximo tolerado contra el precio de papel |
| `GP_REAL_CF_ESPERA_MIN` | 30 | minutos de silencio tras tres respuestas de cortafuegos |
| `GP_REAL_RECHAZOS_TOPE` | 3 | rechazos de cuenta seguidos que paran TODO el ejecutor |
| `GP_REAL_KICKOFF_MAX` | (sin poner) | ventana de saque: nada con saque posterior |
| `GP_REAL_BANDAS_VETADAS` | `eficiente` | bandas de liga donde el dinero real no entra |
| `GP_REAL_UNA_POR_PARTIDO` | `on` | una posición por partido + lado (sin la línea) |
| `GP_REAL_EXIGIR_VENTAJA` | false | si se enciende, filtra las picks con Kelly ≤ 0 |
| `GP_REAL_CS2_ENABLED` / `GP_REAL_CS2_AUTO` / `GP_REAL_CS2_STAKE` | true / false / 5 | canal CS2 (hoy **pausado**) |
| `GP_REAL_TT_ENABLED` / `GP_REAL_TT_STAKE` | true / 5 | canal tenis de mesa |

`frenos(stake, kickoff)` (`store.js:201-239`) los evalúa **en orden de gravedad**: apagado → sin API key →
fuera de ventana → parada diaria (`pnl_del_día ≤ −dayStopPct·nocional`) → exposición máxima (donde lo
`EN_ACEPTACION` **también cuenta como expuesto**, `store.js:156-161`) → cuenta restringida → puerta cerrada por
cortafuegos → sin fondos. Detalle deliberado: **saldo `null` no frena** («"no lo sé" no es "está vacía"»,
`store.js:235-237`).

### Stake
`stakeDe` (`store.js:134-146`): si hay `stakeFlat` manda él (acotado por tope/mínimo); si no, Kelly/4 sobre el
banco nocional vivo con la misma arista `f || stakePct` del sombra. La ventaja del modelo **se mide pero no se
filtra** (decisión de Alexis del 25-ago, `store.js:481-496`): se anota `ev_modelo_pct` en cada fila y se
apuestan también las de EV ≤ 0 «para que el registro real sea comparable con el de papel». Medición previa
citada: son el **14 % de las señales, con EV medio −2,1 %**, coste ≈ 0,3 puntos de EV global.

### La doctrina, escrita a base de perder dinero

**(a) Una posición por PARTIDO + LADO, sin la línea** (13-sep, `store.js:315-343`). Sobre las 139 liquidadas del
libro real:

| Apuestas en el mismo partido | Acierto | P&L | ROI |
|---|---|---|---|
| una sola | 62,7 % | +106,12 | **+3,85 %** |
| dos | 48,0 % | −303,72 | **−17,63 %** |
| tres o más | 33,3 % | −110,00 | **−45,83 %** |

«En doce partidos se perdieron TODAS las apuestas apiladas a la vez: −847,65». La identidad de posición es
`mismoPartido(a,b) && mismo lado`; el partido se reconoce por el id de la casa, el id canónico o
nombre+saque (`store.js:309-314`). Cuentan las filas `PLACED|EN_ACEPTACION|SETTLED` (`CON_DINERO`,
`store.js:308`). Se comprueba **dos veces**: antes de tocar la casa y otra vez tras resolver el id del evento
(`store.js:515-518`, `532-533`). Reversible en caliente con `GP_REAL_UNA_POR_PARTIDO=off`.

**(b) Esperar no es fallar** (12-sep, `store.js:272-293`). El 11-sep se perdieron tres picks de Brasileirão con
el saque a dos y tres días porque el freno de fondos gastaba un reintento cada diez minutos y el tope de 80
barridos (~13 h) se agotó. Ahora `FRENOS_QUE_ESPERAN = {sin_fondos, exposicion_maxima, parada_diaria}` devuelven
el reintento (`store.js:505-508`) y el tope se estira con las horas que faltan:

```js
topeReintentos(ko) = max(80, min(1200, ceil(horas_hasta_saque · 6) + 80))
```

**(c) Veto a las ligas eficientes** (5-sep, `store.js:345-362`). Medido: 47 liquidadas de papel en eficientes,
57 % de acierto con 54 % de break-even, ROI +0,4 % («ruido, no edge»), mientras 26 de las 41 apuestas reales
vivas —1.040 de 1.640 USDT— estaban justo ahí. La banda la calcula el motor (`leagueEfficiency`,
`server.js:7286-7300`) y **viaja con la señal** (`server.js:14164`); el módulo no la adivina. El veto se aplica
antes de stake, frenos y cualquier petición: «es un corte de PERÍMETRO, no de calidad» (`store.js:475-479`).

**(d) La ventana de saque** (4-sep, `store.js:163-193`): corte duro de exposición por fecha ISO. Bloquea
**también sin saque conocido**, comprobado antes: «de las 216 filas del libro y las 576 del sombra, CERO carecen
de `kickoff_at`».

### Idempotencia: la referencia
`refIdDe(pickId, envio) = UUIDv4-formateado(sha256('gp-real:'+pickId+':'+envio))` (`store.js:122-126`). La casa
rechaza referencias repetidas, «así que esto convierte "no colocar dos veces la misma apuesta" en algo que no
depende de que nuestro código sea correcto».

**El incidente que fijó la regla** (5-sep, `store.js:596-609`): Parma–Monza under 4,5 se colocó **dos veces a 40
USDT**. La casa contestó un «no ok» con HTTP ≥ 200 que no era su JSON habitual; el código lo leyó como rechazo,
quemó la referencia, estrenó otra y reenvió — pero la primera había sido aceptada. Regla actual: la referencia
**solo se quema con `betStatus: REJECTED` y cuerpo de la casa**; cualquier otro «no ok» deja la fila
`EN_ACEPTACION` con la MISMA referencia y `confirmar()` pregunta (`store.js:609-618`).

### El camino de colocación (`colocar`, `store.js:452-686`)
0) veto de banda → 1) EV anotado + stake → frenos → 1b) posición ocupada → 2) id del evento (índice `db.cbEventIdx`;
si no, `resolverPorNombre` sobre la agenda persistida `db.cbSlate`) → 3) `eventRaw` + `selectionFor` (precio vivo,
`marketUrl`, `min/maxStake`, estado) → 4) deslizamiento (`precio ≥ odds_sombra·(1−3 %)`) → 5) profundidad (si el
tope de la casa es menor se apuesta lo que acepta y se anota `recorte_pct`; si no llega al mínimo, no se apuesta)
→ 6) ensayo → 7) envío.

El resolutor por nombre es **deliberadamente más estricto** que el del colector (`store.js:376-421`): los dos
equipos deben casar (en cualquier orden), el saque no puede alejarse más de 6 h, el partido no puede haber
empezado y debe salir **un único candidato** — «con dos, no se apuesta: dos partidos del mismo par en la misma
ventana es exactamente el caso en el que una máquina se equivoca con toda confianza». `resolverDiag`
(`store.js:427-449`) explica condición por condición por qué no resolvió.

Desenlaces del envío (`store.js:578-685`):

| Respuesta | Estado de la fila | Referencia |
|---|---|---|
| cortafuegos (HTML de Cloudflare) | `PENDIENTE` + contador `cortafuegos` | no se quema |
| `betStatus: REJECTED` con cuerpo | `PENDIENTE` (`rechazada_por_la_casa`) | **se quema** (envío+1) |
| `DUPLICATE_REQUEST` | `EN_ACEPTACION` | se conserva |
| `RESTRICTED` / `VERIFICATION_REQUIRED` / `MALFORMED_REQUEST` | `DESCARTADA` + contador `rechazos_cuenta` | — |
| no-ok con HTTP ≥ 200 sin veredicto | `EN_ACEPTACION` (`respuesta_no_reconocida`) | se conserva |
| sin código de estado (no llegó) | `PENDIENTE` (`no_llego_a_la_casa`) | se conserva |
| `PENDING_ACCEPTANCE` | `EN_ACEPTACION` | se conserva |
| aceptada | `PLACED`, `odds_real`, `slippage_pct` | — |

Motivo del contador de cuenta: la casa «marca la cuenta por abuso» si el ratio de rechazos se dispara (hablan de
más del 80 % de las últimas 100) y la bloquea hasta siete días (`store.js:635-638`).

Al colocar, **el saldo se descuenta en el momento** y se marca `estimado: true` (`store.js:676-683`): un barrido
puede colocar seis apuestas de 30 seguidas y el suelo de cartera se estaba juzgando contra el saldo de la pasada
anterior. «Equivocarse por abajo es la dirección segura».

### Confirmar lo que quedó en el aire (`confirmar`, `store.js:696-768`)
Para cada fila `EN_ACEPTACION` se pregunta por la referencia. Tres desenlaces, y la distinción clave es que
«"no la tengo" no es lo mismo que "no sé"» (`store.js:704-708`): si la casa **contesta** que no tiene la
referencia **tres veces seguidas**, la fila vuelve a `PENDIENTE` con la MISMA referencia; si la casa no
contesta, no se concluye nada. **Nunca se reenvía a ciegas**.

### Liquidación (`liquidar`, `store.js:869-1047`)
Reparto de autoridades escrito (`store.js:881-886`):
- **El resultado lo pone nuestra liquidación** (la misma que cierra la pick del sombra).
- **El dinero lo pone la casa** (`betStatus` + `returnAmount`).
- Si no cuadran, **no se toca el banco** y se marca `discrepancia`.

Aritmética (`pnlPorEstado`, `store.js:890-898`): WIN → `stake·(precio−1)`; LOSS → `−stake`; PUSH/VOID/CANCELLED → 0;
HALF_WIN → mitad de la ganancia; HALF_LOSS → `−stake/2`; desconocido → `null` y manda el importe de la casa.

Dos errores históricos corregidos y documentados:
1. La primera versión buscaba `WON/LOST` en `status`, valores **que no existen**: la casa solo dice
   ACCEPTED/PENDING_ACCEPTANCE/REJECTED al colocar, y una perdida y una sin resolver son las dos ACCEPTED con
   `returnAmount: "0.0"` — «el código anterior simplemente no habría liquidado nunca nada» (`store.js:874-880`).
2. `returnAmount` es **neto, no bruto** (1-sep): +15,37 en una ganada de 29 a 1,53 y **−20,20** en una perdida.
   El código le restaba el stake otra vez y la primera ganada real se anotó como pérdida (`store.js:1002-1009`).
   Hoy el P&L sale de la aritmética y el importe de la casa se usa como contraste, etiquetando
   `importe_casa_semantica ∈ {neto, bruto, null}` con tolerancia **0,011** (`store.js:1012-1018`).

Las filas **manuales** (`via:'manual'`) se liquidan con nuestro resultado y quedan marcadas
`verificacion:'resultado_propio'` (`store.js:945-983`); si la pick quedó `SUPERSEDED`, se toma el veredicto de
la **misma posición en la sombra** exigiendo mismo lado y misma línea (el fallo costó 27 apuestas manuales —761
USDT— «esperando un WIN/LOSS que jamás iba a llegar»). Otro bug de campo: las filas de CS2 guardaban la
referencia en `referencia` y no en `ref_id`, así que 34 apuestas resueltas por la casa seguían «esperando» con
210 USDT de exposición fantasma (`store.js:985-990`).

### Reconciliación contra el libro de la casa — `real-executor/reconciliar.js`
Existe porque el 4-sep una restauración del disco devolvió el libro 11 horas atrás y **ocho apuestas reales
desaparecieron de nuestras cuentas** mientras la casa seguía teniéndolas (`reconciliar.js:1-7`). Categorías
(`reconciliar.js:12-21`): `huerfanas` (la casa las tiene y nosotros no → se reconstruyen), `fantasmas` (nunca se
borran automáticamente), `descuadres` (se listan), `desconocidas`, y desde el 5-sep **`duplicadas`**: una fila
con dos o más referencias vivas en la casa (`reconciliar.js:263-285`), «la categoría más cara de todas».

La comparación se hace **por referencia**, no por listado, porque el resolver de listado de la casa devuelve
`INTERNAL_SERVER_ERROR` (`reconciliar.js:180-190`). `leerApuesta` distingue tres estados —`existe`,
`no_existe`, `sin_respuesta`— porque confundir los dos últimos «es declarar fantasma una apuesta que existe»:
pasó, y la primera pasada marcó **21 fantasmas** que la casa sí tenía (`reconciliar.js:106-113`). Concurrencia
**1** con pausa de 350 ms tras medir que «con 2 en paralelo y 60 ms la casa contestó al 4,7 % y devolvió 429 en
el resto» (`reconciliar.js:137-142`). Y un error de la casa **no es un libro vacío**: un `errors:[INTERNAL_SERVER_ERROR]`
con `data.bets = null` marcó 47 filas como fantasmas (`reconciliar.js:74-88`).

### El brazo en país permitido — `real-executor/relay.js` y `relay/cb-relay.js`
Cloudbet geo-cerca la colocación. Mapa medido el 1-sep con sondas externas (`relay/cb-relay.js:5-11`):
bloqueados EE.UU. (Oregón, Ohio), Alemania, Países Bajos, Reino Unido, Singapur; permitidos Brasil, Argentina,
México, Chile, Colombia, Canadá y Finlandia. **Las cinco regiones de Render están bloqueadas**. El brazo corre
en Hetzner Helsinki.

`real-executor/relay.js` es el reenviador mínimo: solo `/place` POST, valida que el cuerpo traiga **las seis
claves obligatorias** y descarta el resto (`relay.js:42-44`, `210-220`), compara el secreto en tiempo constante
(`relay.js:54-59`), **no guarda nada** y la llave de Cloudbet vive ahí y no en el servidor público
(`relay.js:13-24`). También expone `/historial` (consulta GraphQL construida por el propio proceso: el cliente
solo manda offset/limit → «de solo lectura por construcción», `relay.js:136-164`) y `/gql`, que solo reenvía
mutaciones `placeBet` con input validado (`relay.js:166-197`).

Vigilancia del brazo (`server.js:14961-15008`): ping al `/health` cada 5 min; tras **3 fallos seguidos** (~15 min)
correo al admin, y otro al volver. «No se pierde dinero, se pierde ventana».

### Contabilidad y tablero
- **Movimientos de caja** (7-sep, `store.js:1275-1316`): depósitos/retiros anotados. Conciliación con fórmula
  explícita: `saldo esperado = depósitos − retiros + P&L realizado − expuesto`. «Cualquier diferencia que quede es
  una apuesta que la casa tiene y el libro no (o al revés)».
- `board()` (`store.js:1318-1389`) publica el perímetro, la ventana de saque, las bandas vetadas, los topes, el
  estado del cortafuegos, la exposición, W-L, ROI, **`deslizamiento_medio_pct`** («el número del primer mes:
  cuánto se pierde entre el precio de papel y el precio real»), `recorte_por_tope_n` y el desglose
  **`por_ev` (con_ventaja / sin_ventaja)** para poder contestar dentro de un mes si las de EV ≤ 0 costaron dinero.
- Persistencia: `real-ledger.json` en el disco persistente, junto a `db.json` (`store.js:33-37`), con
  lectura/escritura a prueba de pérdida vía `lib/jsonstore` — «distingue "no existe" de "no se pudo leer" y
  bloquea la escritura en el segundo caso» (`store.js:89-104`).
- Auditorías ejecutables con una casa simulada: `real-executor/auditoria.js` (439 líneas, recorre aceptada,
  rechazada, en aceptación, red cortada, precio peor, tope de la casa, sin fondos, parada diaria, exposición,
  descuadre), `auditoria-duplicados.js` (reproduce el caso Parma–Monza con guiones `aceptar|rechazar|ruido|silencio`),
  `auditoria-reconciliar.js`, `auditoria-banda.js`, `auditoria-ventana.js`, `auditoria-liquidar-manual.js`.

### Correos operativos
- **Plan del día (08:00)** y **parte del día (23:30)** (`server.js:14360-14449`). Ninguno lleva apuestas para
  colocar, y es deliberado: «un correo con instrucciones… sería además una invitación a apostar a mano encima de
  lo que el ejecutor ya hizo, que es como se duplica una posición sin darse cuenta» (`server.js:14353-14357`).
  Los descuadres con la casa van **arriba y en mayúsculas** (`14424-14427`).
- Aviso de divergencia papel-vs-dinero (`realAvisoDivergencia`, `server.js:14681-14721`), con la ventana anclada
  al nacimiento del libro: «reprocharle no haberlas tomado es reprocharle no haber existido».
- Sonda `/api/internal/real` con `papel_vs_dinero_24h` (`server.js:23821-23847`) y pre-vuelo `preflight`
  (`store.js:836-867`) que recorre los mismos pasos sin escribir nada.

### Canales secundarios del dinero real
- **CS2 por canal manual** (`crearManualCs2`, `store.js:1060-1087`) y su **gemelo automático en ensayo**
  (`ensayoCs2`, `store.js:1170-1242`): arma el payload completo verificado contra el precio vivo y solo envía si
  `GP_REAL_CS2_AUTO=true`. Stake **plano de $5** porque «cuatro ganadas de $5 no pagan una perdida de $30»
  (`store.js:1120-1125`). Dos trampas resueltas: la casa versiona la clave de mercado
  (`counter_strike.map_round_handicap.v2` → regex `CS2_MARKET_RE`, `store.js:1099-1102`) y **reordena local/visitante**,
  por lo que el lado se resuelve **por nombre de equipo** y no por posición: «casar por `side` habría apostado al
  equipo contrario con el hándicap invertido» (`store.js:1103-1119`). Canal **pausado** desde el 7-sep
  (`GP_REAL_CS2_ENABLED=false`) tras dos semanas en rojo (−66,9 sobre 600) y un fallo de identidad MOUZ/Spirit
  (`store.js:1126-1129`).
- **Tenis de mesa** (`real-executor/tt.js`, 9-sep): familia `POINTS_TOTAL` (`table_tennis.totals`) en Cloudbet a
  **$5 planos**. Comparte libro, referencia idempotente, frenos, cortafuegos, confirmación y liquidación
  (`tt.js:5-10`); lo propio es de dónde sale la señal (`tt-engine/store.openPicks()`) y cómo se localiza la
  selección. Su propia guarda de posición exige mismo evento + lado + **línea** (`tt.js:33-38`), no la regla de
  «una por partido». Tope de reintentos fijo de 60 (`tt.js:29`). Barrido dentro de `ttJob`, cada 10 minutos
  (`server.js:955-977`). Justificación escrita: Cloudbet cotiza los totales con plantilla (73,5/75,5) y no los
  mueve hasta el saque; el ganador queda fuera por ser el mercado eficiente (`tt.js:12-14`).
- **Apuestas físicas en Gambia** (`fisicasSettle`, `server.js:13877-13955`): boletos colocados a mano en dalasis,
  fuera del ejecutor y de la sombra. Se liquidan con el mismo total real de tarjetas contra **su propia línea**;
  si no hay total, valen dos testigos de la misma posición (la pick liquidada o una fila del libro real) y, a las
  **72 h**, `VOID` con fuente `sin_dato_72h` — «anulada, no inventada».

---

## 9.3 Ejecutor y sombra de Polymarket

### `polymarket/ejecutor.js` (13-sep) — el cerebro
Doctrina escrita **antes** del primer susto (`ejecutor.js:7-16`): una posición por evento y familia; tope de
exposición; parada diaria; los reintentos respetan el saque; nada se coloca sin interruptor explícito.
Configuración (`ejecutor.js:34-43`): `GP_PM_ENABLED` (off), `GP_PM_BANCO` 200, `GP_PM_STAKE` **5 planos**,
`GP_PM_MAX_EXPOSICION` (default = banco/2), `GP_PM_PARADA_DIARIA_PCT` 15, `GP_PM_FAMILIAS` (default `futbol:no`),
`GP_PM_MIN_SHARES` 5.

Lo más honesto del módulo está en el encabezado (`ejecutor.js:18-21`): **«Lo que de verdad produce este ejecutor
no es beneficio»** — con $200 harían falta unas 800 apuestas para distinguir ventaja de ruido. Lo que produce es
*cuánto se aleja el fill real del simulado*, y por eso cada posición guarda `fill_simulado` al lado del real y el
tablero compara esa diferencia **antes** que el P&L (`ejecutor.js:203-225`).

Detalle de implementación que ya cazó un fallo: el conjunto `ocupado` del antiapilamiento se actualiza **dentro**
del bucle, porque calcularlo solo al empezar dejaba pasar dos señales del mismo partido en la misma pasada
(`ejecutor.js:82-88`, `121-124`). El alta a dinero real pasa por **cinco escalones** verificables sin red
(`pasosAlta`, `ejecutor.js:240-287`), incluido comprobar que el brazo **firma con el mismo tipo de firma** que
mide, porque «si mide uno y firma otro, todas las órdenes se rechazan y el alta habría salido en verde».

`polymarket/orden.js` construye y firma la orden EIP-712 (CHAIN_ID 137, contratos estándar y de riesgo negativo,
tabla de redondeo por `tick_size`, aritmética en **enteros** porque `0.52*100 = 52.00000000000001` produce una
orden rechazada, `orden.js:15-60`). `polymarket/clob.js` implementa los dos niveles de autenticación (EIP-712
`ClobAuth` sin `verifyingContract` + HMAC-SHA256 sobre `timestamp+MÉTODO+ruta+cuerpo` en base64 URL-safe,
`clob.js:1-40`). El brazo `/pm/*` se monta en el mismo proceso de Helsinki (`relay/cb-relay.js:92-114`).

### `propfirm/polyshadow.js` — la sombra con libro real
Banco simulado de $2.000 donde se colocan **todas las señales operables de la prop firm** como si se ejecutaran
por la API del CLOB (`polyshadow.js:1-8`). Es más honesta que una sombra de precios porque anota **lo que de
verdad se habría comprado**: una orden límite que camina los `asks` reales del libro
(`simulaFill`, `polyshadow.js:83-97`), midiendo deslizamiento, profundidad insuficiente y «no había libro».
Stake: Kelly/4 con tope 1,5 % del banco vivo, suelo $5, tope $45 (`polyshadow.js:29-52`). Liquidación **por la
resolución del propio venue** (`outcomePrices` ≥ 0,99 y `closed`), no por nuestro liquidador
(`polyshadow.js:194-219`). Estados de capacidad que también son medición: `SIN_FILL`, `NO_ENTRO` (la ventana se
cerró sin entrar nunca), `SIN_TOKEN`.

Bug documentado (1-3 sep): `/markets?id=` **excluye los cerrados** por defecto, así que 61 posiciones quedaron
«esperando» para siempre; se corrigió usando el recurso individual `/markets/<id>` (`polyshadow.js:178-192`).

El desglose del 13-sep (`polyshadow.js:222-274`) parte por familia, por **tramo de ventaja** y por precio, con
`t_roi` por grupo, «porque ahí está el hallazgo incómodo… la ventaja grande rinde PEOR que la pequeña, que es lo
contrario de lo que debería pasar si el modelo supiera lo que dice saber».

`sondaGeo` (`polyshadow.js:294-325`) comprueba con un POST vacío a `/order` si el trading está bloqueado por
región: «nuestra sombra lleva desde el 1-sep leyendo libros sin problema, y eso no dice absolutamente nada sobre
si podría colocar».

### `propfirm/scan.js` — el escáner de señales de la prop firm
Aplica la doctrina de anclarse al consenso sharp y apostar la desviación de **una** casa, con Polymarket como la
casa que se desvía (`scan.js:1-10`). Umbrales: `edge ≥ GP_PROPFIRM_EDGE_PP` (4 pp) con **techo de cordura en
12 pp** («un "edge" de 12+ pp contra un libro con volumen casi nunca es ventaja — es un partido que ya va en
vivo, un mercado mal mapeado o un consenso rancio», `scan.js:251-253`), banda de precio **0,15-0,84**, liquidez
mínima `GP_PROPFIRM_MIN_LIQ` (500), riesgo $100/posición, máximo 568 shares por evento y ≤ 20 posiciones (reglas
del Elite 10K, `scan.js:19-34`). El **precio límite nunca paga el consenso**: `limite = min(0,84, consenso − 0,01)`
(`scan.js:260`). Dedup: una tesis por mercado+lado, reavivada solo si el edge creció ≥ 2 pp (`scan.js:258`). El
módulo **no coloca nada**; escribe el correo con la orden exacta y anota la tesis en su propia sombra
(`scan.js:12-15`). Hay además una rama `modelo_sombra` (ganador de serie) con listón más alto (6-15 pp) que
**jamás** sale por correo (`scan.js:209-235`).

---

## 9.4 LA VARA — cómo se decide si una familia es invertible

### 9.4.1 `lib/margen.js` — el margen de la casa, medido
Razón de existir (`margen.js:3-8`): el CLV se mide contra un cierre que **lleva el margen dentro**. «Si Pinnacle
cobra un 2,4 % en hándicap de rondas, su cierre ya está un 1,2 % por lado peor que el precio justo — así que
ganarle un 0,5 % al cierre NO significa estar por encima del precio justo, significa estar 0,7 % por debajo».

```
sobre_redondeo = 1/cuota_A + 1/cuota_B − 1
margen_lado_pct = mediana(sobre_redondeo) / 2        (en % de cuota)
```

Emparejado (`pares`, `margen.js:47-77`): dos filas son la misma apuesta vista desde los dos lados cuando coinciden
**casa, familia, mapa/periodo y línea**, con el matiz de que en un hándicap la cara contraria lleva la línea
cambiada de signo (se indexa por valor absoluto) y en un total las dos caras comparten línea
(`claveMercado`, `margen.js:32-42`). De varias lecturas de una cara se toma la de **mejor cuota** («usar una peor
inflaría artificialmente el margen que luego restamos»). Filtro de cordura: se descarta cualquier par con
sobre-redondeo fuera de `(−0,02, 0,60)` — «un sobre-redondeo negativo es arbitraje puro y uno del 60 % es basura
de captura. Los dos existen en los archivos» (`margen.js:69-71`). Se usa **mediana, no media**
(`margen.js:82-84`).

Bug corregido y anotado (`margen.js:60-63`): la versión anterior descartaba el par entero cuando la primera cara
vista era la alfabéticamente mayor, «o sea todos los home/away, que son justo los hándicaps».

**Y no inventa**: si solo hay una cara, devuelve `null`. «Un margen supuesto es peor que ninguno: haría pasar por
invertible algo que no lo es» (`margen.js:18-20`). Márgenes medidos citados en CLAUDE.md: pinnacle
RONDAS_HANDICAP 2,21 %/lado, cloudbet 3,13 %, bovada KILLS 2,35 %, total de goles de fútbol **0,69 %**.

### 9.4.2 `lib/vara.js` — CLV recortado, por semana, neto de margen
Origen (`vara.js:1-17`): el 11-sep el CLV **crudo** de CS2 en Pinnacle decía que el edge había muerto (+2,82 % en
agosto → +0,05 % las dos últimas semanas). Recortando el 10 % de cada cola, la misma serie decía
**+2,04 → +1,80 → +0,68 → +0,55 con t entre 2,7 y 4,5 todas las semanas**. «La media cruda la destrozaban cuatro
cierres disparatados (hay un CLV de +148 % en cloudbet, que es un cierre roto, no una ganancia)».

Primitivas (`vara.js:22-26`): media, `sd` muestral (n−1), `t = media / (sd/√n)`, y
`recorta(a, p)` que ordena y quita `floor(n·p)` de cada cola (p = 0,10 por defecto).

- `serie()` (`vara.js:30-37`) devuelve **crudo y recortado con sus t**, «para que la diferencia entre ellos sea
  visible — cuando el recortado y el crudo se separan mucho, el archivo de cierres tiene basura».
- `semanal()` (`vara.js:42-50`) agrupa por lunes UTC: «un promedio histórico esconde una caída».
- `rodante()` (`vara.js:54-64`) ventana de **100**, 8 pasos, y devuelve la última ventana entera («la que manda»)
  con su t.

**La prueba previa: ¿sirve el CLV aquí?** (`cierreAporta`, `vara.js:66-95`). El CLV solo vale si el cierre es
mejor estimador que el precio de entrada, y eso es **falso en un mercado que no se mueve**: la cuota de cierre es
idéntica a la de entrada en el **78,8 % de los totales de tenis de mesa, el 60 % de los hándicaps de Bovada y el
55 % de los kills**. Test pareado de Brier sobre las mismas liquidadas:

```js
dv(o) = clamp(0.001, 0.999, (1/o) / (1 + overPct/100))
d_i   = (dv(odds_entrada) − y)² − (dv(odds_cierre) − y)²       // > 0 ⇒ el cierre acertó más
aporta = |t(d)| ≥ 2 && t > 0        (mínimo n = 40, si no: "muestra corta para saberlo")
```

Tres lecturas posibles: el cierre no predice mejor («el CLV no mide nada en esta familia»), el cierre predice
mejor («el CLV vale como vara») o **nuestra entrada predice mejor** («el mercado se mueve en contra de la
verdad»).

**La vara de repuesto** (`modeloContraPrecio`, `vara.js:97-116`), para cuando el CLV no aplica:

```js
d_i = (1/odds − y)² − (p_modelo − y)²      // > 0 ⇒ el modelo acertó más que el precio
u_i = y ? odds − 1 : −1                    // ROI por unidad
```

con `t(d)` y `t(u)`, n ≥ 40. **Aquí NO se resta margen**: «el ROI y el acierto ya están medidos contra lo que de
verdad pasó y contra las cuotas que de verdad nos pagaron».

**El veredicto** (`vara.js:118-165`), con `MIN_N = 100` y `MIN_T = 2` (`vara.js:122`). `clv_neto = clv_recortado − margen_lado`:

| Orden | Condición | Veredicto |
|---|---|---|
| 1 | `cierre.aporta === false` y sin prueba directa | `clv_no_aplica` — «de esta familia NO SABEMOS NADA todavía» |
| 1b | `cierre.aporta === false` y `directo.t ≤ −2` | **`cerrar`** |
| 1c | `cierre.aporta === false`, `directo.t ≥ 2`, `roi > 0`, `t_roi ≥ 2` | **`invertible_por_acierto`** (tamaño desde el ROI observado) |
| 1d | resto | `sin_evidencia` |
| 2 | `margenLadoPct == null` | `sin_margen_medido` |
| 3 | `n < 100` | `muestra_corta` |
| 4 | `neto ≤ 0` | `no_invertible` — «ganar al cierre no es ganar dinero» |
| 5 | `t_recortada < 2` | `en_observacion` |
| 6 | resto | **`invertible`** |

Tamaño (`tamano`, `vara.js:167-177`): ¼ Kelly con la ventaja expresada sobre la cuota,
`f = (ventaja_pct/100)/(cuota_media−1)`, `stake = bankroll · f · 0,25`.

`familia()` (`vara.js:180-192`) monta el informe completo de una familia en una llamada. Nótese que pasa
`overPct = margenLadoPct·2` a `cierreAporta` para des-viguear **igual** entrada y cierre.

**Sonda** `/api/internal/vara?key=&bankroll=&min=` (`server.js:25257-25342`): recorre los cuatro esports, tenis de
mesa, dardos y **cada segmento de la sombra**, mide el margen una vez por archivo de cierres, y ordena las
familias por veredicto. Para la sombra el margen sale `null` a propósito —no hay archivo con las dos caras— «que
es justo el punto de este endpoint» (`server.js:25312-25313`).

### 9.4.3 `lib/devig.js` — de-vig del 1X2
El de-vig **proporcional** sobreestima el longshot: en el libro de SOLID, cuota > 5 ⇒ mercado 17,1 % vs observado
**13,1 % (n=84)** (`devig.js:2-10`). Se implementa **Shin (1993)** por bisección sobre

```
p_i(z) = ( √(z² + 4(1−z)·q_i²/β) − z ) / (2(1−z)),   q_i = 1/o_i,   β = Σq_i
```

buscando `z` tal que `Σp_i(z) = 1` (tolerancia 1e−12, 200 iteraciones, `devig.js:22-52`). Reserva: sin margen o
sin cambio de signo → potencia → proporcional; **nunca devuelve null** con cuotas válidas.
`shinConsensus1x2` aplica Shin **por casa** y toma la mediana entre casas por resultado, renormalizando a
prorrata (`devig.js:66-87`); guarda al lado `fair_prop` para poder comparar. **Solo se usa en el 1X2**: los
totales siguen con proporcional a dos lados (`devig.js:8-9`).

`publishableProb(pMkt, pGp, c) = σ( logit(p_mkt) + c·(logit(p_gp) − logit(p_mkt)) )` (`devig.js:89-102`) es la
fórmula operativa de la autopsia del 2-sep: `c = 0` publica el consenso, `c = 1` el modelo.

### 9.4.4 `lib/bandas.js` — bandas de eficiencia por liga
Tres bandas por Brier del consenso sobre los eventos liquidados: `eficiente < 0,230`, `blanda > 0,260`,
intermedia en medio, con `MARGEN = 0,005` y `N_MIN = 40` (`bandas.js:24-27`). El fallo corregido el 5-sep
(`bandas.js:11-19`): la histéresis protegía solo la banda del **prior**, así que MLS (0,2292 acumulado) oscilaba
entre bandas cada fin de semana — y cada oscilación abría o cerraba cards-under **y el dinero real**. Ahora el
margen protege la banda **actual** (`bandaConMargen`, `bandas.js:39-55`): para salir hay que cruzar con 0,005 de
margen en cualquier dirección. La primera evaluación de cada liga se siembra con la regla vieja para que el
despliegue no cambiase ninguna banda de ese día (`bandas.js:21-23`, `evaluarBanda` 59-74). La memoria vive en
`db.leagueBand` y cada cambio se registra (`server.js:7286-7300`, `opsLog('banda_liga_cambia')`).

---

## 9.5 Las cuatro líneas de parada — `real-executor/parada.js`

Origen (`parada.js:1-7`): «¿qué tendría que pasar para que me digas saca el dinero?». «Esa pregunta solo vale si
se contesta ANTES, con números, y no el día que duele».

**La frontera se calculó, no se opinó** (`parada.js:8-14`): Monte Carlo de **60.000 corridas** con los parámetros
del libro (stake 30, cuota media 1,81, break-even 55,2 %):

| Escenario | Tras 100 apuestas |
|---|---|
| ventaja real de +7 pp | mediana **+367**, percentil 1 en **−231** |
| sin ninguna ventaja | mediana **−13**, percentil 5 en **−448** |

Tabla de límites por tamaño de muestra, interpolada linealmente (`LINEA`, `parada.js:30-40`):

| n | 60 | 100 | 150 | 200 | 300 |
|---|---|---|---|---|---|
| suelo (USD) | −225 | −231 | −210 | −81 | +200 |

Con `n < 60` devuelve `null`: «muestra corta: todavía no se juzga».

| Línea | Qué mide | Población | Dispara |
|---|---|---|---|
| **1 · núcleo** (`parada.js:48-59`) | P&L acumulado del núcleo limpio | filas `SETTLED` **sin `familia`** (= tarjetas), WIN/LOSS, colocadas desde `GP_PARADA_DESDE` (default 2026-09-13) | `pnl < lineaDe(n)` |
| **2 · mercado** (`parada.js:65-79`) | ventaja sobre `market_prob` | picks CARDS·under liquidadas con `market_prob > 0`, rodante de 100 (mínimo 60) | media ≤ 0 **dos lecturas seguidas** |
| **3 · calibración** (`parada.js:84-93`) | Brier pareado modelo vs precio | picks CARDS·under con `best_odds` y `model_prob`, n ≥ 100 | `t ≤ −2` |
| **4 · caja** (`parada.js:96-102`) | saldo de la cuenta | lectura de saldo | `saldo < GP_PARADA_SALDO` (100) |

Estados: `FUERA` si salta alguna, `VIGILAR` si alguna está cerca (núcleo < 75 % del límite con n ≥ 60; mercado
≤ 0,02; calibración `t ≤ −1,5`; caja < 1,5× suelo — `cerca`, `parada.js:121-129`), si no `VERDE`. Hay una quinta
condición **no automatizable**, el plazo (15-oct): «si el núcleo limpio no llega a 100 liquidadas… el problema no
es perder: es que no se puede aprender lo bastante rápido» (`parada.js:116-117`).

**El módulo NO apaga nada** (`parada.js:20-21`, `118`): «una alarma que además ejecuta es una alarma en la que ya
no se puede confiar». Corre cada hora (`server.js:27684-27685`), manda **un** correo la primera vez que cada línea
cruza (dedup por `avisos['parada:'+id]`, `server.js:14644-14649`), y se consulta en
`/api/internal/parada?key=` (GET estado, POST fuerza; `?reset=1` olvida los avisos, `server.js:23130-23142`).

---

## 9.6 Escáner de mercados, valor y arbitraje

### `market-scanner/` — núcleo puro multi-venue
`scanner.js` recibe cuotas normalizadas de **cualquier** venue y produce consenso no-vig más dos familias de
oportunidad (`scanner.js:1-11`). Todo detrás de flags con **default OFF** (`config.js:6`, `15-32`).

**Coste efectivo** (`netOdds`, `scanner.js:25-42`): un exchange cotiza pre-comisión → `1 + (o−1)(1−c)`; un
prediction market tiene fee explícita sobre el notional → Polymarket **3 %** plano, Kalshi
`ceil(0,07·p·(1−p))`. «Sin esto, el arb Poly↔Kalshi da falsos positivos (el Sistema A legacy caía en esa
trampa)».

**Consenso** (`consensus`, `scanner.js:50-110`): solo casas que cotizan el **universo completo**; cada grupo de
independencia colapsa a su mediana (un voto por grupo); mediana entre grupos por outcome; de-vig
**proporcional**. Devuelve `fair`, `dispersion` (rango entre grupos), `overround` y `groups`. Soporta
**leave-one-out** (`excludeGroup`) para no comparar una casa consigo misma.

**Producto 1 — arbitraje puro** (`detectArb`, `scanner.js:112-162`): mejor cuota neta por outcome,
`S = Σ 1/o_eff`, `ROI_bruto = 1/S − 1`, `ROI_neto = bruto − buffer`. Requiere ≥ 2 casas distintas. Marca `stale`
si el desfase entre patas supera `maxLegTimeSkewMs`, y **`unverified_depth`** si alguna pata es un prediction
market — «el research confirmó 0 arbs Poly↔Kalshi ejecutables tras fees/depth» (`scanner.js:136-140`).
`executable = netRoi ≥ min && !stale && !unverifiedDepth`.

**Producto 2 — precio atrasado** (`detectLag`, `scanner.js:164-235`): `edge = odds_casa · fair_LOO − 1`, con
filtros de dispersión absoluta, **dispersión relativa a la probabilidad** («mata el sesgo de longshot: 4,5 pp
sobre 5 % = 0,9 → fuera») y piso de probabilidad justa. Dedup por (outcome, grupo de independencia), porque
`unibet_se` y `unibet_nl` son la misma oportunidad. Marca `is_soft` y si se apuesta **contra el favorito**.

Parámetros (`market-scanner/config.js:34-67`): `minIndependentGroups` 4 · `maxQuoteAgeMs` 30 min ·
`maxLegTimeSkewMs` 10 min · `arbMinRoi` 0,5 % · `arbBufferPct` 0,5 % · `exchangeCommissionPct` 2 % ·
`lagMinEdge` 2 % · `lagMaxEdge` 25 % · `lagMaxDispersion` 8 pp · `lagMinFairProb` 8 % ·
`lagMaxRelDispersion` 0,5 · `maxOpportunities` 60.

El adaptador `quotes.js` resuelve los **grupos de independencia** cuando la base trae el campo auto-referenciado:
quita sufijos de país (`unibet_se/nl/fr → unibet`) para no sobre-contar casas correlacionadas
(`quotes.js:16-27`).

### `arb-engine/` — motor versionado con aritmética decimal
`ARB_ENGINE_ALLOW_AUTO_PUBLICATION` se **fuerza a false** aunque la env diga lo contrario (`config.js:20-22`).
Parámetros: `minNetRoi` 0,5 %, buffer 50 bps, skew 3 s, edad de snapshot 120 s prematch / 15 s en vivo,
`minEquivalenceScore` 0,95, capital ejecutable mínimo 25 (`config.js:30-43`). `feeEngine.js` versiona los
schedules con fuente y fecha (`polymarket pm-fee-2` 3 % deportes, verificado 2026-07-01; `kalshi ks-fee-1`
coeficiente 0,07 con redondeo al alza al centavo) y devuelve `feeStatus: 'unknown'` cuando no es fiable — sin fee
conocida **no puede haber arbitraje ejecutable** (`feeEngine.js:1-6`, `33-56`). `policy.js` sintetiza el estado
combinando gates semántico, temporal, capacidad y cálculo; `EXECUTABLE` exige **todos**; invariantes:
`autoExecution: false`, `publicEnabled: false` (`policy.js:17-34`).

### `exec-opportunities/` — capa de producto
«Una evaluación del motor NO equivale a una oportunidad publicable. Aquí se aplica un estándar SUPERIOR al de
detección» (`eligibility.js:1-4`). Toda publicación es por **aprobación humana**, y la capa ignora el flag de
auto-publicación del motor aunque alguien lo encienda (`config.js:1-4`, `43-45`). Sin `feeStatus: 'known'`
jamás se publica (`eligibility.js:45-46`).

### `line-intel/engine.js` — movimiento de línea
Puro. `moveForPick(publishProb, latestFair)` da `pp` y dirección (`with` / `against` / `flat`) con umbral de
**1 pp**; `summarize(series)` da apertura, cierre, movimiento y **steam** (salto ≥ 2 pp entre dos evaluaciones
dentro de 2 h). Explícitamente **no gatea picks**: «regla de la casa: backtest antes de tocar gates»
(`engine.js:5-13`). Se expone en `/api/internal/line-intel` (`server.js:23386-23398`).

---

## 9.7 Registro de señales, cierres y CLV

Hay **cuatro registros de cierre distintos** en el repo, con definiciones que no son intercambiables. Es crítico
para una auditoría no mezclarlos:

**(1) Picks de fútbol — `captureDailyPicksClosing` (`server.js:6984-7026`) + `pick-engine/metrics.js`.**
El cierre se resuelve de `goal_value_shadow` tomando la **última fila con `created_at ≤ kickoff`**
(`server.js:6999-7005`); para combos se multiplican las patas. `computeClv` (`pick-engine/metrics.js:53-66`):

```
clv_pct     = (cuota_tomada / mejor_cuota_de_cierre − 1) · 100
ev_close_pp = (cuota_tomada · prob_justa_de_cierre − 1) · 100
```

con un **guard de sanidad**: si la mejor cuota de cierre contradice la prob justa de cierre en más de **25 pp**,
el precio de cierre no se considera fiable y solo se publica el EV.

**(2) Sombras por deporte — `implied-engine/closes.js`.** El CLV deja de ser un número y se vuelve una **curva**:
cinco cubos por tesis (**T60 / T30 / T10 / T5 / T1**, con ventanas `(90,45] (45,20] (20,7] (7,3] (3,−2]` minutos,
`closes.js:20-26`) y **tres referencias** —`own` (la misma casa), `best` y `pinnacle`—; cada cubo se escribe una
sola vez y `last` se refresca siempre (`closes.js:44-59`). `clvPct(entry, close) = 100·(entry/close − 1)`
(`closes.js:62-67`). `summarize` da media, n y **`beat_pct`** por cubo y referencia.

Dos hallazgos del propio módulo:
- **El rescate del CLV (11-sep, `closes.js:92-117`)**: `rows` —la última foto— se seguía machacando hasta 60 min
  **después** del saque, es decir con precios en vivo, y la liquidación buscaba la línea exacta de la tesis ahí
  dentro; en un total de puntos esa línea ya no existe. Reparto delator: las familias **sin línea** sobrevivían
  (ML 16/35) y las que llevan línea se desplomaban (**GAMES_HCP 0/26, POINTS_TOTAL 4/62**). El rescate reconstruye
  el CLV desde el cubo congelado más tardío con precio y anota de cuál salió (`clv_rescatado`).
- **`salud()` (`closes.js:119-134`)**: cuenta las tesis con dos o más cubos escritos **en la misma pasada**. «En
  esas la CURVA no se puede leer, el CLV sí».

**(3) Signal Registry (`signal-registry/`)** — la capa formal, con política versionada `closing-policy-1`.
El valor **oficial** es el **consenso no-vig de grupos verificados** del último set completo válido antes del
kickoff (`closingPolicy.js:5-8`). Anti-look-ahead estricto (`classifyCapture`, `closingPolicy.js:21-45`):
`provider_updated_at ≤ kickoff` y `observed_at ≤ kickoff + tolerancia` (tolerancia **0 ms** por defecto); si no,
`EVENT_STARTED` y la captura se **rechaza** (`closingCapture.js:26-27`). Una cuota anterior al saque pero más
vieja que `SIGNAL_CLOSING_STALE_MS` (30 min) se marca `STALE` pero sigue siendo usable. Estados posibles:
`AVAILABLE | UNAVAILABLE | STALE | MARKET_SUSPENDED | EVENT_STARTED | MAPPING_ERROR | NO_EQUIVALENT_MARKET |
PROVIDER_ERROR`. La captura es **idempotente por `benchmark_type`** (`closingCapture.js:38`).
`closingResolver.js` cablea todo automáticamente: carga cuotas 1X2 con `provider_update ≤ kickoff`
(anti-look-ahead **a nivel de dato**, `closingResolver.js:20-31`), arma sets, filtra casas
`verification_status === 'verified'`, de-vigua por casa y saca consenso; estados operativos
`NOT_DUE | CAPTURED | UNAVAILABLE | RETRYABLE | FINAL_NO_DATA | BLOCKED`, con gracia post-kickoff de 6 h.

**(4) `metrics-engine/clv.js`** — definiciones separadas a propósito: «no hay una sola definición universal»
(`docs/sprint-6-clv.md:3`).

```
clv_probability_points = closing_prob − entry_implied_prob
clv_log_odds           = logit(closing) − logit(entry)
forecast_vs_close      = model_prob − closing        // NO se llama CLV
```

Prioridad de benchmark: `executable_price > midpoint > provider_reported`, **sin mezclarlos**, con rechazo
`look_ahead_rejected` si `observed_at > event_start_at` (`clv.js:24-36`). Ausencia de dato → `unavailable`, nunca
interpolado.

---

## 9.8 Métricas

### `metrics-engine/` (Sprint 6 + Fase I)
Objetivo declarado: «hacer a GP MEDIBLE, no hacerlo parecer exitoso. Inerte con flags apagados»
(`config.js:2`). Todos los flags **default false** (`config.js:13-26`), incluido `simulatedReturnsEnabled`.

- **Brier** (`brier.js`): binario `(p−y)²`; multiclase `Σ(p_k − y_k)²` — **suma, sin dividir entre clases**,
  versión `brier_multiclass_v1`. Ejemplo verificado en el doc: p = {.5,.3,.2}, gana home → **0,38**
  (`docs/metrics-track-record.md:20-21`).
- **Log loss** `−ln(P(outcome_real))` con clamp ε versionado (`logLossEpsilon` 1e−12).
- **Calibración/ECE**: 10 bins equal-width, one-vs-all; buckets vacíos omitidos; con muestra insuficiente →
  `insufficient_sample` y el sample size siempre visible.
- **Intervalos** (`confidenceIntervals.js`): **Wilson** para tasas y **bootstrap reproducible** de 2.000
  iteraciones con LCG sembrado (`bootstrapSeed = 20260622`) — sin `Math.random`, percentiles 2,5/97,5.
- **Diccionario versionado** (`definitions.js`): cada métrica con `metric_version`, fórmula en texto,
  `eligibility_policy`, `minimum_sample_size` (30 para Brier/log-loss/CLV, 50 para ECE, 10 para arb) y
  `higher_is_better`.
- **Estado de muestra** (`config.js:43-50`): `insufficient ≤ 29`, `early ≤ 99`, `developing ≤ 299`,
  `established` por encima. Es «comunicación, NO ley científica».
- **Elegibilidad** (`eligibility.js`): las excluidas **no se borran**, siguen visibles con su razón. Un closing
  faltante excluye **solo el CLV**, no el Brier (`eligibility.js:6-8`, `34-38`).
- **Track record inmutable** (`trackRecord.js`): por señal se congela lo publicado —«NO recalcula el modelo»—
  más closing y settlement, con `input_hash` idempotente, `supersedes_metric_fact_id` y `effective`;
  el trigger bloquea DELETE (`docs/metrics-track-record.md:12-17`). Semántica de CLV corregida a
  `clv-semantics-2` (`trackRecord.js:69-81`):
  `entry_price_vs_closing_fair_gap = closing_prob − break_even_publicado` y
  `price_clv = published_odds / (1/closing_prob) − 1`; `market_move_no_vig` se deja **null** porque el consenso
  no-vig no se congela al publicar — «no se inventa el dato».
- **ROI teórico**: etiquetado `theoretical · flat_1_unit_v1 · executed_by_gp=false`; void/cancelled → 0;
  postponed/unresolved → **null** (`docs/metrics-track-record.md:35-39`).
- **Cohortes administrativas**: `ACTIVE/QUARANTINED/RETRACTED/DATA_ERROR/ADMINISTRATIVE_VOID`, con la regla
  explícita **«una pérdida no puede desaparecer por una acción administrativa»**
  (`docs/metrics-track-record.md:41-45`).

### Métricas operativas de verdad (las que corren hoy)
`pick-engine/metrics.js` `quantMetrics` (`metrics.js:116-166`) es lo que alimenta el panel: Brier y log-loss del
modelo, **el mismo set valuado con `market_prob`** como baseline pareado, y `skill = brier_market − brier_model`
(«>0 = el modelo pronostica MEJOR que el consenso sobre las mismas picks»), calibración por rangos
(`0-40-50-60-70-80-100`), `clvStats` (media, mediana, `positive_rate`, `ev_close_avg_pp`) y desglose por familia.
El sombra se exporta entero por `/api/internal/picks-export?key=&shadow=1|real=1|poly=1`
(`server.js:19913-19928`) porque las rutas de estado capan a 40 filas.

### Fuentes de precio y frecuencias

| Fuente | Qué aporta | Frecuencia / caché | Notas |
|---|---|---|---|
| Cloudbet (`market-scanner/venues/cloudbet`) | cuotas, saldo, colocación, liquidación por referencia | barrido con throttle de 20 min (`server.js:5463`); **cercanía** cada 4 min con suelo de 3 min y ventana de 3 h (`cloudbetCercania`, `server.js:5061-5092`, `27681-27682`) | única casa donde hay dinero real |
| Polymarket gamma + CLOB | 1X2 binarios por partido + **profundidad real** del libro | cada 15 min, ≤ 60 eventos/pasada, caché 30 min por evento (`server.js:5241-5306`) | profundidad = asks acumulados dentro de `GP_DEPTH_TOL_PCT` (2 %) del mejor ask |
| Kalshi | 1X2 por partido vía series `KX…GAME` | cada 15 min; catálogo de series cacheado 12 h (`server.js:5307-5405`) | precio ejecutable = `yes_ask`; profundidad = `yes_ask_size × p` (solo primer nivel, «cota conservadora») |
| Myriad (AMM) | 1X2 sin vig | cada 15 min (`server.js:5190-5236`) | profundidad **estimada** `tol · L · p · (1−p)`, marcada `myriad_amm`: «es una ESTIMACIÓN, no un dato del venue» |
| The Odds API / `sportsbook-providers` | las casas grandes | con `quotaGuard` (reserva de cuota + circuit breaker, `quotaGuard.js:6-30`) | el extremo eficiente del mercado |
| OddsPAPI (`data-providers/oddspapi.js`) | 348 casas; Dota 2 pasó de 3 a **95 casas**; tenis: 459 partidos en 43 torneos en 3 días | **presupuesto duro** `ODDSPAPI_BUDGET` (40), plan de prueba de 250 llamadas **totales**; los 4xx **también cuentan** | `/historical-odds` es gratis y no se cuenta: «para reconstruir CLV, este es el camino» |
| Kalshi directo (`data-providers/kalshi.js`) | exchange, libro visible, sin clave para leer | — | «un contrato a 12¢ sin nadie enfrente no es una cuota de 8,33: es un número en una pantalla» |

Dos correcciones de campo dignas de mención: Kalshi migró de centavos enteros a **strings en dólares**
(`yes_ask_dollars`) y el gate viejo «mataba TODAS las patas» (`server.js:5338-5348`); y el emparejado con Kalshi
se hace **por las patas y no por el título**, porque con el título concatenado «un nombre corto podía colarse
como subcadena» (`server.js:5370-5377`).

---

## 9.9 Debilidades, supuestos y riesgos observados en el código

**Sesgos de medición**

1. **`S.unexec` se trunca a las últimas 300 filas** (`server.js:14059`, `14100`, `14137`) mientras `S.bets` crece
   sin límite. `shadowSummary` calcula `signals = bets + unexec` sobre la lista truncada
   (`server.js:14856-14858`), así que el `exec_rate_pct` «desde el inicio» está **sesgado al alza** conforme pasa
   el tiempo. `unexec_count` sí lleva el total, pero no se usa en el ratio.
2. **La banda de eficiencia se mide sobre un subconjunto seleccionado**: `leagueEfficiency` calcula el Brier del
   mercado **solo sobre las picks que el motor publicó** en esa liga (`server.js:7289-7292`), no sobre todos los
   partidos. Una liga puede cambiar de banda —y con ello abrir o cerrar el dinero real— por un cambio en el
   criterio de selección de picks, no por un cambio del mercado.
3. **Selección múltiple sin corrección en LA VARA**: `/api/internal/vara` evalúa a la vez decenas de familias
   (4 juegos de esports × familia × casa, TT, dardos, cada segmento de la sombra) con un umbral fijo de `t ≥ 2`
   (`vara.js:122`, `server.js:25282-25323`). Con ~30 familias, esperar uno o dos falsos «invertible» es lo
   normal. El código no aplica ninguna corrección ni lo advierte.
4. **El recorte al 10 % de las dos colas** (`vara.js:25`, `30-37`) es una decisión defendida por el resultado
   («aquí sube el t en vez de bajarlo»), pero es un parámetro elegido **después** de ver los datos; no hay
   preregistro del valor de recorte.
5. **La liquidación del papel y la del dinero no tienen la misma autoridad**: la sombra copia el `result_code` de
   la pick (`server.js:14191`) y el ejecutor real usa el `betStatus` de la casa (`store.js:998`). El propio
   comentario reconoce el reparto, pero significa que una diferencia papel-dinero puede venir de un desacuerdo de
   liquidación y no de ejecución, que es justo lo que el experimento afirma medir.

**Incoherencias de parámetros**

6. **La línea de parada está calibrada para un stake que ya no se usa**: el Monte Carlo de `parada.js:8-12` usa
   **stake 30 y cuota media 1,81**, mientras la orden vigente es **stake plano 40** (`GP_REAL_STAKE_FLAT`,
   `store.js:63-66`, CLAUDE.md). Con stake un 33 % mayor, los suelos en dólares (−231 a 100 apuestas) son
   proporcionalmente más laxos de lo que la simulación pretendía.
7. **La línea 1 solo ve tarjetas**: filtra `!b.familia` (`parada.js:49`), así que las filas de CS2
   (`familia:'CS2_RONDAS'`) y de tenis de mesa (`familia:'TT_POINTS'`) quedan **fuera del contador de parada**.
   Es coherente con «el núcleo limpio», pero significa que el canal de TT con dinero real no tiene ninguna línea
   de parada propia.
8. **Las líneas 2 y 3 miden picks, no apuestas**: se calculan sobre `db.clubDailyPicks` CARDS·under
   (`parada.js:66-68`, `85-86`), incluidas las que nunca se apostaron por veto de banda o por falta de casa
   conectable. Miden la señal, no el dinero.
9. **Kelly cae al tope cuando es cero**, tanto en el sombra (`server.js:13806`) como en el real
   (`store.js:144`). Se conserva a propósito para la comparabilidad y se tapa «donde corresponde»
   (`GP_REAL_EXIGIR_VENTAJA`), pero esa puerta está **apagada por defecto**: hoy se apuesta el tope sobre picks
   con EV negativo.

**Huecos funcionales**

10. **Las apuestas de CS2 quedan fuera del arreglo de `SUPERSEDED`** (`server.js:14192`): una pick de CS2
    superseded deja la fila del sombra abierta indefinidamente.
11. **Ni `polyshadow` ni `polymarket/ejecutor` descuentan la fee del 3 %** que el propio `feeEngine` documenta
    para deportes en Polymarket (`feeEngine.js:15`): el P&L se calcula como `shares − costo`
    (`polyshadow.js:213`, `ejecutor.js:184`). El ROI de esa sombra está sesgado al alza en el orden de la fee.
12. **La sombra de Polymarket camina el libro real pero no modela su propio impacto**: `simulaFill`
    (`polyshadow.js:83-97`) consume asks como si la orden no moviera el libro ni compitiera con otros.
13. **`fisicasSettle` no verifica la casa**: liquida un boleto físico con el total real del partido contra la
    línea del boleto, y a las 72 h lo anula. Si la casa de Gambia resolvió de otra forma, no hay contraste.
14. **El `metrics-engine` y el `signal-registry` —la capa formal, versionada e inmutable— están apagados por
    defecto** (`metrics-engine/config.js:13-26`, `arb-engine/config.js:11-27`). La medición que de verdad decide
    hoy es la ad hoc de `pick-engine/metrics.js`, `lib/vara.js` y los stores por deporte, que **no** tienen
    facts inmutables, ni versionado de política, ni bloqueo de reescritura.
15. **Cuatro definiciones de CLV conviviendo** (`clv`, `clv_exec`, `clv_own/best/pin`, `clv_probability_points` /
    `price_clv`) con distinta unidad (% de cuota vs puntos de probabilidad vs log-odds) y distinto benchmark
    (mejor cuota vs consenso no-vig vs misma casa). Nada impide compararlas entre sí por error; el único guard
    es el de sanidad de 25 pp en `computeClv`.

**Superficie operativa y seguridad**

16. **`relay/cb-relay.js` es más permisivo que `real-executor/relay.js`**: expone `POST /cb?path=` con
    allowlist solo de prefijo `/pub/` (`cb-relay.js:116-126`), es decir, cualquier endpoint público de Cloudbet
    con la llave de la cuenta, mientras el otro reenviador solo admite `/place` con seis claves validadas.
17. **TLS autofirmado sin fijación de huella** en el brazo (`cb-relay.js:35-38`, «Mejora pendiente: fijar
    huella») y `rejectUnauthorized: false` en el ping de vigilancia (`server.js:14973`).
18. **`topeReintentos` puede llegar a 1.200 intentos** por fila (`store.js:292`), cada uno con una lectura de
    evento contra la casa: con varias filas a tres días vista, es presión sostenida sobre una API que ya
    demostró limitar (429) y bloquear por cortafuegos.
19. **La reconciliación depende de que la casa conteste**: con concurrencia 1 y 350 ms tarda, y el propio módulo
    advierte que «"cuadra" es una afirmación, no una ausencia de hallazgos» si la casa contestó a una de cada
    veinte (`reconciliar.js:299-300`). No hay reconciliación automática programada: se lanza a mano por
    `/api/internal/real?reconciliacion=…` (`server.js:23518-23532`).
20. **Pendientes y TODOs explícitos del autor**: el veto por bandas «llega tarde» y ya costó −453,43 en cuatro
    ligas clasificadas como eficientes **después** de haberlas apostado (CLAUDE.md, «Doctrina del ejecutor
    real»); el veto por pérdida está propuesto y **sin aprobar**. La rotación de la API key de API-Football sigue
    pendiente.

**Lo que el código hace bien y conviene registrar en la auditoría**: la separación explícita de autoridades
(resultado nuestro / dinero de la casa), el rechazo sistemático a rellenar huecos con supuestos (`margen = null`,
`CLV = null`, `VOID` a las 72 h, `feeStatus: 'unknown'` bloquea el arbitraje), la idempotencia de la referencia con
la regla de cuándo se quema, el anti-look-ahead a nivel de dato en el resolutor de cierres, y el hecho de que
cada corrección importante viene acompañada en el comentario de **qué costó el error y cómo se midió**.

---

# Parte 10 · Historial y métricas de todos los modelos

> Esta sección **no describe modelos**: recopila **resultados**. Cada cifra se transcribe tal como aparece en
> el documento versionado que la contiene, con su archivo y su fecha. Cuando un mismo número aparece con dos
> valores distintos en dos documentos, se transcriben **los dos** y se señala la discrepancia; no se elige ni
> se promedia.

## 0. Leyenda, vara y advertencias de lectura

**Etiquetas de naturaleza del dato** (aparecen en cada tabla):

| Etiqueta | Significado |
|---|---|
| **💵 DINERO REAL** | Dinero de verdad colocado en una casa. A 14-sep solo existe en **Cloudbet**: `cards_under_v1` (tarjetas under de fútbol) + tenis de mesa a 5 USD. CS2 en Cloudbet estuvo con dinero y quedó **pausado el 7-sep**. |
| **📄 SOMBRA** | Paper-trading con regla congelada. No toca un dólar. Incluye el banco simulado de $2.000, las sombras por deporte, la sombra de Polymarket ($2.000 simulados), la de props CS2, la de derivadas de fútbol y la del proceso implícito. |
| **🔬 BACKTEST** | Medición retrospectiva sobre histórico (walk-forward u holdout). Nunca se apostó. |
| **📐 VALIDACIÓN** | Métrica de ajuste guardada en un archivo `data/**/priors*.json` (log-loss, Brier, skill, AUC, MAE, ECE). |

**La vara vigente** (CLAUDE.md §📏 LA VARA; `HANDOFF.md` §📏, 11-13 sep):
- `lib/margen.js` — margen de la casa medido emparejando las **dos caras** del mismo mercado en el archivo de
  cierres. Si solo hay una cara devuelve `null`.
- `lib/vara.js` — CLV **recortado al 10 %** (`lib/vara.js:25,30`, `recorte = 0.10`), con su t, serie semanal,
  rodante de 100, neto de margen y ¼ Kelly. **Regla escrita:** invertible = CLV recortado − margen por lado
  > 0, con **t ≥ 2** y **n ≥ 100** (`lib/vara.js:122`: `const MIN_N = 100, MIN_T = 2`).
- Antes de usar CLV, `cierreAporta()` pregunta si el cierre predice mejor que la entrada. Si no, manda
  `modeloContraPrecio()` y **ahí no se resta margen**.
- Vara declarada en los dos reportes semanales: «Una familia se confirma con **t ≥ 2** sobre muestra propia y
  se descarta con **t ≤ −2 y ≥ 100 liquidadas**. Entre medias se acumula.» (`docs/reportes/semana-37.html:69`
  y `semana-38.html:69`).

**Advertencias que los propios documentos ponen sobre sus números:**
1. **Muestras apiladas.** La sombra `derivadas_v1` (5.249 liquidadas) mete varias líneas del mismo partido:
   «su n efectivo es menor que 5.249 y los t están inflados» (HANDOFF.md:254-255). Lo mismo pasaba en el libro
   real de tarjetas antes del 13-sep.
2. **Tres liquidadores mintieron** hasta el 2-sep (tenis 0-0, kills sin voltear, totales en cubos de 5). Todo
   track anterior a esa fecha lleva ese ruido (`docs/AUTOPSIA_MODELOS_2026-09-02.md` §1).
3. **El CLV crudo lo destrozan cierres rotos**: hay un CLV de **+148 %** en cloudbet que es un cierre roto
   (HANDOFF.md:300).
4. **El bug del precio sin vig.** `noVig.twoWayNoVig` devolvió `null` desde el 20-ago hasta el 13-sep:
   **ninguna pick de `futbol-derivadas` se valoró nunca contra el precio sin vig** (HANDOFF.md:199-208).
5. **La identidad de equipos de CS2** resolvía "MOUZ"→MOUZ NXT hasta el 7-sep: toda la muestra de CS2 previa
   incluye partidos modelados con el rating de la filial (`semana-37.html:88,258`).

---

# PARTE A — DINERO REAL

## A.1 💵 Ejecutor real en Cloudbet — serie completa

**Perímetro:** `cards_under_v1` (tarjetas, lado under, fútbol, Cloudbet) + CS2 hándicap de rondas (pausado el
7-sep) + tenis de mesa POINTS_TOTAL a 5 USD (desde el 9-sep). Arranque del ejecutor: **25-ago-2026**.

### A.1.1 Foto del 28-ago (`PLAN_ESCALADO.md`, 28-ago)

| Registro | Muestra | Resultado | Vara (CLV) | Tipo |
|---|---|---|---|---|
| Papel · `cards_under_v1` (desde 12-ago) | 77 liquidadas | **+45,1 % ROI** | +0,55 % (n=54) | 📄 |
| Papel · `cs2_rounds_v1` (desde 24-ago) | 44 liquidadas | −5,1 % ROI | **+2,65 % (n=41)** | 📄 |
| CS2 por casa · Pinnacle | n=95 | +20,8 u | **+2,7 % (n=75)** | 📄 |
| CS2 por casa · Cloudbet | n=62 | −8,3 u | +4,9 % (ROI plano) | 📄 |
| **DINERO REAL (desde 25-ago)** | **25 liquidadas** | **−60,32 USDT (−14,9 %)** | deslizamiento −0,23 % medio | 💵 |

Notas del mismo documento: 0 recortes de stake por tope de la casa; saldo en casa 66 USDT con nocional 2.000
(«el primer incumplimiento es NUESTRO»).

### A.1.2 Semana 37 — corte del 7-sep (`docs/reportes/semana-37.html`, leído 7-sep 04:45 UTC) 💵

**Por semana de saque:**

| Semana (por saque) | Apuestas | Apostado | P&L | ROI | G / P | CS2 incluidas |
|---|---:|---:|---:|---:|---:|---:|
| 24–30 ago | 63 | 1.330 | **+156,6** | **+11,8 %** | 29 / 27 | 30 |
| 31 ago – 6 sep | 120 | 3.248 | **−217,0** | **−6,7 %** | 59 / 52 | 38 |
| 7 sep (madrugada) | 1 | 40 | +18,4 | — | 1 / 0 | 0 |
| **Total** | **184** | **4.618** | **−42,0** | **−0,9 %** | **89 / 79 (16 anuladas)** | **68** |

**Fútbol (tarjetas under) desde el inicio: +24,9 sobre 4.018.** Cortes:

| Corte | Apuestas | Apostado | P&L | ROI | G / P |
|---|---:|---:|---:|---:|---:|
| Banda intermedia | 47 | 1.662 | **+275,8** | **+16,6 %** | 33 / 14 |
| Banda eficiente (vetada desde el 6-sep) | 65 | 2.207 | −169,8 | −7,7 % | 35 / 28 |
| Banda blanda | 4 | 149 | −81,1 | **−54 %** | 1 / 3 |
| Línea u3,5 | 28 | 871 | −64,8 | −7,4 % | 13 / 14 |
| Línea u4,5 | 51 | 1.814 | −24,1 | −1,3 % | 30 / 20 |
| Línea u5,5 | 31 | 1.136 | **+72,7** | **+6,4 %** | 21 / 10 |
| Línea u6,5 | 6 | 196 | **+41,2** | **+21 %** | 5 / 1 |
| Cuota ≥ 2,00 | 34 | 1.122 | −122,0 | −10,9 % | 15 / 18 |
| Cuota < 2,00 | 82 | 2.896 | **+146,9** | **+5,1 %** | 54 / 27 |

**Causas medidas de la semana negativa (fútbol −173,6)** (`semana-37.html:114-120`):
1. Ligas eficientes antes del veto: 42 apuestas, **−159,6 (−10,7 %)**. El modelo esperaba 26 aciertos de 40 y
   hubo 22. Premier 2/5 (−155), MLS 1/4 (−118), Championship 7/7 (−73); Serie A +45 y Ligue 1 +142. Las
   intermedias: **+41 con 62 % de acierto**.
2. Stake de 29 → 40 el 3-4 de septiembre: con 29 plano la semana habría cerrado en −92 en vez de −174.
3. Sobreconfianza en cuota ≥ 2 y u3,5: **7 de 20 (35 %)** donde el modelo prometía 55-60 %; −219 en la semana.
   La franja de probabilidad 55-65 % acertó **46 %**.
4. Domingo 6-sep: 10/12, −190, saltó la parada diaria del 6 %.
5. Lectura estadística: contra un mercado justo el resultado está a **−0,6 desviaciones**; contra lo que el
   modelo prometía (+360) está a **−1,8 desviaciones**.

**CS2 en Cloudbet: −66,9 sobre 600 (−11,2 %), pausado el 7-sep** 💵

| Semana | Apuestas | Apostado | P&L | G / P / anuladas |
|---|---:|---:|---:|---|
| 24–30 ago (manuales, tope ~20) | 30 | 413 | −41,9 | 7 / 16 / 7 |
| 31 ago – 6 sep (brazo, stake 5) | 38 | 187 | −25,0 | 13 / 18 / 7 |
| **Total** | **68** | **600** | **−66,9** | **20 / 34 / 14** |

Acierto real **37 %** donde el modelo prometía 55-60 % (`semana-37.html:128`).

### A.1.3 Semana 38 — corte del 14-sep (`docs/reportes/semana-38.html`, leído 14-sep 08:40 UTC) 💵

**Por día (P&L por fecha de liquidación, apostado por fecha de colocación):**

| Día | P&L liquidado | Apostado | Colocadas | Qué pasó |
|---|---:|---:|---:|---|
| lun 7 | **+24,45** | 210,00 | 7 | arranque normal |
| mar 8 | −90,00 | 30,00 | 1 | liquidan tres del fin de semana anterior |
| mié 9 | −26,85 | 30,00 | 6 | — |
| jue 10 | +4,85 | 245,00 | 34 | día de mayor volumen de la semana |
| vie 11 | +11,80 | 110,00 | 12 | — |
| sáb 12 | **−206,70** | 470,00 | 24 | **el día que se llevó la semana** |
| dom 13 | +71,70 | 285,00 | 12 | recupera un tercio |
| **Semana 38** | **−210,75** | **1.380,00** | **96** | **ROI −15,27 %** |
| **Semana 37** | **−60,94** | **3.129,00** | **87** | ROI −1,95 % |

> El propio reporte advierte: el ROI de la fila resumen «divide una cosa por la otra y es, por tanto, una
> aproximación de la semana, no una identidad contable» (`semana-38.html:115`).

**Desde el inicio (25-ago), que es lo que decide:**

| Corte | Colocadas | Liquidadas | Apostado | P&L | ROI |
|---|---:|---:|---:|---:|---:|
| Todo | 281 | 278 | 5.948,04 | **−266,53** | **−4,48 %** |
| Marcadas **con ventaja** | 134 | 132 | 4.418,30 | **−361,71** | **−8,19 %** |
| Marcadas **sin ventaja** | 17 | 16 | 549,74 | **+121,31** | **+22,07 %** |

**El hallazgo de la semana** (`semana-38.html:87-88`): las apuestas que el modelo marca *con ventaja* van a
−8,19 % de ROI; las que marca *sin ventaja* —colocadas a propósito como control— van a +22,07 %. Son 132
contra 16, «así que el lado bueno no tiene muestra para sostenerse solo», pero la dirección se repite desde
el backtest del 23-ago y reaparece en Polymarket.

**Lo que no llegó a colocarse — 97 señales caducadas:**

| Motivo | n | Lectura |
|---|---:|---|
| solo manual | 50 | la casa no cotizaba por API esa línea; se avisó por correo |
| exposición máxima | 17 | freno funcionando |
| demasiados intentos | 11 | el precio se movió fuera de la banda antes de entrar |
| línea no cotizada | 10 | — |
| rechazada por la casa / cuenta restringida / sin fondos / sin id | 9 | ruido operativo |

**Ejecución (no es el problema):** deslizamiento medio **−0,06 %** sobre 281 colocaciones; cero pendientes,
cero en el aire, cero rechazos de cuenta seguidos (`semana-38.html:93`). En semana 37 el deslizamiento fue
**−0,07 %** (`semana-37.html:83`).

**Saldo Cloudbet a 14-sep:** 439,39 USDT, 3 abiertas, 90 expuestos (`semana-38.html:81`). En el punto de
retoma del 13-sep: `cards_under_v1` ~258 USDT (HANDOFF.md:277).

### A.1.4 💥 Autopsia "una posición por partido" (13-sep, HANDOFF.md:394-413) 💵

Sobre las **139 liquidadas** del libro real de ese momento:

| Corte | n | Acierto | P&L | ROI |
|---|---:|---:|---:|---:|
| **Una sola apuesta en el partido** | 83 | **62,7 %** | **+106,12** | **+3,85 %** |
| Partido con 2 apuestas | 50 | 48,0 % | −303,72 | **−17,63 %** |
| Partido con 3+ | 6 | 33,3 % | −110,00 | **−45,83 %** |

«En doce partidos se perdieron TODAS las apuestas apiladas a la vez: **−847,65**. El 12-sep, tres partidos de
Brasileirão con dos líneas cada uno se llevaron el día: ocho apuestas sobre cinco partidos, **1 de 8,
−199,50**.» Simulación de la regla nueva sobre el libro real: 25 apuestas menos (18 %), 919 USD de capital
liberado, **+95,66 USD** (de −307,60 a −211,94), y la varianza por partido pasa de 90 a 30 USD.

### A.1.5 🩺 Autopsia del libro real: de dónde salió cada dólar (13-sep, HANDOFF.md:462-486) 💵

Cruce sobre las mismas 139 liquidadas (apilada/suelta × banda de liga):

| Corte | n | Acierto | P&L | ROI |
|---|---:|---:|---:|---:|
| **Suelta + liga no eficiente** | 43 | **74,4 %** | **+326,44** | **+23,79 %** |
| Suelta + liga eficiente | 40 | 50,0 % | −220,32 | −15,93 % |
| **Apilada + liga no eficiente** | 27 | 33,3 % | **−361,40** | **−36,88 %** |
| Apilada + liga eficiente | 29 | 58,6 % | −52,32 | −5,32 % |

**Descomposición de la pérdida, en orden de tamaño:**
1. **Apilar** — −413,72.
2. **Ligas eficientes apostadas antes de que el veto las detectara** — −272,64. Premier, Bundesliga, MLS y
   Rusia se clasificaron el 10 y el 12-sep; las apuestas se hicieron el 3, 4 y 5. **El veto llegó entre cinco
   y nueve días tarde.** Por liga: premier −149,80, bundesliga −122,43, mls −118,40, rusia −62,80 =
   **−453,43**. Sin ellas, el resto del libro está en **+205,83**.
3. **La ventaja del modelo se debilitó** — de +0,19 a +0,07.
4. Varianza encima de todo eso.

**Dos falsas pistas descartadas con número:**
- **Brasil no era el problema:** acumulado **+24,62 (+2,20 %)**. El 24-ago cargó con el 87 % de la ganancia
  (+193,34) y el 07-sep con el 80 % de la pérdida (−185,40).
- **El over tampoco era la respuesta:** UNDER 392 liquidadas, **69,1 %**, **+14,42 % ROI**, +0,135 vs mercado
  (**t 5,96**). OVER 138, 47,8 %, **−18,68 %**, −0,086 vs mercado (**t −2,05**). Esa semana: under −3,27 %,
  over −28,00 %. «En las ocho semanas medidas, over no superó a under ni una sola vez.»

### A.1.6 🚨 Las cuatro líneas de parada (13-sep, HANDOFF.md:415-444)

Frontera calculada con **Monte Carlo de 60.000 corridas** con los parámetros reales del libro (stake 30,
cuota media 1,81, break-even 55,2 %):

```
con ventaja REAL de +7pp   tras 100 apuestas: mediana +367, percentil 1 en -231
sin NINGUNA ventaja        tras 100 apuestas: mediana  -13, percentil 5 en -448
```

| # | Línea | Dispara cuando | Valor a 13-sep |
|---|---|---|---|
| 1 | El núcleo limpio deja de pagar | acumulado bajo el percentil 1 (−225 a 60, −231 a 100, −210 a 150; interpolado; no aplica bajo 60) | 0 liquidadas (empieza a contar el 13-sep) |
| 2 | La ventaja sobre el mercado se apaga | rodante de 100 picks contra `market_prob` ≤ 0 en **dos** lecturas seguidas | **+0,04** |
| 3 | El precio le gana al modelo | Brier pareado con t ≤ −2 sobre 100+ liquidadas | **t +0,72** |
| 4 | El saldo baja del suelo | < 100 USDT (`GP_PARADA_SALDO`) | **258,29** |

Quinta línea no automatizada: si el núcleo no llega a 100 liquidadas para el **15-oct**.

### A.1.7 🧮 Cuánto falta para saber (HANDOFF.md:501-513)

Ritmo real tras los dos filtros nuevos: **18,7 apuestas/semana**.

| Hito | Semanas |
|---|---|
| 60 liquidadas (la línea 1 empieza a aplicar) | 3,2 |
| **100 (el punto de decisión)** | **5,4 ≈ 20-oct** |
| 200 (certeza razonable) | 10,7 |

Tamaño del premio, medido: a 30 USD por apuesta, un ROI del 10 % son **56 USD/semana ≈ 240/mes**.

### A.1.8 💵 Apuestas físicas (Gambia, PrimaBet, GMD)

| Corte | Boletos | G / P | Apostado | P&L | ROI | Fuente |
|---|---:|---|---:|---:|---:|---|
| Acumulado a 7-sep | 6 | 4 / 2 | 6.000 GMD | **+1.110** | **+18,5 %** | `semana-37.html:311` |
| Acumulado a 14-sep | 6 | 4 / 2 | 6.000 | **+1.110** | **+18,5 %** | `semana-38.html:322` |

Tarjetas under en LaLiga y MLS del 5-sep. Muestra declarada como «anecdótica».

### A.1.9 💵 Tenis de mesa con dinero real (desde 9-sep 09:00Z)

- Familia **POINTS_TOTAL** (total de puntos del partido, `table_tennis.totals`) en Cloudbet, **stake plano
  $5** (`GP_REAL_TT_STAKE`). Muestra al arrancar: **19 liquidadas en sombra**. «Es una apuesta de estructura,
  no de resultados; la vara sigue siendo `clv_own` a 150» (HANDOFF.md:533-546).
- No aparece P&L propio en ninguno de los dos reportes semanales.

### A.1.10 Proyección con dinero real medida el 20-ago (HANDOFF.md:1668-1678) 🔬

275 apuestas ejecutables/mes medidas; **CLV ponderado −1,86 %**:

| Bankroll | Stake 1,5 % | Volumen/mes | Esperado | sd mensual | Rango 90 % |
|---|---:|---:|---:|---:|---|
| $2.000 | $30 | $8.250 | **−$153** | $487 | −$954 a +$648 |
| $5.000 | $75 | $20.625 | **−$383** | $1.217 | −$2.385 a +$1.619 |
| $10.000 | $150 | $41.250 | **−$766** | $2.434 | −$4.770 a +$3.239 |

Contrafactual al precio de Pinnacle (+3,53 %, 244 señales/mes): **+$258, +$646 y +$1.292 al mes** —12,9 %
mensual sobre el bankroll.

---

# PARTE B — SOMBRA: EL BANCO SIMULADO DE $2.000

Nacido el **12-ago-2026** con 2.000. Cuatro reglas congeladas; cada segmento toma TODA señal del motor al
precio ejecutable (Cloudbet, Polymarket, Myriad o Kalshi) con **Kelly/4 y tope 1,5 %**.

## B.1 📄 Serie semanal (`docs/reportes/semana-37.html:132-138`)

| Semana | Apuestas | Liquidadas | G / P | Apostado | P&L | ROI | CLV ejecutable | Banco |
|---|---:|---:|---|---:|---:|---:|---:|---:|
| W34 (hasta 16-ago) | 28 | 21 | 8 / 5 | 744 | **+147,6** | **+28,1 %** | — | 2.148 |
| W35 (hasta 23-ago) | 48 | 35 | 25 / 10 | 1.588 | **+355,6** | **+30,7 %** | +1,54 % | 2.681 |
| W36 (hasta 30-ago) | 221 | 160 | 78 / 78 | 9.712 | **+1.006,2** | **+14,7 %** | +1,46 % | 4.042 |
| W37 (hasta 6-sep) | 461 | 394 | 192 / 166 | 30.028 | +31,6 | +0,1 % | **−0,35 %** | 4.498 |
| W38 (7-13 sep) | — | 340 | — | 18.478 | **−535,87** | **−2,9 %** | — | **3.445,03** |

*(la fila W38 sale de `docs/reportes/semana-38.html:144-152`; ese reporte no publica el desglose G/P ni el
número de apuestas colocadas de la semana.)*

**Acumulado a 14-sep:** de 2.000 a **3.445,03** → **+1.445,03**, ROI **+2,4 %** (`semana-38.html:79,152`).
Acumulado a 7-sep: 4.498 → +2.498, ROI 6,7 %, CLV +0,17 % (`semana-37.html:79`).

## B.2 📄 Por segmento — corte del 7-sep (`semana-37.html:139-145`)

| Segmento | Desde | Liquidadas | G / P | P&L total | ROI | CLV ejec. | 7 d: P&L | 7 d: ROI |
|---|---|---:|---|---:|---:|---:|---:|---:|
| `cards_under_v1` (fútbol, tarjetas under) | 12-ago | 218 | 142 / 74 | **+1.634** | **+16,0 %** | −0,12 % | −317 | −5,5 % |
| `corners_over_v1` (fútbol, córners over) | 17-ago | 68 | 37 / 27 | +163 | +4,2 % | **−1,13 %** | +195 | +5,3 % |
| `cs2_rounds_v1` (CS2, hándicap de rondas) | 24-ago | 325 | 126 / 145 | **+1.061** | **+5,7 %** | **+0,86 %** | +514 | +4,3 % |
| `lol_kills_hcp_v1` (LoL, hándicap de kills) | 31-ago | 64 | 34 / 30 | −360 | −8,5 % | −0,98 % | −360 | −8,5 % |

## B.3 📄 Por segmento — corte del 14-sep (`semana-38.html:145-154`)

| Segmento | Liq. 7 d | Apostado 7 d | P&L 7 d | ROI 7 d | CLV 7 d | P&L total | ROI total | CLV total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `cs2_rounds_v1` | 137 | 7.975 | −281,31 | −3,5 % | **+0,67** | **+1.227,94** | **+4,5 %** | **+0,95** |
| `cards_under_v1` | 95 | 4.926 | −265,57 | −5,4 % | −0,80 | **+1.006,63** | **+6,2 %** | **−0,33** |
| `corners_over_v1` | 66 | 3.141 | −292,88 | −9,3 % | −1,78 | −393,68 | −5,2 % | −1,41 |
| `lol_kills_hcp_v1` | 42 | 2.436 | **+303,89** | **+12,5 %** | −1,55 | −395,86 | −4,5 % | −0,68 |
| **Total** | **340** | **18.478** | **−535,87** | **−2,9 %** | — | **+1.445,03** | **+2,4 %** | — |

**Lectura declarada** (`semana-38.html:156-162`): CS2 es el único que bate al cierre (+0,95 %) y el único cuyo
beneficio descansa sobre algo; córners es «coherente y malo» (peor CLV y peor resultado); tarjetas es «la
trampa» (+6,2 % con CLV −0,33 %); LoL kills es «la misma figura que tarjetas, más joven».

## B.4 📄 Capacidad de la sombra (7-sep, `semana-37.html:147`)

1.059 señales, 759 apostadas. De las 300 no ejecutadas, **296 fueron porque solo cotizaba una casa no
conectable** (LCK 26, MLS 22, LEC 14, Eredivisie 14, BLAST Porto 11). **De lo tomable se tomó el 99,5 %.**

Medición equivalente del 20-ago (HANDOFF.md:1773-1775): 23 de 39 no ejecutadas eran
`solo_casas_no_conectables` (18 de MLS), y **la ejecución real sobre lo tomable fue 72,9 %**.

## B.5 📄 Papel contra dinero, misma regla (7-sep, `semana-37.html:148`)

| Segmento | Papel | Dinero | ¿Coinciden? |
|---|---|---|---|
| Tarjetas under (7 días) | −5,5 % | −5,6 % (fútbol) | **Sí** — «el problema no es la casa» |
| CS2 (desde el inicio) | +5,7 % | −11,2 % | **No** — el papel toma el mejor precio entre Pinnacle y Cloudbet; el dinero solo llega a Cloudbet |

---

# PARTE C — EL TABLERO DE VENTAJA (todas las familias, todos los deportes)

## C.1 📄 Tablero del 20-ago — primera lectura (HANDOFF.md:1795-1800)

| Familia | Estado | Cifra |
|---|---|---|
| CS2 hándicap de rondas | **CONFIRMADA** | CLV +2,44 %, t = 2,38, n = 46 con cierre |
| Tarjetas under intermedias | PLANA | −0,28 %, t = −0,63, n = 64 |
| Props CS2 | PLANA | +0,08 % de línea sobre 91 |
| Goles over | EN CONTRA | −1,83 % con sd 2,14 sobre 36 (**t ≈ −5**) |
| Córners | sin veredicto | dispersión del CLV de 0 a 1,2 pp frente a 3,6 en tarjetas |

Guarda incorporada: por debajo de 0,5 pp de dispersión la familia pasa a `SIN_MOVIMIENTO` (cazó un falso
positivo: córners under intermedias ascendía a candidata con t = 1,4 sobre un CLV de +0,02 %).

## C.2 📄 Tablero por casa — 20-ago (HANDOFF.md:1582-1594), ≥8 liquidadas con cierre

| Deporte | Familia | Casa | ¿API? | n | CLV | sd |
|---|---|---|---|---:|---:|---:|
| cs2 | rondas hándicap | Pinnacle | no | 24 | **+3,10 %** | 5,47 |
| cs2 | rondas hándicap | Bovada | no | 21 | **+2,90 %** | 7,56 |
| cs2 | rondas hándicap | **Cloudbet** | **sí** | 9 | **−3,13 %** | 6,06 |
| cs2 | rondas total | Pinnacle | no | 19 | +1,16 % | 2,00 |
| **combate** | **ROUNDS** | **Cloudbet** | **sí** | **27** | **+1,75 %** | 5,27 |
| combate | METHOD | Cloudbet | sí | 14 | +0,28 % | 14,68 |
| combate | FIGHT | betonline | no | 16 | −3,24 % | 16,71 |
| **fútbol** | **CARDS** | **Pinnacle** | no | **65** | **−0,42 %** | **1,69 (t = −2,02)** |
| fútbol | CARDS | Cloudbet | sí | 19 | +0,24 % | 6,03 |
| fútbol | CORNERS | leovegas | no | 107 | +0,07 % | 0,55 |
| fútbol | SOLID | smarkets | no | 32 | +0,89 % | 4,95 |

Corte previo del mismo día (HANDOFF.md:1640-1644), CS2 hándicap de rondas partido por casa: Pinnacle n=18
**+3,53 % (t +2,66)**; Bovada n=17 +1,34 % (t +0,97); Cloudbet n=9 **−3,13 % (t −1,55)**. Y las 40 apuestas de
la sombra de fútbol, todas a Cloudbet: **CLV ejecutado −1,07 %** (sd 7,17, t = −0,72) pese a un ROI observado
de +35 %.

**Profundidad real de Cloudbet, medida en la fuente sobre 69 partidos** (HANDOFF.md:1656-1664):

| Familia | Mediana | p25 | Máx |
|---|---:|---:|---:|
| tarjetas | $244 | $184 | $1.977 |
| córners | $237 | $222 | $252 |
| doble oportunidad | $341 | $175 | $17.287 |
| empate no válido | $216 | $108 | $17.287 |
| ambos marcan | $226 | $141 | $1.837 |
| hándicap asiático | $218 | $142 | $677 |

## C.3 📄 Tablero completo del 7-sep — 78 filas (`semana-37.html:153-219`)

**Resumen de estado:** 10 familias confirmadas de 78 · 8 descartadas · 36 sin muestra
(`semana-37.html:81`).

### C.3.1 Objetivos declarados

| Objetivo declarado | Liquidadas | CLV | t | Estado | Lectura |
|---|---:|---:|---:|---|---|
| CS2 rondas + hándicap de rondas | 1.372 | **+1,50 %** | 5,15 | CONFIRMADA | «Bate al cierre y no por casualidad. La ventaja vive al precio de Pinnacle.» |
| CS2 props Underdog (v2) | 444 | **+0,58 %** | 3,33 | CONFIRMADA | CLV de línea; ROI −0,3 % aún |
| College (NCAAF spreads y totales) | 175 | **+6,27 %** | 9,43 | CONFIRMADA | cierre de referencia lowvig, no conectable; ROI de spreads −9,4 % |
| Fútbol tarjetas under | 339 | −0,42 % | −1,56 | EN_CONTRA | ROI en papel +16 % pero el cierre no lo respalda |
| Fútbol córners over | 260 | 0,00 % | 0,04 | PLANA | indistinguible del mercado |
| LoL kills (hándicap) | 609 | −0,26 % | −1,53 | EN_CONTRA | — |
| Tenis totales | 150 | −1,81 % | −0,54 | PLANA | el preregistro (≥8 pp) va 39 eventos, ROI +29 %, t 1,98 |
| F1 podio / top 10 | 19 | — | — | SIN_MUESTRA | sin cobertura de mercado: no hay cierre |
| NFL | 0 | — | — | SIN_PICKS | arranca el 9-sep |
| Valorant prórroga | 0 | — | — | SIN_PICKS | la casa no cotiza la familia |

### C.3.2 Todas las filas con muestra (≥30 liquidadas) — 7-sep

| Deporte | Familia · lado · banda | n | Acierto | ROI | CLV | t | Estado |
|---|---|---:|---:|---:|---:|---:|---|
| Fútbol | CARDS under · intermedia | 153 | 71,2 % | **+22,7 %** | −0,42 % | −1,56 | EN_CONTRA |
| Fútbol | CARDS under · eficiente | 114 | 65,8 % | −0,2 % | −0,90 % | **−3,27** | DESCARTAR |
| Fútbol | CARDS under · sin banda | 46 | 76,1 % | +21,0 % | +0,61 % | 0,68 | PLANA |
| Fútbol | CARDS over · eficiente | 68 | 55,9 % | −2,5 % | −0,27 % | −2,23 | EN_CONTRA |
| Fútbol | CARDS over · intermedia | 41 | 41,5 % | **−31,0 %** | −0,84 % | −2,43 | EN_CONTRA |
| Fútbol | CORNERS under · intermedia | 247 | 62,8 % | −5,0 % | −0,06 % | −1,48 | EN_CONTRA |
| Fútbol | CORNERS under · eficiente | 173 | 64,7 % | −6,1 % | −0,17 % | **−2,28** | DESCARTAR |
| Fútbol | CORNERS over · blanda | 106 | 67,0 % | +7,4 % | 0,00 % | 0,04 | PLANA |
| Fútbol | CORNERS under · blanda | 106 | 64,2 % | +3,9 % | −0,03 % | −0,53 | PLANA |
| Fútbol | CORNERS over · intermedia | 77 | 63,6 % | +15,9 % | −0,08 % | −1,00 | EN_CONTRA |
| Fútbol | CORNERS over · eficiente | 54 | 68,5 % | +0,6 % | +0,03 % | 0,20 | PLANA |
| Fútbol | GOALS over · sin banda | 37 | 59,5 % | +13,0 % | −1,83 % | **−5,14** | EN_CONTRA |
| Fútbol | GOALS over · intermedia | 32 | 62,5 % | +7,4 % | −0,84 % | −2,87 | EN_CONTRA |
| Fútbol | SOLID · blanda | 373 | 29,8 % | −11,1 % | +1,03 % | 1,80 | PROMETE |
| Fútbol | SOLID · sin banda | 81 | 48,1 % | −21,1 % | −0,25 % | −0,30 | PLANA |
| Fútbol | COMBO under · eficiente | 86 | 27,9 % | −11,9 % | — | — | SIN_CLV |
| Fútbol | COMBO over · eficiente | 34 | 47,1 % | **+47,0 %** | — | — | SIN_CLV |
| Fútbol derivadas | asian_handicap | 1.686 | 42,4 % | −13,4 % | −3,38 % | **−17,2** | DESCARTAR |
| Fútbol derivadas | team_total | 733 | 45,7 % | −8,1 % | −1,04 % | −4,00 | DESCARTAR |
| Fútbol derivadas | double_chance | 323 | 52,0 % | −8,5 % | −2,16 % | −5,68 | DESCARTAR |
| Fútbol derivadas | draw_no_bet | 304 | 20,7 % | −17,8 % | −3,20 % | −5,10 | DESCARTAR |
| Fútbol derivadas | btts | 173 | 45,7 % | −6,8 % | −0,97 % | −2,99 | DESCARTAR |
| CS2 | RONDAS_HANDICAP | 868 | 39,7 % | **+3,8 %** | **+1,50 %** | **5,15** | CONFIRMADA |
| CS2 | RONDAS (total) | 460 | 38,3 % | −1,6 % | **+1,34 %** | **4,99** | CONFIRMADA |
| CS2 | HANDICAP (mapas) | 85 | 34,1 % | −10,3 % | **+20,5 %** | **3,49** | CONFIRMADA |
| CS2 | RONDAS_EQUIPO | 44 | 34,1 % | −4,6 % | **+38,6 %** | **3,26** | CONFIRMADA |
| CS2 props | `props_cs2_v2` (Underdog) | 302 | 52,7 % | −0,3 % | **+0,58 %** | **3,33** | CONFIRMADA |
| CS2 props | `props_cs2_v1` | 142 | 50,7 % | −3,6 % | +0,40 % | 1,54 | PROMETE |
| LoL | KILLS_HANDICAP | 372 | 55,4 % | −2,6 % | −0,26 % | −1,53 | EN_CONTRA |
| LoL | KILLS (total) | 175 | 51,4 % | **+7,7 %** | **+1,45 %** | **2,52** | CONFIRMADA |
| LoL | HANDICAP (mapas) | 60 | 45,0 % | **+15,5 %** | **+11,0 %** | **3,12** | CONFIRMADA |
| LoL | KILLS_DNB | 49 | 69,4 % | +0,7 % | −3,32 % | −2,29 | EN_CONTRA |
| Valorant | RONDAS_HANDICAP | 178 | 34,3 % | −14,3 % | −0,10 % | −0,32 | PLANA |
| Valorant | RONDAS (total) | 107 | 37,4 % | −9,9 % | **+0,90 %** | **4,15** | CONFIRMADA |
| Valorant | HANDICAP (mapas) | 54 | 38,9 % | +25,1 % | +4,06 % | 0,88 | PLANA |
| Valorant | RONDAS_EQUIPO | 32 | 40,6 % | +3,6 % | −1,00 % | — | SIN_CLV |
| Dota 2 | KILLS (total) | 72 | 50,0 % | −4,2 % | +0,28 % | 1,82 | PROMETE |
| Dota 2 | KILLS_HANDICAP | 55 | 49,1 % | −12,2 % | −0,50 % | — | SIN_CLV |
| Tenis | ML | 170 | 41,2 % | **+12,6 %** | **−16,7 %** | **−4,59** | DESCARTAR |
| Tenis | SPREAD | 355 | 51,0 % | +0,2 % | −4,33 % | −2,74 | EN_CONTRA |
| Tenis | TOTAL | 150 | 58,0 % | +12,7 % | −1,81 % | −0,54 | PLANA |
| Baloncesto (WNBA) | SPREAD | 111 | 53,2 % | +1,8 % | −0,84 % | −1,41 | EN_CONTRA |
| Baloncesto (WNBA) | TOTAL | 57 | 52,6 % | +2,3 % | **+2,55 %** | 1,20 | PROMETE |
| NCAAF | SPREAD | 89 | 44,9 % | −9,4 % | **+6,27 %** | **9,43** | CONFIRMADA |
| NCAAF | TOTAL | 57 | 52,6 % | +3,6 % | **+4,79 %** | **24,8** | CONFIRMADA |
| Combate | FIGHT · blanda | 49 | 40,8 % | −15,3 % | −3,30 % | −1,52 | EN_CONTRA |
| Combate | ROUNDS · blanda | 37 | 46,0 % | −2,3 % | +0,63 % | 0,78 | PLANA |

**Fuera de la tabla por muestra corta (<30)** (`semana-37.html:219`): CFL spread y total (20 y 29, CLV +10,7
y +5,0 pero ROI negativo), Dota 2 hándicap de mapas, combate en ligas eficientes, F1 (19 liquidadas, sin
cierre), fútbol PLAYER (26), tarjetas under en ligas blandas (26, **ROI +61 %**).

## C.4 📄 Tablero del 14-sep — 96 filas (`semana-38.html:164-201`)

**Reparto con la vara aplicada:** **13 confirmadas** (t ≥ 2) · **15 en contra** · **9 para descartar** ·
3 prometen · 16 planas · **42 sin muestra**.

### C.4.1 Confirmadas (baten al cierre con t ≥ 2)

| Deporte | Familia | n | Acierto | ROI | CLV | t |
|---|---|---:|---:|---:|---:|---:|
| ncaaf | TOTAL | 141 | 61,7 % | **+21,2 %** | **+4,76 %** | **38,45** |
| ncaaf | SPREAD | 202 | 48,0 % | −4,6 % | **+5,72 %** | **17,45** |
| cfl | TOTAL | 46 | 43,5 % | −15,2 % | **+4,64 %** | **11,79** |
| cfl | SPREAD | 34 | 32,4 % | −34,0 % | **+8,87 %** | **8,08** |
| cs2 | RONDAS | 642 | 36,6 % | **+1,9 %** | **+1,89 %** | **5,95** |
| cs2 | RONDAS_HANDICAP | 1.232 | 36,0 % | **+2,1 %** | **+1,92 %** | **5,67** |
| cs2 | TOTAL_MAPAS | 44 | 43,2 % | −1,4 % | **+9,95 %** | **5,03** |
| cs2 | HANDICAP | 145 | 31,0 % | −13,6 % | **+20,19 %** | **4,64** |
| valorant | RONDAS | 143 | 30,8 % | −5,4 % | **+0,75 %** | **4,21** |
| lol | HANDICAP | 92 | 38,0 % | −1,6 % | **+10,42 %** | **3,73** |
| cs2-props | `props_cs2_v2` | 330 | 53,9 % | **+2,2 %** | **+0,47 %** | **3,21** |
| cs2 | RONDAS_EQUIPO | 70 | 32,9 % | −6,3 % | **+30,72 %** | **3,13** |
| lol | KILLS | 279 | 51,6 % | **+11,8 %** | **+1,18 %** | **2,98** |

### C.4.2 Para descartar (t ≤ −2 y ≥ 100 liquidadas)

| Deporte | Familia | n | ROI | CLV | t |
|---|---|---:|---:|---:|---:|
| futbol-derivadas | asian_handicap | 3.222 | −7,9 % | −3,66 % | **−26,49** |
| futbol-derivadas | double_chance | 508 | −5,4 % | −2,76 % | −8,79 |
| futbol-derivadas | draw_no_bet | 474 | −10,8 % | −4,43 % | −8,28 |
| futbol-derivadas | team_total | 1.350 | −9,5 % | −1,01 % | −5,29 |
| tenis | ML | 193 | **+11,6 %** | **−15,52 %** | −4,65 |
| futbol | CARDS under | 243 / 186 / 170 | varios | −0,4 a −1,0 % | −2,2 a −4,3 |
| futbol | CORNERS under | 243 | −6,5 % | −0,39 % | −4,32 |
| futbol-derivadas | btts | 301 | −2,5 % | −0,97 % | −3,61 |

> **Nota del reporte sobre tenis ML** (`semana-38.html:202`): «+11,6 % de ROI con un CLV de −15,52 %: gana
> dinero tomando precios sistemáticamente peores que el cierre, sobre 193 liquidadas. Eso no es ventaja, es
> una prima de riesgo cobrada a favor durante una racha.»

---

# PARTE D — FÚTBOL

## D.1 📄 Picks de clubes (SOLID, CORNERS, CARDS, GOALS, COMBO, PLAYER)

### D.1.1 Corte del 2-sep — libro completo (`docs/AUTOPSIA_MODELOS_2026-09-02.md` §2)

| Familia | n | Acierto | ROI | CLV medio (t) | Brier modelo vs mercado | Veredicto |
|---|---:|---:|---:|---|---|---|
| Fútbol SOLID (1X2) | 432 | 31,9 % | **−12,6 %** | +2,0 (1,6) | **0,238 vs 0,201** | «el modelo va al lado equivocado» |
| Fútbol GOALS | 130 | 52,3 % | −8,8 % | **−1,3 (−4,1)** | — | «sin edge: sigue al mercado con error» |
| Fútbol CORNERS | 587 | 64,4 % | +0,1 % | −0,05 (−1,6) | — | «breakeven: el modelo es la media de la liga» |
| Fútbol CARDS | 361 | 64,8 % | **+11,2 %** | −0,5 (−3,7) | — | «gana con CLV negativo» |

### D.1.2 Corte del 7-sep (`semana-37.html:223-239`)

| KPI | Valor |
|---|---|
| Decididas | **2.022** · 54,2 % de acierto · −28,9 u · ROI −1,4 % |
| Skill vs mercado (Brier) | **−0,006** (modelo 0,2314 · mercado 0,2251) |
| CLV medio | +0,19 % (solo el **15 %** de las picks cierran mejor) |
| Régimen edge | **+47,1 u** · 921 decididas · 61 % · ROI +5,1 % |

Calibración declarada: «donde el modelo dice 65 % ocurre el 58 % (−7,5 pp); donde dice 46 % ocurre el 33 %
(−12,6 pp)». Las de solo monitor: −1,2 %.

| Familia | Decididas | Acierto | Unidades | ROI | Lectura |
|---|---:|---:|---:|---:|---|
| CARDS | 455 | 64,4 % | **+37,8** | **+8,3 %** | en régimen edge: 154 picks, 72 %, **+31 %** |
| CORNERS | 818 | 63,9 % | −3,5 | −0,4 % | monitor gana (+11,9 %), edge pierde (−2 %) |
| SOLID (1X2) | 454 | 32,6 % | **−55,7** | **−12,3 %** | CLV +1,03 % en blandas pero ROI malo |
| GOALS | 149 | 53,7 % | −10,1 | −6,8 % | CLV −1,6 % |
| COMBO | 120 | 33,3 % | +5,8 | +4,8 % | sin CLV medible |
| PLAYER | 26 | 46,2 % | −3,1 | −11,8 % | sin muestra |
| Era v2 (desde 2-sep) | 240 | 62,9 % | +3,5 | +1,5 % | tarjetas 83 (66 %, +2,8 %), córners 137 (63,5 %, +2 %) |

**Control permanente de calibración de tarjetas** (`semana-37.html:244`): sobre las últimas 50, esperaba
**31,4 aciertos y hubo 32 (z 0,04)** → «el modelo de tarjetas no está roto; está sobreconfiado donde el
mercado ya es afilado».

### D.1.3 Corte del 14-sep (`semana-38.html:223`)

**2.535 liquidadas, 54,6 % de acierto, −22,63 unidades (ROI −0,9 %).** Al precio de creación era **−40,04**,
«así que el mercado se mueve a favor de nuestras picks después de publicarlas». Subfamilia **SOLID**: 488
liquidadas, **34,2 % de acierto, −20,29 unidades**.

### D.1.4 Estado de la evidencia por familia — 13-sep (HANDOFF.md:446-460)

| Familia | Evidencia | Por qué NO cruza el listón |
|---|---|---|
| **Cards under, núcleo limpio** | +25,26 % ROI · el motor bate al mercado **+0,135 con t 5,96** sobre 392 | **n = 43** en el núcleo; la ventaja se partió por la mitad: **+0,221 → +0,151 → +0,063 → +0,074** |
| **CS2 rondas hcp Pinnacle** | CLV +0,92 · **t 2,96** · n 450 · 4 semanas seguidas de ROI positivo (**+15,5 / +33,7 / +4,5 / +9,0**) | el margen es 2,21 % y el CLV 0,92 % |
| **LoL KILLS bovada** | CLV +2,00 · **t 4,38** · n 124 | margen 2,35 % |
| **Polymarket "No" fútbol** | +163,95 | **t 0,79**; devolvió el 71 % en una semana (+568 → −404) |
| Corners | 1.009 liquidadas | **t −1,99** modelo-vs-precio · ROI −1,48 % |
| Goles | 165 liquidadas | modelo y mercado dan **la misma probabilidad hasta el tercer decimal (0,574 vs 0,574)** · t −1,04 · ROI −5,50 % |
| TT, dardos, LoL hcp, baloncesto, NFL | — | negativo o sin evidencia |

«Corners y goles son la mitad del volumen del feed (**1.174 de 2.354 liquidadas**) y ninguna tiene
evidencia.»

## D.2 📄 Derivadas de fútbol — sombra `derivadas_v1` (desde 20-ago)

### D.2.1 Corte del 7-sep (`semana-37.html:241`)

**3.219 decididas, 42 % de acierto, −378 unidades (−11,75 %), CLV −2,57 % con t = −17.** Hándicap asiático es
la peor (−13,4 %, CLV −3,4 %) y la más numerosa (1.686).

### D.2.2 Corte del 13-sep — la tabla que la sonda destapó (HANDOFF.md:238-245)

| Familia | n | Unidades | ROI | Prueba directa (modelo vs precio) | Veredicto |
|---|---:|---:|---:|---|---|
| **asian_handicap** | 2.899 | **−263,65** | −9,09 % | el precio gana, **t −8,07** | `sin_margen_medido` (ver nota) |
| team_total | 1.185 | −114,15 | −9,63 % | el precio gana, t −5,76 | **cerrar** |
| draw_no_bet | 440 | −50,20 | −11,41 % | el precio gana, t −3,47 | **cerrar** |
| double_chance | 464 | −29,00 | −6,25 % | el precio gana, t −3,36 | **cerrar** |
| btts | 261 | −18,05 | −6,92 % | el precio gana, t −2,35 | **cerrar** |
| **Total** | **5.249** | **−475,05** | | | |

### D.2.3 Corte del 14-sep (`semana-38.html:207-216`)

| Familia | n | ROI | CLV recortado | t | Veredicto |
|---|---:|---:|---:|---:|---|
| asian_handicap | 3.222 | −7,9 % | −3,66 % | **−26,45** | cerrar |
| team_total | 1.350 | −9,5 % | −1,01 % | −5,32 | cerrar |
| double_chance | 508 | −5,4 % | −2,76 % | −8,79 | cerrar |
| draw_no_bet | 474 | −10,8 % | −4,43 % | −8,28 | cerrar |
| btts | 301 | −2,5 % | −0,97 % | −3,60 | sin evidencia |

> **Discrepancia a señalar:** el mismo reporte da t = −26,49 para `asian_handicap` en el tablero general
> (`semana-38.html:192`) y t = −26,45 en la sección de fútbol (`:210`); igual con `team_total` (−5,29 vs
> −5,32) y `btts` (−3,61 vs −3,60).

## D.3 🔬 Mitades de fútbol — la medición que las abrió (13-sep)

**Base:** football-data.co.uk, **33.364 partidos, 18 divisiones, 5 temporadas (2021-22 … 2025-26)**, medido el
13-sep (`goal-engine/mitades.js:68-80`).

| Magnitud | Valor medido |
|---|---|
| Goles 1T / 2T / total | 1,199 / 1,489 / 2,688 |
| **Cuota del gol del 1T** | **0,446** |
| Rango entre ligas | 0,431 – 0,463 (entre divisiones de 2,37 a 3,18 goles/partido) |
| Correlación (goles de liga ↔ cuota 1T) | 0,265 con **t = 1,1** → ninguna |
| Correlación 1T ↔ 2T | **0,05** (t 9,2 con 33 mil partidos, «y por eso el t no es el criterio aquí») |
| Ventaja local 1T / 2T / partido | 0,556 / 0,552 / 0,554 |

**Dixon-Coles NO se aplica a las mitades** (HANDOFF.md:159-164): probados ρ = −0,13 / −0,065 / 0 sobre las
mismas 33 mil mitades — con la corrección completa el **empate de mitad se sobrestima entre 2,6 y 3,6 pp de
forma sistemática**; sin ella el sesgo cae a **±0,006** en los nueve casos.

**El error de calibración medido por familia y el listón que produce** (`goal-engine/mitades.js:87-108`;
HANDOFF.md:175-189). Suelo de ruido del método = las dos familias de control que ya se publican: **gana el
local 0,034** y **más de 2,5 → 0,029**.

| Familia | Error medido | Listón (3 pp + error) | Peor tramo (nota del código) |
|---|---:|---:|---|
| `h1_btts` (ambos marcan 1T) | 0,8 pp | **3,8 pp** | — |
| `btts` (partido) | 0,9 pp | 3,9 pp | ya abierta en v1 |
| `h2_1x2` · `h2_ah` | 2,2 pp | 5,2 pp | — |
| `exact_score` (marcador exacto) | 2,3 pp | 5,3 pp | manda 1-0 (1-1 → 1,6 · 0-0 → 1,5 · 2-1 → 0,7) |
| `h1_draw_no_bet` | 2,5 pp | 5,5 pp | medido solo sobre partidos que resuelven |
| `h1_ah` (hándicap 1T) | 2,7 pp | 5,7 pp | — |
| `h2_team_total` | 3,2 pp | 6,2 pp | — |
| `win_to_nil` (ganar a cero) | 3,4 pp | 6,4 pp | — |
| `h1_1x2` · `h1_double_chance` | 3,6 pp | 6,6 pp | manda «1T gana el visitante» (local → 2,7 · empate → 2,7) |
| `h2_total` | 3,9 pp | 6,9 pp | manda 2T +2,5 (+0,5 → 1,2 · +1,5 → 1,2) |
| `h1_team_total` | 4,4 pp | 7,4 pp | manda 1T visitante +0,5 |
| `clean_sheet` (portería a cero) | 4,5 pp | 7,5 pp | manda la portería a cero del VISITANTE |
| `htft` (descanso/final) | 4,7 pp | **7,7 pp** | manda la celda visitante-visitante: «el modelo no ve las remontadas» |
| `h1_total` (total 1T) | 5,8 pp | **8,8 pp** | manda 1T +1,5 (+0,5 → 2,8 · +2,5 → 2,2) |

**Estado a 14-sep** (`semana-38.html:219-220`): las catorce familias de mitad llevan **tres días** publicando
en sombra; muestras de **14 a 47 liquidadas**, todas por debajo del listón de 30. «Lo único que ya se puede
decir es que el listón por familia funciona como se diseñó.»

**El censo que las originó** (CLAUDE.md §⚽; HANDOFF.md:139-142): Cloudbet publica **43 mercados distintos por
partido** y se leían **9**. De los 34 que faltaban, **15 los sabe valorar el motor**.

**Prueba en seco de "una posición por partido y familia"** (HANDOFF.md:214): bajó de **200 picks a 84 en 29
partidos**.

**Lo que queda FUERA con motivo medido** (`futbol-derivadas.js:80-81`):
- córners local vs visitante: correlación **−0,249**, sobredispersos (**var/media 1,18**);
- tarjetas: correlación **+0,201**, el visitante recibe más (**cuota local 0,466**).
- «Dos Poisson independientes no valen para ninguna de las dos.»

## D.4 📄 Bandas de eficiencia por liga

| Fecha | Estado medido | Fuente |
|---|---|---|
| 7-sep | **61 ligas** clasificadas por Brier del mercado sobre nuestras picks. Eficientes: Premier, Championship, MLS, Serie A, Ligue 1, Bundesliga, Eredivisie, CSL, J1, Noruega. Intermedias: LaLiga, LaLiga 2, Brasileirão, Brasil B, Argentina, Suecia, Finlandia, League One/Two. Blandas: Liga MX, Chile, Dinamarca, Rusia, Suiza, copas | `semana-37.html:243` |
| 14-sep | **14 ligas** con banda *medida* en vez de heredada. **Cinco resultaron más eficientes de lo que se suponía** —MLS, Superliga China, J1, Noruega y Dinamarca— y **cuatro de esas cinco entraron con prior «blanda»** | `semana-38.html:226` |
| 13-sep | El veto necesitó **80 partidos** para clasificar Premier, **48** para Bundesliga, **281** para MLS. **LaLiga está en brier 0,2292 con −92,68 acumulado: «es el próximo Premier»** | HANDOFF.md:493-495; TODO_NEXT.md:36-40 |

## D.5 🪟 La ventana de mercado de tarjetas (12-sep, HANDOFF.md:367-392)

**Horas entre que nace la pick y el saque, sobre 628 picks:**

```
rusia 1,0 · serieb 1,3 · argentina 1,4 · ligamx 1,5 · brasilb 1,7
mls 18,4 · laliga 24,7 · championship 30,0 · brasileirao 42,8
seriea 43,1 · bundesliga 46,0 · ligue1 59,1 · premier 71,4
```

En Liga MX, Argentina y Brasil B **el 100 % de las picks nace a menos de seis horas del saque**. En un slate
cualquiera, Liga MX tenía **68 mercados de props y CERO de tarjetas**; en todo el slate había **1.338 de
córners contra 30 de tarjetas**.

**Y esas cinco son justo donde más ventaja hay:** ligamx **+0,281 (t 2,82)**, argentina **+0,237 (t 2,66)**,
brasilb **+0,164**; mientras **premier −0,122** y está disponible tres días enteros. **Ese cambio de mezcla
explica el 26 % de la caída de ROI (−7,36 pp de −28,02 pp).**

Verificación en producción de `cloudbetCercania()`: detectó los 5 partidos en ventana y capturó **110 cuotas
de tarjetas**.

## D.6 🔬 Backtests de fútbol

### D.6.1 De-vig Shin vs proporcional (`docs/DEVIG_SHIN_MEDIDO.md`, 2-sep)

**Muestra:** 19.850 partidos (2023-24, 2024-25, 2025-26), 18 divisiones, **59.550 resultados**. Cierre
Pinnacle 15.910, apertura Pinnacle 4, media de cierre 3.936. **z medio de Shin = 0,0216.**

| Tramo de cuota | n | Prop. | Shin | Real | Error prop. (pp) | Error Shin (pp) | Brier prop. | Brier Shin |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ≤1,50 | 2.892 | 72,7 % | 74,0 % | 75,1 % | −2,47 | −1,15 | 0,1818 | 0,1813 |
| 1,50-2,00 | 6.807 | 54,5 % | 55,2 % | 55,7 % | −1,18 | −0,49 | 0,2441 | 0,2439 |
| 2,00-2,50 | 7.523 | 42,8 % | 43,1 % | 44,1 % | −1,29 | −1,00 | 0,2462 | 0,2461 |
| 2,50-3,20 | 11.057 | 33,2 % | 33,2 % | 32,7 % | +0,55 | +0,53 | 0,2195 | 0,2195 |
| 3,20-5,00 | 23.852 | 25,6 % | 25,4 % | 25,3 % | +0,35 | +0,11 | 0,1877 | 0,1876 |
| 5,00-8,00 | 5.218 | 16,1 % | 15,5 % | 15,1 % | +0,99 | +0,43 | 0,1281 | 0,1280 |
| >8,00 | 2.201 | 8,7 % | 7,9 % | 6,4 % | +2,36 | +1,58 | 0,0596 | 0,0593 |
| **Total** | **59.550** | | | | | | **0,1972** | **0,1971** |

**Log-loss medio por resultado: proporcional 0,57919 · Shin 0,57894.** Lectura: Shin corrige «algo más de la
mitad» del sesgo favorito-longshot y no empeora ningún tramo. Consecuencia para SOLID: «la parte de la
ventaja que venía de comprar longshots a la mejor de 30 casas contra un consenso proporcional (mercado
17,1 % vs observado 13,1 % en cuota >5) era margen mal repartido, no señal».

### D.6.2 Rating alimentado con cuotas (`docs/impl/elo-odds-REPORT.md`, 3-sep; `docs/ELO_CUOTAS_BACKTEST.md`)

**Muestra:** 33.335 partidos, 18 divisiones, 5 temporadas; cierre Pinnacle con Shin; desarrollo 2223+2324
(2122 calienta), evaluación 2425+2526 congelada. Parámetros elegidos en desarrollo: **K_odds = 250** (meseta
250-300), **w = 0,75**, α = 0,2 (D sobre A), α = 0 (D sobre B).

**Log-loss por temporada de evaluación:**

| Temporada | n | Cierre (Shin) | Techo del transform | A resultados (prod.) | B cuotas K=250 | C híbrido | D_A | D_B |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2425 | 6.589 | 0,9905 | 0,9957 (+0,0052 vs cierre, t 4,3) | 1,0213 (+0,0308 vs cierre, t 11,3) | **1,0032** (−0,0180 vs A, **t −7,69**; +0,0127 vs cierre, t 7,1) | 1,0040 (t −8,18 vs A) | 1,0184 (t −2,80 vs A) |
| 2526 | 6.554 | 0,9967 | 1,0019 (+0,0052, t 5,0) | 1,0243 (+0,0276, t 10,2) | **1,0095** (−0,0148 vs A, **t −6,03**; +0,0128 vs cierre, t 7,8) | 1,0099 (t −6,48) | 1,0226 (t −1,55) |
| 8 primeras jornadas 2425 | 1.384 | 0,9810 | 0,9878 | 1,0162 | **0,9919** (−0,0243 vs A, t −4,47) | 0,9943 | 1,0108 (t −1,59) |
| 8 primeras jornadas 2526 | 1.378 | 1,0039 | 1,0101 | 1,0390 | **1,0275** (−0,0115 vs A, t −2,07) | 1,0291 | 1,0342 (t −1,30) |

**ROI de la regla `lead` al cierre** (0,5 modelo/mercado, ventaja ≥ 2 pp):

| Temporada | A · n / ROI / t | B · n / ROI / t | D_A · n / ROI / t |
|---|---|---|---|
| 2425 | 3.633 / **−10,4 %** / −3,82 | 1.321 / **−13,1 %** / −2,24 | 3.499 / −9,9 % / −3,47 |
| 2526 | 3.632 / **−13,7 %** / −5,86 | 1.486 / **−27,0 %** / −6,59 | 3.517 / −12,9 % / −5,26 |

**Veredicto:** B bate al Elo de resultados (t −7,7 y −6,0) pero **ninguna variante se acerca al cierre**
(+0,013, t 7-8); `lead` pierde bajo todos los ratings y **más** con B. «Confirma `GP_SOLID_C = 0`.»
Criterio declarado para encender el rating paralelo en producción: **n ≥ 300 con cierre y t ≤ −2**.

### D.6.3 Prior por división en copas (`docs/impl/futbol-REPORT.md` §4.1, 2-sep)

3.377 picks del libro real, **92 SOLID de copas fusionadas**:

| Tramo | n | modelo−mercado GAP=0 | GAP=150 | \|disc\| GAP=0 → 150 | n dec. | Brier mercado / GAP=0 / GAP=150 |
|---|---:|---:|---:|---|---:|---|
| Todas | 92 | +10,4 pp | **+2,8 pp** | 14,6 → 6,6 | 63 | 0,127 / 0,195 / **0,138** |
| Cruzan división | 49 | +15,7 pp | **+1,5 pp** | 20,1 → 5,1 | 38 | 0,090 / 0,185 / **0,091** |
| Misma división | 43 | +4,4 pp | +4,4 pp | 8,3 → 8,3 | 25 | 0,184 / 0,210 / 0,210 |
| DFB-Pokal | 18 | +21,7 | +1,8 | 21,7 → 5,5 | 15 | 0,080 / 0,171 / 0,079 |
| EFL Cup | 27 | +8,5 | +2,3 | 16,4 → 5,3 | 18 | 0,111 / 0,221 / 0,124 |
| Coppa Italia | 18 | +12,9 | +3,2 | 14,0 → 6,2 | 15 | 0,167 / 0,199 / 0,169 |

«El valor 150 sigue siendo un prior declarado: no se ajustó con esta tabla.»

### D.6.4 Árbitro en córners (`docs/CORNERS_ARBITRO_BACKTEST.md`, 3-sep)

**Muestra:** football-data.co.uk, E0/E1/E2/E3/SC0, temporadas 2122-2627. **11.466 partidos, 100 % con
árbitro.** Desarrollo 2122+2223; test 2324-2627 (**6.938 partidos**).

| Resultado | Cifra |
|---|---|
| **Varianza del total explicada por el árbitro** | **0,24 %** (ICC). τ² = 0,028 córners² vs σ² = 11,53; F = 1,17; p de permutación **0,079** (solo test: 0,23 %, p 0,18) |
| Fiabilidad mitad/mitad del efecto por árbitro | **ρ = 0,03** (test: −0,02), 126 árbitros con ≥20 partidos |
| Prior empírico-Bayes | **K ≈ 400** partidos equivalentes (en desarrollo puro K ≈ 6.400); un árbitro con 150 partidos mueve la proyección ±1 % |
| K = 14 (el prior de tarjetas) | Δ CRPS **+0,0087 (t +3,0)**, Δ Brier +0,0016 (t +3,6) → **empeora** |
| K = 40 / K = 100 / K = 400 | t +2,0 / t +1,1 / t −0,03 (indistinguible de M1) |
| **Lo que SÍ añade: los equipos** | K_team = 40 con DAMP = 0,5 → **Δ CRPS −0,0114 (t −5,4)**, IC bootstrap [−0,015; −0,007]; Δ MAE −0,014 córners; Δ log-score −0,006; Brier de P(over) en las 4 líneas sintéticas t entre −3,0 y −5,1; positivo en las **5 ligas** y en las 3 temporadas completas de test |
| DAMP = 1 con K_team = 4 («equipos a pelo») | **empeora, t = +5,0** |

Descriptivos por liga (§3.1 del mismo documento):

| Liga | n | Media total | var/media | Mediana | Árbitros distintos | Partidos/árbitro (mediana) |
|---|---:|---:|---:|---:|---:|---:|
| E0 | 1.920 | 10,32 | 1,11 | 10 | 39 | 32 |
| E1 | 2.796 | 10,20 | 1,13 | 10 | 72 | 21,5 |
| E2 | 2.795 | 10,09 | 1,18 | 10 | 117 | 15 |

Umbral declarado para reabrir la capa: **ICC > 1 % con p < 0,01 en ≥2.000 partidos de una liga.**

**Nota operativa de producción** (`semana-37.html:244`): la capa de árbitros existe (9.929 partidos) pero está
apagada; **5 de 1.582 picks de córners tenían árbitro asignado a tiempo**.

### D.6.5 Resumen ejecutivo de los backtests de fútbol (`docs/BACKTESTS_FAMILIAS_2026-09-02.md` §2)

| Mejora probada | Veredicto | Efecto medido |
|---|---|---|
| Blend `c` del Elo sobre el mercado (1X2) | **RECHAZADA** | **c = −0,14 (SE 0,22)**: el Elo no añade información al 1X2 |
| De-vig proporcional → Shin/potencia | PENDIENTE de dato | cuota >5: mercado **17,1 % vs observado 13,1 %** (n=84); la regla «mejor cuota > justa» pierde −27 % por eso |
| Excluir copas del 1X2 | **CAE como "acepta"** → inconcluso | con la definición correcta (n=62): ROI −33 % (t −1,3), no −52 % (t −3,8); permutación p 0,13. Lo que sobrevive es el mecanismo: discrepancia +22 pp vs +10 pp |
| GOALS: reescalar λ×k / recalibrar | **RECHAZADA** | nivel correcto (modelo 0,518, mercado 0,527, **observado 0,523**); k=0,96 empeora fuera de muestra; el problema es precio (CLV −1,32 %, t −4,1) |
| CORNERS ≥2 casas | **INCONCLUSO-FAVORABLE** | **+12,1 %** (n=204, SE 6,1, t clúster 2,0); frente al nulo de mercado p 0,0003; **Liga MX aporta el 60 % de las unidades** (sin ella +5,5 %, t 0,97); con `books` de creación n=142 y +9,4 % (t 1,23). El grupo «1 casa» son 212 unders de LeoVegas: **−10,8 %** |
| CORNERS: desviación vs media de liga; seguir el cierre | **RECHAZADAS** | log-loss 0,682 vs 0,676 solo mercado; seguir el cierre −8,3 % ± 7,0 |

### D.6.6 🔬 Auditoría xG del Mundial (`docs/xg-audit-2026-07-06.md`, 6-jul)

**A. Liga completa (92 partidos, xG = TheStatsAPI, goles = API-Football):**

| Magnitud | Valor |
|---|---|
| Goles/partido | **2,92** |
| xG/partido | **2,52** → finishing del torneo **+16,1 %** sobre lo esperado |
| Correlación goles~xG por partido | **0,548** (equipo-partido 0,687) |
| Over 2,5 REAL | **55,4 %** · implícito por Poisson(xG observado) 44,0 % |
| BTTS REAL | **54,3 %** · implícito por xG observado 35,9 % |
| xG-justice | en **84,1 %** de los partidos con ganador ganó el que más xG generó (11/69 «robos») |

**B. Modelo GP vs realidad (12 partidos con snapshot pre-kickoff):**

| Magnitud | Valor |
|---|---|
| λ media del modelo | 1,43 |
| xG observado medio | 1,39 |
| Goles medios | 1,33 |
| **Sesgo λ − xG** | **+0,04 por equipo** |
| **MAE λ vs xG observado** | **0,37** |
| Correlación λ~xG | **0,852** · λ~goles 0,589 |
| BTTS | modelo 51,6 % vs real 41,7 % (n=12) |

Detalle partido a partido (λ modelo → xG observado → goles): COL-GHA 2,42-0,65 → 1,97-0,27 → 1-0 · ENG-COD
2,01-0,63 → 2,07-0,75 → 2-1 · CIV-NOR 1,36-1,68 → 1,42-1,84 → 1-2 · MEX-ENG 1,14-1,55 → 1,87-1,48 → 2-3 ·
ESP-AUT 2,05-0,77 → 2,74-0,31 → 3-0 · MEX-ECU 1,41-1,32 → 1,02-0,72 → 2-0 · PAR-FRA 0,73-2,08 → 0,13-1,41 →
0-1 · BRA-NOR 2,23-1,15 → 2,49-1,01 → 1-2 · SUI-ALG 1,88-0,83 → 2,34-0,70 → 2-0 · CAN-MAR 1,12-1,52 →
0,81-0,78 → 0-3 · POR-CRO 1,67-1,05 → 2,12-1,31 → 2-1 · FRA-SWE 2,41-0,65 → 3,14-0,66 → 3-0.

---

# PARTE E — ESPORTS

## E.1 📄 Agregado por juego

### E.1.1 Corte del 2-sep (`docs/AUTOPSIA_MODELOS_2026-09-02.md` §2, tras las correcciones de liquidación)

| Familia | n | Acierto | ROI | CLV medio (t) | Brier modelo vs mercado | Veredicto |
|---|---:|---:|---:|---|---|---|
| CS2 (todas) | 738 | 47,6 % | **+4,0 %** | +2,2 | 0,252 vs 0,244 | gana por **precio y momento**, no por modelo |
| CS2 RONDAS_HANDICAP perro | 183 | 54,1 % | **+18,6 %** | +2,3 | — | el único bolsillo con edge que sobrevive al cierre (**+5,7 %**) |
| Valorant (todas) | 304 | 35,2 % | **−8,2 %** | 0,0 | **0,248 vs 0,221** | modelo claramente inferior |
| LoL KILLS_HANDICAP | 238 | 58,0 % | +2,0 % | +0,1 | — | sobreconfiado 20-30 pp; edge ≈ 0 |
| Dota KILLS/KILLS_H | 122 | 50 % | −6,9 % | 0,0 | **0,273 vs 0,252** | inferior |

### E.1.2 Corte del 7-sep (`semana-37.html:247-253`)

| Juego | Liquidadas | G / P | Acierto | Unidades | ROI | CLV | Familias que confirman | En contra |
|---|---:|---|---:|---:|---:|---:|---|---|
| CS2 | 1.480 | 575 / 669 | 46,2 % | **+12,5** | +0,8 % | **+3,92 %** | RONDAS_HANDICAP (+32,6 u), RONDAS, HANDICAP, RONDAS_EQUIPO | — |
| LoL | 681 | 368 / 303 | 54,8 % | **+12,1** | +1,8 % | **+1,22 %** | KILLS total (+13,6 u, Bovada), HANDICAP mapas (+9,3 u) | KILLS_HANDICAP (−9,7 u), KILLS_DNB |
| Valorant | 374 | 136 / 238 | 36,4 % | **−21,8** | −5,8 % | +0,69 % | RONDAS total (CLV, no ROI) | RONDAS_HANDICAP (−25,4 u, plana) |
| Dota 2 | 148 | 72 / 76 | 48,6 % | **−9,6** | −6,5 % | +4,45 % | KILLS total promete (t 1,82) | KILLS_HANDICAP, KILLS_EQUIPO |

### E.1.3 Corte del 14-sep (`semana-38.html:229-238`)

| Juego | Liquidadas | Acierto | Unidades | ROI | CLV | Activas |
|---|---:|---:|---:|---:|---:|---:|
| CS2 | 2.135 | 45,6 % | **+13,93** | **+0,65 %** | **+4,37 %** | 242 |
| LoL | 1.121 | 55,1 % | **+22,51** | **+2,01 %** | **+1,27 %** | 112 |
| Valorant | 435 | 36,9 % | −19,16 | −4,40 % | **+0,65 %** | 14 |
| Dota 2 | 289 | 48,1 % | −17,65 | −6,11 % | **+1,89 %** | 90 |

«Los cuatro juegos tienen CLV positivo… El CLV de CS2 (**+4,37 % sobre 1.936 mediciones**) es el número más
sólido de toda la plataforma.»

## E.2 📄 CS2 por casa (hándicap de rondas)

| Fecha | Casa | n | Acierto | ROI | CLV | Fuente |
|---|---|---:|---:|---:|---:|---|
| 2-sep | **Pinnacle cotizando solo (bq1)** | 287 | — | **+15,6 %** | **+1,7 (t 4,4)** | AUTOPSIA §4.4 |
| 2-sep | Cloudbet bq1 | 91 | — | −9,1 % | +3,6 | AUTOPSIA §4.4 |
| 3-sep | Pinnacle | 108 | — | **+23 % flat** | +1,6 | HANDOFF.md:833 |
| 3-sep | Cloudbet | 59 | — | −19 % | — | HANDOFF.md:834 |
| 7-sep | Pinnacle | 341 | 41,3 % | **+11,6 %** | **+1,14 % (t 3,33)** | `semana-37.html:255` |
| 7-sep | Bovada | 276 | 44,9 % | +4,9 % | — | ídem |
| 7-sep | Cloudbet | 251 | 31,9 % | **−8,1 %** | +2,72 % | ídem |
| 13-sep | Pinnacle | 450 | — | 4 semanas de ROI positivo (+15,5 / +33,7 / +4,5 / +9,0) | **+0,92 (t 2,96)** | HANDOFF.md:451 |

**Descomposición del momento (2-sep, AUTOPSIA §4.4):** el **43 % de las picks ven bajar su cuota al cierre**
(CLV +7,8 en esas) frente al 24 % que la ven subir; el ROI evaluado **al precio de cierre** cae de +2,4 % a
+0,9 % en general, pero **RONDAS_HANDICAP conserva +5,7 % al cierre (n=374)** y los perros de hándicap (+3,6
rondas de media) rinden **+18,6 % (n=183)** frente a −0,8 % los favoritos.

**Bugs de modelo declarados en la misma autopsia:** `clampRound` aplicado **dos veces** (0,42² ≈ 0,18 de la
ventaja real); la variable comprimida usada como probabilidad de mapa en `simulateSeries`.

## E.3 📐 CS2 — validación del rating (`data/esports/cs2/meta.json`, 19-ago 09:54Z)

| Magnitud | Valor |
|---|---|
| Cobertura | 88.620 partidas · 84.523 casadas · 4.097 sin casar · 1.700 equipos · 15 mapas · 32.311 pares |
| Modelo | jerárquico calibrado: Elo GLOBAL + corrección por mapa encogida |
| **Validación walk-forward** | **14.297 mapas de 2026 no vistos**: skill de Brier **7,28 %**, **AUC 0,652**, **ECE 0,008**, pendiente de calibración **0,999** |
| Elo POR MAPA (descartado) | predice peor que el global: **3,04 % de skill contra 6,88 %** |

Constantes declaradas: `half_life_days` 180 · `prior_maps` 12 · pesos de tier s 1 / a 0,95 / b 0,8 / c 0,5 /
d 0,35 · `map_effect_prior` 20.

Medición previa del 16-ago (HANDOFF.md:2330): «la validación tumbó el modelo que yo había defendido» — misma
conclusión.

## E.4 📄 Props de CS2 (Underdog)

| Fecha | Versión | n | Acierto | ROI | CLV de línea | t | Fuente |
|---|---|---:|---:|---:|---:|---:|---|
| 20-ago (base rota) | — | 87 | 47-40 | +3,01 % | — | — | HANDOFF.md:1811 |
| 20-ago (rehecha) | — | 91 | 48-43 | **+0,51 %** | **+0,07 %** | — | HANDOFF.md:1811 |
| 7-sep | `props_cs2_v2` | 302 | 52,7 % | −0,3 % | **+0,58 %** | **3,33** | `semana-37.html:197,257` |
| 7-sep | `props_cs2_v1` | 142 | 50,7 % | −3,6 % | +0,40 % | 1,54 | `semana-37.html:198` |
| 7-sep | v1+v2 juntas | 444 | — | — | +0,58 % | 3,33 | `semana-37.html:158` |
| **14-sep** | **`props_cs2_v2`** | **330** | **53,9 %** | **+2,2 %** | **+0,47 %** | **3,21** | `semana-38.html:181,239` |
| 14-sep | `props_cs2_v1` | — | — | — | — | 1,54 («promete») | `semana-38.html:239` |

Regla congelada `props_cs2_v2`: **listón 10 pp** (v1 entraba desde 6). «Cada tesis guarda con qué versión
nació… v1 y v2 no son la misma familia» (HANDOFF.md:1813-1815).

Nota del 7-sep: «la línea se mueve a nuestro favor de forma medible pero el pago por pierna del libro DFS se
lo come. Seguir en sombra hasta ver si el acierto sube del 52 % al **55 %** que hace rentable la pierna»
(`semana-37.html:257`).

## E.5 📐 LoL — validación del rating (`data/esports/lol/priors.json`, 2-sep 08:05Z)

**Base propia:** 97.588 partidas (2020-01-03 → 2026-09-01), 3.251 equipos; 535.478 filas de scoreboard de
jugador (2023-01-06 → 2026-09-01); 33.185 drafts (2024-01-01 → 2026-08-31) (HANDOFF.md:930-934).

Constantes: **K = 32, `patch_decay` = 1, `side_step` = 1, `min_n` = 10**. Ventaja de lado azul: **+24,5 Elo**
(52,79 % de victorias del azul).

| Ventana | Modelo | n | Brier | Skill % | AUC | ECE | Acierto % |
|---|---|---:|---:|---:|---:|---:|---:|
| Desarrollo | gp | 72.903 | 0,22443 | **10,23** | 0,6814 | 0,0127 | 63,34 |
| Desarrollo | elo | 72.903 | 0,22517 | 9,93 | 0,6816 | 0,0307 | 63,00 |
| Desarrollo | lado | 72.903 | 0,24915 | 0,34 | 0,4964 | 0,0010 | 52,94 |
| **Holdout 120 d** | **gp** | **4.372** | **0,22059** | **11,76** | **0,6893** | **0,0161** | **64,41** |
| Holdout 120 d | elo | 4.372 | 0,22172 | 11,31 | 0,6894 | 0,0365 | 63,17 |
| Holdout 120 d | lado | 4.372 | 0,24780 | 0,88 | 0,5062 | 0,0250 | 55,31 |

Espejo de HuggingFace (misma conclusión, distinta numeración): 12,75 / 12,56 / 0,67 y +20,4 Elo de lado
(HANDOFF.md:938-939).

Nota del propio archivo: «**Brier skill NO es rentabilidad**: sin histórico de cuotas propio de LoL, esto
dice que el modelo predice, no que gane dinero».

**Fases 4 y 7** (HANDOFF.md:944-948): `player-stats.json` con **2.883 jugadores** con rating GP por rol (≥8
partidas en 365 d); `champions.json` con **18.695 filas** parche×rol×campeón + bans; Ranking GP (BLG #1, Elo
**1.914**); Draft Room resuelto en los dos lados (HLE–T1: fragilidad **16,4 % vs 19 %**).

## E.6 📐 Generador de kills de LoL (`data/esports/lol/gen-priors.json`, 9-sep 07:48Z) 🔬

**Walk-forward mensual 2024-01 → 2026-09, 38.761 partidas predichas, pMap = 0,5.** Fuente de celda:
celda 4.469 / liga 29.867 / circuito 4.425. Constantes: ventana 365 d, ventana de liga 240 d, `shrink_k` 30,
`min_cell` 8, 20.000 simulaciones, semilla 77.

| Variante | MAE kills | log-loss mediana | Brier mediana | log-loss +3 | log-loss −3 |
|---|---:|---:|---:|---:|---:|
| **Generador** | 7,65 | 0,6966 | 0,2517 | 0,6811 | 0,6418 |
| Liga plana (Poisson) | 7,62 | 0,6927 | 0,2498 | 0,6761 | 0,6694 |
| Liga histograma (n=32.464) | **7,46** | 0,6948 | — | 0,6664 | 0,6551 |
| Circuito | 8,05 | 0,6923 | 0,2496 | — | — |

**Log-loss multilínea** (líneas −9, −6, −3, 0, +3, +6, +9): generador **0,5766** · liga plana 0,6167 · liga
histograma 0,5755 · generador en la misma muestra 0,5738.

| Skill declarado | Valor |
|---|---:|
| Multilínea vs histograma de liga | **+0,2954 %** |
| Multilínea vs Poisson plana de liga | **+6,5024 %** |
| vs liga (mediana) | −0,74 % |
| vs liga histograma (mediana) | −0,11 % |

**Veredicto textual del archivo:** «El generador bate a la Poisson plana de liga en un 6,5 % de log-loss
multilínea (dispersión), pero al histograma empírico de la liga solo en un 0,3-0,5 %: la estructura no aporta
sobre la FORMA de la liga cuando pMap = 0,5. **Sesgo conocido:** en las colas (mediana ± 3) el over realizado
supera al predicho en **4-5 pp** en walk-forward.»

Calibración por decil guardada en el archivo (deciles con n>0): decil 2 n=18 p 0,292 obs 0,3889 · decil 3
n=38.226 p 0,3624 obs 0,4097 · decil 4 n=517 p 0,4045 obs 0,2959 · decil 5 n=8.314 p 0,5912 obs 0,6180 ·
decil 6 n=30.447 p 0,6225 obs 0,6779.

**Primera pasada en producción** (9-sep 08:40Z, HANDOFF.md:612-614): 2 eventos con kills cotizados, 90 pares
evaluados, **7 tesis** (KILLS over 31,5/32,5 en LCK CL con 4-5 pp de ventaja y 1,85 de incertidumbre), 12
muertas por incertidumbre.

Acople medido (HANDOFF.md:602): **b_len −0,98, b_kpm −0,38, ρ −0,47.** Discrepancia de perfil señalada:
«LCK 0,62 kpm cuando la base mide 0,90» (TODO_NEXT.md:114).

## E.7 📐 Valorant — validación (`data/esports/valorant/priors.json`, 18-ago 11:47Z)

Base: 32.508 series (vlr.gg), 5.273 equipos. Constantes: K 32, `margin_boost` 1,7, `idle_boost` 1,5,
`min_n` 10, `idle_days` 60.

| Ventana | Modelo | n | Brier | Skill % | AUC | ECE | Acierto % |
|---|---|---:|---:|---:|---:|---:|---:|
| Desarrollo | gp | 14.116 | 0,21827 | **12,69** | 0,6986 | 0,0261 | 64,91 |
| **Holdout 120 d** | gp | 893 | 0,23011 | **7,96** | 0,6638 | 0,0502 | 63,27 |
| Holdout 120 d | elo plano | 893 | 0,22994 | **8,02** | 0,6602 | 0,0493 | 63,38 |

(El Elo plano queda por encima del modelo GP en el holdout: 8,02 vs 7,96.)

**Autopsia de Valorant (2-sep, §4.3):** 304 picks, 35 % de acierto, **Brier 0,248 vs 0,221 del mercado**. En
RONDAS_HANDICAP el equipo elegido **ganó el mapa solo el 38 %** de las veces (favoritos elegidos 41 %, perros
35 %). RONDAS: 80 unders con línea media **20,3** y total real medio **21,2** (sd 2,9, 5,5 % de prórrogas).
Calibración: donde el modelo dice ≥70 ocurre el **42 %**.

**Backtest de mejoras (2-sep, §2 de BACKTESTS):** la bisección de pRound en vez de `×0,44` **sobrevive como
parche** (Brier del hándicap de rondas **−0,015**, SE 0,0055, n=128; con ella **0 de las 80 under** habrían
nacido). Anclar la p de mapa al mercado: **recomendado por eliminación** (ningún rating propio bate al
win-rate, Δ −0,0022 ± 0,0022; favorito de producción gana **45 %** (n=106) frente a una implícita del mercado
de **55,7 %**). Blend: **RECHAZADO**, c = −0,20 (RONDAS_HANDICAP −0,40).

Apertura de Valorant medida el 20-ago (HANDOFF.md:1838-1840): de **0 picks a 56** sobre 14 partidos (RONDAS
19, RONDAS_HANDICAP 24, HANDICAP 9, RONDAS_EQUIPO 4), con el veto de calibración rechazando **419 líneas**.

## E.8 📐 Dota 2 — validación (`data/esports/dota2/priors.json`, 18-ago 11:50Z)

Base: 49.645 partidos (OpenDota), 3.326 equipos. Constantes: K 12, `min_n` 8, `side_step` 2. Ventaja de
Radiant: **+3,7 Elo** (51,3 % de victorias).

| Modelo | n | Brier | Skill % | AUC | ECE | Log-loss | Acierto % |
|---|---:|---:|---:|---:|---:|---:|---:|
| moneda | 39.434 | 0,25000 | 0 | 0,5000 | 0,0101 | 0,69315 | 51,01 |
| lado | 39.434 | 0,24990 | 0,04 | 0,5032 | 0,0036 | 0,69295 | 50,83 |
| **elo** | 39.434 | 0,24433 | **2,27** | 0,5798 | 0,0176 | 0,68145 | 55,26 |
| elo_lado | 39.434 | 0,24444 | 2,22 | 0,5798 | 0,0194 | 0,68171 | 55,35 |

## E.9 Liquidación de esports — deuda medida

| Fecha | Estado | Fuente |
|---|---|---|
| 21-ago | Atascadas: CS2 **85**, LoL **31**, Valorant **60**, Dota 2 **2**. «Todo sano menos esports» | HANDOFF.md:1473-1487 |
| 21-ago | ~55 de Valorant y 27 de CS2 son **`unsettleable`** (la fuente no publica rondas por mapa): no se pueden liquidar nunca. 65 de CS2 y 20 de LoL son `unmatched` | HANDOFF.md:1505-1512 |
| 2-sep | 137 picks de LoL y 62 de Dota atascadas por límites de las fuentes (Leaguepedia 500 filas, OpenDota 100 partidos) | AUTOPSIA §1 |
| 7-sep | Liquidación desatascada: **106 picks liquidadas y 169 anuladas** (mapa no jugado) en una pasada. Quedan **166 sin casar** (Moscow Cyber Games 55, United21 16, European Pro League 15); caducan a los 21 días | `semana-37.html:256` |
| 7-sep (dinero real) | **43 apuestas reales de CS2 (271 USDT)** sin liquidar desde el 1-sep por tres fallos encadenados | HANDOFF.md:703-711 |

---

# PARTE F — TENIS

## F.1 📄 Track del monitor

| Fecha | n | G / P | Acierto | Unidades | ROI | CLV global | Fuente |
|---|---:|---|---:|---:|---:|---:|---|
| 2-sep (antes de re-liquidar) | 429 | — | — | — | **+44 %** (artefacto) | — | AUTOPSIA §1 |
| 2-sep (tras re-liquidar) | 392 | 148 / 148 (de las 297 reabiertas) | — | — | **+7,3 %** | **−12,5 %** | AUTOPSIA §1 |
| 7-sep | 675 | 338 / 334 | — | **+41,2** | **+6,1 %** | **−11,6 %** | `semana-37.html:262` |
| **14-sep** | **755** | **377 / 375** | — | **+39,61** | **+5,25 %** | **−10,5 %** | `semana-38.html:242` |

## F.2 📄 Por familia

| Fecha | Familia | n | Acierto | Unidades / ROI | CLV | t | Estado |
|---|---|---:|---:|---|---:|---:|---|
| 2-sep | ML | 109 | 43,1 % | +9,9 % | **−15,3** | −2,5 | «benchmark, nunca pick» |
| 2-sep | SPREAD | 205 | 51,9 % | +1,9 % | **−6,8** | −3,4 | inferior al cierre |
| 2-sep | TOTAL | 77 | 61,0 % | **+17,9 %** | +2,5 (n=9) | — | prometedor, n corto |
| 7-sep | ML | 170 | 41,2 % | +12,6 % | **−16,7 %** | −4,59 | DESCARTAR |
| 7-sep | SPREAD | 355 | 51,0 % | +0,2 % | −4,33 % | −2,74 | EN_CONTRA |
| 7-sep | TOTAL | 150 | 58,0 % | +12,7 % (+19 u) | −1,81 % | −0,54 | PLANA |
| **14-sep** | **ML** | **193** | **42,0 %** | **+22,30 u** | **−15,52 %** | **−4,65** | **descartar por la vara** |
| **14-sep** | **SPREAD** | **394** | **51,3 %** | **+2,68 u** | **−3,50 %** | — | en contra |
| **14-sep** | **TOTAL** | **168** | **56,0 %** | **+14,63 u** | **−1,46 %** | — | plana, «la menos mala» |

**Señal del 14-sep:** TOTAL contra el cierre de **Pinnacle en concreto** da CLV **+2,33 % con t = 2,99 — pero
solo hay 2 mediciones** (`semana-38.html:251`).

**Brier del 2-sep (AUTOPSIA §4.8):** modelo **0,247 vs 0,238** de la implícita con margen.

## F.3 📄 Preregistro TOTAL con ventaja ≥ 8 pp (`docs/PREREGISTRO_TENIS_TOTAL.md`, congelado 2-sep)

Regla congelada: ventaja ≥ **8 pp** al nacer (`edge_pp_at_create`); **unidad de cuenta = el EVENTO**;
**60 eventos** liquidados; vara = **CLV medio por evento contra Pinnacle** (éxito CLV > 0 con t ≥ 2); «el ROI
se anota pero NO decide» (con 60 eventos el SE del ROI ronda 12-15 puntos).

| Fecha | Resultado parcial | Fuente |
|---|---|---|
| 7-sep | **39 eventos decididos, ROI +29,4 % (t 1,98), acierto 66,7 %.** Solo 8 de los 60 eventos preregistrados se han jugado. CLV contra Pinnacle: 2 medidas, +2,3 % | `semana-37.html:264`; `:163` |
| 14-sep | El preregistro «sigue siendo lo más prometedor de tenis y sigue sin muestra» | `semana-38.html:251` |

**Advertencia de origen** (`PREREGISTRO_TENIS_TOTAL.md`): el libro de TOTAL «(+18 % por pick) eran 77 picks
que en realidad son **43 eventos**, con **ROI por evento +10,5 % (SE 14,7, t 0,72)** y solo 9 cierres
capturados. **No hay prueba.**»

## F.4 📐 Validación del modelo de tenis (`data/tennis/model-priors.json`, 18-ago 15:55Z, `dev_end` 20250101)

**ATP:**

| Ventana | Variante | n | Log-loss | Brier | Acierto | AUC | Skill % |
|---|---|---:|---:|---:|---:|---:|---:|
| Desarrollo | elo_mix | 18.384 | 0,62219 | 0,21709 | 64,45 % | 0,7078 | 10,24 |
| Desarrollo | compiled | 18.384 | 0,62595 | 0,21916 | 63,83 % | 0,6976 | 9,69 |
| Desarrollo | **ensemble** | 18.384 | **0,61865** | **0,21575** | 64,52 % | 0,7101 | **10,75** |
| Holdout | rank | 4.141 | 0,63223 | 0,22099 | 64,57 % | 0,7035 | 8,79 |
| Holdout | gen | 4.141 | 0,62616 | 0,21832 | 64,62 % | 0,7080 | 9,66 |
| Holdout | mix | 4.141 | 0,62263 | 0,21716 | 64,40 % | 0,7092 | 10,17 |
| Holdout | comp | 4.141 | 0,63040 | 0,22095 | 63,12 % | 0,6930 | 9,05 |
| **Holdout** | **ens** | **4.141** | **0,62035** | **0,21634** | 64,33 % | **0,7107** | **10,50** |

ATP juegos: **MAE 5,502 vs 5,576 del ingenuo**; Brier de tie-break 0,23106. Desarrollo: forma MAE 5,890 vs
5,594 del ingenuo.

**WTA:**

| Ventana | Variante | n | Log-loss | Brier | Acierto | AUC | Skill % |
|---|---|---:|---:|---:|---:|---:|---:|
| Desarrollo | elo_mix | 16.911 | 0,61844 | 0,21531 | 65,29 % | 0,7128 | 10,78 |
| Desarrollo | **ensemble** | 16.911 | **0,61783** | **0,21506** | 65,35 % | 0,7134 | **10,87** |
| Holdout | rank | 3.641 | 0,63166 | 0,22075 | 62,92 % | 0,7002 | 8,87 |
| Holdout | gen | 3.641 | 0,61579 | 0,21370 | 65,56 % | 0,7206 | 11,16 |
| Holdout | mix | 3.641 | 0,61279 | 0,21259 | 65,81 % | 0,7225 | 11,59 |
| **Holdout** | **ens** | **3.641** | **0,61196** | **0,21220** | **66,03 %** | **0,7235** | **11,71** |

WTA juegos: MAE 4,797 vs 4,859 del ingenuo; Brier de tie-break 0,18605.

## F.5 🔬 Backtests de tenis (2-sep)

| Mejora | Veredicto | Efecto medido | Fuente |
|---|---|---|---|
| **Edad lineal** en el logit del ensamble ATP | **SOBREVIVE (la más sólida)** | skill **10,12 → 10,62 %**, ΔLL 0,00345, **t 5,8**, n=4.908; coeficiente estable 9 años | BACKTESTS §2 |
| **Calendario** (log días sin jugar + partidos en 7 días) | SOBREVIVE DEGRADADA | **+0,4 pp de skill** dada la edad (ΔLL 0,00273, **t 3,1**); los otros 5 rasgos de fatiga no aportan | BACKTESTS §2 |
| **Distribución C6** (punto + residuo empírico por formato×tercil) | SOBREVIVE **solo en ATP bo3** | ATP bo3: Brier over/under abanico **0,2421 → 0,2392 (t 9,9)**, CRPS t 8,9, fiabilidad 0,444 → 0,443 | BACKTESTS §2 |
| Saque/resto por superficie | RECHAZADA | — | BACKTESTS §6.3 |
| WTA: edad y fatiga | RECHAZADAS | empeoran | BACKTESTS §2 |

**Reproducción en la rama de implementación** (`docs/impl/tenis-REPORT.md`, holdout 2025→, solo lectura):

| Tour | Formato | n | P(real>med) shift | P(real>med) c6 | ΔBrier abanico | t abanico | ΔBrier línea fija | t fija |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| atp | bo3 | 3.931 | 0,419 | **0,456** | **0,00328** | **5,38** | 0,00527 | 5,56 |
| atp | bo5 | 975 | 0,475 | 0,508 | 0,00082 | 0,61 | 0,00044 | 0,32 |
| wta | bo3 | 4.488 | 0,444 | 0,494 | 0,00056 | 1,03 | 0,00105 | 1,26 |

Cortes de tercil ATP bo3: expGames **24,73 / 25,04**; por tercil n = 4.960/4.978/4.979, media R 0,15 / −0,27 /
0,09. ATP bo5: cortes 40,11 / 41,12, media R −0,14 / −0,35 / −0,17. WTA bo3: cortes 23,97 / 24,38, media R
−0,03 / −0,09 / 0,25.

**Defecto de datos reparado:** **1.024 de 1.526 filas** de la cola ESPN tenían `best_of` mal (ATP nivel 250
marcado bo5: 516 filas; WTA bo5: 508 filas) (`docs/impl/tenis-REPORT.md`).

## F.6 Deuda de liquidación de tenis

| Fecha | Estado |
|---|---|
| 2-sep | **268 de 429 picks liquidadas con 0-0** y 56 con sets sueltos; `resettleShadow` reabrió y re-liquidó **297** picks → 148-148 (AUTOPSIA §1) |
| 7-sep | **39 picks vencidas sin cerrar** (28 sin cruce de nombres, 11 con marcador incompleto) + 60 abiertas del US Open (`semana-37.html:265`) |
| 14-sep | **9 vencidas sin cerrar** (6 sin cruce de nombres, 3 con marcador incompleto) (`semana-38.html:252`) |

---

# PARTE G — BALONCESTO

## G.1 📐 Evaluación fuera de muestra del 15-ago (TODO_NEXT.md:929-941)

| | NBA | WNBA |
|---|---:|---:|
| Partidos evaluados | 772 | 164 |
| Brier del mercado (cierre) | 0,1878 | 0,1953 |
| Brier de GP | 0,2083 | 0,2032 |
| **Skill vs cierre** | **−0,0205 ± 0,0040 · t = −5,16** | **−0,0079 ± 0,0067 · t = −1,18** |
| Acierto | 67,0 % | 67,7 % |
| MAE de margen | 12,11 | 9,80 |

Huecos medidos en los propios datos: 546 jugadores cosechados en NBA y **cero usados** (el jugador más usado
juega 37,2 min de media); **15,3 %** de los partidos NBA son back-to-back y el equipo en B2B rinde **1,56
puntos peor (n=261)** —casi el doble de la ventaja de cancha modelada (1,68)—; el detector de garbage time
marca el **64 %** de los partidos.

## G.2 🔬 Backtest al cierre del 23-ago (TODO_NEXT.md:812-826)

| | NBA (911 partidos) | WNBA (203) |
|---|---|---|
| ROI base | **−7,27 % ± 2,67 · t = −2,72** | −6,15 % ± 6,12 |
| Ganador | −11,87 % (t = −2,05) | −20,73 % |
| Hándicap | −8,80 % (t = −2,39) | −0,34 % |
| **Total** | **−0,26 % (t = −0,06)** | **+2,15 %** |

Diagnóstico: «las picks prometían **56,5 %** de acierto y dieron **43,6 %**. En el tramo donde el modelo más
confía (67-83 %) acertó el **49,3 %**.» Apostar lo contrario tampoco gana (−2,69 % en NBA).

**ROI por banda de ventaja en NBA:** 2-4 pp −3,6 % · 4-6 pp −2,79 % · **6-8 pp −16,07 %** · 8-12 pp −6,61 % ·
12+ −8,31 %.

**Props medidos el 16-ago (WNBA, 50 casas, 4 partidos):**

| | Casas por línea | Vig | EV mejor precio vs consenso | Líneas con EV ≥ 2 % |
|---|---:|---:|---|---:|
| Mercado principal | 8 | **4,71 %** | mediana −3,45 % | **9 %** |
| Props | 6 | **6,98 %** | mediana −4,07 % | **1 %** |

«Los props son más caros y están más de acuerdo entre sí, no menos… el listón real para batirlos no es 3,5 pp
sino **~4 pp sobre el consenso sin margen**.»

## G.3 🔬 Autopsia + refit del 31-ago (TODO_NEXT.md:579-591)

Walk-forward local sobre **275 partidos WNBA 2026**: acortar la media vida del rating **EMPEORA** el skill
contra el mercado (**hl=45 → skill −0,0079; hl=14 → −0,0128**). Back-to-back: el equipo rinde 4-9 pts bajo su
proyección (b2b local −4,4; rival en b2b +8,9 para el local) pero **n=9**. Vara declarada de la v2: CLV
medio ≥ 0 y % positivo ≥ 40 % con **n ≥ 60** liquidadas.

## G.4 🔬 Backtests del 2-sep (BACKTESTS §2, §5)

| Hipótesis | Veredicto | Efecto medido |
|---|---|---|
| Histograma de totales a 1 punto | SOBREVIVE como corrección de código, **no** como rentabilidad | sesgo determinista **±4,3 / 2,1 pp** por resto de la línea; al cierre WNBA **−6,4 % ± 9,4**, NBA **−2,25 % ± 4,0** |
| Umbral × peso de mezcla | **RECHAZADA** | β(desacuerdo modelo−cierre → residuo) ≈ 0: WNBA total **−0,22 [−1,01; 0,52]**, NBA **−0,05 [−0,29; 0,18]** |
| Fórmula del CLV | **DEFECTO CONFIRMADO** | **−3,16 de los −4,62 puntos** del CLV de hándicap son el margen de la casa. **79 picks = 15 tesis** |
| Descanso diferencial → over WNBA | **PREREGISTRAR** | corr **−0,24 dev / −0,16 test**; regla **13/18 en test (+37,9 % ± 20,7)** pero **p = 0,11** frente al over ciego (56,2 %). En NBA no existe (corr −0,007, n=879) |

**Bug de los cubos de 5 (AUTOPSIA §1.3):** «toda línea justo por debajo de un múltiplo de 5 heredaba ~5 pp de
over regalados». El monitor WNBA lo compró: **22 de sus 31 totales eran overs en líneas x3,5/x4/x4,5 con
17-27 % de acierto**. WNBA TOTAL en la autopsia: 31 picks, 35,5 % de acierto, **−30,9 % de ROI**.

**WNBA SPREAD (AUTOPSIA §4.6):** 79 picks, 55,7 % de acierto pero **CLV −4,6 % con t = −6,1** (solo el **12 %**
de picks con CLV positivo). Líneas ≥8 puntos: **38 % y −28 %**. «Ninguna configuración bate al cierre (skill
−0,004 a −0,022).»

## G.5 📄 Estado en producción

| Fecha | Estado | Fuente |
|---|---|---|
| 7-sep | 186 decididas: SPREAD 111 (53 %, +1,8 %, CLV −0,84 %), TOTAL 57 (53 %, +2,3 %, CLV +2,55 %, t 1,2), moneyline 18. WNBA en pausa hasta el 17-sep | `semana-37.html:269` |
| 14-sep | **187 picks activos**, todas admin-only. TOTAL +2,3 % con CLV +2,55 % y t 1,20 («promete»); SPREAD +1,8 % con CLV −0,84 % y t −1,41 («en contra») | `semana-38.html:255` |

**Preregistros congelados:** `docs/PREREGISTRO_WNBA_TOTALES.md` (60 picks de TOTAL desde el corte
`created_at ≥ 2026-09-02T10:40Z`, WNBA no juega hasta el 17-sep; vara = CLV medio > 0 y ≥ 40 % de picks con
CLV positivo; fracaso = CLV < −1 % con t < −1,5) y `docs/PREREGISTRO_WNBA_DESCANSO.md` (60 disparos; éxito =
**≥ 56 % de overs** —hay que batir el over ciego de 56,2 %, no el 50 %— con el IC de un SE por encima de
52,4 %). **Los dos figuran como «pendiente: se rellena al llegar a…»**: no hay resultado a 14-sep.

**Bug latente sin corregir** (TODO_NEXT.md:117-120): en `buildHoopsPicks` la puerta de frescura lee `best.at`
pero la fila trae `seen` → «la puerta de precio viejo nunca dispara»; y `m.fam === 'total'` donde la familia
es `match_total` → «la regla *solo under* de v2 nunca se aplica».

---

# PARTE H — FÚTBOL AMERICANO

## H.1 📐 NFL — validación walk-forward (`data/nfl/model-priors.json`, 19-ago 07:59Z) 🔬

Constantes: `hfa` 1,74 · `k_total` 18,68 · `sigma_extra_margin` 3,57 · `sigma_extra_total` 3,34.
Protocolo declarado: «walk-forward semanal 2017→: cada partido predicho SOLO con lo anterior. El cierre es el
benchmark, no el label. **El modelo NO lee ninguna cuota: es market-blind por construcción.**»

**Global (n = 2.494):**

| Métrica | Modelo | Cierre |
|---|---:|---:|
| MAE de margen | **10,31** | 9,86 |
| MAE de total | 10,80 | 10,51 |
| Brier | 0,224 | 0,210 |
| sd del error de margen | 13,28 | 12,79 |

**Por temporada:**

| Temporada | n | MAE margen modelo | MAE margen cierre | MAE total modelo | MAE total cierre | Brier modelo | Brier cierre |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2017 | 267 | 10,54 | 10,08 | 11,57 | 11,26 | 0,2163 | 0,2031 |
| 2018 | 267 | 10,17 | 9,87 | 11,07 | 10,72 | 0,2193 | 0,2122 |
| 2019 | 267 | 10,54 | 10,18 | 10,88 | 10,78 | 0,2245 | 0,2140 |
| 2020 | 269 | 10,21 | 9,79 | 10,74 | 10,30 | 0,2247 | 0,2028 |
| 2021 | 285 | 11,10 | 10,67 | 11,19 | 10,81 | 0,2290 | 0,2189 |
| 2022 | 284 | 9,21 | 8,78 | 10,72 | 10,40 | 0,2275 | 0,2088 |
| 2023 | 285 | 10,44 | 9,98 | 10,63 | 10,17 | 0,2293 | 0,2186 |
| 2024 | 285 | 10,29 | 9,70 | 9,82 | 9,77 | 0,2200 | 0,2010 |
| 2025 | 285 | 10,25 | 9,67 | 10,59 | 10,42 | 0,2247 | 0,2104 |

**Backtest «entrar AL CIERRE cuando |modelo − cierre| ≥ umbral» (−110, break-even 52,4 %):**

| Familia | Umbral | n | Acierto | ROI |
|---|---|---:|---:|---:|
| SPREAD | 2 pts | 1.346 | 50,2 % | **−4,04 %** |
| SPREAD | 3 pts | 898 | 51,0 % | −2,51 % |
| SPREAD | **4 pts** | 575 | 53,2 % | **+1,55 %** |
| TOTAL | 2 pts | 1.279 | 50,1 % | −4,22 % |
| TOTAL | 3 pts | 827 | 51,5 % | −1,67 % |
| TOTAL | **4 pts** | 483 | 52,4 % | **+0,10 %** |
| MONEYLINE | 3 pp | 1.945 | 33,2 % | **−9,81 %** |
| MONEYLINE | 5 pp | 1.617 | 32,8 % | **−7,24 %** |

## H.2 📐 NCAAF — validación (`data/amfoot/priors-ncaaf.json`, 19-ago 08:11Z) 🔬

Constantes: `hfa` 3,82 · halflife 20 · carry 0,5 · K 5 · cap 45 · `fcs_prior` −24 · `sigma_margin` 17,25 ·
`sigma_total` 17,01. Walk-forward semanal 2016→.

| Métrica (n = 7.552; n_close 7.542) | Modelo | Cierre |
|---|---:|---:|
| MAE de margen | **13,59** | 12,34 |
| MAE de total | 13,50 | 12,85 |
| Brier | 0,2031 | 0,1841 |
| sd del error de margen | 17,25 | 15,67 |

**Backtest al cierre (−110, break-even 52,4 %):**

| Familia | Umbral | n | Acierto | ROI |
|---|---|---:|---:|---:|
| SPREAD | 2 pts | 5.653 | 49,4 % | −5,63 % |
| SPREAD | 3 pts | 4.757 | 49,5 % | −5,33 % |
| SPREAD | 4 pts | 3.944 | 49,0 % | −6,35 % |
| SPREAD | 6 pts | 2.671 | 48,3 % | **−7,54 %** |
| TOTAL | 2 pts | 5.079 | 52,0 % | −0,71 % |
| TOTAL | 3 pts | 4.275 | 51,9 % | −0,88 % |
| TOTAL | 4 pts | 3.501 | 52,3 % | −0,19 % |
| TOTAL | **6 pts** | 2.199 | 52,9 % | **+1,04 %** |

## H.3 📐 CFL — validación (`data/amfoot/priors-cfl.json`, 19-ago 08:11Z) 🔬

Constantes: `hfa` 1,93 · halflife 18 · carry 0,45 · K 5 · cap 35 · `sigma_margin` 13,42 · `sigma_total` 13,82.
Walk-forward semanal 2022→.

| Métrica (n = 373; n_close 249) | Modelo | Cierre |
|---|---:|---:|
| MAE de margen | **10,55** | 9,88 |
| MAE de total | 11,32 | 11,20 |
| Brier | `null` | `null` |
| sd del error de margen | 13,42 | 12,84 |

**Backtest al cierre:**

| Familia | Umbral | n | Acierto | ROI |
|---|---|---:|---:|---:|
| SPREAD | 2 pts | 140 | 52,2 % | −0,34 % |
| SPREAD | 3 pts | 95 | 50,5 % | −3,40 % |
| SPREAD | 4 pts | 64 | 54,7 % | **+4,45 %** |
| SPREAD | 6 pts | 24 | 50,0 % | −4,50 % |
| TOTAL | 2 pts | 89 | 52,3 % | −0,16 % |
| TOTAL | 3 pts | 43 | 57,1 % | **+8,93 %** |
| TOTAL | 4 pts | 26 | 65,4 % | **+24,88 %** |
| TOTAL | 6 pts | 6 | 66,7 % | **+27,33 %** |

## H.4 📄 Track en sombra

| Fecha | Liga | Familia | n | Acierto | ROI | CLV | t | Fuente |
|---|---|---|---:|---:|---:|---:|---:|---|
| 7-sep | NCAAF | SPREAD | 89 | 44,9 % | −9,4 % | **+6,27 %** | **9,43** | `semana-37.html:274` |
| 7-sep | NCAAF | TOTAL | 57 | 52,6 % | +3,6 % | **+4,79 %** | **24,8** | `semana-37.html:275` |
| 7-sep | CFL | SPREAD | 20 | 40,0 % | −16,8 % | **+10,7 %** | — | `semana-37.html:276` |
| 7-sep | CFL | TOTAL | 29 | 44,8 % | −12,6 % | **+4,98 %** | — | `semana-37.html:277` |
| 7-sep | NFL | todas | 0 | — | — | — | — | kickoff 9-sep |
| **14-sep** | **NCAAF** | **TOTAL** | **141** | **61,7 %** | **+21,2 %** | **+4,76 %** | **38,45** | `semana-38.html:171` |
| **14-sep** | **NCAAF** | **SPREAD** | **202** | **48,0 %** | **−4,6 %** | **+5,72 %** | **17,45** | `semana-38.html:172` |
| **14-sep** | **CFL** | **TOTAL** | **46** | **43,5 %** | **−15,2 %** | **+4,64 %** | **11,79** | `semana-38.html:173` |
| **14-sep** | **CFL** | **SPREAD** | **34** | **32,4 %** | **−34,0 %** | **+8,87 %** | **8,08** | `semana-38.html:174` |

**NFL al 14-sep** (`semana-38.html:258`): 18 partidos de la semana 1 con **31 casas** cotizando; **MAE de
margen 10,31 puntos**; **31 liquidadas con 5 abiertas**. Todas las familias en sombra y el moneyline cerrado
por doctrina. «El blueprint NFL-1125 dice que el modelo queda a **0,45 puntos** del cierre.»

Picks abiertas el 7-sep: 86 de NCAAF y 12 de CFL (`semana-37.html:280`).

## H.5 🔬 Investigación previa (`INVESTIGACION_AMFOOT.md`, 18-ago) — solo cifras de resultados

| Liga | Sport key | Eventos ese día | Casas cotizando | Polymarket |
|---|---|---:|---:|---:|
| NFL | `americanfootball_nfl` | 47 (semana 1) | ~24 | 446 mercados |
| **NCAAF** | `americanfootball_ncaaf` | **111** (semana 1, desde el 29-ago) | **22** | 102 mercados |
| **CFL** | `americanfootball_cfl` | **4** (temporada en curso) | **20** | 4 mercados |
| UFL | `americanfootball_ufl` | inactiva | — | — |

Créditos restantes de The Odds API en esa medición: **4,8 M**. NCAAF tiene 136 equipos FBS y favoritos de
−40. CFL: 9 equipos, ~81 partidos/temporada. Advertencia declarada: «El backtest de NFL (**−7/−10 % ROI en
ML**) enseñó que "hay modelo" ≠ "hay edge"».

Resolución de nombres de College medida el 20-ago (HANDOFF.md:1852-1860): **43 de 111 eventos** caían por
nombre; tras la corrección quedan **39 sin resolver y todos son de FCS**.

---

# PARTE I — COMBATE (UFC, MMA, boxeo)

## I.1 🔬 Calibración del simulador de rutas (20-ago, HANDOFF.md:1530-1562)

**3.886 peleas de 2016 a 2026**, perfiles reconstruidos año a año solo con el pasado
(`scripts/combat-calibra.js`). Probabilidad de «termina antes del límite»:

| Decil | Predicho | Real | Sesgo |
|---|---:|---:|---:|
| 1 | 2,4 % | 42,3 % | **−39,9 pp** |
| 5 | 40,6 % | 48,3 % | −7,7 pp |
| 10 | 94,1 % | 61,4 % | **+32,7 pp** |

«La escala del simulador va de 2 % a 94 %; la de la realidad, de 42 % a 61 %.» **Brier crudo 0,286, peor que
decir siempre la tasa base (0,250).** Por asaltos: 3 asaltos 43,7 % predicho vs 47,9 % real; **5 asaltos
70,4 % vs 56,9 %**.

**El arreglo (temperatura sobre el logit, a = 0,0985, b = −0,0072):**
- **Walk-forward: Brier 0,28812 → 0,24693 (−14,3 %), mejorando en 9 de 9 años.**
- Extremo a extremo en 2025: 0,28626 → 0,24671, **por primera vez por debajo de la referencia de no opinar
  (0,24977)**.
- Piso de peligro `PISO = 0,004`; error medio entre lo simulado y el objetivo **0,011** (ruido de Montecarlo).

## I.2 🔬 Medición del 16-ago sobre 3.140 peleas (TODO_NEXT.md:1006-1013)

| | Resultado |
|---|---|
| **Quién gana** | Brier **0,276** contra **0,250** de decir siempre 50 % → **peor que una moneda**. Cuando decía 93 % ganaba el 67 %; cuando decía 8 % ganaba el 46 %. **7 de 8 tramos descalibrados**, resolución 0,004 |
| **Cómo termina** | KO 29,4 % vs 32,3 % real · sumisión 19,4 vs 17,6 · decisión 51,2 vs 50,1 · límite 51,3 vs 50,1 → **las cuatro dentro de 3 pp** |

Confirmación independiente del monitor en vivo (66 picks liquidadas): FIGHT con **CLV −8,34 %** y ROUNDS con
**CLV +4,88 % y 52,2 % de acierto**.

## I.3 📄 Track del monitor por familia

| Fecha | Corte | n | G / P | Acierto | Unidades | CLV | t | Fuente |
|---|---|---:|---|---:|---:|---:|---:|---|
| 20-ago | FIGHT (ganador) | 31 | — | — | — | **−6,35 %** | **−2,29** | HANDOFF.md:1613 |
| 20-ago | ROUNDS | 27 | — | — | — | **+1,75 %** | — | HANDOFF.md:1614 |
| 20-ago | METHOD | 14 | — | — | — | +0,28 % | — | HANDOFF.md:1615 |
| 20-ago | Global | 79 | 28-51 | 35,4 % | — | −2,32 % | — | HANDOFF.md:1617 |
| 2-sep | FIGHT | 48 | — | 39,6 % | — | **−5,2** | **−2,6** | AUTOPSIA §2 |
| 2-sep | ROUNDS | 39 | — | 46,2 % | — | +2,1 | 2,6 | AUTOPSIA §2 |
| 7-sep | Total | 121 | 51 / 70 | 42,1 % | −6,39 | −1,22 % | — | `semana-37.html:285` |
| **14-sep** | **Total** | **140** | — | **42,9 %** | **−10,12** | **−1,35 %** | — | `semana-38.html:262` |

**Cortes del 7-sep (`semana-37.html:284-292`):**

| Corte | Peleas | G / P | Acierto | Unidades | CLV | t |
|---|---:|---|---:|---:|---:|---:|
| Cartelera principal | 20 | 11 / 9 | 55,0 % | **+2,16** | +0,32 % | — |
| Preliminares | 101 | 40 / 61 | 39,6 % | **−8,55** | −1,54 % | — |
| **Favorito** | 18 | 13 / 5 | **72,2 %** | **+1,90** | **+5,77 %** | **2,17** |
| **Perro** | 39 | 12 / 27 | 30,8 % | **−8,78** | **−7,96 %** | **−3,60** |
| Preregistro favorito ≥45 %: cumple | 23 | 15 / 8 | 65,2 % | +0,95 | **+3,07 %** | 1,14 |
| Preregistro favorito ≥45 %: no cumple | 34 | 10 / 24 | 29,4 % | −7,83 | **−8,15 %** | **−3,43** |

**Cortes del 14-sep (`semana-38.html:264-271`):**

| Corte | n | Acierto | Unidades | CLV | t |
|---|---:|---:|---:|---:|---:|
| Estelares | 23 | 60,9 % | **+3,62** | −0,67 % | — |
| Preliminares | 117 | 39,3 % | **−13,74** | −1,49 % | — |
| **Favorito ≥45 preregistrado** | 30 | **63,3 %** | −0,19 | **+1,99 %** | 0,91 |
| **Sin preregistro** | 37 | 29,7 % | **−8,09** | **−7,91 %** | **−3,51** |

ROUNDS en Cloudbet al 7-sep: 45 picks, CLV **+1,42 %, t 1,76** (`semana-37.html:293`).

## I.4 🔬 Cuotas históricas de UFC (`docs/impl/combate-REPORT.md`, 2-sep; `docs/COMBATE_CUOTAS_HISTORICAS.md`)

**Muestra:** CSV de 6.541 filas, 6.303 con cuota, **6.090 cruzadas**, 2 ambiguas, 211 sin cruce. Walk-forward:
8.987 peleas, warm 3.145 (hasta 2015-07-15), **4.180 evaluadas fuera de muestra**. Ganador CSV vs el nuestro:
coinciden 6.088, discrepan 2.

| Modelo | n | Brier | Log-loss | Acierto |
|---|---:|---:|---:|---:|
| **Cierre** | 4.180 | **0,2120** | **0,6118** | **65,98 %** |
| Elo puro | 4.180 | 0,2434 | 0,6797 | 56,99 % |
| Modelo actual | 4.180 | 0,2343 | 0,6610 | 60,96 % |
| Blend 0,5 | 4.180 | 0,2180 | 0,6263 | 65,53 % |

| Comparación pareada | ΔBrier | SE | t |
|---|---:|---:|---:|
| Modelo − cierre | +0,02228 | 0,002 | **11,16** |
| Blend 0,5 − cierre | +0,00600 | 0,00098 | **6,13** |
| Modelo − Elo puro | −0,00910 | 0,0014 | **−6,49** |

`w*` lineal por log-loss: **w = 1,00 global**; por año 0,90 (2015), 0,85 (2016), 0,95 (2017) y 1,00 de 2018 a
2024.

**Regla preregistrada simulada al cierre (≥2 pp, cuota <3):**

| Corte | n | Acierto | ROI |
|---|---:|---:|---|
| Todas | 2.031 | 47,0 % | −0,6 % ± 2,4 |
| **`prereg_fav45`** | 852 | **59,6 %** | **+5,2 % ± 3,0** |
| Perro k<0,45 | 1.179 | 37,9 % | **−4,8 % ± 3,6** |
| Favorito k≥0,5 | 611 | 60,6 % | +1,0 % ± 3,3 |

## I.5 📐 Combate consciente del mercado (`data/combat/market-aware-priors.json`, 3-sep)

**Muestra:** 6.090 cruzadas, **4.180 fuera de muestra**, años 2015-2024. De-vig proporcional.
**Veredicto guardado en el archivo:** «NINGÚN rasgo añade información al cierre recalibrado fuera de muestra:
coeficientes 0, la función devuelve el cierre tal cual.» `rasgos_que_pasan: []`, `rasgos_que_rozan: []`.

**Recalibración del cierre:** `close` = **1,1119** (t del coeficiente **28,72**), ΔLog-loss OOS **−0,00084**
(**t −2,37**). Nota del archivo: «NO se publica sola: es sesgo favorito-longshot del de-vig proporcional, no
un rasgo del modelo».

**Rasgos evaluados (ΔLog-loss vs cierre / t; ΔLog-loss vs recalibrado / t):**

| Variante | ΔLL vs cierre | t | ΔLL vs recal. | t recal. |
|---|---:|---:|---:|---:|
| cierre recalibrado | −0,00084 | −2,37 | — | — |
| +reach | −0,00106 | −1,88 | −0,00021 | −0,48 |
| +exp | −0,00074 | −2,04 | +0,00010 | 1,48 |
| +years | −0,00083 | −1,77 | +0,00001 | 0,05 |
| **+age** | **−0,00180** | **−2,28** | −0,00095 | **−1,45** |
| +chin | −0,00073 | −1,95 | +0,00011 | 0,95 |
| +streak | −0,00075 | −1,76 | +0,00010 | 0,35 |
| +mileage | −0,00079 | −1,97 | +0,00005 | 0,23 |
| +misswt / +slpm / +td15 / +tddef / +ctrl / +kdr | −0,00084 | −2,37 | 0 | — |
| +delo | −0,00090 | −1,82 | −0,00006 | −0,16 |
| +dmodel | −0,00068 | −1,43 | +0,00017 | 0,63 |
| físicos7 | −0,00193 | −1,85 | −0,00109 | −1,12 |
| rasgos13 | −0,00193 | −1,85 | −0,00109 | −1,12 |
| full (delo+13) | −0,00182 | −1,73 | −0,00098 | −1,00 |

## I.6 🔬 Backtests del 2-sep (BACKTESTS §2, §7)

| Hipótesis | Veredicto | Efecto medido |
|---|---|---|
| Modelo ACTUAL (Elo + rasgos) vs Elo puro | **SOBREVIVE** | **t −8,2 UFC / −6,4 MMA**; calibrado en el histórico (favorito 60,4 % predicho, **61,1 % real**) → «No tocar `ratings.js`» |
| Tramos de edad, inactividad no lineal, SPREAD por división, estatura | **RECHAZADAS** | la edad por tramos **empeora (t +2,4)**; las demás t entre −0,02 y +1,0 |
| Racha ponderada por calidad, guardia zurda, pesaje real | INCONCLUSAS | signo correcto, P(mejor) 0,93 / 0,64 / 0,94 |
| Peso del mercado 0,8; veto por deriva | **RECHAZADAS** | w=0,8: n=24, **CLV −8,9**; veto: t 1,5, n=11 |
| Publicar solo si el lado es también favorito del mercado | **PREREGISTRAR** | perro **CLV −8,64 ± 2,47 (t −3,5, n=34)**; favorito **+3,31 ± 1,73 (t +1,9, n=14)**; diferencia **+11,95 ± 3,02 (t 4,0)**, se mantiene post-techo (t 2,35) |
| ROUNDS | **DEJAR CORRER** | **CLV +2,13 ± 0,82 (t 2,6, n=37)** |

**Preregistro congelado** (`docs/PREREGISTRO_COMBATE_FAVORITO.md`, 2-sep): las primeras **40 picks
liquidadas** con `prereg_fav45 = true`; vara = CLV medio contra el cierre; **éxito = CLV > 0; fracaso = CLV
< −2 con t < −1,5**. Sección «Resultado» del documento: **_(pendiente)_**. Regla 2 (degradación a T−24 h):
40 degradadas liquidadas; hipótesis apoyada en corr(deriva tomada→cierre, resultado) = **−0,31**.

**Interacciones de matchup (12-ago, TODO_NEXT.md:1293-1300):** UFC n=5.842 OOS + MMA n=2.752 → **Brier
idéntico (0,2332)**, bootstrap P mejor caso 0,773 (+absorb) vs gate de la casa 0,983 → **no se shippean**.
Bonus medido: subir de división no penaliza en agregado (racheados subiendo **60,5 % vs 58,1 %**, n = 81 /
3.256).

**Elo de combate (20-ago, HANDOFF.md:1619-1623):** validado walk-forward, **skill 0,0166 y 61 % de acierto en
UFC**; el mercado del ganador de UFC en Kalshi tiene interés abierto mediano de **21.358 contratos** y
horquilla de **1 céntimo**.

---

# PARTE J — DARDOS (9º deporte, nacido el 6-sep)

## J.1 📐 Validación (`data/darts/model-priors.json`, 6-sep 23:30Z; `scripts/darts-fit.js`) 🔬

Constantes congeladas: `kScale` 1,0 · `ensembleU` 0,5 · `halfLifeMatches` 12 · `shrinkK` 8 · `formatK` 1.
Rejilla: kScale ∈ {0,7; 1; 1,4} × u ∈ {0; 0,25; 0,5; 0,75; 1}, elegida por log-loss en desarrollo.

**Desarrollo (2024-03-01 → 2026-01-01, n = 13.922):** log-loss **0,6111**, skill **11,84 %**, Brier 0,2119,
AUC 0,724.

**Holdout 2026 (leído UNA vez, circuito principal, legs ≥ BO7):**

| Variante | n | Log-loss | Skill % | Brier | AUC |
|---|---:|---:|---:|---:|---:|
| Elo | 7.688 | 0,6167 | 11,03 | 0,2146 | 0,714 |
| Compilador | 6.688 | 0,6071 | 12,41 | 0,2106 | 0,726 |
| **Mezcla (ensemble)** | **6.688** | **0,6045** | **12,79** | **0,2096** | **0,729** |
| Elo en el subconjunto del compilador | 6.688 | 0,6174 | 10,92 | 0,2149 | 0,713 |

**Total de legs, MAE por formato (holdout):**

| Formato (BO) | n | MAE modelo | MAE ingenuo | Media de legs |
|---|---:|---:|---:|---:|
| 9 | 6 | 1,462 | 1,333 | 7,00 |
| **11** | **6.458** | **1,245** | **1,250** | **9,03** |
| 13 | 87 | 1,250 | 1,254 | 10,84 |
| 15 | 43 | 1,368 | 1,423 | 12,56 |
| 19 | 76 | 1,902 | 1,960 | 16,16 |
| 21 | 11 | 2,452 | 2,430 | 19,91 |
| 31 | 4 | 1,776 | 2,125 | 27,25 |
| 33 | 2 | 4,726 | 2,500 | 24,50 |
| 35 | 1 | 4,582 | 0 | 27,00 |

Nota del archivo: «el compilador aporta **+1,5 pp** de skill sobre el Elo en el mismo subconjunto (12,4 vs
10,9)». HANDOFF.md:748-750 dice **+1,9 pp** sobre el mismo par de cifras. *(Discrepancia entre las dos
fuentes: el archivo dice 1,5; el HANDOFF dice 1,9.)*

**Propiedades del motor medidas** (HANDOFF.md:726): un BO11 entre iguales da **6-5 el 25,7 %**; salir primero
vale **63,6 %** del leg a 95 de media.

## J.2 📄 Base y estado de la sombra

| Fecha | Estado | Fuente |
|---|---|---|
| 6-sep | 896 torneos y **103.908 resultados 2023→hoy** con formato por ronda certificado; **4.942 jugadores**; ~2.000 fichas. Darts Orakel: ventanas 365/90 d desde dic-2023; **34k campos casados** del Players Championship. Compactos gz 4,7 MB | HANDOFF.md:727-732 |
| 7-sep | «Base de **103.908** partidos y 4.942 jugadores, cuatro casas… **0 liquidadas**: primera semana de sombra» | `semana-37.html:298` |
| **14-sep** | Base **103.913 filas, 4.942 jugadores**, datos al 6-sep; **78 fixtures en cuatro torneos**. «Sin liquidadas suficientes para tablero» | `semana-38.html:276` |
| 11-sep | Rescate del CLV: dardos pasa de **4 a 15 de 24** tesis con CLV reconstruido | HANDOFF.md:353 |

**Preregistro congelado** (`docs/PREREGISTRO_DARDOS.md`, 6-sep, antes de la primera tesis): puertas idénticas
para todas las familias — `edge ≥ 3 pp`, `edge > incertidumbre` (tope 12 pp), `push < 8 %`, formato
certificado, ninguno de los dos «frío» (< 1.500 dardos en 365 d). **Vara: CLV medio por EVENTO contra el
cierre de la misma línea; el ROI se anota, no decide. Mínimo para leer: 60 eventos liquidados por familia y
dos torneos distintos.** ML es benchmark, jamás pick. Stake ¼ Kelly, tope 2 %.

---

# PARTE K — TENIS DE MESA (11º deporte, nacido el 8-sep)

## K.1 📐 Validación (`data/tt/model-priors.json`, 8-sep 20:25Z; `scripts/tt-fit.js`) 🔬

Constantes congeladas: `kScale` 1,4 · `pointEta` 0,08 · `pointNorm` 0,5 · `pointScale` 1 ·
`pointScaleDist` 1 · `serveDelta` 0,03 · `ensembleU` 0,25 · `youthWeight` 0,5 · `warmN` 8.

**Base:** 192.460 partidos, 15.732 jugadores, construida el 8-sep, último partido 2026-09-08.

**Desarrollo (2023-01-01 → 2026-01-01, n = 17.227):**

| Variante | Log-loss | Skill % | Brier | AUC |
|---|---:|---:|---:|---:|
| **best (ensemble)** | **0,5230** | **24,55** | **0,1764** | **0,813** |
| Elo | 0,5322 | 23,224 | 0,1793 | 0,807 |
| Compilado | 0,5745 | 17,122 | 0,1901 | 0,798 |

Games: media real 4,055 vs modelo 4,073; **MAE 0,682 vs 0,766 del ingenuo**. Puntos: media real 74,515 vs
modelo 74,792; **MAE 14,588 vs 16,645**. Deuce: real 15,11 % vs modelo 14,91 %.

**Holdout 2026 (n = 4.557, mayores, sin retiradas, ambos con ≥ warmN partidos previos):**

| Variante | Log-loss | Skill % | Brier | AUC |
|---|---:|---:|---:|---:|
| Elo | 0,5372 | 22,505 | 0,1811 | 0,803 |
| Compilado | 0,5789 | 16,480 | 0,1908 | 0,796 |
| **Ensemble** | **0,5273** | **23,924** | **0,1777** | **0,810** |

| Magnitud (holdout) | Real | Modelo |
|---|---:|---:|
| Games (media) | 3,893 | 3,881 |
| Games MAE | **0,653** (ingenuo 0,704) | |
| Puntos (media) | 71,885 | 71,232 |
| Puntos MAE | **14,302** (ingenuo 15,475) | |
| Deuce | 15,78 % | 14,89 % |
| Over de la línea | 59,12 % | 57,99 % — **Brier 0,2326 vs 0,2417 del ingenuo** |
| Barridas (sweep) | 40,05 % | 41,17 % |
| Marcador exacto | log-loss **1,6327** vs uniforme 1,7918 | |

`selfTest()` del compilador reproduce la tabla sintética del blueprint a **6 decimales**.

## K.2 📄 Estado de la sombra

| Fecha | Estado | Fuente |
|---|---|---|
| 8-sep 20:30Z | Base 192.460 partidos cargada; agenda de 148 partidos en 3 eventos WTT; Cloudbet leyendo **71 eventos**, Bovada 62, **Pinnacle 0**; 46 candidatas y **las primeras 8 tesis en sombra** | HANDOFF.md:666-669 |
| 8-sep 22:48Z | **17 tesis abiertas, 0 liquidadas** (5 totales de puntos, 4 hándicaps de puntos del 1er game, 3 ganador del 1er game, 1 total del 1er game, 4 ganador como referencia) | HANDOFF.md:684-685 |
| 9-sep | Al arrancar el dinero real: **19 liquidadas en sombra** | HANDOFF.md:546 |
| 11-sep | Rescate del CLV: TT pasa de **38 a 300 de 321** tesis con CLV reconstruido. «Las 321 tesis vivas tenían dos o más cubos con idéntico sello de tiempo» | HANDOFF.md:351-353 |
| 11-sep | La vara mide `TT GAME_POINTS_HCP cloudbet` con **t −2,95** modelo-vs-precio → veredicto **cerrar** (sin aplicar) | HANDOFF.md:334-335 |
| 14-sep | TT no aparece en el tablero de ventaja del reporte semanal | `semana-38.html` |

**Márgenes medidos en TT:** `cloudbet GAME_POINTS_HCP` **1,97 %** por lado (CLAUDE.md §📏; HANDOFF.md:309).
**La línea de TT POINTS_TOTAL no se mueve el 78,8 % de las veces** (HANDOFF.md:321).

**Incidente de datos del 8-sep** (HANDOFF.md:669-672): la primera cola diaria recibió el ranking ITTF vacío
(404 desde Render), no bajó historiales y **escribió un compacto de CERO filas** que pisó al del repo durante
~6 minutos.

---

# PARTE L — F1 (8º deporte)

## L.1 📐 Validación (`data/f1/model-priors.json`, 19-ago 01:50Z) 🔬

Constantes: `hlCar` 6 · `hlDrv` 15 · `wq` 0,35 · `seasonKeep` 0,8 · `regimeKeep` 0,6 · `driverKeepBonus` 0,15 ·
`hlDnf` 30 · `dnfBase` 0,03 · sim `sigma` 0,4, `gridW` 0,7, **4.000 simulaciones** · `blendU` 0,4.

| Métrica | Holdout post-quali (n=35) | Holdout pre-quali (n=35) | Línea de base (n=721) |
|---|---:|---:|---:|
| Log-loss | 1,38873 | 1,99808 | grid baseline 1,058 (post-quali) |
| Skill vs uniforme | **53,64 %** | 33,30 % | — |
| Brier de podio | 0,06736 | 0,08599 | **0,06191** |
| Brier de puntos | 0,17453 | 0,19074 | **0,16565** |
| Brier de DNF | 0,10611 | 0,10611 | 0,10675 |
| Acierto en duelos | **72,49 %** (n=269) | 66,17 % (n=269) | duelo por grid 74,35 % · por forma 60,25 % (n=244) |
| Log-loss del blend | **1,15** (skill 61,6 %) | — | — |
| Spearman | 0,687 | 0,687 | desarrollo 0,752 |

> **Nota que el propio archivo obliga a leer:** el Brier de podio y de puntos del modelo **es peor que la
> línea de base** en post-quali (0,06736 vs 0,06191 y 0,17453 vs 0,16565), y el acierto en duelos del modelo
> (72,49 %) queda por debajo del duelo decidido solo por la parrilla (74,35 %).

## L.2 📄 Track en producción

| Fecha | Estado | Fuente |
|---|---|---|
| 7-sep | **33 picks, 19 liquidadas** (podio 44 %, puntos 42 %, duelos 80 %), **Brier 0,15-0,20**. «Sin cobertura de mercado en las casas conectadas: no hay cierre, así que no hay CLV» | `semana-37.html:297` |
| 7-sep (tablero) | F1 podio / top 10: 19 liquidadas, SIN_MUESTRA, «sin cobertura de mercado: no hay cierre contra el que medir» | `semana-37.html:164` |
| **14-sep** | **31 liquidadas en PUNTOS, sin CLV capturado — «no se puede juzgar todavía»** | `semana-38.html:275` |

---

# PARTE M — POLYMARKET, PROP FIRM Y CANALES AUXILIARES

## M.1 📄 Sombra de Polymarket (banco simulado de 2.000)

| Fecha | Liquidadas | G / P | Apostado | P&L | ROI | Deslizamiento | Fuente |
|---|---:|---|---:|---:|---:|---:|---|
| 3-sep (desatasco) | 59 de golpe | 25 / 34 | — | **−31 USD** | — | — | HANDOFF.md:830-831 |
| 7-sep | 150 | 63 / 87 | — | **+172,44** | **+4,36 %** | **+1,86 pp**; 7 sin fill; 39 tesis nunca entraron | `semana-37.html:304` |
| **14-sep (semana)** | **190** | — | 5.311,42 | **+363,58** | **+6,85 %** | — | `semana-38.html:286` |
| **14-sep (desde el inicio)** | **341** | — | 9.304,10 | **+358,90** | **+3,86 %** | **1,82 pp** sobre 432 posiciones; **77 señales (17,8 %) no entraron** | `semana-38.html:287,315` |

**Por deporte, semana 38 (`semana-38.html:281-287`):**

| Deporte | Liq. semana | Acierto | Apostado | P&L | ROI |
|---|---:|---:|---:|---:|---:|
| CS2 | 112 | 50,9 % | 2.837,57 | **+653,43** | **+23,03 %** |
| Fútbol | 69 | 40,6 % | 2.174,47 | **−211,47** | **−9,73 %** |
| LoL | 9 | 33,3 % | 299,38 | −78,38 | **−26,18 %** |
| **Semana** | **190** | **46,3 %** | **5.311,42** | **+363,58** | **+6,85 %** |

«Toda la ganancia acumulada de la sombra se hizo esta semana, y toda esta semana fue CS2.»

**La familia `futbol:No`, que iba a recibir dinero real (`semana-38.html:295-303`):**

| Corte | n | Acierto | Apostado | P&L | ROI |
|---|---:|---:|---:|---:|---:|
| Desde el inicio | 101 | 53,5 % | 3.029,46 | **+262,54** | **+8,67 %** |
| Semana 37 (31 ago – 6 sep) | 50 | 62,0 % | 1.419,51 | **+288,49** | **+20,32 %** |
| Semana 38 (7 – 13 sep) | 49 | 44,9 % | 1.542,37 | −44,37 | **−2,88 %** |

**El t del ROI acumulado es 0,97: no significativo.** (En HANDOFF.md:453, el 13-sep: +163,95 con **t 0,79**, y
«devolvió el 71 % en una semana: +568 → −404».)

**El gradiente de ventaja, invertido (`semana-38.html:306-313`):**

| Ventaja declarada | n | Acierto | Apostado | P&L | ROI |
|---|---:|---:|---:|---:|---:|
| 3 – 5 pp | 68 | 54,4 % | 2.055,42 | **+283,58** | **+13,80 %** |
| 5 – 8 pp | 27 | 51,9 % | 814,56 | +23,44 | +2,88 % |
| **8 pp o más** | 6 | 50,0 % | 159,48 | −44,48 | **−27,89 %** |

Semana anterior (misma medición, menos muestra): 3-5 pp **+9,9 %**, 8 pp+ **−7,9 %** (`semana-38.html:314`;
HANDOFF.md:453).

**Verificación técnica del ejecutor contra la casa (13-sep, HANDOFF.md:14-20, 49-54, 83-95):**

| Comprobación | Resultado |
|---|---|
| La clave privada deriva una dirección | `0x0bcaaf…d95aa` — exactamente la que muestra Polymarket |
| `/auth/derive-api-key` con firma EIP-712 | **ACEPTADA** |
| Tres GET autenticados con HMAC L2 | **200** |
| `POST /order` desde Render (Oregón) | **403** «Trading restricted in your region» |
| `POST /order` desde gp-pm-hel1 (Helsinki) | **401** «missing address header» |
| Orden real de prueba | `400 "not enough balance: balance: 8100, order amount: 5140070"` → «falta el dinero, no el código» |
| Ejecutor en seco sobre **437 señales reales** | 3 revisadas, 2 fuera de familia, **1 elegida** — 26 acciones a 0,19 = 4,94 $ |

## M.2 📄 Prop firm (FP-796307, Elite 10K, cierra 30-sep)

| Fecha | Señales | Abiertas | G / P | P&L | Fuente |
|---|---:|---:|---|---:|---|
| 7-sep | 213 | 152 | 19 / 42 | **−1.168,5 USD** (al stake de la firm) | `semana-37.html:303` |
| **14-sep** | **441** | **287** | **72 / 82** | **+1.516,10 USD** | `semana-38.html:318` |

Nota del 7-sep: «solo se liquidan las de CS2 y LoL (vía bo3.gg); las de fútbol y NFL quedan abiertas, así que
el número está sesgado hacia esports». La sombra «modelo contra retail» sigue en **cero señales** en las dos
semanas.

## M.3 📄 Cobertura de las casas conectadas, medida (20-ago, HANDOFF.md:1682-1689)

- **Kalshi** — 3.472 series deportivas; UFC con interés abierto mediano **21.358** y horquilla de **1
  céntimo**; EPL ganador OI **632** y 5,5 céntimos; **todo lo demás vacío** (NFL partido OI 40 y 21 céntimos;
  MLS ganador OI 0; córners EPL OI 0). **No lista tarjetas en ningún deporte**; sí lista córners.
- **Polymarket** — sin córners ni tarjetas.
- **Myriad** — solo 1X2 de partido.
- **Cloudbet** — la única con familias de partido, «y donde nuestro CLV sale negativo».

Colector de Cloudbet, medido el 20-ago: leía **19 de 854** partidos disponibles; tras la corrección,
**19 → 34 partidos útiles**, 30 con 1X2 y 28 con goles donde antes había 3 y 3 (HANDOFF.md:1754-1762).
De las 70 señales de tarjetas de la ventana, «Cloudbet solo podría tomar las 10 de Championship».

## M.4 📄 Operación de la plataforma

| Métrica | 7-sep | 14-sep |
|---|---|---|
| Usuarios registrados | **982** | 966 citados en HANDOFF (13-sep) |
| Afiliados | 1 activo, **38 registros**, 1 referido convertido, 1,9 disponible | **38 registros**, 1 referido, 1,90 disponible |
| Presupuesto LLM | **4,09 USD gastados de 20** desde el 15-ago (79,6 % restante); 66 llamadas ese día, todas Gemini y Groq | **15,91 USD restantes de 20** (79,6 %); **85 llamadas, coste 0,00** |
| **Verificador de lecturas** | **940 correctas, 21 reescritas, 0 descartadas** | **1.572 verificadas, 42 reescritas, 0 descartadas** (**2,7 %** de reescritura) |
| Base de datos | 20 GB; la tabla de cuotas de goles pesa **18 GB** (30 M filas vivas) | — |
| Descuadres contables | — | **1 descuadre de liquidación**; la ecuación de conciliación no cierra |
| Despliegues | — | **33 despliegues** en la semana, ninguno tocó `gp-relay-eu` |

Estado del LLM el 21-ago (HANDOFF.md:1516-1519): lecturas esports 32 · hoops 21 · amfoot 9 · tenis 4 · F1 2 ·
NFL 0; 56 llamadas (Gemini 53, Groq 3); gasto **$0,4926**.

## M.5 📄 Proceso implícito (sombra `implicito_v1`, desde el 9-sep)

| Medición | Valor | Fuente |
|---|---|---|
| Primera pasada en prod (9-sep 00:37Z) | línea de base de fútbol **−0,62 goles** con 2.144 observaciones (109 partidos, 72 con 1X2 y total en la misma casa, **6.070 tesis evaluadas, 40 nacidas**: 26 over / 12 under / 2 del 1X2, en 22 casas) | TODO_NEXT.md:97-101 |
| v2 (01:00Z) | las **87 tesis v1** se anularon con motivo (`anuladas_regla`); la incoherencia salía **+14 pp en TODAS las casas** en partidos muy desiguales → error de forma, no señal | HANDOFF.md:578-583 |
| **v3 (02:20Z)** | **4.647 evaluadas → 25 nacidas** (19 IMPLIED_TOTAL, 5 BOOK_DEV, 1 IMPLIED_1X2), **3.806 bajo listón, 13 bajo incertidumbre, 22 vetadas por > 15 pp**; ventajas 4-10 pp con unc ≈ 2-2,4 pp. Las **767 tesis v1/v2** quedaron VOID | HANDOFF.md:586-590 |
| Puertas | edge 3-15 pp · cuota 1,25-6 · edge ≥ 0,75×unc · ≤ 60 nuevas/pasada. Listón declarado: **~150 liquidadas por familia** | HANDOFF.md:591-592 |

Fórmula de incertidumbre por muestra (`implied-engine/uncertainty.js`, HANDOFF.md:552):
`unc_pp = 100 · 0,28 · √(1/(nA+2) + 1/(nB+2))`, con `unc.passes = edge ≥ 0,75 × unc`.

---

# PARTE N — LA VARA Y LA AUTOPSIA: LAS MEDICIONES TRANSVERSALES

## N.1 Márgenes de casa medidos (`lib/margen.js`, 11-sep; CLAUDE.md §📏; HANDOFF.md:308-310)

Medidos emparejando las dos caras del mismo mercado en el archivo de cierres. Por lado:

| Casa | Familia | Margen por lado |
|---|---|---:|
| pinnacle | RONDAS_HANDICAP | **2,21 %** |
| pinnacle | RONDAS | 2,83 % |
| bovada | KILLS | 2,35 % |
| cloudbet | RONDAS_HANDICAP | **3,13 %** |
| cloudbet | GAME_POINTS_HCP (TT) | 1,97 % |
| — | total de goles de fútbol | **0,69 %** (el más barato = el más eficiente) |

## N.2 🧭 El CLV no aplica en nuestros mercados (11-sep, HANDOFF.md:316-336)

**Con qué frecuencia la línea NO se mueve:**

| Familia · casa | % de veces que la línea no se mueve |
|---|---:|
| dota2 KILLS · bovada | **92,8 %** |
| TT POINTS_TOTAL | **78,8 %** |
| LoL KILLS_HCP · bovada | 56,9 % |
| CS2 RONDAS · bovada | 56,2 % |
| CS2 RONDAS_HCP · pinnacle | 19,0 % |

**Prueba de fondo:** Brier pareado entrada-vs-cierre sobre las mismas liquidadas. **«En NINGUNA de las diez
familias el cierre predice mejor que nuestro precio de entrada (|t| < 2 en todas).»**

**Lo que destapó `modeloContraPrecio()` — cinco familias donde el precio le gana al modelo con
significancia:**

| Familia · casa | t (modelo vs precio) | Veredicto de la vara |
|---|---:|---|
| LoL KILLS_HANDICAP · bovada | **−3,42** | cerrar |
| LoL KILLS_HANDICAP · cloudbet | **−3,52** | cerrar |
| CS2 RONDAS_HANDICAP · cloudbet | **−3,31** | cerrar |
| TT GAME_POINTS_HCP · cloudbet | **−2,95** | cerrar |
| sombra `lol_kills_hcp_v1` | **−3,65** | cerrar |

**Ninguna se ha cerrado a 14-sep**: «es cambio de lógica de picks y Alexis no lo ha ordenado»
(HANDOFF.md:336; TODO_NEXT.md:31-34).

**Ejemplo del daño del CLV crudo** (HANDOFF.md:298-301): el CLV de CS2 en Pinnacle decía **+0,05 %** las dos
últimas semanas de agosto; recortando el 10 % de cada cola decía **+0,55 % con t 2,72**, y todas las semanas
salían significativas.

## N.3 🔧 El CLV perdido, rescatado (11-sep, HANDOFF.md:338-355)

| Familia | CLV recuperable antes | Después |
|---|---:|---:|
| Tenis de mesa (321 tesis) | 38 | **300** |
| Dardos (24 tesis) | 4 | **15** |
| Reparto que lo delató: ML sin línea | 16 de 35 | — |
| POINTS_TOTAL | 4 de 62 | — |
| GAMES_HCP | 0 de 26 | — |

## N.4 🔬 La ley común: el sesgo del ganador (AUTOPSIA §3, 2-sep)

Calibración por familia en el tramo donde el modelo más se separa del mercado:

| Familia | Tramo p_modelo | p_modelo | p_mercado | **Observado** |
|---|---|---:|---:|---:|
| Fútbol SOLID | 55-65 | 60,3 | 44,9 | **32,9** |
| Valorant | ≥70 | 74,5 | 58,2 | **42,3** |
| CS2 | 60-70 | 64,3 | 54,0 | **50,2** |
| LoL kills | ≥80 | 85,2 | 59,2 | **56,4** |
| Tenis | 65-75 | 69,8 | 52,3 | **52,3** |
| WNBA (crudo) | — | 69,0 | 50,4 | 55,7 |

**El peso que merece el modelo**, estimado con `P(gana) = σ(a + b·logit(p_mkt) + c·[logit(p_gp) − logit(p_mkt)])`
(c = 1 publicar el modelo; c = 0 publicar el mercado; c < 0 discrepar es señal contraria):

| Familia | n | **c (peso del modelo)** | t |
|---|---:|---:|---:|
| LoL (todas) | 375 | **−0,65** | **−2,4** |
| Fútbol GOALS | 130 | −1,68 | −1,4 |
| CS2 RONDAS | 245 | −0,91 | −1,0 |
| Valorant (todas) | 304 | −0,35 | −0,7 |
| Fútbol CORNERS | 587 | −0,17 | −0,4 |
| Fútbol SOLID | 432 | 0,19 | 0,8 |
| CS2 RONDAS_HANDICAP | 433 | 0,35 | 0,9 |
| Tenis SPREAD / ML | 205 / 109 | 0,26 / 0,29 | 0,7 / 0,5 |
| Combate FIGHT | 48 | 0,36 | 0,6 |
| WNBA SPREAD (crudo) | 79 | 1,49 | 1,6 |
| **Fútbol CARDS** | 361 | **1,41** | **2,8** |
| **Tenis TOTAL** | 77 | **6,0** | **2,8** |

**Conclusión transcrita:** «**Brier modelo vs mercado pierde en TODAS las familias con dato.** No hay una sola
donde la probabilidad del modelo, tal cual, sea mejor que la del precio. El dinero que se gana (CS2, cards) no
sale del modelo: sale de dónde y cuándo se toma el precio.»

**Fórmula operativa propuesta (no aplicada):**
`p* = σ( logit(p_mkt_sin_margen) + c_familia · [logit(p_gp) − logit(p_mkt_sin_margen)] )`, con `c` estimado
fuera de muestra y **c = 0 obligatorio donde t < 1**. Hoy se blendea solo en baloncesto (**w = 0,13-0,23**) y
combate (**0,5 fijo**).

## N.5 🔴 Los tres liquidadores que mentían (AUTOPSIA §1, 2-sep)

| # | Liquidador | Qué hacía mal | Daño medido | Corrección |
|---|---|---|---|---|
| 1 | **Tenis (0-0)** | ESPN marca `STATUS_FINAL` antes de colgar los sets; el liquidador se tragaba el marcador vacío | **268 de 429** picks liquidadas con 0-0 y 56 con sets sueltos. «El **+44 % de ROI y el 80 % de acierto en hándicap eran ese artefacto**» | `marcadorCoherente` + user-agent de curl; `resettleShadow` re-liquidó **297** picks → 148-148. El track pasa de +44 % a **+7,3 % (392 picks) con CLV −12,5 %** |
| 2 | **Esports (kills sin voltear)** | Al orientar el resultado se volteaban `score_a/b` pero **no `kills_a/b` ni `winner`** | LoL «local +x,5 kills» ganaba el **85 %** y «visitante +x,5» el **41 %** con la misma p_gp (0,72); Dota 2 al revés (**26 % / 68 %**) | Re-liquidadas **245 en LoL (85 cambiaron de veredicto)** y 55 en Dota. LoL KILLS_HANDICAP pasa de **60,1 % / +14,7 u a 58,0 % / +4,7 u**; Dota KILLS_HANDICAP a 49,1 % / −6,7 u |
| 3 | **Baloncesto (cubos de 5)** | P(over 164,5) sumaba los cubos ≥165, y el cubo 165 contiene 163 y 164 | «Toda línea justo por debajo de un múltiplo de 5 heredaba **~5 pp de over regalados**». **22 de los 31 totales** del monitor WNBA eran overs en x3,5/x4/x4,5 con **17-27 % de acierto** | Resolución de 1 punto |

**Fuentes de resultados que no llegaban:** Leaguepedia por `api.php` (tope 500, «menos en Render: 39 series
donde había 715 partidas») → `Special:CargoExport` (5.000 filas/llamada); OpenDota `/proMatches` (100
partidos, dos días) → paginado. «Eso es lo que tenía **137 picks de LoL y 62 de Dota** atascadas.»
Tras el cambio, la cosecha entera de LoL terminó en **113 llamadas, ~4 minutos** (HANDOFF.md:928).

## N.6 🔬 Otros defectos de medición documentados

| Fecha | Defecto | Daño medido | Fuente |
|---|---|---|---|
| 20-ago | Props CS2: la liquidación tomaba «las dos últimas filas» del montón asumiendo orden cronológico | Sumas imposibles (44, 51, 56 kills contra líneas de 27,5). Las **87 liquidaciones viejas se rehicieron**: de «47-40, ROI +3,01 %» a **48-43, ROI +0,51 %, CLV +0,07 %** | HANDOFF.md:1802-1811 |
| 20-ago | Las tres dobles oportunidades iban a la misma casilla (clave sin `side`) | Quedaba UNA fila por partido; el valorador habría comparado local-o-empate contra el precio de empate-o-visitante | HANDOFF.md:1728-1732 |
| 21-ago | Valorant leía `<disco>/esports/valorant` mientras la cosecha escribía en `/data/val-raw` | **94 picks y cero liquidadas** desde que existe el deporte; la fuente en crudo se paraba el 17 mientras la cosecha «presumía de 33.104 series al día» | HANDOFF.md:1489-1502 |
| 7-sep | Catálogo de CS2 resolvía «MOUZ» → MOUZ NXT y «Spirit» → Spirit Academy | «La final de BLAST Open Porto se modeló con ratings de academias»; **toda la muestra de CS2 previa** lleva ese ruido | `semana-37.html:128,258` |
| 13-sep | `noVig.twoWayNoVig` devolvía `null` desde el 20-ago | **Ninguna pick de `futbol-derivadas` se valoró nunca contra el precio sin vig**; el error empujaba al lado seguro (menos picks, no peores) | HANDOFF.md:199-208 |
| 13-sep | El espejo de la línea cero de hándicap estaba mal (el contrario de `P0` es `P0`, no `M0`) | La línea cero se medía contra la cuota cruda | HANDOFF.md:208 |
| 20-ago | `FS.simulate` lanzaba `ReferenceError` en **todas** las llamadas tras un commit | La ficha de pelea y la generación de picks de combate quedaron rotas desde ese despliegue | HANDOFF.md:1568-1574 |

## N.7 📄 Auditoría de liquidación del 21-ago (HANDOFF.md:1473-1487)

| Deporte | Liquidadas | Abiertas | **Atascadas** |
|---|---:|---:|---:|
| fútbol (Mundial + clubes) | 96 + 684 | 0 | **0** |
| combate | 79 | 18 | 0 |
| baloncesto | 50 | 15 | **0** |
| tenis ATP / WTA | 19 / 27 | 5 / 1 | **0** |
| NFL · College | 0 | 0 | 0 (temporada sin empezar) |
| CFL | 4 | 14 | **0** |
| F1 | 0 | 69 | 0 (carreras no corridas) |
| esports CS2 | 207 | 92 | **85** |
| esports LoL | 77 | 39 | **31** |
| esports Valorant | 0 → **14** | 80 | **60** |
| esports Dota 2 | 31 | 4 | **2** |

---

# PARTE O — TABLA RESUMEN: ESTADO DE CADA FAMILIA A 14-SEP-2026

> Fuente primaria de la tabla: `docs/reportes/semana-38.html` (leído el 14-sep 08:37-08:50 UTC), completada con
> `HANDOFF.md` §📊 y §🧭 (13-sep) y con los tracks del 7-sep cuando el reporte del 14 no publica la celda.
> «Veredicto de la vara» = el que aparece escrito en el documento citado; **"—" significa que el documento no
> publica ese dato**, no que valga cero.

## O.1 Fútbol

| Deporte | Familia | n | ROI | CLV | t | Veredicto de la vara | 💵 ¿Dinero real? |
|---|---|---:|---:|---:|---:|---|---|
| Fútbol | **CARDS under** (feed) | 243 / 186 / 170 (3 bandas) | varios | −0,4 a −1,0 % | −2,2 a −4,3 | **descartar** | **SÍ** (Cloudbet, stake 30 plano) |
| Fútbol | CARDS under · **núcleo limpio** | 43 (392 en la serie larga) | **+25,26 %** (núcleo) / +14,42 % (under global) | — | modelo vs mercado **+0,135, t 5,96** | no cruza: **n = 43** | SÍ |
| Fútbol | CARDS over | 138 | **−18,68 %** | — | **t −2,05** vs mercado | en contra | No (el ejecutor solo toma under) |
| Fútbol | CORNERS under | 243 | −6,5 % | −0,39 % | **−4,32** | **descartar** | No |
| Fútbol | CORNERS (total, modelo vs precio) | 1.009 | −1,48 % | — | **−1,99** | sin evidencia | No |
| Fútbol | `corners_over_v1` (sombra $2.000) | — (66 en 7 d) | **−5,2 %** total | **−1,41** | — | «coherente y malo» | No |
| Fútbol | GOALS | 165 | −5,50 % | — | −1,04 | sin evidencia (modelo = mercado a 3 decimales) | No |
| Fútbol | SOLID (1X2) | 488 | — (−20,29 u) | — | — | agujero: 34,2 % de acierto | No (`GP_SOLID_C=0`: `lead` no genera picks) |
| Fútbol | COMBO / PLAYER | 120 / 26 | +4,8 % / −11,8 % | sin CLV | — | sin muestra | No |
| futbol-derivadas | **asian_handicap** | **3.222** | −7,9 % | −3,66 % | **−26,45 / −26,49** | **cerrar** | No |
| futbol-derivadas | team_total | 1.350 | −9,5 % | −1,01 % | −5,29 / −5,32 | **cerrar** | No |
| futbol-derivadas | double_chance | 508 | −5,4 % | −2,76 % | −8,79 | **cerrar** | No |
| futbol-derivadas | draw_no_bet | 474 | −10,8 % | −4,43 % | −8,28 | **cerrar** | No |
| futbol-derivadas | btts | 301 | −2,5 % | −0,97 % | −3,60 / −3,61 | sin evidencia | No |
| futbol-derivadas v2 | las 14 de mitad + marcador exacto, portería a cero, ganar a cero | 14 – 47 por familia | — | — | — | **sin muestra** (todas bajo el listón de 30) | No |
| implicito_v1 | IMPLIED_TOTAL / IMPLIED_1X2 / BOOK_DEV | 25 nacidas en la primera pasada v3 | — | — | — | listón declarado: ~150 liquidadas por familia | No |

## O.2 Esports

| Deporte | Familia | n | ROI | CLV | t | Veredicto | 💵 ¿Dinero real? |
|---|---|---:|---:|---:|---:|---|---|
| CS2 | **RONDAS_HANDICAP** | **1.232** | **+2,1 %** | **+1,92 %** | **5,67** | **confirmada** | **Pausado** (`GP_REAL_CS2_ENABLED=false` desde el 7-sep; −66,9 sobre 600) |
| CS2 | **RONDAS** | 642 | **+1,9 %** | **+1,89 %** | **5,95** | **confirmada** | No |
| CS2 | TOTAL_MAPAS | 44 | −1,4 % | **+9,95 %** | **5,03** | confirmada (n corta) | No |
| CS2 | HANDICAP (mapas) | 145 | −13,6 % | **+20,19 %** | **4,64** | confirmada (ROI negativo) | No |
| CS2 | RONDAS_EQUIPO | 70 | −6,3 % | **+30,72 %** | **3,13** | confirmada (n corta) | No |
| CS2 | RONDAS_HANDICAP · **cloudbet** | — | — | — | **−3,31** (modelo vs precio) | **cerrar** (sin aplicar) | era el canal real, pausado |
| CS2-props | **`props_cs2_v2`** | **330** | **+2,2 %** | **+0,47 %** | **3,21** | **confirmada** | No (Underdog, no conectable) |
| CS2-props | `props_cs2_v1` | 142 (7-sep) | −3,6 % | +0,40 % | 1,54 | promete | No |
| LoL | **KILLS** | 279 | **+11,8 %** | **+1,18 %** | **2,98** | **confirmada** | No (cotiza en Bovada) |
| LoL | **HANDICAP** (mapas) | 92 | −1,6 % | **+10,42 %** | **3,73** | **confirmada** | No |
| LoL | KILLS_HANDICAP · bovada | 124 (bovada) / 372 (7-sep) | −2,6 % | +2,00 (bovada) | **−3,42** (modelo vs precio) | **cerrar** | No |
| LoL | KILLS_HANDICAP · cloudbet | — | — | — | **−3,52** | **cerrar** | No |
| LoL | `lol_kills_hcp_v1` (sombra $2.000) | 42 en 7 d | +12,5 % (7 d) / **−4,5 %** total | **−0,68** total | **−3,65** (modelo vs precio) | **cerrar** | No |
| LoL | KILLS_DNB | 49 (7-sep) | +0,7 % | −3,32 % | −2,29 | en contra | No |
| LoL-gen | generador de kills (sombra) | 7 tesis | — | — | — | sin muestra | No |
| Valorant | **RONDAS** | 143 | −5,4 % | **+0,75 %** | **4,21** | **confirmada** (ROI negativo) | No |
| Valorant | RONDAS_HANDICAP | 178 (7-sep) | −14,3 % | −0,10 % | −0,32 | plana | No |
| Valorant | HANDICAP (mapas) | 54 (7-sep) | +25,1 % | +4,06 % | 0,88 | plana | No |
| Valorant | PRORROGA | 0 | — | — | — | sin picks (la casa no la cotiza) | No |
| Dota 2 | KILLS (total) | 72 (7-sep) | −4,2 % | +0,28 % | 1,82 | promete | No |
| Dota 2 | KILLS_HANDICAP | 55 (7-sep) | −12,2 % | −0,50 % | — | sin CLV | No |

## O.3 Otros deportes

| Deporte | Familia | n | ROI | CLV | t | Veredicto | 💵 ¿Dinero real? |
|---|---|---:|---:|---:|---:|---|---|
| Tenis | ML | 193 | **+11,6 %** | **−15,52 %** | **−4,65** | **descartar** | No |
| Tenis | SPREAD | 394 | (+2,68 u) | −3,50 % | — | en contra | No |
| Tenis | TOTAL | 168 | (+14,63 u) | −1,46 % | — | plana, «la menos mala» | No |
| Tenis | TOTAL preregistro ≥8 pp | 39 eventos (7-sep) | **+29,4 %** | +2,3 % vs Pinnacle (2 medidas) | **1,98** | acumulando hasta 60 eventos | No |
| Baloncesto | TOTAL (WNBA) | 57 (7-sep) | +2,3 % | **+2,55 %** | 1,20 | promete | No (picks apagadas por doctrina) |
| Baloncesto | SPREAD (WNBA) | 111 (7-sep) | +1,8 % | −0,84 % | −1,41 | en contra | No |
| Baloncesto | Value / arbitraje / caídas / middles | — | — | — | — | se publican: salen de precios entre casas | No |
| NCAAF | **TOTAL** | **141** | **+21,2 %** | **+4,76 %** | **38,45** | **confirmada** (la más fuerte del tablero) | **No — apagada por doctrina** |
| NCAAF | **SPREAD** | **202** | −4,6 % | **+5,72 %** | **17,45** | **confirmada** | No |
| CFL | **TOTAL** | 46 | −15,2 % | **+4,64 %** | **11,79** | **confirmada** (n corta) | No |
| CFL | **SPREAD** | 34 | −34,0 % | **+8,87 %** | **8,08** | **confirmada** (n corta) | No |
| NFL | todas | 31 liquidadas, 5 abiertas | — | — | — | **todo en sombra**; moneyline cerrado por doctrina | No |
| Combate | FIGHT global | 140 | (−10,12 u) | −1,35 % | — | en contra | No |
| Combate | FIGHT · favorito ≥45 preregistrado | 30 | (−0,19 u) | **+1,99 %** | 0,91 | preregistro abierto (meta 40) | No |
| Combate | FIGHT · sin preregistro | 37 | (−8,09 u) | **−7,91 %** | **−3,51** | **descartar el corte** | No |
| Combate | ROUNDS | 37-45 | −2,3 % | +0,63 % / +1,42 % | 0,78 / 1,76 | dejar correr | No |
| Combate | METHOD | 14 (20-ago) | — | +0,28 % | — | sin muestra | No |
| Dardos | todas | **0 liquidadas suficientes** | — | 15 de 24 con CLV rescatado | — | **sin muestra** (listón: 60 eventos por familia) | No |
| Tenis de mesa | **POINTS_TOTAL** | 19 al arrancar (300 de 321 con CLV) | — | CLV propio plano en los cinco cubos | — | vara `clv_own` a **150** liquidadas | **SÍ — $5 planos en Cloudbet desde el 9-sep** |
| Tenis de mesa | GAME_POINTS_HCP | — | — | — | **−2,95** (modelo vs precio) | **cerrar** (sin aplicar) | No |
| F1 | PUNTOS / podio | 31 | — | **sin CLV capturado** | — | no se puede juzgar | No |
| Polymarket | `futbol:No` | 101 | **+8,67 %** | — | **0,97 / 0,79** | no significativo; ejecutor **no encendido** | **No** (banco simulado 2.000) |
| Polymarket | CS2 (sombra) | 112 en la semana | **+23,03 %** | — | — | sin veredicto de vara | No |
| Prop firm | escáner (5 frentes) | 441 señales, 154 decididas | **+1.516,10 USD** | — | — | sin vara | No (cuenta de firm) |
| Físicas (Gambia) | tarjetas under | 6 boletos | **+18,5 %** | — | — | «muestra anecdótica» | **SÍ** (6.000 GMD) |

## O.4 Recuento final de la vara a 14-sep (`semana-38.html:165`)

| Estado | Nº de filas |
|---|---:|
| **Confirmadas (t ≥ 2)** | **13** |
| En contra | 15 |
| **Para descartar (t ≤ −2 y n ≥ 100)** | **9** |
| Prometen | 3 |
| Planas | 16 |
| **Sin muestra** | **42** |
| **Total de filas del tablero** | **96** |

**Y la frase que resume el estado de la evidencia a 13-sep (HANDOFF.md:274-275):** «hoy **no hay una sola
familia en todo el sistema** de la que se pueda decir con seguridad "mete dinero ahí"». Las cuatro
candidaturas más fuertes y por qué ninguna cruza:

| Candidata | Lo que tiene | Lo que le falta |
|---|---|---|
| Cards under, núcleo limpio | +25,26 % ROI, +0,135 vs mercado con t 5,96 sobre 392 | **n = 43** en el núcleo; la ventaja cayó de +0,221 a +0,074 |
| CS2 rondas hcp Pinnacle | CLV +0,92, t 2,96, n 450, 4 semanas de ROI positivo | el margen es **2,21 %** y el CLV 0,92 % → «le ganamos al cierre, no a la casa» |
| LoL KILLS bovada | CLV +2,00, t 4,38, n 124 | margen **2,35 %** |
| Polymarket `futbol:No` | +163,95 / +8,67 % | **t 0,79-0,97**; gradiente de ventaja invertido |

**Punto de decisión declarado: ≈ 20-oct**, cuando el núcleo limpio de `cards_under_v1` llegue a 100
liquidadas al ritmo medido de 18,7/semana.

---

# Parte 11 · Guía para la auditora: dónde perdemos dinero y qué está abierto

Esta última parte no describe modelos: encuadra el trabajo de la auditoría. Recoge (a) el mapa de dónde se pierde dinero de verdad, (b) los interrogantes que el equipo tiene abiertos y no ha sabido cerrar, (c) los errores de método ya cometidos, para que no se repitan al auditar, y (d) las preguntas concretas que nos gustaría que el informe conteste.

Todo lo de aquí sale de `HANDOFF.md`, `TODO_NEXT.md` y `CLAUDE.md` a fecha 14-sep-2026, y está contrastado con el código descrito en las partes 1 a 10.

---

## 11.1 Dónde se pierde dinero, en orden de magnitud

Solo hay dinero real en un sitio, así que "perder dinero" en sentido estricto se refiere al libro de Cloudbet de tarjetas under. La autopsia del libro real (139 apuestas liquidadas, 13-sep) atribuye la pérdida a cuatro causas, y la varianza es la menor de las cuatro:

| Causa | Coste medido | Estado |
|---|---|---|
| **Apilar varias líneas del mismo partido** | −413,72 USDT | Cerrado el 13-sep: una posición por partido y lado |
| **Ligas eficientes apostadas antes de que el veto las clasificara** | −453,43 USDT (Premier −149,80, Bundesliga −122,43, MLS −118,40, Rusia −62,80) | **Abierto.** El veto tarda entre 48 y 281 partidos en clasificar una liga |
| **La ventaja del modelo se debilitó a la mitad** | +0,221 → +0,151 → +0,063 → +0,074 | **Abierto y sin hipótesis.** Es el problema número uno |
| Varianza | resto | Irreducible |

Cruce por corte, sobre las mismas 139 liquidadas:

| Corte | n | Acierto | P&L | ROI |
|---|---|---|---|---|
| Suelta + liga no eficiente | 43 | 74,4 % | +326,44 | **+23,79 %** |
| Suelta + liga eficiente | 40 | 50,0 % | −220,32 | −15,93 % |
| Apilada + liga no eficiente | 27 | 33,3 % | −361,40 | −36,88 % |
| Apilada + liga eficiente | 29 | 58,6 % | −52,32 | −5,32 % |

Dos hallazgos que conviene no volver a discutir porque ya están medidos: **Brasil no era el problema** (+24,62 acumulado, +2,20 %; es la liga más volátil, no la que pierde) y **el over no era la respuesta** (under 392 liquidadas, 69,1 %, +14,42 % ROI, +0,135 vs mercado con t 5,96; over 138 liquidadas, 47,8 %, −18,68 % ROI, −0,086 con t −2,05; en ocho semanas medidas el over no superó al under ni una vez).

En papel, el equivalente de "perder dinero" es la sombra. Las cinco familias de `derivadas_v1` acumulan −475,05 unidades sobre 5.249 con el precio ganándole al modelo de forma significativa en las cinco: hándicap asiático −263,65 (t −8,07), total de equipo −114,15 (t −5,76), empate no válido −50,20 (t −3,47), doble oportunidad −29,00 (t −3,36), ambos marcan −18,05 (t −2,35). Advertencia de lectura: esa muestra está apilada, así que la n efectiva es menor y los t están inflados; el signo no cambia por eso.

---

## 11.2 Los siete interrogantes abiertos

Ordenados por lo que el equipo cree que importa, no por facilidad.

**1. ¿Por qué se debilitó la ventaja del modelo de tarjetas?** Pasó de +0,221 (17-ago) a +0,074, sigue positiva todas las semanas pero ya no es significativa. Se descartó que sea la mezcla de línea (efecto entre 0,04 y 0,57 pp), que sea Brasil, que sea el lado under, y la mezcla de liga solo explica el 26 %. No hay hipótesis. **Es lo único que puede matar el proyecto de verdad.**

**2. ¿El CLV sirve como vara en estos mercados?** El equipo concluyó que no: en las diez familias medidas, el Brier pareado entrada-contra-cierre dice que el cierre no predice mejor que el precio de entrada (|t| < 2 en todas), y en varias la línea ni se mueve (Dota 2 kills en Bovada 92,8 % de las veces, tenis de mesa total de puntos 78,8 %, LoL kills-hándicap en Bovada 56,9 %, CS2 rondas en Bovada 56,2 %). Si esa conclusión es correcta, media industria de "medir por CLV" no aplica aquí y la vara de repuesto (`modeloContraPrecio`) es lo único que queda. **Nos gustaría que se cuestione tanto la conclusión como la prueba.**

**3. ¿Hay que cerrar las familias con veredicto "cerrar"?** Cinco familias donde el precio le gana al modelo con significancia: LoL kills-hándicap en Bovada (t −3,42) y en Cloudbet (t −3,52), CS2 rondas-hándicap en Cloudbet (t −3,31), tenis de mesa hándicap de puntos en Cloudbet (t −2,95), y la sombra `lol_kills_hcp_v1` (t −3,65). Siguen abiertas porque cerrarlas es cambio de lógica y requiere orden explícita.

**4. ¿El veto de bandas debería ser por pérdida en vez de por Brier?** Propuesta sin respuesta: cualquier liga con diez o más apuestas reales y P&L acumulado por debajo de −50 sale hasta nueva orden, la mida como la mida el Brier. Habría sacado Premier el 30-ago en vez del 12-sep. Hoy LaLiga está en Brier 0,2292, justo por debajo del umbral, con −92,68 acumulado.

**5. ¿La ventaja declarada está invertida?** En Polymarket fútbol "No", por tramo de ventaja: 3 a 5 pp +13,80 % de ROI, 5 a 8 pp +2,88 %, 8 pp o más −27,89 %. Y las apuestas marcadas sin ventaja (colocadas como control) van mejor que las marcadas con ventaja. La interpretación del equipo es que una ventaja declarada grande no señala oportunidad sino error de modelo. **Si es así, el umbral debería tener techo además de suelo, y eso cambia el diseño de todas las familias.**

**6. ¿Qué peso merece el modelo frente al precio?** La autopsia del 2-sep propuso la fórmula operativa `p* = σ(logit(p_mkt sin margen) + c·[logit(p_gp) − logit(p_mkt)])` con `c` ajustado por familia fuera de muestra, y midió que `c ≤ 0` en casi todas las familias salvo tarjetas y total de tenis. No está implementada. Implementarla sería reconocer que el sistema debe anclarse al mercado y publicar solo la desviación.

**7. ¿Qué se hace con las familias que se publican a 966 usuarios sin evidencia?** Córners (1.009 liquidadas, t −1,99 modelo contra precio, ROI −1,48 %) y goles (165 liquidadas, modelo y mercado coinciden hasta el tercer decimal, 0,574 contra 0,574, t −1,04, ROI −5,50 %) son la mitad del volumen del feed. Es decisión de producto, no de dinero, y está abierta.

---

## 11.3 Errores de método ya cometidos (no repetirlos al auditar)

El equipo los tiene escritos porque cada uno costó tiempo o dinero:

- **Abrir una familia porque es calculable.** Calculable no es calibrada. Antes de abrir un mercado hay que medir cuánto se desvía su probabilidad contra resultados reales y sumar ese error al listón de ventaja. Una familia que se desvía 5,8 pp no puede cobrar 3 pp.
- **Reutilizar una constante fuera de donde se ajustó.** Dixon-Coles con ρ = −0,13 se ajustó sobre partidos completos; aplicarlo a media lambda sobrestimaba el empate de mitad entre 2,6 y 3,6 pp siempre en el mismo sentido. Un sesgo de signo fijo fabrica ventaja falsa.
- **Fiarse de que una función devuelve lo que parece.** La función de retirada de margen devolvía nulo desde el 20-ago porque recibía números donde espera objetos. Nadie lo vio porque fallaba en silencio y hacia el lado seguro. Lo destapó un contador de cuántas veces caía en la rama alternativa.
- **Leer el CLV crudo.** La media la destrozan cierres rotos: hay un +148 % en Cloudbet que no es ganancia, es un cierre mal capturado. Siempre recortado al 10 %.
- **Olvidar el margen.** Ganarle 0,9 % al cierre de Pinnacle cuando cobra 2,21 % por lado es perder.
- **Dimensionar con el ROI observado.** Un cuarto de Kelly sobre +33 % daría el 9,6 % del banco por apuesta, y ese 33 % es el ROI de 125 apuestas en cuatro semanas.
- **Contar apuestas cuando lo que se mueve son partidos.** Dos líneas del mismo partido son una sola apuesta.
- **Leer un track sin comprobar el liquidador.** Tres liquidadores mentían a la vez: tenis liquidaba 0-0, kills sin voltear el lado, totales en cubos de cinco.

---

## 11.4 Lo que sabemos que está roto o a medias (declarado, no escondido)

| Qué | Dónde | Efecto conocido |
|---|---|---|
| Puerta de frescura de baloncesto que nunca dispara | `buildHoopsPicks` lee `best.at` y la fila trae `seen` | El precio viejo nunca se rechaza |
| Regla "solo under" de baloncesto v2 que nunca se aplica | compara `m.fam === 'total'` cuando la familia es `match_total` | La regla existe y no actúa |
| Liquidación de tenis con vencidas sin cerrar | 9 pendientes: 6 sin cruce de nombres, 3 con marcador incompleto | Envenena la muestra si se acumula |
| Ecuación de conciliación del ejecutor real que no cuadra | depósitos sin anotar | Contabilidad ilegible a futuro |
| El ranking de la federación de tenis de mesa devuelve 404 desde producción | funciona desde el entorno de desarrollo | La lista de jugadores sale del catálogo versionado |
| Muestra de CS2 contaminada hasta el 7-sep | fallo de identidad de equipos | Parte del histórico de `cs2_rounds_v1` |
| Sesgo de colas del generador de kills de LoL | +4 a 5 pp de over en mediana | Pendiente probar tendencia explícita por liga |
| Reparto por equipo y hándicap del generador de LoL sin validar | la base no tiene probabilidad de mapa previa | Solo medible en sombra |
| Derechos de fuente en esports | bo3.gg desaconseja acceso automatizado; vlr.gg y OpenDota son solo investigación | Ninguna fuente es comercialmente apta; convive por configuración |

---

## 11.5 Las preguntas que nos gustaría que el informe conteste

En orden de valor para el negocio:

1. **¿Hay alguna familia, en cualquier deporte, de la que se pueda decir hoy "mete dinero ahí" con la evidencia disponible?** Si la respuesta es no, ¿cuántas observaciones más y de qué tipo harían falta, familia por familia?
2. **¿Por qué se debilitó la ventaja de tarjetas?** Cualquier hipótesis contrastable vale más que una confirmación de lo que ya sabemos.
3. **¿Es correcta la conclusión de que el CLV no aplica en estos mercados?** Y si lo es, ¿cuál debería ser la vara principal?
4. **¿Está invertida la relación entre ventaja declarada y resultado?** Si lo está, ¿dónde poner el techo?
5. **¿Qué familias deberían cerrarse ya**, y cuáles merecen seguir acumulando muestra en sombra?
6. **¿Dónde hay ventaja que no estamos explotando?** En particular: fútbol americano universitario y canadiense encabezan el tablero de ventaja y están cerrados por doctrina; CS2 rondas es la familia con mejor evidencia propia; las props de jugador contra un libro blando son la única familia donde el rival no es una casa afilada.
7. **¿El modelo debería anclarse al mercado** (fórmula del peso `c`) en vez de competir con él?
8. **¿Hay fugas de información futura, look-ahead o sesgos de selección** en alguno de los motores o en la forma de medir? Las partes 1 a 9 incluyen, en su punto 10, las que el propio equipo detectó; interesa especialmente lo que no vio.
9. **¿La arquitectura de medición es suficiente?** Cierres contra la misma casa en cubos, unc_pp, preregistros, margen medido, parada por Monte Carlo. ¿Qué falta?
10. **Dado que a 30 USD por apuesta un ROI del 10 % son 56 USD a la semana**, ¿tiene sentido económico seguir persiguiendo la apuesta, o el valor del sistema está en el producto para los 966 usuarios?

---

## 11.6 Cómo verificar lo que dice este dossier

La auditoría se hace sobre el código, no sobre este texto. Para replicar cualquier afirmación:

- **Repositorio:** `github.com/alexisandres98/gp-simulador-mundial`, rama `main`, commit `056e37e` a fecha de corte.
- **Comprobación de sintaxis:** `node --check server.js && node --check engine.js`. No hay suite de pruebas formal; las pruebas son comprobación manual en vista previa y scripts ad-hoc.
- **Humos disponibles:** `node scripts/llm-smoke.js`, `scripts/smoke/*.js` (tenis, Valorant, baloncesto, fútbol de clubes, combate, dardos).
- **Validaciones reproducibles:** `scripts/darts-fit.js`, `scripts/tt-fit.js`, `scripts/lol-validate.js`, `scripts/dota-validate.js`, `scripts/amfoot-fit.js`, `scripts/nfl-fit.js`. Escriben o comparan contra los archivos de priors versionados en `data/`.
- **Sondas internas** (requieren clave de administración, no incluida en este dossier): estado de la vara, de la parada, del tablero de derivadas por familia, de la ventana de mercado de tarjetas y del proceso implícito.

Si algo de este documento no se puede reproducir con esas herramientas, la discrepancia es un hallazgo de auditoría por sí misma y nos interesa conocerla.

---

# Parte 12 · Hallazgos detectados al escribir este dossier

Este dossier se escribió leyendo el código línea a línea, no desde la documentación. Ese ejercicio destapó defectos que el equipo no conocía. Se listan aquí, separados de la parte 11 (que recoge lo que ya estaba abierto), por tres razones: son material de trabajo inmediato, condicionan cómo debe leerse el resto del documento, y publicarlos es la única forma de que la auditoría empiece por delante y no repitiendo lo que ya sabemos.

Ninguno está corregido a la fecha de corte. Cada uno cita dónde vive.

---

## 12.1 Lo que cambia la lectura de los resultados

### A. El modelo de tarjetas casi no modela el total

Es el hallazgo más importante del dossier, porque tarjetas es el único segmento de fútbol con dinero real.

1. Con el amortiguador de totales en cero, el total esperado de tarjetas **es la media de la liga**: las fuerzas de los dos equipos no entran en el total, solo en el reparto entre equipos. Lo único que mueve el total es un ajuste de paridad acotado a ±10 %.
2. El multiplicador de árbitro existe en el motor de props y **no se usa en producción**: la llamada de generación no le pasa el árbitro. Se construyó y se midió contra 11.466 partidos, y quedó desconectado.
3. A la familia se le levantan las puertas que aplican a las demás: exención del control de CLV pese a tener −0,5 % con t −3,7, mínimo de casas bajado a una, exigencia de precio justo desactivada, y selección de la línea de máxima ventaja, que es donde más muerde la maldición del ganador.

**Consecuencia para la auditoría:** la afirmación "el motor bate al mercado +0,135 con t 5,96 sobre 392 apuestas" hay que releerla sabiendo que la probabilidad del modelo es, en lo esencial, la media de la liga corregida por paridad. Si eso batió al mercado durante ocho semanas, la explicación más probable no es que el modelo sea bueno, sino que la ventana de mercado en la que se apostaba (ligas que abren el mercado de tarjetas a menos de seis horas del saque, donde la casa aún no ha afinado) tenía precio explotable. Eso daría también una hipótesis para la pregunta abierta número uno de la parte 11: la ventaja no se degradó, se agotó la ventana.

### B. El tablero de ventaja mide un CLV inflado por construcción

El tablero ordena familias por un t calculado sobre un CLV que compara **el mejor precio de unas 26 casas contra la mediana del cierre**. El sesgo es casi constante, de modo que infla la media sin inflar la desviación típica, y el t se dispara. Hay una segunda inflación encima: la línea evaluada es la del consenso mientras el precio usado es el de otra casa con otra línea, porque la función que elige el mejor precio descarta su línea.

Por eso fútbol americano universitario y canadiense encabezan el tablero con t de 38, 17, 12 y 8 mientras el backtest al cierre de esas mismas familias da entre −5,6 % y −7,5 % en hándicap universitario y como mucho +1,04 % en totales. **El tablero de ventaja no es utilizable como ranking de oportunidad hasta que ese CLV se recalcule casa contra su propia casa y línea contra su propia línea.**

### C. Números de referencia que no cuadran con los archivos

- El compilado de tenis de mesa figura en el punto de retoma con log-loss 0,5310 en holdout; el archivo de priors guarda **0,5789**, que es *peor* que el Elo solo. La conclusión documentada de que el compilador aporta sobre el rating no se sostiene con el archivo.
- La nota congelada del segmento de hándicap de kills de LoL ("221 picks, +15,96 unidades") es anterior al arreglo del volteo de kills del 2 de septiembre, que cambió 85 de 245 veredictos y bajó esa familia de +14,7 a +4,7 unidades. Nunca se actualizó.
- Las props de CS2 se valoran contra el inverso de la cuota decimal, es decir **con el margen dentro** (alrededor de 5,7 % en ese libro), sin retirada de vig por pares. Parte del +2,2 % de ROI atribuido a la familia es margen mal descontado.
- El acople ritmo-paliza del modelo de kills de LoL usa +0,13 donde la base propia mide −0,38: **signo contrario**. Esas constantes no se validaron en ningún ajuste.
- El archivo de priors de Fórmula 1 guarda un **Brier de podio y de puntos peor que su propia línea de base**, y un acierto en duelos por debajo del duelo decidido solo por la parrilla. El reporte semanal no lo menciona.
- El skill del compilador de dardos figura como +1,5 pp en el archivo de priors y como +1,9 pp en el punto de retoma, sobre el mismo par de cifras.
- Tres t del reporte del 14 de septiembre no coinciden consigo mismos entre tablas del propio reporte (hándicap asiático −26,49 frente a −26,45, total de equipo −5,29 frente a −5,32, ambos marcan −3,61 frente a −3,60). La parte 10 transcribe las dos versiones sin elegir.

---

## 12.2 Defectos que afectan al dinero real hoy

| # | Defecto | Dónde | Efecto |
|---|---|---|---|
| 1 | El canal de tenis de mesa **no aplica la doctrina de una posición por partido y lado**: su comprobación exige que coincida la línea, así que dos totales distintos del mismo partido pueden llevar dinero a la vez | `real-executor/tt.js` | Repite el patrón que en tarjetas costó −17,63 % con dos líneas y −45,83 % con tres. Acotado por el stake de 5 USD |
| 2 | Las líneas de parada se calcularon con stake 30 y hoy se apuesta con stake plano 40 | `real-executor/parada.js` | Los suelos en dólares son más laxos de lo previsto |
| 3 | La línea de parada número 1 solo mira tarjetas; las líneas 2 y 3 miden picks, no apuestas colocadas | `real-executor/parada.js` | CS2 y tenis de mesa tienen dinero real y **no tienen línea de parada** |
| 4 | Con Kelly igual a cero se cae al tope en las dos fórmulas y el filtro de valor esperado está apagado | ejecutor real | Se apuesta el tope sobre picks con valor esperado negativo: el 14 % de las señales, con −2,1 % de media |
| 5 | La banda de eficiencia se mide con el Brier del mercado **sobre nuestras propias picks**, no sobre todos los partidos | `leagueEfficiency` en `server.js` | Muestra seleccionada decidiendo el régimen, la publicación y la entrada de dinero |
| 6 | El consenso de córners y tarjetas admite un mínimo de una casa | generación de picks de clubes | La ventaja de la familia con dinero puede medirse contra una casa desvigada contra sí misma |
| 7 | La vara oficial no cubre las familias públicas de fútbol | `/api/internal/vara` | 1X2 sólido, goles, córners y tarjetas se juzgan por CLV sin restar margen |
| 8 | El módulo de la vara **no se importa en ningún archivo del motor de esports** | `lib/vara.js` | La familia que más picks produce sigue generándolas con veredicto de cierre |
| 9 | Papel y dinero no se liquidan con la misma autoridad: la sombra con la pick propia, el real con el estado de la casa | ejecutor y sombra | Contamina justo la comparación que el experimento existe para medir |
| 10 | La sombra de Polymarket y su ejecutor no descuentan la comisión del 3 % que su propio motor de comisiones documenta | `propfirm/`, `polymarket/` | Sobreestima el resultado de la única familia que se estaba preparando para recibir dinero nuevo |

---

## 12.3 Defectos que impiden medir

| # | Defecto | Dónde | Efecto |
|---|---|---|---|
| 11 | El moneyline **nunca se liquida** en fútbol americano: solo hay rama para hándicap y total | `nfl-engine/store.js`, `amfoot-engine/store.js` | Toda pick de ganador se marca empate con cero unidades; la familia reabierta para acumular muestra no puede producirla |
| 12 | El desglose del track de combate ofrece doce cubos sobre 140 apuestas liquidadas y mezcla eras | `trackBreakdown` | Caza de subconjuntos. El cubo "sin señal a 24 horas" mide picks anteriores al despliegue de esa regla |
| 13 | La lista de no ejecutables está truncada a 300 filas mientras el libro crece sin límite | sombra en `server.js` | La tasa de ejecución se sesga al alza con el tiempo |
| 14 | Conviven cuatro definiciones de CLV con distinta unidad y distinto referente, sin nada que impida compararlas entre sí | varios | Comparaciones inválidas silenciosas |
| 15 | La capa inmutable y versionada de métricas y el registro de señales están **apagados por defecto** | `metrics-engine/`, `signal-registry/` | Decide la medición ad hoc; no hay hechos inmutables |
| 16 | La sombra del proceso implícito solo guarda las tesis que pasaron la puerta | `implied-engine/sombra.js` | La comparación "con puerta contra sin puerta", que es su razón de existir, no es computable |
| 17 | La puerta de frescura de baloncesto lee un campo que la fila no trae, y la regla "solo under" compara con un nombre de familia que no existe | `buildHoopsPicks` | Ninguna de las dos actúa |
| 18 | La vara juzga alrededor de treinta familias con el criterio t ≥ 2 sin corrección por comparaciones múltiples | `/api/internal/vara` | Con treinta pruebas, un par de falsos positivos es lo esperable |
| 19 | El kickoff de fútbol americano se construye como UTC cuando la fuente da hora local | motores de NFL y amfoot | Desplaza clima y ventanas de barrido |
| 20 | El archivo que hace de único juez del track de Fórmula 1 vive solo en disco persistente, sin copia | `f1-engine/store.js` | Pérdida total del histórico ante un fallo de disco |

---

## 12.4 Supuestos de modelo que el código declara y nadie ha validado

- **Combate:** el peso óptimo del mercado medido sobre 4.180 peleas es 1,00 (el modelo pierde contra el cierre con t +11,2) y la compuerta de decisión sigue mezclando modelo y mercado al 50 %. La retirada de margen proporcional está medida como sesgada (1,11 en el cierre, t 28,7) y no se ha corregido. La señal de peso en vivo es una constante de dos libras: se entrena con una cosa y se sirve con otra.
- **Fútbol de clubes:** solo 14 de 47 ligas pasan la puerta de 1X2 y 2 de 47 la de goles; el modelo de goles tiene habilidad negativa en 45 ligas. Aun así el feed publica goles y córners, que son la mitad de su volumen.
- **Dardos:** el kernel descansa en priors no ajustados (repartos del fallo, dispersión, penalización de medio dardo) y en el único formato con muestra el error medio mejora al método naíf en 0,005. La familia insignia, los 180s, solo es liquidable en un torneo; el resto muere anulada a doce días.
- **Tenis:** los índices de saque y resto están congelados en mayo y son el único insumo del compilador que produce totales y hándicaps. La probabilidad implícita se calcula sin retirar margen.
- **Baloncesto:** las desviaciones típicas del proceso implícito están fijadas por decreto, sin medición citada en el código, y la incertidumbre de la desviación entre casas es una constante.
- **Generador de kills de LoL:** por su propia validación no bate al histograma empírico de la liga (+0,30 %) y arrastra un sesgo de cola de 4 a 5 puntos; además el archivo de priors corresponde a una versión distinta de la que corre en producción.

---

## 12.5 Riesgos que no son de modelo

- **Derechos de fuente.** La base histórica de LoL es Creative Commons con atribución, marcada explícitamente como no apta para uso comercial; lo único que impide servir picks de LoL al público es una variable de entorno, sin puerta en código atada a la clase de derechos. Tenis de mesa y dardos están abiertos al público con su fuente principal marcada como uso comercial desconocido o denegado, por decisión registrada del dueño. En esports ninguna fuente es comercialmente apta: una desaconseja el acceso automatizado y dos son de solo investigación.
- **Contabilidad.** La ecuación de conciliación del ejecutor real no cierra por depósitos sin anotar, y el archivo de cuotas de combate cuesta alrededor de 1,4 GB transitorios por leerse de forma síncrona.
- **Operación.** El proceso tuvo una zona muerta de memoria en la que ni trabajaba ni se reiniciaba, cerrada el 14 de septiembre; y el relay de colocación tiene despliegue automático activado, de modo que un cambio en la rama principal podría reiniciarlo en medio de una colocación.

---

## 12.6 Cómo debería usarse esta parte

Tres sugerencias para la auditora, en orden:

1. **Empezar por 12.1.A.** Si la conclusión es que la ventaja de tarjetas nunca fue del modelo, cambia la pregunta central del proyecto: dejaría de ser "por qué se degradó el modelo" y pasaría a ser "cómo se identifica y se explota una ventana de mercado antes de que la casa la cierre".
2. **Tratar 12.1.B como bloqueante.** Mientras el CLV del tablero esté inflado, cualquier ranking de familias prometedoras que salga de ahí es ruido, incluido el que este equipo ha venido usando para decidir.
3. **No dar por válido ningún número de la parte 10 sin comprobar su liquidador.** Ya se descubrieron tres liquidadores que mentían a la vez, y en esta lectura aparecieron uno más que no liquida nada (moneyline de fútbol americano) y otro que puede duplicar posiciones (tenis de mesa).

---

*Documento generado el 2026-09-15. Fecha de corte de los datos: 14 de septiembre de 2026.*
