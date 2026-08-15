# HANDOFF — estado al 16-ago-2026 (capa visual de combate + motor de boxeo)

> Punto de retoma para la siguiente sesión. Lee `CLAUDE.md` primero (reglas duras), luego esto, luego el
> principio de `TODO_NEXT.md`.

## Estado: fusionado a `main`, desplegado y verificado en producción.
- `origin/main` = **`117ccb7`** · deploy `dep-da0crhtbedkc73ag12t0` en **live** sirviendo ese commit.
- **Ojo con el `main` LOCAL de una sesión nueva:** el contenedor clona con profundidad 50, así que el `main`
  local puede ser una ventana vieja del histórico y `git merge` responde *"refusing to merge unrelated
  histories"*. No es un conflicto real. La verdad está en `origin/main`: comprobar con
  `git merge-base --is-ancestor origin/main <rama>` y empujar con
  `git push origin <rama>:main`, que es un avance rápido limpio.

### Verificado EN PRODUCCIÓN (no en local)
- MMA, cartelera de UFC 330: las cuatro peleas probadas devuelven `deep.available: true` con el contrato
  nuevo (`sport`, `axes`, `phase_strip`) — **sin regresión**. Endpoint completo entre 419 y 1.374 ms.
- La app real (el `premium.js` que sirve producción, contra la API de producción) pinta **las cinco piezas**
  a 1.280 px y a 390 px, sin desbordes y sin un solo error de JS.
- El caso sin datos también se ve bien: la pelea de boxeo de esta noche muestra el panel de respaldo con su
  motivo, no un hueco.

### ⚠️ EL LÍMITE REAL DE BOXEO NO ES EL MOTOR, ES LA COBERTURA DEL DATASET
Las **tres** peleas de la cartelera de boxeo del 15-ago dan `available:false`, y no es un fallo de
identificadores: de los seis boxeadores, **cinco tienen CERO peleas en `fights-boxing.json`** (Angulo sí:
30 peleas, perfilado sin problema). El motor carga bien (2.767 perfiles, 144 ms). El dataset viene de
Wikipedia y cubre a los conocidos, no las carteleras de club que trae la agenda de The Odds API.
En la propia validación se ve el mismo sesgo: de 12.966 peleas candidatas, 8.667 se descartan porque a uno
de los dos le falta perfil.
**Próximo paso natural para que boxeo rinda: ampliar `fights-boxing.json` hacia BoxRec/prospectos**, no
tocar el motor.

### Observación para la próxima sesión (MMA, preexistente, NO tocado)
La capa visual saca a la luz una rareza que ya estaba en `style.js`: la ruta de Makhachev sale como "Control
en el suelo" con ventaja saturada en 1,00 y la nota *"su mejor ventaja vive en una fase a la que la pelea
probablemente no llegue"* con el suelo al 22 %. El umbral de esa nota (0,4) se pensó para otra escala. En
`boxing.js` ya está corregido (la nota solo salta en el tramo profundo y por debajo de 0,28). Igualar el
criterio en MMA es un cambio de una línea, pero mueve texto que hoy ve el usuario: hacerlo a conciencia,
no de paso.

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

### ✅ HECHO A — Capa visual de combate (secciones 32-39)
Cinco piezas en `public/premium.js` (`cbDeepField`, `cbDeepDna`, `cbDeepRoutes`, `cbDeepCards`, `cbDeepSim`,
envueltas por `cbDeepSection`) + su CSS al final de `public/premium.css` (bloque `gx-cbf/cbd/cbr/cbs/cbsim`).
Van en el cockpit **después de la lectura y antes de las tablas de referencia**: es lo que la gente viene a
buscar, no un apéndice.

**Sirven para los DOS deportes con el mismo código.** El contrato lo pone el payload
(`deep.axes`, `deep.phases`, `deep.phase_strip`, `matchup.dims`, `routes`, `fragility`, `projection`) y la UI
no tiene ninguna lista de ejes escrita a mano.

Cuatro decisiones de diseño que se tomaron **mirando el render, no en abstracto** (banco de pruebas:
Playwright + el `premium.css` real, 820 px y 390 px):
- **El histograma de asalto de finalización va en su propia escala.** Con "llega al límite" (57 %) como una
  columna más, los doce asaltos que importan (2-5 % cada uno) quedaban aplastados y no se distinguía R2 de
  R9. El total al límite se dice en una línea debajo.
- **La tabla de totales muestra solo las 6 líneas alrededor de la mediana.** Un combate a 12 genera once, y
  "más de 1,5 asaltos al 97 %" no lo cuelga ninguna casa.
- **Un asalto sin dueño se pinta GRIS, no ámbar.** La primera versión marcaba en ámbar todo asalto a menos
  de 8 pp del 50 % y en una pelea pareja salían 10 de 12: un muro ámbar no dice "esto está en el aire".
- **La incertidumbre se publica en cuota, no en "pp".** La parte aleatoria es la desviación de un Bernoulli
  y en cualquier pelea pareja vale ~50 → salía un "±46 pp" que asusta sin informar. Se publica el reparto en
  porcentaje y la parte epistémica en puntos con sus causas, que es lo único que baja con más datos.

### ✅ HECHO B — Motor de boxeo propio (secciones 14-18)
`combat-engine/boxing.js` + `scripts/boxing-validate.js`. Entra por la misma puerta (`intel.js` despacha por
deporte) y el endpoint lo usa con `org=boxing`.

**Lo primero que había que saber, y no era lo que creíamos:** boxeo no estaba "usando el motor de MMA
adaptado" — **no tenía capa profunda en absoluto.** `intel.js` buscaba `espnstats-boxing.json`, ese archivo
NO EXISTE (ESPN no publica estadística de boxeo), `buildProfiles` producía **0 perfiles** y `fightIntel`
devolvía `available:false` para toda pelea de boxeo. Verificado ejecutando el camino que corre hoy en
producción. Ahora produce 2.767 perfiles.

**Lo que el dato de boxeo tiene:** asaltos pactados, asalto y reloj de final, método (KO/TKO/RTD/UD/SD/MD/
PTS/TD), ganador; y por peleador alcance, altura, guardia, nacimiento, récord. **NO hay conteo de golpes.**
El "jab/power split" que pide el blueprint no puede salir de CompuBox porque no tenemos CompuBox: se publica
como un eje de **cuándo se resuelve la pelea**, con su procedencia escrita en el propio payload (`no_data`).

**Validación fuera de muestra — 2.768 peleas desde 2017, ventana móvil por bloques:**

| | Predicho | Real | |
|---|---|---|---|
| **¿Se rompe la pelea?** | 50,5 % | 51,1 % | **AUC 0,694** · Brier 0,221 vs 0,250 · deciles monótonos (24/22 → 82/81) |
| **¿Cuándo?** | asalto 5,11 | 5,30 | corr 0,43 · "antes del 4º" 38,6/34,5 (AUC 0,685) |
| KO | 16,3 % | 17,1 % | |
| TKO | 30,0 % | 29,4 % | |
| Retirada (RTD) | 4,2 % | 4,7 % | |
| Decisión | 47,2 % | 48,9 % | |
| Empate | 2,27 % | 1,77 % | |
| Dividida/mayoritaria | 15,1 % | 17,8 % | de las decisiones |

**⚠️ UNA MEDICIÓN QUE CONTRADICE LO QUE ESPERÁBAMOS.** En MMA el motor de fases salió PEOR que una moneda
para el ganador (Brier 0,276 vs 0,250) y ese fue el argumento del anclaje. **En boxeo no pasa:** Brier
**0,204 vs 0,250**, 67,2 % de acierto, y no es un artefacto del orden (f1 gana el 49,3 % en el archivo).
Se ancla igual, por otras dos razones: (a) el principio medido en dos deportes dice que el mercado de
ganador es donde se pierde dinero, discrimine o no el modelo; (b) 3 de 8 tramos siguen descalibrados
(ECE 3,79 pp) — distingue, pero sus números aún no están para poner precio.
**Si algún día hay histórico de cuotas de boxeo, esta es la primera hipótesis que merece una prueba real.**

**Lo que se DESCARTÓ con su medición:** la guardia (zurdo/diestro). Hay dato para 1.296 de 1.406 peleadores
del índice, pero en peleas desde 2018 **los dos** tienen guardia conocida solo el **19,5 %** de las veces.
Una dimensión que falta en 4 de cada 5 cruces no puede ser una dimensión del cruce: se muestra como dato,
no toca la probabilidad.

**La única constante libre (`KAPPA_FIN = 0,50`) está ajustada contra la tasa real de finalización**, no a
ojo. La primera versión, con los multiplicadores de fatiga y daño apilados sobre el peligro base, predecía
**69,7 % de finalización contra un 51 % real** — el peligro ahora va anclado a la tasa medida de la liga
(0,0527 por lado y asalto) en forma ataque × defensa.

**⚠️ SIN DESPLEGAR.** Todo esto está en la rama `claude/gpsim-combat-visual-boxing-276pin`, no en `main`.
Producción sigue sirviendo `bc5f296`.

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
