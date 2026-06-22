# Sprint 8.1 — Política de datos públicos (§2.2, §39)

## Se PUEDE mostrar públicamente
- Probabilidades del modelo (V1/V2) y su descomposición de contexto (forma/descanso/racha/solidez/bajas, genérico).
- Métricas verificables (Brier, log loss, ECE, calibración, muestra) y definiciones.
- Plataformas accionables sobre las que el usuario opera: Polymarket, Kalshi, sportsbook visible (precio/deep link).
- Estados genéricos: "Datos actualizados", "Datos de mercado", "Contexto disponible", "Datos insuficientes".

## NO se muestra públicamente
- Nombres de datasets/proveedores internos, fuentes de lesiones/ratings, pipelines internos.
- Pesos del modelo, reglas propietarias completas, source references del Signal Registry, IDs internos, API keys, admin notes.

## Implementación
- La pantalla Metodología es transparente sobre DEFINICIONES, no sobre IP (cierra con esa aclaración).
- Los endpoints públicos (/api/value/*, /api/picks, /api/signals, /api/metrics/*) ya están sanitizados y gated (404 con flags off).
- ui-kit `UIState` distingue ausencia legítima vs función apagada vs provider ausente (no revela el motivo interno).
