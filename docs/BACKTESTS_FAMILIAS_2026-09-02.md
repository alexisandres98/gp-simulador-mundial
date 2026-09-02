# Backtests de mejoras por familia perdedora — 2 de septiembre de 2026

> Continuación de `AUTOPSIA_MODELOS_2026-09-02.md`. La autopsia dijo *dónde* perdemos frente al mercado; este
> documento prueba, **con datos y fuera de muestra**, *qué cambios al modelo* lo arreglan y cuáles no. El
> encargo de Alexis fue explícito: **no cerrar familias, mejorar los modelos que pierden**, y no dar ninguna
> recomendación sin backtest. Ninguna regla de producción se cambió: solo medición.

## 0. Lo que NO se tocó ni se toca

- `cards_under_v1` (tarjetas under), `cs2_rounds_v1` (rondas CS2) y `lol_kills_hcp_v1` (kills LoL en sombra)
  quedan **exactamente como están**. Son las tres que funcionan; ningún backtest de aquí los usa como sujeto y
  ninguna recomendación los afecta.
- La doctrina congelada del ejecutor real (mínimo de saldo, sin ETH, segmentos) no cambia.

## 1. Cómo se hizo

- Cinco backtesters independientes (fútbol de clubes, Valorant, baloncesto, tenis, combate), cada uno con
  hipótesis de **mejora del modelo** declaradas antes de mirar el holdout, evaluación walk-forward o split
  temporal, bootstrap pareado y error estándar en todo.
- Cinco **escépticos** independientes después, uno por familia, con la orden de refutar: re-ejecutaron los
  scripts del autor (todos reproducen byte a byte), buscaron fugas de futuro, artefactos de especificación,
  multiplicidad, picks correlacionadas y errores de definición. Lo que sigue en pie tras ellos es lo que se
  puede recomendar; lo que cayó se dice con la misma claridad.
- Regla de lectura: con las muestras de los libros (30-600 picks) **el ROI no decide nada** (error estándar de
  7 a 20 puntos). Decide el **CLV** (precio de cierre) y, en los históricos largos, el **Brier/log-loss**
  pareado con miles de partidos. Cuando se dice "t" es el estadístico de la diferencia frente a la base.

## 2. Resumen ejecutivo — qué mejora al modelo y qué no

| Familia | Mejora probada | Veredicto tras el escéptico | Efecto medido | Qué cambiaría en producción |
|---|---|---|---|---|
| Tenis ATP ganador | Edad lineal en el logit del ensamble | **SOBREVIVE** (la más sólida) | skill 10,12 → 10,62 %, ΔLL 0,00345, t 5,8, n=4.908; coeficiente estable 9 años | Añadir −0,10 · Δedad/5 al ensamble ATP (dob ya está en `players.json`). WTA no (empeora). |
| Tenis ATP ganador | Calendario: log días sin jugar + partidos en 7 días | **SOBREVIVE DEGRADADA** | +0,4 pp de skill dada la edad (ΔLL 0,00273, t 3,1); los otros 5 rasgos de fatiga no aportan | Solo cuando producción tenga fecha real del último partido (la agenda ESPN la trae). |
| Tenis TOTAL/SPREAD | Distribución de juegos: punto calibrado + residuo empírico por formato×tercil (C6) en vez del desplazamiento | **SOBREVIVE en ATP a 3 sets**; no demostrada en bo5 ni en WTA | ATP bo3: Brier over/under abanico 0,2421 → 0,2392 (t 9,9), CRPS t 8,9, fiabilidad 0,444 → 0,443 | Sustituir el desplazamiento de `store.js:169` por C6 solo en ATP bo3; medir en sombra en Grand Slam antes de extender. |
| Valorant rondas | Bisección de pRound (que la sim gane el mapa tantas veces como dice p_mapa) en vez de `×0,44` | **SOBREVIVE como parche** | Brier hándicap de rondas −0,015 (SE 0,0055, n=128 libro); con ella **0 de las 80 under** habrían nacido | Implementar la bisección en `valorant.js` (líneas 319/339/368). |
| Valorant nivel | Anclar la probabilidad de mapa al mercado (como `cs2.js:373-386`) | **RECOMENDADO por eliminación** | Ningún rating propio bate al win-rate (Δ −0,0022 ± 0,0022); favorito de producción gana 45 % (n=106); implícita del mercado 55,7 % | mapShift por bisección + Elo de serie con temperatura 0,85 y peso máx. 0,25; win-rate por mapa solo como efecto relativo. |
| Valorant blend | Peso `c` de la desviación GP | **RECHAZADA** | c = −0,20 (RONDAS_HANDICAP −0,40): la desviación es anti-informativa | No publicar `p_gp` crudo; el nivel lo pone el ancla. |
| Fútbol 1X2 | Blend `c` del Elo sobre el mercado | **RECHAZADA** | c = −0,14 (SE 0,22); el Elo no añade información al 1X2 | La probabilidad publicable del 1X2 es la del mercado con de-vig corregido, hasta que el rating mejore (§3.6). |
| Fútbol 1X2 | De-vig del consenso: proporcional → Shin/potencia | **PENDIENTE de dato** (mecanismo confirmado) | cuota >5: mercado 17,1 % vs observado 13,1 % (n=84); la regla "mejor cuota > justa" pierde −27 % por eso | Recomputar con el vector 1X2 completo del `odds-archive` y medir; arregla ancla y selección a la vez. |
| Fútbol copas | Excluir copas del 1X2 | **CAE como "acepta"** → inconcluso | Con la definición correcta (por clave de liga, n=62): ROI −33 % (t −1,3), no −52 % (t −3,8); permutación p 0,13 | Lo que sí sobrevive es el **mecanismo**: `clubsEnsureCups` fusiona pools de Elo sin recalibrar (discrepancia +22 pp vs +10 pp). Arreglo: prior por división al fusionar, no excluir. |
| Fútbol GOALS | Reescalar λ×k / recalibrar | **RECHAZADA** | Nivel correcto (modelo 0,518, mercado 0,527, observado 0,523); k=0,96 empeora fuera de muestra | Nada en la calibración. El problema es precio/momento (CLV −1,32 %, t −4,1): medir en sombra publicar ≤48 h y exigir cuota ≥ justa del consenso. |
| Fútbol CORNERS | Exigir ≥2 casas cotizando la línea | **INCONCLUSO-FAVORABLE** | +12,1 % (n=204, SE 6,1, t clúster 2,0); frente al nulo de mercado p 0,0003; pero Liga MX aporta el 60 % de las unidades (sin ella +5,5 %, t 0,97) y `books` se refresca en las 2 h finales | Preregistrar: regla "ventana final ≤2 h con ≥2 casas", Liga MX contada aparte, ~225 picks para detectar +12 %. |
| Fútbol CORNERS | Desviación de la línea vs media de liga; seguir el movimiento al cierre | **RECHAZADAS** | log-loss 0,682 vs 0,676 solo mercado; seguir el cierre −8,3 % ± 7,0 | Nada. El árbitro sigue sin entrar a `project` (server.js 7239): es la única capa nueva sin probar. |
| Baloncesto TOTAL | Histograma a 1 punto (ya desplegado) | **SOBREVIVE como corrección de código**, no como rentabilidad | Sesgo determinista ±4,3/2,1 pp por resto de la línea; al cierre WNBA −6,4 % ± 9,4, NBA −2,25 % ± 4,0 | Mantener. Preregistro de 60 totales ya escrito (`PREREGISTRO_WNBA_TOTALES.md`). |
| Baloncesto SPREAD/TOTAL | Umbral × peso de mezcla | **RECHAZADA** | β(desacuerdo modelo−cierre → residuo) ≈ 0 en las dos ligas: WNBA total −0,22 [−1,01; 0,52], NBA −0,05 [−0,29; 0,18] | Sin cambio de umbral. La capa de plantilla que corre en producción **nunca se backtesteó** (no hay parte de bajas histórico). |
| Baloncesto medición | Fórmula del CLV | **DEFECTO CONFIRMADO** | −3,16 de los −4,62 puntos del CLV de hándicap son el margen de la casa (cierre sin vig vs cuota con vig) | Corregir `settleHoopsPicks`: comparar probabilidad justa contra probabilidad justa. Una pick por tesis (79 picks = 15 tesis). |
| Baloncesto WNBA TOTAL | Descanso diferencial → over | **PREREGISTRAR, no publicar** | corr −0,24 dev / −0,16 test; regla 13/18 en test pero p 0,11 frente al over ciego de la ventana | Regla fija "over si el visitante llega con >0,9 d más de descanso", 60 partidos, cuando vuelva la WNBA. |
| Combate FIGHT | Modelo ACTUAL (Elo + rasgos) vs Elo puro | **SOBREVIVE** (t −8,2 UFC / −6,4 MMA) | El núcleo del modelo es bueno; está calibrado en el histórico (favorito 60,4 % predicho, 61,1 % real) | **No tocar `ratings.js`.** |
| Combate FIGHT | Tramos de edad, inactividad no lineal, SPREAD por división, estatura | **RECHAZADAS** | La edad por tramos **empeora** (t +2,4); las demás t entre −0,02 y +1,0 | Nada. |
| Combate FIGHT | Racha ponderada por calidad del rival; guardia zurda; pesaje real | **INCONCLUSAS** | Signo correcto, P(mejor) 0,93 / 0,64 / 0,94; falta muestra | Re-test con ~2.000 peleas más. Cerrar el skew de pesaje (entrena con libras reales, sirve 2 lb fijas). |
| Combate FIGHT | Peso del mercado 0,8; veto por deriva pre-publicación | **RECHAZADAS** | w=0,8: n=24, CLV −8,9 (concentra en las peores); veto: sin evidencia (t 1,5, n=11) | Nada. |
| Combate FIGHT | Publicar solo cuando el lado del modelo es también favorito del mercado | **PREREGISTRAR** (único corte robusto) | Perro: CLV −8,64 ± 2,47 (t −3,5, n=34); favorito: +3,31 ± 1,73; diferencia +11,9 pp (t 4,0), se mantiene post-techo (t 2,35). Solo en CLV, no en ROI | Regla k ≥ 0,45, techo 3, umbral 2 pp; 40 picks; éxito = CLV medio > 0. |
| Combate ROUNDS | — | **DEJAR CORRER** | CLV +2,13 ± 0,82 (t 2,6, n=37) | Nada. |

## 3. Fútbol de clubes — SOLID (1X2), GOALS, CORNERS

**Libro:** SOLID n=432 decididas (acierto 31,9 %, ROI −12,6 % ± 7,4; Brier modelo 0,238 vs mercado 0,201),
GOALS n=130, CORNERS n=587 (ROI +0,1 %). Scripts: `backtests/futbol-clubes/{backtest,filters2,diag}.js` y
`futbol-skeptic/{skeptic,skeptic2}.js`.

### 3.1 El Elo no añade información al 1X2 (H1) — rechazada
Blend `p* = σ(logit(p_mkt) + c·[logit(p_gp) − logit(p_mkt)])` ajustado en el 60 % temporal: **c = −0,14 (SE
0,22)**; en 50/50 c = −0,05. El p* iguala al mercado (Brier 0,1945 vs 0,1953) y no produce regla rentable: la
regla "apostar si p*·cuota > 1" da **−20 % a −27 % fuera de muestra**. La razón es de precio, no de modelo: la
"mejor cuota" entre 30 casas cae en longshots que el **de-vig proporcional sobreestima** (cuota >5: mercado
17,1 % vs observado 13,1 %, n=84). El 0,5·modelo + 0,5·mercado actual tiene Brier 0,2108 vs 0,1953 del
mercado en evaluación.

### 3.2 Copas (H2) — cae como "acepta", sobrevive el mecanismo
El backtester encontró copas n=51 con ROI −52 % (t −3,8) y "sin copas" mejorando la evaluación de −13 % a
−3 %. El escéptico lo tumbó: la regex contaba **"Championship"** (2ª inglesa, 3 aciertos) y omitía **Coppa
Italia** (14 picks, +58 %). Con la definición correcta por clave de liga (n=62): **ROI −33,2 % (SE 25,6, t
−1,30)**; diferencia con no-copas t −0,9; permutación de la etiqueta p 0,13; el split 50/50 no declara el
filtro; bajo el nulo de mercado el 75 % de las veces alguno de los 15 filtros da una mejora igual a la
observada. Además copas y no-copas rinden **por debajo del mercado en la misma medida** (p 0,05 y 0,04): no
son un caso especial, son el mismo problema.

Lo que sí queda en pie: `clubsEnsureCups` (server.js 4256-4270) **fusiona por referencia los pools de Elo de
las ligas de origen sin recalibrar escalas**, y la discrepancia modelo−mercado es el doble en copas (+22,0 pp
cuando cruzan divisiones n=47, +16,5 pp mismo nivel n=15) que en liga (+10,1 pp, n=370). La mejora al modelo
no es excluir copas: es **poner un prior por división al fusionar pools** y medir si la discrepancia baja.

### 3.3 GOALS (H4) — calibración correcta, problema de precio
Modelo p_over 0,518, mercado 0,527, observado 0,523; Brier 0,258 vs 0,252. Reescalar λ×k (k ajustado
0,96-0,97) **empeora** el log-loss fuera de muestra (0,682 vs 0,674). Ningún filtro declarado sobrevive. Lo que
falla es el **CLV: −1,32 % (t −4,1)**: se publica a un precio que luego mejora. En evaluación, publicar con
<48 h de antelación da +8,0 % (n=43) y +1,0 % (n=51) pero no es declarable en el ajuste → **medir en sombra**
la regla "≤48 h y cuota ≥ justa del consenso" antes de tocar nada.

### 3.4 CORNERS — la regla ≥2 casas (H2) queda inconclusa-favorable
- A favor: ROI +12,1 % (n=204, SE 6,1; t iid 1,95, clúster liga×semana 2,01); a cuota de creación +13,4 %;
  frente al nulo "el mercado acierta" (que daría −8,1 % por el margen) el exceso es +20 pp, **p 0,0003**;
  sobrevive la multiplicidad de 18 filtros (P 0,02-0,04); positivo en los 5 cortes temporales; efecto dentro de
  cada lado (under ≥2 +7,6 % vs under 1 casa −10,7 %); el lado elegido supera al consenso +9,7 pp (t 2,9).
- En contra: `books` es el **refrescado ≤2 h antes del saque** (`refreshClubPickPrices`), no el de creación;
  con el de creación n=142, +9,4 % (t 1,23). **Liga MX** (25 overs, +59 %) aporta 14,8 de las 24,6 unidades;
  sin ella +5,5 % (t 0,97). No hay monotonía en el nº de casas (2-3: +23 %; 4-7: −1,6 %; 8+: +17,6 %). El grupo
  "1 casa" son 212 unders de LeoVegas (−10,8 %): la casa está bien calibrada y el pick pierde el margen.
- Lo que NO predice: la desviación de la línea respecto a la media de liga (log-loss 0,682 vs 0,676 solo
  mercado) ni el movimiento hacia el cierre (corr −0,000; seguirlo −8,3 % ± 7,0). `closing.odds == best_odds`
  en 544/587 córners: el "ROI a cierre" no era comprobación independiente.
- **Mejora al modelo pendiente y no probada:** el árbitro no entra a `project` (server.js 7239) y el total es
  la media de la liga (`TOTALS_DAMP=0`). Es la única capa nueva de información disponible; hay que
  backtestearla con `data/history` antes de esperar edge.

### 3.5 Medición que hay que arreglar antes de leer el libro otra vez
- 276 SOLID, 353 GOALS y 479 CORNERS **SUPERSEDED sin resultado**: la regla `lead` poda cuando el mercado se
  acerca al modelo, así que la muestra decidida está seleccionada **en contra** del modelo. Liquidarlas
  retroactivamente (marcadores en `props-history/results` del disco).
- `best_odds` es la cuota refrescada; la de creación vive en `odds_at_create` (distinta en 368/432 SOLID y
  336/587 CORNERS) y a esa cuota todos los ROI de SOLID empeoran 4-6 pp. Guardar `books` de creación.
- Guardar el **vector 1X2 completo** (justa y mejor cuota de local/empate/visita) por pick: sin él no se puede
  recomputar el de-vig Shin/potencia. Está en `data/clubs/odds-archive/*.json.gz` del disco desde el 26-jul.
- 65 SOLID y 40 GOALS tienen cierre capturado 0-17 min **después** del saque (precios in-play).

### 3.6 Mejoras del rating que no se pudieron backtestear (H6)
Prior de mercado al inicio de temporada, regresión entre temporadas, K y suelo λ por liga, alineaciones.
Requieren `data/history/comp_*-sn_*.json` (gitignored) y cierres históricos (football-data.co.uk). Criterio
de aceptación: log-loss < cierre en walk-forward por temporada. Hasta entonces la probabilidad publicable del
1X2 debe ser el consenso con de-vig corregido, y el Elo se usa como **desviación** con peso `c` que hoy es 0.

## 4. Valorant — RONDAS, RONDAS_HANDICAP, RONDAS_EQUIPO, HANDICAP de mapas

**Libro:** 304 picks, acierto 35,2 %, ROI −8,16 %; Brier p_gp 0,248 vs mercado 0,219-0,221. Por familia:
RONDAS 81 (−15,7 %, CLV +1,2), RONDAS_HANDICAP 142 (−21,2 %), RONDAS_EQUIPO 31 (+6,9 %), HANDICAP de mapas 48
(+32,1 %). Scripts: `backtests/valorant/h1..h6*.js`, `skeptic_valorant.js`.

### 4.1 Nivel: nadie bate al win-rate, tampoco nosotros (H1) — inconcluso
Ventana intacta de 90 días (626 series, 1.591 mapas): Elo por mapa con temperatura Brier 0,2420 vs win-rate
encogido 0,2442 (**Δ −0,0022, SE 0,0022**). En VCT todo ronda la moneda (0,244-0,250, n=518). El favorito de
producción ganó el mapa el **45,3 % de 106 event-maps únicos** (no el 39,4 % que salía contando picks
repetidas); el favorito del Elo 53,8 %; la implícita del hándicap del mercado **55,7 %** (n=97). La hipótesis
"Elo por nombre de mapa" no es evaluable: `series.json` no trae nombre de mapa (el detalle está en
`/data/val-raw` en Render).

### 4.2 Forma: la bisección sustituye al `×0,44` (H2) — sobrevive como parche
`clampRound` hace que un equipo con p_mapa 0,70 gane el mapa simulado el **82 %** (0,90 con p 0,80). La
bisección (pRound tal que P(gana|sim) = p_mapa) baja el Brier del hándicap de rondas **−0,0148 (SE 0,0055,
n=128 mapas del libro)** y −0,0177 (SE 0,0042) con la p que producción usó de verdad. El escéptico añade dos
límites: (a) los 104 BO1 "de evaluación" caen dentro de la ventana donde H1 eligió sus hiperparámetros, así
que solo cuentan los 128 del libro; (b) un control que **ignora p** (pRound 0,5) iguala o supera a la
bisección fuera de muestra (con p de producción: hándicap −0,012, SE 0,005 a favor de ignorarla). Es decir:
la bisección es mejor que lo que hay, pero **lo que hace es quitar la información falsa de p, no acertar más**.

### 4.3 Las 80 under no habrían nacido (H4/H6) — sobrevive
Con la bisección sola y la p de producción: **0 de 80** under pasan el listón (p_under media 0,418 vs mercado
0,401; Brier 0,2206 vs mercado 0,2208 vs original 0,2398). Con p_mapa del mercado: 0 de 73. La ventaja under
salía **entera** de multiplicar una p extrema por el ×0,44.

### 4.4 Blend (H3) — rechazada
c = −0,20 (RONDAS_HANDICAP −0,40, RONDAS_EQUIPO −0,45). En evaluación (122 picks) el blend iguala al mercado
(0,2174 vs 0,2176) y no genera apuestas con EV>0, frente a −13 % de ROI de las picks tal cual nacieron.

### 4.5 Cómo se mejora el modelo (orden)
1. Bisección en `valorant.js` (368, y la misma inversión en `rounds_by_map` 339 y mapa 1 en 319).
2. **Anclar la probabilidad por mapa al mercado** como `cs2.js:373-386` (mapShift por bisección); cuando exista
   mercado de mapa o de hándicap de rondas del mapa, invertir el modelo corregido sobre su precio sin margen.
3. Voz propia sobre el nivel solo como **Elo de serie** con temperatura 0,85 y peso máximo pequeño
   (`anchoredProbability maxModel ≤ 0,25`); el win-rate por mapa encogido n+8 nunca como nivel, solo como
   efecto relativo entre mapas en `vetoInput`.
4. NO tocar eco drag, umbral de prórroga ni momentum (no mejoran fuera de muestra).
5. Datos: guardar **ambos lados** de cada mercado de rondas (hoy el margen de Pinnacle/Bovada se supone 5 %/
   7,5 %), la p de mercado al nacer la pick, y traer `/data/val-raw` con nombres de mapa para poder probar el
   Elo por mapa y reconstruir `map-stats` point-in-time.

## 5. Baloncesto — WNBA/NBA SPREAD, TOTAL, MONEYLINE (monitor privado)

Scripts: `backtests/hoops/{hoops-bt,h1h2,h3,h4}.js`, `skeptic/*.js`, y `scripts/hoops-strategy-backtest.js`.

### 5.1 Histograma (H1) — corrección de código, no de rentabilidad
El cubo de 5 desplazaba P(over) **+4,3/+2,1 pp** en líneas x4,5/x3,5 y −4,3/−2,1 en x0,5/x1,5 (WNBA; NBA
±4,0/2,0), determinista. Ya está desplegado (commit `5b659ac`). Al cierre el sesgo se cancela entre residuos:
WNBA TOTAL pasa de −2,9 % ± 8,9 a −6,4 % ± 9,4 (n=104); NBA de −0,8 % a −2,25 % ± 4,0 (n=582). El "22,7 % en
22 overs" del monitor son **9 tesis** (2 ganadas/7 perdidas), Fisher p 0,11: la prueba es el código, no el
monitor.

### 5.2 El desacuerdo con el cierre no informa (H2/H4) — rechazada
β = cov(real−cierre, modelo−cierre)/var(modelo−cierre): WNBA total **−0,22 [−1,01; 0,52]**, NBA total −0,05
[−0,29; 0,18], hándicaps −0,03 ± 0,25 y 0,00 ± 0,10. El signo del desacuerdo acierta 53,9 % ± 5,0 (WNBA) y
50,3 % ± 2,1 (NBA) frente a 52,4 % de break-even. Ningún corte umbral × peso con n ≥ 40 queda por encima de
cero. Walk-forward por capas (3 pliegues, 2.000 sims): la mejor capa queda a −0,0038 ± 0,0027 de Brier del
cierre (WNBA) y −0,0018 ± 0,0009 (NBA).

**Límite grave del backtest**, señalado por el escéptico: en `hoops-strategy-backtest.js` la corrida `stack`
es idéntica a `base` porque no hay parte de bajas histórico → **la capa de plantilla RAPM que corre en
producción nunca se evaluó**. El monitor produce ventajas crudas de 17 pp de mediana; el backtest, 6-10 pp.
Las conclusiones describen al modelo base, no al generador real.

### 5.3 El CLV estaba mal medido (H3) — defecto confirmado
`close_odds` es el consenso **sin margen**; `best_odds` lleva el margen de la casa. Una pick cuya probabilidad
justa no se mueve da CLV ≈ −3,2 % por construcción. Hándicap WNBA: **−4,62 = −3,16 de vig + −1,46 ± 0,73 de
movimiento real** (t −2,0 por pick; por tesis −0,52 pp ± 0,39, t −1,3). TOTAL: +1,54 → movimiento real +4,62 ±
3,42. Las 79 picks de hándicap son **15 tesis** (el monitor re-pica cuando la línea se mueve). Las reglas de
línea (tope |línea| ≤ 8,5, "no movida en contra") tienen n de 6-13 picks: no evaluables.

### 5.4 Descanso diferencial → TOTAL WNBA (H4) — preregistrar
corr −0,24 desarrollo / −0,16 evaluación; regla "over si `away_rest − home_rest` > 0,9 d" 13/18 en test
(+37,9 % ± 20,7), pero el over ciego de esa ventana acierta 56,2 % → permutación p 0,11 para un rasgo (0,3-0,5
con los 8 probados). Toda la muestra 32/42. En NBA no existe (corr −0,007, n=879).

### 5.5 Cómo se mejora
1. **Corregir la fórmula del CLV** en `settleHoopsPicks` (probabilidad justa vs probabilidad justa, o cierre con
   vig de la misma casa) antes de leer cualquier track.
2. **Una pick por tesis partido+lado**; guardar línea de apertura y cierre por partido (The Odds API, 1 llamada).
3. Preregistro de totales con histograma corregido: `PREREGISTRO_WNBA_TOTALES.md` (60 picks, CLV como vara).
   Ojo: el régimen `GP_HOOPS_V2` solo deja unders, así que esa muestra **no validará los overs**, que es donde
   vivía el sesgo; si se quiere validar el histograma completo hay que permitir overs en el monitor.
4. Preregistro de descanso diferencial (WNBA, regla fija, ≥60 partidos, cuando vuelva el 17-sep).
5. Volcar `injuries_seen` al dataset para poder backtestear la capa de plantilla; probar en walk-forward menos
   encogimiento del favorito (el modelo lo ve 1,1-4,8 pts más flojo que el cierre en todas las bandas).

## 6. Tenis — ML, SPREAD de juegos, TOTAL de juegos

**Holdout:** 2025-01-01 → 2026-08-20 con constantes congeladas (`model-priors.json`), ATP n=4.908 (skill
10,12 %, Brier 0,2174), WTA n=4.488 (skill 11,91 %). Scripts: `backtests/tenis/{pass,h1-fatiga,h2-superficie,
h3-total,h3c-picks,h4-retiros,h5-combinado}.js`, `tenis-skeptic/sk-*.js`.

### 6.1 Edad (H1b) — la corrección más sólida del ganador ATP
El Elo ATP **sobreestima a los veteranos**. Término lineal −0,10 por 5 años de diferencia: skill **10,12 →
10,62 %**, ΔLL 0,00345, **t 5,8**, n=4.908; coeficiente negativo y estable los 9 años 2018-2026 (−0,07 a −0,17,
todos t < −2,2); walk-forward interno t 3,4. El cuadrático no añade (t 0,4). Caveat: en la cola ESPN (n=723,
fechas y plantel reales) solo t 0,55. **WTA: rechazada** (empeora, t −1,6 / −2,7).

### 6.2 Calendario (H1) — sobrevive degradada
El autor reportó 7 rasgos con skill 10,74 % (t 6,8) y "cada rasgo solo mejora". El escéptico encontró el
artefacto: todos los ajustes llevaban **intercepto en orientación "X = id menor"**, y el intercepto solo
(sin rasgos) ya da ΔLL 0,00158, t 5,1 — el 38 % de la ganancia. Sin intercepto solo sobreviven **días sin
jugar (log)** (t 2,6) y **partidos en 7 días** (t 3,7): skill 10,50 %, ΔLL 0,00263, t 3,0; dada la edad añade
ΔLL 0,00273 (t 3,1). El efecto vive casi entero en la **primera ronda** del torneo → mide "ausencia del
cuadro principal con Elo estancado", no oxidación. Paquete ATP correcto: edad + días + n7 ≈ skill 11,0 % (t
5,7). Requiere **fecha real de partido** en producción (Sackmann fecha el torneo entero con el día de inicio).
WTA: cae (2026 t −0,5).

### 6.3 Saque/resto por superficie (H2) — rechazada
Empeora el compilado (ATP t −1,8 a −5,5). Solo hierba mejora y dura lo compensa. No implementar.

### 6.4 Forma de la distribución de juegos (H3) — sobrevive en ATP a 3 sets
Diagnóstico aceptado y reforzado: la distribución desplazada de `store.js:169` está mal en **forma** (la real
es bimodal por nº de sets): P(real > mediana) 0,432 ATP / 0,443 WTA; en el bin 0,4-0,5 predice over 0,451 y
ocurre 0,407 (n=11.991). Desplazarla no arregla nada (mejora el Brier en la mediana pero rompe el CRPS, t
−10,9). **C6 (punto calibrado + residuo empírico por formato × tercil de juegos esperados)**: ATP CRPS 3,776 →
3,744 (t 8,9); Brier over/under en abanico de 6 líneas 0,2421 → 0,2392 (**t 9,9**); línea fija t 11,1;
fiabilidad casi perfecta (0,444 → 0,443); estable 2025 y 2026. Pero: **bo5 (n=975) t 0,3-1,7 — no
demostrada** (y ahí están 46 de los 77 picks TOTAL, US Open); **WTA cae** para over/under (abanico t 1,6, línea
fija t 0,26; pasa a infra-predecir over). Además el sesgo pro-over de 4 pp **no se observa aún en el libro
real** (over p_model 0,607 vs acierto 0,609, n=46).

### 6.5 El libro TOTAL no confirma el +18 % (H3c) — inconcluso
77 picks son **43 eventos** (mismo partido en varias casas/líneas). ROI a 1 u por evento **+10,5 % (SE 14,7, t
0,72)**; split temporal: desarrollo 33 eventos +29,6 %, evaluación 20 eventos **−18,1 %**. El c ajustado es
4,5 (SE 2,0), no 6, y con 77 picks correlacionadas no es identificable. Solo 9/77 tienen cierre. 66/77
llevan `resettled_from` (la primera liquidación fue sobre marcador parcial). **No aplicar c=6 ni blend**; contar
eventos, no picks; preregistrar el umbral ≥8 pp (20 eventos, +35,8 %, t 1,75) y capturar TODOS los cierres.

### 6.6 Retiros (H4) — puerta, no probabilidad
AUC 0,59 ATP / 0,65 WTA; decil alto 4,8 % vs bajo 1,0 % de retiros; acierta quién se retira 58 %/67 % (vs
44 %/55 % del underdog Elo). En el ML es redundante con edad+fatiga en ATP (t −0,2). Uso: incertidumbre extra
en TOTAL under y ML cuando la suma de riesgo cae en el decil alto. Hoy los retiros se anulan (VOID): cuesta
varianza, no unidades.

### 6.7 Defectos de datos encontrados
- La cola ESPN (desde 26-may-2026) etiqueta **best_of=5 en TODOS los partidos ATP** (514 de nivel 250) y en 508
  WTA. No afecta al Elo (`data.js` ignora best_of) pero sí a cualquier re-fit y a la calibración de juegos.
  Derivar el formato de los sets ganados (3 → bo5, 2 → bo3).
- Sin fecha real de partido en la espina; sin minutos ni stats de saque desde mayo; ranking −1 en la cola.
- La pick no guarda la distribución de juegos (solo p_model): no se pueden re-puntuar bajo C6.

### 6.8 Cómo se mejora
1. Ensamble ATP: `z = logit(ens) − 0,10·Δedad/5` (sin intercepto, orientación simétrica). Sombra primero.
2. Cuando haya fechas reales por partido: añadir `−0,137·Δlog1p(días, tope 60) + 0,012·Δn7`.
3. `distProbs`: C6 para **ATP bo3** (tabla de residuos por formato×tercil desde `tennis-fit.js` a
   `model-priors.json`); en Grand Slam y WTA medir en sombra antes. Añadir intercepto de superficie ATP (hierba
   infra-predicha 1,3 juegos, n=587). El hándicap necesita la misma técnica sobre el margen (no medido).
4. Regla de oro para cualquier término aditivo futuro: **ajustar sin intercepto** y preregistrar el paquete
   antes de mirar el holdout (el autor evaluó 13 combinaciones en el holdout).

## 7. Combate — FIGHT (ganador), ROUNDS, METHOD

**Histórico:** walk-forward 8.594 peleas fuera de muestra (UFC 5.842, Bellator/PFL 2.752). **Libro:** 48 FIGHT
liquidadas (19-29, ROI −18,4 % ± 15,7, CLV −5,16 ± 1,98, t −2,6; el modelo prometía 57 % y el mercado 43 %).
Scripts: `backtests/combate/{h2_features,h2b_calib,h2c_dump_calib,h2d_stance,h3_h4_picks,h3b_blend}.js`,
`combate-skeptic/sk*.js`.

### 7.1 El núcleo del modelo es bueno (H1) — sobrevive
ACTUAL (Elo + rasgos) vs Elo puro: UFC ΔBrier **−0,0101 ± 0,0012 (t −8,2)**, MMA −0,0105 ± 0,0017 (t −6,4);
robusto a learning rate, warm-up, era (2022+, 2024+) y bloques trimestrales (mejora en 39/45 y 35/39). Está
**calibrado** en el histórico (marco del favorito: UFC predice 60,4 %, ocurre 61,1 %; τ 0,98-1,00). La
sobreconfianza del libro (57 % → 39,6 %) **no es descalibración: es selección** — las picks son las peleas
donde el modelo más discrepa del mercado, y ahí el mercado tiene razón (a mayor ventaja exigida, peor CLV:
≥4 pp −5,2; ≥6,7 pp −7,7; ≥10 pp −8,9).

### 7.2 Rasgos nuevos (H2) — ninguno pasa
- Edad por tramos (+interacción división): **empeora**, pooled ΔBrier +0,00043 ± 0,00018 (t +2,4). La lineal
  con peso −0,63 ya lo captura.
- Inactividad >18 m / vuelta tras KO: t +0,9 (nulo). SPREAD por división: t −0,02 (nulo). Estatura: nulo.
- Racha ponderada por calidad del rival: signo correcto, peso +0,23, UFC P(mejor) 0,93 — **inconclusa**, re-test
  con ~2.000 peleas más. Guardia zurda: +0,14, P 0,64, inconclusa.
- Pesaje real vs 2 lb fijas: la libra real es marginalmente mejor (t 1,6, n=141). Hay **skew entrenar/servir**:
  se entrena con la libra real de Wikipedia y se sirve con 2 lb fijas desde prensa.
- **Fuga detectada:** el orden f1/f2 de ESPN se reordena tras la pelea (Fisher p 0,049); un intercepto de
  "esquina" mejora el Brier por fuga de resultado. Prohibido usar el orden; el diseño antisimétrico actual es
  el correcto.

### 7.3 Reglas de publicación (H3)
- **Peso del mercado 0,8**: rechazada — concentra las picks en las mayores discrepancias, que son las peores
  (n=24, CLV −8,9); 1,0 no publica nada.
- **Veto por deriva pre-publicación**: sin evidencia (las 11 vetadas rinden mejor, diferencia t 1,5).
- **Techo de cuota 3**: las 13 picks ≥3 (1-12, CLV −11,4) se crearon todas del 27 al 31-jul y motivaron la
  regla → **100 % en muestra**. Post-techo (n=25): ROI −9,5 ± 21,4, CLV −2,95 ± 3,0, indistinguible de cero.
  Mantener por prudencia, no presentarlo como demostrado.
- **El lado** (H3d): comprar al **perro del mercado** da CLV **−8,64 ± 2,47 (t −3,5, n=34)**; al favorito
  **+3,31 ± 1,73 (t +1,9, n=14)**; diferencia +11,95 ± 3,02 (**t 4,0**), se mantiene post-techo (+11,4 ± 4,9, t
  2,35) y solo UFC (+7,5, t 2,3). Es el único corte robusto del libro, **solo en CLV** (en ROI el post-techo se
  invierte con n=9/16: ruido).
- El mercado tardío tiene razón: corr(deriva tomada→cierre, resultado) r −0,31 (t −2,2). 42/48 picks se
  tomaron a peor precio que el consenso sin margen.
- Dato colateral: en la 2ª mitad del libro (n=24) la mezcla 0,5 bate al mercado por Brier (0,2766 vs 0,2808):
  n chico, pero no apunta a subir el peso del mercado.

### 7.4 Cómo se mejora
1. **No tocar `ratings.js`** ni el blend.
2. **Preregistrar** la regla: FIGHT solo cuando el lado del modelo es también favorito del mercado (k ≥ 0,45
   para no perder pick'em), umbral 2 pp, techo 3; 40 picks; éxito = CLV medio > 0 (se ≈ 2 pp).
3. Re-evaluación a T−24 h: si nuestro lado se alargó >5 % o el fair de cierre cayó bajo el umbral, degradar a
   monitor. No backtesteable más allá de las 48; va en el mismo preregistro.
4. Cerrar el skew de pesaje (guardar `over` real en la pick; fuente oficial ~24-30 h antes).
5. **El dato que más cambia el juego:** cuotas históricas UFC/Bellator (Kaggle/BestFightOdds, ~6.000 peleas,
   gratis). Con ellas: modelo vs cierre en miles de peleas, peso del blend walk-forward, y un modelo
   market-aware honesto (Elo+rasgos como corrección residual sobre el logit del cierre).
6. Persistir en la pick las señales de prensa activas y el orden ESPN al publicar.
7. ROUNDS: dejar correr (CLV +2,13 ± 0,82, t 2,6, n=37). METHOD (n=18, cuota media 7,5): sin muestra.

## 8. Qué hacen las casas y los sindicatos donde nosotros perdemos

Detalle y fuentes en `MERCADO_COMO_COTIZAN_2026-09-02.md`. En una línea por familia, con lo medido aquí:

- **Fútbol 1X2:** el cierre de Pinnacle/consenso ya incorpora Elo, plantilla y flujo; nuestro Elo es un
  subconjunto de esa información (c = −0,14). Ganan con **de-vig correcto** (Shin/potencia, no proporcional) y
  no comprando longshots a la "mejor cuota" de 30 casas.
- **Córners:** el mercado de córners es de casas blandas con líneas de recreo; el edge medido aparece **cuando
  hay consenso real (≥2 casas)** y desaparece contra una casa sola bien calibrada (LeoVegas).
- **Valorant:** las casas fijan el nivel del mapa con información de plantilla/veto que no está en un win-rate
  encogido; su implícita acierta 55,7 % donde la nuestra 45 %. Se les gana en la **forma** (distribución de
  rondas), no en el nivel.
- **Baloncesto:** el cierre incorpora bajas y minutos a T−1 h; nuestro desacuerdo con él tiene β ≈ 0. Lo único
  que el cierre no parece llevar en WNBA es el **descanso diferencial** (a preregistrar).
- **Tenis:** las casas cotizan la distribución de juegos con la forma bimodal correcta; nosotros con una IID
  desplazada (sesgo pro-over de 4 pp en líneas centrales). Y ajustan por **edad**, que nuestro Elo no ve.
- **Combate:** el mercado tardío sabe de campamentos, pesajes y reemplazos; cuando discrepamos contra el
  favorito del mercado perdemos 8,6 % de CLV; cuando coincidimos y vemos más, ganamos 3,3 %.

## 9. Orden de trabajo propuesto (nada aplicado; decide Alexis)

**A. Medición (barato, hoy):** CLV de baloncesto (probabilidad justa vs justa); `books`/cuota de creación en
los informes de fútbol; formato de la cola ESPN de tenis; persistir señales y orden ESPN en combate; contar
eventos en tenis TOTAL; liquidar SUPERSEDED de fútbol.

**B. Mejoras al modelo con backtest que las respalda:** tenis ATP edad lineal (t 5,8) → C6 en ATP bo3 (t 9,9)
→ Valorant bisección (n=128, SE 0,0055) + ancla de mapa al mercado → fútbol de-vig Shin/potencia (medir con
`odds-archive`) y prior por división al fusionar pools de copas.

**C. Preregistros (regla fija, vara CLV, n antes de leer):** WNBA totales (hecho, 60 picks desde el 17-sep);
córners ≥2 casas en ventana final (Liga MX aparte); combate "favorito del mercado" (40 picks); tenis TOTAL
≥8 pp por evento; WNBA descanso diferencial (60 partidos).

**D. Datos que desbloquean lo demás:** cuotas históricas UFC (Kaggle), cierres 1X2/O-U (football-data.co.uk),
`/data/val-raw` con nombres de mapa, fechas reales de partido de tenis, parte de bajas histórico de
baloncesto, `data/history` de fútbol en un checkout.

## 10. Dónde están los scripts

En `research/backtests-2026-09-02/<familia>/` viajan los scripts (`.js`) y los resultados pequeños (`.json`,
`.log`, `.txt`). Los ficheros grandes (predicciones de tenis 30-37 MB, OOS de combate) se quedan fuera; se
regeneran con `pass.js` (335 s) y `h2c_dump_calib.js`. Los scripts leen el checkout con rutas relativas al
repo o absolutas del scratchpad de la sesión: al re-ejecutar, ajustar `ROOT`/`REPO` al principio de cada uno.
