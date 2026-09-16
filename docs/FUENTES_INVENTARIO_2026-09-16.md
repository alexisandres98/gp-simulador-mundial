# Inventario de fuentes: licencia, cobertura, coste y alternativa

**16-sep-2026 · A36 del backlog de la auditoría externa**

> Los registros por deporte (`data/*/RIGHTS.md`) siguen siendo la autoridad para cada fuente. Este
> documento es lo que no existía: la **vista cruzada**, para poder contestar tres preguntas que ningún
> registro individual contesta — ¿qué pasa si esta fuente cae? ¿cuánto cuesta reemplazarla? ¿y cuáles de
> nuestras fuentes NO tienen registro escrito?

---

## 1. La respuesta corta

De las **28 fuentes** que alimentan algo en producción:

- **7** tienen registro de derechos escrito y completo (LoL, Valorant, Dota 2, dardos, tenis de mesa, tenis, F1).
- **12 no tienen registro ninguno.** Fútbol de clubes, baloncesto, NFL, CS2 y los mercados de predicción
  funcionan sin una sola ficha de derechos.
- **1 permite uso comercial sin reservas**: Jolpica-F1 (CC BY 4.0).
- **1 lo prohíbe explícitamente para apuestas**: Riot Developer API — y está correctamente vetada en LoL y
  Valorant.
- **0 fuentes de pago.** Todo el sistema corre sobre APIs públicas, espejos archivísticos y las propias
  casas. Eso es una fortaleza de coste y una fragilidad de continuidad: ninguna tiene acuerdo detrás.

---

## 2. El inventario

Clases de derechos, en orden de más a menos permisivo:
`attribution_ok` → `research_attribution_ccbysa` → `research_only` → `research_attribution_noncommercial`
→ `market_data` → `prohibited_betting`.

### Con registro escrito

| fuente | deporte | qué da | licencia | clase | coste | si cae |
|---|---|---|---|---|---|---|
| Jolpica-F1 | F1 | resultados 1950→hoy, parrilla, DNF con motivo | **CC BY 4.0** | `attribution_ok` | 0 | FastF1 (mismo origen); sin alternativa de igual profundidad |
| Leaguepedia (Cargo) | LoL | 97.588 partidas, scoreboard, picks/bans | **CC BY-SA 4.0** | `research_attribution_ccbysa` | 0 | espejo gptilt en Hugging Face (mismo origen, misma licencia) |
| lolesports (cliente web) | LoL | calendario y marcador de serie | sin términos publicados | `research_only` | 0 | Leaguepedia |
| Oracle's Elixir | LoL | dataset 2014-2026 | investigación | `research_only` | 0 | cuota agotada desde 18-ago; ya es el plan B, no hay plan C |
| vlr.gg | Valorant | series, mapas, mitades por lado, scoreboard | sin términos; robots.txt permite | `research_only` | 0 | Liquipedia Valorant (CC BY-SA), menos profundo |
| OpenDota | Dota 2 | partidos pro, picks/bans, parches | pública y gratuita | `research_only` | 0 | STRATZ (requiere clave); PandaScore sin detalle |
| API pública de la PDC | dardos | calendario, formato por ronda, resultados con legs | sin términos | `research_only` | 0 | **ninguna**: es la única con formato certificado por ronda |
| Darts Orakel | dardos | media, 180s, dobles por ventana | privado, sin redistribución | `research_only` (comercial DENY) | 0 | **ninguna** |
| WTT / ITTF gateway | tenis de mesa | agenda, match card oficial, historial punto a punto 2012→ | sin términos | `research_only` (comercial DENY) | 0 | **ninguna** |
| Sackmann (espejo) | tenis | ATP/WTA con estadística de saque | **CC BY-NC-SA 4.0** | `research_attribution_noncommercial` | 0 | repos originales retirados de GitHub; el espejo ES la alternativa |
| Riot Developer API | LoL, Valorant | datos estáticos, assets | **prohíbe apuestas** | `prohibited_betting` | 0 | **vetada, correctamente** |
| GRID | LoL, Valorant, Dota 2 | datos oficiales en vivo | contrato comercial | `upgrade_path` | de pago, sin cotizar | es el camino de subida, no una alternativa actual |

### Sin registro escrito — el hueco que A36 señala

| fuente | deporte | qué da | licencia conocida | riesgo | alternativa |
|---|---|---|---|---|---|
| **API-Football** | fútbol clubes | alineaciones, árbitro, córners, tarjetas, xG | de pago por plan; términos del proveedor | clave expuesta y **sin rotar** (pendiente desde el 15-sep) | ESPN (menos campos), manual |
| **football-data.co.uk** | fútbol clubes | resultados + cierre de Pinnacle, 1993→ | uso libre declarado en el sitio, sin licencia formal | es la base de TODA la validación de goles y mitades | ninguna con cierre histórico |
| **ESPN (site.api)** | fútbol, baloncesto | marcadores en vivo, boxscore | API no documentada, sin términos | se usa en producción en dos deportes | ninguna |
| **bo3.gg** | CS2 | partidos, rondas por mapa | robots.txt **desaconseja** `/api/` | rechaza el parseo del 26-35 % y es la ÚNICA con rondas por mapa | HLTV (ToS lo prohíbe), FACEIT/Liquipedia (sin aprobar) |
| **nflverse** | NFL | juegos, cierres 2016-2025, stats por jugador | CC BY 4.0 (declarada por el proyecto) | ninguno serio; **falta escribirlo** | ninguna de igual profundidad |
| **PandaScore** | esports | catálogos y marcador de serie | plan libre, términos del proveedor | sin detalle (403 en `/games/{id}`) | ya es el plan B |
| **Cloudbet / Pinnacle / Bovada** | todos | cuotas, cierres | términos de cada casa | `market_data`; Pinnacle cerró su API pública en jul-2025 | entre ellas |
| **Underdog** | props CS2 | líneas DFS por pierna | términos del proveedor | tabla de multiplicadores **sin verificar** (3× contra 3,5× voltea el signo del ROI) | ninguna |
| **Polymarket / Kalshi** | mercados | precios y resolución | términos de cada plataforma | `market_data` | entre ellas |
| **Open-Meteo** | NFL | pronóstico del kickoff | CC BY 4.0 | display, no entra al modelo | ninguna necesaria |
| **Google News** | observador | prensa por sujeto | términos de Google | display con cita textual; nunca toca una probabilidad | ninguna |
| **Wikipedia / Wikimedia Commons** | dardos y otros | retratos | CC BY-SA / por archivo | se enlaza, no se rehospeda | ninguna necesaria |

---

## 3. La revisión de CC BY-SA que A36 pide, y una corrección

`data/esports/lol/RIGHTS.md` clasifica Leaguepedia como `research_attribution_ccbysa` con
`betting_commercial_ok: NO`. La conclusión operativa —LoL admin-only, todo en sombra— **está bien**. El
razonamiento escrito, no del todo, y conviene arreglarlo porque razonar mal sobre una licencia lleva a
decisiones mal calibradas en los dos sentidos.

**CC BY-SA 4.0 NO prohíbe el uso comercial.** Eso es BY-**NC**-SA, que es otra licencia — la de Sackmann en
tenis, donde la prohibición sí es real y explícita. CC BY-SA permite explícitamente el uso comercial. Sus
dos obligaciones son:

1. **BY — atribución.** Crédito, enlace a la licencia e indicación de si se hicieron cambios.
2. **SA — compartir igual.** Si se distribuye **material adaptado**, hay que licenciarlo bajo los mismos
   términos.

Así que la razón por la que LoL es admin-only **no es la licencia de Leaguepedia**. Son otras tres, y
escribirlas por separado permite saber cuál se puede levantar y cuál no:

| motivo real | ¿se puede levantar? |
|---|---|
| **ShareAlike.** Publicar una pick derivada de esa base podría considerarse material adaptado, y eso arrastraría la obligación de licenciar la salida bajo CC BY-SA. | Sí, con análisis legal: depende de si el rating derivado es «material adaptado» o un hecho no protegible. Es la pregunta que LOL-0049 tiene que contestar. |
| **Términos de uso de Fandom**, que son distintos de la licencia del contenido y limitan la cosecha automática. | Con acuerdo o con una fuente licenciada (GRID). |
| **Riot prohíbe funcionalidad de apuestas** en su Developer API — y aunque Leaguepedia no es Riot, el dato de fondo es de partidas oficiales de Riot. | No por nuestra parte; es la restricción más dura y la que empuja al camino GRID. |

**Recomendación:** dejar la decisión operativa como está —admin-only, sombra, probabilidad anclada a
mercado— y corregir el texto para que diga el motivo correcto. Una prohibición atribuida a la licencia
equivocada es frágil: el día que alguien lea la licencia y vea que permite uso comercial, la restricción
entera pierde autoridad aunque siga siendo correcta por otras razones.

> No es asesoramiento legal. La revisión formal (LOL-0049) sigue pendiente y este documento no la sustituye.

---

## 4. Lo que hay que hacer, por orden de riesgo

1. **Rotar la clave de API-Football.** Lleva expuesta desde el 15-sep. Es lo único de esta lista que tiene
   un coste inmediato y cuantificable.
2. **Escribir el registro de las cinco fuentes de producción que no lo tienen**: API-Football,
   football-data.co.uk, ESPN, bo3.gg y nflverse. Cuatro deportes corren hoy sin ficha de derechos.
3. **Verificar la tabla de multiplicadores de Underdog.** 3× contra 3,5× cambia el ROI de props de −12,71 %
   a +1,83 %: no es un detalle de licencia, es que no sabemos qué paga el contrato.
4. **Corregir el razonamiento de CC BY-SA** en `data/esports/lol/RIGHTS.md` (§3 de este documento).
5. **Anotar el punto único de fallo de dardos y tenis de mesa.** Sus fuentes no tienen alternativa: si la
   PDC o WTT cierran el acceso, esos dos deportes se quedan sin base y sin liquidación el mismo día.
