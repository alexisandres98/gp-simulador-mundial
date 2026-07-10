# Backtest de señales nuevas como candidatas a GATE — 10-jul-2026

Regla de la casa: ninguna señal toca gates/umbrales sin backtest. Veredicto de las dos señales
construidas en la obra del 9-jul (line-intel y style-engine), con números y decisión.

## A. Movimiento de línea (publicación → cierre) vs resultado de la pick

Muestra: 26 picks liquidadas WIN/LOSS con prob de mercado al publicar Y cierre resoluble.

| Grupo | n | Aciertos | ROI | Move medio |
|---|---|---|---|---|
| Mercado se movió A FAVOR (≥ +1pp) | 6 | 6/6 (100%) | +67.3% | +3.1pp |
| FLAT (±1pp) | 15 | 13/15 (87%) | +53.0% | −0.2pp |
| Mercado se movió EN CONTRA (≤ −1pp) | 5 | 4/5 (80%) | +77.4% | −1.5pp |

Correlación move↔win: **+0.177**.

**Veredicto: NO gatear todavía.** La dirección es la esperada (a favor > flat > en contra en acierto)
pero n=26 es muestra de juguete y hasta el grupo "en contra" ganó el 80% (el track record viene caliente,
el corte no discrimina). La señal queda en SHADOW acumulando: cada pick guarda line_move y closing, así
que el mismo análisis se re-corre gratis con más muestra (post-Mundial: clubes = volumen real).
Re-evaluar cuando n ≥ 150 decididas.

## B. Features de estilo (event data) vs modelo NB de córners actual

Diseño: walk-forward de residuos (n=44 partidos tras warmup). Para cada partido, mu del modelo NB actual
fit SOLO con partidos previos; residuo = córners reales − mu; correlación del residuo con features de
estilo calculados también walk-forward (perfiles FotMob con partidos previos).

| Feature (combinado ambos equipos) | corr con residuo |
|---|---|
| corner_share_xg ATAQUE | **−0.295** |
| corner_share_xg CONCEDIDO | −0.084 |
| header_share | −0.201 |

Por terciles de corner_share_xg: residuo medio +2.12 córners (tercil bajo) → +1.04 (medio) → **−0.37 (alto)**.

**Hallazgo (contraintuitivo y valioso):** el share de xG que nace de córners correlaciona NEGATIVO con el
conteo futuro de córners vs el modelo. Lectura: ese share mide EFICIENCIA convirtiendo el córner en
peligro, no volumen de córners. Un equipo "letal de córner" no saca más córners; el driver correcto de los
TOTALES es el volumen (corners_for_p90, que el modelo NB ya usa como fuerza de equipo).

**Acciones tomadas:**
1. Narrativa de picks CORNERS corregida el mismo día: para totales narra VOLUMEN; el share de córners queda
   para contextos de gol/aéreo (goles, jugador de cabeza), donde sí es la métrica correcta.
2. Como FEATURE del modelo NB: señal real pero al borde de la significancia (t≈2.0 con n=44) y de signo
   inverso → NO se integra ahora. Candidata a re-test post-Mundial con datos de clubes (multi-comp-backfill
   ya deja la tubería lista). Nota: el residuo medio global del modelo es +0.87 córners (el KO viene más
   bravo que grupos, coherente con el modelo por fase ya desplegado).

## C. Tarjetas

Sin test: el event data de FotMob es de remates (no faltas/tarjetas por zona), así que no hay feature de
estilo nueva que testear para tarjetas. El modelo actual ya usa árbitro + paridad + fase.

## Resumen operativo

- line_move: SHADOW, se muestra como información (chip), no gatea. Re-test con n≥150.
- corner_share_xg: NO entra al modelo; narrativa ya corregida por evidencia.
- Nada de esto tocó gates ni umbrales de publicación.
