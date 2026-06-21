// canonical-graph/participantAliases.js — normalización determinística de participantes (Sprint 2).
// NO usa fuzzy string matching para unir: solo coincidencia EXACTA de alias normalizado. Los alias
// validados (selección oficial + extras conocidos) tienen prioridad. Equipos distintos no colisionan.

'use strict';
const { TEAMS } = require('../data/tournament');
const ALIAS_VERSION = 'alias-1';

// minúsculas + sin acentos + sin puntuación + espacios colapsados
function normalizeAlias(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

// Alias extra conocidos (idiomas/abreviaturas) que no están en data/tournament.
const EXTRA_ALIASES = {
  USA: ['USA', 'U.S.', 'US', 'United States of America', 'USMNT', 'United States Men', 'EE.UU.'],
  KOR: ['KOR', 'Republic of Korea', 'Korea Rep'],
  NED: ['NED', 'Holland', 'Holanda'],
  ENG: ['ENG', 'England'],
  MEX: ['MEX'],
  ARG: ['ARG'],
  BRA: ['BRA'],
  ESP: ['ESP'],
};

// Construye el mapa autoritativo { normalizedAlias -> { code, canonicalName, ambiguous? } }.
// Detecta colisiones: si dos selecciones distintas generan el MISMO alias normalizado, se marca
// ambiguo y NO se usa para resolver (evita uniones peligrosas).
let _seed = null;
function buildSeedTable() {
  if (_seed) return _seed;
  const map = new Map();
  const add = (alias, code, canonicalName) => {
    const n = normalizeAlias(alias);
    if (!n) return;
    const existing = map.get(n);
    if (existing && existing.code !== code) { existing.ambiguous = true; return; } // colisión → no resolver
    if (!existing) map.set(n, { code, canonicalName });
  };
  for (const t of TEAMS) {
    const canonical = t.en || t.name;
    const aliases = [t.en, t.name, t.id, ...(t.aliases || []), ...(EXTRA_ALIASES[t.id] || [])];
    for (const a of aliases) add(a, t.id, canonical);
  }
  _seed = map;
  return map;
}

// resolve(name, { providerAliases? }) → { code, canonicalName, method, confidence } | null
// providerAliases: mapa opcional { normalizedAlias -> code } de alias específicos del proveedor (DB).
function resolve(name, opts = {}) {
  const n = normalizeAlias(name);
  if (!n) return null;
  // 1) alias específico del proveedor (validado) tiene prioridad
  if (opts.providerAliases && opts.providerAliases[n]) {
    const code = opts.providerAliases[n];
    const t = TEAMS.find(x => x.id === code);
    return { code, canonicalName: t ? (t.en || t.name) : code, method: 'provider_alias', confidence: 1 };
  }
  // 2) alias validado global (selección oficial)
  const hit = buildSeedTable().get(n);
  if (hit && !hit.ambiguous) return { code: hit.code, canonicalName: hit.canonicalName, method: 'validated_alias', confidence: 1 };
  if (hit && hit.ambiguous) return null; // ambiguo → no se resuelve (a revisión)
  return null; // desconocido → no fuzzy; a revisión
}

// collisions() → lista de alias normalizados ambiguos (para verify)
function collisions() {
  const out = [];
  for (const [alias, v] of buildSeedTable().entries()) if (v.ambiguous) out.push(alias);
  return out;
}

module.exports = { ALIAS_VERSION, normalizeAlias, buildSeedTable, resolve, collisions, EXTRA_ALIASES };
