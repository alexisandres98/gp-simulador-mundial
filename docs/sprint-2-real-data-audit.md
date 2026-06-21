# Sprint 2 — Auditoría de datos reales (para equivalencia)

> **Nota de estado:** Sprint 1 está desplegado pero **INERTE** en producción (sin `DATABASE_URL`,
> flags apagados) → el histórico aún **no contiene datos ingeridos**. Esta auditoría se basa en los
> **formatos reales conocidos** de Polymarket/Kalshi (documentados en `sprint-1-provider-audit.md`) +
> los fixtures de Sprint 1, y en ejemplos **sanitizados** representativos. Se **refinará** con datos
> reales cuando se active la ingesta. El diseño es precisión-primero: no asumir que el título describe
> el contrato completo.

## 1. Diferencias de naming entre proveedores
| Aspecto | Polymarket | Kalshi |
|---|---|---|
| Identidad del mercado | `conditionId` / `id` (estable) + `groupItemTitle`/`question` (texto) | `ticker` (estable) + `title`/`yes_sub_title` (texto) |
| Participante | en el título/`groupItemTitle` ("Brazil", "Netherlands") | en `yes_sub_title`/`title` ("Brazil", "Netherlands") |
| Reglas | `description` (texto libre) + slug; condiciones de resolución embebidas | `rules_primary` / `rules_secondary` (texto) |
| Outcome | binario YES/NO por `clobTokenIds` (2 tokens) | binario YES/NO (un bid yes + derivado) |
| Estado | `active/closed/archived/acceptingOrders` | `status` (active/closed/settled) |

## 2. Patrones de ambigüedad detectados (riesgos de falso equivalente)
- **Alias de equipos / idioma / abreviatura:** `United States` / `USA` / `U.S.` / `USMNT`;
  `South Korea` / `Korea Republic` / `KOR`; `Netherlands` / `Holanda` / `NED`.
- **Orden local/visitante:** "Brazil vs Argentina" vs "Argentina vs Brazil" (mismo partido).
- **Win vs Qualify:** "Netherlands to win" (gana el partido) ≠ "Netherlands to qualify" (avanza de ronda).
- **Periodo:** "match winner" 90 min (1X2, empate posible) ≠ "to win the match" incluyendo prórroga/penales
  (sin empate). **Misma apariencia, exposición distinta.**
- **Torneo vs partido:** "Spain to win the World Cup" (campeón) ≠ "Spain to win" (próximo partido).
- **Categoría:** selección **absoluta** vs **sub-20**; **masculino** vs **femenino**.
- **Fase:** "win the match" puede referirse a partidos distintos entre los mismos equipos (grupos vs eliminatoria).
- **Sin fecha / sin reglas:** mercados de torneo no tienen kickoff; algunos mercados no exponen reglas completas.
- **Resolución/cancelación:** "void si se pospone" vs "permanece abierto 7 días".

## 3. Ejemplos sanitizados (los 4 casos)

### ✅ MATCH correcto (mismo evento, mercado y outcome)
```
Polymarket  conditionId=0xBRA  groupItemTitle="Brazil"  (world-cup-winner, binario YES)
Kalshi      ticker=KX...-BRA   yes_sub_title="Brazil"   (KXMENWORLDCUP-26, binario YES)
→ event: sports_tournament (World Cup 2026) · market: tournament_winner · outcome YES→Brazil campeón
→ participantes idénticos (alias normalizados), misma competición/temporada, mismas reglas (campeón).
→ matched (score alto, 0 hard conflicts).
```

### ⚠️ CONDITIONAL (exposición parecida, diferencia material)
```
Polymarket  "Netherlands to win the match"  reglas: incluye prórroga y penales (sin empate)
Kalshi      "Netherlands wins match"        reglas: 90 minutos, empate posible (1X2)
→ mismo evento y participantes, PERO hard conflict de PERIODO (regulation_90m vs incl. extra time)
  y de estructura de outcome (draw_possible distinto).
→ conditional/rejected — NUNCA matched, aunque el título sea casi idéntico.
```

### ❌ REJECTED (apariencia similar, contrato distinto)
```
A  "Spain to win the World Cup"   (tournament_winner)
B  "Spain to win"                 (match_winner, próximo partido)
→ hard conflict TOURNAMENT_VS_MATCH → rejected.

A  "Netherlands to win"   B  "Netherlands to qualify"
→ hard conflict OUTCOME_WIN_VS_QUALIFY → rejected.
```

### ❓ AMBIGUO (a needs_review)
```
"Korea to win" sin reglas ni fecha, alias "Korea" (¿South Korea? ¿sub-20?), un solo proveedor.
→ información insuficiente / alias no validado → needs_review (no se fuerza).
```

## 4. Implicaciones para el diseño
1. **Participantes**: normalización determinística por alias (no fuzzy auto-join); alias validados manualmente con prioridad.
2. **Reglas**: capturar y normalizar la semántica (periodo, prórroga, penales, empate, win/qualify, resolución) con fingerprint versionado. El título **no** basta.
3. **Hard conflicts** siempre prevalecen sobre el score textual.
4. **Conservador**: ante duda → `needs_review`. Un falso positivo puede crear un arbitraje falso (pérdida); un falso negativo solo reduce cobertura.
