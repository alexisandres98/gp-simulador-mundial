// metrics-engine/calibration.js — Sprint 6 §13. Reliability bins + ECE. Buckets vacíos NO se muestran como cero.
'use strict';

// reliability(points, opts) → { bins[], ece, n }
//   points: [{ p, y }] — p = probabilidad pronosticada en [0,1]; y = 1 si ese outcome ocurrió, 0 si no.
//   Para 1X2 se aportan 3 puntos por señal (home/draw/away) → calibración one-vs-all sobre todo el rango.
//   opts: { buckets } (equal-width). Preparado para equal-frequency a futuro.
function reliability(points, { buckets = 10, ci = null } = {}) {
  const pts = (points || []).filter(pt => Number.isFinite(pt.p) && (pt.y === 0 || pt.y === 1));
  const N = pts.length;
  const width = 1 / buckets;
  const acc = Array.from({ length: buckets }, () => ({ sumP: 0, sumY: 0, n: 0 }));
  for (const { p, y } of pts) {
    let idx = Math.floor(p / width);
    if (idx >= buckets) idx = buckets - 1; if (idx < 0) idx = 0; // p=1 cae en el último bucket
    acc[idx].sumP += p; acc[idx].sumY += y; acc[idx].n += 1;
  }
  const bins = [];
  let ece = 0;
  for (let i = 0; i < buckets; i++) {
    const b = acc[i];
    if (b.n === 0) continue; // bucket vacío: NO se muestra como cero
    const predicted_average = b.sumP / b.n;
    const observed_frequency = b.sumY / b.n;
    const absolute_gap = Math.abs(predicted_average - observed_frequency);
    ece += (b.n / N) * Math.abs(predicted_average - observed_frequency);
    const bin = {
      bucket_start: +(i * width).toFixed(6), bucket_end: +((i + 1) * width).toFixed(6),
      predicted_average: +predicted_average.toFixed(6), observed_frequency: +observed_frequency.toFixed(6),
      sample_size: b.n, absolute_gap: +absolute_gap.toFixed(6),
    };
    if (typeof ci === 'function') { const w = ci(b.sumY, b.n); bin.confidence_low = w.low; bin.confidence_high = w.high; }
    bins.push(bin);
  }
  return { bins, ece: N ? +ece.toFixed(6) : null, n: N, buckets, method: 'equal_width', version: 'ece_equal_width_v1' };
}

module.exports = { reliability, VERSION: 'ece_equal_width_v1' };
