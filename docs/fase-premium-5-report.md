# FASE PREMIUM 5 — Reporte (recuperación de paridad funcional)

**Directiva:** migración funcional completa de la plataforma principal a `/x` premium; "nunca menos datos/módulos".
Todo en `/x` detrás de `GP_PREMIUM_UI_ENABLED`. Plataforma de los 509 usuarios intacta. Sin migraciones.

## §1 Auditoría de paridad
`docs/premium-full-parity-matrix.md` — inventario exhaustivo de `app.js` (match/team/simulador + Seguidos/Alertas/
Referidos/Grupos/Bracket/Evolución/Registro/Rendimiento) y cobertura de data-providers. **Hallazgo clave:** la data
ya estaba fetcheada por premium (`/api/match`, `/api/teamdetail`, `/api/h2h/deep`) — faltaba **renderizarla**.

## Módulos recuperados (paridad)

### Match cockpit
- **Alineaciones** (formación + XI con número/nombre/posición + suplentes + DT + estado confirmada/probable), ambos
  equipos. Verificado: Argelia/Austria 4-2-3-1, 40 jugadores.
- **Estadísticas** completas (posesión/remates/al arco/córners/faltas/offsides/amarillas/xG) con barras comparativas
  home-vs-away (live **y** final) + timeline de eventos.
- **Forma reciente** de ambos equipos (V/E/D + GF/GC/vallas/promedio + últimos partidos).
- **Cobertura:** GP probability visible aunque no haya cuotas (modo `fx-`); "Mercado no disponible" solo en su módulo.
- Secciones del cockpit: Resumen · Probabilidad GP · Mercados · Contexto · Forma · Alineaciones · Estadísticas ·
  Goles · (Live). Nav sticky con scroll-spy.

### Equipos — tabs completos
Resumen (probabilidades por ronda + lectura del modelo + keyDrivers + rivales probables + **caminos simulados**),
**Plantilla** (jugadores clave + plantilla completa + alineación proyectada), **Forma**, **Resultados** (próximo +
históricos → cockpit), **Mercados** (Polymarket/Kalshi: precio/bid-ask/liquidez/Δ24h), **Noticias** (lesiones
dedup + news). Botón **Seguir/Siguiendo**.

### Simulador — profundidad
Añadido módulo **Factores GP** (lista por factor: label localizado + equipo + dirección + Pesa/Neutral + categoría;
sin prosa ES ni deltas técnicos). Ya tenía hero/memo estructurado/contexto/Monte Carlo (topScores/totals/over25/
BTTS/avgTotal)/goles. Narrativa 100% localizada (4F).

### Superficies de cuenta restauradas
- **Seguidos** (`/api/favorite`/`/api/me`): lista de equipos seguidos + próximo + champion% + des/seguir.
- **Alertas** (`/api/alertprefs`): 8 eventos (próximo/inicio/gol/resultado/clasificación/cambio prob/value/arbitraje)
  × 3 canales (email activo, Telegram/push "pronto") con toggles persistentes.
- **Invitar/Referidos** (`/api/referrals/*`): código/enlace personal, conteo verificado, barra de progreso, niveles
  1/3/5/10, regla de umbral 5. **Preserva refCode/referrals existentes** (no regenera).
- **Rendimiento** (`/api/metrics/summary` + `/api/aciertos`): Brier/Log loss/ECE/muestra (verificado) o legacy
  (total/aciertos/exactos/vs-mercado) con aviso de muestra insuficiente.

### Evolución — gráfico real
SVG multi-línea de probabilidad de campeón sobre **snapshots reales** (`/api/state.history`) + selector Top 10/
Seguidos + leyenda + tabla con Δ. **No fabrica histórico** (honesto si <2 snapshots).

## §3 Cobertura (auditada, honesta)
- GP Intelligence ya NO se vacía sin cuotas (cockpit muestra prob/contexto/factores/goles aunque no haya mercado).
- **Clima exacto / sede:** 🚫 no integrados en `data-providers` (Open-Meteo ausente; `canonical_events.venue` NULL).
  El contexto V2 SÍ incluye factores de clima (HIGH_HUMIDITY/HEAVY_RAIN) que se muestran. No se fabrica clima/sede.
- Partidos pasados: conservan resultado/eventos/stats/alineaciones; no se recalcula la predicción (modo `fx-`).

## Invariantes / seguridad
Sin migraciones · `app.js` intacto · GP V2 oficial, sin V1/V2/lambda/delta al cliente · sin fabricar datos ·
509 usuarios/auth/Registry/Epoch/Picks V1=2 intactos · arbitraje/billing/públicos/auto-exec/auto-publicación OFF ·
Goal Engine en validación (sin Picks/Value) · referidos preservados.

## QA
- 1440×900: cockpit con alineaciones/estadísticas/forma; team 6 tabs; Seguidos/Alertas(11 toggles)/Referidos(4
  niveles)/Rendimiento(4 KPIs); Evolución SVG (10 líneas + Δ). **0 overflow, 0 errores de consola.**
- Tests: `premium-confidence` 10/0, `premium-i18n` 9/0, `gp-product` 41/0.

## Limitaciones externas reales (§0.5)
- **Clima/sede exactos**: Open-Meteo no está integrado y `venue` no está poblado → no disponible en ninguna fuente
  (no fabricado). Integrarlos es trabajo de backend/proveedor.
- **§2 servicio agregador server-side** `buildPremiumMatchIntelligence`: la paridad FUNCIONAL está lograda por
  agregación cliente de los endpoints canónicos existentes; la consolidación server-side es un refactor que no
  agrega capacidad visible — queda como mejora arquitectónica, no como funcionalidad faltante.
- **Narrativa estructurada del backend (§16)** para `whatChanges`/tactical del simulador: hoy es prosa ES en el
  backend; premium muestra los factores estructurados localizados y omite la prosa no-localizable (evita ES-en-EN).

## STOP
No se fusionó `/x`. No campañas/email/billing/beta pública. Esperando revisión visual y funcional del Product Owner.
