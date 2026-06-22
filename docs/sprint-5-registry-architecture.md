# Sprint 5 — Arquitectura del registro

Capa independiente `signal-registry/` que congela cada señal tal como existía al publicarse.
**No demuestra que GP gana; demuestra que GP no reescribe la historia.**

```
Signal candidate → schema → eligibility → señal inmutable → source refs → hash chain
  → signal_events → closing benchmark → settlement → API pública → página permanente
```

## Módulos (`signal-registry/`)
| Archivo | Rol |
|---|---|
| `config.js` | Flags `SIGNAL_REGISTRY_*` + epoch verificable + genesis hash + versiones de esquema. |
| `canonicalize.js` | Serialización determinística (claves ordenadas). |
| `hashing.js` | content_hash, registry_hash, event_hash, settlement_hash, merkle root (SHA-256). |
| `schemas.js` | Validación de payload por tipo (1X2 suma 1, arb sin realized_roi, etc.). |
| `eligibility.js` | score_eligible + verification_status (verified/late/legacy/experimental). |
| `chain.js` | Inserción concurrente-segura en la cadena (advisory lock + posición + hashes). |
| `eventLog.js` | Eventos hash-linked por señal + proyección. |
| `publisher.js` | Orquesta registro (published_at server-side, dry-run si write off). |
| `settlement.js` | Settlement versionado, idempotente (arb: realized_roi null). |
| `corrections.js` | Corrección = nueva versión; nunca reescribe; campos publicados → solo disputa. |
| `closingCapture.js` | Benchmark de cierre sin look-ahead (observed_at ≤ event_start_at). |
| `verifier.js` | Recomputa hashes; verifica cadena (detecta alteración/posición/previous). |
| `presentation.js` | Redacción pública (sin raw payloads/IDs internos). |
| `repositories.js` | DB (tablas inmutables solo INSERT; proyección mutable). |
| `index.js` | Fachada + commitment diario + integración Sprint 4/V1/V2. |
| `cli.js` | status / verify-chain / verify-signal / commit-day. |

## Tablas (migración 013)
`signals` (evolucionada, inmutable) · `signal_events` · `signal_source_references` · `signal_settlements`
· `signal_closing_snapshots` · `signal_registry_commitments` (todas append-only con triggers) ·
`signal_state_projection` (mutable, reconstruible).

## Principios
- Una señal se **publica → congela → verifica → liquida**; cualquier corrección permanece visible.
- `published_at` es **server-side** (no se acepta del frontend).
- El contenido original nunca se actualiza ni borra. Los cambios son eventos nuevos.
- Inerte con flags apagados: ningún cambio de producto, cero writes, track record legacy intacto.
