# ⚽ Simulador Mundial 2026 — Monte Carlo + Arbitraje

Sistema de probabilidades del Mundial 2026 (48 equipos, formato real FIFA) con:

- **Modelo Elo → goles Poisson → 10,000 torneos Monte Carlo** por recálculo
- **Login con email** (código de verificación de 6 dígitos)
- **Probabilidades en tiempo real**: al registrar un resultado (final o en vivo con minuto),
  el Elo se actualiza (reglas de eloratings.net, K=60) y las 10,000 simulaciones se
  recalculan y se envían por SSE a todos los navegadores conectados.
- **Arbitraje en vivo contra Polymarket y Kalshi** (APIs públicas, refresco cada 5 min):
  apuestas de valor (modelo vs precio) y arbitraje puro entre plataformas, con Kelly/4 sugerido.
- Explicación en español de la probabilidad de cada equipo (Elo, dificultad de grupo, cruces probables, IC 95%).
- Grupos con prob. de 1º/2º/3º clasificado/eliminado, partidos con 1X2 + xG + marcador más probable,
  bracket oficial completo (16avos → final), gráfico de evolución de probabilidades, favoritos por usuario.

## Ejecutar

```bash
node server.js          # http://localhost:3000  (Node >= 18, sin dependencias)
SIMS=20000 node server.js   # más precisión
```

## Roles

- **El primer email que se registra es el administrador** (o define `ADMIN_EMAILS=a@b.com,c@d.com`).
- El admin registra resultados en la pestaña **Admin**: fase de grupos por ID (GA1…GL6) y
  eliminatorias (P73–P104) eligiendo los equipos. Status `live` + minuto condiciona la simulación
  al marcador actual; `final` fija el resultado y actualiza Elo.
- Sin SMTP configurado el código de login se muestra en pantalla (modo demo) y en la consola del servidor.

## Modelo

1. Elo efectivo = Elo actual + 75 si es anfitrión (USA/México/Canadá) + ruido N(0,55) por torneo
   simulado (incertidumbre de forma).
2. Expectativa Elo → tasas de gol Poisson de cada lado (media conjunta ~2.6 goles).
3. Fase de grupos completa (puntos, DG, GF), mejores 8 terceros asignados a slots del bracket
   oficial por backtracking, eliminatorias con prórroga/penales (ligera ventaja al mejor Elo).
4. Resultados reales fijan partidos; los Elo se recalculan desde la base replicando todos los
   resultados finales (editar/borrar un resultado nunca corrompe los ratings).

Datos base: Elo de eloratings.net al 8-jun-2026, grupos y bracket oficiales FIFA.

> ⚠️ Las oportunidades de arbitraje son estimaciones de un modelo, no consejo financiero.
> Kalshi cobra ~7%·p·(1−p) por contrato y Polymarket tiene spread; edges < 2-3% rara vez son rentables.
