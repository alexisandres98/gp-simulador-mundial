# Sprint 5 — Verificación pública

## API pública (gated por `SIGNAL_REGISTRY_PUBLIC_ENABLED`, 404 si off)
- `GET /api/signals` — lista (tipo, verificación, paginación). Solo visibilidad beta/public.
- `GET /api/signals/:publicId` — detalle redactado.
- `GET /api/signals/:publicId/verify` — recomputa content/registry hash + cadena de eventos → valid/invalid.
- `GET /api/signal-registry/commitments` — commitments diarios.

`public_id` opaco y estable (`sig_…`). La URL no cambia por settlement/corrección/withdrawal.

## Payload público (redactado, `presentation.js`)
Incluye: señal original (predicción, timestamp, modelo, metodología), fuentes (resumen: tipo + timestamp),
integridad (registry_hash, posición, previous), estado de scoring, settlement (todas las versiones), historial
append-only, benchmark de cierre, copy de transparencia.
**No expone**: raw payloads, secrets, notas internas, IDs internos innecesarios (signal id, canonical ids).

## UI mínima (§30, "Registro verificable")
Pestaña `Registro` (gated; visible solo si `SIGNAL_REGISTRY_PUBLIC_ENABLED` o admin). Lista de cards (tipo, evento,
predicción, publicada hace…, verificada/legacy, resultado) + detalle (señal original congelada, fuentes, integridad
con "✓ Hash verificado · posición N", resultado, timeline append-only, benchmark de cierre, transparencia).
Móvil-first, dark theme, 0 errores de consola (verificado en preview).

## Copy de transparencia (§31)
- Verified: "Esta señal fue congelada antes del evento. El contenido original no se modifica después de publicarse."
- Legacy: "Esta predicción precede al inicio del registro verificable y no cuenta como señal verificada."
- Experimental: "Experimento GP Intelligence. No forma parte del track record oficial."
- Arb: "Oportunidad observada y publicada; no representa una operación ejecutada por GP."
