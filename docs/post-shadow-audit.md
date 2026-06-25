# Post-Shadow Audit — GP Simulador (fase post-shadow)

> Auditoría de código del primer shadow real de The Odds API (clasificado **APROBADO CON PENDIENTES**).
> Estado del sistema: ingesta **DETENIDA** (flags off). Esta fase corrige operación, conecta Canonical,
> verifica source independence y ejecuta Value en **dry-run** — todo en local/staging, **sin deploy**.

## 1. Qué validó el shadow (y qué no)

**Validado:** The Odds API (auth, descubrimiento, fetch h2h) → normalización básica 1X2 prematch →
persistencia → recuperación tras reinicios → operación básica del orquestador.

**NO validado todavía:** `sportsbook_quotes` → Canonical Event Graph → mappings → no-vig → source
independence → consenso → ensemble → Value Engine. Esta fase ataca exactamente esa cadena.

## 2. Métricas finales del shadow (ventana ~71.6h)

```
283,677 sportsbook_quotes (213 MB)   102 ingestion_runs (99 partial, 3 running huérfanas)
34 operational job runs → 34/34 timed_out   98 pares de runs solapados   ~208 provider requests
0 live   100% 1X2/regulation   0 Picks   0 señales   0 Value persistido   0 alertas   INVARIANTES = 0
```

## 3. Causas raíz (confirmadas en código)

| # | Síntoma | Causa raíz | Ubicación |
|---|---------|-----------|-----------|
| R1 | Ingesta ~3 min/run | **Insert N+1 fila-a-fila** | `sportsbook-providers/repositories.js:21-40` |
| R2 | Storage crece ~70 MB/día, dedup≈0 | `ON CONFLICT` incluye `ingestion_run_id` → cada run inserta snapshot completo nuevo | `repositories.js:31`, `017_sportsbook_provider.sql:11-13` |
| R3 | 34/34 timed_out | `timeout_ms: 60*1000` (60s) < duración real (~180s) | `operations/jobRegistry.js:51` |
| R4 | Ejecución sigue viva tras timeout → escrituras concurrentes | `withTimeout` = `Promise.race` (no cancela la promesa subyacente) | `operations/runner.js:19-23` |
| R5 | 98 pares solapados (timeout→retry→ingesta concurrente) | El lock se libera al retornar `fn()`; el retry arranca mientras la 1ª ejecución sigue viva | `market-data/locks.js:33-35` + `runner.js:55-72` |
| R6 | Sin abort cooperativo | `runOnce({})` no recibe `signal`; loop de competiciones no chequea aborto | `jobRegistry.js:52`, `ingestion.js:14,40` |
| R7 | 3 runs huérfanos en `running` | `sportsbook_ingestion_runs` (mig 015) **no tiene heartbeat ni reconciliación** | `repositories.js:7-18`, `015` |
| R8 | 99/102 partial por `bad_request` repetido | Una sport key sin `h2h` se reconsulta cada ciclo; sin catálogo de capabilities | `ingestion.js:45-54` |
| R9 | Sportsbook no alimenta Canonical | `canonical-graph/scheduler.loadMarkets` solo lee `provider_market_catalog` | `canonical-graph/scheduler.js:18-33` |
| R10 | Canonical matchea 0 | **`graphRepository.seedParticipants()` nunca se invocó** → participants:0, aliases:0 | `canonical-graph/repositories/graphRepository.js` (sin callers) |
| R11 | Value dry-run no corre con write=false | `valueScheduler = veWrite && ...` (scheduler acoplado a write) | `value-engine/config.js:24`, `scheduler.js:37-40` |
| R12 | Sin verified/unverified en consenso | `consensus.js` agrupa por `independence_group` pero no distingue verificación de fuente | `value-engine/consensus.js:22-33` |
| R13 | Skew 1X2 no aplicado | `maxBookOutcomeSkewMs`/`maxOutcomeSkewMs` definidos pero **sin uso** | `value-engine/config.js:41`, `sportsbook-providers/config.js:42` |
| R14 | Caso Bosnia (1.22 vs 5.10) | Sin detección de **outlier semántico**; consenso solo robusto por mediana (no bloquea, promedia) | `consensus.js` (ver `bosnia-outlier-investigation.md`) |

## 4. Diferenciación de las 4 dimensiones (instrucción del usuario)

- **(a) Sostenibilidad de créditos** — resuelta con key 20k (~66/día = ~10%/mes). NO blocker.
- **(b) Eficiencia de requests** — R8 (sport key incompatible reconsultada). Operativo, no de cuota.
- **(c) Retries por timeout** — R3+R4+R5+R6. Causa de los 98 solapamientos.
- **(d) Crecimiento de almacenamiento** — R1+R2. Proyección ~2.1 GB/30d sin current/history+retención.

## 5. Estrategia de corrección (orden del spec)

```
1. Operación   → batch insert (R1) → idempotencia natural sin run_id (R2) → timeout/abort/locks (R3-R6) → orphans (R7) → capabilities (R8)
2. Storage     → current state + history material + retención guarded (R1/R2/d)
3. Canonical   → seed participants (R10) + loader sportsbook→descriptor + candidates/needs_review, auto-match OFF (R9)
4. Source ind. → catálogo versionado verified/unverified/duplicate_skin/excluded (R12)
5. Value       → consenso/no-vig/ensemble con sets sincronizados (R13) + outlier semántico (R14) + dry-run desacoplado de write (R11)
```

**Regla:** primero corregir N+1 (R1), DESPUÉS medir p50/p95/max y configurar timeout por evidencia
(no resolver R3 solo subiendo el timeout). **No optimizar para producir más STRONG** — optimizar para
rechazar datos incorrectos, evitar duplicación y bloquear incertidumbre.

## 6. Datos preservados (NO borrar durante esta fase)

283,677 filas en `sportsbook_quotes` (raw legacy), `sportsbook_provider_state`, `sportsbook_ingestion_runs`.
La migración a current/history es **aditiva y reversible**; el raw legacy se conserva una ventana segura y
solo se propone eliminación después de auditar/validar conteos (ver `sportsbook-retention.md`).
