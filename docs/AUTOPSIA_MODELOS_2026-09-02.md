# Autopsia de los modelos frente al mercado — 2 de septiembre de 2026

> Pregunta de Alexis: en las familias con datos suficientes donde el modelo pierde contra el mercado (CLV y
> retorno), ¿qué predecimos, qué pasa después, qué no estamos viendo, cómo cotizan las casas mejor que
> nosotros, y qué lógica/fórmula nos haría ganar? Este documento es la respuesta, con los números de los
> libros completos de producción bajados el 2-sep (no de los resúmenes de pantalla).

## 0. Qué se midió y con qué

| Libro | Liquidadas | Fuente |
|---|---|---|
| Fútbol clubes (SOLID, CORNERS, CARDS, GOALS, COMBO, PLAYER) | 1.615 decididas de 2.940 | `/api/internal/clubs-picks?limit=10000` |
| CS2 (5 familias) | 738-781 | `/api/esports/track?game=cs2&limit=5000` |
| LoL | 375 | ídem `lol` |
| Valorant | 304 | ídem `valorant` |
| Dota 2 | 130 | ídem `dota2` |
| Tenis (ML, SPREAD, TOTAL) | 429 → 391 tras re-liquidar | `/api/tennis/track?limit=5000` |
| WNBA monitor (SPREAD, TOTAL, ML) | 119 | `/api/hoops/picks?league=wnba` |
| Combate (FIGHT, ROUNDS, METHOD) | 105 | `/api/internal/combat-picks?picks=1` |

Para cada pick: probabilidad del modelo, probabilidad del mercado al publicar, cuota tomada, cierre, CLV,
resultado y marcador. Los `?limit=` de esports y tenis se añadieron hoy para poder bajar el libro entero.
Además, cuatro lecturas de código en profundidad (esports rondas/kills, baloncesto, tenis+combate, fútbol
clubes) para atar cada número a la línea que lo produce.

## 1. Antes de juzgar los modelos: tres liquidadores mentían

La autopsia pick a pick destapó **fallos de medición** que falseaban familias enteras. Se arreglaron y se
re-liquidó en producción antes de sacar conclusiones.

1. **Tenis (0-0).** ESPN marca `STATUS_FINAL` antes de colgar los sets; el liquidador se tragaba el marcador
   vacío. 268 de 429 picks se liquidaron con 0-0 y 56 con sets sueltos. Con 0-0, el hándicap "b −5,5" GANA,
   el over PIERDE y "a" nunca gana. El **+44 % de ROI y el 80 % de acierto en hándicap eran ese artefacto**.
   Ahora un marcador solo vale si trae los sets que deciden el partido (`marcadorCoherente`), ESPN exige un
   user-agent de curl (403 al de Node, medido), y `resettleShadow` reabrió y re-liquidó 297 picks contra los
   días históricos: **148-148**. El track pasa de +44 % a **+7,3 % (392 picks) con CLV −12,5 %**.
2. **Esports (kills sin voltear).** Al orientar el resultado al local de la pick se volteaban `score_a/b`
   pero **no `kills_a/b` ni `winner`**. En toda serie que la fuente listaba al revés, KILLS_HANDICAP,
   KILLS_EQUIPO y KILLS_DNB se liquidaban con los kills del **rival**. La huella: LoL "local +x,5 kills"
   ganaba el 85 % y "visitante +x,5" el 41 % con la misma p_gp (0,72); Dota 2 exactamente al revés
   (26 % / 68 %). Ninguna asimetría de mercado produce eso; un volteo a medias sí. Re-liquidadas 245 en LoL
   (**85 cambiaron de veredicto**) y 55 en Dota. LoL KILLS_HANDICAP pasa de 60,1 % / +14,7 u a **58,0 % /
   +4,7 u**; Dota KILLS_HANDICAP a 49,1 % / −6,7 u. La sombra `lol_kills_hcp_v1` corrige por diferencia las
   apuestas que copiaron el veredicto viejo.
3. **Baloncesto (cubos de 5).** El histograma de totales iba en cubos de 5 puntos y con él se cotizaba
   P(over): P(over 164,5) sumaba los cubos ≥165, y el cubo 165 contiene los totales 163 y 164, que NO superan
   la línea. **Toda línea justo por debajo de un múltiplo de 5 heredaba ~5 pp de over regalados.** El monitor
   WNBA lo compró tal cual: 22 de sus 31 totales eran overs en líneas x3,5/x4/x4,5 con 17-27 % de acierto.
   Resolución de un punto desde hoy.

Dos fuentes de resultados que no llegaban: Leaguepedia por `api.php` (tope 500, menos en Render: 39 series
donde había 715 partidas) pasa a `Special:CargoExport` (5.000 filas, una llamada); OpenDota `/proMatches`
(100 partidos, dos días) se pagina hacia atrás. Eso es lo que tenía 137 picks de LoL y 62 de Dota "atascadas".

## 2. El cuadro general (tras las correcciones)

| Familia | n | Acierto | ROI | CLV medio (t) | Brier modelo vs mercado | Veredicto |
|---|---|---|---|---|---|---|
| Fútbol SOLID (1X2) | 432 | 31,9 % | **−12,6 %** | +2,0 (1,6) | 0,238 vs **0,201** | el modelo va al lado equivocado |
| Fútbol GOALS | 130 | 52,3 % | −8,8 % | **−1,3 (−4,1)** | — | sin edge: sigue al mercado con error |
| Fútbol CORNERS | 587 | 64,4 % | +0,1 % | −0,05 (−1,6) | — | breakeven: el modelo es la media de la liga |
| Fútbol CARDS | 361 | 64,8 % | **+11,2 %** | −0,5 (−3,7) | — | gana con CLV negativo (ver §4.4) |
| CS2 (todas) | 738 | 47,6 % | +4,0 % | +2,2 | 0,252 vs 0,244 | gana por **precio y momento**, no por modelo |
| CS2 RONDAS_HANDICAP perro | 183 | 54,1 % | **+18,6 %** | +2,3 | — | el único bolsillo con edge que sobrevive al cierre (+5,7 %) |
| Valorant (todas) | 304 | 35,2 % | **−8,2 %** | 0,0 | 0,248 vs **0,221** | modelo claramente inferior |
| LoL KILLS_HANDICAP | 238 | 58,0 % | +2,0 % | +0,1 | — | sobreconfiado 20-30 pp; edge ≈ 0 |
| Dota KILLS/KILLS_H | 122 | 50 % | −6,9 % | 0,0 | 0,273 vs 0,252 | inferior |
| Tenis ML | 109 | 43,1 % | +9,9 % | **−15,3 (−2,5)** | — | benchmark, nunca pick: el mercado lo sabe mejor |
| Tenis SPREAD | 205 | 51,9 % | +1,9 % | **−6,8 (−3,4)** | — | inferior al cierre |
| Tenis TOTAL | 77 | 61,0 % | +17,9 % | +2,5 (n=9) | — | prometedor, n corto |
| WNBA SPREAD | 79 | 55,7 % | +6,6 % | **−4,6 (−6,1)** | — | el mercado se mueve en contra sistemáticamente |
| WNBA TOTAL | 31 | 35,5 % | −30,9 % | +1,5 | — | bug de cubos (arreglado) |
| Combate FIGHT | 48 | 39,6 % | **−18,4 %** | **−5,2 (−2,6)** | 0,241 vs **0,210** | el mercado sabe cosas que el Elo no |
| Combate ROUNDS | 39 | 46,2 % | −1,2 % | +2,1 (2,6) | — | CLV positivo contra una sola casa (Cloudbet) |

**Brier modelo vs mercado pierde en TODAS las familias con dato.** No hay una sola donde la probabilidad del
modelo, tal cual, sea mejor que la del precio. El dinero que se gana (CS2, cards) no sale del modelo: sale
de dónde y cuándo se toma el precio.

## 3. La ley común: seleccionar por discrepancia con un modelo más ruidoso que el mercado

Todas las familias comparten la misma forma de calibración:

| Familia | Tramo p_modelo | p_modelo | p_mercado | Observado |
|---|---|---|---|---|
| Fútbol SOLID | 55-65 | 60,3 | 44,9 | **32,9** |
| Valorant | ≥70 | 74,5 | 58,2 | **42,3** |
| CS2 | 60-70 | 64,3 | 54,0 | **50,2** |
| LoL kills | ≥80 | 85,2 | 59,2 | **56,4** |
| Tenis | 65-75 | 69,8 | 52,3 | **52,3** |
| WNBA (crudo) | — | 69,0 | 50,4 | 55,7 |

El observado cae **por debajo del mercado o sobre él**, nunca cerca del modelo. Es el sesgo del ganador
(winner's curse): una pick nace exactamente cuando `p_modelo − p_mercado` es máximo, y si el modelo tiene más
varianza que el mercado, esa selección recoge sobre todo error del modelo. La regresión logística que lo
mide directamente, `P(gana) = σ(a + b·logit(p_mkt) + c·[logit(p_gp) − logit(p_mkt)])`, da el **peso que
merece el modelo** (c=1 publicar el modelo, c=0 publicar el mercado, c<0 discrepar es señal contraria):

| Familia | n | c (peso del modelo) | t |
|---|---|---|---|
| LoL (todas) | 375 | **−0,65** | −2,4 |
| Fútbol GOALS | 130 | −1,68 | −1,4 |
| CS2 RONDAS | 245 | −0,91 | −1,0 |
| Valorant (todas) | 304 | −0,35 | −0,7 |
| Fútbol CORNERS | 587 | −0,17 | −0,4 |
| Fútbol SOLID | 432 | 0,19 | 0,8 |
| CS2 RONDAS_HANDICAP | 433 | 0,35 | 0,9 |
| Tenis SPREAD / ML | 205 / 109 | 0,26 / 0,29 | 0,7 / 0,5 |
| Combate FIGHT | 48 | 0,36 | 0,6 |
| WNBA SPREAD (crudo) | 79 | 1,49 | 1,6 |
| **Fútbol CARDS** | 361 | **1,41** | **2,8** |
| **Tenis TOTAL** | 77 | **6,0** | **2,8** |

Solo **cards** y **totales de tenis** (y, con reservas, los hándicaps crudos de la WNBA) tienen un modelo que
aporta información donde discrepa. En el resto, el peso correcto del modelo está entre cero y negativo.

**Consecuencia matemática.** La probabilidad que hay que publicar y apostar no es `p_gp`, es

`p* = σ( logit(p_mkt_sin_margen) + c_familia · [logit(p_gp) − logit(p_mkt_sin_margen)] )`

con `c_familia` estimado fuera de muestra y re-estimado cada mes; la ventaja es `p*·cuota_mejor − 1` y solo se
publica si supera el margen de la casa más la incertidumbre. Con c≈0 la familia se cierra al modelo y queda
solo como **familia de precio** (§5). Hoy se blenda en baloncesto (w=0,13-0,23) y combate (0,5 fijo), y en
ninguna otra: fútbol SOLID, esports y tenis publican `p_gp` tal cual.

## 4. Familia por familia

### 4.1 Fútbol SOLID (1X2) — el mercado tenía razón las 432 veces que discrepamos
- **Qué hacemos.** Elo por liga (K=28, base 1500, hfa ajustado), `λ_h = 2,6·we^0,93` con suelo 0,65 y
  Dixon-Coles ρ=−0,13 compartidos con el Mundial; el régimen `lead` (ligas "blandas") elige **el lado en el
  que el modelo más supera al mercado** (≥4 pp) sin tope de cuota. `server.js` construye SOLID en línea
  (7361-7392); el gate `approved/shadow` es una etiqueta que la publicación no consulta.
- **Qué pasa.** 357 picks `lead`: 29,5 % de acierto a cuota media 4,2; modelo 0,48 vs mercado 0,33 vs
  observado 0,30. Cuando modelo y mercado discrepan ≥5 pp, el modelo va por encima 305 veces y acierta el
  28,5 % (el mercado decía 33,3 %). El cierre no se mueve hacia el modelo: corr(modelo−mercado,
  cierre−mercado) = **0,045**. Peores: Chelsea–Luton visitante @30 (modelo 0,61, mercado 0,08).
- **Por qué.** (a) Sin regresión entre temporadas ni prior de mercado: un ascendido nace 1500 = media de la
  liga; (b) copas cruzan pools de Elo independientes (Saudí 1761 > Liverpool 1530); (c) la curva λ satura
  (dif 400 Elo → 0,687) y regala empates y goles al perro; (d) el overlay en vivo (K=30 × margen) deriva un
  mes sin reconciliar; (e) sin alineaciones ni bajas, que mueven 5-10 pp un 1X2.
- **Cómo lo hace la casa.** Parte de un prior de mercado (valor de plantilla, cierre de la temporada anterior
  regresado ~1/3 a la media), incorpora alineaciones a la hora, y su 1X2 de ligas menores lo fija el flujo
  de los sharps sobre la apertura de Pinnacle. Nadie publica un 60 % contra un 45 % de consenso sin
  información nueva; nosotros lo hacíamos por construcción.
- **Ajuste.** Apagar `lead` (ya acordado el 23-ago). Reconstruir el rating con **prior de mercado**: Elo
  inicial de cada equipo derivado de las cuotas de las primeras jornadas (o del cierre de la temporada
  anterior regresado un tercio), Elo de copas en un pool único calibrado por partidos intereuropeos, y
  publicar `p*` con `c` estimado (hoy c≈0,19: el 1X2 es familia de precio, no de modelo).

### 4.2 Fútbol GOALS / CORNERS / CARDS
- **GOALS** (130): modelo ≈ mercado (0,574 vs 0,572), CLV −1,3 % con t=−4,1. El régimen `anchor` copia el
  favorito del mercado con un de-vig proporcional que sobreestima; no hay señal. **Cerrar** o convertir en
  familia de precio.
- **CORNERS** (587): `TOTALS_DAMP=0` ⇒ el total proyectado es **la media de la liga** por multiplicadores; el
  árbitro no llega a la llamada. Acierto 64 % a cuota 1,59 = breakeven exacto (+0,1 %). El "edge" es la
  línea de la casa menos la media de la liga; la casa ya sabe la media de la liga.
- **CARDS** (361): +11,2 % con CLV −0,5 % (t −3,7). Los unders 4,5/5,5 (210 picks) aciertan 72-77 %; los
  overs pierden 36 %. Es la familia con **c=1,41** (el modelo aporta) y la que corre con dinero real.
  Lectura: el cierre de tarjetas no es eficiente (mercado fino, sesgo público al over), y aquí el CLV no es
  la vara. Riesgo: los unders son también lo que gana cuando los árbitros pitan menos de la media — vigilar
  la deriva por liga y por árbitro (el modelo de árbitros existe y no se usa: `project` se llama sin
  `referee`, server.js 7239).

### 4.3 Valorant — la probabilidad de mapa nace sin ancla
- **Qué hacemos.** `p_a(mapa) = 0,5 + (wr_A − wr_B)/2` con win-rates encogidas (n+8), **sin Elo por mapa y
  sin anclaje al mercado** (CS2 sí ancla con `mapShift`; Valorant no); rondas por Monte Carlo con lados
  def/atk, comprimiendo la ventaja de mapa ×0,44.
- **Qué pasa.** 304 picks, 35 % de acierto, Brier 0,248 vs 0,221 del mercado. En RONDAS_HANDICAP el equipo
  elegido **ganó el mapa solo el 38 %** de las veces (favoritos elegidos 41 %, perros 35 %): la probabilidad
  de mapa está mal. RONDAS: 80 unders con línea media 20,3 y total real medio **21,2** (sd 2,9, 5,5 % de
  prórrogas): el simulador produce mapas más cortos que la realidad. Calibración ≥70 → 42 %.
- **Bugs de código.** Signo invertido en la preferencia de ban por profundidad de agentes
  (`valorant.js:73`); empates posibles en prórroga (`ot > 10 break`) que contaminan el push del hándicap;
  `p_market = 1/cuota` con margen (el listón de 3 pp no es homogéneo).
- **Ajuste.** Anclar la probabilidad de mapa al mercado como hace CS2 (`seriesToMap` → `mapShift`), Elo por
  mapa, calibrar el arrastre económico contra el total real de 21,2 y no solo contra la tasa de prórroga, y
  cerrar la familia hasta que la validación walk-forward (`valorant-validate.js`) muestre Brier ≤ mercado.

### 4.4 CS2 — gana el momento, no el modelo
- Brier modelo 0,252 vs mercado 0,244 (peor), y aun así +4 % de ROI y CLV +2,2 %. La descomposición lo
  explica: **el 43 % de las picks ven bajar su cuota al cierre** (CLV +7,8 en esas) frente al 24 % que la ven
  subir; el ROI evaluado **al precio de cierre** cae de +2,4 % a +0,9 % en general, pero RONDAS_HANDICAP
  conserva **+5,7 %** al cierre (n=374) y los perros de hándicap (+3,6 rondas de media) rinden +18,6 %
  (n=183) frente a −0,8 % los favoritos.
- Donde está el bolsillo: **Pinnacle cotizando solo (bq1)**: 287 picks, +15,6 %, CLV +1,7 (t 4,4). Pinnacle
  abre los derivados de esports con margen ancho y límites bajos y la línea se mueve cuando llega el dinero
  informado; llegar antes vale, y el modelo solo sirve de excusa para elegir lado. Cloudbet bq1 (el canal
  real): −9,1 % con CLV +3,6 — el CLV es bueno y el resultado no, muestra corta (91).
- Bugs de modelo: `clampRound` aplicado **dos veces** (0,42² ≈ 0,18 de la ventaja real) y la variable
  comprimida usada como probabilidad de mapa en `simulateSeries` → hándicaps de mapa y totales de mapas
  achatados; calibración medida-no-ajustada para mapas con 40-79 muestras.
- **Ajuste.** Mantener cs2_rounds_v1 como está (regla congelada) pero **reconocer que es una estrategia de
  precio**: la señal útil es "Pinnacle solo, línea joven, lado perro"; medir por separado el edge que queda al
  cierre por familia y casa cada lunes. Corregir la doble compresión solo tras validarlo walk-forward.

### 4.5 LoL kills (tras la re-liquidación)
- KILLS_HANDICAP 238 picks: 58 % / +2 % de ROI, CLV +0,1 (mercado de una casa que no se mueve). Calibración
  ≥80 → 56 %: el modelo de kills es **20-30 pp sobreconfiado** y el peso estimado c=−0,4 (LoL global −0,65,
  t −2,4). Queda una asimetría local 68 % / visitante 50 % que ya no es bug de volteo; hay que mirar si
  "local" en Bovada correlaciona con el lado azul.
- **Ajuste.** El segmento `lol_kills_hcp_v1` de la sombra debe leerse con las cifras nuevas (6 liquidadas
  hasta hoy). La familia necesita blend con el mercado (c≈0) y una distribución de kills calibrada con la
  base propia recién cerrada (535k filas): media y varianza de kills por liga y parche, no por equipo.

### 4.6 WNBA — el mercado se mueve en contra en cada hándicap
- SPREAD 79 picks: 55,7 % de acierto pero **CLV −4,6 % con t=−6,1**: la línea se mueve contra nosotros
  casi siempre (solo 12 % de picks con CLV positivo). Con n=79 el ROI +6,6 % es ruido; el CLV no. Las líneas
  ≥8 puntos: 38 % y −28 %. Validación: ninguna configuración bate al cierre (skill −0,004 a −0,022).
- Por qué: capa de plantilla apagada en NBA y sin partes históricos; contexto (descanso, viaje) reducido a
  cero por evidencia; sin árbitro, sin motivación, sin interacción de ritmo; el cierre entra solo como
  encogimiento (w=0,23) y luego la confianza encoge **otra vez** con 0,35/0,65 ad hoc.
- **Ajuste.** El único camino con evidencia positiva del backtest es TOTAL (−0,26 % NBA, +2,15 % WNBA al
  cierre) — y estaba roto por los cubos. Reabrir el monitor de totales con el histograma corregido, `c`
  estimado en la ventana expandida, y medir 60 picks antes de decir nada.

### 4.7 Combate FIGHT — apostamos perros a los que el mercado les quita el precio
- 48 picks: 39,6 %, −18,4 %, CLV −5,2 (t −2,6). Cuota tomada 2,89 → cierre 3,31: **la casa alarga al perro
  que nosotros compramos en el 62,5 % de los casos**. Cuotas ≥3: 1-12. Brier 0,241 vs 0,210 del mercado.
- Por qué: el Elo+features no ve reemplazos de última hora, fallos de peso (2 lb fijos si hay noticia),
  cambios de campamento, edad no lineal, estilo (el cruce grap/striker se midió y se descartó), zurdos.
  Todo eso el mercado lo cotiza en los últimos 3 días — justo cuando nuestro CLV se hunde (1-3 días: −9,4).
- **Ajuste.** FIGHT es familia de precio: c≈0,36 y blend 50/50 no bastan. Mantener el techo de cuota 3,0,
  subir el peso del mercado a ≥0,8 en el blend, y exigir que la línea **no se haya movido en contra** entre
  apertura y publicación. ROUNDS (+2,1 CLV) merece muestra, pero midiendo el cierre contra más de una casa.

### 4.8 Tenis — el track era un artefacto; lo que queda dice "mercado"
- Tras re-liquidar: ML CLV −15 % (t −2,5), SPREAD −6,8 % (t −3,4); ambos inferiores al cierre. Brier
  0,247 vs 0,238 de la implícita con margen. TOTAL: 77 picks, 61 %, +18 %, c=6,0 (t 2,8) — la única familia
  con información propia; n corto.
- Estructural: base con meses de retraso, superficie por regex de torneo, sin fatiga ni retiro en el
  precio, `best_of` por regex de cuatro torneos, ejecución al "mejor precio" de casas blandas medida contra
  su propio mejor cierre.
- **Ajuste.** ML y SPREAD siguen como benchmark, nunca pick. TOTAL sube a preregistro: 150 picks más con el
  liquidador arreglado y CLV contra Pinnacle exclusivamente.

## 5. Dónde hacen dinero las casas y los sharps, y dónde podemos nosotros

- **Las casas no predicen: agregan.** Abren con un modelo (o copian a Pinnacle), cobran margen, y dejan que
  el flujo informado mueva la línea; el cierre es el mejor pronóstico disponible porque ya incluye ese
  flujo. Ganarle al cierre con un modelo de resultados públicos es la apuesta más difícil que existe, y
  nuestros Brier lo confirman en las ocho familias.
- **Los sharps son originadores o tomadores de precio.** Originadores: información antes que la línea
  (alineaciones, lesiones, pesajes, roster de esports, meteorología). Tomadores: aperturas de derivados con
  margen ancho y límites bajos (Pinnacle esports, props), casas blandas que tardan en seguir a Pinnacle,
  mercados donde el público sesga el cierre (overs de tarjetas y córners, favoritos populares).
- **Nuestros bolsillos reales ya están en la segunda categoría**: cs2_rounds_v1 (Pinnacle solo, línea joven,
  perro) y cards_under_v1 (cierre ineficiente, sesgo al over). Ninguno depende de que el modelo sepa más que
  el mercado; dependen de estar antes o de estar donde el cierre no corrige. Eso hay que decirlo así y
  medirlo así: **edge al cierre por familia y casa**, no ROI.
- **Donde nadie mira, con datos que ya tenemos:** (1) la desviación de UNA casa respecto del consenso en
  derivados (la corrección 2 del 23-ago), que es puro precio; (2) la primera línea de Pinnacle en esports y
  su recorrido hasta el cierre — hoy sabemos que baja el 43 % de las veces cuando la elegimos; (3) totales de
  tenis con el compilador saque/resto, que es lo único con c>1; (4) la base propia de LoL (535k filas) para
  distribuciones de kills por liga/parche, que ninguna casa pequeña modela bien.

## 6. La fórmula operativa por familia

1. `p_mkt` = consenso **sin margen** (Shin o proporcional) — hoy esports y tenis usan `1/cuota` con margen.
2. `p* = σ(logit(p_mkt) + c·[logit(p_gp) − logit(p_mkt)])`, con `c` por familia estimado fuera de muestra
   (tabla §3) y **c=0 obligatorio** donde t<1.
3. Ventaja = `p*·cuota_mejor − 1` menos incertidumbre; se publica solo si además la línea no se ha movido en
   contra desde la apertura (dato que ya guardamos en `sportsbook_quote_history` y en `closes-*.json`).
4. Familias con c≤0 se convierten en **familias de precio**: señal = desviación de una casa frente al
   consenso ≥ margen, sin opinión del modelo.
5. Vara semanal: CLV donde el cierre es eficiente (ganador, hándicaps de baloncesto y tenis, FIGHT) y
   resultados donde no lo es (cards, córners, derivados de esports), declarado por familia de antemano.

## 7. Qué se hizo hoy en producción y qué queda para decidir

Hecho (desplegado): liquidador de tenis (marcador entero, UA, re-liquidación), volteo de kills y
re-liquidación LoL/Dota con corrección de la sombra, histograma de totales a un punto, Leaguepedia por
CargoExport, OpenDota paginado, `?limit=` en los tracks. Nada de esto cambia una decisión de apuesta.

Para decidir con Alexis (ninguno se tocó porque cambian decisiones vivas):
- Apagar `lead` en SOLID y GOALS `anchor`; convertir 1X2 en familia de precio.
- Estimar y aplicar `c` por familia (blend) en esports y tenis; cerrar Valorant hasta validar.
- Reabrir el monitor de totales WNBA/NBA con el histograma corregido, 60 picks preregistradas.
- Combate: peso del mercado ≥0,8 y filtro de movimiento adverso.
- Tenis TOTAL: preregistro de 150 picks; ML/SPREAD siguen como benchmark.
- CS2: reconocer cs2_rounds_v1 como estrategia de precio y medir el edge al cierre por casa cada lunes.
