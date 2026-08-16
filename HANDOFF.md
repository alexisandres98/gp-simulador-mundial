# HANDOFF — estado al 16-ago-2026 (esports: quinto deporte, admin-only)

> Punto de retoma para la siguiente sesión. Lee `CLAUDE.md` primero (reglas duras), luego esto, luego el
> principio de `TODO_NEXT.md`.

## 🎮 ESPORTS — el quinto deporte, construido el 16-ago y ADMIN-ONLY desde el día uno

**Qué hay.** Cuatro juegos que NO comparten motor, cada uno en su pestaña, porque su lógica es distinta de
verdad: CS2 (veto de mapas, rondas, economía), LoL (ritmo de liga → duración → kills), Valorant (veto,
composiciones y asimetría ataque/defensa) y Dota 2 (draft, duración de cola larga, reversión por aegis y
buyback). Archivos: `esports-engine/{core,cs2,lol,valorant,dota2,store}.js` y
`data-providers/esports/cloudbet.js`. Rutas `/api/esports/{overview,board,match,model,snapshot}`, todas
detrás del mismo portón que baloncesto (`GP_ESPORTS_PUBLIC_ENABLED`, hoy sin poner = solo admin). En la UI:
deporte **Esport** en la barra de deportes, con teaser "Próximamente" para el público.

**La doctrina, puesta desde el minuto cero en vez de aprendida otra vez.** El ganador de serie se calcula,
se enseña y se explica, pero **no genera picks**: la puerta está cerrada en `PICK_FAMILIES`, no en una
variable de entorno. Es donde baloncesto perdió −11,87 % de ROI y combate −8,34 % de CLV. Las picks solo
salen de familias derivadas (rondas, kills, totales, hándicaps).

### Lo que se midió contra el proveedor, y conviene no volver a intentarlo
- **The Odds API no tiene NI UN deporte electrónico** (0 de 75). Cloudbet sí, y ya estaba pagada.
- **Cloudbet NO publica resultados.** Un evento terminado llega con `settlement: {}` y CERO mercados; el
  catálogo de fixtures solo mira hacia delante; `/odds/results` y `/events/settled` son 404. Consecuencia
  seria: **el rating propio de esports no puede arrancar solo.** El diseño lo aguanta (la probabilidad va
  anclada al mercado con 0 % de peso propio) y la UI lo dice con todas las letras en Rendimiento, en vez de
  enseñar un cuadro en cero que se leería como un fallo.
- **Lo que sí se acumula desde hoy: el CIERRE de mercado** (`snapshot`, cada 20 min, `data/esports/`). Sin
  resultados no se liquida, pero el día que entre una fuente de histórico el CLV se calcula hacia atrás.
- **La mayoría de partidos NO cotiza el ganador de serie** pero sí marcador, hándicap y ganador de mapa. Por
  eso `marketAnchor` recorre esas cuatro fuentes en orden y dice de cuál salió. Anclarse solo a `SERIE`
  dejaba en blanco partidos con dieciséis líneas abiertas.

### Cuatro errores que se encontraron MIDIENDO y que ya están corregidos (no repetirlos)
1. **El prefijo de Valorant es `esport_valorant`, no `valorant`.** Asumirlo dejaba todos sus mercados a cero.
2. **La línea vive en `sel.params`, no en la clave del submercado.** Leer solo la clave dejaba todas las
   líneas en `null` y con eso ninguna familia derivada se podía valorar.
3. **El hándicap se aplica SIEMPRE al local, con su signo; el lado visitante es el complemento.** Verificado
   con un partido que cotizaba a la vez marcador, ganador de mapa y hándicap (UNiTY vs Misa): las tres
   familias daban P(local 2-0) = 0,308 / 0,306 / 0,330. Agrupar por `Math.abs(line)` perdía el signo y
   fabricaba un favorito del 62 % donde el mercado decía 90 %.
4. **No se busca valor en el precio contra el que te has calibrado.** La familia que ancló la probabilidad
   queda excluida de la valoración y se dice por qué. Sin eso salía una "ventaja" de +41,76 pp en el mismo
   hándicap que era el ancla — y llegó a pintarse en pantalla antes de detectarla.

### Dos decisiones de modelo que conviene entender antes de tocarlas
- **Una sola casa no puede ser un veto permanente.** Bloquear toda pick con menos de dos casas significaba
  cero picks para siempre (GP tiene UNA fuente de esports). En vez de ignorar el riesgo, **sube el listón**:
  +2,5 pp de ventaja exigida cuando solo cotiza una casa, y se dice en la ficha.
- **La incertidumbre no es la misma para todas las familias.** Un total de kills no depende de conocer a los
  dos equipos, depende de si el perfil de ritmo de la liga es correcto. Cobrarle la ignorancia sobre el
  emparejamiento (±15 pp con muestra cero) hacía imposible que ninguna línea de volumen pasara nunca. Ahora
  las familias de VOLUMEN pagan la incertidumbre del perfil (±7,4 pp) y las de MARGEN la del par.

### Calibraciones declaradas como supuesto (no como medición de GP)
- Perfiles de ritmo por liga (LoL) y por circuito (Dota 2): referencia de circuito 2026.
- Sesgo defensivo por mapa en Valorant: referencia de circuito.
- **Arrastre económico por ronda** (CS2 0,055 / Valorant 0,065): calibrado para que la tasa de prórroga caiga
  del 16,4 % del binomio al ~12,8 %, que es lo que da el circuito. El **signo importa y es fácil de
  equivocar**: quien ganó la ronda anterior llega con dinero, así que la racha se refuerza (`+`). Con el
  signo al revés el modelo revertía a la media y disparaba la prórroga al 19 %.
- CS2: la carrera a 13 hacía IMPOSIBLE el 12-12 y la tasa de prórroga salía exactamente 0 — un imposible del
  juego, no un resultado. Ahora son 24 rondas de regulación y bloques MR3 de prórroga.

### Verificado (en local contra la API de producción de Cloudbet, con datos reales)
- Los cuatro juegos responden; CS2 12 eventos / 5 ligas, LoL ~22 / 9, Valorant 4 / 1, Dota 2 sin agenda hoy.
- Sumas de probabilidad coherentes en las diez familias derivadas (más/menos = 1, hándicaps complementarios).
- Las cinco vistas pintan a 1400 px y a 390 px **sin un solo error de JS**, y los otros cuatro deportes
  siguen intactos (fútbol, combate y baloncesto probados en la misma pasada).
- El público (usuario beta no admin) ve **Esport · Próximamente** deshabilitado, las tres rutas devuelven
  404 y un enlace directo a `#esopps` cae al board de fútbol.
- **El menú "más" del móvil lleva su rama de esports desde el principio** — es el fallo que ya mordió a
  combate el 2-ago y a baloncesto el 16-ago por la mañana; no se repitió.

### Verificado EN PRODUCCIÓN (deploy `81fc4ea`, 16-ago 12:57)
`GET /api/internal/esports?key=$GP_EXPORT_KEY` — misma llave que `/llm` y `/shadow`, no sirve inteligencia
ni picks, solo estado. Devuelve: los cuatro motores cargan, la clave del proveedor está, el trabajo de
cierres corre, y la agenda real (CS2 9 partidas / 5 ligas, LoL 21 / 9, Valorant 4 / 1, Dota 2 sin agenda).
- **Los cierres se escriben en `/data/esports` (disco persistente), no en el repo.** Se corrigió tras
  desplegar: el directorio del repo se recrea en cada deploy y habría borrado el histórico justo cuando
  empieza a acumularse. La ruta interna dice cuál de los dos está en uso (`closes_dir_persistent`).
- El resto de la plataforma sigue sana (`/`, `/api/aciertos`, `/api/ticker` en 200).

### Lo que falta en esports (por orden de valor)
1. **Una fuente de resultados.** OpenDota (público) y la API de Riot son las dos primeras y no necesitan
   permiso comercial. Sin esto no hay rating propio, ni liquidación, ni ROI que enseñar.
2. Histórico de vetos y de drafts: hoy el árbol de veto se deriva de la fuerza por mapa, que a su vez no
   existe todavía (por lo mismo del punto 1).
3. Demos .dem para CS2 (economía real por ronda) — necesita solicitud aprobada en FACEIT.

---

## Estado: desplegado y estable tras la caída del 16-ago (ver el bloque siguiente).
- `origin/main` = **`117ccb7`** · deploy `dep-da0crhtbedkc73ag12t0` en **live** sirviendo ese commit.
- **Ojo con el `main` LOCAL de una sesión nueva:** el contenedor clona con profundidad 50, así que el `main`
  local puede ser una ventana vieja del histórico y `git merge` responde *"refusing to merge unrelated
  histories"*. No es un conflicto real. La verdad está en `origin/main`: comprobar con
  `git merge-base --is-ancestor origin/main <rama>` y empujar con
  `git push origin <rama>:main`, que es un avance rápido limpio.

### Verificado EN PRODUCCIÓN (no en local)
- MMA, cartelera de UFC 330: las cuatro peleas probadas devuelven `deep.available: true` con el contrato
  nuevo (`sport`, `axes`, `phase_strip`) — **sin regresión**. Endpoint completo entre 419 y 1.374 ms.
- La app real (el `premium.js` que sirve producción, contra la API de producción) pinta **las cinco piezas**
  a 1.280 px y a 390 px, sin desbordes y sin un solo error de JS.
- El caso sin datos también se ve bien: la pelea de boxeo de esta noche muestra el panel de respaldo con su
  motivo, no un hueco.

### ⚠️ EL LÍMITE REAL DE BOXEO NO ES EL MOTOR, ES LA COBERTURA DEL DATASET
Las **tres** peleas de la cartelera de boxeo del 15-ago dan `available:false`, y no es un fallo de
identificadores: de los seis boxeadores, **cinco tienen CERO peleas en `fights-boxing.json`** (Angulo sí:
30 peleas, perfilado sin problema). El motor carga bien (2.767 perfiles, 144 ms). El dataset viene de
Wikipedia y cubre a los conocidos, no las carteleras de club que trae la agenda de The Odds API.
En la propia validación se ve el mismo sesgo: de 12.966 peleas candidatas, 8.667 se descartan porque a uno
de los dos le falta perfil.
**Próximo paso natural para que boxeo rinda: ampliar `fights-boxing.json` hacia BoxRec/prospectos**, no
tocar el motor.

### ✅ Corregido: el aviso de ruta en MMA usaba un umbral único para cuatro escalas distintas
`style.js` marcaba una ruta con *"la pelea probablemente no llegue ahí"* cuando la masa de su fase bajaba de
0,40 — el mismo corte para las cuatro fases. Medido sobre 1.199 cruces reales de la UFC, las fases no viven
en la misma escala ni de lejos (mediana: pie 0,414 · clinch 0,103 · lucha 0,386 · suelo 0,469), así que
**cualquier ruta que fuera por el clinch llevaba el aviso el 100 % de las veces** y a Makhachev le salía con
el suelo al 22 %. Un aviso que no puede no salir no informa. Ahora cada fase se compara contra su propio
percentil 25 y el texto dice lo que el número dice ("pesa poco en esta pelea", no "no llega ahí"). El aviso
pasa de estructural a dispararse en el 10,8 % de las rutas.

### 🔬 El récord truncado de boxeo: investigado, medido y NO corregido a propósito
La mitad de los perfiles de boxeo (1.391 de 2.767) se construyen sobre récords truncados y sus tasas están
sesgadas de forma brutal (−62,9 % de rotura, +145,7 % de fragilidad). **Pero predicen mejor que los
completos** (AUC 0,744 contra 0,685): que solo los conozcamos por sus derrotas contra buenos dice que son el
lado B, y eso acierta. Se probaron dos correcciones y las dos empeoran — el ajuste por calidad del rival
además rompe el nivel (predice 28,8 % donde ocurre 50,3 %). Todo escrito con sus cifras en el encabezado de
`combat-engine/boxing.js`, y la partición por completitud queda vigilada en cada corrida de
`scripts/boxing-validate.js`.

**Lo que sí falta es dato**, y no se puede bajar desde aquí: Wikipedia devuelve 429 a la IP del sandbox con
cualquier ritmo. Comando para correr desde fuera:
`node scripts/combat-boxing-backfill.js --depth=3 --max=4000 --sleep=200` (idempotente, cachea).

## 🚨 CAÍDA DE PRODUCCIÓN DEL 16-ago (05:06 → 09:05 UTC) — resuelta, causa raíz a medias

**Síntoma:** 22 caídas por falta de memoria en bucle, 502 casi continuo durante ~4 horas. El proceso
arrancaba sano en ~150 MB, daba **un único salto a 1,5 GB en menos de un minuto** y moría a los ~215 s.

**Por qué nadie lo vio venir:** ningún despliegue del histórico había vivido más de 1,2 h — la tarde del
15-ago hubo 25 redespliegues seguidos. El primer proceso que corrió una noche entera fue el de las 21:20,
y llegó al pico. **El "no había OOM en 3 días" no probaba nada: el proceso nunca vivía lo suficiente.**

**El error que hizo perder una hora:** subir la instancia a 4 GB **no cambió nada**, porque
`NODE_OPTIONS=--max-old-space-size=1536` estaba fijado a mano en Render. Node se quedaba topado en 1,5 GB
pasara lo que pasara con la RAM del contenedor — los logs de GC lo decían (`1544 MB`) y tardé en mirarlo.

**Lo que restauró el servicio (tres cosas):**
1. `NODE_OPTIONS` → `--max-old-space-size=3072`. **Esto es lo que de verdad levantó la plataforma.**
2. Los tres trabajos de baloncesto (`buildHoopsPicks`, `settleHoopsPicks`, `hoopsPicksCloseline`) dejaron
   de dispararse a la vez a los 200 s del arranque; ahora van encadenados. Pico: 1429 → 912 MB.
3. Un vigía de memoria (`[mem]`) que muestrea el montón cada 5 s y, al cruzar escalones de 250 MB, imprime
   la bitácora de trabajos de los últimos 45 s. **Sin él esto no se resuelve**: el trabajo que revienta
   muere antes de loguear, y tres horas de arqueología de logs no bastaron.

**Estado:** estable. Pico ~912 MB contra un techo de 3072, cero OOM, sitio en 200.

**LO QUE FALTA (no urgente, pero real):** el pico de ~900 MB sigue siendo desproporcionado. El vigía lo
atribuye sobre todo a `hoops:build` (el constructor de picks de baloncesto), con el bloque
`combate:cloudbet` de las tres organizaciones aportando los primeros ~600 MB. **Dos hipótesis mías ya
cayeron por medición**: no es `db.json` (259 MB de disco al 25 %, base en memoria sana) y no es el archivo
de cuotas de combate (pesa 0,2-0,4 MB, medido en producción). Para cerrarlo hacen falta marcas finas
dentro de `buildHoopsPicks` y de `combatCloudbetRefresh`. **Ojo: `buildHoopsPicks` es lógica de baloncesto
y está congelada hasta el domingo 23** — instrumentar sí, reordenar su lógica no.

---

## EL PRINCIPIO QUE GOBIERNA TODO LO QUE SIGUE

Medido por separado en dos deportes, con métodos independientes, y coincidiendo:

**El mercado de GANADOR es donde se pierde dinero. Los mercados DERIVADOS son donde hay señal.**

| | Ganador | Derivado |
|---|---|---|
| **Baloncesto** (backtest al cierre, 911 partidos NBA) | ROI −11,87 % · t = −2,05 | Totales −0,26 % (NBA) · **+2,15 %** (WNBA) |
| **Combate** (monitor en vivo, 66 picks liquidadas) | Familia FIGHT · **CLV −8,34 %** | Familia ROUNDS · **CLV +4,88 %** · 52,2 % acierto |

Corolario que ya está aplicado en los dos motores: **anclarse a lo que funciona y dejar que el modelo mande
solo donde ha demostrado que sabe.** En baloncesto, encogimiento al consenso de mercado. En combate, el
ganador lo fija el Elo y el método/asalto/duración el motor de fases.

---

## 1) BALONCESTO — CERRADO HASTA EL DOMINGO 23

**NO TOCAR LA LÓGICA DE DECISIÓN ANTES DEL 23 DE AGOSTO.** Está corriendo para acumular una semana de
datos. Cambiarla a mitad de la ventana destruye la muestra. Las 4 correcciones acordadas están al principio
de `TODO_NEXT.md` con su evidencia y los comandos a correr ese día.

Se está acumulando solo: movimiento de línea (`sportsbook_quote_history`), partes de bajas con hora
(data-fabric), props con vig y dispersión (`hoopsPropsCapture`, cada 30 min) y picks con veredicto de
compuertas.

**Números clave que no hay que volver a calcular:**
- Backtest al cierre NBA: ROI −7,27 % ± 2,67 (t = −2,72) sobre 1.910 selecciones.
- Las picks prometían 56,5 % de acierto y dieron 43,6 %. En el tramo 67-83 % acertaron el 49,3 %.
- Fadear tampoco gana (−2,69 % NBA): no hay señal invertida, solo ruido pagando margen.
- Props WNBA: vig 6,98 % vs 4,71 % del mercado principal; 1 % de líneas con EV ≥ 2 % vs 9 %.

---

## 2) COMBATE — PRIMERA TANDA HECHA, DOS BLOQUES PENDIENTES

**Hecho y desplegado:** `combat-engine/{phases,style,fightsim,intel}.js` + `scripts/combat-validate.js`.
`/api/combat/fight?deep=1` devuelve ADN, cruce por fase, rutas, fragilidad, método, asalto, duración,
tarjetas e incertidumbre.

**Validación (3.140 peleas, ventana móvil):** ganador Brier 0,276 vs 0,250 de la moneda (peor que una
moneda, 7 de 8 tramos descalibrados) · método dentro de 3 pp en las cuatro categorías. Por eso el ganador
va anclado al Elo.

### ✅ HECHO A — Capa visual de combate (secciones 32-39)
Cinco piezas en `public/premium.js` (`cbDeepField`, `cbDeepDna`, `cbDeepRoutes`, `cbDeepCards`, `cbDeepSim`,
envueltas por `cbDeepSection`) + su CSS al final de `public/premium.css` (bloque `gx-cbf/cbd/cbr/cbs/cbsim`).
Van en el cockpit **después de la lectura y antes de las tablas de referencia**: es lo que la gente viene a
buscar, no un apéndice.

**Sirven para los DOS deportes con el mismo código.** El contrato lo pone el payload
(`deep.axes`, `deep.phases`, `deep.phase_strip`, `matchup.dims`, `routes`, `fragility`, `projection`) y la UI
no tiene ninguna lista de ejes escrita a mano.

Cuatro decisiones de diseño que se tomaron **mirando el render, no en abstracto** (banco de pruebas:
Playwright + el `premium.css` real, 820 px y 390 px):
- **El histograma de asalto de finalización va en su propia escala.** Con "llega al límite" (57 %) como una
  columna más, los doce asaltos que importan (2-5 % cada uno) quedaban aplastados y no se distinguía R2 de
  R9. El total al límite se dice en una línea debajo.
- **La tabla de totales muestra solo las 6 líneas alrededor de la mediana.** Un combate a 12 genera once, y
  "más de 1,5 asaltos al 97 %" no lo cuelga ninguna casa.
- **Un asalto sin dueño se pinta GRIS, no ámbar.** La primera versión marcaba en ámbar todo asalto a menos
  de 8 pp del 50 % y en una pelea pareja salían 10 de 12: un muro ámbar no dice "esto está en el aire".
- **La incertidumbre se publica en cuota, no en "pp".** La parte aleatoria es la desviación de un Bernoulli
  y en cualquier pelea pareja vale ~50 → salía un "±46 pp" que asusta sin informar. Se publica el reparto en
  porcentaje y la parte epistémica en puntos con sus causas, que es lo único que baja con más datos.

### ✅ HECHO B — Motor de boxeo propio (secciones 14-18)
`combat-engine/boxing.js` + `scripts/boxing-validate.js`. Entra por la misma puerta (`intel.js` despacha por
deporte) y el endpoint lo usa con `org=boxing`.

**Lo primero que había que saber, y no era lo que creíamos:** boxeo no estaba "usando el motor de MMA
adaptado" — **no tenía capa profunda en absoluto.** `intel.js` buscaba `espnstats-boxing.json`, ese archivo
NO EXISTE (ESPN no publica estadística de boxeo), `buildProfiles` producía **0 perfiles** y `fightIntel`
devolvía `available:false` para toda pelea de boxeo. Verificado ejecutando el camino que corre hoy en
producción. Ahora produce 2.767 perfiles.

**Lo que el dato de boxeo tiene:** asaltos pactados, asalto y reloj de final, método (KO/TKO/RTD/UD/SD/MD/
PTS/TD), ganador; y por peleador alcance, altura, guardia, nacimiento, récord. **NO hay conteo de golpes.**
El "jab/power split" que pide el blueprint no puede salir de CompuBox porque no tenemos CompuBox: se publica
como un eje de **cuándo se resuelve la pelea**, con su procedencia escrita en el propio payload (`no_data`).

**Validación fuera de muestra — 2.768 peleas desde 2017, ventana móvil por bloques:**

| | Predicho | Real | |
|---|---|---|---|
| **¿Se rompe la pelea?** | 50,5 % | 51,1 % | **AUC 0,694** · Brier 0,221 vs 0,250 · deciles monótonos (24/22 → 82/81) |
| **¿Cuándo?** | asalto 5,11 | 5,30 | corr 0,43 · "antes del 4º" 38,6/34,5 (AUC 0,685) |
| KO | 16,3 % | 17,1 % | |
| TKO | 30,0 % | 29,4 % | |
| Retirada (RTD) | 4,2 % | 4,7 % | |
| Decisión | 47,2 % | 48,9 % | |
| Empate | 2,27 % | 1,77 % | |
| Dividida/mayoritaria | 15,1 % | 17,8 % | de las decisiones |

**⚠️ UNA MEDICIÓN QUE CONTRADICE LO QUE ESPERÁBAMOS.** En MMA el motor de fases salió PEOR que una moneda
para el ganador (Brier 0,276 vs 0,250) y ese fue el argumento del anclaje. **En boxeo no pasa:** Brier
**0,204 vs 0,250**, 67,2 % de acierto, y no es un artefacto del orden (f1 gana el 49,3 % en el archivo).
Se ancla igual, por otras dos razones: (a) el principio medido en dos deportes dice que el mercado de
ganador es donde se pierde dinero, discrimine o no el modelo; (b) 3 de 8 tramos siguen descalibrados
(ECE 3,79 pp) — distingue, pero sus números aún no están para poner precio.
**Si algún día hay histórico de cuotas de boxeo, esta es la primera hipótesis que merece una prueba real.**

**Lo que se DESCARTÓ con su medición:** la guardia (zurdo/diestro). Hay dato para 1.296 de 1.406 peleadores
del índice, pero en peleas desde 2018 **los dos** tienen guardia conocida solo el **19,5 %** de las veces.
Una dimensión que falta en 4 de cada 5 cruces no puede ser una dimensión del cruce: se muestra como dato,
no toca la probabilidad.

**La única constante libre (`KAPPA_FIN = 0,50`) está ajustada contra la tasa real de finalización**, no a
ojo. La primera versión, con los multiplicadores de fatiga y daño apilados sobre el peligro base, predecía
**69,7 % de finalización contra un 51 % real** — el peligro ahora va anclado a la tasa medida de la liga
(0,0527 por lado y asalto) en forma ataque × defensa.

**⚠️ SIN DESPLEGAR.** Todo esto está en la rama `claude/gpsim-combat-visual-boxing-276pin`, no en `main`.
Producción sigue sirviendo `bc5f296`.

## 3) LO QUE NO SE PUEDE MEDIR TODAVÍA (y por qué)
- **ROI retrospectivo de combate**: no hay histórico de cuotas. El CLV del monitor es la única vara.
- **Capa de plantilla en baloncesto**: sin partes de bajas históricos, su ajuste vale cero por construcción
  (es un delta contra el equipo habitual). El fabric empezó a recogerlos el 16-ago.
- **Props de WNBA con muestra**: la captura arrancó el 16-ago. El domingo habrá una semana.

---

## 4) RESTRICCIÓN DE SEGURIDAD QUE PERSISTE
Existe una segunda clave gratuita de The Odds API (`dec73d5d4ccfc5a8e5501b140fe01338`) creada en una cuenta
nueva tras agotar la cuota de la primera. **No debe conectarse ni usarse**: usar una segunda cuenta gratuita
para extender una cuota agotada viola los términos del proveedor. La clave en producción
(`f214ddd251b7f339d3a6802b8b62b745`) es una mejora de pago legítima de 5M créditos y es la correcta.

---

## 5) DATOS ÚTILES DE OPERACIÓN
- `GP_EXPORT_KEY` = `53cada409f32a4686e70dc38c20ae867824aeb1c21abbe4b`
- Token admin para probar endpoints: `scratchpad/gp_token.txt` (cabecera `Authorization: Bearer <tok>`)
- `GP_FABRIC_DIR=/data/fabric` (disco persistente de Render; sin eso el fabric se borra en cada deploy)
- Los endpoints de baloncesto y combate son **admin-only** (404 sin token).
- El sandbox no deja salir a Chromium: para probar UI, servidor estático local en :8099 + Playwright con
  `pg.route('**/api/**')` relayando a producción.
- `node` nativo no honra el proxy: usar `NODE_USE_ENV_PROXY=1` en local (producción no tiene proxy).
