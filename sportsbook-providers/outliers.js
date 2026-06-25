// sportsbook-providers/outliers.js — Post-shadow Bloque I. Detector de OUTLIERS SEMÁNTICOS (no solo dispersión
// estadística). Orden del spec: validación semántica → completeness → source → outlier. Un set cuya prob
// implícita es incompatible con la mediana (sobre todo el patrón de INVERSIÓN home↔away del caso Bosnia) se
// clasifica como data_error/mapping_error/market_mismatch/unresolved. Mientras esté sin resolver: se EXCLUYE
// del consenso, NO se muestra y BLOQUEA STRONG. El filtro es robusto pero NO oculta errores semánticos.
'use strict';

function impliedFromSet(s) {
  return { home: 1 / s.quotes.home.odds, draw: 1 / s.quotes.draw.odds, away: 1 / s.quotes.away.odds };
}
function median(a) { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

// detectOutliers(sets, opts) → { clean, outliers, median, hasUnresolved }
function detectOutliers(sets, { invThreshold = 0.25, devThreshold = 0.30 } = {}) {
  if (!sets || sets.length < 2) return { clean: sets || [], outliers: [], median: null, hasUnresolved: false };
  const ips = sets.map(impliedFromSet);
  const med = { home: median(ips.map(i => i.home)), draw: median(ips.map(i => i.draw)), away: median(ips.map(i => i.away)) };
  const clean = [], outliers = [];
  sets.forEach((set, idx) => {
    const ip = ips[idx];
    const dh = ip.home - med.home, dd = ip.draw - med.draw, da = ip.away - med.away;
    // INVERSIÓN home↔away (caso Bosnia): home y away se desvían fuerte en sentidos opuestos.
    if (Math.abs(dh) > invThreshold && Math.abs(da) > invThreshold && Math.sign(dh) !== Math.sign(da)) {
      outliers.push({ sportsbook: set.sportsbook, classification: 'mapping_error', resolution: 'unresolved', reason: 'home_away_inversion', detail: { dev_home: +dh.toFixed(3), dev_away: +da.toFixed(3), implied: ip } });
      return;
    }
    // desviación extrema de UN outcome sin inversión → data_error/market_mismatch, sin resolver.
    const maxDev = Math.max(Math.abs(dh), Math.abs(dd), Math.abs(da));
    if (maxDev > devThreshold) {
      outliers.push({ sportsbook: set.sportsbook, classification: 'data_error', resolution: 'unresolved', reason: 'extreme_deviation', detail: { max_dev: +maxDev.toFixed(3), implied: ip } });
      return;
    }
    clean.push(set);
  });
  // cualquier outlier semántico SIN resolver bloquea STRONG para el evento.
  const hasUnresolved = outliers.some(o => o.resolution === 'unresolved');
  return { clean, outliers, median: med, hasUnresolved };
}

module.exports = { detectOutliers, impliedFromSet, median };
