# PLAN DE ESCALADO DE BANCO — GP Simulador · ejecutor real

> Escrito el 28-ago-2026 para la revisión del domingo 31. Los números vienen del libro real
> (`/api/internal/real`), de la sombra (`/api/internal/shadow`) y del track de CS2
> (`/api/internal/esports?track=cs2`) — nada estimado a ojo. Este documento se revisa CADA domingo:
> los hitos no se adelantan por una buena racha ni se atrasan por una mala; se cruzan con muestra.

## 1. Dónde estamos (foto del 28-ago)

| Registro | Muestra | Resultado | La vara (CLV) |
|---|---|---|---|
| Papel · cards_under_v1 (desde 12-ago) | 77 liquidadas | +45.1% ROI | +0.55% (n=54) |
| Papel · cs2_rounds_v1 (desde 24-ago) | 44 liquidadas | −5.1% ROI | **+2.65% (n=41)** |
| CS2 por casa (track completo) | Pinnacle n=95 | +20.8u | **+2.7% (n=75)** |
| | Cloudbet n=62 | −8.3u | +4.9% (pero ROI plano) |
| **DINERO REAL (desde 25-ago)** | **25 liquidadas** | **−60.32 USDT (−14.9%)** | slippage −0.23% medio |

**La lectura honesta:** el papel promete y el dinero real, con 25 liquidadas, va rojo. Con esta
muestra el ROI real es ruido (±30% de banda), pero la regla de la casa aplica igual hacia arriba y
hacia abajo: **no se escala nada hasta que el dinero real confirme al papel.** Lo que sí está
medido y es sólido: el slippage real es −0.23% (excelente — el precio del papel se consigue), la
casa no nos recorta stakes (0 recortes por tope), y la divergencia papel-vs-dinero se audita sola
cada 24h.

## 2. Los tres carriles y su techo físico

| Carril | Casa | Techo por apuesta | Estado |
|---|---|---|---|
| Cards under · automático | Cloudbet | >1,000 USDT (la casa no limita) | Esperando API; mientras, manual |
| CS2 rondas · manual/auto | Cloudbet | **~20 USDT (techo de la casa)** | Manual por correo; gemelo auto EN ENSAYO desde hoy |
| CS2 rondas · manual | Pinnacle | 1,200–1,600 USD | Decisión el domingo 31 |

El techo de 20 en Cloudbet-CS2 no es un problema: **es la explicación de por qué el edge existe**
(nadie profesional puede explotarlo a escala). El carril de escalado real es Pinnacle.

## 3. Hitos de evidencia → nocional

El nocional (banco de cálculo del stake Kelly/4, tope 1.5%) solo sube al cruzar CADA condición del
hito. Bajar es automático; subir es decisión de domingo.

**HITO 0 — hoy: nocional $2,000.** Sin cambios hasta que el dinero real salga del rojo o llegue a
muestra. Nada de subir stakes "porque el papel va bien".

**HITO 1 — dinero real con muestra (esperado ~2-3 semanas):**
- ≥100 apuestas reales liquidadas, Y
- ROI real > 0 en la ventana completa, Y
- slippage medio ≥ −1%, Y
- la divergencia papel-vs-dinero explicada (mismas señales, mismos resultados ±ruido).
→ **nocional $4,000** (stakes ~$60 tope). Si a las 100 liquidadas el ROI real sigue negativo con el
papel positivo, la prioridad NO es escalar: es encontrar la fuga (selección de horario, líneas
muertas, sesgo de ejecución) antes de poner un dólar más.

**HITO 2 — domingo 31 (decisión ya agendada): carril Pinnacle CS2.**
- La evidencia ya existe (CLV +2.7% con n=75 en Pinnacle, t≈3).
- Si se aprueba: arranca con stakes $15–30, registro separado (`cs2_pinnacle_manual`), y NO cuenta
  para el Hito 1 (muestra aparte, casa aparte).
- Su propio hito: 50 liquidadas con CLV real ≥ +1.5% → stakes al 1% del nocional.

**HITO 3 — desbloqueo de la API de Cloudbet (fecha externa):**
- Cards under pasa a automático puro (el circuito ya corre en dry desde el 12-ago).
- CS2-Cloudbet: el gemelo EN ENSAYO (desde hoy) ya arma cada colocación completa con el precio
  vivo y el techo de 20; encenderlo es UNA env (`GP_REAL_CS2_AUTO=true`). Primera semana con tope
  de exposición $200 y revisión diaria.

**HITO 4 — 30 días de dinero real positivo:**
- ROI real > 0 sostenido 30 días, Y CLV real ≥ +1% en cards, Y sin parada diaria disparada 2 veces.
→ **nocional $8,000** y saldo en casa acorde (mínimo 25% del nocional líquido por casa).

**HITO 5 — el objetivo de $4,000/mes:**
Con los edges medidos hoy (cards CLV-implícito 2–4% de ROI sostenible; CS2-Pinnacle 3–5%), el
volumen actual (~6 cards/día + ~8 CS2/día) da:

| Nocional | Volumen mensual | ROI conservador 2.5% | ROI medido esta quincena |
|---|---|---|---|
| $2,000 | ~$8,000 | $200/mes | $500-900/mes |
| $4,000 | ~$16,000 | $400/mes | $1,000-1,800/mes |
| $8,000 | ~$32,000 | $800/mes | $2,000-3,600/mes |
| $15,000 + Pinnacle 1% | ~$60,000 | **$1,500/mes** | **$4,000-7,000/mes** |

El escenario del objetivo exige el nocional de $15k, que queda a DOS hitos de evidencia (4 y 5) —
en tiempo: 2-4 meses si el dinero real confirma al papel. El caso conservador (columna CLV) es la
promesa honesta; la columna derecha es lo que la quincena de agosto anualizada diría, y esa cifra
NO se usa para decidir.

## 4. Reglas de bajada (automáticas, sin discusión de domingo)

- **Drawdown del 15% del nocional** desde el máximo → nocional a la mitad hasta recuperar.
- **CLV real 30 días < 0** en una familia → esa familia vuelve a sombra (papel), sin dinero.
- **Parada diaria** (−6% del nocional en el día) → ya existe y frenó bien; no se relaja al escalar.
- **Saldo en casa < 25% del nocional** → se repone antes de la siguiente apuesta o se baja el
  nocional a 4× el saldo. (Hoy: saldo 66 USDT con nocional 2,000 — el primer incumplimiento es
  NUESTRO: reponer saldo es previo a cualquier otra decisión del domingo.)

## 5. Capacidad (los límites físicos del plan)

- Cards under en Cloudbet: sin techo de casa observado; el límite es el volumen de señales (~5-6/día).
- CS2 Cloudbet: techo 20/apuesta × ~8/día ≈ $160/día máximo — carril de registro, no de escala.
- CS2 Pinnacle: techo 1,200-1,600/apuesta — la capacidad excede el plan entero; el límite es
  nuestro stake por doctrina, no la casa.
- Riesgo de cuenta: Cloudbet ya nos capó CS2 a mano; si capa cards tras escalar, el plan salta a
  ejecución repartida (Pinnacle para lo que cotice, y el excedente queda en papel — nunca se
  persigue el volumen degradando el precio).
