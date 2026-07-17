// pick-engine/efficiency.js — Detector de EFICIENCIA de mercado (régimen dual, 17-jul).
// Regla de producto (Alexis, validada con el backtest del historial del Mundial: ancla 67%/+19%,
// acuerdo moderado 73%/+37%, "edge fuerte" >7pp 59%/+11%; Brier mercado 0.220 < modelo 0.222):
//   · mercado EFICIENTE → modo ANCLA: el consenso manda, el modelo solo confirma; el ROI sale del
//     line shopping (mejor cuota entre casas ≥ justa del consenso).
//   · mercado BLANDO → modo EDGE: exigir divergencia de PRECIO real multi-casa (no divergencia del
//     modelo, que en mercados eficientes suele ser error del modelo).
// PURO: sin DB, sin red. La señal primaria es la PROFUNDIDAD (nº de casas); la DISPERSIÓN de precios
// entre casas refina cuando existe (CV de la probabilidad implícita del mismo lado).
'use strict';

// prices: cuotas decimales del MISMO lado en casas distintas (opcional). books: nº de casas del lado.
function marketEfficiency({ books = 0, prices = null } = {}) {
  let dispersion = null;
  if (Array.isArray(prices) && prices.length >= 2) {
    const ps = prices.filter(o => Number(o) > 1).map(o => 1 / Number(o));
    if (ps.length >= 2) {
      const mean = ps.reduce((a, b) => a + b, 0) / ps.length;
      const sd = Math.sqrt(ps.reduce((s, p) => s + (p - mean) ** 2, 0) / ps.length);
      dispersion = mean > 0 ? +(sd / mean).toFixed(4) : null; // CV de prob implícita entre casas
    }
  }
  // eficiente: mercado profundo (≥4 casas) con precios apretados (CV < 5%) → el precio ES la información.
  // blando: fino (≤2 casas) o precios sueltos (CV ≥ 8%) → hay ineficiencia que cazar (modo EDGE).
  let regime = 'mixed';
  const b = Number(books) || 0;
  if (b >= 4 && (dispersion == null || dispersion < 0.05)) regime = 'efficient';
  else if (b <= 2 || (dispersion != null && dispersion >= 0.08)) regime = 'soft';
  return { regime, books: b, dispersion };
}

module.exports = { marketEfficiency };
