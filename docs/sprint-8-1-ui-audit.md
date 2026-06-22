# Sprint 8.1 — Auditoría de UI (estado real)

> Auditoría previa a cualquier cambio (§4). Verificada leyendo `public/index.html` (96 ln), `public/app.js`
> (2356 ln) y `public/style.css` (1008 ln). Regla: la UI actual se conserva; los cambios van tras flags
> `UI_*` (default off → UI byte-idéntica). **Sin deploy/commit/push.**

## 0. Arquitectura actual de la UI

- `index.html` = shell mínimo: header (`#hdr`), ticker (`.tape`), topnav (`#topnav`), banner, `<main>` con 19
  `<section id="tab-*">`, footer, bottom nav (`#bottomnav`), avatar menu, sheet "Más", modal login.
- `app.js` = todo el render dinámico (vanilla, sin framework). Funciones clave: `renderHeader` (184),
  `switchTab` (226), `openSheet` (274), `toggleAvatarMenu` (250), `renderRecord` (111), `loadArb` (1114),
  `simulate` (1576), `renderPerf` (2242), `loadValue`/`loadPicks`/`loadExecOpps`/`loadRegistry`.
- `style.css` = design system dark terminal (verde `--accent`), tokens, cards, responsive.
- **Flags de UI hoy**: el backend (`getUser`) expone `execUi/registryUi/metricsUi/valueUi/picksUi` (derivados
  de los flags de Sprints 4-7). `renderHeader` (188-194) añade los tabs `opex/registry/perf/value/picks` al
  topnav SOLO si esos flags están on. Con flags off → no aparecen. **NO existen flags `UI_*`** todavía.

## 1. Conceptos mezclados / jerarquía de producto (§1)

Los 19 tabs ya incluyen `value`, `picks`, `opex` (arbitraje ejecutable), `registry`, `perf` — construidos en
Sprints 4-7 pero **inertes** (flags off). El problema de información que pide arreglar 8.1:

- **`Oportunidades` (tab `arb`, `loadArb` 1114)** es hoy un cajón único que mezcla: "Mejor oportunidad",
  "Arbitraje puro" (Polymarket/Kalshi champion), "Apuestas de valor · modelo vs mercado" (champion), y
  "Partidos · GP Take" (1X2). **No hay tabs Picks GP | Value | Arbitraje** (§9). Value/Picks/Ejecutables son
  tabs SEPARADOS y de nivel superior, no subproductos de Oportunidades.
- **No se distingue** legacy vs verificable, V1 vs V2, prematch vs live, evaluación vs Pick, edge bruto vs
  ajustado — justo lo que §1 exige separar.

## 2. Track record: legacy vs verificable (§5-8) — hallazgos

`renderRecord` (111-143), tab `record`, etiqueta `Aciertos`:
- **Título** "Aciertos · rendimiento del modelo" (116) → renombrar a **Rendimiento** (§5).
- **NO hay separación legacy/verificable** (§5). Todo sale de `/api/aciertos` (histórico de 40 partidos
  pre-registro). El Metrics Engine verificable (tab `perf`, `renderPerf` 2242) vive aparte y gated por
  `metricsUi`. Hay que unirlos conceptualmente: **Rendimiento** con segmentos `Verificable | Histórico`.
- **Jerarquía de métricas invertida** (§7): "Ganador acertado %" es un `bigstat` dominante (120); Brier es
  secundario. Debe priorizarse sample size → Brier → log loss → calibración → vs-mercado → CLV → accuracy.
- 🔴 **Copy de alpha prohibido** (`app.js:107`): *"Esto es la prueba objetiva de si tenemos alpha real."* →
  reemplazar (§6). También `marketScoreboardHtml` (95-108) dice "le estamos GANANDO al mercado" (105) — debe
  cumplir la política estadística (mostrar muestra/periodo/Brier ambos/"más bajo es mejor", sin afirmar alpha).
- **`marketScoreboardHtml` solo se muestra a admin** (126: `USER.isAdmin && d.total`) — la comparación
  modelo-vs-mercado no es pública hoy.
- **Compartir genérico** (125): un solo botón "Compartir track record" sin distinguir legacy/verified (§8).

## 3. Oportunidades: lenguaje y jerarquía (§9-15) — hallazgos

`loadArb` (1114+):
- **"Mejor oportunidad"** (1145-1190) elige `value[0] || pure[0]` = **edge BRUTO más alto**, sin política
  versionada (§15). Debe ser "Pick GP destacada / Señal STRONG destacada / Arbitraje ejecutable destacado"
  con etiqueta de tipo.
- 🔴 **`MODEL EDGE`** como señal cruda (1156) y **`COMPRAR SÍ`** (lógica `best.side.includes('SÍ')` 1151;
  comentario 1056 "COMPRAR SÍ") — lenguaje reservado/recomendación en señales crudas (§12). Sustituir por
  "Ver análisis" / "Ver mercado".
- 🔴 **`Kelly/4`** destacado en la card de Mejor oportunidad (1166) y en cards de valor (1233) — quitar de
  las cards (§13); puede quedar tras sección educativa "Referencia matemática de Kelly".
- **"Apuestas de valor"** (1214-1237) es model-vs-market champion (Sprint legacy), NO el Value Engine
  (PASS/WATCH/LEAN/STRONG). El Value Engine real vive en tab `value` (`loadValue`), gated.
- **Arbitraje** mezclado: "Arbitraje puro" aquí (champion Poly/Kalshi) vs el execution engine (tab `opex`).
  §14 quiere que la pestaña Arbitraje muestre SOLO el execution engine.

## 4. GP Intelligence V2 (§16-18) — hallazgos

`simulate` (1576+), clases `gpi-*`:
- V2 **es protagonista** en "Simula cualquier cruce" (correcto, §16 lo mantiene). Muestra decomposición
  `Modelo base → GP Intelligence integra el contexto` (1603) y en detalle `V1 control → V2 challenger` con
  delta pp (1645+).
- 🟡 **Falta etiqueta breve y visible "GP Intelligence V2 / Experimental"** en la vista resumida (§16). Hoy
  la distinción V1/V2 aparece dentro del detalle, no como chip visible arriba.
- **Análisis muy largo en móvil** (§17): el panel `#simAnalysis` (`gpi-wrap`) despliega todo (factores,
  Monte Carlo, goles, táctica, metodología) sin acordeones de priorización. Falta colapsar y priorizar
  Veredicto → Probabilidades → Δ V1/V2 → 3 factores → riesgos.
- **Fuentes internas**: revisar que el detalle no muestre nombres de datasets/proveedores (§2.2, §18). Los
  factores (forma/descanso/racha/solidez/plantilla/bajas) son genéricos — OK; verificar el copy fino.

## 5. Navegación: Más vs avatar (§26-28) — hallazgos

- **Bottom nav** (`BOTTOM` 182 = `arb, matches, teams, groups` + Más) — §27 lo mantiene durante el Mundial. ✓
- **Duplicación Más ↔ avatar** (§26):
  - Avatar menu (256-268): Simular, Invitar, Seguidos, Alertas, Aciertos, Evolución, Admin, Cerrar sesión.
  - Sheet "Más" (274-290): Simular, Seguidos, Alertas, Bracket, Aciertos, Evolución, Invitar, Admin, Cuenta,
    **Salir** (card grande) — duplica el logout del avatar.
  - → §26: avatar debe quedar en Cuenta/Preferencias/Privacidad/Logout; "Más" agrupado en Herramientas /
    Mi GP / Transparencia / Administración. Quitar la card grande de "Salir".
- **Sin grupo "Transparencia"** (§35-36): no hay acceso a Registro/Metodología desde un menú coherente
  (Registro existe como tab gated; Metodología no existe como pantalla).
- **Admin** (§28): se gatea por `USER.isAdmin` (server-side vía `/api/me`) ✓, pero aparece **triplicado**
  (topnav 194, avatar 267, sheet 284). Reducir duplicación.

## 6. Estados operativos y freshness (§21-22) — hallazgos

- **No hay componentes de estado reutilizables** (`FeatureDisabledState`, `NoDataState`, `StaleDataState`,
  etc., §21). Los empty states son ad-hoc e inconsistentes: "Sin discrepancias relevantes ahora mismo"
  (1217), "Los primeros resultados aparecerán…" (128). El mismo vacío se usa para "no hay datos" vs "función
  apagada" vs "provider ausente" — §21 lo prohíbe.
- **Freshness inconsistente** (§22): el tab Ejecutables tiene "validado hace Ns"; el resto no muestra
  freshness/última validación de forma uniforme.

## 7. Header / ticker / badge LIVE (§33-34) — hallazgos

- **`live-pill` "LIVE"** en el header (200) está **siempre verde**, sin reflejar si los providers están stale
  (§34). Debe poder mostrar "DATOS LIVE/MERCADOS LIVE" o degradar a "DATOS RETRASADOS".
- **Ticker** (`index.html:39`): "LIVE MARKETS · POLYMARKET" con `.tdot` verde fijo; sin estado stale (§33).

## 8. Alertas: defaults y organización (§23-24) — hallazgos

`ALERT_EVENTS` (356+), `evOn` (370: `e[k] !== false` → default ON):
- **Defaults hoy mayoritariamente ON** (nextMatch/result on). §23 pide defaults conservadores: inicio OFF,
  cambio fuerte OFF, nueva Value OFF, nuevo arb OFF; **email/Telegram OFF (opt-in)**; in-app ON; nueva Pick
  GP ON in-app. **Crítico**: aplicar nuevos defaults SOLO a usuarios nuevos/sin prefs (no sobrescribir).
- **Sin categorías** (Partidos / Mercado / Picks GP / Canales) ni quiet hours / timezone / "solo STRONG" /
  edge mínimo (§24). El backend de Sprint 8 (alerts/preferences) ya soporta esto pero la UI no lo expone.
- Mostrar SOLO opciones que el backend soporte (§24).

## 9. Seguidos (§25) — hallazgos

`renderFollowing` (307+): la meta de próximo partido (328 "Sin próximo partido programado" / formato
inline) puede truncar en una línea (§25 pide dos líneas + timezone del usuario). Falta diferenciar icono
de alertas activadas/parciales/desactivadas y un undo al dejar de seguir.

## 10. Responsive, safe areas, accesibilidad (§29-31) — hallazgos

- **Safe area parcial**: `#bottomnav` usa `env(safe-area-inset-bottom)` (style.css:459) y
  `body.has-bottomnav main { padding-bottom: 80px }` (470). Falta verificar vistas scrollables internas
  (detalle de partido, sheets, modales) a 320/360/375/390/430 px (§30).
- **Breakpoints** existentes: 430, 480, 560, 700, 760/761 px. No hay verificación explícita a 320/360/390.
- **Accesibilidad**: hay algunos `aria-label` (icon-btn, avatar). Faltan: roles de tabs, `aria-expanded` en
  acordeones (los `gpi-*` no los usan), focus visible consistente, switches accesibles, PASS/WATCH/LEAN/
  STRONG y ganada/perdida con **texto además de color** (§31), `prefers-reduced-motion` (el ticker no pausa).

## 11. Seguridad / DTOs públicos (§2.2, §39) — hallazgos

- La UI pública consume `/api/aciertos`, `/api/state`, `/api/arbitrage`, `/api/ticker`. Los endpoints de
  Sprints 5-8 (`/api/value/*`, `/api/picks`, `/api/signals`, `/api/metrics/*`) ya están sanitizados y gated
  (404 con flags off). **Verificar** que las nuevas vistas (Value/Picks/Registro/Metodología) no muestren
  source references internas, pesos, IDs internos ni proveedores de contexto (§2.2). Polymarket/Kalshi/
  sportsbook accionables SÍ pueden mostrarse cuando son el precio/deep link.

## 12. Conclusión y plan (orden de §56)

Estado de partida: la UI es sólida y los tabs avanzados ya existen pero inertes. 8.1 NO construye motores;
**reorganiza información, corrige copy y jerarquía, y añade estados/labels** — todo tras flags `UI_*`.

**Flags a crear** (default false): `UI_INTEGRATION_V2_ENABLED`, `UI_OPPORTUNITY_TABS_ENABLED`,
`UI_VERIFIED_PERFORMANCE_ENABLED`, `UI_GP_INTELLIGENCE_LABELS_ENABLED`, `UI_OPERATIONAL_STATES_ENABLED`,
`UI_NAVIGATION_CLEANUP_ENABLED`, `UI_ALERT_DEFAULTS_V2_ENABLED`. Expuestos en `getUser` como `uiFlags`.

**Orden de trabajo**: (1) flags + diccionario central de copy + DTO/estado; (2) separar conceptos
(legacy/verified, prematch/live, evaluación/Pick); (3) corregir copy (alpha, COMPRAR SÍ, Kelly) y navegación
(Más/avatar/Transparencia); (4) integrar Picks/Value/Arbitraje como tabs; (5) estados operativos + freshness;
(6) GP Intelligence labels + acordeones; (7) mobile/safe-area/a11y; (8) tests + visual regression. **STOP
antes de deploy.**

**Restricciones**: no tocar cálculos (Elo/V1/V2/Value/arb), señales, hashes, settlements, auth, SSE,
schedulers, billing; no activar sportsbooks/Value público/Picks público; no auto-publicación; legacy
preservado; sin afirmar alpha; sin pedir bankroll.
