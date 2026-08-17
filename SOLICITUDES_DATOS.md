# SOLICITUDES DE DATOS — borradores listos para enviar (17-ago-2026)

> Los tres textos de abajo están redactados para copiar y pegar. **Enviarlos requiere tu cuenta y tus
> datos** (nombre, país, web, correo de contacto), por eso quedan aquí y no salen solos.
> Orden recomendado: **GRID primero** (es el que más cambia el producto y es gratis), Liquipedia después,
> Riot al final (es el que menos aporta de los tres — ver la corrección del punto 3).

---

## 1) GRID — Open Access (CS2 y Dota 2, GRATIS) · **la prioridad**

**Qué es y por qué cambia el plan.** El 17-ago se documentó en `HANDOFF.md` que los datos ronda a ronda
costaban ~1.600 €/mes (PandaScore histórico) o entraban por la puerta enterprise de GRID. Eso era cierto
para el producto de pago; lo que faltaba era **GRID Open Access**, un programa gratuito para
*pre-revenue startups, estudiantes, desarrolladores independientes, investigadores y fans*, con datos
oficiales de **CS2 y Dota 2** tomados del propio servidor de juego: estadísticas de partida en tiempo real,
rendimiento por jugador, stats por equipo y eventos in-game.

**Lo que desbloquea, en el lenguaje del pendiente:** es el punto 1 del blueprint de feedback (round,
economía, lados T/CT) y el punto 2 de `TODO_NEXT` (histórico de vetos reales) — hoy los dos están
declarados en pantalla como "no se puede con el dato actual".

**El límite que hay que tener claro antes de escribir.** *Series Events* —el feed que usan las
aplicaciones de apuestas— **NO está incluido**: es producto de pago, y la propia FAQ de GRID lo dice.
Open Access sirve para **construir y validar el modelo** (que es donde GP tiene el agujero), no para
alimentar un mercado en vivo. Conviene decirlo nosotros en la solicitud en vez de que lo pregunten ellos.

**Dónde:** https://grid.gg/open-access/ → "Apply for Free Access".

### Texto para la solicitud

> **Project:** GP Simulador (gpsimulador.com) — sports-intelligence platform, pre-revenue.
>
> **What we do.** We build our own statistical models for football, MMA/boxing, basketball, NFL and
> esports, and we publish the model's probabilities next to public market prices so users can see where
> the two disagree. Everything is free today; there is no revenue and no sportsbook — we are not an
> operator and we do not take bets.
>
> **What we already built for CS2, so you can see this is not a cold start.** We harvested and validated
> our own base of 88,502 CS2 maps. We run strict walk-forward validation (every map predicted with the
> state prior to it being played): a global Elo scores 6.88% Brier skill / 0.649 AUC, and our calibrated
> hierarchical model — global strength plus a shrunken per-map correction — reaches **7.28% skill, 0.652
> AUC, ECE 0.0081**. We also keep a daily roster snapshot (20,278 players, 2,443 organisations) because
> the provider only exposes current line-ups and org ≠ roster.
>
> **Why we are applying.** Everything above stops at the map level. The three things our own validation
> says we cannot model with map-level data are round economy, T/CT side asymmetry and the real veto tree —
> and all three are exactly what server-side data gives. We currently publish "we can't measure this yet"
> in the product rather than guessing, and we would like to replace those notices with measured numbers.
>
> **What we would do with Open Access.** (1) Rebuild the CS2 model round by round and re-run the same
> walk-forward validation to see whether round-level context actually improves out-of-sample skill;
> (2) replace our assumed veto coefficient with the measured one; (3) extend our own player scoreboard
> with side and economy context. We understand Series Events is not part of Open Access and we are not
> asking for it.
>
> **Volume:** modest — historical backfill once, then daily incremental pulls for the tournaments we
> cover. Node.js, single server, no redistribution of raw data.
>
> **Contact:** [tu nombre] · [correo] · gpsimulador.com

---

## 2) Liquipedia — histórico de vetos y plantillas (el correo que quedaba pendiente)

**Para qué:** el coeficiente de veto de CS2 está marcado como *experimental* en la ficha del modelo porque
se deriva de la fuerza por mapa, no de vetos reales; y el linaje de plantillas propio empieza el 16-ago
(antes de esa fecha no hay histórico, solo la foto actual del proveedor).

**Dónde:** Liquipedia pide contacto previo para uso automatizado de su API →
https://liquipedia.net/api-terms-of-use (correo de contacto en esa misma página).

### Texto para el correo

> **Subject:** API access request — GP Simulador (CS2 veto and roster history, non-commercial research)
>
> Hi Liquipedia team,
>
> I run GP Simulador (gpsimulador.com), a free sports-intelligence site where we publish our own
> statistical models next to public market prices. For Counter-Strike 2 we maintain our own base of
> 88,502 maps and a daily roster snapshot, and we validate every model change walk-forward before it
> ships.
>
> Two things we cannot build from what we have, and that Liquipedia documents better than anyone:
> **(1) the real veto/pick-ban history** — our current veto coefficient is derived from map strength and
> we label it as an assumption in the product; **(2) roster history with effective dates** — our provider
> only exposes current line-ups, so our own lineage only starts in August 2026.
>
> We would use the API within your terms: a low, throttled request rate, a descriptive User-Agent with
> this contact address, local caching so we never re-request what we already have, and attribution with a
> link back to Liquipedia wherever the data is shown. We do not redistribute raw content.
>
> Happy to describe the exact endpoints and volumes we expect, or to adjust to whatever rate you prefer.
>
> Thanks,
> [tu nombre] — [correo] — gpsimulador.com

---

## 3) Riot Games — CORRECCIÓN de lo escrito el 17-ago, y qué hacer igualmente

**Lo que decía el `HANDOFF` (punto 5) y hay que matizar:** "Riot API (LoL y Valorant, gratis con
aprobación)… dan detalle por partida que bo3 no tiene para CS2". Comprobado hoy: la API pública de Riot
(Developer Portal, clave de desarrollo → clave de producción tras registrar el producto) sirve **partidas
de cuentas normales** — match-v5, ranked, spectator, tournament-v5 para torneos que tú mismo organizas.
**No sirve las partidas profesionales de LCK/LEC/VCT.** Para el circuito profesional no hay programa
público documentado: lo que usa todo el mundo es la API no oficial de *lolesports* — que es exactamente la
que GP ya usa como fuente de resultados de LoL — y Leaguepedia/Liquipedia para el histórico.

**Conclusión práctica:** registrar el producto en el portal de Riot **no desbloquea** el dato que nos
falta. Vale la pena hacerlo igual, pero por dos razones menores: (a) es el requisito formal si algún día
mostramos datos de cuentas de jugadores, y (b) es el canal por donde se pide, si alguna vez se abre,
acceso al circuito. **No es la prioridad de la semana.**

**Si aun así se hace:** https://developer.riotgames.com/ → iniciar sesión con cuenta Riot → *Register
Product* → producto personal. Datos que pide: nombre del producto, URL, descripción, a qué jugadores
sirve, y cumplimiento de las políticas (nada de apuestas con datos de jugadores identificables — nuestro
caso no usa cuentas de jugadores, conviene decirlo así).

> **Product name:** GP Simulador · **URL:** https://gpsimulador.com
> **Description:** Free statistical model that publishes match probabilities for several sports. For Riot
> titles we currently show tournament-level information only; we do not query or display data from
> individual player accounts. Registering the product to be compliant and to keep the door open for
> official esports data access.

---

## Dónde queda cada cosa

| Fuente | Estado | Qué desbloquea | Coste |
|---|---|---|---|
| **GRID Open Access** | borrador listo, falta enviarlo | ronda, economía, T/CT, vetos reales (CS2 y Dota 2) | 0 € (Series Events, no) |
| **Liquipedia** | borrador listo, falta enviarlo | histórico de vetos y de plantillas | 0 € |
| **Riot** | borrador listo, prioridad baja | nada de lo que falta (ver corrección) | 0 € |
| OpenDota / Steam | **ya integrada** como fuente de resultados de Dota 2 | rating propio de Dota 2 (pendiente de cosechar) | 0 € |
| PandaScore | descartada por ahora | lo mismo que GRID, pagando | ~1.600-4.000 €/mes |
