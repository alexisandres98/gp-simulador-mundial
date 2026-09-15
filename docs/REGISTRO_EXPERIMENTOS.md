# Registro de experimentos — GP Simulador

> Abierto el 15-sep-2026 por exigencia de la auditoría externa (§4.3, §4.4).
> **Aquí se anota TODO intento, incluidos los que salen mal.** Un registro que solo guarda los aciertos no
> es un registro: es una vitrina, y una vitrina no permite saber cuántas veces se buscó antes de encontrar.
> Sin ese número, ningún resultado significativo lo es.

## Por qué existe

La auditoría encontró que llevamos meses probando variantes de modelo y quedándonos con la que mejor
puntuaba, sin anotar cuántas se probaron. Con treinta comparaciones y un umbral de 5 %, una y media sale
"significativa" por puro azar. El remedio no es dejar de probar: es anotar todas las pruebas y corregir el
umbral por el número de comparaciones (Benjamini–Hochberg al 10 %, `lib/inferencia.js` → `bh()`).

## Reglas del registro

1. **Se anota ANTES de mirar el resultado.** La fila nace con hipótesis, datos, protocolo y criterio de
   éxito. El resultado se rellena después. Una fila que aparece ya con resultado es sospechosa por diseño.
2. **Un intento es una fila.** Cambiar un hiperparámetro y volver a correr es un intento nuevo si la
   decisión de cambiarlo vino de haber visto el resultado anterior. Si el barrido estaba declarado de
   antemano, es un solo intento.
3. **El protocolo temporal es anidado** (§4.4): los hiperparámetros se eligen DENTRO del entrenamiento, en
   una validación interna que nunca toca el bloque que se evalúa.
4. **La incertidumbre es por racimos**, no por tickets. Tres líneas del mismo partido no son tres datos.
5. **Ganar aquí no es invertir.** Un aspirante que describe mejor el conteo sigue teniendo que pasar
   `lib/vara.js` contra el precio antes de que se hable de dinero.

## Estado de los experimentos

| # | Fecha | Familia | Hipótesis | Datos | Protocolo | Criterio de éxito | Resultado | Veredicto |
|---|-------|---------|-----------|-------|-----------|-------------------|-----------|-----------|
| E-001 | 15-sep-2026 | Tarjetas (`cards_under_v1`) | El modelo actual (nivel de liga del prop-engine, TOTALS_DAMP=0) no es mejor que un nivel dinámico por liga×temporada, ni que las leyes de conteo alternativas | 10.757 partidos de clubes, 40 ligas, temporadas 2025 y 2026 (`data/clubs/props-history-*.json`) | Validación hacia adelante en bloques mensuales; hiperparámetros por validación interna al 80 % del entrenamiento; cuatro leyes con la MISMA media | Un aspirante gana a T0 en log-score y CRPS, y no empeora la calibración en 4,5/5,5/6,5 | _pendiente_ | _pendiente_ |
| E-002 | 15-sep-2026 | Tarjetas | Las fuerzas de equipo aportan señal al TOTAL cuando hay 10.000 partidos, aunque no la aportaran con los 102 del Mundial | ídem E-001 | El exponente de amortiguación `damp` se elige dentro del entrenamiento; si las fuerzas son ruido, el propio entrenamiento lo pone a 0 | `damp > 0` elegido en la mayoría de los bloques Y mejora de log-score sobre T1 | _pendiente_ | _pendiente_ |
| E-003 | 15-sep-2026 | Tarjetas | El árbitro aporta cuando se estima sobre el RESIDUO (descontando liga y equipos) y no sobre el bruto — hallazgo A19: hoy se entrena y no se sirve | ídem E-001, 10.199 partidos con árbitro identificado | ídem; multiplicador encogido y topado ±20 % | T2b gana a T2a en log-score con la diferencia fuera del error por racimos | _pendiente_ | _pendiente_ |

## Intentos descartados

_(Ninguno todavía en este registro. Los anteriores al 15-sep no se anotaron — ese es exactamente el
problema que la auditoría señaló, y no se puede reconstruir a posteriori sin inventar. Los experimentos
previos documentados viven en `docs/PREREGISTRO_*.md` y `docs/impl/*-REPORT.md`, sin contador de intentos.)_

## Contador de comparaciones vivas

Para la corrección por comparaciones múltiples hay que saber cuántas pruebas están sobre la mesa a la vez.

| Bloque | Comparaciones declaradas | Umbral BH al 10 % |
|--------|--------------------------|-------------------|
| Fase 2 — tarjetas | 3 (E-001, E-002, E-003) | se calcula al cerrar el bloque con `bh()` |
| Fase 2 — CS2 | pendiente de declarar | — |
| Fase 2 — tenis de mesa | pendiente de declarar | — |
| Fase 2 — tenis ATP | pendiente de declarar | — |
