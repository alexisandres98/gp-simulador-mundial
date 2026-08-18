# INVESTIGACIÓN — De "NFL" a "Fútbol americano 🏈": CFL y College Football (18-ago-2026)

> Pregunta de Alexis: ¿podemos cambiar la pestaña NFL por fútbol americano completo (como hace
> Polymarket: NFL 446 mercados · College 102 · CFL 4) y extender el mismo nivel de inteligencia a esas
> ligas menores, donde la ineficiencia podría dar edge?
>
> **Veredicto corto: SÍ para College (NCAAF), con la misma arquitectura y datos GRATIS que son incluso
> mejores que los de NFL. CFL solo como capa de mercado (sin modelo) hasta que su dato lo permita.**
> Todo lo de abajo está VERIFICADO hoy con llamadas reales, no supuesto.

---

## 1) Lo verificado hoy (con la key de The Odds API de la casa)

| Liga | Sport key | Eventos hoy | Casas cotizando | Polymarket |
|---|---|---|---|---|
| NFL | `americanfootball_nfl` | 47 (semana 1) | ~24 | 446 mercados |
| **NCAAF** | `americanfootball_ncaaf` | **111** (semana 1, desde el 29-ago) | **22** | 102 mercados |
| **CFL** | `americanfootball_cfl` | **4** (temporada EN CURSO) | **20** | 4 mercados |
| UFL | `americanfootball_ufl` | inactiva (primavera) | — | — |

Créditos restantes de The Odds API: **4,8 M** — una pasada de liga entera cuesta 1 llamada, igual que
NFL. El costo marginal de cuotas para las dos ligas nuevas es ~0.

**Dato clave de calendario:** la CFL juega AHORA (jun-nov) y College arranca el **29-ago** — las dos
llegan ANTES que el kickoff de NFL (9-sep). Si se construye, la sombra empieza a acumular semanas antes.

## 2) College (NCAAF): el dato existe, es gratis y es MEJOR que el de NFL

**CollegeFootballData.com (CFBD)** es el nflverse del college, con API y key gratis:
- **Free tier ($0): 1.000 llamadas/mes** — incluye historial de partidos, **líneas de apuesta HISTÓRICAS
  (cierres, varios libros, ~2013→)**, y **métricas avanzadas EPA/PPA por equipo y temporada**. Tier 2
  ($5/mes) da 30.000 llamadas si la cosecha inicial lo pide. Lo que a NFL le costó armar con nflverse +
  The Odds API, aquí viene en UNA fuente. (Solo el play-by-play EN VIVO y GraphQL son de tiers altos —
  no los necesitamos: el modelo es pre-partido.)
- `cfbfastR` (SportsDataverse) documenta los mismos endpoints — la comunidad analítica entera corre
  sobre esta base, señal de que es estable.
- ESPN scoreboard de NCAAF funciona (verificado hoy: 25 eventos listados) → marcadores para liquidar,
  el mismo camino que ya usa todo el resto de la casa.

**La arquitectura de NFL se traslada pieza por pieza:**

| Pieza NFL | Equivalente NCAAF | Estado |
|---|---|---|
| `nfl-harvest.js` (nflverse games + cierres) | CFBD `/games` + `/lines` | mismo shape, una fuente |
| team-week EPA (nflverse) | CFBD `/ppa` y advanced season stats | disponible free |
| rating opponent-adjusted + estados EPA | idéntico (más importante aún: los calendarios no se cruzan y el ajuste por rival es TODO en college) | reusable |
| simulador margen/total con residuos reales vs cierre | refit obligatorio con residuos DEL college | walk-forward igual |
| sombra + CLV vs cierre | idéntico (cierres históricos incluidos en CFBD) | igual |

**Diferencias de modelado que hay que respetar (no son detalles):**
1. **Escala**: 136 equipos FBS y favoritos de −40; la distribución de márgenes es mucho más ancha y los
   números clave pesan menos que en NFL. El fit de residuos es NUEVO, no se hereda.
2. **Rotación de plantilla** (transfer portal + eligibilidad): el carry de temporada a temporada vale
   menos que en NFL → más encogimiento del prior, más incertidumbre declarada en semanas 1-3.
3. **Localía y ritmo** varían más por equipo que en NFL.
4. La misma doctrina que ya rige: **market-blind por construcción, todo nace en SOMBRA**, y solo el
   walk-forward decide si alguna familia sale.

**¿Y el edge? Lo que dice la literatura (no nuestro deseo):** los mercados de spread de college son
menos eficientes justo donde hay menos cobertura mediática — las líneas de partidos de bajo perfil
predicen peor el resultado, hay sobreprecio documentado de favoritos con tradición e infraprecio de
locales, y la información de lesiones/rotaciones de programas chicos es mala y tardía (a diferencia del
injury report estandarizado de NFL). Es exactamente la tesis de Alexis: **la ineficiencia vive en los
partidos que nadie mira, y un modelo sistemático mira los 111 a la vez.** Dos advertencias de la casa:
(a) las casas ponen límites bajos en esas ligas — el edge que se encuentre puede no ser ejecutable a
tamaño; (b) el listón sigue siendo el de siempre: CLV fuera de muestra en sombra ANTES de publicar nada.
El backtest de NFL (−7/−10 % ROI en ML) enseñó que "hay modelo" ≠ "hay edge"; college tiene que pasar
por la misma puerta.

## 3) CFL: mercado sí, modelo todavía no

- **Cuotas**: The Odds API la cubre (verificado: 4 eventos, 20 casas) y Polymarket cotiza 4 mercados.
  La capa de VALUE/ARBITRAJE/CAÍDAS — la que no depende del modelo, como en baloncesto — funciona desde
  el día uno.
- **Modelo**: el agujero es el dato histórico. La API oficial (`api.cfl.ca`) pide key por solicitud y
  hoy ni responde desde fuera (verificado: timeout); no hay equivalente de nflverse/CFBD con **cierres
  históricos** ni EPA. Sin cierres históricos no se puede hacer la validación "residuos vs cierre" que
  es la columna vertebral de la arquitectura NFL — se podría ajustar un rating Elo/puntos con marcadores
  de ESPN, pero nacería sin la comparación contra el mercado que la casa exige antes de opinar.
- **Tamaño**: 9 equipos, ~81 partidos/temporada — la muestra anual es chica; harían falta varias
  temporadas de historia para validar cualquier cosa.
- **Recomendación**: pestaña presente con cuotas multi-casa + arbitraje + registro de cierres desde ya
  (para poder calcular CLV hacia atrás el día que haya modelo, la misma jugada que esports), y pedir la
  key de `api.cfl.ca` en paralelo. Picks: no hay camino a corto plazo, y se declara en pantalla.

## 4) Cómo se estructura en el producto (propuesta)

La casa ya tiene el patrón exacto: **baloncesto es una pestaña con ligas dentro (WNBA/NBA)** y esports
una pestaña con juegos dentro que NO comparten motor. Fútbol americano sigue ese molde:

- La pestaña **NFL 🏈 pasa a "Fútbol americano"** con selector de liga: **NFL · College · CFL** (el
  mismo `gx-seg` que usa baloncesto para WNBA/NBA).
- `nfl-engine/` se generaliza con una dimensión de liga (como `esports-engine` tiene un motor por
  juego): NFL y NCAAF comparten la FORMA del modelo (rating en puntos + EPA/PPA + simulador de
  residuos) pero cada uno con SUS constantes ajustadas y SU validación — nada de heredar el fit.
- Jobs: una llamada más de The Odds API por liga por pasada (costo ~0 con 4,8 M de créditos), cierres y
  sombra por liga, mismo reloj de "solo con partidos a ≤9 días".
- Rutas: `/api/nfl/*` gana `?league=` (default nfl — cero ruptura de lo desplegado).

**Orden de construcción sugerido:**
1. **NCAAF V1** (la semana que viene si se aprueba): key de CFBD (necesita registro tuyo, gratis) →
   `cfb-harvest.js` (games+lines+PPA) → fit walk-forward propio → sombra + cierres desde la semana 1
   (29-ago). Objetivo de la V1: el Command Center + Game Terminal + Oportunidades honesta, todo en
   sombra, igual que NFL.
2. **CFL capa de mercado** (un día de trabajo): cuotas multi-casa + arbitraje + guardado de cierres +
   pantalla honesta de por qué no hay modelo. Solicitud de key a api.cfl.ca en paralelo.
3. **Selector de liga en la pestaña** al entregar el primero de los dos.

## 5) Lo que NO se recomienda
- Meter FCS/divisiones menores del college en V1: CFBD las trae, pero la cobertura de casas es rala y
  el ruido de datos (plantillas, forfeits) es alto. FBS primero; FCS cuando la sombra de FBS aguante.
- UFL: liga de primavera, hoy inactiva en las casas. Se revisa en marzo.
- Prometer edge por "ineficiencia" antes de medirlo: la literatura la documenta, pero la casa publica
  solo lo que su propia sombra confirme con CLV fuera de muestra.

## Fuentes
- The Odds API — verificación en vivo con la key de la casa (sports list + odds CFL/NCAAF, 18-ago).
- CollegeFootballData.com: [tiers y contenido free](https://collegefootballdata.com/api-tiers) ·
  [docs de la API](https://api.collegefootballdata.com/) · [cfbfastR](https://cfbfastr.sportsdataverse.org/reference/index.html)
- CFL: [api.cfl.ca/docs](http://api.cfl.ca/docs) (key por solicitud; hoy no responde desde fuera)
- Eficiencia del mercado de college: [Betting Markets and Market Efficiency: Evidence from College
  Football (AEA)](https://www.aeaweb.org/conference/2010/retrieve.php?pdfid=406) · [Regional information
  and market efficiency (J. Econ. & Finance)](https://link.springer.com/article/10.1007/s12197-009-9113-3) ·
  [College Football Rankings and Market Efficiency (Cowles/Yale)](https://cowles.yale.edu/sites/default/files/2022-08/d1381.pdf)
