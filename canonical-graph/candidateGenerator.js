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
//
// FRENO DE BUCKET DEGENERADO (28-ago, autopsia de los 20 OOM de la madrugada): cuando el extractor no saca
// deporte/competición de un mercado (los catálogos se inundaron de mercados nuevos de NFL/College), cientos
// de descriptores caen al MISMO bucket vacío y el producto cruzado materializa millones de pares — 500 MB →
// 3 GB en 90 segundos, SÍNCRONO, con el event loop bloqueado (ni el vigilante de memoria puede correr).
// Un bucket así no es señal, es extracción fallida: comparar basura contra basura un millón de veces no
// produce ningún mapping válido. Se salta con su aviso y un tope global de seguridad cierra el resto.
const MAX_BUCKET_PAIRS = Math.max(100, Number(process.env.GP_CANON_MAX_BUCKET_PAIRS) || 2500);
const MAX_TOTAL_PAIRS = Math.max(1000, Number(process.env.GP_CANON_MAX_TOTAL_PAIRS) || 20000);
function generateCandidates(descriptorsA, descriptorsB, { level = 'event' } = {}) {
  const keyFn = level === 'market' ? marketBucketKey : eventBucketKey;
  const index = new Map();
  for (const b of descriptorsB) {
    const k = keyFn(b);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(b);
  }
  const porBucket = new Map();
  for (const a of descriptorsA) {
    const k = keyFn(a);
    if (!index.has(k)) continue;
    porBucket.set(k, (porBucket.get(k) || 0) + 1);
  }
  const out = [];
  const saltados = [];
  for (const a of descriptorsA) {
    const k = keyFn(a);
    const matches = index.get(k) || [];
    if (!matches.length) continue;
    const pares = (porBucket.get(k) || 0) * matches.length;
    if (pares > MAX_BUCKET_PAIRS) { if (saltados.indexOf(k) < 0) saltados.push(k); continue; }
    if (out.length + matches.length > MAX_TOTAL_PAIRS) break;
    for (const b of matches) out.push({ a, b, bucket: k });
  }
  if (saltados.length) {
    try {
      require('../database/logger').warn('canonical: buckets degenerados saltados', {
        buckets: saltados.length, muestra: saltados.slice(0, 3).map(s => s.slice(0, 60)), tope_pares: MAX_BUCKET_PAIRS });
    } catch { /* el freno nunca depende del logger */ }
  }
  return out;
}

module.exports = { generateCandidates, eventBucketKey, marketBucketKey };
