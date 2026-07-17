# PLAN PRODUCTO TOP — órdenes de Alexis 17-jul-2026

> "Quiero que todo sea del más alto nivel posible, a la altura de nuestra visión."
> Regla dura vigente: EXTENDER los componentes del Mundial, jamás variantes. Comparar navegando ANTES.

## P1 — Paridad de inteligencia en clubes
El panel de inteligencia de clubes muestra **Hallazgos del cruce** (style engine / matchup findings)
pero NO **hallazgos de inteligencia** (capa de observación narrada) como el Mundial.
- Mapear navegando lado a lado (Mundial vs club) qué hallazgos muestra cada panel exactamente.
- Llevar los hallazgos de inteligencia del observer (ya encendido, 68 equipos con señales) al mismo
  panel del cockpit de club, con el MISMO componente del Mundial.

## P2 — Minutos de jugador como DISTRIBUCIÓN (no un número)
Hoy: "82 minutos". Debe ser:
- P(titular);
- minutos esperados SI titular;
- minutos esperados SI entra del banco;
- P(juega 60+), P(75+), P(90).
Fuente: player-history por partido ya tiene `started`/`min` de cada aparición → la distribución
empírica por jugador existe; el prop-engine ya proyecta titularidad. Falta: modelarla, exponerla en
/api (player + match intel) y UI (perfil + proyección). Impacta también player props (P(anota) debe
condicionar por minutos proyectados como distribución).

## P3 — Redefinir "Confidence" en picks (separar 4 señales)
"High/Medium" hoy mezcla probabilidad con certeza. Separar:
- **Win probability**: 63.8% (el blend actual — YA existe como confidence numérica);
- **Estimated edge**: +4.3pp (edge_pp — ya viaja);
- **Data confidence** (alta/media/baja): certeza del INPUT — nº casas, frescura de cuotas, gate de
  liga, muestra del fit, disponibilidad confirmada vs proyectada;
- **Pick quality** (fuerte/moderada/marginal): composite de régimen (ancla/edge), profundidad,
  coherencia modelo-mercado.
La confianza habla de certeza del input/modelo, NO sustituye la probabilidad. UI: card de pick con
las 4 señales; i18n ES/EN; mismo layout Mundial+clubes.

## P4 — MAPEO TOTAL de estados incompletos (pre-lanzamiento)
Bugs vistos por Alexis que no pueden llegar al lanzamiento:
- `{gf}` y `{ga}` sin reemplazar en forma reciente (template leak);
- confianza mostrada como "—";
- "Price not verifiable" / "Freshness not tracked" / "Movement not tracked" (labels internos);
- métricas vacías de goles recibidos;
- textos parcialmente traducidos (ES/EN mezclados);
- secciones proyectadas que parecen definitivas (falta badge "Proyectado").
**Método**: barrido sistemático con CDP por TODAS las superficies (board, cockpit club+Mundial,
equipo, jugador, picks, rendimiento, calculadora) en ES y EN, capturando cada placeholder/estado
vacío → llenar con el dato correspondiente; lo que no se pueda llenar → degradación elegante
("Goals data unavailable", "Odds not currently verified", "Projected lineup — low confidence").
JAMÁS variables internas ni placeholders al usuario.

## P5 — Calculadora → PORTFOLIO DIARIO con correlación
Elevar el módulo de stake a cartera del día:
- riesgo total del día; exposición por partido y por liga;
- detección AUTOMÁTICA de apuestas correlacionadas (mismo evento → ajustar stake combinado:
  ej. Botafogo ML 1.4u + Over 2.5 1.1u → 1.7u ajustado por correlación, no 2.5u);
- límite diario; pérdida máxima estimada; stake total recomendado.
La correlación intra-evento se computa con las probs conjuntas del goal model (P(gana Y over) ya
computable con las lambdas del cruce).

## F — Funciones nuevas (retención/ejecución)
1. **Mi cartera**: usuario registra apuesta/cuota/stake/book/resultado → P&L personal, CLV personal,
   bankroll, adherencia al stake sugerido, rendimiento siguiendo GP vs overrides. (Retención máxima.)
2. **Mis casas**: usuario marca sus casas disponibles → mejores cuotas REALES para él, arbitrajes
   ejecutables para él, alertas relevantes, ROI alcanzable. (Filtro transversal del feed/value/arb.)
3. **Watch price**: alertas de precio objetivo ("avísame si Botafogo llega a 2.15", "si Over 2.5
   supera 1.75") → email/Telegram/app. El sweep ya observa precios; falta registro de watches +
   disparador en el ciclo.
4. **GP Daily Brief**: diario — top 3 oportunidades, partidos interesantes, movimientos de línea,
   lesiones/alineaciones (observer), resultados de ayer, estado del bankroll. Email + Telegram +
   in-app. (El broadcast, telegram.js y el observer ya existen — es orquestación + plantilla.)

## Orden de ejecución propuesto
1. **P4 (mapeo de incompletos)** — es pre-lanzamiento, bloquea todo lo demás públicamente.
2. **P1 (inteligencia clubes)** — paridad pendiente, corto.
3. **P3 (Confidence 4 señales)** — define el lenguaje del producto antes de exponer picks.
4. **P5 (portfolio diario)** — la calculadora ya existe; extensión natural.
5. **P2 (minutos como distribución)** — modelado, alimenta props.
6. **F1→F4** — Mi cartera primero (retención), luego Mis casas, Watch price, Daily Brief.

## ESTADO (17-jul tarde, prod `7fd9d3c`) — PLAN COMPLETO ✔
- P4 ✔ (degradación + red t() + auditor) y **P4-resto ✔** (barrido CDP ES/EN 0 fugas; proyectadas con nota).
- P1 ✔ · P3 ✔ · P5 ✔ (correlación auto + **Portfolio del día** en la calculadora) · P2 ✔ (minutesDist en
  prop-engine, expuesto en player/intel Mundial+clubes, panel compartido en perfiles).
- **F1 Mi cartera / F2 Mis casas / F3 Watch price / F4 Daily Brief ✔ construidas y QA-verificadas — detrás
  de flags OFF en prod**: `GP_MY_BETS_ENABLED`, `GP_MY_BOOKS_ENABLED`, `GP_WATCH_PRICE_ENABLED`,
  `GP_DAILY_BRIEF_ENABLED` (+`GP_DAILY_BRIEF_TELEGRAM_ENABLED`). Encenderlas = decisión de Alexis.
- Track ancla-vs-edge: bucket `regime:` en el track record de clubes — se separa solo al liquidar
  (anclas juegan 17-25 jul; nada liquidado aún al cierre de esta pasada).
