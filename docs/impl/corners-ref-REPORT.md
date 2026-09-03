# REPORT — CÓRNERS: el árbitro entra al modelo, en sombra (rama `impl/corners-ref`)

**Fecha:** 3 de septiembre de 2026. **Base:** `673202bb` (origin/main al arrancar). **Spec:** capa pendiente de
`docs/BACKTESTS_FAMILIAS_2026-09-02.md` §3.4 ("el árbitro no entra a `project` y el total es la media de la
liga"). **Reglas cumplidas:** el servidor NUNCA se arrancó (`node --check` + scripts); CARDS (`cards_under_v1`),
CS2, LoL, real-executor, sombra y la regla de emisión de córners no se tocan; todo lo de producción va detrás de
`GP_CORNERS_REF` (default **off**) y con la variable apagada la proyección es byte-idéntica (smoke §4).

## 1. Commits (todos empujados a `origin/impl/corners-ref`)

| Commit | Qué |
|---|---|
| `dffbef04` | `scripts/corners-ref-backtest.js` (backtest walk-forward), `clubs-engine/referees.js` (módulo puro), `scripts/smoke/corners-ref-smoke.js`, `docs/CORNERS_ARBITRO_BACKTEST.md` |
| `be5f086a` | `server.js` (índice de árbitros, árbitro por evento, anotación en la pick, aplicación bajo flag, probe interno, siembra AF anota `referee`), `data-providers/apiFootballProvider.js` (`getFixtureReferee`), `data-providers/cache.js` (TTL `referee`) |
| (este) | `docs/impl/corners-ref-REPORT.md` |

## 2. Backtest — resultado (detalle y tablas íntegras en `docs/CORNERS_ARBITRO_BACKTEST.md`)

**Datos:** football-data.co.uk, 2122-2627, **11.466 partidos** con HC/AC y árbitro. Solo **E0, E1, E2, E3 y SC0**
traen `Referee`; SP1, D1, I1 y F1 traen córners pero no árbitro (comprobado columna a columna) → fuera. CSV en
`$SP/fd/`, no en el repo. Walk-forward por fecha; desarrollo 2122+2223 (K_team, DAMP, K_ref, r de la NB); test
2324-2627 (**6.938 partidos**). Bootstrap pareado 2.000 remuestreos + t iid.

**Modelos:** M0 media de liga (= producción, `TOTALS_DAMP=0`) · M1 +equipos (K_team = 40, DAMP = 0,5) ·
M2 +equipos+árbitro (multiplicador encogido `(K+Σr)/(K+n)`, `clubs-engine/referees.js`).

### 2.1 Test global (n = 6.938) — comparaciones pareadas (negativo = A mejor)

| Par | Δ MAE | t | Δ CRPS | IC 95 % bootstrap | t | p_boot | Δ Brier (4 líneas) | t | Δ log-score | t |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| M1−M0 (equipos) | −0,0142 | −4,08 | **−0,0114** | [−0,0154, −0,0072] | **−5,44** | 0,000 | −0,00149 | −4,42 | −0,0062 | −5,79 |
| M2−M1 (árbitro, K = 6.428 EB-desarrollo) | +0,0000 | 0,44 | −0,0000 | [−0,0001, +0,0000] | −0,65 | 0,519 | +0,00000 | 0,02 | −0,0000 | −0,99 |
| M2−M0 | −0,0142 | −4,07 | −0,0114 | [−0,0157, −0,0074] | −5,44 | 0,000 | −0,00149 | −4,41 | −0,0062 | −5,79 |

Por liga, M1−M0 es negativo en las 5 (t −2,2 a −2,6) y M2−M1 es cero en las 5 (|t| ≤ 1,3).

### 2.2 Qué costaría un prior más agresivo para el árbitro (test; r₂ ajustado en desarrollo a cada K)

| K_ref | Δ CRPS (M2−M1) | IC 95 % | t | Δ Brier | t | multiplicador p10 / p90 |
|---:|---:|---|---:|---:|---:|---|
| 14 (el `REF_PRIOR` de tarjetas) | **+0,0087** | [+0,0032, +0,0143] | **+3,04** | +0,00158 | +3,60 | 0,960 / 1,048 |
| 40 | +0,0040 | [+0,0001, +0,0078] | +2,02 | +0,00081 | +2,63 | 0,971 / 1,035 |
| 100 | +0,0013 | [−0,0012, +0,0038] | +1,08 | +0,00033 | +1,70 | 0,981 / 1,023 |
| **400** (elegido para producción) | −0,0000 | [−0,0009, +0,0009] | −0,03 | +0,00004 | +0,62 | 0,993 / 1,009 |

### 2.3 Varianza explicada por el árbitro con equipos controlados

ANOVA de efectos aleatorios sobre e = total − μ₁ (todas las temporadas, n = 11.158, 156 árbitros con ≥5
partidos): σ²_dentro = 11,53, **τ²_árbitro = 0,028 córners² (τ = 0,17) → ICC 0,24 %**, F = 1,17, p permutación
(1.000) = 0,079; solo test: 0,23 %, p 0,18. Fiabilidad mitad/mitad del efecto (126 árbitros ≥20 partidos):
ρ = 0,03. Los equipos explican el 0,9 % de la varianza del total. **K empírico-Bayes** = σ²/τ² ≈ 412 → **400**
en producción (en desarrollo puro τ² ≈ 0 → K ≈ 6.400).

**Veredicto:** el árbitro no añade información al total de córners; los equipos sí (poco pero estable). La capa
de árbitro queda en sombra y apagada; el hallazgo accionable —re-tunear `TOTALS_DAMP`/`PRIOR_MATCHES` de córners
hacia K_team ≈ 40, DAMP 0,5— NO se implementó (fuera del alcance de la spec; preregistrar antes).

## 3. Qué se implementó (sombra)

**Nuevo `clubs-engine/referees.js`** (puro): `normalizeName`, `shrunkMult(Σr, n, K)` (n=0 → 1), `emptyIndex` /
`addMatch` (cociente total/media-de-liga-del-momento, dedup por clave, `Number(null)` no cuenta como 0),
`effectFor(idx, nombre, {REF_PRIOR, REF_CLAMP, MIN_N})` → `{name, n, mult, effect = mult−1}`,
`applyToProjection(proj, eff)` (copia; solo `corners.total`; con mult 1 devuelve el MISMO objeto), `loadIndex` /
`saveIndex`. `DEFAULTS = { REF_PRIOR: 400, REF_CLAMP: 0.05, MIN_N: 1 }`.

**`data-providers/apiFootballProvider.js`:** `getFixtureReferee(fixtureId)` → `fixture.referee` con cache propia
`af:referee:<id>` (TTL nuevo `cache.TTL.referee` = 6 h); sin key o sin dato → `null`, nunca lanza.

**`server.js`** (líneas de la rama; 116 líneas de diff, +112/−4):

| Líneas | Región | Cambio |
|---|---|---|
| ~4595-4632 | `clubsSeedEventsAF` | Mapa par→ceid (`haveId`); el fixture AF trae `fixture.referee` **gratis**: se anota `referee` en el evento nuevo y, si el par ya estaba sembrado (dup), en el existente (+`af_fixture` si faltaba). Cero llamadas extra |
| ~5540-5607 | tras `clubPropsGate` (nuevo) | `REFS`, `cornersRefOn()` (`GP_CORNERS_REF` ∈ 1/true/on/yes), `cornersRefK()` (`GP_CORNERS_REF_K` o 400), `CLUB_REFEREES_FILE = <dir(DB_FILE)>/clubs/referees.json`, `clubRefereeIndex({force})` (memo por mtimes de todos los `props-history-<liga>.json` + nº de picks CORNERS liquidadas con `ref_name`; índice = props-history ∪ picks liquidadas con total vía `clubPropTotal` y media de liga de `clubPropsFit`; dedup liga\|equipos\|día; persiste en disco si existe `CLUB_DATA_DISK`), `clubRefereeFor(meta)` (árbitro de la siembra → `getFixtureReferee(af_fixture)` con presupuesto 200 llamadas/día no cacheadas → null; devuelve `{name, n, effect, mult, eff}` SIN aplicar) |
| ~7692, 7711-7723 | `buildClubDailyPicks`, bloque PROPS DE EQUIPO | `refCache2` por evento; tras `project(...)`: `clubRefereeFor(meta)` (try/catch, nunca bloquea); **solo si `cornersRefOn()`** → `projCache2[ceid] = REFS.applyToProjection(...)` (copia; tarjetas intactas). `refInfo` solo para `fam === 'corners_total'` |
| ~7747 | `propMarkets.push` | `...(refInfo \|\| {})` → `ref_name`, `ref_effect`, `ref_n`, `ref_applied` (córners; tarjetas nada) |
| ~7950-7954 | creación de picks CORNERS/CARDS | `recP = mkRecord(...)`; si `family === 'CORNERS'` y hay info → `Object.assign(recP, {ref_name, ref_effect, ref_n, ref_applied})`. `mkRecord` no cambia |
| ~21794-21809 | rutas internas (nuevo) | `GET /api/internal/corners-ref?key=<GP_EXPORT_KEY>[&rebuild=1]` → flag, K, clamp, fichero, `built_at`, partidos, árbitros, picks con árbitro/aplicadas, presupuesto AF, top 40 árbitros (n, media, cociente, multiplicador) |

**Cómo se enciende:** `GP_CORNERS_REF=1` (+ deploy). Opcional `GP_CORNERS_REF_K=<partidos equivalentes>` (default
400). Apagada (default): picks CORNERS con `ref_name`/`ref_effect`/`ref_n`/`ref_applied:false` cuando el árbitro
se conoce; proyección y probabilidad idénticas a hoy. **No hay motivo para encenderla** según el backtest; su
valor es la medición sobre las ligas AF (LATAM) que football-data no cubre.

## 4. Verificación

```
node --check server.js clubs-engine/referees.js data-providers/apiFootballProvider.js data-providers/cache.js \
  scripts/corners-ref-backtest.js scripts/smoke/corners-ref-smoke.js            → OK
node scripts/smoke/corners-ref-smoke.js                                          → 35/35 OK
node scripts/corners-ref-backtest.js --fd $SP/fd --no-download                   → ≈2 min, tablas + corners-ref-summary.json
```

Smoke (`scripts/smoke/corners-ref-smoke.js`): (1) n=0 → efecto 0; n=5.000 con cociente 1,10 y K=400 → mult
1,0926 (→ media del árbitro); K=0 → media cruda; clamp ±5 %; nombres normalizados. (2) índice: dedup por clave,
cocientes contra la media de liga del momento, `null` no entra, guardar/cargar, fichero ausente → vacío.
(3) proyección del prop-engine con fit sintético: árbitro desconocido → **mismo objeto**; encendido → copia con
solo `corners.total` × mult, `cards` byte-idéntico, original sin mutar, P(over) sube. (4) `server.js`: la función
`cornersRefOn` extraída del fuente da off para ausente/0/false/off y on para 1/true/on; `applyToProjection` se
llama en UN sitio bajo `cornersRefOn()`; la anotación es solo CORNERS; `cards_total` no recibe campos; ninguna
línea con `cards_under_v1` menciona `ref_`; `getFixtureReferee` devuelve null sin key.

## 5. Pendientes y riesgos

- **API-Football y el árbitro en producción:** no se pudo comprobar en vivo (sin key aquí, por diseño). Ruta
  esperada: `fixtures?league=&next=25` (siembra) ya trae `fixture.referee` para casi todos los fixtures a ≤7 días;
  si viene vacío, `getFixtureReferee(af_fixture)` con presupuesto. Si AF no publica árbitros en alguna liga,
  `ref_name` queda `null` y no pasa nada más. Comprobar tras el deploy con `/api/internal/corners-ref?key=`
  (`picks.with_ref` debería crecer en 24-48 h) y mirando `ref_name` en las picks CORNERS de `db.clubDailyPicks`.
- **Índice en el arranque:** el primer `clubRefereeIndex()` lee todos los `props-history-<liga>.json` del disco
  (síncrono, una vez por cambio de mtime/pick liquidada). Es del orden de lo que ya hace `clubPropsFit`.
- **Nombres de árbitro:** props-history y la siembra usan la MISMA fuente (AF, `fixture.referee`), así que las
  claves casan. Si un día el árbitro entra por otra fuente (TSA/ESPN) habrá que revisar `normalizeName`.
- **Riesgos de merge en `server.js`:** las regiones tocadas son `clubsSeedEventsAF` (~4595-4632), el bloque
  nuevo tras `clubPropsGate` (~5540-5607), el bloque PROPS DE EQUIPO de `buildClubDailyPicks` (~7692-7747), la
  creación de picks de props (~7950) y las rutas internas junto a `/api/internal/shadow` (~21794). Todas son
  aditivas o de una línea; `mkRecord` y `curate` no cambian. Conflicto probable solo si otra rama toca el mismo
  `propMarkets.push` o la creación de picks CORNERS/CARDS.
- **Fuera de alcance, recomendado como siguiente paso (preregistrar):** re-tunear `TOTALS_DAMP`/`PRIOR_MATCHES`
  de córners en `clubPropsFit` (K_team ≈ 40, DAMP 0,5 ganó con t −5,4 en test), separando el auto-tune de
  córners del de tarjetas.
