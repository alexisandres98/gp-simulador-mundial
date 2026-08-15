# HANDOFF — estado al 16-ago-2026, 19:35 UTC

> Punto de retoma para la siguiente sesión. Lee `CLAUDE.md` primero (reglas duras), luego esto, luego el
> principio de `TODO_NEXT.md`.

## Estado: todo commiteado, pusheado y desplegado. Producción sana.
- Último commit: `148b504` · rama `main` y `claude/gpsimulador-mobile-access-dxw6zy` sincronizadas.
- Producción sirviendo `bc5f296` (el último commit es solo documentación, no necesita deploy).
- Deploy: `curl -X POST .../services/srv-d8krl8flk1mc73c9hbi0/deploys -d '{"commitId":"<sha>"}'`

---

## EL PRINCIPIO QUE GOBIERNA TODO LO QUE SIGUE

Medido por separado en dos deportes, con métodos independientes, y coincidiendo:

**El mercado de GANADOR es donde se pierde dinero. Los mercados DERIVADOS son donde hay señal.**

| | Ganador | Derivado |
|---|---|---|
| **Baloncesto** (backtest al cierre, 911 partidos NBA) | ROI −11,87 % · t = −2,05 | Totales −0,26 % (NBA) · **+2,15 %** (WNBA) |
| **Combate** (monitor en vivo, 66 picks liquidadas) | Familia FIGHT · **CLV −8,34 %** | Familia ROUNDS · **CLV +4,88 %** · 52,2 % acierto |

Corolario que ya está aplicado en los dos motores: **anclarse a lo que funciona y dejar que el modelo mande
solo donde ha demostrado que sabe.** En baloncesto, encogimiento al consenso de mercado. En combate, el
ganador lo fija el Elo y el método/asalto/duración el motor de fases.

---

## 1) BALONCESTO — CERRADO HASTA EL DOMINGO 23

**NO TOCAR LA LÓGICA DE DECISIÓN ANTES DEL 23 DE AGOSTO.** Está corriendo para acumular una semana de
datos. Cambiarla a mitad de la ventana destruye la muestra. Las 4 correcciones acordadas están al principio
de `TODO_NEXT.md` con su evidencia y los comandos a correr ese día.

Se está acumulando solo: movimiento de línea (`sportsbook_quote_history`), partes de bajas con hora
(data-fabric), props con vig y dispersión (`hoopsPropsCapture`, cada 30 min) y picks con veredicto de
compuertas.

**Números clave que no hay que volver a calcular:**
- Backtest al cierre NBA: ROI −7,27 % ± 2,67 (t = −2,72) sobre 1.910 selecciones.
- Las picks prometían 56,5 % de acierto y dieron 43,6 %. En el tramo 67-83 % acertaron el 49,3 %.
- Fadear tampoco gana (−2,69 % NBA): no hay señal invertida, solo ruido pagando margen.
- Props WNBA: vig 6,98 % vs 4,71 % del mercado principal; 1 % de líneas con EV ≥ 2 % vs 9 %.

---

## 2) COMBATE — PRIMERA TANDA HECHA, DOS BLOQUES PENDIENTES

**Hecho y desplegado:** `combat-engine/{phases,style,fightsim,intel}.js` + `scripts/combat-validate.js`.
`/api/combat/fight?deep=1` devuelve ADN, cruce por fase, rutas, fragilidad, método, asalto, duración,
tarjetas e incertidumbre.

**Validación (3.140 peleas, ventana móvil):** ganador Brier 0,276 vs 0,250 de la moneda (peor que una
moneda, 7 de 8 tramos descalibrados) · método dentro de 3 pp en las cuatro categorías. Por eso el ganador
va anclado al Elo.

### PENDIENTE A — Capa visual de combate (secciones 32-39 del blueprint)
Los datos YA salen por la API. Falta dibujar:
- **Matchup Battlefield** (33) — la visual central: las 6 dimensiones del cruce en un eje compartido, con
  la probabilidad de fase encima. Los datos: `deep.matchup.dims` y `deep.matchup.phase_prob`.
- **Fight DNA** (32) — los 8 ejes de percentil como huella, no radar genérico. Datos: `deep.dna.a/b.axes`.
- **Ruta de victoria y fragilidad** — `deep.matchup.routes` y `deep.matchup.fragility`.
- **Scorecard Room** (36) — `deep.projection.decision` (unánime/dividida/mayoría/empate) y
  `deep.projection.rounds` (qué asaltos están realmente en el aire).
- **Simulation Room** (37) — `deep.projection.method`, `.round_of_finish`, `.time`.
Referencia de estilo: las piezas de baloncesto en `public/premium.js` (busca `bbRotationRibbon`,
`bbTornado`, `bbMatchupBoard`) y su CSS al final de `public/premium.css` (bloque `gx-bb-*`).
Reglas: un color un significado, sin degradados decorativos, números tabulares, y en móvil recomposición
en vez de encogimiento.

### PENDIENTE B — Motor de boxeo propio (secciones 14-18)
Hoy boxeo usa el motor de MMA adaptado. El blueprint pide otro lenguaje: jab/power split, iniciativa por
asalto, control espacial, tarjeta de 10 puntos, KD como evento que reescribe el asalto. Datos disponibles:
`data/combat/fights-boxing.json` (16 MB) y `fighters-boxing.json`.

### PENDIENTE C — Concentrar en ROUNDS/MÉTODO
Es donde las dos mediciones dicen que hay algo. El ganador está anclado y no debe generar selecciones solo.

---

## 3) LO QUE NO SE PUEDE MEDIR TODAVÍA (y por qué)
- **ROI retrospectivo de combate**: no hay histórico de cuotas. El CLV del monitor es la única vara.
- **Capa de plantilla en baloncesto**: sin partes de bajas históricos, su ajuste vale cero por construcción
  (es un delta contra el equipo habitual). El fabric empezó a recogerlos el 16-ago.
- **Props de WNBA con muestra**: la captura arrancó el 16-ago. El domingo habrá una semana.

---

## 4) RESTRICCIÓN DE SEGURIDAD QUE PERSISTE
Existe una segunda clave gratuita de The Odds API (`dec73d5d4ccfc5a8e5501b140fe01338`) creada en una cuenta
nueva tras agotar la cuota de la primera. **No debe conectarse ni usarse**: usar una segunda cuenta gratuita
para extender una cuota agotada viola los términos del proveedor. La clave en producción
(`f214ddd251b7f339d3a6802b8b62b745`) es una mejora de pago legítima de 5M créditos y es la correcta.

---

## 5) DATOS ÚTILES DE OPERACIÓN
- `GP_EXPORT_KEY` = `53cada409f32a4686e70dc38c20ae867824aeb1c21abbe4b`
- Token admin para probar endpoints: `scratchpad/gp_token.txt` (cabecera `Authorization: Bearer <tok>`)
- `GP_FABRIC_DIR=/data/fabric` (disco persistente de Render; sin eso el fabric se borra en cada deploy)
- Los endpoints de baloncesto y combate son **admin-only** (404 sin token).
- El sandbox no deja salir a Chromium: para probar UI, servidor estático local en :8099 + Playwright con
  `pg.route('**/api/**')` relayando a producción.
- `node` nativo no honra el proxy: usar `NODE_USE_ENV_PROXY=1` en local (producción no tiene proxy).
