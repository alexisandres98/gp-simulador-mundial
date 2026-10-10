# Costes reales, qué depende de qué y un modo mínimo — 10 de octubre de 2026

**Pregunta de Alexis:** «la infraestructura suma como 500 al mes; invertir 500 para hacer 300 en el mejor caso con
tarjetas under no es una matemática efectiva». Pidió los números reales.
**Método:** precios de lista comprobados hoy; consumos leídos de las sondas de producción; dependencias
verificadas en el código por diez agentes (cinco mapas, cinco refutaciones) con fichero y línea. Lo que no está
en el repo (el precio que pagas de verdad, impuestos, tu suscripción de IA) lo rellenas tú.

## 1. Las tres frases

1. **Lo que cuesta hoy lo que veo desde el código son unos 365-445 USD al mes.** El resto hasta tus 500 está fuera
   del repo (suscripciones tuyas, impuestos, tipo de cambio).
2. **Tarjetas under, lo único que da dinero, necesita unos 90-140 USD al mes.** No necesita The Odds API (119),
   ni el plan grande de Render (85), ni el LLM, ni la mayoría de lo demás.
3. **Lo que tarjetas under puede dar es entre perder algo y ~350 al mes.** En sombra +5,8 % sobre 553; en real
   −1,7 % sobre 169, con la casa recortándote a 10-40 por boleto. Ni siquiera con el modo mínimo es un negocio:
   es un ingreso pequeño con un intervalo que incluye el cero.

## 2. Lo que cuesta hoy, servicio por servicio

| servicio | plan hoy | precio de lista / mes | quién lo usa | ¿lo necesita tarjetas under? |
|---|---|---|---|---|
| Render web `gp-simulador-mundial` | Pro (4 GB, 2 CPU) + disco 5 GB | **85 + 1,25** | todo | sí, pero cabe en Standard (2 GB, **25**) apagando el resto |
| Render Postgres `gp-simulador-db` | basic-1gb + **60 GB** de disco | **19 + 18** | tabla de cuotas y el resto de la capa SQL | sí (las picks nacen leyendo `cards_total` ahí) |
| Render web `gp-relay-eu` (Fráncfort) | Starter | **7** | **nada**: lo sustituyó el brazo de Hetzner; TODO_NEXT lo da por «suspendido» pero la API dice `not_suspended` | no → **borrar** |
| The Odds API | 5M créditos | **119** | consenso 1X2/goles de clubes, props de otras casas, NFL, college, baloncesto, tenis, combate, value board | **no** (ver §3) → cancelar o plan gratis |
| API-Football | Ultra (75.000/día), vence 23-oct | **29** | siembra de partidos, historial de tarjetas, árbitro, liquidación rápida, cockpit | **sí**, pero con ~700-800 llamadas/día: cabe en **Pro (19)** |
| TheStatsAPI | de pago desde el 23-ago (120/min) | **50-129** (Starter/Growth; el plan exacto lo sabes tú) | resultados y `player-history` de 59 ligas; liquidación de respaldo de tarjetas | parcial: sin él, 1 de cada 5 picks queda sin resolver en el libro (el cobro en Cloudbet no cambia) |
| Resend | Pro 50.000 correos | **20** | login por código, alertas, correos del ejecutor, reporte semanal | el login sí necesita UN proveedor; el gratuito (3.000/mes) puede bastar sin alertas masivas |
| Anthropic (LLM de pago) | pago por uso; 20 cargados el 15-ago, 4 gastados | **~2** | chat con herramientas; el resto va por Gemini y Groq, gratis | no |
| Hetzner `gp-cb-relay-hel2` (Helsinki) | CX23 | **~7** (6,49 €) | **el brazo de Cloudbet**: desde Oregón la casa responde RESTRICTED | **sí, imprescindible** |
| Hetzner `gp-pm-hel1` (Helsinki) | CX23 | **~7** (6,49 €) | brazo de Polymarket, apagado (`GP_PM_ENABLED` sin poner) | no → **borrar** |
| Cloudbet, Pinnacle guest, ESPN, FotMob, PDC, WTT, Polymarket/Kalshi lectura, Telegram, Apps Script, Gemini, Groq | — | **0** | varios | Cloudbet y ESPN sí; el resto no |
| Dominio gpsimulador.com | Namecheap | ~1 | web | sí |
| **Total visible** | | **≈ 365 (TSA Starter) a 445 (TSA Growth)** | | |

Lo que seguramente completa tus 500: impuestos sobre esos servicios, tu propia suscripción de IA para trabajar
conmigo, y la diferencia de tipo de cambio. Eso no lo veo desde el repo.

## 3. Lo que tarjetas under necesita de verdad (verificado en el código)

La cadena entera, de la pick al cobro, es: Postgres → `cloudbetSweep` escribe `cards_total` de Cloudbet →
`buildClubDailyPicks` lee `cards_total` sin filtrar por proveedor y acepta una sola casa → `props-history-<liga>.json`
(API-Football) para ajustar y liquidar → `shadowSweep` → `real-executor/store.js` coloca por el brazo de Hetzner en
Cloudbet → liquida por la pick → concilia contra la casa.

- **The Odds API: NO.** Está diseñado así a propósito (comentario «INDEPENDENCIA DE THE ODDS API», `server.js:5319`)
  y ya pasó del 19 al 21-sep con la clave muerta: el canal real siguió colocando y liquidando. Sus filas de
  `cards_total` son de casas no ejecutables (Pinnacle, bet365) y solo servían al canal manual de Pinnacle, cerrado
  el 2-oct. Lo que se pierde al cortarlo: el consenso de ≥5 casas del 1X2 y goles de clubes (SOLID/GOALS, sombra), el
  cierre multi-casa (diagnóstico), y las sombras de NFL, college, baloncesto, tenis y combate. Ninguna da dinero.
- **API-Football: SÍ, pero poco.** Siembra los partidos de las competiciones que The Odds API no cotiza, rellena el
  historial de tarjetas con el que se ajusta el modelo y se liquida la pick, y da el árbitro (sin él el modelo vuelve
  a la versión sin árbitro, la peor de las dos medidas, y rompe la comparabilidad de la muestra hacia el 20-oct). El
  volumen que necesita son 700-800 llamadas al día: cabe cuatro veces en el plan Pro de 19. Ultra solo lo justifica el
  cockpit en vivo. **Al vencer el 23-oct, bajar a Pro.**
- **TheStatsAPI: respaldo.** Cuando API-Football no trae las estadísticas del partido (pasó en el 20,6 % de las
  liquidaciones), el `player-history` de TSA resuelve la pick. Sin TSA esas picks acaban en VOID a las 72 h y el libro
  real queda con `sin_resolver`; el dinero en Cloudbet se liquida igual. Ojo: esa rama cuenta la roja como 1 tarjeta y
  la casa como 2; si TSA pasa a ser fuente principal, ese sesgo deja de ser marginal.
- **Hetzner `gp-cb-relay-hel2`: SÍ, sin alternativa.** Sin el brazo, `placeBet` cae a la llamada directa desde
  Oregón y Cloudbet responde RESTRICTED (`market-scanner/venues/cloudbet.js:543-567`).
- **Postgres: SÍ.** La pick nace leyendo `sportsbook_goal_quote_current`. Los 60 GB de disco son herencia de la tabla
  que crecía 10 M de filas al día (arreglado el 8-oct); con la tabla limpia cabe en mucho menos, pero el disco de
  Render no se encoge: habría que migrar a una base nueva (una tarde de trabajo, sin tocar el disco de Render).
- **LLM, Resend, Telegram: NO en el camino del dinero.** Ningún módulo de `real-executor/` requiere `mailer`, `llm` ni
  `telegram` (grep vacío). El correo solo sirve para que TÚ te enteres (saldo bajo, brazo caído, parada cruzada,
  «para colocar a mano»). Y una cosa a no tocar nunca: **sin ningún proveedor de correo, el código de login se
  devuelve en el JSON y se pinta en pantalla** (`server.js:19773`, `app.js:2903`) → cualquiera entra con cualquier
  email. Siempre una clave de correo puesta.

## 4. La economía de tarjetas under, con los dos libros

| | sombra `cards_under_v1` | real (Cloudbet, solo `cdp_` + under) |
|---|---|---|
| desde | 12-ago (58,5 días) | 12-ago |
| liquidadas | 553 (330-212) | 169 (98 ganadas) |
| apostado | 23.091 (media 39) | 5.472 (mediana **30** por posición, máx 40) |
| P&L | **+1.341,65 (+5,8 %)** | **−92,42 (−1,7 %)**: agosto +236 (+24 %), septiembre −329 (−7,3 %) |
| ritmo | 10,5 picks/día (todas las bandas) | 82 colocadas la primera semana de septiembre, después 2-13/semana (sin fondos 99 veces, banda eficiente 216) |
| CLV (recortado) | −1,23 %, t −8,5: el cierre se mueve EN CONTRA | — |
| puertas (`/api/internal/puertas`) | **G0 no pasa**: solo el 17,2 % tiene las dos caras del cierre | — |

Lectura honesta: la sombra gana a los precios de la sombra; el dinero real, con el recorte de cuenta y lo que de
verdad se pudo colocar, está en tablas. El 20-oct se mira la cohorte limpia (100 liquidadas); hasta entonces la
expectativa razonable con 200-400 USD apostados al día son **entre −50 y +350 al mes**, y la propia vara del sistema
dice que la familia ni siquiera tiene el libro en orden para medir su ventaja neta de margen.

## 5. Tres escenarios con su cuenta

| | A · seguir como hoy | B · modo mínimo (tarjetas under + web) | C · apagar con orden |
|---|---|---|---|
| Render web | Pro 85 + 1,25 | Standard **25** + 1,25 | 0 (exportar `db.json` antes) |
| Render Postgres | 37 | 37 (25 si se migra a disco pequeño) | 0 (volcado y borrar) |
| `gp-relay-eu` | 7 | **0** (borrar) | 0 |
| The Odds API | 119 | **0** (cancelar; gratis 500 créditos no sirve para nada) | 0 |
| API-Football | 29 | **19** (Pro, al vencer el 23-oct) | 0 |
| TheStatsAPI | 50-129 | **0-50** (opcional: sin él, 1 de 5 picks sin resolver en el libro) | 0 |
| Resend | 20 | **0-20** (gratis si cabe el login sin alertas; nunca sin proveedor) | 0 (y entonces apagar la web o cerrar el login) |
| Anthropic | ~2 | **0** (`GP_LLM_ENABLED=false` o solo Gemini/Groq) | 0 |
| Hetzner brazo Cloudbet | 7 | **7** | 0 |
| Hetzner brazo Polymarket | 7 | **0** (borrar) | 0 |
| dominio | 1 | 1 | 1 (conservarlo cuesta 1) |
| **total** | **≈ 365-445** | **≈ 90-140** | **≈ 1** |
| ingreso esperado | −50 a +350 (tarjetas) + lo que paguen los usuarios | −50 a +350 | 0 |
| qué pierde el producto | nada | esports, NFL, baloncesto, tenis, combate, dardos, TT, market making, lecturas y chat con LLM, observador de prensa; queda la web con fútbol de clubes y tarjetas | todo (los 340 usuarios conservados en el `db.json` exportado) |

**B no convierte tarjetas under en negocio.** Convierte una pérdida segura de 365-445 en un gasto de 90-140 contra
un ingreso de −50 a +350. Sigue siendo marginal, pero deja de ser absurdo mientras llega el 20-oct.

## 6. Cómo se entra en el modo mínimo (y lo que hace falta tocar en código)

**Con variables de entorno, sin desplegar código** (todas existen hoy):

```
GP_HOOPS_PICKS_ENABLED=false   GP_HOOPS_HARVEST=0
GP_ESPORTS_CLOSES_ENABLED=false GP_CS2_HARVEST_ENABLED=0
GP_NFL_JOBS_ENABLED=false       GP_NFL_HARVEST=0
GP_DARTS_TAIL=false             GP_TT_TAIL=false
GP_BOXING_RESULTS=false         (quitar GP_COMBAT_PICKS_ENABLED)
GP_PROPFIRM_SCAN=false          GP_POLYMM=false
GP_LLM_ENABLED=false            GP_OBS_DEPORTES=false   (quitar GP_OBSERVER_ENABLED)
GP_CENSO_TARJETAS=0             GP_QUOTES_ALL_SOCCER=false
SPORTSBOOK_DAILY_CREDITS=1      (o quitar SPORTSBOOK_PROVIDER_API_KEY al cancelar)
NODE_OPTIONS=--max-old-space-size=1536  GP_MEM_RESTART_MB=1400  GP_OPS_LIVE_CEIL_MB=700  GP_OPS_RSS_HARD_MB=1700
```
**NO tocar:** `GP_CLUBS_SHADOW_ENABLED` (es el motor de clubes entero, tarjetas incluidas), `GP_CLUBS_DATA_PASS_ENABLED`
(mata el historial de tarjetas), `GP_REAL_ENABLED`, `CLOUDBET_API_KEY`, `CLOUDBET_RELAY_URL`, `API_FOOTBALL_KEY`,
`DATABASE_URL`, y dejar siempre un proveedor de correo.

**Lo que no tiene interruptor y seguiría corriendo** (haría falta un cambio pequeño de código, una tarde):
los trabajos de dardos, tenis de mesa, tenis y F1 (`dartsJob`, `ttJob`, `tennisJob`, `f1Job` arrancan sin
condición), los bucles del Mundial (ESPN cada 30 s y Polymarket/Kalshi cada 60 s de un torneo terminado en julio),
`derivadasJob` y el `implied-engine`. Sin ellos el proceso cabe en 2 GB con holgura (reposo 350-500 MB, picos de
700-1.000 MB en el ciclo de picks); en 1 GB solo tras podar `db.json` (53 MB, con colecciones muertas del Mundial,
combate, baloncesto) y bajar más los techos; 512 MB no es realista sin reescribir la carga de la base.

**El orden correcto, si decides B:** (1) borrar `gp-relay-eu` y `gp-pm-hel1` hoy, no dependen de nada; (2) cancelar
The Odds API al final del ciclo pagado (los créditos ya están pagados hasta el 21-oct); (3) el 23-oct renovar
API-Football en Pro, no en Ultra; (4) poner las variables de arriba, desplegar, y bajar Render a Standard solo
DESPUÉS de ver dos días de picos de memoria por debajo de 1,2 GB; (5) el cambio de código para los cuatro trabajos sin
interruptor y la poda de `db.json`; (6) Resend al plan gratuito solo tras medir cuántos correos salen al mes sin
alertas. Cada paso es reversible salvo borrar máquinas, y ninguno toca el dinero.

## 7. Lo que queda por medir (ya instrumentado)

Desde hoy la sonda `/api/internal/odds-gate` cuenta los créditos de The Odds API por deporte; mañana dirá exactamente
quién se come los ~20.600 créditos diarios (≈ 620.000 al mes: el plan de 100.000 no bastaría para seguir como hoy,
pero en modo B el consumo es cero). El 20-oct, la cohorte limpia de tarjetas. El 3-nov, el market making con FIFO,
que hoy va en −285 y −180 según la regla y no cuento con que cambie.

## 8. Lo que es tuyo

Si el negocio es la plataforma, los 365-445 son su coste y se juzgan contra lo que paguen 340 usuarios, no contra
las tarjetas. Si el negocio son las apuestas, B es lo máximo que la matemática permite defender hoy, y es poco. Si no
es ninguno de los dos, C, con el volcado hecho antes de apagar nada. Yo ejecuto cualquiera de los tres; la cuenta de
arriba está para que la decisión se tome con los números y no con la paciencia.
