# DESIGN_SYSTEM.md — GP Simulador

Objetivo visual: **terminal financiera deportiva premium** (Bloomberg/TradingView para mercados deportivos). Dark mode elegante, acento verde usado con moderación. NO casino, NO tipster, NO "dashboard AI generated". Mobile-first.

Todo el CSS vive en `public/style.css` (`:root` al inicio). El rediseño aprobado (Fases 1,2,3,5) ya está aplicado.

## Tokens de color (`:root` en style.css)
```
--bg: #050807;            --bg-app: #070B0D;       --bg-elevated: #0B1113;
--card: #101719;          --card2: #131B1E;        --bg-muted: #182124;
--border-subtle: rgba(255,255,255,.06);  --border: rgba(255,255,255,.10);  --border-strong: rgba(255,255,255,.16);
--border-green: rgba(24,230,163,.35);
--text: #F4F7F8;  --dim: #A1ADB5;  --muted: #6F7A82;  --faint: #465159;
--accent: #18E6A3 (verde principal);  --accent-dark: #18E6A3;  --accent-soft: rgba(24,230,163,.10);  --green-soft: #0FAF78;
--ink-on-accent: #04140D (texto sobre verde);
--blue: #4DA3FF (modelo);  --amber: #F6C85F (arbitraje/warnings);  --red: #FF6B6B (caída/riesgo);  --orange: #FF9F43;  --purple: #A78BFA;
--shadow: 0 2px 8px rgba(0,0,0,.30);  --shadow-lg: 0 16px 40px rgba(0,0,0,.42);
--radius: 18px;  --radius-md: 14px;  --radius-sm: 12px;
--font-head/--font-body: 'Inter';   --mono: 'JetBrains Mono';
```
- Fondo global: `radial-gradient(900px 520px at 75% -8%, rgba(24,230,163,.06), transparent 42%)` sobre `--bg`. Glow **muy sutil** (evitar glow fuerte).
- `font-variant-numeric: tabular-nums` global + `--mono` para todos los números/cuotas/%/scores.

## Tipografía
- Inter (400-900) + JetBrains Mono (500/600), vía Google Fonts en index.html.
- H1 ~24px/700, H2 ~17px/700, card title ~16px/650, body 14px, micro-label 10px/700 uppercase letter-spacing .12em.
- Números grandes/medianos en `--mono`, weight 700, tabular.

## Layout / shell
- **Header (`#hdr`)**: 64px, sticky top, `rgba(5,8,7,.88)` + blur. Izq: badge "GP" + "GP Simulador" / "Simulador del Mundial". Der (`#hdRight`): logged-in = pill `● LIVE` + campana + avatar circular; logged-out = botón "Crear cuenta gratis". **Nunca mostrar el email en el header** (va en el menú avatar).
- **Market tape (`.tape`)**: cinta financiera sticky bajo el header (top:64px). Label "LIVE MARKETS · POLYMARKET" (opaco, z-index 2) + `.tape-vp` (viewport overflow hidden) + `.tape-track` (scroll marquee 55s). Items `.tk`: flag + nombre + precio mono + cambio (verde/rojo/gris). Visible logged-in y logged-out.
- **Sub-nav (`#topnav`)**: barra de pestañas bajo el tape. Desktop: siempre. Móvil: solo logged-out. Botón activo en verde (`.accent-soft`).
- **Bottom nav (`#bottomnav`)**: móvil logged-in. Fixed bottom, blur, íconos SVG lineales. Items: Oportunidades, Partidos, Equipos, Grupos, Más. Activo verde. `body.has-bottomnav main { padding-bottom:80px }`.
- **Menú avatar (`.avmenu`)**: dropdown flotante opaco (#0B1113). Email + plan (FREE/ADMIN) + Mis seguidos, Alertas, Aciertos, Evolución, Admin(si), Cerrar sesión (rojo).
- **Sheet "Más" (`.sheet`)**: bottom sheet móvil con grid de accesos (Seguidos, Alertas, Bracket, Aciertos, Evolución, Admin, Cuenta, Salir).
- `main`: max-width 1180px, centrado, padding 22px 20px 40px.
- **Body classes:** `logged-in`, `has-bottomnav` (toggle en `renderHeader`).

## Componentes clave (clases CSS)
- **Cards genéricas**: `.tcard` (equipo), `.gcard` (grupo viejo), fondo `--card`, border subtle, radius, shadow.
- **Sección**: `.sec-head` (h3 + .sub a la derecha). Dots: `.dot-amber`, `.dot-green`.
- **Featured "Mejor oportunidad"**: `.feat` (radial verde sutil + border-green), `.feat-top` (badge `.sig`/`.sig-edge`/`.sig-arb` + `.feat-edge`), `.feat-team`, `.feat-metrics` (grid de `.metric` con `.m-l`/`.m-v`, colores `.blue`/`.green`/`.r-low`/`.r-mid`/`.r-high`), `.feat-cta` (venue-btn + `.btn-ghost`).
- **Arbitraje puro**: `.dualcard` (tinte ámbar oscuro, `--amber`), `.purebadge`, `.edge-big`, `.dual-btns` con `.venue-btn.v-poly` (azul) / `.v-kalshi` (verde).
- **Apuestas de valor**: `.mktcard` (clicable a mercado), `.mkt-top` (venueChip + chgBadge + ext), `.mkt-team` + `.sidetag`, `.mkt-prices` (Precio/Modelo/Edge), `.mkt-stats` (vol/liq/kelly/share).
- **GP Take (match)**: `.matchmkt` con `.gptake` (`.grade` `.g-strong`/`.g-lean`/`.g-slight`/`.g-pass`) + `.oc-row` (1X2: label/mercado/modelo/edge, `.oc-edge` resalta valor).
- **Partido (calendario)**: `.mcard` (side/score/side + `.pbar` 1X2). [diseño viejo, pendiente Fase 4]
- **Grupos**: `.gchips`/`.gchip` (selector A-L), `.grp-tbl` con heatmap inline (helper `heat(p,'g'|'a'|'r')`), `.grp-legend`.
- **Bracket**: `.bracket` (flex scroll), `.bround` (justify space-around → escalonado), `.bmatch`, `.bround.fin` (final con trofeo).
- **Aciertos**: `.statrow`/`.bigstat`, `.explain` (caja contextual borde azul), `.rec-list`/`.rec-row` (`.rec-dot.ok`/`.no` sobrio, NO X gigantes), `.exact-tag`.
- **Evolución**: `.evo-chart` (canvas dark), `#evoLegend`, tabla `.fav-tbl`.
- **Seguidos**: `.follow-list`/`.follow-card` (flag, nombre, meta, prob, cambio, `.fc-bell` campana, `.fc-x`).
- **Alertas**: `.alert-group`/`.alert-row` (ic + texto + `.toggle`), `.soon-tag` ("PRÓXIMAMENTE"), `.toggle`/`.knob` (switch verde 48x28).
- **Tabla compacta reutilizable**: `.fav-tbl` (favoritos, evolución).
- **Locked state premium**: `.lock` (`.lock-icon` caja, `.lock-title`, `.lock-sub`, `.lock-micro`). Copy: "Desbloquea esta sección gratis · Crear cuenta gratis · Sin contraseña · solo tu email".
- **Botones**: `.btn` (verde sólido), `.cta-sm` (CTA header verde), `.ghost` (verde), `.btn-ghost` (outline). Toggles `.toggle.on`.
- **Badges de cambio**: `chgBadge()` → `.chg`/`.tkc` up(verde)/down(rojo)/flat(gris).

## Helpers JS de formato (app.js)
`pct()`, `cents()` (¢), `fmtUsd()` (K/M), `chgBadge()`, `venueChip()`, `fmtKickoff()`, `liqLabel()`, `riskLabel()`, `confLabel()`, `heat()`, `gradeEdge()`, `buildMatchTake()`.

## Navegación (app.js)
- `TABS` = registro de pestañas. `ICON` = SVGs lineales. `switchTab(name)` = único punto de cambio de pestaña (sincroniza top/bottom nav, lazy-render por pestaña, cierra menús). `renderHeader()` reconstruye header/topnav/bottomnav/hdRight según USER.
- Home logged-in por defecto = `arb` (Oportunidades). Home logged-out = `teams` (hero).
- `renderAll()` llama a todos los render; teaser → `renderTeaser()`.

## Responsive
- Breakpoint principal: `@media (max-width:760px)` → oculta `#topnav` si logged-in, muestra bottom nav, oculta `.brand-tag`. `@media (min-width:761px)` → oculta bottom nav.
- Cards en grid responsivo (`.mktgrid`, `.feat-metrics` auto-fit minmax). Tablas con scroll horizontal en móvil. `.statrow` auto-fit minmax(150px) → 2x2 en móvil.
- Botones/targets ≥40px en móvil. Safe-area en bottom nav y sheets.

## Microcopy / tono (aprobado)
Usar: Oportunidad, Model Edge, Pure Arb, Market Mover, GP Take, Confianza, Liquidez, Execution/Settlement Risk, Probabilidad modelo, Precio mercado, Edge estimado, Pass/Watch/Lean/Strong, "Retorno neto estimado". Evitar: apuesta segura, pick seguro, dinero gratis, ganancia garantizada (salvo arbitraje, con disclaimers). Footer/disclaimer siempre: "Las probabilidades son estimaciones de un modelo estadístico. No es consejo financiero ni recomendación de apuesta."

## Lo que se evita (NO hacer)
Glow excesivo · botones verdes gigantes por todas partes · muchas cards iguales · texto largo tipo ChatGPT · email grande en header · nav horizontal larguísima logged-in · look template Tailwind genérico · look casino/tipster.
