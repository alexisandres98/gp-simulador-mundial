# REPORT — mejoras de BALONCESTO (rama `impl/hoops`, base `72f9c1d`)

Fecha: 2 de septiembre de 2026. Spec: `scratchpad/impl/spec-hoops.md`. Sin arrancar `server.js`; sin tocar
umbrales del monitor (w, `edge_pp`, cuotas, `gates.js`); sin tocar `cards`, `cs2`, `lol`, `real-executor/`,
la sombra ni `simulate.js`.

## Commits (todos empujados a `origin/impl/hoops`)

| Commit | Qué |
|---|---|
| `07f83e6` | Helpers puros: `basketball-engine/clv.js` y `basketball-engine/injuries-history.js` |
| `8993298` | `server.js`, solo regiones de baloncesto (detalle abajo) |
| `6404621` | `scripts/smoke/hoops-smoke.js` (39 comprobaciones) + `docs/PREREGISTRO_WNBA_DESCANSO.md` |
| `ba078d7` | Enmienda del 2-sep en `docs/PREREGISTRO_WNBA_TOTALES.md` |
| (este) | `docs/impl/hoops-REPORT.md` |

## Archivos

- **Nuevos:** `basketball-engine/clv.js`, `basketball-engine/injuries-history.js`, `scripts/smoke/hoops-smoke.js`,
  `docs/PREREGISTRO_WNBA_DESCANSO.md`, `docs/impl/hoops-REPORT.md`.
- **Modificados:** `server.js` (+136/−11), `docs/PREREGISTRO_WNBA_TOTALES.md`.

## Regiones de `server.js` tocadas (líneas de la rama)

| Líneas | Función | Cambio |
|---|---|---|
| 11427-11430 | `buildHoopsPicks` | `require('./basketball-engine/clv')`; contador `saltadas_por_tesis` en `out` |
| 11579-11600 | `buildHoopsPicks` (bucle de candidatos) | `restF` una vez por partido (calendario ESPN de la ventana + `C.games`); **una pick por tesis**: si `findByThesis(db.hoopsPicks, fam\|side\|game_id)` encuentra una (ACTIVE o SETTLED) → `saltadas_por_tesis++`, `addRequote` en la existente, la familia queda ocupada en esa pasada, `continue`; `consensusLine = mainLine(list…)` |
| 11631-11644 | objeto `pick` | `thesis`, `clv_v: 2`, `clv_price_pct`, `close_fair`, `close_line`, `line_moved_pts`, `market_fair_at_create`, `market_line_at_create`, `line_at_create`, `consensus_line_at_create`, `requotes: []`; solo TOTAL: `home_rest_days`, `away_rest_days`, `rest_diff`, `prereg_rest_over` |
| 11760-11812 | `hoopsPicksCloseline` | `close_line` (línea principal al cierre) + `line_moved_pts` aunque nuestra línea ya no cotice; `close_odds` igual que antes; `clv_price_pct` = fórmula vieja; `close_fair` (Shin, mismo método que al nacer); **`clv_pct` = justa vs justa**; `clv_v = 2`; devuelve `{ closed, lines }` |
| 11815-11823 | `migrateHoopsClv` (nueva) | migración idempotente `clv_v: 2` de picks ya cerradas (`close_odds` + `market_prob`) |
| 11825-11876 | `hoopsPicksTrack` | `agg` añade `clv_price_avg/_n`, `line_moved_avg/_n`, `theses`; raíz añade `theses_all_time`, `requotes_total`, `clv_live.price_*`, `clv_v`, `clv_pendientes_migracion`, `notas` (qué mide cada CLV). Campos existentes intactos (`edge-board.js` y `/api/internal/*` siguen leyendo `clv_avg`, `clv_n`, `clv_sd`) |
| 11878-11890 | `hoopsInjuriesHistoryJob` (nueva) | vuelca `db.hoopsObs` a `<dirname(DB_FILE)>/hoops/injuries-history.jsonl` |
| 11897-11908 | `hoopsChain` + temporizadores | `migrateHoopsClv()` al inicio de la cadena; job de bajas al final de la cadena y cada 24 h |
| 18459-18465 | `GET /api/hoops/picks` | `?limit=` (por defecto 120, tope 2000; la ruta ya era solo admin) + `settled_total`, `limit` |
| 18866-18880 | `GET /api/hoops/perf` | bloque `preregistro_descanso` (`muestra` desde 2026-09-17 e `historico`) + `clv_notas` |

## Tarea por tarea

1. **CLV justa vs justa.** Comprobado: `market_prob` YA ES la probabilidad justa del consenso de la selección
   (mediana de implícitas por lado + `PRC.novig` Shin) en la línea de la pick; `market_fair_at_create` la
   repite con nombre explícito y `market_line_at_create` es esa línea. Al cierre `close_fair` se calcula con
   el MISMO método sobre el mismo mercado (misma línea). `clv_pct = (close_fair / market_fair_at_create − 1)·100`;
   la fórmula vieja queda en `clv_price_pct`. **Migración:** picks cerradas sin `clv_v: 2` → `clv_price_pct`
   = su `clv_pct` viejo, `close_fair = 1/close_odds` (consenso PROPORCIONAL sin margen, el que guardaba la
   fórmula vieja; se deja constancia en `close_fair_method: 'proporcional_desde_close_odds'`), `clv_pct` nuevo.
   Residuo conocido: Shin vs proporcional difieren unas décimas de pp en favoritos claros, así que el CLV
   migrado es una aproximación; las picks nuevas son Shin-vs-Shin exactas. `/api/hoops/perf` → `metrics.
   scorecard.clv` (usa `clv_pct`, ahora el justo) y `clv_notas`; track → ambos CLV con nota.
2. **Una pick por tesis.** `thesis = fam|side|game_id` (mismo formato que ya usaba `GATE.evaluate`). Picks
   viejas sin campo `thesis` se resuelven con `thesisOf()` (mapea `MONEYLINE/SPREAD/TOTAL` → `match_winner/
   spread/match_total`). Re-cotizaciones: máx. 20, y **no se anota si la última tiene la misma línea y cuota**
   (el constructor pasa cada 30 min; sin esto el tope se llenaría de copias en 10 h). Decisión propia,
   documentada acá.
3. **Líneas.** `line_at_create` = nuestra línea; `consensus_line_at_create` = línea principal del mercado (la que
   más casas cotizan; empate → la más cercana a la nuestra); `close_line` = principal al cierre; `line_moved_pts`
   con signo a favor nuestro (under: `line_at_create − close_line`; over: al revés; hándicap normalizado al
   local: local `line − close`, visitante al revés; ganador: null). Track: `line_moved_avg` por familia.
4. **Descanso.** Definición idéntica al backtest H4: `min(7, Δt/86400e3)`, sin partido previo → 3;
   `rest_diff = away_rest − home_rest`; etiqueta `prereg_rest_over` si `> 0,9`. Solo en picks de TOTAL, solo
   etiqueta. Bloque `preregistro_descanso` en `/api/hoops/perf`: `muestra` (partidos completados con `date ≥
   2026-09-17`) e `historico` (referencia), con `n_disparos`, `n_con_linea`, `over/under/push`, `over_pct`,
   `over_se_pp`. Línea de referencia: `close_line` de la pick de TOTAL del partido si existe, si no
   `odds[0].ou` del dataset ESPN. Doc: `docs/PREREGISTRO_WNBA_DESCANSO.md`.
5. **`PREREGISTRO_WNBA_TOTALES.md`**: sección "Enmienda del 2 de septiembre" con las dos reglas nuevas y el
   aviso de que el régimen V2 solo deja unders → la muestra no valida overs. Ver hallazgo abajo.
6. **Bajas histórico.** `injuries_seen` existe en `data-fabric/snapshots.js` (inputs del congelado de
   predicción) y el parte vive además en `db.hoopsObs` (último por partido) y en el dominio `injuries` del
   fabric (eventos por jugador al cambiar). El job vuelca `db.hoopsObs` a una fila por equipo y día
   `{date, league, game_id, team, players_out[], players_doubtful[], observed_at}` en
   `<dirname(DB_FILE)>/hoops/injuries-history.jsonl` (misma raíz de disco persistente que esports).
   Idempotente por `día|liga|partido|equipo|hash(fuera+dudas)`: si el parte cambia en el día se añade otra fila.
   Corre al final de `hoopsChain` (arranque) y cada 24 h.
7. **Export.** `GET /api/hoops/picks?limit=2000` (tope 2000, admin).

## Verificación

- `node --check server.js basketball-engine/clv.js basketball-engine/injuries-history.js scripts/smoke/hoops-smoke.js` → OK.
- `node scripts/smoke/hoops-smoke.js` → **39 ok, 0 fallas, "Todo en orden"** (exit 0). Cubre: mercado quieto →
  `clv_pct = 0` y `clv_price_pct = −4` (margen ~4,5 % del mercado sintético); mercado que viene hacia nosotros
  → `clv_pct +17`; migración idempotente conserva el viejo; `Under 171` y `Under 171,5` misma tesis, over y
  otro partido no; requotes sin copias y tope 20; signo del movimiento en las 4 combinaciones + ganador null;
  línea principal por número de casas; descanso por equipo, `rest_diff`, disparo, saturación a 7, defecto 3,
  evaluación del preregistro y corte por fecha; bajas: filas planas, segunda pasada 0 anexadas, cambio del
  parte → fila nueva.
- `scripts/hoops-strategy-backtest.js` (sin cambios) con `run('wnba', { sims: 400, refit: 40 })`: 203 partidos,
  473 ms, exit 0. `base.overall` n=387, ROI −1,95 % ± 5,98. Confirma que nada de esta rama toca la ruta del backtest.
- `node scripts/llm-smoke.js` no aplica (no se tocó `llm.js`).

## Hallazgos que NO se tocaron (preregistro / fuera de alcance)

- **El filtro de overs del régimen V2 es código muerto:** `if (m.fam === 'total' && side !== 'under') continue;`
  (server.js ~11566) compara contra `'total'` y la familia se llama `match_total` (`markets.js` FAMS). En
  la práctica el V2 **sí deja pasar overs** con `edge ≥ 5`. No se corrigió porque cambia la regla de emisión
  a mitad de ventana (regla dura); queda anotado en el preregistro de totales para leer la muestra por lado y
  decidirlo antes del 17-sep. Si se corrige, va en un commit propio con su fecha.
- `hoopsPicksCloseline` sigue exigiendo que NUESTRA línea cotice a 25 min del inicio para el CLV; si el
  mercado se movió y esa línea desapareció, `clv_pct` queda null pero ahora sí se guarda `close_line` y
  `line_moved_pts`. Interpolar el cierre a otra línea sería inventar un número.

## Pendientes

- Rellenar "Resultado" en los dos preregistros al llegar a 60 (picks / disparos).
- Cuando el JSONL de bajas tenga semanas, enchufarlo al backtest de estrategia (`stack` ≠ `base`).
- Panel admin: mostrar `clv_price_pct` junto a `clv_pct` (hoy la card lee `clv_pct`; sigue funcionando y ahora
  muestra el justo).

## Riesgos de merge

- `server.js` cambia en cuatro regiones de baloncesto (11427-11644, 11760-11908, 18459-18465, 18866-18880);
  cualquier rama que toque `buildHoopsPicks`, `hoopsPicksCloseline`, `hoopsPicksTrack` o las rutas
  `/api/hoops/{picks,perf}` chocará. Las ramas hermanas (`impl/tenis`, `impl/valorant`) no deberían tocar esas
  funciones.
- La migración corre en el arranque de la cadena (200 s tras levantar) y hace `save()` una vez: en producción
  (~186 picks) es instantánea. Idempotente: un reinicio no la repite.
- `hoopsInjuriesHistoryJob` escribe en `path.dirname(DB_FILE)/hoops/`; en Render es `/data/hoops/` (disco
  persistente, misma raíz que `db.json`, `clubs/`, `esports/`). Si el directorio no se puede crear, el job
  loguea y sigue: nunca tumba el proceso.
- Ningún cambio en frontend: `public/app.js` sigue leyendo `clv_pct`/`clv_avg` y los recibe (ahora justos).
