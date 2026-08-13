# Plan de trabajo — qué copiarle a Bet Hero (adaptado a la visión de GP Simulador)

> Análisis competitivo de **betherosports.com** (Bet Hero, de Infinit Software SL, Andorra) y plan de
> trabajo por fases. NO ejecutado — es el plan que pidió Alexis. Fecha: 13-ago-2026.

## Resumen de una línea
Bet Hero y GP Simulador atacan el mismo problema (ganarle al mercado de apuestas) pero desde
**filosofías opuestas**, y ahí está nuestra ventaja: **ellos NO modelan** — escanean 400+ casas, hacen
de-vig de Pinnacle y comparan contra el retail. Nosotros **sí modelamos** (Elo→Poisson→Monte Carlo +
motor de combate) y publicamos un track verificable. Lo que ellos hacen 10× mejor que nosotros no es el
producto, es el **empaquetado**: claridad de mensaje, funnel, onboarding, SEO y growth. Eso es lo que hay
que robar — la forma, no el fondo — y montarlo encima de nuestro moat (el modelo + el español/LATAM).

## ⚠️ La línea que NO cruzamos (crítico)
Bet Hero vende con **"ganancia garantizada", "make $50–100/day", "esto no es apostar, es matemática",
"la mayoría no ha tenido un mes perdedor"**. Para value betting eso es agresivo hasta lo temerario, y
**nuestros propios datos dicen que todavía NO tenemos edge probado** (fútbol -10% ROI, combate -3u).
Copiamos su ESTRUCTURA y CLARIDAD de mensaje, JAMÁS sus promesas de ganancia. Nuestra disciplina de
"estimaciones de un modelo, no consejo financiero" se queda. Cuando el ejecutor en la sombra pruebe un
edge real, ahí sí podremos hablar de resultados — con números auditables, no con claims.

---

## Radiografía de Bet Hero (lo que encontré)

**Producto**: escáner de +EV y arbitraje sobre 400+ casas en 190+ países, 22 deportes / 500+ ligas.
De-vig de Pinnacle/Circa → probabilidad "justa" → marca cada cuota retail que la supera. Kelly sizing,
tracker de apuestas con CLV, alertas en tiempo real. Superficies extra: Bet Checker, Middles, Dropping
Odds, live betting. Stack: Next.js, Cloudflare Turnstile (anti-bot), Stripe + Link, Rewardful (afiliados),
BetterStack (status page público), Discord (comunidad 5.000+), backend.betherosports.com. Multi-idioma
(es/fr/it/pt).

**Funnel**: prueba de **$1 por 7 días** (no gratis — califica comprador y captura tarjeta) → $35.98 /
$71.97 / $143.96 al mes (Starter/Plus/Pro), anual -40%, **15+ métodos de pago incl. cripto**, garantía de
devolución. Gating por **feature**, no solo volumen: Starter = prematch y bets <4% EV; Plus = sin límite
de EV; Pro = live + middles + dropping odds. Cada tier anclado con "ganancia media mensual $600/$1.800/$3.600".

**Activación**: correo de onboarding brutal en foco — *"Pick a green row. Place the bet. Track it. Done.
Tu primera apuesta rentable en menos de 2 minutos."* Time-to-first-value por encima de todo.

**Adquisición (su verdadero moat)**: biblioteca gigante de **30+ calculadoras** (Kelly, arbitraje, de-vig,
CLV, Poisson, EV, parlay, each-way, Lucky 15/31/63, Heinz, etc.) + páginas de **cuotas por deporte** +
blog + páginas de reseñas. Máquina de SEO orgánico. Prueba social: 12 reseñas de "expertos", Trustpilot,
"5.000+ miembros", "Rated #1 by...". Distribución: alertas Discord-first al teléfono + programa de afiliados.

---

## PLAN DE TRABAJO POR FASES

Cada fase: **qué hacen · qué copiamos · cómo lo adaptamos a GP**. El orden es por ROI/esfuerzo:
primero lo barato y de alto impacto (mensaje, onboarding), luego el moat de SEO (el robo grande), luego
producto. Días = estimación de trabajo enfocado, no calendario rígido.

### FASE 0 · Mensaje y posicionamiento (Días 1–3) — barato, altísimo impacto
- **Qué hacen**: copy concreto y orientado a resultado. Beneficio primero, mecánica después. "Bajo 1 hora
  al día", "cero conocimiento de deportes", pasos de 4 (Elige → Coloca → Cobra).
- **Qué copiamos**: la CLARIDAD y la jerarquía. Hoy GP se describe abstracto ("inteligencia deportiva").
  Bet Hero te dice qué haces, en cuánto tiempo, y qué obtienes.
- **Cómo lo adaptamos**: nuestro gancho honesto y diferenciador = **"El modelo + el mercado en un solo
  lugar"**. No "ganancia garantizada" sino "la lectura de un modelo propio contra lo que pagan las casas,
  con track público". Reescribir hero de la landing, /plans y el primer pantallazo de la app con esa voz.
  Mantener disclaimer. Deliverable: nuevos copys ES (y EN) para landing, /plans, onboarding.

### FASE 1 · Onboarding y time-to-first-value (Días 4–6)
- **Qué hacen**: del signup a la primera "apuesta rentable" en <2 min. Correo de activación con 3 pasos.
  Onboarding dismissible en la app.
- **Qué copiamos**: la obsesión con el primer momento de valor. Un usuario nuevo de GP hoy aterriza en un
  feed sin saber qué mirar primero.
- **Cómo lo adaptamos**: flujo guiado de 3 pasos → **"Mira la pick del día → entiende el porqué (la lectura
  del modelo) → sigue el resultado en público"**. Nuestro "green row" es la pick con su edge y su lectura.
  Añadir: secuencia de emails de activación (día 0 bienvenida+1ª pick, día 1 cómo leer una pick, día 3
  el track). Reusar el motor de broadcast que ya existe.

### FASE 2 · Arquitectura de precios y funnel (Días 7–9)
- **Qué hacen**: $1/7 días (captura tarjeta), gating por FEATURE, anclaje de "ganancia media" por tier,
  anual -40%, cripto + 15 métodos, garantía de devolución.
- **Qué copiamos**: (a) el **trial de $1** en vez de gratis puro — califica compradores y sube conversión;
  (b) gating por feature más nítido; (c) más métodos de pago, sobre todo **cripto** (encaja con nuestra
  audiencia LATAM y con Cloudbet); (d) plan anual con descuento fuerte.
- **Cómo lo adaptamos**: ya tenemos free/pro/sharp — mapear un **trial de $1** hacia Sharp (7 días), y
  evaluar cripto vía el mismo Whop/otro PSP. NO copiar el anclaje "$600/mes de ganancia" (sin edge probado
  es falso). En su lugar anclar con **valor entregado** (nº de picks, ligas, deportes, análisis por partido).
  Deliverable: nueva página /plans con trial $1 + comparativa por feature + cripto.

### FASE 3 · Moat de SEO: calculadoras + cuotas por deporte (Días 10–16) — EL ROBO GRANDE
- **Qué hacen**: 30+ calculadoras (Kelly, arb, de-vig, CLV, Poisson, EV, parlay, each-way, Lucky N…) +
  páginas de cuotas por deporte + blog + reseñas. Todo indexable, todo en inglés.
- **Qué copiamos**: la **biblioteca de calculadoras y páginas de cuotas** como motor de adquisición
  orgánica. Es contenido estático, barato de producir, y compone tráfico por años.
- **Cómo lo adaptamos**: **en ESPAÑOL, donde casi no hay competencia** — esta es probablemente nuestra
  mayor oportunidad de robo. Empezar por las 8–10 calculadoras de mayor búsqueda (Kelly, valor esperado,
  arbitraje, de-vig, cuota implícita, parlay/combinada, Poisson, CLV) + páginas "cuotas de [fútbol/UFC/
  NBA]" alimentadas por nuestro propio feed. Todas con CTA a la plataforma y a la pick del día. Es
  vanilla JS puro (nuestro stack), sin build. Deliverable: /calculadoras/* + /cuotas/* + 3–4 guías de blog.

### FASE 4 · Prueba social y confianza (Días 17–19)
- **Qué hacen**: 12 reseñas de expertos, Trustpilot, "5.000+ miembros", "Rated #1", status page pública,
  garantía de devolución.
- **Qué copiamos**: el apilamiento de señales de confianza y, sobre todo, la **status page pública** y la
  **garantía**. La status page proyecta seriedad de producto de pago.
- **Cómo lo adaptamos**: nuestra prueba social honesta y ÚNICA = **el track público verificable del
  modelo** (ellos no lo tienen — no modelan). Elevarlo a protagonista: "no confíes en nosotros, mira cada
  pick liquidada en público". Añadir status page (BetterStack o propia con nuestro /api/health), testimonios
  reales cuando los haya, y una garantía clara. NO inventar reseñas ni cifras de miembros.

### FASE 5 · Distribución: alertas, Telegram/Discord, afiliados (Días 20–24)
- **Qué hacen**: alertas Discord-first al teléfono en tiempo real, comunidad 5.000+, afiliados (Rewardful).
- **Qué copiamos**: (a) **alertas push/Telegram** de las oportunidades fuertes (ya publicamos al canal
  @gpsimulador — falta el push personal por usuario seguido); (b) **programa de afiliados** para crecer
  con incentivo; (c) la idea de **comunidad** como retención.
- **Cómo lo adaptamos**: Telegram encaja mejor que Discord para LATAM. Construir alertas por usuario
  (edge fuerte en sus deportes/familias seguidas), un programa de referidos con recompensa (ya hay
  cimientos de referidos en el código), y evaluar un grupo/canal privado para Sharp. Nuestra alerta tiene
  un plus que ellos no: **la lectura del modelo**, no solo "cuota X en casa Y".

### FASE 6 · Nuevas superficies de producto (Días 25–30)
- **Qué hacen**: Bet Checker (pega una apuesta y te dice si tiene valor), Middles, Dropping Odds
  (ver casas sharp mover la línea antes que el retail), tracker con CLV por deporte/casa, live betting.
- **Qué copiamos**: **Dropping Odds** (tenemos movimiento de línea ya en combate — generalizarlo y
  hacerlo superficie propia), **Bet Checker** (verificador de valor de una apuesta pegada), y el **tracker
  de cartera con CLV por deporte/casa** (tenemos CLV — falta el desglose y la UX de cartera personal).
- **Cómo lo adaptamos**: priorizar lo que ya tenemos medio construido: (1) Dropping Odds como vista, (2)
  Bet Checker apalancando nuestro de-vig, (3) cartera personal con CLV (Sharp). Middles y live quedan
  para después. Cada uno amarrado a "qué dice el modelo", que es nuestro diferencial.

---

## Lo que NO hay que copiar
- Las promesas de ganancia garantizada / "$50–100 al día" / "no es apostar" — sin edge probado es humo y
  nos expone. (La irónica ventaja: cuando el ejecutor en la sombra pruebe el edge, podremos decir la
  verdad con números — algo que ellos no pueden respaldar.)
- Reseñas/cifras de miembros infladas. Nuestra credibilidad se construye con el track público.
- Ser un escáner "sin modelo": ES nuestra diferencia. Reforzarla, no diluirla.

## Prioridad recomendada (si hay que elegir)
1. **FASE 3 (SEO en español)** — el mayor retorno compuesto y de bajo costo, campo casi vacío.
2. **FASE 0 + 1 (mensaje + onboarding)** — barato, sube conversión ya, mismo producto.
3. **FASE 2 (trial $1 + cripto)** — sube conversión de pago sin construir producto nuevo.
4. **FASE 5 (alertas/afiliados)** y **FASE 6 (superficies)** — crecimiento y retención a mediano plazo.

## Nota de acceso (para completar el análisis interno)
El dashboard interno no se pudo analizar desde este entorno (login con código + Cloudflare Turnstile, y
el navegador headless no cruza el proxy de egress). Para desmenuzar la UX interna: un screen-recording o
capturas del dashboard de la cuenta ya activa (Bet Hero Plus, prueba de $1) bastan. Recordatorio: la
prueba se renueva a $59.97 el 19-ago salvo cancelación.

---

# PARTE 2 — Análisis interno (con las 30+ capturas del dashboard) · 13-ago

Alexis entró con la cuenta de prueba y mandó el recorrido completo. Esto cambia y amplía el análisis:
ahora vi el producto por dentro, y lo más importante que descubrí **no es el producto — son los tres
motores de ingreso** y la maquinaria de crecimiento. Detalle:

## Lo que se ve dentro
- **Onboarding de 5 pasos**: (1) país → geolocaliza casas y moneda; (2) bankroll (monto, default $1.000);
  (3) [pago]; (4) nivel de experiencia (Principiante/Intermedio/Avanzado) → adapta la UX; (5) "¿cómo nos
  encontraste?" (atribución: amigo, IG, X, FB, TikTok, Discord, Reddit, Google, YouTube). Rápido, con
  barra de progreso, captura bankroll para el Kelly desde el minuto uno.
- **Precios GEOLOCALIZADOS**: la misma web muestra $29.98/$59.97/$119.96 para Gambia y $35.98/$71.97/
  $143.96 global. Ancla cada plan con **"se paga en ~2/~3/~5 apuestas"** (no con "$X de ganancia" —
  más honesto que su landing). Gating por feature (Plus: prematch value/risk-free, tracking, 22 dep/500
  ligas, sin límite de EV; ✗ live, ✗ middles, ✗ dropping odds). Anual −40%.
- **6 superficies** (tabs: Inicio · +EV · Arb · Middles · Caídas · Registro):
  - **+EV**: "viendo 122 de 9.253", prematch/en vivo, sort (EV, prob, evento, hora), refresh en vivo con
    play/pausa. Detalle de una pick: **EV%, cuota, cuota justa, probabilidad, comisión de mercado (vig),
    apuesta Kelly, "casas disponibles (143)", filtro "Solo sharps", y una "línea de cuotas justas" con
    varios libros sharp** (Polymarket, etc. con su máximo). Es exactamente nuestro de-vig + value, mejor
    presentado.
  - **Arb**: **157.616 oportunidades** (número que impresiona), refresh en vivo (contador 99/43), ARB%,
    beneficio garantizado, dos lados con casas. Ejecuta en **Polymarket y Sportsbet.io** (confirma la
    tesis de venues que te di: mercados de predicción + cripto books).
  - **Middles**, **Dropping Odds** (NEW): sharp recorta la línea → cógela vieja en tu casa (es nuestro
    movimiento de línea, generalizado). Ambas gated a Pro.
  - **Registro**: tracker personal con ROI, apostado, % ganadas, **calendario mensual de P&L**, desglose
    por casa y por deporte, añadir apuesta/transacción.
- **Tour guiado de 12 pasos** ("¡Hagamos tu primer surebet!") la primera vez — activación asistida.
- **30+ calculadoras**, **blog** (12 artículos + 4 guías), **páginas de cuotas por evento** (SEO: cada
  pelea/partido con "cuotas comparadas en N casas incluyendo...", Decimal/Americano, breadcrumb indexable).

## 🔑 LO MÁS IMPORTANTE: tienen TRES motores de ingreso, nosotros UNO
1. **Suscripción** (lo tenemos).
2. **CPA/afiliación de casas** — la página **Promos**: "regístrate en estas casas para más +EV" con bonos
   (Marca Apuestas 100€, Versus 200€, geolocalizado por país). Ellos cobran comisión por cada alta. Es un
   flujo enorme, alineado con el producto (más casas = más value para el usuario) y **no lo tenemos**.
3. **B2B white-label para Discord** — venden su motor de alertas a comunidades de tipsters con su marca
   ("tus miembros nunca ven nuestro nombre", gestor de cuenta dedicado). Clientes: Juiced Bets (2.000),
   Break The Odds (1.500), Lowkey (1.200), YAUPICKS (800); "+20 comunidades". Ingreso recurrente B2B, y
   **tenemos el motor para hacerlo** (ya publicamos al canal de Telegram).
4. **Afiliados de usuario** ("Refiere y gana"): código + "contenido que funciona como enlace de referido
   sin parecerlo" (compartir una apuesta / tus stats ROI-winrate-CLV / un mes), con **pago de saldo** al
   afiliado y actividad (clics, registros). Máquina de crecimiento viral que casi no tenemos.

## Respuestas a las tres preguntas de Alexis

### ¿Quién copió a quién?
**Ninguno.** Bet Hero es más viejo y pertenece a una categoría MUY poblada de escáneres de +EV/arb
(OddsJam, RebelBetting, Outlier, Trademate…). Es un clon pulido de ese patrón, con muy buen funnel +
Discord B2B + afiliados. GP nació de otra semilla: un **modelo propio** (Elo→Poisson→Monte Carlo +
combate). Son especies distintas en el mismo hábitat ("ganarle a la casa"). Lo único que se parece es la
**estética de dashboard de apuestas** (oscuro, verde, tablas densas, filtros, live refresh) porque TODA
la categoría converge ahí. No es copia en ningún sentido — es evolución convergente. Bet Hero es una
"versión futura" de nuestra parte de **value/arbitraje/growth**, no de nuestro corazón (el modelo).

### ¿Por qué pagaría alguien a GP y no a ellos, si ellos tienen más deportes y más todo?
Honestidad brutal primero: **para el trabajo "encuéntrame arbs y +EV en todas las casas del mundo", Bet
Hero gana HOY.** 400 casas, 22 deportes, arb en vivo, middles, dropping odds, 157k oportunidades. Si
competimos por ser mejor escáner, perdemos — y su breadth es BARATA para ellos (solo ingieren feeds de
cuotas; no modelan), mientras que para nosotros cada deporte cuesta un ciclo completo de modelado. Nunca
igualaremos su amplitud siendo model-first, ni debemos intentarlo.

Nuestra razón de existir es **otro trabajo**, y es defendible justamente donde ellos son estructuralmente
ciegos:
- **Ellos no tienen opinión; nosotros sí.** Un escáner DEFINE "el mercado de Pinnacle = la verdad" y busca
  dónde el retail se desvía. Por construcción **jamás puede decirte "el mercado está equivocado"**. GP
  tiene un modelo que SÍ discrepa del mercado — la misma pelea Garry vs Makhachev que ELLOS listan: su
  herramienta solo te dice qué casa paga distinto; la nuestra dice "el mercado da 26% a Garry y creemos
  que es 55%". Eso es **edge original**, no arbitraje de precio. Producto distinto, apostador distinto.
- **El porqué.** Ellos te dan un número y un link. Nosotros la lectura — la inteligencia de la pelea/el
  partido. Para quien quiere entender y aprender (no solo tocar filas verdes), esa es nuestra cancha.
- **LATAM nativo + combate modelado.** Ligas locales modeladas a fondo y un motor de combate propio que
  ningún escáner tiene.
- **Track público verificable del modelo.** Ellos no lo tienen — no modelan, no hay nada que verificar.

**La conclusión estratégica** (importante): no vencerlos escaneando. El escáner de value/arb debe ser
para nosotros una función "suficientemente buena" de mesa (table stakes), y el **MODELO + inteligencia +
track público** es la razón premium de quedarse. Y hay una decisión de producto que Alexis debe tomar:
  - **Opción A — Profundos, no anchos**: pocos deportes, modelados a fondo y explicados. Somos el
    "analista", no el "escáner".
  - **Opción B — Híbrido**: agregar un "modo escáner" de muchos deportes como tabla commodity (solo
    cuotas, sin modelo) para cerrar la brecha de amplitud en el trabajo value/arb, mientras los deportes
    modelados son el premium. Más caro en datos, pero neutraliza su mayor ventaja.
  Mi recomendación: **A con un toque de B** — no perseguir 22 deportes, pero sí que el escáner value/arb
  que ya tenemos cubra las cuotas de más ligas (barato) aunque el modelo solo opine en las nuestras.

## PLAN DE TRABAJO v2 (actualizado con lo interno)

Se mantienen las fases de la Parte 1 (mensaje, onboarding, precios, SEO, prueba social, superficies).
Lo interno agrega/re-prioriza:

### NUEVO A · Onboarding con captura de bankroll y nivel (Días 1–4)
Copiar el flujo de 5 pasos: país (para casas/moneda LATAM), **bankroll** (alimenta nuestro Kelly desde el
inicio — hoy no lo pedimos), nivel de experiencia (adapta el nivel de explicación — encaja perfecto con
nuestro diferencial "el porqué"), y atribución. Adaptado a nuestra estética. Deliverable: onboarding
modal de 4–5 pasos + guardar bankroll por usuario.

### NUEVO B · Segundo motor de ingreso: CPA de casas (Días 5–9) — alto ROI
Página "Casas recomendadas / Promos" con enlaces de alta a casas LATAM con las que cerremos CPA (empezar
por las que ya integramos: Cloudbet, y las locales). Alineado con el producto (más casas = más value) y
es dinero nuevo sin construir motor. Deliverable: página Promos + gestión de deals + tracking de clics.

### NUEVO C · Tercer motor de ingreso: B2B alertas white-label (Días 10–18)
Ofrecer nuestras alertas (con la lectura del modelo, que ellos no tienen) a comunidades de Telegram/
Discord LATAM, marca blanca. Reusar el motor de publicación que ya existe. Es recurrente y nos apalanca
en el diferencial. Deliverable: piloto con 1–2 comunidades + panel de configuración de filtros/marca.

### NUEVO D · Afiliados de usuario con "contenido que comparte" (Días 19–23)
Refiere-y-gana con pago de saldo + tarjetas para "compartir una apuesta / mis stats / mi mes" que llevan
enlace de referido sin parecer spam. Tenemos cimientos de referidos. Máquina de crecimiento viral.

### NUEVO E · Superficies que nos faltan y ya tenemos medio hechas (Días 24–30)
- **Dropping Odds** como vista propia (tenemos movimiento de línea en combate → generalizar a fútbol).
- **Bet Checker** (pega una apuesta → valor sí/no, con nuestro de-vig).
- **Registro/cartera** con calendario mensual de P&L + desglose por casa y deporte (tenemos CLV; falta
  la UX de cartera y el calendario).
- **"Solo sharps" + "línea de cuotas justas"** en nuestro value: mostrar el consenso de libros sharp,
  no solo el número — sube la credibilidad de la señal.
- **Páginas de cuotas por evento** (SEO) alimentadas por nuestro feed, en español.

### Prioridad v2 (mi recomendación)
1. **CPA de casas (B)** + **afiliados de usuario (D)** — dinero e crecimiento nuevos, bajo esfuerzo.
2. **Onboarding con bankroll (A)** — sube activación y alimenta el Kelly, mismo producto.
3. **SEO en español (Fase 3 Parte 1)** — moat compuesto.
4. **B2B white-label (C)** — ingreso recurrente que apalanca el modelo.
5. **Superficies (E)** — cierran brecha de paridad sin ser el centro.

Lo que NO cambia: no perseguir su amplitud de deportes ni su promesa de "ganancia garantizada". Nuestro
centro es el modelo, la inteligencia y el track público. Todo lo de arriba es empaquetado y monetización
alrededor de ese centro — que es exactamente lo que ellos hacen bien y nosotros aún no.

---

# PARTE 3 — Anatomía de su landing vs la nuestra (13-ago, pedido de Alexis)

## Por qué la suya "invita a entrar y pagar"
No es la estética (la nuestra compite bien). Es que su landing es una **secuencia de objeciones
respondidas en orden psicológico de compra**, y la nuestra es una declaración + un botón. Su scroll:
¿qué gano? → ¿por qué funciona? → ¿cómo se ve por dentro? → ¿sirve donde vivo? → ¿qué tengo que hacer?
→ ¿quién lo avala? → ¿cuánto cuesta? → ¿y si no me sirve? → compra. Cuando llegas al pricing ya no te
queda ninguna duda viva. Nuestra landing responde solo la primera pregunta, y en abstracto.

## Su estructura, sección por sección (y qué copiamos de cada una)
1. **Hero de RESULTADO**: social proof arriba ("Trusted by 5,000+"), titular con el beneficio concreto
   ("Make $50-100+ daily. Copy our bets."), mecánica en 8 palabras ("We do the math. You collect the
   profits."), garantía, CTA con fricción explícita ("$1 · 7 días · cancela cuando quieras") y un
   **mockup de teléfono con el producto vivo**. → COPIAR estructura; adaptar promesa honesta.
2. **"Why It Works"** — 6 tarjetas que desactivan objeciones (cero conocimiento, simple, sin riesgo,
   matemática, <1h/día, mundial). → COPIAR el formato; nuestras objeciones son otras.
3. **Features con MINI-DEMOS VIVAS** — cada feature ilustrada con una tarjeta REAL del producto con
   números (el arb Lakers/Celtics con stakes y profit por escenario, la pick +EV con EV%, la curva de
   ROI, el chat de Discord). Componentes HTML, no screenshots. → COPIAR la técnica: es lo que hace que
   el producto se "pruebe" antes de pagar.
4. **Cobertura geolocalizada** ("60 books available from United States · 400+ worldwide"). → adaptar.
5. **"4 Simple Steps" con TIEMPOS** (30 seconds / Instant / <1 minute / Automatic). → COPIAR: el tiempo
   explícito mata la objeción "esto será complicado".
6. **12 reseñas de expertos** con links. → NO copiable hoy (no las tenemos); sustituto honesto abajo.
7. **Pricing EN la landing**: toggle anual −40%, 15 métodos de pago con logos, garantía de reembolso.
8. **FAQ de 9 preguntas** que son objeciones de compra (¿es legal? ¿me limitarán? ¿cuánto gano?).
9. CTA final + **footer masivo SEO** (30+ calculadoras, cuotas por deporte, blog).

## Los 5 defectos de la nuestra (los que más venta cuestan)
1. **Titular abstracto**: "La ventaja que el mercado no ve" no dice qué haces ni qué obtienes. Bonito,
   no vende. El subhead es una lista de features sin jerarquía.
2. **No se VE el producto**: cero demo/mockup. El visitante compra a ciegas.
3. **No hay precios en la landing** (y /plans está gated) — la fuga más grave: nadie paga sin ver precio.
4. **No responde objeciones**: sin "por qué funciona", sin pasos, sin FAQ, sin garantía visible.
5. **No usa nuestra mejor arma**: el track público verificable ni aparece.

## El blueprint de NUESTRA landing (estructura suya, alma nuestra, estética intacta)
1. **Hero**: eyebrow con número real y verificable de la DB ("+N picks liquidadas en público" — nuestro
   equivalente honesto de su "5.000 miembros") → titular de resultado: la dirección es
   **"El modelo que le discute el precio al mercado"** / sub: "Cada pick con su porqué, su cuota y su
   resultado liquidado en público. Fútbol y combate, en tu idioma." → CTA "Probar Sharp gratis 3 días ·
   hoy pagas $0 · cancelas en 1 clic" (o el trial $1 si se ejecuta FASE 2) → **mockup de teléfono con
   una pick card REAL** (ya tenemos ese componente clavado — la card del email de Garry es exactamente
   esto) → franja de confianza: "track público · sin ganancias prometidas · 18+".
2. **"Por qué GP funciona distinto"** — 6 tarjetas nuestras: (1) Un modelo, no un tipster — simula cada
   partido 10,000 veces; (2) El porqué de cada pick — lectura de analista, no una fila verde; (3) Track
   público con las perdidas incluidas — audítalo tú; (4) Tus ligas y tus casas — LATAM nativo; (5)
   Combate modelado (UFC/MMA/boxeo) — nadie más lo tiene; (6) 10 minutos al día.
3. **Features con mini-demos vivas** (componentes reales): pick card con edge y porqué → cockpit del
   partido → lectura profunda de una pelea → value/arb multi-casa → en vivo. Reusar los componentes de
   premium.js/ig-src, no screenshots.
4. **"Empieza en 3 pasos" con tiempos**: Entra (30 seg, solo email) → Mira la pick del día y su lectura
   (2 min) → Sigue el resultado en público (automático).
5. **Cobertura**: mapa/chips "38 ligas · UFC · MMA · boxeo · 40+ casas · [tu país]" (geolocalizar IP
   para resaltar casas del país como hacen ellos).
6. **Prueba social honesta** (sustituto de sus 12 reseñas): el módulo del track en vivo (W-L, unidades,
   por familia, link a Rendimiento) + contador real de usuarios + testimonios reales cuando existan +
   Trustpilot cuando haya volumen. JAMÁS reseñas infladas.
7. **Pricing completo EN la landing**: los 3 planes con toggle anual, métodos de pago con logos (Whop:
   tarjetas + cripto), garantía de 24h visible, y "cancelas en 1 clic" en cada card.
8. **FAQ de objeciones** (7): ¿Esto es un tipster? · ¿Me garantizan ganancias? (NO — y por qué esa
   honestidad es la señal de calidad) · ¿Qué es el track público? · ¿Qué ligas/deportes? · ¿Necesito
   saber de apuestas? · ¿Puedo cancelar/reembolso? · ¿Funciona en mi país?
9. **CTA final** + footer con calculadoras/cuotas/blog cuando existan (FASE 3) + legal.

Reglas: estética actual intacta (ya es la correcta para la categoría); toda cifra debe salir de la DB
(picks liquidadas, usuarios, ligas, casas) — nada inventado; y las promesas de ganancia siguen
prohibidas — nuestra versión de su "Profit Guaranteed" es "Track público — audítalo tú mismo".
