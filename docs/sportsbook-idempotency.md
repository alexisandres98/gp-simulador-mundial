# Sportsbook — Idempotencia natural (Bloque A)

**Problema (R2):** la idempotencia dependía de `ingestion_run_id` (`uq_sbq_book_outcome_run` incluía el run).
Cada run usaba un `run_id` nuevo → **dedup ≈ 0** → cada ciclo insertaba un snapshot completo → storage crecía
sin control (~2.1 GB proyectados a 30 días).

**Identidad natural documentada (NO depende del run):**
```
(data_provider, external_event_id, market_family, period, sportsbook_code, external_outcome_id)
```
Es la `UNIQUE` de `sportsbook_quote_current`. El upsert distingue, sin reingestar lo idéntico:

| Caso | Detección | Acción |
|------|-----------|--------|
| Misma quote repetida | precio/estado/live iguales | bump `observation_count` + `observed_at`; **sin history** |
| Nuevo precio | `odds_decimal` distinto | UPDATE current + history `change_type='price'` |
| Nuevo timestamp del provider | solo `provider_update` cambia | UPDATE `provider_update`/`observed_at`; **sin history** |
| Nuevo estado suspended/open | `quote_status` distinto | UPDATE + history `change_type='status'` |
| Disponibilidad (live) | `is_live` distinto | UPDATE + history `change_type='availability'` |

La decisión de "cambio material" la toma el trigger `sbq_write_history` (mig 021) a nivel DB, así que **no se
puede saltar desde la app**. Observaciones distintas (cambios reales de precio) **se preservan** en history;
las reingestas idénticas **no** generan filas. Verificado: replay de 3000 cuotas → 0 nuevas filas de history.
