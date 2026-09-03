# CÓRNERS — ¿el árbitro entra al modelo? Backtest walk-forward (3-sep-2026)

**Pregunta** (`docs/BACKTESTS_FAMILIAS_2026-09-02.md` §3.4): la proyección de córners de producción no usa al
árbitro y el total es la media de la liga (`TOTALS_DAMP=0`). ¿Añade información el árbitro como efecto aleatorio
con encogimiento empírico-Bayes? ¿Y la señal de equipos que hoy amortiguamos a cero?

**Veredicto corto:** **el árbitro NO añade información al total de córners.** Una vez controlados los equipos,
explica el **0,24 %** de la varianza residual entre partidos (τ = 0,17 córners; p de permutación 0,08 con
11.158 partidos; fiabilidad mitad/mitad ρ = 0,03). El prior empírico-Bayes sale en **K ≈ 400** partidos
equivalentes (en desarrollo puro, K ≈ 6.400): un árbitro con 150 partidos dirigidos mueve la proyección
±1 %. Enchufar el prior de las tarjetas (K = 14) **empeora** el CRPS fuera de muestra (t = +3,0). Lo que **sí**
añade son los **equipos**: media de liga × cocientes a favor/en contra con K_team = 40 y `DAMP = 0,5` mejora el
CRPS un 0,6 % (Δ −0,0114, t = −5,4, IC bootstrap [−0,015, −0,007]) y el Brier de P(over) en las cuatro líneas
sintéticas (t entre −3,0 y −5,1), positivo en las 5 ligas y en las 3 temporadas completas de test.

**Consecuencia:** la capa de árbitro se implementa **en sombra y apagada** (`GP_CORNERS_REF`, default off) con
K = 400 y tope ±5 %: solo anota `ref_name`/`ref_effect`/`ref_n` en cada pick de córners para poder medir lo
mismo en las ligas LATAM/AF cuando haya muestra (este backtest es Inglaterra + Escocia, las únicas divisiones
de football-data con árbitro). No hay que esperar edge de ella. La mejora accionable es otra: revisar el
`TOTALS_DAMP` de córners (hoy 0 por defecto, auto-tune por liga entre 0/0,25/0,5 con K_team = 4) — aquí
K_team = 40 con DAMP 0,5 gana con claridad y DAMP = 1 con K_team = 4 (equipos a pelo) pierde (t = +5,0).

## 0. Datos y diseño

- **Datos:** football-data.co.uk, columnas `HC`/`AC` (córners local/visitante) y `Referee`. Solo E0, E1, E2, E3
  y SC0 traen árbitro; SP1, D1, I1, F1 traen córners pero **no** árbitro → fuera. Temporadas 2122-2627 (la 2627
  son las primeras jornadas). **11.466 partidos**, 100 % con árbitro. CSV en `$SP/fd/` (no en el repo).
- **Modelos del total de córners** (walk-forward por FECHA: cada partido se predice solo con partidos de fechas
  anteriores; una fecha ≈ una jornada; el árbitro cruza divisiones y su historial se comparte entre ellas):
  - **M0 base** = media de la liga (temporada en curso + anterior) — lo que hace producción con `TOTALS_DAMP=0`.
  - **M1 +equipos** = media de liga × cocientes a favor/en contra por equipo (últimos 46 partidos, prior K_team
    partidos equivalentes, relativos a la media de liga del momento) con total amortiguado con exponente DAMP
    — el diseño de `prop-engine/model.js`.
  - **M2 +equipos+árbitro** = M1 × multiplicador del árbitro `(K_ref + Σ rᵢ)/(K_ref + n)`, rᵢ = total/esperado
    en sus partidos previos (`clubs-engine/referees.js`, el mismo código que usa producción).
- **Distribución:** Binomial Negativa; r por máxima verosimilitud sobre las predicciones walk-forward de
  **desarrollo** (2122+2223), donde también se eligen K_team, DAMP y K_ref. El veredicto se lee en **test**
  (2324-2627, 6.938 partidos).
- **Métricas:** MAE, CRPS, log-score, Brier de P(over) en líneas sintéticas (mediana de liga ±0,5 y ±1,5).
  Comparaciones pareadas por partido: t iid y bootstrap pareado (2.000 remuestreos), por liga y global.
- **Script:** `node scripts/corners-ref-backtest.js --fd $SP/fd` (≈2 min; `--no-download` sin red).

## 1. Lectura de las tablas

1. **Equipos (§2.1, §3.1).** En desarrollo, K_team = 40 y DAMP = 0,5 es lo único que mejora a la media de liga
   (t −1,96); DAMP = 1 con K_team = 4 (la configuración "equipos a pelo" que producción probaría con
   `TOTALS_DAMP=1`) empeora con t = +5,0. En test la mejora es más nítida: Δ CRPS −0,0114 (t −5,4), Δ MAE
   −0,014 córners, Δ log-score −0,006, y **las 5 ligas** van en la misma dirección (t entre −2,2 y −2,6). Es
   señal chica (0,9 % de la varianza del total) pero estable.
2. **Árbitro (§2.2, §3.1, §3.6).** El empírico-Bayes en desarrollo da τ² ≈ 0 (F = 1,01 → K ≈ 6.400): el
   multiplicador queda en 1,000 ± 0,001 y M2 = M1 a efectos prácticos (Δ CRPS −0,00002, t −0,65). En el grid,
   **cualquier K < 160 empeora** el CRPS de desarrollo (K = 5: t +5,9; K = 40: t +2,7). En test, forzando priors
   más agresivos (§3.6): K = 14 (el `REF_PRIOR` de tarjetas) Δ CRPS +0,0087 (t +3,0), Δ Brier +0,0016
   (t +3,6); K = 40 t +2,0; K = 100 t +1,1; K = 400 indistinguible de M1 (t −0,03; multiplicadores p10/p90
   0,993/1,009). Por historial del árbitro (§3.4) no hay tramo donde ayude (≥100 partidos: t 0,00).
3. **Varianza (§5).** ANOVA de efectos aleatorios sobre los residuos e = total − μ₁ (árbitros con ≥5 partidos):
   τ² = 0,028 córners² frente a σ² = 11,53 → **ICC 0,24 %**; F = 1,17, p permutación 0,079 (solo test: 0,23 %,
   p 0,18). La fiabilidad mitad/mitad del efecto por árbitro (126 árbitros con ≥20 partidos) es ρ = 0,03 (test:
   −0,02): lo que un árbitro "muestra" en la mitad de sus partidos no se repite en la otra mitad. Los árbitros
   extremos de la tabla §5.1 (L Smith 1,086 en 107 partidos, R Hardie 0,874 en 30) son exactamente lo que se
   espera del ruido con esas n (SD del cociente 0,33/√n → ±0,03 y ±0,06 a 1σ).
4. **Contraste con la literatura.** Dawson/Boyko encuentran variación robusta entre árbitros en **tarjetas**;
   nada de eso aparece en córners, que dependen de la posesión y el juego de ataque, no de la interpretación
   del árbitro. Yip (2024) deriva córners de supremacía y total implícitos en 1X2/O-U — eso es señal de
   equipos/partido, coherente con que aquí ganen los equipos y no el árbitro.

## 2. Qué se hace con esto

- **Producción:** `GP_CORNERS_REF` queda **apagada**. Con ella apagada la proyección de córners es byte-idéntica
  (smoke `scripts/smoke/corners-ref-smoke.js`); las picks CORNERS llevan `ref_name`, `ref_effect` (K = 400,
  tope ±5 %) y `ref_n` para medir lo mismo sobre las ligas AF (Brasileirão, Liga MX, MLS, …) cuando el índice
  `<disco>/clubs/referees.json` tenga cientos de partidos por árbitro. Umbral para reabrir: ICC > 1 % con
  p < 0,01 en ≥2.000 partidos de una liga.
- **Pendiente accionable (no implementado en esta rama, fuera de alcance):** re-tunear `TOTALS_DAMP` de
  córners en `clubPropsFit` con K_team ≈ 40 (hoy `PRIOR_MATCHES = 4` y el grid 0/0,25/0,5 se elige por skill
  combinado córners+tarjetas). Preregistrar antes de tocarlo: Δ CRPS esperado −0,01, Δ Brier −0,0015.

## 3. Tablas generadas (`scripts/corners-ref-backtest.js`, salida íntegra)


Partidos cargados: 11466 (E0, E1, E2, E3, SC0; temporadas 2122, 2223, 2324, 2425, 2526, 2627); con árbitro: 11466 (100.0 %). Ficheros ausentes: ninguno.
Desarrollo (elección de K_team, DAMP, K_ref y r): 2122, 2223. Test: 2324, 2425, 2526, 2627. Walk-forward por fecha; media de liga = temporada en curso + anterior; calentamiento 60 partidos de liga.

#### 1. Descriptivos

| Liga | n | media total | var/media | mediana | árbitros distintos | partidos/árbitro (mediana) |
|---|---:|---:|---:|---:|---:|---:|
| E0 | 1920 | 10,32 | 1,11 | 10 | 39 | 32 |
| E1 | 2796 | 10,20 | 1,13 | 10 | 72 | 21.5 |
| E2 | 2795 | 10,09 | 1,18 | 10 | 117 | 15 |
| E3 | 2796 | 9,83 | 1,12 | 10 | 131 | 15 |
| SC0 | 1159 | 10,61 | 1,18 | 10 | 33 | 30 |

#### 2. Desarrollo (2122-2223): elección de parámetros

##### 2.1 Equipos: K_team × DAMP (CRPS del M1 en desarrollo, r ajustado a cada configuración)

| K_team | DAMP | r₁ | MAE M1 | CRPS M1 | CRPS M0 | Δ CRPS (M1−M0) | t |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 4 | 0.5 | 85,0 | 2,667 | 1,8771 | 1,8748 | +0,0023 | 0,58 |
| 4 | 0.75 | 73,2 | 2,689 | 1,8915 | 1,8748 | +0,0167 | 2,78 |
| 4 | 1 | 59,9 | 2,723 | 1,9146 | 1,8748 | +0,0399 | 4,99 |
| 10 | 0.5 | 85,0 | 2,663 | 1,8736 | 1,8748 | -0,0012 | -0,35 |
| 10 | 0.75 | 80,9 | 2,675 | 1,8821 | 1,8748 | +0,0073 | 1,48 |
| 10 | 1 | 69,6 | 2,697 | 1,8966 | 1,8748 | +0,0218 | 3,33 |
| 20 | 0.5 | 89,4 | 2,661 | 1,8717 | 1,8748 | -0,0030 | -1,16 |
| 20 | 0.75 | 85,0 | 2,666 | 1,8759 | 1,8748 | +0,0012 | 0,30 |
| 20 | 1 | 76,9 | 2,679 | 1,8840 | 1,8748 | +0,0092 | 1,78 |
| 40 | 0.5 | 89,4 | 2,662 | 1,8711 | 1,8748 | -0,0037 | -1,96 |
| 40 | 0.75 | 89,4 | 2,662 | 1,8723 | 1,8748 | -0,0025 | -0,89 |
| 40 | 1 | 85,0 | 2,666 | 1,8755 | 1,8748 | +0,0007 | 0,18 |

Elegido: K_team = 40, DAMP = 0.5.

##### 2.2 Árbitro: prior K_ref

Empírico-Bayes (método de momentos, ANOVA de un factor sobre y/μ₁ en desarrollo; árbitros con ≥3 partidos): G = 107 árbitros, N = 4205; σ²_dentro = 0,1098, τ²_entre = 0,00002 (τ = 0,0041 ≈ 0,04 córners sobre un total de 10), F = 1,01 → **K_ref(EB) = 6428,0**.

| K_ref | base del cociente | CRPS M2 | Δ CRPS (M2−M1) | t | MAE M2 | Brier M2 | Δ Brier (M2−M1) |
|---:|---|---:|---:|---:|---:|---:|---:|
| 5 | team | 1,9017 | +0,0306 | 5,93 | 2,704 | 0,2324 | +0,00384 |
| 10 | team | 1,8909 | +0,0198 | 4,83 | 2,688 | 0,2311 | +0,00250 |
| 20 | team | 1,8823 | +0,0112 | 3,71 | 2,676 | 0,2300 | +0,00140 |
| 40 | team | 1,8766 | +0,0055 | 2,68 | 2,668 | 0,2292 | +0,00066 |
| 80 | team | 1,8734 | +0,0024 | 1,84 | 2,664 | 0,2288 | +0,00026 |
| 160 | team | 1,8720 | +0,0009 | 1,25 | 2,663 | 0,2287 | +0,00009 |
| 6428 | team | 1,8711 | +0,0000 | 0,46 | 2,662 | 0,2286 | +0,00000 |
| 5 | league | 1,9025 | +0,0314 | 6,04 | 2,706 | 0,2325 | +0,00393 |
| 10 | league | 1,8915 | +0,0204 | 4,94 | 2,689 | 0,2311 | +0,00256 |
| 20 | league | 1,8827 | +0,0117 | 3,82 | 2,677 | 0,2300 | +0,00145 |
| 40 | league | 1,8769 | +0,0058 | 2,79 | 2,669 | 0,2293 | +0,00069 |
| 80 | league | 1,8736 | +0,0025 | 1,94 | 2,665 | 0,2289 | +0,00028 |
| 160 | league | 1,8721 | +0,0010 | 1,35 | 2,663 | 0,2287 | +0,00010 |
| 6428 | league | 1,8711 | +0,0000 | 0,55 | 2,662 | 0,2286 | +0,00000 |

Elegido para test: K_ref = 6428 (el EB; el mejor del grid fue 6428/team), base = team. r fijados en desarrollo: r₀ = 85,0, r₁ = 89,4, r₂ = 89,4.

#### 3. TEST (2324-2627) — fuera de muestra

##### 3.1 Métricas por liga y global

| Liga | n | MAE M0 | MAE M1 | MAE M2 | CRPS M0 | CRPS M1 | CRPS M2 | log-score M0 | M1 | M2 | Brier M0 | M1 | M2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| E0 | 1160 | 2,746 | 2,726 | 2,726 | 1,9384 | 1,9239 | 1,9238 | 2,6494 | 2,6414 | 2,6413 | 0,2310 | 0,2291 | 0,2291 |
| E1 | 1692 | 2,751 | 2,738 | 2,738 | 1,9232 | 1,9129 | 1,9129 | 2,6389 | 2,6337 | 2,6338 | 0,2352 | 0,2338 | 0,2338 |
| E2 | 1691 | 2,820 | 2,807 | 2,807 | 1,9791 | 1,9696 | 1,9695 | 2,6667 | 2,6616 | 2,6616 | 0,2329 | 0,2317 | 0,2317 |
| E3 | 1692 | 2,673 | 2,660 | 2,660 | 1,8898 | 1,8790 | 1,8790 | 2,6257 | 2,6200 | 2,6200 | 0,2289 | 0,2273 | 0,2273 |
| SC0 | 703 | 2,765 | 2,750 | 2,750 | 1,9566 | 1,9416 | 1,9416 | 2,6626 | 2,6526 | 2,6526 | 0,2348 | 0,2332 | 0,2332 |
| **Global** | 6938 | 2,749 | 2,735 | 2,735 | 1,9346 | 1,9232 | 1,9232 | 2,6466 | 2,6404 | 2,6404 | 0,2324 | 0,2309 | 0,2309 |

Comparaciones pareadas (Δ = A − B por partido; negativo = A mejor; IC 95 % bootstrap pareado, 2000 remuestreos; t iid):

| Liga | Par | n | Δ MAE | t | Δ CRPS | IC 95 % | t | p_boot | Δ Brier | t | Δ log-score | t |
|---|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| E0 | M1−M0 | 1160 | -0,0201 | -2,20 | -0,0145 | [-0,0251, -0,0037] | -2,59 | 0,011 | -0,00186 | -2,12 | -0,0080 | -2,84 |
| E0 | M2−M1 | 1160 | -0,0002 | -0,93 | -0,0001 | [-0,0003, +0,0001] | -1,31 | 0,173 | -0,00001 | -0,96 | -0,0001 | -1,35 |
| E0 | M2−M0 | 1160 | -0,0202 | -2,21 | -0,0146 | [-0,0258, -0,0039] | -2,61 | 0,009 | -0,00188 | -2,13 | -0,0080 | -2,86 |
| E1 | M1−M0 | 1692 | -0,0131 | -1,98 | -0,0103 | [-0,0177, -0,0031] | -2,64 | 0,007 | -0,00141 | -2,25 | -0,0051 | -2,63 |
| E1 | M2−M1 | 1692 | +0,0001 | 1,18 | +0,0000 | [-0,0001, +0,0002] | 0,54 | 0,585 | +0,00001 | 0,77 | +0,0000 | 0,41 |
| E1 | M2−M0 | 1692 | -0,0129 | -1,95 | -0,0102 | [-0,0179, -0,0020] | -2,62 | 0,016 | -0,00140 | -2,23 | -0,0051 | -2,62 |
| E2 | M1−M0 | 1691 | -0,0125 | -1,84 | -0,0095 | [-0,0176, -0,0008] | -2,30 | 0,033 | -0,00118 | -1,77 | -0,0051 | -2,37 |
| E2 | M2−M1 | 1691 | -0,0000 | -0,02 | -0,0000 | [-0,0002, +0,0001] | -0,55 | 0,559 | -0,00000 | -0,15 | -0,0000 | -0,57 |
| E2 | M2−M0 | 1691 | -0,0125 | -1,84 | -0,0096 | [-0,0179, -0,0014] | -2,31 | 0,025 | -0,00118 | -1,77 | -0,0051 | -2,37 |
| E3 | M1−M0 | 1692 | -0,0130 | -1,79 | -0,0107 | [-0,0197, -0,0022] | -2,48 | 0,009 | -0,00155 | -2,19 | -0,0056 | -2,51 |
| E3 | M2−M1 | 1692 | +0,0000 | 0,37 | -0,0000 | [-0,0001, +0,0001] | -0,32 | 0,724 | -0,00000 | -0,08 | -0,0000 | -0,70 |
| E3 | M2−M0 | 1692 | -0,0129 | -1,78 | -0,0108 | [-0,0194, -0,0020] | -2,49 | 0,012 | -0,00155 | -2,19 | -0,0056 | -2,52 |
| SC0 | M1−M0 | 703 | -0,0146 | -1,27 | -0,0151 | [-0,0286, -0,0019] | -2,18 | 0,022 | -0,00163 | -1,49 | -0,0101 | -2,76 |
| SC0 | M2−M1 | 703 | +0,0001 | 0,45 | +0,0000 | [-0,0001, +0,0002] | 0,38 | 0,726 | +0,00001 | 0,69 | -0,0000 | -0,00 |
| SC0 | M2−M0 | 703 | -0,0145 | -1,26 | -0,0150 | [-0,0291, -0,0018] | -2,18 | 0,023 | -0,00162 | -1,48 | -0,0101 | -2,76 |
| **Global** | M1−M0 | 6938 | -0,0142 | -4,08 | -0,0114 | [-0,0154, -0,0072] | -5,44 | 0,000 | -0,00149 | -4,42 | -0,0062 | -5,79 |
| **Global** | M2−M1 | 6938 | +0,0000 | 0,44 | -0,0000 | [-0,0001, +0,0000] | -0,65 | 0,519 | +0,00000 | 0,02 | -0,0000 | -0,99 |
| **Global** | M2−M0 | 6938 | -0,0142 | -4,07 | -0,0114 | [-0,0157, -0,0074] | -5,44 | 0,000 | -0,00149 | -4,41 | -0,0062 | -5,79 |

##### 3.2 Brier de P(over) por línea sintética (test, global)

| Línea | n | Brier M0 | Brier M1 | Brier M2 | Δ M2−M1 | t | Δ M1−M0 | t | frecuencia over |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| mediana − 1,5 | 6909 | 0,2198 | 0,2186 | 0,2186 | -0,00000 | -0,48 | -0,00124 | -3,54 | 0,671 |
| mediana − 0,5 | 6909 | 0,2454 | 0,2442 | 0,2441 | -0,00000 | -0,28 | -0,00120 | -2,95 | 0,559 |
| mediana + 0,5 | 6909 | 0,2448 | 0,2431 | 0,2431 | +0,00000 | 0,33 | -0,00167 | -4,05 | 0,439 |
| mediana + 1,5 | 6909 | 0,2234 | 0,2215 | 0,2215 | +0,00000 | 0,47 | -0,00186 | -5,05 | 0,339 |

##### 3.3 Por temporada (test): Δ CRPS M2−M1

| Temporada | n | CRPS M1 | CRPS M2 | Δ | t |
|---|---:|---:|---:|---:|---:|
| 2324 | 2264 | 1,9912 | 1,9912 | -0,0000 | -0,60 |
| 2425 | 2264 | 1,9087 | 1,9087 | -0,0000 | -0,39 |
| 2526 | 2264 | 1,8739 | 1,8739 | +0,0000 | 0,05 |
| 2627 | 146 | 1,8561 | 1,8559 | -0,0002 | -0,90 |

##### 3.4 Por historial del árbitro (test): ¿ayuda más cuando se le conoce?

| Partidos previos del árbitro | n | multiplicador medio | rango | Δ CRPS M2−M1 | t | Δ Brier | t |
|---|---:|---:|---|---:|---:|---:|---:|
| sin historial (0) | 69 | 1,0000 | 1,000-1,000 | +0,0000 | — | +0,00000 | — |
| 1-19 | 785 | 1,0000 | 0,999-1,001 | -0,0001 | -1,31 | -0,00001 | -1,01 |
| 20-49 | 1068 | 1,0001 | 0,999-1,002 | +0,0000 | 0,10 | +0,00001 | 0,65 |
| 50-99 | 3433 | 1,0000 | 0,999-1,002 | -0,0000 | -0,64 | -0,00000 | -0,31 |
| ≥100 | 1583 | 0,9999 | 0,999-1,002 | +0,0000 | 0,00 | +0,00000 | 0,35 |

##### 3.5 Cuando el árbitro mueve la proyección (test): |mult − 1| ≥ 3 %

| Grupo | n | media real | μ₁ media | μ₂ media | MAE M1 | MAE M2 | Δ CRPS | t |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| resto | 6938 | 10,23 | 10,20 | 10,20 | 2,735 | 2,735 | -0,0000 | -0,65 |

##### 3.6 Priors alternativos en TEST (qué costaría un K más agresivo; r₂ ajustado en desarrollo a cada K)

| K_ref | CRPS M2 | Δ CRPS (M2−M1) | IC 95 % | t | Δ Brier | t | Δ MAE | t | multiplicador: p10 / p90 |
|---:|---:|---:|---|---:|---:|---:|---:|---:|---|
| 14 | 1,9319 | +0,0087 | [+0,0032, +0,0143] | 3,04 | +0,00158 | 3,60 | +0,0178 | 3,82 | 0,960 / 1,048 |
| 40 | 1,9272 | +0,0040 | [+0,0001, +0,0078] | 2,02 | +0,00081 | 2,63 | +0,0094 | 2,88 | 0,971 / 1,035 |
| 100 | 1,9245 | +0,0013 | [-0,0012, +0,0038] | 1,08 | +0,00033 | 1,70 | +0,0042 | 2,04 | 0,981 / 1,023 |
| 400 | 1,9232 | -0,0000 | [-0,0009, +0,0009] | -0,03 | +0,00004 | 0,62 | +0,0008 | 1,09 | 0,993 / 1,009 |
| 6428 | 1,9232 | -0,0000 | [-0,0001, +0,0000] | -0,65 | +0,00000 | 0,02 | +0,0000 | 0,44 | 0,999 / 1,001 |

#### 4. Desarrollo (2122-2223) — referencia, parámetros ajustados aquí

##### 4.1 Métricas por liga y global (en muestra para r y K)

| Liga | n | MAE M0 | MAE M1 | MAE M2 | CRPS M0 | CRPS M1 | CRPS M2 | log-score M0 | M1 | M2 | Brier M0 | M1 | M2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| E0 | 700 | 2,707 | 2,695 | 2,695 | 1,8801 | 1,8798 | 1,8798 | 2,6135 | 2,6140 | 2,6140 | 0,2356 | 0,2352 | 0,2352 |
| E1 | 1044 | 2,631 | 2,638 | 2,638 | 1,8656 | 1,8683 | 1,8683 | 2,6154 | 2,6164 | 2,6164 | 0,2288 | 0,2293 | 0,2294 |
| E2 | 1044 | 2,702 | 2,686 | 2,686 | 1,8840 | 1,8786 | 1,8786 | 2,6237 | 2,6212 | 2,6212 | 0,2295 | 0,2284 | 0,2284 |
| E3 | 1036 | 2,585 | 2,565 | 2,565 | 1,8227 | 1,8121 | 1,8121 | 2,5864 | 2,5808 | 2,5808 | 0,2246 | 0,2228 | 0,2228 |
| SC0 | 396 | 2,860 | 2,852 | 2,852 | 2,0013 | 1,9976 | 1,9975 | 2,6764 | 2,6741 | 2,6741 | 0,2309 | 0,2304 | 0,2304 |
| **Global** | 4220 | 2,671 | 2,662 | 2,662 | 1,8748 | 1,8711 | 1,8711 | 2,6157 | 2,6139 | 2,6139 | 0,2293 | 0,2286 | 0,2286 |

Comparaciones pareadas (Δ = A − B por partido; negativo = A mejor; IC 95 % bootstrap pareado, 2000 remuestreos; t iid):

| Liga | Par | n | Δ MAE | t | Δ CRPS | IC 95 % | t | p_boot | Δ Brier | t | Δ log-score | t |
|---|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| E0 | M1−M0 | 700 | -0,0122 | -1,53 | -0,0003 | [-0,0096, +0,0090] | -0,07 | 0,946 | -0,00032 | -0,43 | +0,0005 | 0,18 |
| E0 | M2−M1 | 700 | -0,0001 | -0,84 | -0,0000 | [-0,0001, +0,0001] | -0,33 | 0,754 | -0,00001 | -0,66 | +0,0000 | 0,04 |
| E0 | M2−M0 | 700 | -0,0123 | -1,53 | -0,0003 | [-0,0101, +0,0089] | -0,07 | 0,929 | -0,00033 | -0,43 | +0,0005 | 0,18 |
| E1 | M1−M0 | 1044 | +0,0068 | 1,16 | +0,0027 | [-0,0041, +0,0094] | 0,78 | 0,477 | +0,00058 | 1,01 | +0,0010 | 0,55 |
| E1 | M2−M1 | 1044 | +0,0000 | 0,53 | +0,0000 | [-0,0001, +0,0001] | 0,91 | 0,397 | +0,00001 | 0,90 | +0,0000 | 0,87 |
| E1 | M2−M0 | 1044 | +0,0068 | 1,16 | +0,0027 | [-0,0043, +0,0093] | 0,79 | 0,434 | +0,00059 | 1,02 | +0,0010 | 0,56 |
| E2 | M1−M0 | 1044 | -0,0157 | -2,29 | -0,0054 | [-0,0130, +0,0023] | -1,40 | 0,169 | -0,00114 | -1,77 | -0,0025 | -1,34 |
| E2 | M2−M1 | 1044 | +0,0000 | 0,54 | -0,0000 | [-0,0001, +0,0001] | -0,25 | 0,821 | -0,00000 | -0,29 | -0,0000 | -0,11 |
| E2 | M2−M0 | 1044 | -0,0157 | -2,28 | -0,0054 | [-0,0130, +0,0019] | -1,41 | 0,160 | -0,00114 | -1,77 | -0,0025 | -1,34 |
| E3 | M1−M0 | 1036 | -0,0202 | -3,02 | -0,0107 | [-0,0182, -0,0029] | -2,74 | 0,008 | -0,00178 | -2,82 | -0,0056 | -2,71 |
| E3 | M2−M1 | 1036 | +0,0001 | 0,72 | +0,0000 | [-0,0000, +0,0001] | 0,99 | 0,331 | +0,00001 | 0,86 | +0,0000 | 0,95 |
| E3 | M2−M0 | 1036 | -0,0201 | -3,01 | -0,0106 | [-0,0181, -0,0032] | -2,73 | 0,003 | -0,00178 | -2,81 | -0,0055 | -2,70 |
| SC0 | M1−M0 | 396 | -0,0081 | -0,70 | -0,0037 | [-0,0171, +0,0093] | -0,55 | 0,571 | -0,00056 | -0,52 | -0,0023 | -0,67 |
| SC0 | M2−M1 | 396 | -0,0001 | -0,91 | -0,0001 | [-0,0002, +0,0001] | -0,69 | 0,487 | -0,00001 | -1,28 | -0,0000 | -0,55 |
| SC0 | M2−M0 | 396 | -0,0082 | -0,71 | -0,0038 | [-0,0175, +0,0091] | -0,56 | 0,603 | -0,00057 | -0,53 | -0,0023 | -0,68 |
| **Global** | M1−M0 | 4220 | -0,0099 | -3,05 | -0,0037 | [-0,0075, +0,0001] | -1,96 | 0,059 | -0,00068 | -2,20 | -0,0019 | -1,95 |
| **Global** | M2−M1 | 4220 | +0,0000 | 0,28 | +0,0000 | [-0,0000, +0,0001] | 0,46 | 0,648 | +0,00000 | 0,07 | +0,0000 | 0,70 |
| **Global** | M2−M0 | 4220 | -0,0099 | -3,04 | -0,0037 | [-0,0076, +0,0000] | -1,95 | 0,050 | -0,00068 | -2,20 | -0,0019 | -1,94 |

#### 5. ¿Cuánta varianza entre partidos explica el árbitro una vez controlados los equipos?

**Todas las temporadas** (n = 11158 partidos con árbitro; residuo e = total − μ₁): var(total) = 11,65, var(μ₁) = 0,232 (equipos explican 0,9 % de la varianza), var(e) = 11,55. ANOVA de efectos aleatorios por árbitro (≥5 partidos; G = 156): σ²_dentro = 11,53, τ²_árbitro = 0,028 (τ = 0,17 córners), **ICC = τ²/var(e) = 0,24 %** (= 0,24 % de la varianza total), F = 1,17, p (permutación, 1000) = 0,084. Fiabilidad mitad/mitad del efecto (árbitros con ≥20 partidos, n = 126): ρ = 0,028.

**Solo test** (n = 6938 partidos con árbitro; residuo e = total − μ₁): var(total) = 11,92, var(μ₁) = 0,247 (equipos explican 0,9 % de la varianza), var(e) = 11,81. ANOVA de efectos aleatorios por árbitro (≥5 partidos; G = 139): σ²_dentro = 11,80, τ²_árbitro = 0,027 (τ = 0,17 córners), **ICC = τ²/var(e) = 0,23 %** (= 0,23 % de la varianza total), F = 1,11, p (permutación, 1000) = 0,155. Fiabilidad mitad/mitad del efecto (árbitros con ≥20 partidos, n = 107): ρ = -0,016.

##### 5.1 Árbitros con más partidos (índice al final del periodo; multiplicador con K = 6428)

| Árbitro | n | media total | cociente medio (total/μ) | multiplicador encogido |
|---|---:|---:|---:|---:|
| D Webb | 158 | 10,15 | 1,003 | 1,000 |
| J Smith | 156 | 10,26 | 1,014 | 1,000 |
| B Speedie | 156 | 10,01 | 1,002 | 1,000 |
| S Martin | 151 | 10,09 | 0,998 | 1,000 |
| M Donohue | 150 | 10,04 | 0,991 | 1,000 |
| J Busby | 150 | 10,55 | 1,044 | 1,001 |
| S Oldham | 150 | 9,91 | 0,992 | 1,000 |
| G Ward | 148 | 9,98 | 0,985 | 1,000 |
| O Langford | 148 | 10,22 | 1,009 | 1,000 |
| A Taylor | 147 | 10,24 | 0,987 | 1,000 |
| W Finnie | 145 | 10,59 | 1,053 | 1,001 |
| B Toner | 145 | 10,02 | 0,989 | 1,000 |
| R Hardie | 30 | 9,50 | 0,874 | 0,999 |
| A Muir | 39 | 11,77 | 1,108 | 1,001 |
| A Marriner | 40 | 11,28 | 1,106 | 1,001 |
| L Smith | 107 | 11,05 | 1,086 | 1,001 |
| C Steven | 38 | 9,82 | 0,917 | 1,000 |
| A Humphries | 39 | 10,67 | 1,083 | 1,000 |
| B Atkinson | 50 | 10,60 | 1,080 | 1,001 |
| C Boyeson | 44 | 9,14 | 0,923 | 0,999 |

Distribución del multiplicador encogido entre árbitros con ≥30 partidos (n = 112): mín 0,999, p10 0,999, mediana 1,000, p90 1,001, máx 1,001.

