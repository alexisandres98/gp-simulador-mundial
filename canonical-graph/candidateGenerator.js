// canonical-graph/candidateGenerator.js — genera pares candidatos por FILTROS (Sprint 2). Evita O(n²):
// agrupa por clave de bucket (event_type/sport/competition/scope/familia/participantes/ventana de tiempo)
// y solo empareja descriptores del MISMO bucket entre proveedores distintos.

'use strict';

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// Clave de bucket de EVENTO: torneo = comp:season:scope ; partido = comp:season:participantes-ordenados:día
function eventBucketKey(d) {
  if (d.scope === 'tournament') return `T|${d.sport}|${norm(d.competition)}|${d.season}|${d.category}`;
  const teams = (d.participants || []).map(p => p.code).sort().join('-');
  const day = d.scheduledStart ? new Date(d.scheduledStart).toISOString().slice(0, 10) : 'nodate';
  return `M|${d.sport}|${norm(d.competition)}|${d.season}|${d.category}|${teams}|${day}`;
}
// Para mercado, además de evento, agrupa por familia (no compares tournament_winner con match_winner)
function marketBucketKey(d) { return eventBucketKey(d) + `|${d.family}`; }

// generateCandidates(descriptorsA, descriptorsB, { level }) → [{ a, b, bucket }]
// level: 'event' (bucket de evento) | 'market' (bucket de evento+familia)
function generateCandidates(descriptorsA, descriptorsB, { level = 'event' } = {}) {
  const keyFn = level === 'market' ? marketBucketKey : eventBucketKey;
  const index = new Map();
  for (const b of descriptorsB) {
    const k = keyFn(b);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(b);
  }
  const out = [];
  for (const a of descriptorsA) {
    const k = keyFn(a);
    const matches = index.get(k) || [];
    for (const b of matches) out.push({ a, b, bucket: k });
  }
  return out;
}

module.exports = { generateCandidates, eventBucketKey, marketBucketKey };
