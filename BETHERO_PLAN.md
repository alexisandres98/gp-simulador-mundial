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
