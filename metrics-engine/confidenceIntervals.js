// metrics-engine/confidenceIntervals.js — Sprint 6 §22. Wilson (hit rate) + bootstrap reproducible (sin Math.random).
'use strict';
const cfg = require('./config');

// LCG determinístico sembrado → bootstrap reproducible.
function lcg(seed) { let s = (seed >>> 0) || 1; return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; }; }

// wilson(successes, n, z) → { point, low, high }
function wilson(successes, n, z = 1.96) {
  if (!n) return { point: null, low: null, high: null, n: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return { point: +p.toFixed(6), low: +Math.max(0, center - margin).toFixed(6), high: +Math.min(1, center + margin).toFixed(6), n };
}

// bootstrapMean(values, opts) → { point, low, high, n, iterations }  (percentiles 2.5/97.5, seed reproducible)
function bootstrapMean(values, { iterations = cfg.params.bootstrapIterations, seed = cfg.params.bootstrapSeed, lo = 0.025, hi = 0.975 } = {}) {
  const xs = (values || []).filter(v => Number.isFinite(v));
  const n = xs.length;
  if (!n) return { point: null, low: null, high: null, n: 0, iterations };
  const point = xs.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { point: +point.toFixed(8), low: +point.toFixed(8), high: +point.toFixed(8), n, iterations };
  const rand = lcg(seed);
  const means = new Array(iterations);
  for (let it = 0; it < iterations; it++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += xs[Math.floor(rand() * n)];
    means[it] = sum / n;
  }
  means.sort((a, b) => a - b);
  const q = f => means[Math.min(iterations - 1, Math.max(0, Math.floor(f * iterations)))];
  return { point: +point.toFixed(8), low: +q(lo).toFixed(8), high: +q(hi).toFixed(8), n, iterations };
}

module.exports = { wilson, bootstrapMean, lcg };
