# PLAN DE LANZAMIENTO — Dardos + Tenis de mesa al público (9-sep-2026)

> Plan de trabajo de los 9 puntos pedidos por Alexis el 9-sep. Escrito con reconocimiento previo del código
> (tres exploraciones: gating/tiers, landing/planes/i18n, broadcast/bajas). **Quien lo ejecute —sea el
> modelo que sea— sigue este documento al pie de la letra y marca cada punto en la sección "Estado" al
> terminarlo.** Las anclas `archivo:línea` son del árbol al 9-sep; si el archivo cambió, buscar por el
> texto citado, no por el número.

## Reglas para el ejecutor (no negociables)
- Árbol de trabajo: `scratchpad/repo` (el checkout `/home/user/gp-simulador-mundial` está VIEJO).
- Secretos: `kexp.txt` (GP_EXPORT_KEY), `rnd.txt` (Render API key), `ui/tok.txt` (Bearer admin) en el
  scratchpad. Jamás en el repo, jamás impresos en el chat.
- Commit: `git -c user.name="GP" -c user.email="alexisgomezico@gmail.com" commit -F <msgfile>` con
  trailers `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` y
  `Claude-Session: https://claude.ai/code/session_01PNwX8taxH48hKcfERQgi87`. Sin identificadores de modelo
  en código, docs ni mensajes de commit fuera de esos trailers.
- Deploy: `git push origin claude/gpsim-continuation-vrjuww` + `git push origin HEAD:main` + POST
  `https://api.render.com/v1/services/srv-d8krl8flk1mc73c9hbi0/deploys` + pollear hasta `live` +
  `curl -s -o /dev/null -w '%{http_code}' https://gpsimulador.com/api/health` == 200.
- **Nunca** `node server.js` en el sandbox. Verificar con `node --check` + humo `node scripts/llm-smoke.js`
  + Playwright contra prod (harness `scratchpad/ttfix/prod.js`: proxy + flags TLS ya resueltos).
- No tocar la lógica de modelos, sombras congeladas (`cards_under_v1`, `cs2_rounds_v1`,
  `lol_kills_hcp_v1`, `corners_over_v1`), ejecutor real ni dardos-modelo. Este plan es de PRODUCTO.
- Producto se llama "GP Simulador". Disclaimer siempre: "estimaciones de un modelo estadístico, no consejo
  financiero".

## ⚠️ Advertencia previa (leída y asumida por Alexis al ordenar el plan)
`data/darts/RIGHTS.md:18` y `data/tt/RIGHTS.md:24` dicen literalmente que ninguna fuente autoriza abrir el
deporte al público ni cobrar por él (Orakel e ITTF: research-only; PDC y WTT: comercial UNKNOWN). Abrir y
luego cobrar por tier es una decisión de negocio del dueño, no técnica. Mitigación que SÍ aplica el plan:
(a) el motor, el rendimiento y la ficha de modelo quedan admin-only (caja negra + no exponer lo derivado de
Orakel/ITTF como producto), (b) las fotos se enlazan, nunca se rehospedan, con crédito visible, (c) ambos
RIGHTS.md registran la decisión con fecha y dueño. El riesgo de revocación queda documentado en TODO_NEXT.

---

## ORDEN DE EJECUCIÓN
P0 plan (este doc) → **P1 fotos** (datos, independiente) → **P4+P5 apertura + ventana** (server + UI) →
**P6 idioma** (sobre la apertura) → **P2 landing** → **P3 planes** → deploy único de P2–P6 + verificación
en prod con Playwright (ES y EN, móvil 390px y desktop) → **P7 email** (EN ya, ES +6 h por cola del
servidor) → **P8 vídeo promo** → **P9 tráiler**. P8/P9 no dependen del código; si el contexto se agota,
van al final sin bloquear nada.

---

## P1 — Fotos de dardos
**Diagnóstico.** `data/darts/players.json`: 4.942 jugadores, 318 con `photo` (todas PDC CDN). Los 128 con
tarjeta la tienen. El hueco es Challenge/Development Tour/Women's Series (Henry Coates 605 partidos sin foto,
Jamai van den Herik 581, Danny Jansen 529…). Entre n≥30: 1.348 jugadores, 281 con foto. `photo_src` nunca
se rellenó (los 318 aparecen sin fuente). El cosechador ya trae `--photos` (Wikipedia REST summary, filtro
`description` con "darts", reintento "(darts player)"), pero jamás se aplicó al compacto versionado.
Probado desde el sandbox: Wikipedia REST y Commons API responden; Coates/van den Herik tienen artículo
SIN imagen; Commons tiene 166 archivos para "John Henderson darts" (fotógrafos CC BY-SA de European Tour).

**Fuentes permitidas y orden de preferencia** (todas se ENLAZAN, no se rehospedan):
1. PDC CDN (`images.gc.pdcservices.co.uk`) — ya en base; `photo_src:'pdc'`.
2. Wikipedia pageimage (thumbnail 400px) — `photo_src:'wikipedia'` + `photo_credit:{page}`.
3. **Wikimedia Commons** búsqueda `list=search&srnamespace=6&srsearch="<Nombre>" darts` → primer
   resultado cuyo `imageinfo.extmetadata` tenga `LicenseShortName` ∈ {CC BY*, CC0, Public domain} →
   `thumburl` (iiurlwidth=400) + `photo_credit:{author: Artist sin HTML, license, page: descriptionurl}`.
   `photo_src:'commons'`.
4. Nada más: Flashscore/Orakel/Google NO (derechos). Nada de avatares generados para personas reales.

**Cambios.**
- `scripts/darts-harvest.js`: en `harvestPhotos()` (línea ~60) añadir el paso Commons cuando Wikipedia
  falle; en `mergeWikiPhotos()` (~95) guardar `photo_src` y `photo_credit`; en el build (~277-278)
  preservar `photo_src ∈ {wikipedia,commons}` y `photo_credit` al re-cosechar; rellenar `photo_src:'pdc'`
  cuando `photo` venga de la PDC. Filtro de candidatos: `!p.photo && p.n >= 30` (1.067 nombres), 2 req/
  nombre, 400 ms entre nombres → ~20 min. Ejecutar desde el sandbox con `GP_DARTS_RAW=<scratchpad>/darts-raw`
  y salida al repo (`data/darts/players.json`). Caché negativo ya existe (`WIKI_TTL_NEG`).
- `darts-engine/store.js:671` (ficha) y `:639` (ranking): exponer `photo_src` y `photo_credit`.
- `public/premium.js` ficha de jugador (`renderDtPlayer` ~14676): bajo la foto, línea de crédito
  `esT('Foto: ','Photo: ') + author + ' · ' + license + ' · Wikimedia Commons'` (enlace a `page`) cuando
  `photo_src==='commons'`; para `wikipedia` "Foto: Wikipedia". Sin crédito para PDC (ya atribuida en pie).
- `data/darts/RIGHTS.md`: filas Wikipedia y Wikimedia Commons (display ALLOW con atribución; licencia por
  archivo en `photo_credit`; revocación = borrar `photo` de ese `photo_src`).
- Commit del `players.json` regenerado (solo cambian `photo/photo_src/photo_credit`; verificar con un diff
  que `n`, `elo` y demás no cambian → si el build re-cosecha, NO usar `--build`, solo `--photos`).

**Verificación.** Contar cobertura antes/después entre n≥30 (objetivo: ≥ 55 % desde 21 %); abrir 5 fichas
en prod (Coates, van den Herik, Henderson…) y ver foto + crédito; una foto rota debe seguir cayendo a
iniciales (`faceImg onerror`).

---

## P4 + P5 — Abrir dardos y TT a todo el mundo; 7 días libres; luego tier
**Hechos.** Ambos deportes ya están cableados por tier igual que tenis (`server.js:20494-20579`:
`nsPlanCtx`, lista Pro `sim/read/brief/track`, `dtStrip/ttStrip` con `picks_locked`). Lo único que los
cierra es `GP_DARTS_PUBLIC_ENABLED` / `GP_TT_PUBLIC_ENABLED` (`:20497-20498`, `:20545-20546`). La ventana
libre global `newSportsFreeUntil()` (`:1548`) expiró el 31-ago: si solo se enciende la bandera, los no
admin caen directos al reparto free/pro/sharp. Precedente exacto de ventana: `GP_NEWSPORTS_FREE_UNTIL` y
`GP_COMBAT_FREE_UNTIL`.

**Decisiones.**
- Apertura por CÓDIGO, no por env: helper `pubOn(name)` = `!/^(0|false|no|off)$/i.test(process.env[name]
  || 'on')` para `GP_DARTS_PUBLIC_ENABLED` y `GP_TT_PUBLIC_ENABLED` (la env queda como interruptor de
  emergencia). Aplicarlo en los 5 sitios: guardas `:20497`, `:20545`, `/api/me` `:17410` (hoy `=== 'true'`,
  inconsistente), Ask GP `:18636-18643`.
- Ventana: `dartsTtFreeUntil()` = `Date.parse(process.env.GP_DARTS_TT_FREE_UNTIL || '2026-09-17T00:00:00Z')`
  (7 días completos desde el 10-sep 00:00Z). `nsPlanCtx(u, url, freeUntil = newSportsFreeUntil())` gana un
  3er argumento; los callers de dardos (`:20499`) y TT (`:20547`) pasan `dartsTtFreeUntil()`. Ask GP:
  `newSportsPlanOk(u, dartsTtFreeUntil())` con el mismo argumento opcional.
- `/api/me`: añadir `dartsTtFreeUntil`.
- Caja negra (regla `HANDOFF.md:1506`): `/api/darts/model` (`:20536`) y `/api/tt/model` (`:20573`) →
  404 si `!ns.admin`. En `dtStrip/ttStrip` y en las respuestas de `board/match/tournament/track`: borrar
  `doctrine` para no admin (el texto describe el mecanismo). `kernels`/`implied`/`equivalences` se quedan:
  son evidencia (estadística del jugador, proceso implícito de mercado), no receta.
- `public/premium.js`:
  - `:1288` `NS_SIM_VIEWS` + `'ttsim'`; `:1289` `NS_ASK_VIEWS` + `'ttask'`; `:1357` `PERF_VIEWS` +
    `'ttperf'`; `:1360` `MODEL_VIEWS` + `'ttmodel'` (`PERF_HOME` ya tiene ambos en `:1373`).
  - Bloque post-`/api/me` `:19774-19798`: añadir `['tt', ttAllowed()]` a `barraVieja`; `TT_VIEWS` y `'tt'`
    al rebote `:19785`; rama `else if (TT_VIEWS…) renderTT` `:19792-19798` (hoy `#ttopps` deja spinner).
  - Ventana en el navegador: `dtTtLibres()` = `Date.now() < S.me.dartsTtFreeUntil`; `nuevosPlan()` (`:1254`)
    debe devolver `'sharp'` para vistas DT/TT mientras dure (parámetro opcional `until`). `nsLockHtml(v)`
    (`:1320`) usa `lock_dt_t/lock_dt_s` (claves nuevas ES/EN: "Dardos y tenis de mesa estuvieron abiertos
    para todos durante siete días…") cuando `v` es DT/TT.
  - `freeBanner()` (`:1435`): durante la ventana, banner "Dardos y tenis de mesa abiertos para todos hasta
    el {fecha}" con enlace `#dtopps`; fuera de ella, nada (no reabrir el de los cinco).
  - `setLang` (`:19590`): añadir `DT_VIEWS → renderDarts(S.view)` y `TT_VIEWS → renderTT(S.view)` (y de
    paso BB/ES/NFL/TEN/F1 si sus dispatchers son `renderX(v)`): hoy cambiar de idioma sobre una vista de
    dardos/TT no repinta.
- Docs: `CLAUDE.md` (puntos dardos y TT: "público desde 10-sep, 7 días libres hasta 17-sep, luego tier"),
  `PROJECT_STATE.md:64-65`, `HANDOFF.md`, ambos `RIGHTS.md` (sección Consecuencias: "Decisión del dueño
  9-sep: abierto al público; riesgo asumido; ver PLAN_LANZAMIENTO_DARDOS_TT.md"), `TODO_NEXT.md` (riesgo).

**Verificación (Playwright en prod, usuario NO admin y admin con `?asplan=free`).** Pestañas 🎯 y 🏓
visibles sin sesión admin; `/api/tt/model` y `/api/darts/model` → 404 sin admin; `#ttmodel`, `#ttperf`,
`#dtmodel`, `#dtperf` redirigen a opps; con la ventana abierta un free ve picks en `dtopps/ttopps` y
puede entrar a sim/brief/ask; con `GP_DARTS_TT_FREE_UNTIL` forzado al pasado (probar con `?asplan=free`
tras la fecha, o temporalmente en preview) las tesis salen `picks_locked` y el candado dice "Pro y Sharp".
`/api/me` devuelve `dartsPublic:true, ttPublic:true, dartsTtFreeUntil`.

---

## P6 — Idioma (EN) en dardos y TT, al detalle
**Hechos.** El frontend está casi entero envuelto en `esT()`/`t()` (294+208 llamadas en dardos, 435+42
en TT); los 147 `dt_*/tt_*` existen en ES y EN. El problema real son los **textos que manda el servidor en
español** y se pintan con `esc()`: 16 sitios en dardos, 18 en TT (motivos de puerta `fail.gate/detail`,
`no_pick_reason`, `why`, `note`, `inactive_note`, `index_note`, `tier_label`, `label`, doctrina, Evidence
Lens `R.note`). La red de seguridad `EN_X/EN_FRAG/EN_RX` (`premium.js:19835-19877`) solo traduce el 9 %
de los literales de `darts-engine/store.js` (7/77) y `tt-engine/store.js` (8/88). Además el servidor jamás
emite `why_en` (`darts-engine/store.js:358`, `tt-engine/store.js:376` solo `why_es`), así que en EN la
tesis pierde la narrativa de `whyOf()` y cae a una frase genérica (`premium.js:14005`, `:15242`).

**Decisiones.**
1. **Servidor bilingüe en origen** (lo robusto): en ambos stores añadir `whyOfEn()` (misma plantilla por
   familia, en inglés) y emitir `why_en` junto a `why_es`. Añadir `gate_en`/`detail_en` a las razones de
   puerta y `note_en` a `note/inactive_note/index_note` de ficha/ranking/sim/brief/track, `label_en` en
   `FAMILIES`/`tier_label`. El frontend elige `S.lang==='en' && x.gate_en ? x.gate_en : x.gate` en los 34
   sitios listados (helper `srvT(obj,'gate')`).
2. **Red de seguridad completa**: script `scripts/i18n-extract.js` que saca TODOS los literales ES de los
   dos stores + `server.js:12053/12081` (notas del brief) y comprueba cuáles no pasan `enTxt()`; los que
   falten van a `EN_X` (frase exacta) o `EN_RX` (con números) en `premium.js:19861+`. Objetivo: 0 sin
   traducir en el script (hoy 150).
3. Defectos puntuales: `DT_SIM_FORMATS` (`premium.js:14836`) bilingüe; comparación centinela
   `'sin presupuesto de jobs para hoy'` (`:14940`, `:15926`) → comparar contra `d.intro_error_code` o
   dejar el ES pero mostrar `esT()`; `setLang` repinta DT/TT (P4).
4. Panel de inteligencia: `dtMemo` (`:14269`), `ttMemo` (`:15468`), `ttEvidencePanel` (`:15707`),
   `dtGatesPanel` (`:14633`), `ttGatesPanel` (`:15735`), `renderDtBrief/renderTtBrief` (`note` del
   servidor): todos pasan por `srvT`. Nombres propios de paneles ("Evidence Lens", "Service Braid") se quedan
   en inglés en ambos idiomas por diseño.

**Verificación.** Playwright en prod con `gp_lang=en`: recorrer las 13 vistas DT y 14 TT (incluida una
ficha de jugador, un partido con tesis, un torneo, sim, brief, ask) y volcar los nodos de texto que casen
con `EN_MARK` (detector de español del propio `premium.js`). Lista permitida: nombres de personas,
torneos y ciudades. Cualquier otro hallazgo se corrige y se repite hasta lista vacía. Misma pasada en ES
para comprobar que nada quedó en inglés por error (salvo nombres de paneles).

---

## P2 — Landing con los dos deportes nuevos
**Hechos.** Landing real = `public/landing.html` (solo español, sin `data-k`) + `public/landing.js`
(DICT solo para modal/CTA/banner). Meta OG (`:21-23`) está VIEJA ("fútbol y combate").
**Cambios (`public/landing.html`).** `:21` y `:23` metas → "once deportes con motor propio: fútbol (24
ligas), combate, tenis, baloncesto, esports, fútbol americano, F1, dardos y tenis de mesa"; `:364` "ONCE
DEPORTES"; `:392` pill "Once deportes · un motor para cada uno"; `:397-398` lede añade "dardos y tenis de
mesa"; `:421` sub; `:439-443` eyebrow "LOS ONCE", h2 "Once deportes. Once motores.", sub: "Dardos y tenis
de mesa abren para todos los planes durante siete días"; `:445-503` dos tarjetas nuevas tras F1:
`10-dardos.webp` (🎯 **Dardos** · PDC · 501 visita a visita) y `11-tenis-mesa.webp` (🏓 **Tenis de mesa**
· WTT · punto a punto), ambas `st on` "Abierto"; `:672` "Once deportes…"; `:759` "los once deportes";
`:780-784` cinta + `['DARDOS','501 · 180s · checkout'], ['TENIS DE MESA','WTT · games · deuce']`.
`public/landing.js` `:15/:143` (`lb_txt`: "Dardos y tenis de mesa abiertos para todos esta semana" /
EN), `:109/:236` ("Once deportes…" / "Eleven sports…"), `:90/:218` FAQ deportes.
**Imágenes.** Mirar `public/landing/deportes/01-futbol.webp` (estilo, encuadre, 720×480) y generar dos con
Higgsfield `nano_banana_pro` (2 créditos c/u) en el mismo estilo: dardos (diana + tirador de espaldas, luz
de escenario, sin logos ni caras reconocibles) y tenis de mesa (mesa azul, pelota en el aire, sin logos).
Convertir a webp 720×480 con sharp/ffmpeg en el sandbox de Higgsfield o con `cwebp` local si está.
**Verificación.** Playwright a `https://gpsimulador.com/landing` móvil y desktop: 11 tarjetas, cinta con los
dos nuevos, sin overflow horizontal; OG con `curl -s | grep og:description`.

---

## P3 — Página de planes
**Hechos.** `/plans` = `public/founder.html` autocontenido (DICT propio ES `:114-183`, EN `:184-251`), sin
matriz de tiers en servidor. `sports[]` `:123-127` (ES) y `:191-195` (EN) con `[emoji, nombre, abierto]`.
**Cambios.** Añadir `['🎯','Dardos',1]` y `['🏓','Tenis de mesa',1]` / `['🎯','Darts',1]`,
`['🏓','Table tennis',1]`. `:118-121`/`:186-189`: "once deportes"; `sub` (`:120`/`:188`): "Y durante
esta semana, dardos y tenis de mesa se abren para todos los planes". Filas: `f_free` `:144`/`~202` →
"Dardos y tenis de mesa (abiertos esta semana para todos)"; `f_sharp` `:165`/`~226` añadir "dardos y tenis
de mesa" a la lista; FAQ `:176`/`:244` (lista de deportes: añadir "dardos (PDC) y tenis de mesa (WTT)") y
`:179`/`:247` (qué incluye cada plan: mencionar que tras la semana abierta dardos/TT siguen la regla
general: free = agenda, fichas y ranking; Pro = tesis, brief, simulador y Ask GP; Sharp = precios
cruzados). Precios no se tocan.
**Verificación.** Playwright `/plans` ES y EN: 11 chips, textos nuevos, sin roturas de layout.

---

## P7 — Email masivo (EN ahora, ES a las 6 h)
**Hechos.** `/api/admin/broadcast` (`server.js:25398-25536`): solo acepta `variant` (plantillas
hardcodeadas), `count` (ensayo), `schedule_at` (cola persistente `db.scheduledBroadcasts`, disparo cada 5
min por `server.js:9946-9974`), `test`. Destinatarios = `Object.keys(db.users)` filtrado por
`notSuppressed` (`no_bulk`). Precedente idéntico al pedido: `sportsclosed_es` el 31-ago a todos (963/965)
y `sportsclosed_en` programado a +6 h. Idioma por usuario existe (`userLang`) pero las variantes `_es/_en`
van a TODOS en ese idioma: es lo que Alexis pide (EN primero, ES a las 6 h).
**Exclusiones.** No existe contador de bajas ni marca de "solicitó borrar cuenta": el borrado es físico
(`/api/internal/delete-user`, `server.js:24177`) → esos ya no están en `db.users`; las bajas/unsubscribe
son `no_bulk:true` (booleano, sin conteo). **Decisión:** excluir a TODOS los `no_bulk` (conservador: quien
pidió baja una vez no recibe). Añadir de paso el contador `no_bulk_n` en `/api/internal/suppress`
(`server.js:24166`) para que la regla "≥2" sea aplicable en el futuro. Anotar en el plan y en TODO_NEXT que
el histórico no es recuperable.
**Plantilla.** Nueva `dartsTtEmail(lang)` junto a `gpNineEmail` (`server.js:2366`), estilo B "personal"
(playbook `server.js:2347-2365`: remitente `REENGAGE_FROM`, `noListUnsub:true`, texto plano en párrafos,
asunto en minúsculas sin emoji, termina con pregunta). **Sin línea "responde baja"** (orden explícita, igual
que `sportsClosedEmail`). Contenido: dos deportes nuevos con motor propio (dardos: 501 visita a visita,
PDC; tenis de mesa: punto a punto, WTT), abiertos para TODOS los planes hasta el 17-sep, después según
plan; enlace en texto plano `https://gpsimulador.com/#dtopps`; disclaimer de una línea. Variantes
`dartstt_en` / `dartstt_es` en la cadena `server.js:25443-25495`. Asuntos: EN "two new sports: darts and
table tennis, open for everyone this week" / ES "dos deportes nuevos: dardos y tenis de mesa, abiertos
para todos esta semana".
**Procedimiento (solo tras verificar P2–P6 en prod).** 1) `POST ?key= {variant:'dartstt_en', test:true}`
→ leer el email de prueba en el buzón admin. 2) `{variant:'dartstt_en', count:true}` → anotar
`would_send/suppressed`. 3) `{variant:'dartstt_en'}` → pollear `GET` hasta `running:false`, anotar
`sent/failed`. 4) `{variant:'dartstt_es', schedule_at: <ahora+6h ISO>}` → confirmar en `GET .queue`.
5) Programar un `send_later` a +6 h 10 min para comprobar que el ES se disparó (`GET` → `queue[].done`,
`bcastState`). Registrar en HANDOFF.

---

## P8 — Vídeo promocional dardos + TT (EN y ES) con Higgsfield
**Presupuesto.** Saldo 890,5 créditos (plan Plus). Costes medidos: `gemini_omni_flash_1_1` 8 s 1080p 16:9 =
36; `seedance_2_5` 8 s 720p = 52, 10 s 1080p = 90; imagen `nano_banana_pro` = 2; TTS `seed_audio` = 0,5.
Tope para P8+P9: **≤ 650 créditos**, reserva ≥ 200 para retomas.
**Diseño (ahorra la mitad).** Los clips son NEUTROS de idioma (sin texto en pantalla, sin voces): se
generan UNA vez y se montan dos veces (EN/ES) con locución y rótulos por idioma. Montaje en
`sandbox_exec` de Higgsfield (ffmpeg + fuentes Montserrat/Metropolis): concat de clips, ducking del audio
nativo bajo la voz, rótulos `drawtext`, tarjeta final con logo/URL y disclaimer. Versión 9:16 para
Instagram con `reframe` (o recorte central con ffmpeg si `reframe` cuesta más de 20 créditos).
**Guion (≈32 s, 4 clips × 8 s, gemini_omni_flash_1_1 16:9 1080p, 144 créditos).**
1. Diana en primer plano, dardo clavado en el triple 20 vibrando, luz cálida de escenario, humo, cámara
   lenta. VO EN: "Nine sports were not enough." / ES: "Nueve deportes no eran suficientes."
2. Pelota de tenis de mesa cruzando la red a cámara ultra lenta, mesa azul, gotas de sudor. VO: "Two more
   engines. Built from the first visit and the first point." / "Dos motores más. Construidos desde la
   primera visita y el primer punto."
3. Plano cenital abstracto: partículas/curvas de probabilidad que se resuelven en dos números
   (ambientación, sin UI inventada). VO: "Darts. Table tennis. Every match simulated before it starts." /
   "Dardos. Tenis de mesa. Cada partido simulado antes de empezar."
4. Skyline nocturno LATAM + teléfono en mano con reflejo verde (sin pantalla legible). VO: "Open for
   everyone, this week only. GP Simulador." / "Abierto para todos, solo esta semana. GP Simulador."
   Rótulo final: `gpsimulador.com` · "Dardos y tenis de mesa · abiertos hasta el 17-sep" · disclaimer.
Voces: `seed_audio` preset masculino grave para EN (probar "Holden"/"Arthur"), y para ES probar el mismo
motor con texto español (si el acento no convence, `text2speech_v2` variante `elevenlabs`). Marca visual:
verde `#18E6A3` sobre `#0E2A1E`, tipografía Montserrat ExtraBold, todo en minúsculas salvo GP Simulador.
**Entrega.** Descargar los MP4 (16:9 y 9:16 × EN/ES = 4 archivos) al scratchpad y enviarlos con
`SendUserFile`. Guardar prompts, job_ids y costes en `scratchpad/video/promo.json`.

---

## P9 — Tráiler cinematográfico de la plataforma (EN y ES)
**Concepto: "La pregunta antes de la apuesta".** Un tráiler de 60 s que no vende picks: vende la sensación
de saber más que la línea. Tono: thriller sobrio, noche, teal y ámbar, silencios largos, un solo golpe de
sonido por escena. Sin caras reconocibles ni logos de terceros. **Nada de UI inventada**: cuando aparece la
plataforma es una captura REAL de prod (Playwright, móvil 390px, con datos del día) animada con zoompan.
**Escaleta (8 clips × 8 s, gemini_omni_flash_1_1 1080p, 288 créditos + capturas reales).**
1. Negro. Un reloj de estadio marcando 20:59. Respiración. VO: "Every bet starts as a question." / "Toda
   apuesta empieza como una pregunta."
2. Túnel de vestuario vacío, luz al fondo, cámara avanza. VO: "Who really wins this? Not who the crowd
   likes." / "¿Quién gana esto de verdad? No a quién quiere la gente."
3. Macro: dardo girando en el aire; corte a pelota de tenis de mesa; corte a balón cruzando una línea.
   VO: "So we built an engine for every sport. Not one model with eleven names." / "Así que construimos un
   motor para cada deporte. No un modelo con once nombres."
4. Insert REAL: captura del tablero de oportunidades (móvil) con zoom lento sobre una tesis y su
   probabilidad. VO: "Ten thousand simulations before kickoff. A probability, an edge, a reason." /
   "Diez mil simulaciones antes del pitido. Una probabilidad, una ventaja, un porqué."
5. Un hombre de espaldas en un balcón de ciudad latinoamericana de noche, teléfono en mano, luz verde en
   la cara reflejada en el cristal. VO: "And every pick is settled in public. Wins and losses. No
   deleting." / "Y cada pick se liquida en público. Aciertos y fallos. Sin borrar nada."
6. Insert REAL: captura del rendimiento/track (CLV por familia) con barrido. VO: "The market closes the
   line. We measure ourselves against it." / "El mercado cierra la línea. Nos medimos contra ella."
7. Montaje rápido (2 s cada uno): cancha de básquet vacía, octágono con luz, circuito de F1 mojado, diana.
   VO: "Football. Combat. Tennis. Basketball. Esports. American football. F1. Darts. Table tennis." /
   lista en ES.
8. Fundido a verde. Logotipo tipográfico "GP Simulador". VO: "GP Simulador. The number one sports
   intelligence platform for bettors." / "GP Simulador. La plataforma de inteligencia deportiva número uno
   para apostadores." Rótulo: `gpsimulador.com` · disclaimer legal en pequeño.
**Sonido.** No hay modelo de música: usar el audio nativo de cada clip (ambiente, golpes) + un "riser"
sintético de ffmpeg (`aevalsrc`) hacia el clip 8 + silencio de 0,5 s antes del logo. Voz grave y pausada,
`speech_rate` 0,9.
**Entrega.** 16:9 y 9:16 × EN/ES. Registro en `scratchpad/video/trailer.json`.

---

## Estado (rellenar al ejecutar)
- [ ] P0 plan escrito y commiteado
- [ ] P1 fotos dardos: cobertura n≥30 antes ___ % → después ___ %
- [ ] P4+P5 apertura + ventana + caja negra (server + premium.js + docs)
- [ ] P6 idioma: script i18n-extract = 0 pendientes; Playwright EN limpio en 27 vistas
- [ ] P2 landing (11 tarjetas, cinta, metas)
- [ ] P3 planes (ES/EN)
- [ ] Deploy + verificación en prod (health 200, Playwright ES/EN, móvil/desktop)
- [ ] P7 email EN enviado (sent/failed ___), ES programado a ___Z y confirmado disparado
- [ ] P8 promo: 4 archivos entregados, créditos gastados ___
- [ ] P9 tráiler: 4 archivos entregados, créditos gastados ___
