# HANDOFF — estado al 2-sep-2026 (mejoras implementadas + autopsia + backtests + LoL cerrado)

## 🚀 MEJORAS IMPLEMENTADAS Y DESPLEGADAS (2-sep, noche) — cinco ramas fusionadas, orden de Alexis
Alexis pidió "procede con todas las mejoras" del informe de backtests. Cinco agentes independientes, uno por
familia, cada uno con su informe en **`docs/impl/<familia>-REPORT.md`** (tenis, valorant, hoops, futbol,
combate) y su humo en `scripts/smoke/<familia>-smoke.js` (todos en verde: 38/24/39/47/16 comprobaciones).
**Intocables respetados:** `cards_under_v1`, `cs2_rounds_v1`, `lol_kills_hcp_v1` (demostración en el REPORT de
fútbol §3 y en el de Valorant). Lo que cambia en producción:
- **Ejecutor real:** `GP_REAL_STAKE_FLAT=40` (env en Render, orden de Alexis): toda tarjeta under entra con 40
  fijos en vez de Kelly/4 con tope 1,5 % (~30). CS2 sigue en 5 (`GP_REAL_CS2_STAKE`). El board publica
  `stake_plano` y `stake_cs2`. `picks-export?shadow=1|real=1` exporta los libros completos.
- **Tenis:** edad lineal (−0,103·Δedad/5) y calendario (días sin jugar + partidos en 7 días, solo con fecha real
  de la cola ESPN) en el logit del ensamble **ATP**; distribución de juegos C6 (punto + residuo empírico por
  tercil, tabla `gamesResid` en `model-priors.json`) **solo ATP bo3**; `best_of` de la cola ESPN derivado del
  marcador (1.024 filas reparadas; en Render la repara la pasada diaria); `track.por_evento` para TOTAL;
  `prereg_total8` y `docs/PREREGISTRO_TENIS_TOTAL.md`; cierres con `totals_all`/`spreads_all` y Pinnacle aparte.
- **Valorant:** bisección de pRound (adiós `×0,44`), anclaje por mapa al mercado (`map_anchoring`, réplica de
  CS2), nivel de serie con temperatura 0,85 y `maxModel 0,25`, signo del término de composición del veto
  corregido, mapa nunca empatado, RONDAS_EQUIPO paga la incertidumbre del par, picks con `dist_method:'bisect'`.
- **Baloncesto (monitor):** `clv_pct` pasa a justa-vs-justa (`clv_price_pct` conserva la vieja; migración
  `clv_v:2`), **una pick por tesis** con `requotes`, `close_line`/`line_moved_pts`, `rest_diff` y
  `prereg_rest_over` en TOTAL, `preregistro_descanso` en `/api/hoops/perf`, bajas a
  `/data/hoops/injuries-history.jsonl` diario, `/api/hoops/picks?limit=` hasta 2000. Enmienda en el preregistro
  de totales. **Hallazgo sin tocar:** el filtro "V2 solo under" compara `'total'` con la familia `match_total`
  → es código muerto y los overs SÍ pasan (decidir antes del 17-sep).
- **Fútbol clubes:** consenso 1X2 con **de-vig de Shin** (`lib/devig.js`; totales/córners/tarjetas siguen
  proporcionales); `model_prob` del SOLID = `p_pub` con `GP_SOLID_C` (default **0** → el régimen `lead` no
  genera picks; `anchor` sigue); **prior por división en copas** (`clubs-engine/cups.js`, `GP_CUP_TIER_GAP_ELO`
  default 150, prior declarado; con él la discrepancia extra de copas que cruzan división pasa de +15,7 a
  +1,5 pp); `shadow_result` en SUPERSEDED (solo medición); `odds_at_create`/`books_at_create` congelados;
  `prereg_goals_late`, `prereg_corners_2books`; `roi_at_create` en el track; `docs/DEVIG_SHIN_MEDIDO.md`
  (19.850 partidos de football-data: Shin corrige la mitad del sesgo favorito-longshot).
- **Combate:** tags al nacer (`market_fair_at_create`, `prereg_fav45`, `espn_order_home`, `weigh_signal`,
  `press_signals`), re-evaluación **T−24 h** (`degraded_monitor`), `fight_breakdown` en el track, guarda de
  fechas placeholder, `docs/PREREGISTRO_COMBATE_FAVORITO.md`. **Cuotas históricas UFC conseguidas**
  (`data/combat/odds-history.json.gz`, 6.090 peleas): el cierre bate al modelo (t 11) y a la mezcla (t 6); la
  regla "favorito del mercado" replica +5,2 % vs −4,8 % en 2.031 picks simuladas
  (`docs/COMBATE_CUOTAS_HISTORICAS.md`).
- **Pendiente de UI** (no tocado `public/`): pintar `adjustments`/`what_matters` de tenis y `map_anchoring`
  de Valorant en `premium.js`.
- **Sandbox:** el sistema de archivos de la sesión se revirtió tres veces el 2-sep; por eso las ramas
  `impl/*` se empujaron a GitHub como respaldo y la integración se hizo desde un clon limpio.

## 🧪 BACKTESTS DE MEJORAS POR FAMILIA (2-sep, noche) — la respuesta a "mejorar, no cerrar"
Informe: **`docs/BACKTESTS_FAMILIAS_2026-09-02.md`** (tabla ejecutiva en §2, orden de trabajo en §9). Cinco
backtesters + cinco escépticos independientes; todo reproducido; nada aplicado en producción. Lo que sobrevive:
- **Tenis ATP**: edad lineal en el ensamble (skill 10,12→10,62 %, t 5,8, estable 9 años) y días-sin-jugar +
  partidos-en-7-días (t 3,0; exige fecha real de partido). Distribución de juegos C6 (punto + residuo
  empírico) **solo en ATP bo3** (Brier O/U t 9,9); en bo5 y WTA NO demostrada. El +18 % del libro TOTAL cae al
  contar eventos (43, t 0,72). WTA: edad y fatiga rechazadas.
- **Valorant**: bisección de pRound en vez de `×0,44` (hándicap −0,015, SE 0,0055, n=128; con ella 0 de las 80
  under nacen) + anclar la p de mapa al mercado (favorito de producción 45 %, implícita 55,7 %). Blend c=−0,20.
- **Combate**: el modelo ACTUAL bate al Elo puro (t −8,2/−6,4) y está calibrado; ningún rasgo nuevo pasa (la
  edad por tramos EMPEORA t +2,4). Único corte robusto del libro: comprar perro del mercado CLV −8,6 vs
  favorito +3,3 (diff t 4,0) → preregistrar "FIGHT solo si el lado es favorito del mercado". Techo 3 es 100 %
  en muestra. w=0,8 y veto por deriva: rechazados. Orden f1/f2 de ESPN tiene fuga: nunca usarlo.
- **Fútbol**: blend c=−0,14 (el Elo no informa el 1X2); "excluir copas" CAE (regex contaba Championship y
  omitía Coppa Italia: t −1,3, no −3,8) pero el mecanismo sí (pools fusionados sin recalibrar); GOALS calibrado
  (problema de precio, CLV −1,3 t −4,1); córners ≥2 casas inconcluso-favorable (+12 % t 2,0; Liga MX es el
  60 %; `books` es el refrescado ≤2 h). De-vig Shin/potencia pendiente del vector 1X2 del odds-archive.
- **Baloncesto**: histograma OK como código, no como rentabilidad; β≈0 en las dos ligas; **el CLV está mal
  medido** (−3,2 de los −4,6 puntos son vig: cierre sin margen vs cuota con margen) → corregir
  `settleHoopsPicks`; 79 picks = 15 tesis; la capa de plantilla de producción nunca se backtesteó (no hay
  bajas histórico). Descanso diferencial → over WNBA a preregistro (p 0,11).
- Preregistro escrito: `docs/PREREGISTRO_WNBA_TOTALES.md` (60 totales desde el 17-sep, vara CLV).
- Cómo cotizan casas y sharps (60 fuentes): `docs/MERCADO_COMO_COTIZAN_2026-09-02.md`.
- Scripts y resultados chicos: `research/backtests-2026-09-02/`.
- **Intocables confirmados:** `cards_under_v1`, `cs2_rounds_v1`, `lol_kills_hcp_v1`.

## 🔬 AUTOPSIA DE LOS MODELOS (2-sep, tarde) — léelo antes de tocar cualquier familia
Informe completo: **`docs/AUTOPSIA_MODELOS_2026-09-02.md`**. Lo esencial:
- **Tres liquidadores mentían y se arreglaron y re-liquidaron en producción**: tenis (268 picks con 0-0: el
  +44 % de ROI era artefacto → +7,3 % real, CLV −12,5 %), esports (kills sin voltear: 85 de 245 picks de LoL
  cambiaron de veredicto; KILLS_HANDICAP pasa de +14,7 u a +4,7 u; Dota re-liquidado), baloncesto (totales en
  cubos de 5 regalaban ~5 pp de over en líneas x4,5: los 31 totales del monitor WNBA salían de ahí).
- **El Brier del modelo pierde contra el mercado en TODAS las familias con dato.** El peso que merece el
  modelo (regresión `c` sobre logit(p_gp)−logit(p_mkt)) es ≤0 en LoL, GOALS, CS2 RONDAS, Valorant, CORNERS;
  ≈0,2-0,4 en SOLID, CS2 RONDAS_HANDICAP, tenis ML/SPREAD, FIGHT; >1 solo en **CARDS (1,41, t 2,8)**, **tenis
  TOTAL (6,0, t 2,8)** y WNBA SPREAD crudo (1,5). Publicamos `p_gp` tal cual en fútbol, esports y tenis.
- **Donde ganamos, ganamos por precio y momento, no por modelo**: CS2 = Pinnacle cotizando solo, línea joven,
  lado perro (+15,6 %, CLV +1,7 t 4,4; RONDAS_HANDICAP conserva +5,7 % al cierre); cards under = cierre
  ineficiente con sesgo público al over (+11 % con CLV −0,5).
- Fórmula operativa propuesta: `p* = σ(logit(p_mkt_sin_margen) + c·[logit(p_gp) − logit(p_mkt)])`, `c` por
  familia fuera de muestra, c=0 donde t<1; familias con c≤0 pasan a "familia de precio" (desviación de una
  casa frente al consenso). Decisiones pendientes de Alexis en §7 del informe. **No se cambió ninguna regla
  de apuesta**: solo medición.
- Nuevo: `?limit=` en `/api/esports/track` y `/api/tennis/track`; `POST /api/internal/tennis?run=resettle`;
  `POST /api/esports/settle?game=X&resettle=kills`; Leaguepedia por CargoExport; OpenDota paginado.

## 🎮 LoL — CERRADO EL 2-SEP (Fases 1, 3, 4 y 7 del blueprint, con datos de verdad)
**Lo que cambió la ecuación:** `Special:CargoExport` de Leaguepedia es la misma consulta Cargo por otra puerta,
acepta **5.000 filas por llamada** (api.php capa a 500 a los anónimos) y desde el sandbox no tiene el cubo de
~10 minutos que tenía a Render a 2 páginas por pasada de 2,5 h. La cosecha entera que llevaba desde el 18-ago
sin converger terminó en **113 llamadas, ~4 minutos** (`node scripts/lol-harvest.js --export`).

| tabla | filas | ventana | id |
|---|---|---|---|
| games.json | **97.588** partidas | 2020-01-03 → 2026-09-01 | GameId Leaguepedia |
| players.json | **535.478** filas de scoreboard | 2023-01-06 → 2026-09-01 | GameId·Link |
| drafts.json | 33.185 drafts con orden | 2024-01-01 → 2026-08-31 | GameId |

- **Fase 3 con linaje propio, cerrada.** `lol-validate.js --dir=<crudo>` sobre la base propia elige LAS MISMAS
  constantes que el espejo (K=32, patchDecay=1, sideStep=1). Ventana intacta 120 d (n=4.372): gp **11,76 %** de
  skill vs elo 11,31 % vs lado 0,88 % (ECE 0,016); lado azul **+24,5 Elo** (52,8 % azul). Espejo: 12,75/12,56/
  0,67 y +20,4. Distinta numeración, distinta ventana, misma conclusión ⇒ el rating no depende de quién numeró.
  `priors.json` lleva ahora las constantes de la base propia.
- **La base que viaja en el repo es la propia** (`games.json.gz` 4,6 MB, `drafts.json.gz`): kills/objetivos
  nativos (adiós al backfill del espejo), llega a AYER y sus ids casan con players y drafts. El espejo de
  HuggingFace queda fuera.
- **Fases 4 y 7 encendidas** (verificado en local con la base nueva): `player-stats.json` **2.883 jugadores**
  con rating GP por rol (≥8 partidas en 365 d), `champions.json` 18.695 filas parche×rol×campeón + bans;
  Ranking GP (BLG #1, Elo 1.914), ficha de equipo con roster de cinco resuelto (T1: Doran/Oner/Faker/Peyz/Keria
  con rating), ficha de jugador (Faker: 201 partidas, pool con recencia), **Draft Room V1 resuelto en los dos
  lados** (HLE–T1: fragilidad 16,4 % vs 19 %). El crudo de jugadores (145 MB) NO viaja en el repo.
- **El archivo del crudo es `/data/lol-raw` en Render.** `PUT /api/internal/lolraw?key=&file=` (gzip por
  firma; **rechaza si trae menos filas que el disco**). La cadena `lolHarvestJob` queda en modo `--export`
  pero **apagada** (`GP_LOL_HARVEST=0`): con 145 MB de players el hijo de 220 MB moría y en Render no aporta.
- **Refresco (chore mensual, ~5 min, desde una sesión):** bajar `lolraw?file=players.json|games.json|drafts.json`
  a un dir → `GP_LOL_DIR=<dir> node scripts/lol-harvest.js --export --force --sleep=1000` (reanuda desde el
  cursor de cada tabla) → `node scripts/lol-aggregate.js --raw-dir=<dir> --base` → commit de
  `data/esports/lol/*` → subir el crudo con PUT. Mastery y forma son features de 365 d: sin refresco se apagan
  solas en un año, no antes.
- No entró nada de Oracle's Elixir (cuota de Drive agotada; la copia al Drive de Alexis no es descargable por
  la vía disponible y se tiró a la papelera). `RIGHTS.md` tiene el asiento.

## 🏈 CFL — LAS CARAS DE LOS 9 CLUBES, CERRADO (2-sep)
El `/api/tunnel` que parecía la puerta del CMS nuevo era solo el túnel de Sentry. La plantilla real viaja en un
**iframe de `stats.prod.s.cfl.ca/modules/club-roster?team_id=N`** que llega renderizado en servidor con la tabla
entera y el headshot en `content.cfl.ca/headshots/<id>-headshot.png`. `cfl-rosters.js` detecta el team_id en
la página del club (sin lista fija) y lee ese módulo antes de caer a Wikipedia. Resultado: **666 jugadores,
620 con cara** (antes 258; los 8 clubes ya migrados entraron por el módulo, Montreal conserva su cosecha de
club). Los PNG de 150 KB se reescalan a 240 px JPG con `scripts/cfl-headshots-resize.js` (Chromium del
sandbox; Node puro no tiene resizer) — `public/logos/amfoot/cfl` pesa 7 MB.
- **Aviso operativo de esta sesión:** el checkout local del sandbox apareció REVERTIDO a un commit del 24-ago a
  mitad de sesión (HEAD y archivos, sin rastro en el reflog). Los cambios se rehicieron sobre un worktree
  limpio de `origin/main` antes de commitear. Si pasa otra vez: `git fetch` + worktree nuevo, nunca commitear
  desde un árbol cuyo HEAD no coincide con `origin/main`.

---

# HANDOFF — estado al 1-sep-2026, noche (sesión de continuación: liquidación real auditada y corregida)

## 🧳 PUNTO DE RETOMA (1-sep, 22:00Z) — léelo primero
- Código: `main` == `claude/gpsim-continuation-92ctkh`. Deploys de esta sesión: `07770f0` y `275d2b1`
  (liquidación real) en vivo; `a248dee` (fetch resiliente en app.js) + cosecha LoL games-primero + estos
  docs van en el deploy que cierra la sesión. Health 200. Llaves: mismo archivo de Drive (nada rotó).
- Rutinas vivas en Claude Code Remote: solo queda `trig_012Ai9w8HHmxRXL9GneDcAzv` (roster timeline CS2,
  7-sep 14:00Z, sesión nueva). Las de auditoría del relay y check-in LoL ya no existen (se auditó a mano).

## 💸 A. PRIMERA LIQUIDACIÓN REAL POR EL BRAZO — auditada, con bug de dinero cazado y corregido
Las 5 apuestas del 1-sep colocadas por el brazo (Championship, tarjetas under) se resolvieron todas:
| Partido | Apuesta | Casa | P&L |
|---|---|---|---|
| Preston–Bristol | u4.5 · $29 @1.53 | WIN | +15,37 |
| Lincoln–Blackburn | u4.5 · $20,20 @1.36 | LOSS | −20,20 |
| Birmingham–Southampton | u3.5 · $29,87 @2.45 | LOSS | −29,87 |
| West Ham–Wolves | u4.5 · $29,87 @1.42 | WIN | +12,55 |
| Portsmouth–Derby | u4.5 · $29,87 @1.53 | WIN | +15,83 |
**3-2, −6,32 USDT.** Saldo Cloudbet tras liquidar: **324,87 USDT** (Alexis depositó: el saldo era 6,74).
- **El bug:** el RESULTADO lo leyó bien (estado de la casa), pero el DINERO no: `returnAmount` es el
  resultado **NETO** (+15,37 en la ganada; −20,20 en la perdida — un bruto nunca es negativo) y
  `liquidar` le restaba el stake otra vez: la primera ganada real quedó anotada como −13,63 y la perdida
  como −40,40. Medido con la sonda nueva `run=cb_estado&ref=`: la respuesta vino por **GraphQL**
  (`_fuente`), no por el REST del brazo (la ruta de estado REST sigue sin confirmar). La auditoría
  local asumía bruto (57 para 30 @1.9) porque nunca se había liquidado nada por API.
- **La corrección (desplegada):** el P&L sale de la aritmética estado × precio real × stake; el importe de
  la casa es CONTRASTE (`importe_casa_semantica`: neto|bruto; si no cuadra → `discrepancia_importe` y
  cuenta como descuadre). `run=reliquidar&ref=` corrige el dinero de una liquidada por la diferencia
  (realizado, nocional y día). Se reliquidaron las 4 mal anotadas (2 con el código viejo antes del deploy).
  Libro: realizado −14,98 · nocional 1.985,02 · 43 liquidadas 20-23 · ROI −1,79 % · 0 descuadres.
- Auditoría local: escenario 16b (importe neto, reliquidar, importe raro) y la expectativa CS2 puesta al
  stake plano de 5 (fallaba desde la doctrina del 1-sep). `node real-executor/auditoria.js` → verde.
- Quedan 41 abiertas ($981 de exposición): 3 relay (Toulouse–Lille ×2, Burnley–Boro) + las de canal
  manual del 31-ago (Alexis) que liquidan con nuestro resultado + 2 CS2 solo_manual.

## 🎯 A2. EL CANAL CS2 AUTOMÁTICO NUNCA COLOCÓ NADA — y era código nuestro, no la casa (1-sep noche)
Alexis preguntó por qué no había ninguna apuesta real de CS2. Las 18 filas CS2 del libro desde el 30-ago
acabaron `CADUCADA · linea_no_cotizada_ahora` (hasta 46 intentos en una fila). Dos causas, medidas contra un
evento vivo de la casa (Galorys v Imperial, id 36139040) con la llave de trading desde el sandbox:
1. **La clave del mercado está versionada:** hoy es `counter_strike.map_round_handicap.v2` y el casador
   exigía que terminara en `map_round_handicap` → cero selecciones, siempre. La auditoría local usaba un
   fixture inventado (`counter-strike.map_round_handicap`, líneas por selección) y por eso estaba en verde.
2. **La casa reordena local/visitante en esports:** la pick nació "Imperial vs Galorys" (Imperial local) y a
   la hora del partido Cloudbet listaba "Galorys v Imperial". Casar por `side` habría apostado al RIVAL con
   el hándicap invertido. Ahora el lado se resuelve por NOMBRE del equipo contra `home.name`/`away.name`
   del evento crudo; la línea pasa de la perspectiva del local de la señal a la del local de la casa
   (`handicap=X` es la línea del LOCAL y la comparten ambos lados). Sin resolución inequívoca no se coloca
   (`equipo_no_resuelto_en_la_casa`), y la fila guarda `ensayo_casa` (nombres + claves de mercado) para
   auditar el siguiente fallo sin adivinar.
Fixture de la auditoría reescrito al formato real + caso de lados invertidos. Verificado contra el evento vivo:
"Imperial −5,5 · mapa 1" → `away · handicap 5.5 · @2.20`. Efecto esperado: las próximas señales de
cs2_rounds_v1 con mejor cuota en Cloudbet se colocan solas a $5 por el brazo.

## 📅 B. REVISIÓN DEL LUNES (leída el 1-sep noche)
- **Sombra de la casa**: banco 4.393 (+2.393 desde 2.000), 272 liquidadas 154-114, ROI 21,1 %, CLV exec
  +0,64 %. Por segmento: cards_under_v1 130 liq., 91-39, **+41,8 %**, CLV +0,7 (7d: 52 liq., +37,5 %) ·
  cs2_rounds_v1 136 liq., 60-72, +7,4 %, CLV +0,68 · corners_over_v1 6 liq., −13,7 % (casi nada ejecutable:
  87 de 103 sin casa conectable) · **lol_kills_hcp_v1: 17 apostadas (LES, Prime League, LFL del 1-sep),
  0 liquidadas** — Leaguepedia tarda ~1 día en cargar los scoreboards; el track de LoL liquidó ayer a las
  11:44Z con normalidad. Primera lectura real la semana que viene.
- **modelo_sombra (hipótesis de Alexis, modelo vs retail de PM en ganador): 0 señales en 1,5 días.** El
  listón es edge 6-15 pp del modelo contra el precio de PM en SERIE; ninguna serie lo cruzó. No es un
  fallo: es que el modelo y el retail de PM están más cerca que 6 pp. Si en 2 semanas sigue en 0, bajar
  el listón a 4 pp SOLO en sombra.
- **Prop firm FP-796307 (cierra 30-sep)**: 41 señales, 10 cerradas **6-4, +512 USD en papel** (todo CS2:
  Imperial–ShindeN, VP–WBT, UNiTY–Misa), 31 abiertas (20 fútbol, 2 LoL, 9 CS2). Ninguna marcada con
  `run=anotar` (precio/costo real) → no sé cuáles colocó Alexis en la firm ni el saldo de la cuenta.
  **Ojo con la lectura:** 6 de las 10 cerradas son LOS DOS LADOS del mismo mapa (UNiTY–Misa m1 y m2,
  Imperial–ShindeN m2): con $95 por pierna eso no son dos tesis, es una posición neta al lado barato
  (si gana el favorito pierde ~14; si gana el perro gana ~100). El escáner las emite como dos señales y la
  sombra las cuenta como dos. Decisión pendiente de Alexis: (a) una sola pierna por mercado (el lado con
  más edge) o (b) dejarlo y leerlo como "posición neta". La disciplina del correo ya dice "una tesis".
- **Sombra Polymarket**: 29 abiertas, $794 expuestos, slippage medio +1,31 pp, 1 sin fill, 0 cerradas.

## 🎮 C. LoL — dónde está de verdad la Fase 3
- **El walk-forward YA CORRE** (`scripts/lol-validate.js`, 5 s) sobre el espejo de HuggingFace que vive en
  el repo (`games.json.gz`, 84.586 partidas 2021-01 → 2026-08-16, kills/objetivos rellenados por
  `lol-kills-backfill`, t1 = lado azul): ventana intacta 120 d → gp skill 12,75 % vs elo 12,56 % vs lado
  0,67 % (ECE 0,015). `priors.json` ya tiene esas constantes (K=32, azul +20,4 Elo). Se re-ejecutó hoy y
  dio lo mismo (determinista; no se commiteó el cambio de fecha).
- **Lo que espera a la cosecha propia de Leaguepedia** (`/data/lol-raw` en Render): las tablas se cruzan
  por GameId de Leaguepedia, y el espejo renumera (1..N) → **players.json (mastery, comps, Fase 4) solo
  casa con la games.json PROPIA**. Cursores al cierre: games 2022-11-06 (43.410), players 2023-03-10
  (37.710), drafts **completa** (33.185, done). La cosecha en Render corre (`running: lol_harvest` en
  `/api/internal/ops`), pero cada deploy la mata (se rearma a los 6 min) y Fandom da ~14 páginas por
  ventana; el sandbox de esta sesión está limitado (429).
- **Cambio de esta sesión:** el orden de la cosecha pasa a **games → players → drafts** entre incompletas
  (antes "la de menos filas primero" mandaba players, 700+ páginas, por delante de games). Cuando games
  cruce 2024: bajar por `lolraw?file=games.json`, correr `lol-validate.js --json` sobre la base propia y
  comparar con el espejo (mismas constantes ⇒ Fase 3 cerrada con linaje propio).
- Fases 4 y 7 (`lol-data.js`: championsBoard/draftIntel/mastery; Draft Room V1) están desplegadas desde el
  18-ago y degradan honestas sin players.json → se encienden solas al re-agregar (`lol-aggregate.js`).

## 🌐 D. FETCH RESILIENTE EN LA UI PÚBLICA — hecho
`public/app.js` lleva la misma sombra de `fetch` que premium.js (declaración léxica del script; index.html
solo carga ui-kit.js + app.js). QA `scripts/qa/app-robust.mjs` (ESM ignora NODE_PATH: correr desde un dir
con symlink `node_modules -> $(npm root -g)`): 2×502 → arranca; 502 fijo → 5 intentos en ~11 s; POST → 1.

## 🔑 E. API_FOOTBALL_KEY — bloqueado en Alexis
Hace falta una key NUEVA generada en el dashboard de API-Football (cuenta de Alexis). Con ella:
`PUT https://api.render.com/v1/services/srv-d8krl8flk1mc73c9hbi0/env-vars/API_FOOTBALL_KEY` (body
`{"value":"..."}`) + deploy. Sin key nueva no hay nada que rotar.

## 📌 Externos que dependen de Alexis (recordatorio, no se tocaron)
Historial REST de Klaus (Cloudbet) · KYC Cloudbet/Pinnacle · demo Maven (¿lista CS2/LoL por mapa?) · Whop
`unmatched_plan: 1` · anotar en la prop firm lo colocado (`run=anotar&id=&precio=&costo=`).

---

# HANDOFF — estado al 1-sep-2026 (cierre de la sesión larga: todo guardado, retoma en sesión nueva)

> La sección anterior (21-ago) sigue abajo, intacta. Esto cubre del 24 de agosto al 1 de septiembre.

## 🧳 PUNTO DE RETOMA (1-sep, 21:00Z) — léelo primero en la sesión nueva
**Dónde están las cosas.**
- Código: `main` == `claude/gpsim-continuation-vrjuww` (todo empujado; último deploy en vivo = commit "Premium:
  carga resiliente"). Health 200. Producto = **GP Simulador** (nunca GP Edge/Markets/EDGE Terminal).
- **Llaves de sesión** (admin token, export key, Render API key, token QA free, Hetzner, relay, JWTs de
  Cloudbet): en el **Google Drive de Alexis**, archivo `GP Simulador — llaves de sesión (privado)`. Leerlo con
  el conector de Drive al arrancar, volcarlo a `scratchpad/key.env` (+ `cbk.txt`/`cbk2.txt`) y NO imprimirlo
  ni versionarlo. Las llaves de PRODUCCIÓN (Anthropic, Resend, Groq, Gemini, Odds API, API-Football…) viven en
  las env vars de Render: `GET api.render.com/v1/services/srv-d8krl8flk1mc73c9hbi0/env-vars` con la Render key.
  Mejora pendiente (lado Alexis): meterlas como variables del *environment* de Claude Code (Settings del
  entorno en claude.ai/code) para que ninguna sesión tenga que buscarlas.
- **Cosecha LoL (Leaguepedia):** la copia local se SUBIÓ a Render antes de cerrar (`/api/internal/lolraw`
  POST): games 43.410 filas (cursor 2022-11-06), players 37.710 (cursor 2023-03-10), drafts 33.185 (cursor
  2026-08-31, casi completa). Render sigue cosechando solo desde ahí. Fandom ratelimita (14 req/ventana);
  el harvest local hacía enfriamientos de 3 h. Estado: `/api/internal/lolraw?key=$KEXP`.
- **Blueprint LoL** (el .docx de Alexis) quedó como texto en `docs/LOL_BLUEPRINT.md`.
- **QA Playwright** de la carga resiliente: `scripts/qa/premium-robust.mjs` (Chromium en
  `/opt/pw-browsers/chromium-1194/...`; login local = `POST /api/auth/request` → `demoCode` → `/api/auth/verify`).

**Rutinas/triggers vivos** (Claude Code Remote): auditoría de liquidación de las 5 apuestas relay de
Cloudbet (22:28Z) y check-in de la cosecha LoL (22:44Z, re-armar ~5 h). Al abrir sesión nueva, listarlos
(`list_triggers`) y decidir si siguen o se borran — los que apuntan a esta sesión ya no tienen contexto.

**Doctrina congelada (no re-discutir):** canal CS2 de Cloudbet solo señales cloudbet-best-book ("deja todo
como está"); `GP_REAL_MIN_BALANCE`=5; nada de ETH; el segmento `cards_under_v1` no se toca hasta la
revisión acordada; las cuatro correcciones del 23-ago están en TODO_NEXT.md.

**Pendiente inmediato:** (1) revisión del lunes — lol_kills, modelo_sombra, prop firm FP-796307 (cierra
30-sep); (2) LoL Fase 3 walk-forward cuando la base de games cruce 2024; Fases 4+7 (lol-data.js, Draft Room
V1); (3) opcional: misma sombra de `fetch` resiliente para `public/app.js` (UI pública); (4) rotar
`API_FOOTBALL_KEY`; (5) externos: Klaus REST history, KYC Cloudbet/Pinnacle, Maven demo, Whop
`unmatched_plan: 1`.

## 🔁 LA CAPA PREMIUM YA NO PIDE RECARGAR (1-sep, "me molesta la falta de naturalidad")
Alexis entró a un partido **en vivo** y vio "Couldn't load this match analysis"; recargando varias veces cargó.
Dos causas en `public/premium.js`, ambas de diseño: (1) cada una de las ~110 llamadas hacía **un** fetch y, si
fallaba —un 502 en pleno deploy, un timeout de proveedor, un parpadeo de red—, cacheaba el fallo `{_empty:true}`
hasta recargar; (2) el caché usa `null` como "en vuelo", y cualquier repintado durante la carga (el tick de vivo
cada 25 s, el SSE, el callback de `/api/clubs/value`) leía `!m` como fallo y pintaba el error mientras la
respuesta todavía venía en camino. Lo que hay ahora:
- **`fetch` sombra** al principio del IIFE: GET/HEAD a `/api` llevan timeout de 60 s por intento y hasta 4
  reintentos (0.6 → 1.5 → 3 → 6 s) ante error de red, 502/503/504, 429 o 408. Un **500** se reintenta UNA vez
  (suele ser un bug determinista; no vale multiplicar carga). POST nunca; 401/403/404 vuelven al instante.
- **Tres estados explícitos** (`ldState`): `undefined`=pedir, `null`=en vuelo → `mvHold` (mantiene el spinner,
  nunca error), `{_empty,_at,_n}`=fallo (`miss(k)`) que **caduca a los 10 s** y se vuelve a pedir hasta 3 veces.
- **`mvFail`**: panel de error con botón **Reintentar** (resetea el contador) + un auto-reintento a los 6 s
  mientras quede cupo. Convertidos: partido (beta/fx/teams/clubes), jugador de club, equipo, cockpit, h2h,
  alineaciones, registro, temporada de club. Los fetches "de adorno" (picks del día, xG, intel, estilo…) siguen
  cayendo a panel-ausente, pero ahora con reintentos.
- Verificado con Playwright local (`scratchpad/robust.mjs`): 2×502 → carga transparente sin panel; 502 siempre →
  panel + Reintentar tras 5 intentos; click → carga. Cero errores JS de página.
- Queda opcional: la misma sombra para los 4 fetches `ok ? json : null` de `public/app.js` (UI pública).

## 💰 LA PROP FIRM ES EL CANAL REAL NUEVO
Alexis compró el **Elite 10K de FundingPredicts** (FP-796307, cierra 30-sep: target $1.200, DD estático
$500, tope diario $300, una fase). La casa lo institucionalizó entero:
- `propfirm/scan.js`: escáner consenso-vs-Polymarket (doctrina `edge` de clubes, +6,7% ROI) en CINCO
  frentes — CS2, LoL, fútbol (binarios Yes/No de gamma), NFL y NCAAF (moneyline). Gamma tiene trampas
  documentadas en el archivo: `/events?search=` IGNORA el parámetro (descubrimiento por `/public-search`),
  el ganador de serie lleva el título del evento como `question`, y la línea firmada se lee del "(±x)" con
  equipo nombrado — sin eso liquidar adivinaría favoritos.
- Filtros: edge 4-12pp (techo de cordura: cazó una trampa real de 19,7pp en libro vacío), precio 15-84¢,
  liquidez ≥$500, consenso ≥2 casas sharp. Stake **$95** (env `GP_PROPFIRM_RIESGO_USD` — el margen para
  fees fue idea de Alexis y quedó institucionalizado).
- Correos de órdenes manuales con bloque de disciplina y marca `_variante` (variantes del mismo cruce =
  UNA tesis, no tres). Los avisos de Cloudbet se pueden silenciar con `GP_REAL_AVISO_MANUAL=false`
  (hoy: **true**, reactivados por orden).
- Sombra propia en `/data/propfirm/senales.json` + clase `modelo_sombra` (hipótesis de Alexis: modelo vs
  retail de PM en el ganador; lectura en 2-3 semanas). Probe: `/api/internal/propfirm?key=`.
- Primer ciclo real: 3 posiciones ex-RUSTEC colocadas; liquidación automática vía bo3.gg.
- **Proyección** (Monte Carlo, edge 4pp, 3 señales/día, stake $150): 47% de pasar, mediana 13 días.
  Investigación de alternativas: **Maven Predictions Elite 10K** es la única que mejora las reglas
  (9% target, SIN tope diario, 5% estático → 60% de pasar) pero es feed simulado (MatchTrade) y split
  70/30 — **pendiente**: verificar en su demo si listan CS2/LoL por mapa antes de pagar ~$126.
- Cloudbet: la key "nueva" que mandó Alexis resultó ser **tier affiliate de otra cuenta** — solo feed de
  cuotas, sin cuenta detrás (balance 401). La de trading sigue siendo la única válida. El bloqueo de
  lecturas `/pub/v3/bets/*` sigue (403 Cloudflare con key válida incluida); Monika (Cloudbet) empujó el
  hilo internamente el 31-ago.

## 🌍 CLOUDBET HABILITÓ LA API — Y EL BLOQUEO RESULTÓ SER GEOGRÁFICO (1-sep)
Klaus (Cloudbet) habilitó el acceso de trading a la cuenta GPsimulador: pide NO usar GraphQL (hoy el
ejecutor coloca por ahí), usar los endpoints REST oficiales, ojo con la "geo restriction", y completar
KYC vía CS (pendiente de Alexis). Se midió TODO antes de responderle:
- Cuenta y saldo desde Render: OK ($65.61 USDT). `POST /pub/v3/bets/place` desde Render Oregón: 403 de
  Cloudflare, Ray ID `a3426a27a861d74d-PDX`.
- **Mapa por país** (sondas globalping, GET sin llave — 403 HTML = bloqueado, 401 JSON = abierto):
  ❌ EE.UU., Alemania, Países Bajos, Reino Unido, Singapur → **las 5 regiones de Render, todas
  bloqueadas** (el plan "relay en Frankfurt" murió ANTES de pagarlo).
  ✅ Brasil, Argentina, México, Chile, Colombia, Canadá, Finlandia — y desde IPs de datacenter
  (Oracle, Hetzner, EdgeUno): no hay bloqueo por ASN de hosting.
- Nunca fue la llave: es la geografía del servidor. GraphQL colaba porque ese host no está tras la
  misma regla — y ahora está prohibido por la casa.
- **El brazo (DESPLEGADO Y PROBADO, 1-sep)**: `relay/cb-relay.js` (sin deps, TLS autofirmado, llave
  propia GP_RELAY_KEY, /diag + /cb reenvío crudo allowlist /pub/) corre en **Hetzner Helsinki**
  (`95.216.171.66:8443`, CX23 €6.49/mes — cx22 ya no existe; cuenta de Alexis, token en el
  scratchpad como HZK). Cloud-init autosuficiente (nodejs + cert + systemd). **VEREDICTO desde
  Finlandia**: cuenta/saldo 200 ($65.61 USDT) y `POST /pub/v3/bets/place` con orden inválida →
  **400 `MALFORMED_REQUEST` en JSON = el motor de apuestas contesta** (antes 403 Cloudflare). El
  camino Render→Helsinki→Cloudbet está probado de punta a punta con la llave real. El historial
  (`GET /pub/v3|v4/bets/history`) da 404 "no matching operation": la ruta exacta es otra —
  pendiente encontrarla en la doc.
- **Cómo se verifica**: `/api/internal/relay?key=$GP_EXPORT_KEY` (Render llama al /diag del brazo;
  el sandbox no alcanza IP:8443 — su proxy corta puertos no estándar, otra mordida documentada).
  Env del servicio principal: `CLOUDBET_RELAY_URL`, `GP_RELAY_KEY`.
- **EL EJECUTOR YA COLOCA POR EL BRAZO** (1-sep, misma mañana): `placeBet` sale primero por REST vía
  relay (`via: relay-rest`); `betByReference` intenta la ruta REST de estado y cae a GraphQL de LECTURA
  mientras la casa confirma la ruta del historial. `run=filas` (libro fila a fila) y `run=colocar_una`
  (una fila con stake fijado por orden humana, mismos frenos) nuevos en `/api/internal/real`.
- **PRIMERA APUESTA REAL POR EL CAMINO NUEVO — ACEPTADA**: Preston vs Bristol City, under 4.5 tarjetas,
  $29 @ 1.53 (cero slippage), `ACCEPTED`, ref `acd5017f-…`, 1-sep 09:09Z, orden de Alexis. El contador
  de rechazos (3×RESTRICTED del 25-ago) se reseteó a mano: la causa era la geografía, ya resuelta.
  Saldo tras colocar: $36.61. ⚠️ `GP_REAL_MIN_BALANCE` bajó de 40 → 5 para poder cumplir la orden —
  preguntar a Alexis si lo restauramos. El brazo definitivo es `gp-cb-relay-hel2` (2.29.18.155); el v1
  se borró. Quedan 6 pendientes más (2 CS2 solo_manual + 4 card-under de la misma noche).
- **EL RÉGIMEN OPERATIVO (1-sep, órdenes de Alexis, "procede con todo")**:
  · Ejecutor 100% automático en Cloudbet — **avisos de apuesta manual APAGADOS** (`GP_REAL_AVISO_MANUAL=false`).
  · **Tarjetas**: la fórmula de siempre (~$29-30, Kelly/4 con topes).
  · **CS2**: stake PLANO de $5 (`GP_REAL_CS2_STAKE=5`) — si la casa permite menos, el máximo disponible;
    jamás más de $5. Motivo: los límites desiguales ($4-5 casi siempre, $30-40 a veces) rompían la
    matemática de la cartera. **`GP_REAL_CS2_AUTO=true`**: el gemelo del 28-ago pasó de ensayo a
    colocación real por el brazo (rearma payload con precio vivo cada pasada, mismos frenos de cartera,
    respeta mínimo de la casa, DUPLICATE_REQUEST = comprometida, baja saldo al colocar).
  · Suelo de saldo $5 (`GP_REAL_MIN_BALANCE=5`) y exposición máxima fuera (1e6) — confirmados por orden.
  · Reporte diario ya existente: plan 08:00Z + parte 23:30Z al admin.
  · Colocadas 1-sep por orden directa: Preston-Bristol u4.5 tarjetas $29 @1.53 y Birmingham-Southampton
    u3.5 $29.87 @2.45, ambas ACCEPTED vía brazo. Lincoln/Portsmouth/West Ham quedaron `sin_fondos`
    (saldo $6.74) — reintentan cada 10 min; con depósito antes de su KO entran solas.
  · **SIGUIENTE FASE (cuando llegue el KYC de Pinnacle)**: modo híbrido — email solo para las de
    Pinnacle (colocación manual de Alexis), Cloudbet enteramente solo.
- **Vigilancia del brazo** (1-sep): el servicio principal hace ping al /health del relay cada 5 min;
  3 fallos seguidos (~15 min) → email 🔴 al admin (qué significa + qué mirar en Hetzner), y ✅ al
  volver. Una alerta por caída. `GP_RELAY_WATCH=false` la apaga.
- **Borrador para Klaus**: CREADO en el Gmail de Alexis como respuesta al hilo (cc Monika+Axel) —
  confirma REST desde región permitida, pregunta la ruta del historial, anuncia KYC. Falta que Alexis
  le dé enviar.
- **RESPUESTA DE KLAUS (1-sep 11:30, la doctrina de la cuenta queda fijada)**:
  1. Ruta REST del historial: lo están mirando, contestan luego → **GraphQL de LECTURA sigue siendo el
     camino tolerado hasta entonces** (el fallback ya cableado se queda).
  2. KYC: proceder con su equipo de CS, sin pack especial de partner — la cuenta es **early access** y
     el proceso KYC/comercial completo está en curso del lado de ellos. **Pendiente de Alexis, YA.**
  3. Límites: los fija su trading team y **se revisan según la ACTIVIDAD de la cuenta**; no los suben a
     petición y NO aprueban segunda cuenta como rodeo. → La estrategia es la que ya corre: volumen
     limpio y constante (tarjetas a fórmula + CS2 a $5) construye el historial que sube los límites.
     Preguntar de frente fue lo correcto: la puerta del multi-cuenta quedó cerrada por escrito ANTES
     de tocarla.
- **PENDIENTE**: KYC vía CS (Alexis); la PRIMERA LIQUIDACIÓN nocturna sobre apuestas del brazo
  (1-sep ~21:00Z) cierra el ciclo; esperar la ruta REST del historial de Klaus.

## 🟣 LA SOMBRA DE POLYMARKET (1-sep, orden de Alexis: "si funciona lo cableamos y le metemos dinero")
`propfirm/polyshadow.js`: banco simulado de $2.000 donde CADA señal operable de la prop firm se coloca
como si fuera por la API real del CLOB — orden límite (el límite de la señal) caminando los asks del
libro real en el momento del aviso — y se liquida con la RESOLUCIÓN del propio Polymarket (outcomePrices
→ 1/0; cubre fútbol/NFL que senales.json no liquida). El escáner captura `clobTokenIds` por señal (con
rescate vía gamma para las viejas). Ledger `poly-sombra.json` en /data/propfirm.
- **Primera pasada real**: 6 posiciones, $509 desplegados, slippage medio +0,43 pp, y la medición
  estrella: una tesis pedía $100 y el libro solo tenía ~$10 bajo el límite (24 shares) — la capacidad
  REAL del venue, medida posición a posición.
- **Tamaño = estructura de Cloudbet, NO la de la firm** (corrección de Alexis, mismo día): Kelly/4 con
  tope del 1,5% del banco VIVO (compone con el P&L), suelo $5, tope duro $45, SIN máximo de exposición
  ni de posiciones — la firm tiene $10.000 y reglas; este banco es de $2.000 y Polymarket no tiene
  ninguna. El ledger se reseteó y renació con estas reglas (6 posiciones, ~$158 desplegados). Envs:
  GP_POLYSOMBRA_BANCO (2000), GP_POLYSOMBRA_STAKE_PCT (1.5), _STAKE_MIN (5), _STAKE_MAX (45);
  `run=poly_reset` (solo a mano) para renacer.
- Revisión: sección propia en el correo del LUNES de la sombra; probe `/api/internal/propfirm` →
  `poly_sombra`.
- Lectura del lunes: las variantes del mismo cruce entran TODAS (ganan/pierden juntas — como en la firm).
- **Si da positivo sostenido → cablear la API real del CLOB** (órdenes firmadas EIP-712, wallet propia,
  sin aprobación de nadie) y meterle dinero real.

## 🔒 EL CIERRE POR TIERS (la semana abierta venció el 31-ago 05:00Z)
Deja de ser todo-o-nada; misma línea que combate v3: **free = inteligencia** (pizarras, fichas, rankings,
en vivo — el escaparate), **pro = accionable** (picks esports, briefs, lecturas, simuladores, registro en
sombra), **sharp = precios entre casas** (value/arb/caídas/middles hoops, props+evidencia esports).
- El recorte es del SERVIDOR (`nsPlanCtx` + strips): a free las picks no le llegan ni en el JSON; viaja
  `picks_locked` (conteo) y el front pinta el candado CON EL CROMO del tablero (revisión de Alexis: la
  pantalla pelada parecía todo bloqueado). Textos por deporte, bilingües.
- Monitor privado de hoops (GET+POSTs) y liquidaciones esports/NFL: **solo admin** — nunca fueron producto.
- Baloncesto tiene pestaña **Picks** pública con la doctrina ("no publicamos picks todavía y es una
  decisión") — sin eso parecía un bug y no un principio. La nota amarilla de taller es solo admin.
- Admin previsualiza con `?asplan=` y los strips se aplican DE VERDAD en la preview.
- QA free hecho a fondo con cuenta real (`alexisgomezico+pruebafree@gmail.com`, viva para QA): matriz de
  endpoints ✓, cero fugas en payloads. **Pendiente**: pase visual PRO/móvil con el asplan de Alexis.
- Landing: los 9 deportes dicen "Abierto".
- **Broadcast del cierre enviado** (31-ago): variant `sportsclosed_{es,en}`, SIN línea de baja (orden),
  963/965 ES; EN programado 22:00Z. Las 6 bajas del correo del 28 quedaron suprimidas ANTES de disparar
  (vía `/api/internal/suppress`; se detectan leyendo el Gmail de Alexis).

## 🎭 EL MUNDIAL-FANTASMA: la sesión tenía dos llaves
Cuenta nueva veía SOLO el Mundial. Reproducido con cuenta de prueba: `getUser` lee el header Bearer, pero
las 19 puertas de clubes (`sessionEmailFromReq`) leían SOLO la cookie — y la cookie la escribía el CLIENTE
(`document.cookie`), que en iOS muere a los 7 días (ITP) o no llega a existir. Arreglo: fallback al Bearer
en `sessionEmailFromReq` (retroactivo, mismo almacén de tokens) + `Set-Cookie` de SERVIDOR en verify y
Google. Afectaba a usuarios reales de iPhone en silencio.

## 🏈 LA CFL TIENE PLANTILLAS Y CARAS (y la liga está migrando su web EN CALIENTE)
ESPN no publica plantillas de la CFL (gap documentado). La fuente real: **las webs de los 9 clubes**
(`scripts/cfl-rosters.js`) + Wikipedia como fallback. 634 jugadores, 258 headshots auto-hospedados
(240px JPG, 2,5MB). Hallazgos que importan:
- `redblacks.com` es un lander aparcado (la web vive en `ottawaredblacks.com`); los Alouettes publican
  en francés (`/alignement/`).
- La CFL está migrando los clubes al CMS nuevo de la liga (Nuxt, renderizado en cliente vía `/api/tunnel`
  opaco): BC/CGY/SSK/HAM cayeron ENTRE dos pasadas del mismo día. Sus fotos quedan pendientes (Wayback
  las tiene pero el proxy de esta sesión bloquea web.archive.org).
- Blindajes: el harvester recuerda la mejor cosecha por equipo; `rosterOf` elige el archivo MÁS RICO
  (jugadores + 2×fotos) entre disco y repo; la CFL salió del job semanal de Render (el repo es la fuente).
- Bug preexistente cazado: la ficha del jugador nunca cruzó con su equipo (`.rows` vs `.teams` + catch
  silencioso).
- El vacío de plantillas habla idioma de cliente; el porqué de taller es solo admin.

## 📡 EL VIVO MULTI-DEPORTE (31-ago, "quiero todo en vivo como en fútbol")
`live-sports.js` (módulo raíz, memo 45-60s por fuente, DISPLAY puro): CFL oficial (cuarto/reloj/posesión),
NCAAF/NFL ESPN (down&distance, última jugada), tenis ESPN atp+wta (sets por linescores, saque), CS2 bo3
(serie + mapa), LoL lolesports (mapas ganados). Cruce por nombres `matchByNames`: exacto primero, laxo
SOLO si el candidato es único (Vitality casó con dos "FUT" en producción el primer minuto).
**Segunda pasada (misma noche) — los paneles RICOS:**
- **CS2**: `with=teams,games` → historial de mapas (nombre + rondas del ganador) + mapa en curso. Las
  rondas del mapa EN CURSO bo3 no las publica (null hasta terminar, comprobado); en eventos menores
  tampoco gradúa los terminados → el chip pinta el mapa sin marcador, jamás lo inventa.
- **LoL**: livestats/window de feed.lolesports → kills, oro, torres, dragones, barones por lado.
  **TRAMPA DOCUMENTADA**: sin `startingTime` el feed devuelve los PRIMEROS frames (parece vivo y es el
  min 0); el parámetro debe ser múltiplo de 10s con final de ventana ≥120s viejo → now−150s.
- **NFL/College**: `espnSummary` (summary?event=) → drive en curso, últimas jugadas, anotaciones,
  marcador por cuartos (`nflLiveDetail` en la ficha).
- **F1**: `f1Live` (ESPN racing scoreboard, defensivo) → sesión en curso + cabeza de pista en el tablero;
  se verifica el próximo fin de semana de carrera con la sonda.
- **Hoops**: `/api/hoops/live` ahora expone `last_plays` (el summary ya estaba en mano por el wallclock).
- **Sonda `/api/internal/espn?key=&path=&qs=`**: iterar formas de ESPN desde prod (el sandbox recibe 403
  de Akamai). Solo lectura, host fijo por construcción.

**Tercera pasada (misma noche) — la investigación de fuentes que pidió Alexis ("no te limites, busca más
fuentes, panel lo más completo posible") y sus VEREDICTOS:**
- ✅ **Polymarket `gamma /events?closed=false&live=true`** — LA joya: TODO lo vivo en una llamada, con
  `score`, `period`, `elapsed` (minuto), tags del deporte y precios en vivo (= probabilidad implícita del
  dinero real). Dos formas de mercado: esports = "Match Winner" con equipos como outcomes; fútbol = trío
  Yes/No por equipo + Draw. `pmLive()` en live-sports.js; `nsPmBlock`/`esPmOnlyLive`/`ES_PM_TAGS` en
  server. Pegado a: esports (4 juegos, ficha+pizarra; si no hay otra fuente el vivo se ENCIENDE solo con
  PM), tenis (board+ficha), NCAAF/NFL fichas, hoops live, y el **cockpit de clubes** (con PM vivo, la
  columna "mercado" del héroe pasa del consenso pre-partido al precio vivo → modelo vivo vs dinero vivo).
- ✅ **bo3.gg cubre 8 disciplinas** (1=cs2, 2=valorant, 3=lol, 4=dota2…): `bo3SeriesLive(disciplineId)`
  generalizado → **Valorant y Dota 2 estrenan vivo** con historial de mapas, misma forma que CS2.
- ✅ **OpenDota `/api/live`** (sin llave): kills, ventaja de oro y minuto de las partidas espectadas; las
  PRO llevan nombre de equipo → overlay del mapa en curso en la serie de Dota (verificado en vivo:
  Team Spirit Academy 11-10 Pipsqueak, oro −2.9k, min 18).
- ✅ **livestats `details`** de lolesports: KDA/CS de los 10 jugadores → mejor fragger por lado en la
  ficha de LoL (204 entre mapas, defensivo).
- ❌ **Cloudbet EN VIVO**: su feed público responde los mercados vivos SUSPENDIDOS (price 0 en los 10
  tenis + 2 LoL vivos probados, también en `/events/{id}`). Solo sirve pre-partido. Descartado.
- ❌ **Kalshi**: precios sí, marcadores no; PM cubre los mismos partidos CON marcador. Descartado v1.
- ❌ **vlrggapi** (Valorant) muerta (402); bo3 lo cubre. ❌ **CFL play-by-play**: no existe JSON público.
- ⏳ **livetiming.formula1.com** (oficial F1) existe y es público pero está Offline fuera de sesión —
  probar en el próximo fin de semana de carrera; ESPN racing queda de base.

## ⭐ SEGUIR CLUBES + ALERTAS DE INICIO/GOL (31-ago, "sí hazlo")
Los favoritos de club viajan como `club:<liga>:<tm_id>` en el MISMO array `favorites` (el endpoint ya
aceptaba cualquier id). Botón Seguir en la ficha de club (hero), fila de club en Seguidos (escudo + liga +
próximo cruce, navegación delegada `data-nav-cteam`), destacado en Evolución. El despacho vive DENTRO de
`clubScoresSync` (transiciones live/goles contra `db.clubResults`, igual que el Mundial) →
`dispatchClubLiveAlerts`: mismas prefs (`matchStart`/`goal`, email, muted), dedup en `db.sentAlerts` con
la clave de club (`liga|a-b:g1-0`) y poda a 3 días. El email reutiliza la pieza del Mundial con la liga
en el asunto. Alertas de valor (pro/sharp, 15min) ya funcionaban; las de inicio/gol eran Mundial-only —
ese era el hueco.

## 🧠 LO DEMÁS DE LA SEMANA (24-31)
- **Frauen-Bundesliga** onboarded por la vía AF (82): 41 ligas sincronizando, gates en sombra.
- **Hoops v2**: gates de la autopsia (edge≥5pp, |spread|<8, total solo under, `regime:hoops_v2`),
  observer de prensa de baloncesto (REST/load management de primera clase). Refit negativo documentado:
  halfLife 45 óptimo, el descanso se difiere a NBA-octubre. WNBA vuelve el **17-sep**.
- **lol_kills_hcp_v1**: cuarto segmento de sombra (regla congelada; CLV plano por libro único — la vara
  son los resultados). Tope de exposición ($400) FUERA por orden (`GP_REAL_MAX_OPEN=1000000`).
- **Esports en inglés**: `S.lang` nunca se asignaba + red de seguridad de traducción (EN_X/EN_FRAG).
  Las etiquetas cortas del panel (Mercado/Diferencia/Peso propio/…) entraron el 31-ago.
- **LoL Fase 1 acelerada**: la cosecha de Leaguepedia corre AHORA en dos frentes — Render (como siempre)
  y la sesión de desarrollo (la salida actual ya no está capada por Fandom). Cursors al 31-ago: drafts
  30-may-2026 (casi lista), players mar-2023, games feb-2022. `/api/internal/lolraw` ahora acepta **POST**
  (subida gzip, solo acepta más filas que el disco) para devolver tablas terminadas. Fase 3 (walk-forward)
  espera la base completa.

## 📌 Sigue pendiente
- Rotar `API_FOOTBALL_KEY` (expuesta en chat — pendiente fijo de CLAUDE.md).
- Pinnacle KYC (lado Alexis) → modo híbrido.
- Fotos de los 5 clubes CFL migrados (tunnel del CMS nuevo, o Wayback desde una red sin bloqueo).
- Maven: verificar catálogo en demo antes de la segunda cuenta.
- Revisión del lunes: primera lectura de lol_kills y modelo_sombra. NFL kickoff 9-sep.

---

# HANDOFF — estado al 21-ago-2026 (tres proveedores de LLM, ocho deportes con voz, la prensa leída en cinco)

## 🔌 EL LLM DEJA DE APAGARSE

`llm.js` pasa de una puerta a tres, con cadena de reserva. Reparto y por qué:

| uso | cadena | razón |
|---|---|---|
| chat | Anthropic → Gemini → Groq | es lo único que ve texto de usuarios reales y lo único con herramientas |
| redactores | **Gemini** → Groq → Anthropic | mejor español, esquema JSON nativo; solo ven factores ya traducidos |
| extractor | **Groq** → Gemini → Anthropic | extracción estructurada, 1,4 s, sin datos de usuario |

Si el primero falla —429, 503, timeout— se prueba el siguiente. Un redactor solo cae a plantilla cuando
fallan **los tres**. Comprobado con la clave de Gemini rota a propósito: Groq contestó en 1,1 s.

Dos cosas estaban atadas a Anthropic sin necesidad: `enabled()` exigía su clave (quitarla apagaba el LLM
entero) y `budgetOk()` frenaba los jobs al llegar al tope diario aunque hubiera proveedores gratis
esperando. El presupuesto ahora **solo raciona lo de pago**.

### Lo que hubo que medir antes de elegir modelo
- **Gemini cuenta el pensamiento dentro del techo de salida**: `gemini-3.6-flash` gastó 1.917 tokens
  pensando y devolvió el JSON truncado. El elegido es `gemini-3.1-flash-lite`, que no piensa. Y
  `thinkingBudget: 0` lo rechaza con 400 — no hay escapatoria.
- **El modo JSON de Groq exige un objeto en la raíz.** El extractor devuelve un array, así que activarlo
  ahí tiraba la llamada al siguiente de la cadena sin motivo.
- `qwen3.6-27b` no sostiene JSON en español; `openai/gpt-oss-120b` sí.

## 🗣️ TENIS, F1 Y COLLEGE/CFL ESTRENAN LECTURA

Tres deportes con motor, pantallas y picks llevaban meses sin una línea escrita — no por olvido, sino
porque cada redactor costaba saldo. Rutas nuevas: `/api/tennis/read`, `/api/f1/read`, `/api/amfoot/read`.
La de F1 se reescribe al cambiar el estado del fin de semana (pre-quali → post-quali cambia la parrilla y
con ella la lectura entera).

**Dos fallos que los dejaban mudos, visibles solo mirando producción:**
1. El tope de la pasada era un contador **único**: esports, que siempre tiene agenda, se lo bebía entero.
   Un tope compartido entre desiguales no reparte. Ahora cada deporte tiene su cuota.
2. La pizarra de tenis devuelve `rows`, no `items` — con la clave equivocada el bucle no entraba nunca.

## 🔎 EL VERIFICADOR DE ALUCINACIONES

Cada lectura la escribe un modelo desde un dossier y hasta hoy **nadie comprobaba** que la prosa no se
inventara números. La instrucción "prohibido inventar datos" iba en todos los prompts y era lo único que
había: una petición, no un control.

**Código primero, modelo después.** Preguntarle a un LLM "¿este número está en el JSON?" es pedirle
exactamente lo que peor hace. El **código** extrae los números del texto y los del dossier y encuentra los
que no casan —eso es aritmética—; el **modelo** solo juzga los sospechosos, que es donde hace falta
criterio ("31-21" no está en el dossier pero se deduce de dos campos que sí). Sin sospechosos no hay
llamada: la mayoría de lecturas se verifican gratis y en un milisegundo. Y verifica **otro proveedor
distinto del que escribió** — un modelo revisando su propio texto tiende a ratificarse.

Escribe → verifica → reescribe una vez con la lista de números señalados → descarta si vuelve a fallar (la
plantilla es mejor que una cifra falsa). Un verificador caído **nunca** bloquea la publicación.
Contadores en `/api/internal/llm` bajo `verificador`. Apagable con `GP_LLM_VERIFY=false`.

## 📰 LA PRENSA, LEÍDA EN CINCO DEPORTES

`observer/deportes.js` + vocabulario por deporte en `llm.js`. Antes solo fútbol y combate; ahora también
**esports, tenis y fútbol americano** (NFL, College y CFL).

**Por qué importa:** los modelos son ciegos a la plantilla *por construcción* —miden lo que un equipo hizo,
no quién va a estar— y eso deja tres huecos que el mercado sí ve y ninguna API publica: el **stand-in** en
esports, la **retirada de cuadro** en tenis y el **quarterback** en fútbol americano. En College y la CFL
no hay parte de lesionados consumible: esto es lo único que hay.

**Display, nunca modelo.** Se pinta con la cita textual y el número de medios que la publicaron, y entra al
dossier del redactor marcada como PRENSA. Ninguna señal toca una probabilidad.

Estado y forzado: `/api/internal/observer?key=` (GET estado, POST `&dom=esports|tennis|amfoot` fuerza
barrido). Barrido cada 3 h por deporte, escalonado. Apagable con `GP_OBS_DEPORTES=false`.

### Lo que hubo que medir (cinco fallos que no se veían leyendo el código)
1. **El tope de salida y el razonamiento.** Estaba fijo en 900 tokens. De 1.056 tokens de respuesta, ~200
   eran el JSON y el resto **razonamiento del modelo**, que cuenta contra el mismo tope. Segunda vez que
   este mecanismo muerde (antes con Gemini). Queda escrito: en modelos que razonan, el tope de salida es
   *respuesta + pensamiento*.
2. **Fallar en silencio.** Devolver `[]` cuando la respuesta no parsea hacía indistinguible "no hay
   señales" de "el proveedor se cayó". Ahora lanza y el parte lo recoge.
3. **Lotes largos pierden recall.** Con 24 titulares devolvía las señales de un sujeto y se dejaba las de
   los otros dos; en trozos de diez los encontraba todos. Se parte en trozos de 10, y un trozo caído ya no
   se lleva por delante los que sí funcionaron.
4. **Una eliminación no es una señal.** "FaZe exits Esports World Cup" salía como retirada del torneo
   cuando lo que pasó es que perdieron. Una señal falsa se lee como un hecho: vale más no darla.
5. **El nombre no es el mismo a los dos lados (tenis).** La pizarra trae el del proveedor de cuotas y el
   detalle el de nuestra base. Guardar por uno y buscar por el otro daba cero señales **siempre y en
   silencio**. Se prueban las dos claves.

Probado contra la prensa real del 21-ago: capta la duda de Mahomes, la lesión de rodilla de Sinner, la
vuelta de Alcaraz tras cuatro meses, el expulsado de TCU y el stand-in de Vitality — y **no** se traga las
eliminaciones de torneo ni las renovaciones de contrato.

## ✅ AUDITORÍA DE LIQUIDACIÓN (21-ago)

`/api/internal/settle?key=` da los nueve deportes de un tirón. La cifra que importa **no es "cuántas
liquidadas" sino `atascadas`**: picks abiertas cuyo partido ya se jugó hace más de 6 h. Cero liquidadas y
cero atascadas es sano (no ha empezado la temporada); 200 liquidadas y 90 atascadas está roto aunque el
total tenga buena pinta.

| deporte | liquidadas | abiertas | atascadas |
|---|---|---|---|
| fútbol (Mundial + clubes) | 96 + 684 | 0 | **0** |
| combate | 79 | 18 | 0 |
| baloncesto | 50 | 15 | **0** |
| tenis ATP / WTA | 19 / 27 | 5 / 1 | **0** |
| NFL · College | 0 | 0 | **0** (temporada sin empezar) |
| CFL | 4 | 14 | **0** |
| F1 | 0 | 69 | **0** (carreras aún no corridas) |
| esports CS2 | 207 | 92 | **85** |
| esports LoL | 77 | 39 | **31** |
| esports Valorant | 0 → **14** | 80 | **60** |
| esports Dota 2 | 31 | 4 | **2** |

**Todo sano menos esports.** Y dentro de esports hay dos problemas distintos que conviene no mezclar.

### Valorant leía un archivo que nadie actualizaba (ARREGLADO)
94 picks y cero liquidadas desde que existe el deporte. No eran los nombres —JD Gaming, TYLOO y All Gamers
aparecen igual a los dos lados— ni las fechas ni la cobertura: **la cosecha escribe en `/data/val-raw` y el
liquidador leía `<disco>/esports/valorant`**. Dos directorios distintos, así que siempre caía a la copia del
repo, congelada el 17-ago, mientras las picks pendientes eran del 19 y el 20.

Lo delató poder ver la fuente **en crudo y por día**: 58 filas que se paran en seco el 17 mientras la
cosecha presume de 33.104 series "al día". Dos cifras que no pueden ser ciertas a la vez.

Ahora se prueban las cuatro rutas posibles y gana **la que traiga la serie más reciente**, no la primera que
exista. Con dos copias en disco la buena es la que está al día; quedarse con la primera es como se llegó
aquí. Además la ventana de emparejamiento se ajusta a la precisión de la fuente: vlr.gg publica el DÍA y
rellena la hora con un mediodía, así que comparar contra ±12 h dejaba fuera todo lo que se juega de
madrugada o a última hora — media agenda en un circuito global.

### Lo que sigue atascado, y por qué (PENDIENTE)
- **~55 de Valorant y 27 de CS2 son `unsettleable`**, no `unmatched`: la serie SÍ se empareja, pero la
  fuente no publica el dato que esa familia necesita (rondas por mapa). Son picks que **no se pueden
  liquidar nunca** con la fuente actual y se acumulan en abiertas para siempre. La pregunta de producto no
  es cómo liquidarlas: es **si deberíamos generarlas**.
- **65 de CS2 y 20 de LoL son `unmatched`** con la fuente cubriendo esas fechas. Descartado que sea nivel de
  torneo: los MISMOS torneos aparecen liquidados y atascados (CCT European Series 2 Qualifier: 36 liquidadas
  y 2 atascadas; LCK Challengers: 23 y 6). Queda como variantes de nombre en equipos de tier bajo —el mismo
  problema que se resolvió en College con una tabla de alias.

## 📊 ESTADO EN VIVO

```
lecturas   esports 32 · hoops 21 · amfoot 9 · tenis 4 · F1 2 · NFL 0
llamadas   56 hoy → Gemini 53 · Groq 3
gasto      $0,4926 — el mismo de antes de encender nada
```

El tope de la pasada sube de 3 a 12 (`GP_LLM_READS_CAP`) y se puede disparar a mano:
`POST /api/internal/llm?key=…&run=reads&cap=20`. La sonda cuenta lecturas por deporte y enseña la última.

**🔑 Pendiente:** las dos claves nuevas circularon por chat — rotar cuando convenga. Están en Render como
`GROQ_API_KEY` y `GEMINI_API_KEY`.

# HANDOFF — estado al 20-ago-2026 (el simulador de rutas, calibrado)

## 🔴 EL HALLAZGO: el simulador sabía y se pasaba de listo por un orden de magnitud

Se simularon **3.886 peleas de 2016 a 2026**, reconstruyendo los perfiles año a año SOLO con el pasado
(`scripts/combat-calibra.js`). Probabilidad de "termina antes del límite" contra lo que pasó:

| decil | predicho | real | sesgo |
|---|---|---|---|
| 1 | 2,4 % | 42,3 % | **−39,9 pp** |
| 5 | 40,6 % | 48,3 % | −7,7 pp |
| 10 | 94,1 % | 61,4 % | **+32,7 pp** |

La escala del simulador va de 2 % a 94 %; la de la realidad, de 42 % a 61 %. **Hay señal** —la tasa real
sube de forma monótona del decil 1 al 10— pero el Brier crudo (0,286) era **peor que decir siempre la tasa
base** (0,250). Una probabilidad informada y mal calibrada rinde menos que no opinar.

Por asaltos: 3 asaltos 43,7 % predicho vs 47,9 % real; **5 asaltos 70,4 % vs 56,9 %**.

## ✅ EL ARREGLO, VALIDADO

Temperatura sobre el logit, `a = 0,0985`, `b = −0,0072`.

- **Walk-forward: Brier 0,28812 → 0,24693 (−14,3 %), mejorando en 9 de 9 años.**
- Extremo a extremo en 2025: 0,28626 → 0,24671, **por primera vez por debajo de la referencia de no
  opinar** (0,24977).

Se aplica **donde vive el error**, no sobre el número publicado: bisección del multiplicador de peligros que
lleva la finalización simulada al objetivo calibrado — mismo truco que `solveTilt` usa para anclar al
ganador. Así método, asalto, duración y tarjetas siguen contando la misma historia.

**Piso de peligro (`PISO = 0,004`).** Multiplicar cero por lo que sea sigue siendo cero: hay cruces cuyos
perfiles no dan poder ni amenaza de sumisión y el simulador les daba 0,0 %. Ninguna pelea real tiene cero.
Con el piso, ningún cruce alcanza el tope del multiplicador y el error medio entre lo simulado y el objetivo
es 0,011 — el ruido de Montecarlo.

**Consecuencia esperada:** las ventajas de RONDAS van a encogerse mucho, porque nacían de comparar un 94 %
inventado contra un mercado en 60. Menos picks y más creíbles es el objetivo. Hay que vigilar el volumen y
el CLV de la familia en la revisión.

## 🐛 Y un fallo propio que salió por el camino

El commit anterior metió el objeto de contexto en el `return` de `core()`, donde esa variable no existe:
`FS.simulate` lanzaba `ReferenceError` en **todas** las llamadas, así que la ficha de pelea y la generación
de picks de combate quedaron rotas desde ese despliegue. El seguimiento seguía respondiendo porque lee de la
base, no del motor, y por eso no cantó. Arreglado en `579c9d1`; salió a la luz al montar el banco de
calibración, que fue lo primero que volvió a llamar al simulador de verdad.

# HANDOFF — estado al 20-ago-2026 (CLV por casa: el mapa completo)

## 📍 EL TABLERO POR CASA (`/api/internal/edge-board?key=` → `por_casa`)

Cada motor publica `by_family_book`. Lo que sale, con ≥8 liquidadas con cierre:

| deporte | familia | casa | ¿API? | n | CLV | sd |
|---|---|---|---|---|---|---|
| cs2 | rondas hándicap | Pinnacle | no | 24 | **+3,10 %** | 5,47 |
| cs2 | rondas hándicap | Bovada | no | 21 | **+2,90 %** | 7,56 |
| cs2 | rondas hándicap | **Cloudbet** | **sí** | 9 | **−3,13 %** | 6,06 |
| cs2 | rondas total | Pinnacle | no | 19 | +1,16 % | 2,00 |
| **combate** | **ROUNDS** | **Cloudbet** | **sí** | **27** | **+1,75 %** | 5,27 |
| combate | METHOD | Cloudbet | sí | 14 | +0,28 % | 14,68 |
| combate | FIGHT | betonline | no | 16 | −3,24 % | 16,71 |
| **fútbol** | **CARDS** | **Pinnacle** | no | **65** | **−0,42 %** | **1,69** (t=−2,02) |
| fútbol | CARDS | Cloudbet | sí | 19 | +0,24 % | 6,03 |
| fútbol | CORNERS | leovegas | no | 107 | +0,07 % | 0,55 |
| fútbol | SOLID | smarkets | no | 32 | +0,89 % | 4,95 |

**Tres conclusiones que corrigen lo que creíamos:**

1. **El hándicap de rondas de CS2 tiene ventaja real y NO es cosa de una sola casa**: +3,10 % en Pinnacle y
   +2,90 % en Bovada, dos libros independientes. En Cloudbet, −3,13 %. El problema es de ejecución, no de
   modelo.
2. **Tarjetas under NO se arregla ejecutando en Pinnacle.** Ahí da −0,42 % con t=−2,02 sobre 65. Es pequeño
   en magnitud pero medible y con el signo equivocado: la familia no tiene ventaja ni en el libro más
   afilado. Eso es un problema de MODELO, no de ejecución.
3. **Córners no tiene nada que medir**: dispersión del CLV de 0 a 1,4 pp en todas las casas. El cierre no se
   mueve, así que ni se confirma ni se descarta.

**Y aparece lo único ejecutable con ventaja: `combate ROUNDS` en Cloudbet, +1,75 % sobre 27.**

## 🥊 EL MODELO DE COMBATE — dónde falla y dónde funciona

| familia | n | CLV | lectura |
|---|---|---|---|
| FIGHT (ganador) | 31 | **−6,35 %** (t=−2,29) | pierde de forma medible |
| ROUNDS | 27 | **+1,75 %** | gana |
| METHOD | 14 | +0,28 % | plano/positivo |

Global: 79 liquidadas, 28-51, acierto 35,4 %, CLV −2,32 %.

**El diagnóstico es de arquitectura, no de calibración.** El modelo de GANADOR es un Elo con features
(edad, años, mentón, racha, kilometraje, envergadura), validado walk-forward: skill 0,0166 y **61 % de
acierto en UFC**. El problema es que el mercado del ganador de UFC es de los más eficientes que existe
—en Kalshi tiene interés abierto mediano de 21.358 contratos y horquilla de **1 céntimo**— y ahí un 61 %
no bate a nadie. Estamos apostando un modelo peor que el mercado contra el mercado.

El de RONDAS/MÉTODO es otra cosa: `fightsim.js` simula rutas con **riesgos competitivos** (KO, sumisión y
llegar al final compiten en el tiempo) sobre vectores de estilo continuos de `style.js`. Es estructura
propia, y compite contra un mercado que pone mucho cuidado en el ganador y mucho menos en las derivadas.
Es el mismo patrón que en fútbol: el 1X2 nos gana y las derivadas no.

**Recomendación:** cerrar FIGHT (t=−2,29 sobre 31 no es mala suerte), concentrar el esfuerzo en ROUNDS y
MÉTODO, y no tocar el Elo — que está bien hecho y sirve como insumo del simulador de rutas aunque no sirva
para apostar el ganador.

# HANDOFF — estado al 20-ago-2026 (la ventaja no está donde podemos ejecutar)

## 🔴 EL HALLAZGO DEL DÍA — el CLV de la familia confirmada, partido por casa

CS2 hándicap de rondas venía leyéndose como "CONFIRMADA, CLV +2,44 %". Partido por casa:

| casa | n | CLV | t | ¿API? |
|---|---|---|---|---|
| **Pinnacle** | 18 | **+3,53 %** | **+2,66** | no |
| Bovada | 17 | +1,34 % | +0,97 | no |
| **Cloudbet** | 9 | **−3,13 %** | −1,55 | **sí** |

**La ventaja vive entera en las casas que NO podemos ejecutar.** El +2,44 % era un promedio dominado por
Pinnacle y Bovada; en la única casa conectable el signo se invierte. Lo mismo en fútbol: las 40 apuestas de
la sombra fueron todas a Cloudbet y su CLV ejecutado es **−1,07 %** (sd 7,17, t=−0,72) pese a un ROI
observado de +35 % — que es varianza, no ventaja.

Mecanismo probable, y hay que verificarlo con más muestra: cuando Cloudbet es el mejor precio de una línea,
suele ser porque las afiladas ya se movieron y él no. Tomamos el precio que queda, no el que dio la señal.

## 📊 PROFUNDIDAD REAL DE CLOUDBET (tope por selección, medido en la fuente, 69 partidos)

| familia | mediana | p25 | máx |
|---|---|---|---|
| tarjetas | $244 | $184 | $1.977 |
| córners | $237 | $222 | $252 |
| doble oportunidad | $341 | $175 | $17.287 |
| empate no válido | $216 | $108 | $17.287 |
| ambos marcan | $226 | $141 | $1.837 |
| hándicap asiático | $218 | $142 | $677 |

La profundidad NO es el cuello de botella hasta $10.000 al 1,5 % ($150/apuesta). A 3 % con $10.000 ($300) sí
muerde. El cuello de botella es el signo del CLV en la casa ejecutable.

## 📈 PROYECCIÓN CON DINERO REAL (275 apuestas ejecutables/mes medidas; CLV ponderado −1,86 %)

| bankroll | stake 1,5 % | volumen/mes | esperado | sd mensual | rango 90 % |
|---|---|---|---|---|---|
| $2.000 | $30 | $8.250 | **−$153** | $487 | −$954 a +$648 |
| $5.000 | $75 | $20.625 | **−$383** | $1.217 | −$2.385 a +$1.619 |
| $10.000 | $150 | $41.250 | **−$766** | $2.434 | −$4.770 a +$3.239 |

Contrafactual: si el hándicap de CS2 se ejecutara al precio de Pinnacle (+3,53 %, 244 señales/mes),
serían **+$258, +$646 y +$1.292 al mes** — 12,9 % mensual sobre el bankroll. Ese es el tamaño del premio y
mide exactamente cuánto cuesta el problema de ejecución.

## 🔎 LO QUE COTIZAN LAS CUATRO CASAS CONECTADAS, MEDIDO

- **Kalshi** — catálogo enorme (3.472 series deportivas) pero la liquidez está concentrada: UFC con OI
  mediano **21.358** y horquilla de **1 céntimo**; EPL ganador OI 632 y 5,5 céntimos; **todo lo demás vacío**
  (NFL partido OI 40 y 21 céntimos; MLS ganador OI 0; córners EPL OI 0). Las familias exóticas existen como
  tickers sin fondo.
- **Polymarket** — sin córners ni tarjetas; su profundidad está en futuros y campeonatos, no en familias de
  partido.
- **Myriad** — solo 1X2 de partido, sin familias.
- **Cloudbet** — la única con familias de partido de verdad, y donde nuestro CLV sale negativo.

# HANDOFF — estado al 20-ago-2026 (cinco familias nuevas encendidas en sombra)

## 🎯 20-ago (noche) — el inventario que estábamos tirando, encendido

Medir Cloudbet dejó a la vista que en los partidos que el colector descartaba la casa cotizaba entre 14 y
25 mercados. **Cinco de ellos los sabe valorar el motor de goles sin medir nada nuevo**, porque salen de la
misma matriz de marcador que ya calcula: doble oportunidad, empate no válido, hándicap asiático de goles,
totales de equipo y ambos-marcan. Encendidas las cinco, en sombra.

**Motor** (`goal-engine/markets.js` + `settlement.js`). La regla que gobierna las tres nuevas: donde el
mercado DEVUELVE (empate en el empate-no-válido, línea entera en el hándicap) la probabilidad que se compara
contra el precio es la CONDICIONAL. Comparar una bruta contra un precio que devuelve le regala al mercado la
masa entera del empate, que en fútbol es una cuarta parte del partido. El hándicap trata sus tres tipos de
línea por separado: media sin devolución, entera con push, y cuarto partido en dos mitades sobre las líneas
vecinas. Comprobado: los pares complementarios suman exactamente 1, hándicap 0 = empate no válido,
−0,5 = ganar, +0,5 = doble oportunidad; y 21 casos de liquidación, cuartos y devoluciones incluidos.

**Ingesta.** La convención del hándicap se COMPROBÓ contra la casa antes de escribir el código: `handicap=X`
es la línea del LOCAL y el visitante es su espejo. Verificado en un partido con favorito visitante — con
−0,5 el local paga 2,70 y el visitante 1,32; con +0,5 se invierte a 1,45 y 2,30. De haberla supuesto se
habría invertido cada línea del visitante en silencio. La orientación se gira cuando el local de la casa es
nuestro visitante.

**Sombra aparte** (`futbol-derivadas.js`, almacén propio en disco). No toca `db.clubDailyPicks` ni `curate`:
es la única forma de encender cinco familias de golpe sin arriesgar el feed que ven los usuarios. Regla
congelada `derivadas_v1`: 3 pp contra el precio sin vig, veto por encima de 15. Trabajo cada 20 min
(registro + cierres + liquidación). Ruta `/api/internal/futbol-derivadas?key=` (`?run=1` fuerza pasada).
Entra al tablero de familias como deporte `futbol-deriv`.

**Fuera a propósito:** los mercados por MITADES. Repartir el gol entre los dos tiempos es una suposición sin
medir, y una familia sin estructura medida no se apuesta.

**Dos bugs que salieron por el camino y valían más que la función:**

1. **El valorador solo miraba la lista corta de mercados.** Los totales asiáticos, el margen, los combos y
   estas cinco viven en la lista extendida. Sin el repliegue, cualquier cuota de esas familias entraba y
   salía como `unknown_market`: ingerida, jamás valorada.
2. **Las tres dobles oportunidades iban a la misma casilla.** La clave única de la tabla incluye `side`, y
   se escribían sin él: colisionaban y quedaba UNA fila por partido con el `market_id` de la última y el
   precio de esa misma. El valorador habría comparado la probabilidad de local-o-empate contra el precio de
   empate-o-visitante sin que nada chirriara. Salió a la luz al mover el contador por familia DESPUÉS del
   upsert — contar intentos y llamarlos cuotas escritas es cómo un fallo silencioso se disfraza de cobertura.

**Estado en vivo:** barrido de Cloudbet 74 eventos, 21 casados, 110 cuotas (48 tarjetas, 24 doble
oportunidad, 16 empate no válido, 16 ambos-marcan, 6 córners). Registro: 60 mercados valorados, **8 tesis
abiertas** (4 empate no válido, 4 doble oportunidad) en Championship y Brasileirão, 50 bajo listón, 2
vetadas por ventaja no creíble. Hándicap asiático y totales de equipo aún sin precio: Cloudbet los publica
pero los cotiza más cerca del saque — el parser está probado contra un evento sintético y entrarán solos.

# HANDOFF — estado al 20-ago-2026 (Cloudbet medido en la fuente)

## 🎯 20-ago (noche) — ¿se puede ejecutar sin cuenta nueva? Medido, no supuesto

**Para MLS, no, y no es culpa nuestra.** Los eventos de MLS en Cloudbet publican 31 mercados y **ninguno es
de tarjetas ni de córners** — las claves `soccer.total_corners` y `soccer.total_bookings` no existen en su
esqueleto. Por liga, comprobado partido a partido: Championship tiene córners **y** tarjetas; Brasil B tiene
córners; Brasileirão A, Argentina y MLS no tienen ninguno de los dos. De las 70 señales de tarjetas de la
ventana, Cloudbet solo podría tomar las 10 de Championship.

Y las señales de MLS que se sellaron como no ejecutables lo dicen con nombres: las cotizaban **DraftKings,
BetRivers, MyBookie y LeoVegas**. Ninguna tiene API pública de apuestas. Ese mercado, hoy, no tiene vía
automática.

**Pero la medición encontró algo más grande.** El colector de Cloudbet estaba leyendo **19 de 854** partidos
disponibles, con dos defectos encadenados:

1. **El tope de 200 se aplicaba DURANTE la recogida, no después de ordenar.** Cloudbet publica el esqueleto
   del mercado días antes con todas las selecciones en `SELECTION_DISABLED` y precio 0: existe la línea, no
   existe el precio. El presupuesto se gastaba en esos esqueletos —181 de 200 en la primera medición— y los
   partidos de esa misma tarde, que sí tenían precio, se quedaban fuera. Ahora se recogen todos los
   identificadores, se ordenan por hora de inicio y el tope se aplica al final. **19 → 34 partidos útiles**,
   30 con 1X2 y 28 con goles donde antes había 3 y 3.
2. **Dos `catch` mudos** hacían indistinguible "la casa no cubre el mercado" de "el colector falló". Son dos
   problemas con respuestas opuestas —escribir código o abrir una cuenta— y el silencio los mezclaba. Ahora
   se cuentan competiciones fallidas, detalles fallidos, sin-precio y sin-familia-útil por separado.

**Y hay inventario que estamos tirando.** En los partidos que el colector descarta, Cloudbet **sí** cotiza
14-25 mercados que no leemos: hándicap asiático, doble oportunidad, empate no válido, ambos marcan, marcador
exacto, totales por mitad, totales de equipo. Leerlos es el mayor desbloqueo de ejecución automática
disponible sin cuenta nueva — pero son familias nuevas y tienen que pasar por la sombra y el tablero antes
de valer nada.

**La sombra separa capacidad de ejecución.** El 52,4 % mezclaba las señales que no pudimos tomar con las que
no existían en ninguna casa conectable. Separadas: 23 de 39 no ejecutadas son `solo_casas_no_conectables`
(18 de MLS), y **la ejecución real sobre lo tomable es 72,9 %**. La diferencia entre los dos números es
cobertura de mercado, no ejecución, y no se arregla con código. Sonda: `/api/internal/cloudbet-probe?key=`
(`raw`, `struct`, `why`, `liga`).

# HANDOFF — estado al 20-ago-2026 (props reparadas, tablero de familias en pie)

## 🎯 20-ago (tarde) — el instrumento que faltaba

**El tablero de familias (`/api/internal/edge-board?key=`).** Ocho deportes medían su rendimiento en ocho
pantallas y ninguna contestaba la pregunta del negocio. Ahora hay una: recoge cada motor, aplica UN
veredicto escrito una sola vez —CLV medio, dispersión, t = media/(sd/√n)— y publica el objetivo familia a
familia, las CANDIDATAS de fuera del objetivo y las descartables. Dos decisiones importan más que el código:
la unidad es **familia + lado + banda** (sumar tarjetas under blandas con over eficientes fue lo que escondió
la familia estrella durante semanas) y trae **`n_para_t2` = (2·sd/media)²**, que convierte "no sabemos" en
"faltan 648".

Lleva una guarda que ya cazó un falso positivo: si el cierre casi no se mueve, la dispersión se hace
diminuta y un CLV de +0,02 % sale con t=1,4. Córners under en ligas intermedias estaba siendo ascendido a
candidata por eso. Por debajo de 0,5 pp de dispersión la familia pasa a `SIN_MOVIMIENTO`.

**Lectura del 20-ago:** una sola familia confirmada en toda la casa — CS2 hándicap de rondas (CLV +2,44 %,
t=2,38, n=46 con cierre). Tarjetas under en intermedias: PLANA (−0,28 %, t=−0,63, n=64). Props CS2: PLANA
(+0,08 % de línea sobre 91). Goles over: EN CONTRA (−1,83 % con sd 2,14 sobre 36 — t≈−5). Y un hallazgo
estructural: **el CLV de córners tiene dispersión de 0 a 1,2 pp** frente a 3,6 en tarjetas — o el cierre de
córners no se está capturando bien, o esa línea no se mueve; en cualquiera de los dos casos esa familia hoy
no se puede confirmar ni descartar con nuestra vara.

**Props CS2: la liquidación no salía de la serie, salía del montón.** Filtraba la bitácora por fecha ±36 h
y rival y se quedaba con "las dos últimas filas", asumiendo que el montón era una serie y venía en orden
cronológico. Ninguna de las dos cosas era cierta: el orden era el de inserción de la cosecha. Salían sumas
imposibles para dos mapas (44, 51, 56 kills contra líneas de 27,5). La bitácora pasa a traer serie
(`match_id`) y número de mapa, se ordena por fecha de verdad, y la liquidación agrupa por serie y toma los
mapas 1 y 2 **por su número**; cuando la serie no se puede identificar, anula en vez de adivinar. Las dos
filas que se suman quedan escritas en la pick.

Consecuencia que hay que tener delante: **las 87 liquidaciones viejas se rehicieron** y la familia pasó de
"47-40, ROI +3,01 %" a **48-43, ROI +0,51 %, CLV +0,07 %**. El +3 % era de la base rota.

**Y la regla queda congelada: `props_cs2_v2`, listón 10 pp** (v1 entraba desde 6, que es poco cuando el
libro cobra por pierna a −112 y la proyección a dos mapas tiene sigma de 5 a 10 kills). Cada tesis guarda
con qué versión nació y el seguimiento reporta por versión: v1 y v2 no son la misma familia.

**Ejecución vía API, comprobado en vivo, no de memoria.** Kalshi tiene API de trading real y **sí lista
córners** (MLS, Liga MX, EPL, La Liga, Serie A, Ligue 1, Bundesliga, UCL, Championship) — y **no lista
tarjetas en ningún deporte**. Polymarket no tiene ni córners ni tarjetas. Y el cuello de botella real está
en otro sitio: **las 40 apuestas ejecutadas de la sombra fueron todas a Cloudbet y ninguna fue de MLS** —
las 13 señales de tarjetas de MLS existen solo en Pinnacle entre nuestras casas.

# HANDOFF — estado al 20-ago-2026 (Valorant medido, College resuelto)

## 🎯 20-ago — Valorant deja de ser el deporte sin picks, y College deja de dar cero sin motivo

**Valorant: la cosecha llevaba días moliendo y el modelo leía la foto del 18.** El detalle pasó de 998
series a 8.925 (20.981 mapas) y nada llegaba al producto porque la cadena estaba cortada en tres sitios:
el agregado no corría en ningún trabajo (solo a mano desde el sandbox), escribía en el repo —que Render
recrea en cada despliegue— y la cosecha se marcaba "completa" y no volvía a correr nunca, con lo cual las
series de esta semana no entraban jamás. Ahora: trabajo de agregado cada 6 h, salida a disco persistente,
lectura disco-primero archivo a archivo, y "completa" pasa a significar "alcanzada" (repasa cada 6 h).

Con la cadena entera, la estructura que faltaba para picks queda MEDIDA y las familias de rondas se abren
solas por el mismo portón que ya tenía CS2 (`basisFor`): el pool sale de lo que se juega (13 mapas con
muestra, 609 equipos con historial por mapa), el reparto ataque/defensa se mide sobre las mitades
cosechadas, el arrastre económico se ajusta por bisección a la prórroga real de cada mapa y el residuo en
rondas se publica para que lo cobre el veto de calibración. Resultado en vivo: **de 0 picks a 56** sobre 14
partidos (RONDAS 19, RONDAS_HANDICAP 24, HANDICAP 9, RONDAS_EQUIPO 4), con el veto de calibración
rechazando 419 líneas. **Ese volumen hay que mirarlo en la revisión**: 4 picks por partido es mucho y es
justo el patrón que en fútbol acabó en sobreemisión.

Sin veto simulable no se sabe qué mapa se juega: el perfil sigue medido pero se suma en cuadratura la
dispersión de rondas entre mapas, y la tabla por mapa no se construye — cotizar la línea del mapa 3 contra
el tercero más jugado sería inventarse el orden.

**PRORROGA sigue sin cotizar.** El motor la tiene entera (probabilidad, calibración, etiquetas); lo que no
existe es una casa que la liste en las que alcanzamos. En Valorant "hay prórroga" es exactamente "más de
25,5 rondas", así que se puede sintetizar en cuanto una casa cotice esa línea del escalón — hoy no la
cotizan porque su escalera de rondas vive en 20,5-23,5.

**College daba cero y ahora se sabe por qué.** El diagnóstico de registro en sombra contó los descartes:
43 de 111 eventos caían por nombre. Dos causas — el apóstrofe (`nrm` convierte "Hawai\'i" en "hawai i" y
nunca casaba con "Hawaii Rainbow Warriors") y el nombre corto (la casa dice "UMass", "Connecticut",
"North Carolina State"; el catálogo dice "Massachusetts", "UConn", "NC State"). Se añadió normalización sin
apóstrofes, 30 equivalencias y coincidencia por prefijo más largo con frontera de palabra — antes
"Miami (OH) RedHawks" caía en "Miami" porque el bucle tomaba el primero que casara. Quedan 39 sin resolver
y **todos son de FCS** (Albany, Bethune-Cookman, Merrimack, West Georgia, Idaho, VMI…): no tenemos datos de
esas escuelas y el partido debe descartarse. CFL nunca estuvo roto: sus 24 líneas se valoran y ninguna pasa
el listón, que es una respuesta distinta de un cero.

# HANDOFF — estado al 19-ago-2026 (F1 y tenis reconstruidos, College/CFL con jugadores, la sombra arreglada)

## 🏁 19-ago (noche) — LA RONDA DE ALEXIS, PUNTO POR PUNTO (`e1811a7` en main)

**1. "Muchas picks de fútbol saliendo en void" — no era el feed, era el ejecutor.**
El feed público está sano: 63 liquidadas, 38-25, solo 2 VOID reales. El ejecutor en la sombra reportaba 9
anuladas de 30 (30 %) y NINGUNA lo estaba: su `result_code` era SUPERSEDED. Dos errores encadenados —
copiaba el código de la pick tal cual (pero SUPERSEDED es un hecho sobre la SEÑAL, no sobre la posición: el
dinero de papel ya estaba en esa línea a ese precio) y el resumen contaba como "anulada" todo lo liquidado
que no fuera WIN ni LOSS. Ahora una apuesta colocada se liquida contra el total REAL y contra SU PROPIA
línea; sin dato sigue abierta y solo a las 72 h se anula. Incluye reparación de las nueve, corrigiendo el
bankroll por la DIFERENCIA. **No toca la regla congelada de `cards_under_v1`.** Ojo: el ROI que se venía
leyendo tenía nueve apuestas metiendo stake en el denominador y cero en el numerador.

**2. F1 reconstruida.** 26/26 pilotos y 12/12 escuderías con foto (Wikimedia Commons, CC BY-SA — las de FOM
no se pueden auto-hospedar). Objetos firma: LA PARRILLA de verdad (dos columnas escalonadas) y el PLANO
COCHE × PILOTO con cuadrantes. Tres lentes. **Las 12 rondas restantes** son analizables, no solo la próxima
(`raceBoard(round)` + `calendar()`), con el cuidado de forzar PRE-QUALI en rondas futuras. DUELO interactivo
piloto contra piloto. Pestaña de Oportunidades honesta: **F1 es el único deporte SIN cobertura de mercado**
—comprobado en vivo en los dos proveedores— así que enseña convicciones ordenadas y una vigilancia de
cobertura, y dice que una convicción no es una pick.

**3. Tenis rehecho.** Calendario con el FORMATO DE LA CASA (grupos por día + `gx-mcard`), picks por
`pickCard()` —la misma card de los otros siete deportes— y **once paneles en tres lentes**: duelo saque/resto
ajustado por rival, camino al resultado, curva completa de juegos con la línea de la casa marcada, ocho
marcadores más probables, Elo POR SUPERFICIE, índices de saque y resto, h2h partido a partido, forma
reciente, perfil de saque de carrera y registro por superficie. 549 jugadores con cara.

**4. College y CFL con jugadores.** El motor no tenía capa de jugadores: se creó entera (cosecha, directorio,
ficha, rutas, pantallas). **No inventa rating individual** — este modelo puntúa EQUIPOS y la ficha lo dice.
Corre en Render (`GP_AMF_ROSTERS=1`): ESPN devuelve 403 a la IP de desarrollo.

**5. Las iniciales ya no se escriben ENCIMA de las fotos.** Las cuatro caras que escribí pintaban siempre el
elemento de iniciales, también con retrato. Combate y baloncesto ya lo tenían bien con `img + span
{display:none}`; ahora se aplica lo mismo en los cuatro, con clase + regla de hermano + vuelta atrás si la
imagen falla.

**6. Oportunidades no se veía en móvil** en tenis ni en F1: la barra inferior de ambos no incluía la vista
y ninguno tenía lista de "Más" propia. Corregido: Oportunidades abre la barra en los dos.

### ⚠️ DOS FALLOS DE OPERACIÓN QUE ME PILLÉ A MÍ MISMO (y valen más que las features)

- **El job de plantillas iba SIN freno de memoria.** La sonda enseñó tres cosechas a la vez y **801 MB de
  RSS** — el modo de fallo que tumbó la plataforma el 15-ago. Todos los jobs de la casa llevan freno; el mío
  no. Ahora: no arranca por encima de 300 MB ni con otra cosecha pesada en vuelo, corta entre ligas a 320,
  se reprograma a 45 min, y hace **CFL primero** (9 equipos contra 130+). No hubo caída: es para que no la haya.
- **El rellenado de LoL corría DUPLICADO y se borraba a sí mismo.** El log decía 1.498 partidas y en disco
  había 270: dos instancias, cada una con su foto de `games.json` en memoria, reescribiendo el archivo
  entero. Ahora hay cerrojo por pid (con limpieza de cerrojo huérfano y liberación en exit/SIGINT/SIGTERM).

### 🔧 LA SOMBRA DE TENIS NO LIQUIDABA — arreglada, y la cadena vale como lección

Treinta y una tesis abiertas y CERO liquidadas, con once partidos ya jugados. El diagnóstico llevó cuatro
pasadas y cada una acortó la siguiente, porque ESPN responde 403 a la IP de desarrollo y el camino solo se
puede mirar desde Render:

  1. **El silencio.** `espnDay` hacía `r.json()` sin mirar el estado (un 403 devuelve HTML → "Unexpected
     token <"), ese error caía en un `catch {}` por-pick que hacía `continue`, y el job solo escribía en la
     sonda SI algo se había liquidado. "No se liquidó nada" y "la fuente está caída" eran indistinguibles.
     → parte por MOTIVO (vencidas / sin_fuente / sin_cruce / no_final / sin_marcador / ok), guardado en
     disco AUNQUE no se liquide nada, y visible en /api/internal/tennis.
  2. **Primera lectura:** `sin_fuente: 0, sin_cruce: 11`. No era la red: era el cruce.
  3. **Segunda lectura**, con muestra: `eventos: 0`. Tampoco era el cruce — no había NADA que cruzar.
  4. **La causa:** el liquidador leía `j.events` y el marcador de tenis de ESPN cuelga los partidos de
     `sports[].leagues[].events`, la misma forma que ya usaba su endpoint de equipos.

**Resultado: `settled: 11`, `ok: 11`, todos los contadores de fallo a cero.** El registro vivo va 3W-8L,
−4,87 u, con la propia pantalla diciendo "con 11 liquidadas TODO es ruido".

La lección para quien retome: cuando un camino solo existe en producción, **no se adivina — se instrumenta**.
Las tres correcciones de anoche (job sin freno de memoria, script sin cerrojo, liquidador sin parte) son la
misma omisión repetida: código que falla en silencio.

### Estado de las cosechas
- **LoL kills+objetivos**: arranca en el borde de la ventana de 180 días (no en enero: las primeras páginas
  se gastaban en partidas que el modelo ni mira). 500 en ventana con kills y objetivos, 2.227 con kills desde
  enero. Sigue moliendo contra el limitador de Fandom.
- **Plantillas College/CFL**: pendiente, difiriendo correctamente mientras `lol_harvest` ocupa memoria.
- **Tenis**: el tablero depende del feed por torneo — Cincinnati terminó, el US Open abre solo.

# (histórico) estado al 19-ago-2026 (los cuatro esports con caras, y los tres pequeños generando picks)

## 🎮 19-ago — EL TRABAJO DETALLADO DE ESPORTS (`ffa12e5` en main)

Pedido de Alexis: fuera de CS2 los otros tres se veían "como una pila de estadísticas", sin fotos, sin
capas de contexto, sin picks. Cuatro olas desplegadas, en orden de causa:

1. **LAS CARAS (`1037e67`).** El `/players` de bo3.gg era inservible para plantillas —ignora el filtro de
   disciplina (misma tabla plana de 20.289 filas para LoL y para Valorant) y trae `team_id` nulo—, que es
   por qué las dos cosechas anteriores terminaban en "0 equipos · 0 jugadores". Cada juego tiene ahora SU
   fuente en `scripts/esports-rosters.js`: **LoL** por el catálogo oficial de LoL Esports (118 equipos
   cruzados → 695 jugadores, 645 caras, con rol y nombre real) y **Valorant** por vlr.gg, leyendo el
   ranking mundial + 11 regiones para descubrir id/nombre/escudo de 1.513 equipos y luego la ficha de cada
   uno (147 cruzados → 787 jugadores, 399 caras, con país). Las caras se pegan por NICK, no por id: la
   estadística y la identidad son numeraciones distintas de la misma persona. Peso: 235 MB de PNG a
   resolución completa → 6,0 MB en webp de 160 px.

2. **LA RESOLUCIÓN DE NOMBRE (`6c797c8`).** La casa escribe "G2", "Secret", "Spirit", "Bilibili"; la base
   los tiene completos. El emparejado por prefijo no llegaba ("g2" cae por el guardia de longitud, "secret"
   no es prefijo de "team secret"), y el partido no se quedaba sin pick: se quedaba SIN RATING — ni lectura,
   ni veto honesto, ni quinteto, con el Draft Room imprimiendo "el draft de este lado se queda sin leer"
   para Team Spirit. Índice de alias con la regla de colisión de cada juego: en LoL y Valorant vale solo si
   UNA marca lo reclama; en Dota 2, donde hay cinco "Team Spirit", gana el de más historial. Valorant pasa
   de resolver 4 de 11 partidas a 10.

3. **VALORANT DEJA DE SER EL JUEGO SIN PICKS (`ffa12e5`).** `detail_series` llevaba semanas en 0 y la causa
   no era la fuente: una sola página mala lanzaba y el `throw` mataba la pasada entera antes de escribir una
   fila. Con el fallo tolerado, la primera pasada honesta dio **998 series, 0 descartadas** → 10 mapas con
   muestra, 307 equipos con historial por mapa, 29 agentes, 995 jugadores cualificados, 306 composiciones.

4. **PICKS EN LOS TRES.** Valorant 0 → 4, Dota 2 5 → 9, LoL 1. **Ningún listón se ha tocado**: siguen donde
   estaban hasta la revisión del domingo 23. Lo que subió fue la BASE, no la permisividad.

**UI**: cabecera "Pick del día · Mejor arbitraje" en el board de los cuatro juegos; tablero de mapas de
Valorant enseñando el POOL ENTERO (siete cards) con fuerza medida y probabilidad de elección por equipo,
atenuando los que caen en el veto en vez de esconderlos; plantillas con cara, país, nombre real y rol; el
aviso de "todavía sin medir" una vez por equipo y no cinco veces bajo cinco caras.

**Pendiente vivo**: LoL tiene 84.586 partidas CON duración pero SIN kills (la cosecha guardó las filas antes
de que el `slim` pidiera `Team1Kills`/`Team2Kills`), así que las familias de kills siguen vetadas por
`estructura_no_medida`. La Cargo API de Leaguepedia SÍ responde desde el sandbox (comprobado); el rellenado
desde 2026-01-01 —9.295 partidas a reescribir— va peleando con el limitador de la wiki.

# (histórico) estado al 18-ago-2026 (OCHO deportes: tenis y F1 nacen, LoL revive)

## 🏆 18-ago (noche) — TENIS (7º) Y F1 (8º) EN PRODUCCIÓN + EL REVIVAL DE LOS ESPORTS (`902de37`)

1. **TENIS (blueprint 6.0), al lado de NFL, admin-only.** Los repos de Sackmann fueron RETIRADOS de
   GitHub: la base entró por el espejo archivístico Aneeshers/tennis-sackmann-archive (misma licencia
   CC BY-NC-SA → sin uso comercial: RIGHTS.md manda, reemplazar por fuente licenciada antes de abrir
   al público). 61.422 partidos ATP+WTA 2015→may-2026. Compilador EXACTO punto→juego→set→partido
   (`tennis-engine/compiler.js`, verificado contra Monte Carlo) con choque de ejecución medido.
   HOLDOUT único: ATP 10,5% skill/AUC 0,711 · WTA 11,7%/0,723; forma calibrada bate al ingenuo.
   Cuotas por descubrimiento dinámico de torneos de The Odds API (Cincinnati vivo, US Open llega
   solo), sombra market-blind con retiro→VOID: **24 tesis abiertas ya en prod**. Pestaña completa:
   tablero GP-vs-mercado, Ranking GP, fichas, DUELO SAQUE-RESTO (objeto firma), sombra, brief, ask.
2. **F1 (blueprint 7.0), al lado de Tenis, admin-only.** Base Jolpica-F1 (CC BY 4.0 — la mejor clase
   de derechos de la casa), 263 carreras 2014→2026. `f1-engine/`: descomposición COCHE×PILOTO
   walk-forward (el cambio reglamentario de 2022 midió en dev cuánto coche sobrevive a un cambio de
   reglas: eso hereda 2026) + gemelo Monte Carlo del field completo con common random numbers.
   Holdout: Spearman 0,687, Brier podio 0,067; en el GANADOR pos-quali el prior de casilla sigue
   delante (1,058 vs 1,161) Y SE DICE — sin picks. The Odds API NO cubre F1 (comprobado): terminal
   de inteligencia puro con vigilancia diaria de cobertura. UI: hero del GP (Dutch GP 23-ago),
   PARRILLA PROBABILÍSTICA con color de constructor, mundial con barra Coche×Piloto, WHAT-IF de
   casilla, duelo, brief/ask/motor. Overlay Jolpica cada 6 h: la quali del sábado activa POS-QUALI.
3. **El reporte de Alexis sobre los esports ("como si no hubiéramos hecho nada") — resuelto.**
   (a) LoL estaba VACÍO (Fandom nunca abrió): base por espejo gptilt/lol-esports-matches (HF,
   CC BY-SA, linaje Leaguepedia) — 84.586 partidas 2021→16-ago-2026, validación real 12,75% de skill
   (ventana intacta), Campeones con el meta del parche 26.15. Fichas de jugador siguen pendientes de
   la cadena de Leaguepedia (se dice en pantalla). (b) Rankings tier-2 arriba (Galions/TEAM VISION):
   ahora son del CIRCUITO PRINCIPAL (filtro de ligas/torneos grandes, con fallback). (c) Tiles grises:
   identidad de COLOR determinista por nombre en crests y avatares de toda la casa.
4. **Cosechas**: Valorant details sigue moliendo en Render (agentes/quintetos se abren solos al
   completar). Sombra de tenis liquidará sola por ESPN. F1 y tenis con jobs propios.
5. **Sondas**: `/api/internal/{tennis,f1,tenraw,esports}?key=$GP_EXPORT_KEY`.

# (histórico) estado al 18-ago-2026 (los cuatro esports vivos + correcciones del día + caja negra)

## 🕐 18-ago (mediodía) — LA OLA GRANDE DEL DÍA DESPLEGADA (`c3040a0` en main)

**Todo lo pedido por Alexis el 18 está EN PRODUCCIÓN salvo las lentes de fútbol** (commit `804fa80`,
ÚNICO que queda solo en la rama `claude/gpsim-continuation-vrjuww` — se despliega cuando Alexis lo
apruebe mirándolo en preview; el partido de fútbol es el producto público en vivo).

1. **Valorant y Dota 2 completos en código con base real.** Valorant: 33.073 series de vlr.gg
   (holdout 8,0% de skill, AUC 0,66, n=893 — nivel CS2), Elo propio + `valorant-data.js` (Agentes,
   Sala de composición con vetoInput medido, fichas). Dota 2: 49.645 partidas de OpenDota +
   capa estratégica por Explorer SQL (meta 7.41 con 127 héroes, doctrina de 1.826 equipos,
   2.291 jugadores por posición inferida de GPM) + `dota2-data.js` (Héroes, Draft Room con
   doctrina, jugadores KP/KDA/GPM). Los CUATRO juegos con motor propio separado.
2. **Correcciones del 18:** brief diario + Pregúntale a GP + simulador en Esport (4 juegos) y en
   Fútbol americano (3 ligas); los 9 escudos CFL locales en `/logos/cfl_*.png`; Jugadores NFL ya
   no rebota a partidos en College/CFL (muestra el hueco honesto); sonda
   `/api/internal/hoops-brief?key=…&league=wnba` para diagnosticar el brief de baloncesto sin sesión.
3. **REGLA DE CAJA NEGRA aplicada a toda la capa servida** (doctrina nueva, pisa a la vieja
   "auditoría visible"): las APIs y la UI enseñan EVIDENCIA (ventanas de validación, tamaños de
   muestra, métricas fuera de muestra) y NUNCA la receta — ni familias de modelo, ni constantes,
   ni pesos, ni medias-vidas, ni fórmulas. Los internos completos siguen en las sondas con key y
   en los docs del repo. Al tocar pantallas nuevas: no volver a filtrar la receta.
4. **Barrido Playwright de 63 vistas (los 6 deportes, 4 juegos, 3 ligas):** cero errores JS propios,
   cero imágenes rotas locales, cero "undefined/NaN" visibles. Ojo con el arnés: `gp_onboarded`
   va con sufijo de email y hay que esperar ~8 s a que cargue la sesión antes de navegar por hash,
   si no TODO rebota al tablero de fútbol y el barrido mide mentiras.
5. **Cosechas en curso en Render (disco persistente, sobreviven deploys):** Valorant detalles
   moliendo (`/data/val-raw`, 9.780 series pendientes a ritmo robots-friendly — días); LoL SIN
   ventana de Fandom desde las 10:50 (plan B: Drive de Oracle's Elixir mañana, o cuenta bot de
   Fandom de Alexis). Avance: `/api/internal/{valraw,lolraw}?key=$GP_EXPORT_KEY`.

## 🎮 18-ago (tarde) — LoL COMPLETO EN CÓDIGO, LA COSECHA MOLIENDO EN RENDER

**En producción: `75265e6`.** El blueprint 3.0 de LoL (docx de Alexis) construido de punta a punta y
**probado con datos sintéticos en el formato exacto de la cosecha** (generador en scratchpad; los
sintéticos NO se versionan, se borraron). Lo único que falta es la BASE REAL, que se está cosechando
sola en Render. El punto de retoma exacto:

1. **Cosecha (Fase 1) — cadena paciente en Render, `/data/lol-raw` (persistente).** La 1ª pasada enseñó
   que Fandom limita también la IP de Render (cubo: ~6 páginas y ~10 min de bloqueo) y el script se
   rendía dando tablas por terminadas con 0 filas — PEOR que fallar. Corregido: espera las ventanas
   (hasta ~2 h por llamada), escritura atómica, y el server reencadena pasadas cada 20 min hasta que
   `state.json` diga `complete` (`lolHarvestJob`). Avance visible en
   `/api/internal/lolraw?key=$GP_EXPORT_KEY` (games.json creciendo desde las 10:51). Con el ritmo
   medido, games (~160 páginas) tarda horas y players 2023→ (~700 páginas) un día-plus. **Cuando
   state.json esté completo: bajar los tres archivos por lolraw (gzip), correr `lol-aggregate.js` +
   `lol-validate.js`, commitear la base compacta + priors, y APAGAR GP_LOL_HARVEST en Render.**
   Plan B si no converge: Oracle's Elixir (Drive con cuota agotada el 18; reintentar; IDs en scratchpad).
2. **Todo lo demás YA ESTÁ desplegado y probado** (`129f249` + `a4ec5ad` + `75265e6`): `lol-data.js`
   (contrato cs2-data + championsBoard + draftIntel + tempoFor medido por liga), store integrado (Elo
   propio anclado a mercado con peso por muestra, `draft_room` en analyzeMatch, h2h, ratings_state por
   juego), vista **Campeones** (en el hueco de El circuito para LoL), **Draft Room V1** en la partida,
   **Equipos/Ranking/Jugadores/ficha de jugador** propios de LoL (KP/KDA/CSPM por rol), atribución
   CC BY-SA donde se enseña el dato. Con la carpeta `data/esports/lol/` vacía todo degrada honesto
   (available:false) — ese es el estado de prod hasta que la base real se commitee.
3. **Bug de identidad cazado por el smoke-test:** `resolveTeam` resolvía academias al primer equipo
   ("Nongshim RedForce Challengers" → quinteto de Nongshim RedForce). Ahora un prefijo compartido solo
   es variante si lo que sobra es palabra de organización; los marcadores de segundo equipo
   (challengers/academy/GC/2/B…) NO resuelven. Mejor sin ficha que con la ficha de otro.
4. **Derechos (Fase 0):** `data/esports/lol/RIGHTS.md` — Leaguepedia es CC BY-SA
   (research_attribution_ccbysa, NO betting_commercial_ok): LoL sigue admin-only, familias en sombra,
   probabilidad pública anclada a mercado; la base propia afina peso y alimenta catálogo/draft. La
   política de Riot PROHÍBE apuestas → nada de Riot API ni assets de campeones (texto-first).

## 🏈 18-ago — FÚTBOL AMERICANO COMPLETO: la pestaña NFL ahora es NFL · College · CFL

**Desplegado y verificado en prod (`cfca83a`).** El encargo de Alexis: extender la inteligencia de NFL a
las ligas menos eficientes, TODO generando picks al monitor privado. Hecho con la doctrina intacta
(market-blind, sombra, moneyline cerrado). La sonda responde por las tres ligas:
`/api/internal/nfl?key=…` → pasos `amfoot:ncaaf` y `amfoot:cfl` (College 8 partidos/22 casas y CFL
8/20 al desplegar).

1. **Datos.** NCAAF: CFBD (key gratis de Alexis, en Render como `CFBD_API_KEY`) — 11.260 partidos FBS
   2014-2026, 8.614 con cierre histórico; 38 llamadas de 1.000/mes. CFL: cosido de CUATRO fuentes —
   ESPN 2021-22 (transporte curl; Akamai rechaza fetch de Node), Wikipedia 2023-25 POR EQUIPO con doble
   testigo (254/257 confirmados), scoreboard oficial cfl.ca para 2026, y **los cierres "imposibles"
   salieron del HISTÓRICO de The Odds API** (el plan de la casa lo incluye: /historical/events da los
   kickoffs por 1 crédito, snapshot a kickoff−5min captura el cierre) → 254/453 con cierre, ~28k créditos.
2. **Fit walk-forward por liga** (`scripts/amfoot-fit.js` → `data/amfoot/priors-*.json`): NCAAF MAE
   margen 13,59 vs 12,34 del cierre (TOTAL roza breakeven: 52,9% umbral 6, n=2.199); CFL 10,55 vs 9,88 y
   total a 0,12 del cierre — **backtest TOTAL CFL 57-65% en n=43/26, la señal de liga blanda que la
   sombra tiene que confirmar o matar**. CFL 2026 anota +6 pts (cambio de reglas, 53,0→59,1 medidos):
   base móvil corta (50) por eso.
3. **Motor** `amfoot-engine/store.js`: arquitectura nfl-engine con dimensión de liga, MISMOS DTOs → la UI
   de NFL rinde las tres ligas con un selector (molde baloncesto). Overlay de resultados en disco
   persistente (CFBD/cfl.ca). Jobs cada 30 min, ventana ≤9 días: **CFL registra sombra YA** (juega esta
   semana), college desde el ~20-ago (kickoff 29-ago).
4. **🔴 BUG REAL CORREGIDO EN NFL:** los gates usaban |edge| → los DOS lados del mismo mercado pasaban a
   la vez (la primera pasada CFL registró el lado -EV). Corregido en ambos motores: edge positivo. El
   latente de NFL habría debutado con los mercados de la Semana 1.
5. Primera pasada real de sombra CFL (local): 5 picks — 4 TOTAL under + 1 SPREAD, solo lado +EV.
   `/api/amfoot/{slate,game,teams,model,track}?league=` con el gate de NFL; Jugadores/lecturas/lesiones
   quedan solo-NFL y la UI lo declara.


## 🧭 17-ago (sesión de noche) — LO ÚLTIMO, LÉEME ANTES QUE NADA

**En producción ahora mismo: `11a0fb2`.** Lo que sigue en la rama
`claude/gpsim-continuation-vrjuww` **sin tocar main, esperando el OK de Alexis**: las lentes de fútbol y
los scripts de Dota 2 (ver más abajo). Reglas fijas intactas: ejecutor en la sombra sin tocar; baloncesto
congelado SOLO-RAMA hasta el domingo 23; a main solo por SHA.

1. **Revisión de la sombra de props, y el fallo que destapó.** Las 24 tesis vivas estaban anotadas
   **22 de 24 al MISMO precio** (1,893 → listón 0,5283): Underdog es un libro DFS y casi no mueve precio,
   mueve la LÍNEA. El CLV que había medía solo `close_bar − bar` y encima descartaba las tesis cuya línea
   se había movido → **medía cero por construcción justo en los casos informativos**. Corregido y
   desplegado: CLV = **línea + precio**, la línea evaluada con la proyección CONGELADA al anotar (mu/sigma
   guardados en la tesis), que es lo que aísla el movimiento del libro de la deriva del modelo. Retroactivo
   (las tesis ya guardaban `mu`, `sigma` y `close_line`). Signos comprobados: over 26,5 que cierra en 28,5
   = +13,2 pp; el mismo que cierra en 24,5 = −12,8 pp. Añadido también el **CLV provisional de las tesis
   abiertas** (`perf_open`), porque con 0 liquidadas la familia estaba ciega.
2. **Liquidadas: 0, y es lo esperado** — no un fallo. Las primeras tesis son de partidas del 18 y 19-ago;
   liquidan con la pasada diaria siguiente. Al cierre de esta sesión: 24 activas, 2 con la línea ya movida.
3. **Rutas internas nuevas** (misma llave `GP_EXPORT_KEY`, solo lectura, porque revisar una familia en
   sombra desde una terminal no debería exigir sesión de navegador):
   `/api/internal/esports?key=…&props=1` (track + resumen de pizarra) y `…&evidence=cs2`.
4. **Evidencia de mercado: vacía todavía, con motivo medido.** `with_open_and_close: 0` y
   `avg_passes: 1` — el trabajo de cierres corre a los 320 s del arranque y luego cada 20 min, y **cada
   deploy reinicia ese reloj**: en un día de despliegues seguidos ningún evento llega a una segunda pasada
   y la apertura nunca se congela. No es un bug del panel; es cadencia. En un día sin deploys se llena solo.
5. **Fase 3 del rediseño (fútbol) — EN LA RAMA, pendiente de que Alexis lo mire.** Decisión tomada con él:
   **versión ligera**, porque el partido de fútbol NO estaba como CS2/NFL/baloncesto (aquí ya había nav
   sticky con scrollspy y dos columnas). El mismo nav deja de listar 9-11 anclas y pasa a filtrar tres
   lentes (El partido / El modelo / Contexto, con su traducción al inglés); dentro de la lente las
   secciones se reparten en las dos columnas existentes partiendo por la MITAD del orden de lectura, para
   que en móvil el orden no cambie. Héroe y panel de oportunidad, intactos y siempre visibles. Medido en
   México–Sudáfrica: **móvil 2.518 → 1.251 px, desktop 1.804 → 954 px**, cero errores JS a 430 y 1360 px.
6. **Dota 2: base propia + la validación, ANTES de enchufar nada** (también en la rama).
   `scripts/dota-harvest.js` bajó **30.000 partidas profesionales** (jul-2025 → ago-2026; 28.529 con los dos
   equipos identificados, 2.069 equipos). `scripts/dota-validate.js`, walk-forward estricto:
   **Elo+lado = 1,92 % de skill, AUC 0,574, ECE 0,017** contra 0,06 % de "saber de qué lado juegas".
   CS2 con la misma validación da 7,28 % / 0,652 → **la señal de Dota 2 es real pero vale una cuarta parte**,
   y el AUC no se mueve con K, así que el techo está en el dato (mezcla tier-1 con tier-3). **No habilita
   picks**; sirve para tener rating propio y poder medir CLV cuando haya cuotas guardadas.
7. **🔴 CORRECCIÓN al punto 5 de la sesión anterior (costes de datos):** existe **GRID Open Access**, que es
   **GRATIS** y da datos oficiales de CS2 y Dota 2 (server-side, evento a evento) a proyectos pre-revenue.
   Es el desbloqueo del dato ronda a ronda **sin los ~1.600 €/mes** que quedaron escritos. El feed de
   apuestas (*Series Events*) queda fuera de Open Access y es de pago — conviene decirlo nosotros en la
   solicitud. Y al revés: **la API pública de Riot NO sirve partidas profesionales**, solo cuentas
   normales; para el circuito lo que hay es lolesports (que ya usamos) y Liquipedia → Riot baja de
   prioridad. Los tres textos listos para enviar están en **`SOLICITUDES_DATOS.md`** (GRID, Liquipedia,
   Riot); enviarlos necesita tu cuenta.

## 🧭 17-ago (cierre de sesión anterior) — PUNTO DE RETOMA

**Todo lo de abajo está DESPLEGADO y verificado en prod** (último deploy: lentes en todos los deportes).
Estado de las reglas fijas: ejecutor en la sombra ($2.000, cards_under_v1) INTOCADO; baloncesto congelado
SOLO-RAMA (`claude/gpsim-combat-visual-boxing-276pin`, commit en la punta) hasta el DOMINGO 23-ago;
`GP_BOXING_BACKFILL=0` (backfill completo: 39.384 peleas / 1.417 boxeadores, en main).

1. **Props de jugador CS2 vs Underdog, EN SOMBRA** (`esports-engine/props.js` +
   `data-providers/esports/underdog.js` + rutas `/api/esports/{props,propstrack}` + vista Props):
   v1.1 con factor rival (dpr del cinco rival, clamp ±12%), headshots como 2ª stat, CLV por tesis.
   Barrido cada 2 h anota tesis solo; settle en cs2DailyJob. **POR QUÉ NO GENERA PICKS TODAVÍA** (si
   Alexis pregunta): doctrina de la casa — toda familia nueva acumula muestra fuera de muestra en sombra
   y se revisa con Alexis ANTES de publicar; el modelo v1.1 no está validado contra resultados aún (0
   liquidadas al cierre de sesión; las primeras liquidan con la pasada diaria del 18-ago). El listón
   está escrito en el propio track (`doctrine`). La bitácora de jugador lleva `hs` desde la pasada del
   18-ago (para liquidar headshots; los anteriores caen a VOID con motivo).
2. **Boleto GP**: combinador de piernas en TODAS las pick cards (localStorage `gp_slip`, ¼-Kelly tope
   2 %, correlación avisada). Listener global con captura; botón junto a la calculadora.
3. **Blueprint feedback CS2 aplicado**: apertura point-in-time en cierres (`snapshotCloses` congela
   primera lectura), panel Evidencia de mercado en Rendimiento (`/api/esports/evidence`: cobertura,
   apertura→cierre, CLV por casa), Huella GP (percentiles 6D en ficha de jugador), estado del cinco en
   ficha de equipo.
4. **LENTES CONTEXTUALES (arquitectura visual, fase 1+2 ENTREGADA)**: patrón `gx-seg` sticky
   («La partida / El modelo / Contexto») aplicado a: partida CS2, partida esports genérica (LoL/VAL/Dota,
   2 lentes), partido NFL (`data-nfllens`, bind de cancha solo en lente partida) y partido baloncesto
   (`data-bblens`, era la pantalla más vertical: 17 bloques). Handlers: esClicks para esports; listener
   global de captura para NFL/BB. El VERDE NO SE TOCA (decisión de Alexis 17-ago). PENDIENTE de la
   fase 3: fútbol (renderMatch — producto público en vivo, hacerlo con Alexis mirando) y fichas de
   equipo/jugador si se quiere.
5. **Datos round-level (punto 1 del feedback) — investigación de costes (17-ago)**: PandaScore con
   rondas detalladas ≈ €1.600/mes histórico, €4.000/mes live (pricing público). GRID/Bayes = enterprise
   con presupuesto a medida (GRID tiene programas de acceso para proyectos pequeños — vale la pena
   aplicar). **Gratis y oficiales para los OTROS esports**: Riot API (LoL y Valorant, gratis con
   aprobación) y OpenDota/Steam (Dota 2, gratis) — dan detalle por partida que bo3 no tiene para CS2.
   Camino recomendado: aplicar a GRID + pedir Riot API + Liquipedia (email pendiente de Alexis);
   PandaScore solo si el producto ya paga.
6. **Recordatorio programado**: trigger `trig_012Ai9w8HHmxRXL9GneDcAzv` dispara el 7-sep-2026 14:00 UTC
   (sesión fresca, push+email a Alexis) para construir el ROSTER TIMELINE de CS2 con las ~3 semanas de
   fotos diarias de plantilla ya acumuladas. Si hay <15 días de fotos, reprogramar.
7. **Análisis LCS Larry** (competidor, lcslarry.com + @LCSLarry): escáner de props esports contra libros
   DFS blandos, $150/mes vía Whop, track record auto-calificado no auditable (claims ~60% hit / 30% ROI).
   Veredicto: modelo no comparable ni auditable; negocio listo en lo comercial. Sus 2 ideas buenas ya
   replicadas (props → punto 1, boleto → punto 2). Pendientes de decisión de producto con Alexis:
   track record público cuando la sombra aguante, comunidad de pago post-Mundial.


## 📋 17-ago (tarde-3) — BLUEPRINT DE FEEDBACK CS2 aplicado (P0 evidencia de mercado + P1 jugador/roster)

Del docx "Product Feedback & Next-Level Review" de Alexis. Lo aplicado, en su orden de prioridad:
- **P0 · Apertura + cinta point-in-time** (`store.snapshot`): antes cada pasada de cierres SOBREESCRIBÍA
  la anterior — quedaba el cierre y se perdía la apertura. Ahora la primera lectura de cada evento queda
  congelada (`open_rows`/`open_at`), se cuentan las pasadas (`moves`) y el ganador de serie lleva una
  cinta ligera de hasta 30 puntos (mejor precio por lado). Acumula desde este deploy vía el job de 20 min.
- **P0 · `marketEvidence(game)`** + ruta `/api/esports/evidence`: cobertura (cierres, con ambas puntas,
  pasadas medias), movimiento apertura→cierre en pp de probabilidad implícita (top movers con nombres) y
  **CLV por CASA** (el corte que faltaba; por familia ya lo daba `track()`). Panel "Evidencia de mercado"
  en Rendimiento. Doctrina del documento dentro del dato: predictividad ≠ rentabilidad.
- **P1 · Huella GP** en la ficha de jugador (`playerProfile.footprint`): percentil contra la población
  cualificada en apertura/volumen/daño/consistencia/clutch/multi-kill — "impacto contextual, no más
  campos". Smell test: ZywOo p99-p100 en todo.
- **P1 · Estado del cinco** en la ficha de equipo: estabilidad medida en días (517 equipos la tienen),
  titulares incompletos declarados, y el aviso de cambio reciente ya existente.
- **Pendiente del blueprint (no entró hoy, por diseño)**: round/economía/T-CT (necesita datos ronda a
  ronda que bo3 no da), spatial intelligence, arquitectura visual menos vertical: ENTREGADA en la pantalla más vertical (panel de partida CS2 →
  lentes contextuales «La partida / El modelo / Contexto» con el gx-seg de la casa, héroe+oportunidades
  siempre visibles, sticky); extenderla al resto de pantallas y el «verde escaso» siguen para sesión propia, roster timeline histórico (requiere fotos de plantilla acumuladas).

## 🎯 17-ago (tarde-2) — PROPS DE JUGADOR (familia nueva EN SOMBRA) + BOLETO GP

Del análisis de LCS Larry (competidor: escáner de props de esports contra libros DFS blandos). Se
replicaron sus dos ideas buenas con la disciplina de la casa:
- **Props CS2 contra Underdog** (`esports-engine/props.js` + `data-providers/esports/underdog.js`):
  Underdog publica su pizarra entera en un endpoint público CON precio por pierna (PrizePicks bloquea con
  captcha, probado). Proyección PROPIA de kills en mapas 1-2: kpr encogido (ancla poblacional, K=250
  rondas) × rondas esperadas medidas (~21,4/mapa), sigma de sus últimos 12 mapas ×√2 con suelo. Solo CS2
  proyecta (único título con scoreboard propio); LoL/Valorant se listan sin valorar y se dice por qué.
  Vetos: muestra_corta, ventaja_no_creible (>20 pp), stat_no_modelada. **Sombra PROPIA** en
  `<disk>/esports/props-cs2.json` — UNA anotación por TESIS (día|jugador|stat|lado, la línea de más
  ventaja), liquidación automática desde los logs propios (mapas 1-2 = últimas 2 filas de la serie en el
  log, `settle_basis` escrito en cada pick), VOID a los 7 días sin scoreboard. **CERO contacto con el
  ejecutor en la sombra de la casa** (cards_under_v1 sigue intocable hasta el domingo 23). Barrido de
  anotación cada 2 h (`esPropsSweep`) + settle dentro de `cs2DailyJob`. Rutas
  `/api/esports/{props,propstrack}` (admin), vista **Props** en Esport. Al construirla había 385 líneas,
  12 sobre el listón, 8 tesis anotadas. v1 declarado sin ajuste por rival — y **v1.1 (misma tarde)** lo entregó: factor rival MEDIDO
  (media de dpr del cinco rival vs poblacional, ≥3 medidos, recorte ±12 % por la trampa de filiales),
  **headshots en mapas 1-2** como segunda stat (derivada de kills × proporción encogida; la bitácora
  lleva `hs` fila a fila desde la pasada del 18-ago y con eso liquida) y **registro de CIERRE por tesis**
  en cada barrido → CLV medio en el rendimiento (la métrica que decide antes que el acierto).
- **Boleto GP** (todas las pick cards, los 4+ deportes): botón "Boleto" junto a la calculadora → fab
  flotante con panel: piernas, cuota combinada, prob GP combinada (solo con partidas distintas: piernas
  correlacionadas no multiplican y se avisa), EV, stake sugerido ¼-Kelly tope 2 %, copiar al portapapeles,
  disclaimer. localStorage `gp_slip`, máx 6 piernas. Probado con Playwright (desktop + móvil, cero
  errores JS).
- Listón de salida de la sombra de props: el de toda la casa — muestra fuera de muestra revisada con
  Alexis antes de publicar nada como pick.

## 🏈 17-ago (noche) — NFL INTELLIGENCE TERMINAL (V1 del blueprint, admin-only)

Sexto deporte, construido del blueprint maestro de Alexis (Word). Lo entregado es la columna V0→V1:
- **Base propia point-in-time**: `scripts/nfl-harvest.js` baja nflverse (games.csv 1999→hoy CON cierres
  históricos + stats_team_week 2016-2025 con EPA) → `data/nfl/` (games 3.033, team-weeks 5.522, venues con
  coordenadas para clima). Crudo en `<disk>/nfl-raw/`.
- **Modelo market-blind** (`nfl-engine/`): rating en puntos (opponent-adjusted, recency, carry 2025
  encogido) + estados EPA de 4 lados → margen y total. `scripts/nfl-fit.js` = walk-forward 2017-2025:
  **MAE margen 10.31 vs 9.86 del cierre · Brier 0.224 vs 0.210** — bueno, NO bate al mercado, y por eso
  **TODO está en sombra** (registro privado + CLV; moneyline cerrado por doctrina). Simulador: pares de
  residuos reales vs cierre (masa de números clave 3/6/7/10/14 real) + ruido por la varianza extra medida.
- **Terminal** (pestaña NFL junto a Esport): Command Center (delta GP-vs-mercado por partido), Game
  Intelligence Terminal (héroe con banda de incertidumbre, distribución margen/total con la línea del
  mercado marcada, gravedad de números clave, ADN EPA divergente, grid multi-casa, veredictos con gates,
  Weather Lens open-meteo, forma/h2h, procedencia), Equipos + ficha, Model card con la validación entera,
  Rendimiento (sombra). Probado con clicks a 1360/390px.
- **Jobs**: cuotas (The Odds API, 1 llamada liga entera) + cierres + sombra cada 30 min SOLO con partidos
  a ≤9 días. Probe: `/api/internal/nfl?key=`. Kickoff real: mié 9-sep (SEA) y SF–LAR en Melbourne el 10.
- **Pendiente natural (V1.2+ del blueprint)**: roster licenciado, player props (motor de
  oportunidad), 1H, Ask GP. Nada de eso se finge en la UI: se declara.

### v2 (misma noche, pedidos de Alexis)
- **Oportunidades NFL**: pantalla honesta — estado de cada familia con su porqué medido, el reloj al
  kickoff, y lo que la sombra registra. **Jugadores**: directorio QB/RB/WR/TE (nflverse 2024-2025,
  headshots, por-partido). **Partidos** reformateado a la gramática de la casa (tabla Hora·Partido·
  Mercado·Probabilidad·Señal). **Buscador scoped**: en NFL solo NFL (`/api/nfl/search`), en Esport solo
  CS2 (`/api/esports/search`).
- **LA CANCHA INTERACTIVA** (Game Terminal): el eje es el margen (cada yarda = un punto), la
  distribución del simulador pintada por bando sobre el césped, números clave recuadrados, banderines
  GP/mercado, y DOS exploradores (spread y total) que arrastran una línea y leen la CDF completa de las
  20.000 simulaciones — así se cotiza cualquier línea alternativa (NFL-0464) sin re-simular.
- **Backtest de picks vs cierre** (2017-2025, en el Motor y en Oportunidades): ML −7/−10% ROI, spread y
  total negativos en umbrales chicos; único bolsillo >breakeven: spread con desacuerdo ≥4 pts (53.2%,
  +1.55%, 575 apuestas — dentro del ruido). Es la justificación NUMÉRICA de la sombra.
- **Lecturas LLM** (`llm.writeNflRead` / `writeCs2Read` + `db.nflReads`/`db.esReads`): la capa de
  contexto narrada del dossier estructurado, cacheada (se paga una vez), pasada de fondo
  `llmEsNflReadsPass` (cap 3) + generación bajo demanda por ruta. Baloncesto ya la tenía.
- **Disponibilidad NFL**: ESPN core API, cacheada 6 h, SIEMPRE etiquetada "mejor esfuerzo · no
  oficial" — la decisión del motor no la consume (eso exige feed licenciado, NFL-0069).

> Punto de retoma para la siguiente sesión. Lee `CLAUDE.md` primero (reglas duras), luego esto, luego el
> principio de `TODO_NEXT.md`.

## 🆕 17-ago (tarde) — CATÁLOGO CS2 (6 productos) + OPS AUTOMÁTICAS

**Producto (todo servido de la base propia, nada depende de las casas):** Finalizados (marcadores bo3 reales
en Partidas), Equipos (directorio + ficha con efecto por mapa/quinteto/forma/rivales), Ranking GP (top 50 por
Elo propio validado; foto semanal en `data/esports/cs2/rankings-history/` — las flechas aparecen con la 2ª
foto), Jugadores (rating 6m del proveedor, ETIQUETADO como suyo; escala 0-10, no la ~1.0 de HLTV), El
circuito (meta del pool medido) y H2H (en partida, simulador y ficha). Rutas: `/api/esports/{directory,team,
players,ranking,circuit,results,h2h}`. Vistas: `esteams/esteam/escircuit` + segmento `fin` en esboard.
La base se re-cosechó COMPLETA: **88.502 mapas** (antes 48.678) — los agregados nuevos (`pairs.json`,
`form.json`, `rankings.json`, `players.json`) salen de `cs2-harvest.js --aggregate-only` + `cs2-roster.js`.

**Ops (server.js, bloque "OPS AUTOMÁTICAS"):** (1) CSV de usuarios DIARIO por correo al admin (adjunto
Resend — copia fuera de la máquina); (2) cosecha CS2 diaria automática a las ≥09 UTC en hijos con tope de
heap y guardia de RSS (`GP_CS2_HARVEST_ENABLED=0` la apaga; estado en `/api/internal/ops?key=`); (3)
`/api/internal/cs2raw?key=` para SEMBRAR el crudo en el disco de Render (subir gzip; sin esto el primer día
re-cosecharía todo); (4) backfill de boxeo con `GP_BOXING_BACKFILL=1` (una vez por boot, Wikipedia no limita
la IP de Render); (5) panel de créditos arreglado: `quota_updated_at` (migración 045) — la fecha de la cuota
ya no miente; (6) memMarks finos dentro de buildHoopsPicks y combatCloudbetRefresh (solo instrumentación).

**⚠️ CONGELADO HASTA EL DOM 23:** las temporadas históricas de baloncesto (games-nba-2024/2025,
games-wnba-2023/24/25, ~55 MB) están SOLO en la rama `claude/gpsim-combat-visual-boxing-276pin`, NO en main:
`store.load()` re-ajusta el rating con TODOS los `games-*` del disco y meterlas ahora cambiaría la decisión
en mitad de la ventana. El domingo 23: fast-forward de main a la rama + re-fit + validación. Los artefactos
`fit-*.json` que el backfill reescribió se REVIRTIERON por lo mismo.

## 🔬 CS2 2.0 — VALIDACIÓN, MODELO NUEVO Y ROSTER (16-ago, tercera pasada)

Sobre el blueprint 2.0. Lo que sigue es lo entregado, y **lo primero es una corrección a mí mismo**.

### ⚠️ LA VALIDACIÓN TUMBÓ EL MODELO QUE YO HABÍA DEFENDIDO
`scripts/cs2-validate.js` recorre los 48.678 mapas en orden cronológico estricto y predice cada uno con el
estado ANTERIOR a jugarlo (walk-forward por construcción, punto en el tiempo real). Cinco predictores sobre
exactamente los mismos mapas:

| predictor | skill de Brier | AUC |
|---|---|---|
| moneda (0,5) | 0 % | 0,500 |
| **Elo GLOBAL** (ignora el mapa) | **6,88 %** | 0,649 |
| Elo por mapa | 3,04 % | 0,600 |
| tasa por mapa | 1,00 % | 0,577 |
| **modelo que estaba desplegado** | **2,12 %** | 0,589 |

El argumento «Elo POR MAPA, no global» que escribí con toda confianza en el código, en `PROJECT_STATE.md` y
en el documento Word que entregué **estaba mal**. Partir el historial de un equipo en siete mapas deja cada
trozo con un séptimo de la muestra; el ruido se come la señal y el modelo acaba por debajo de ignorar el
mapa entero.

### La corrección (módulo 9 del blueprint 2.0)
El mapa no se tira: se degrada de rating a **corrección** sobre la fuerza global.
`logit(p) = CAL_SLOPE × [ logit(p_elo_global) + LAMBDA × (efecto_A − efecto_B) ]`, con
`efecto(equipo,mapa) = (su tasa en ese mapa − su tasa global)` encogido por muestra.
λ y el encogimiento se ajustaron en 2024-2025 y **se confirmaron en 2026 sin volver a tocarlos**:

**jerárquico calibrado → skill 7,28 % · AUC 0,652 · ECE 0,0081 · pendiente 0,999** (3,4× lo desplegado).

### Roster: org ≠ roster (P0.5, el 2,0/10 del scorecard)
`scripts/cs2-roster.js` — 20.278 jugadores, **2.443 organizaciones, 689 con quinteto completo, 44 con cambio
reciente**. El proveedor da la plantilla ACTUAL, no el histórico, así que se toma una **foto diaria**: el
lineage propio con fechas efectivas empieza hoy. Un cambio reciente **ensancha la incertidumbre** (+2,6 pp
por equipo afectado) en vez de fingir que el historial sigue describiendo al equipo. Repesar el pasado por
parecido de alineación queda pendiente y se declara como pendiente.

### Ficha del modelo (P0.9)
Cada constante etiquetada **aprendida / convención / doctrina / experimental**, con su motivo, servida en la
API y pintada con código de color. Una constante sin etiqueta se lee como si estuviera medida y la mayoría
no lo están (el coeficiente de veto y el momentum de serie son experimentales, no ajustes).

### Lo que sigue faltando, por orden
1. **Baseline de mercado y CLV** — sin histórico de cuotas de CS2 no se puede decidir si alguna familia
   merece picks públicas. Es la comparación que falta y está declarada en pantalla.
2. Histórico de vetos reales (Liquipedia) para sustituir el coeficiente supuesto.
3. Multi-book: medido hoy, bo3 no da cuotas y Kalshi/Polymarket no cotizan partidos de CS2.
4. Demos .dem para economía, lados T/CT y jugadores.

### Operación nueva
```bash
node scripts/cs2-harvest.js                 # base histórica (semanal)
node scripts/cs2-roster.js                  # plantillas + foto del día (DIARIO: cada día que falte es lineage perdido)
node scripts/cs2-validate.js --json=...     # re-validar tras tocar el modelo
```

---

## 🔫 CS2 — BASE HISTÓRICA PROPIA Y CAPA VISUAL (16-ago, segunda pasada)

Alexis rechazó la primera entrega con tres reproches justos: UI de tablas apiladas sin una imagen, foco
disperso en cuatro juegos cuando el blueprint era **solo de CS2**, y dependencia de un único proveedor
pudiendo construir data propia. Esto es la respuesta.

### La base propia (`data/esports/cs2/`, 956 KB versionados)
`scripts/cs2-harvest.js` + `data-providers/esports/bo3.js` → **48.678 mapas, 48.486 con los dos equipos
resueltos (99,6 %), 1.031 equipos con perfil**. El crudo (25 MB) queda en el disco persistente; solo viajan
los agregados, que son *nuestras* definiciones de features:
- fuerza por mapa encogida hacia el 50 % con decaimiento (media vida 180 días) y peso por tier
- **Elo POR MAPA**, no global: en CS2 un equipo puede ser top en Mirage y flojo en Nuke
- distribución real de rondas, prórroga y palizas por mapa

Re-cosechar: `node scripts/cs2-harvest.js` (incremental) o `--aggregate-only` para re-derivar sin red.

### Lo que cambió porque ahora hay datos
| Antes | Ahora |
|---|---|
| fuerza por mapa `null` → **el tablero de veto no existía** | se dibuja con la fuerza real de los dos equipos |
| prórroga 12,8 % asumida | **11,4 % medida**, y distinta por mapa |
| arrastre económico elegido a ojo | **ajustado por mapa** para reproducir su prórroga real; el residuo en rondas se publica |
| pool de mapas escrito a mano | **deducido de lo que se juega**, con desempate por tendencia |
| sin mercado → pantalla con un guion | **GP da su propia probabilidad** simulando la serie sobre la fuerza por mapa |

El desempate del pool merece una nota: Cache y Overpass empataban en volumen reciente, pero los 259 mapas de
Cache son **todos** de los últimos 100 días (entra al pool) y los de Overpass son el rescoldo de 2.617
históricos (sale). Ordenar por volumen a secas habría dejado fuera al mapa que se va a jugar.

### Resolver a qué equipo pertenece cada mapa (fallaba en un tercio)
El proveedor guarda el **nombre del clan**, no el id, y no coincide con el del equipo casi un tercio de las
veces. Buscarlo entre 8.359 equipos fallaba en el 31 % y, cuando acertaba por casualidad, podía asignar el
mapa al equipo equivocado — peor que perderlo. Se cambió el problema: **el mapa pertenece a uno de los DOS
equipos de su partido**. De 31 % sin resolver a 0,4 %. Aparte, `norm()` NO limpia "academy"/"junior": al
limpiarlos, Team Spirit heredaba el historial de su filial.

### La capa visual
Logos reales del histórico; **planos de los siete mapas dibujados en SVG aquí dentro** (dos sitios, medio y
conectores — ninguna imagen de terceros, y más legible que una captura); héroe con halo de incertidumbre;
tablero de veto con las siete cartas; escalera de ventaja por mapa; y el perfil de rondas con la simulación
**dibujada encima de lo observado**, para que el modelo se pueda juzgar en vez de solo creer.

### ⚠️ La dependencia que hay que resolver
El `robots.txt` de bo3.gg desaconseja el acceso automatizado a `/api/`. Es el riesgo que el blueprint señala
para HLTV. Decisión consciente y reversible: se usa para arrancar, detrás de un adaptador que es lo único
que sabe que bo3 existe. **Hay que pedir acceso a Liquipedia** (tiene vía oficial) y, con él, cambiar de
fuente cuesta un archivo. Lo que sigue faltando para el blueprint completo: veto histórico real (hoy el
árbol se deriva de la fuerza por mapa), y demos .dem para la economía de ronda.

---

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
- **Sonda de servidor**: `?probe=<juego>` en la misma ruta interna ejecuta pizarra + ficha del motor +
  una partida y devuelve tiempos y errores. Los cuatro juegos en verde (pizarra 1,5-2,9 s en frío).
- **Navegación por clic verificada** en escritorio y móvil, en los cinco deportes.

### 🐞 EL FALLO QUE SE ESCAPÓ AL PRIMER DESPLIEGUE, y la lección de método
Alexis lo reportó en cuanto entró: *"me aparece la pestaña de Esport pero nada me carga"*. **`NAV_HASH` no
tenía las cinco vistas de esports**, así que `compHash` devolvía `undefined` y `navTo` hacía `setHash('')`
— que es el hash del board de FÚTBOL. Cada clic del menú, y el propio botón del deporte, cambiaban la barra
lateral a esports y dejaban al usuario callado en otro deporte.

**Las vistas estaban perfectas.** Se pintaban, respondían y devolvían datos correctos por URL directa. Lo
que no existía era el camino del clic hasta ellas. Y ese es el punto: **toda la verificación previa navegó
escribiendo la URL (`#esopps`), nunca pulsando el menú**, así que ese camino no se ejercitó ni una vez. Una
prueba que entra por la puerta de atrás no prueba la puerta de delante.

Corregido en tres partes: las cinco vistas en `NAV_HASH`; el juego elegido viaja en el hash
(`#esboard/lol`), igual que la liga en baloncesto; y `navTo` cae al nombre de la vista en vez de a la cadena
vacía cuando falta una entrada — porque la cadena vacía no da error visible, da un menú que "no hace nada".
**Al añadir un sexto deporte: la prueba se hace a golpe de clic, no por URL.**

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
