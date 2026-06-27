// collector/weather.js — Fase O §13. Weather context vía Open-Meteo (API pública, legal, sin key).
// Resuelve forecast para la sede+kickoff y deriva factores SOLO si superan thresholds versionados (clima ordinario
// → impacto 0). Usa el fetch endurecido (allowlist open-meteo). Persistencia en weather_snapshots (idempotente).
'use strict';
const crypto = require('crypto');
const sec = require('./security');
const ALLOW = ['open-meteo.com', 'api.open-meteo.com'];

const THRESH = { // weather-policy-1 (versionado)
  EXTREME_HEAT: { field: 'apparent_c', op: '>=', value: 32 },
  HIGH_HUMIDITY: { field: 'humidity_pct', op: '>=', value: 80 },
  HEAVY_RAIN: { field: 'precip_mm', op: '>=', value: 5 },
  STRONG_WIND: { field: 'wind_kmh', op: '>=', value: 30 },
};
function factorsFor(w) {
  const out = [];
  for (const [f, t] of Object.entries(THRESH)) { const v = w[t.field]; if (v != null && v >= t.value) out.push(f); }
  return out;
}

// fetchForecast({lat,lon,kickoffIso}) → snapshot de clima para la hora del kickoff (forecast horario).
async function fetchForecast({ lat, lon, kickoffIso }) {
  if (lat == null || lon == null) return { ok: false, reason: 'no_coords' };
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,wind_speed_10m&forecast_days=7&timezone=UTC`;
  const r = await sec.safeFetch(url, { allowlist: ALLOW });
  if (!r.ok || !r.body) return { ok: false, reason: r.reason || 'fetch_failed', status: r.status };
  let j; try { j = JSON.parse(r.body); } catch { return { ok: false, reason: 'bad_json' }; }
  const h = j.hourly; if (!h || !h.time) return { ok: false, reason: 'no_hourly' };
  // hora más cercana al kickoff
  const target = new Date(kickoffIso).getTime();
  let bi = 0, best = Infinity;
  for (let i = 0; i < h.time.length; i++) { const d = Math.abs(new Date(h.time[i] + 'Z').getTime() - target); if (d < best) { best = d; bi = i; } }
  const w = {
    temperature_c: h.temperature_2m ? h.temperature_2m[bi] : null,
    apparent_c: h.apparent_temperature ? h.apparent_temperature[bi] : null,
    humidity_pct: h.relative_humidity_2m ? h.relative_humidity_2m[bi] : null,
    precip_mm: h.precipitation ? h.precipitation[bi] : null,
    wind_kmh: h.wind_speed_10m ? h.wind_speed_10m[bi] : null,
  };
  const horizonHours = +((target - Date.now()) / 3600000).toFixed(2);
  const snapshot = {
    ...w, weather_factors: factorsFor(w), forecast_issued_at: new Date().toISOString(), horizon_hours: horizonHours,
    matched_hour: h.time[bi], source: 'open-meteo',
    input_hash: 'sha256:' + crypto.createHash('sha256').update(`${lat},${lon},${kickoffIso},${h.time[bi]},${w.apparent_c},${w.precip_mm},${w.wind_kmh}`).digest('hex'),
  };
  return { ok: true, snapshot };
}

module.exports = { THRESH, factorsFor, fetchForecast, ALLOW };
