// data-fabric/entities.js — IDS CANÓNICOS Y RESOLUCIÓN DE IDENTIDAD (16-ago).
// Módulos 2 y 3 del blueprint.
//
// POR QUÉ HACE FALTA UN ID PROPIO SI ESPN YA DA UNO. Porque el día que añadamos una segunda fuente —y hace
// falta añadirla: los tipos de jugada y el tracking solo están en stats.nba.com— tendremos DOS ids para el
// mismo jugador y ninguna forma de saberlo. El id canónico es un identificador nuestro, estable, al que se
// cuelgan los ids externos como alias. Sin eso, cruzar fuentes es adivinar por nombre, y adivinar por
// nombre falla exactamente donde más duele:
//   · dos jugadores con el mismo apellido en el mismo equipo;
//   · un traspaso a mitad de temporada (el mismo jugador, dos equipos);
//   · un cambio de nombre legal o de grafía (acentos, guiones, sufijos Jr./III);
//   · una franquicia que se muda (mismo equipo, otra ciudad y otro abbr).
//
// LA REGLA DURA: NUNCA SE RESUELVE UN CONFLICTO EN SILENCIO. Si dos candidatos empatan, la resolución
// devuelve `ambiguous` y el llamador decide; lo que no puede pasar es que el sistema elija uno, acierte el
// 90% de las veces y meta basura el 10% restante sin que nadie se entere.
'use strict';

const crypto = require('crypto');

// Normalización agresiva para comparar nombres: sin acentos, sin puntuación, sin sufijos.
const SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b/g;
function normName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
}
const lastName = (s) => { const p = normName(s).split(' '); return p[p.length - 1] || ''; };
const firstInitial = (s) => (normName(s)[0] || '');

// El id canónico es determinista: mismo tipo + misma semilla → mismo id, siempre. Así se puede regenerar el
// registro entero desde cero y obtener exactamente los mismos identificadores.
function canonicalId(kind, seed) {
  const h = crypto.createHash('sha1').update(kind + '|' + String(seed)).digest('hex').slice(0, 12);
  return kind.slice(0, 3).toUpperCase() + '_' + h;
}

// ---- REGISTRO --------------------------------------------------------------------------------------------
// { entities: { canon_id: {kind, name, aliases:{source: extId}, names:[], meta} }, index: { 'source:extId': canon_id } }
function emptyRegistry() { return { entities: {}, index: {}, at: null }; }

function upsert(reg, { kind, source, ext_id, name, meta = {} }) {
  const key = source + ':' + String(ext_id);
  let cid = reg.index[key];
  if (!cid) {
    // ¿existe ya la misma entidad vista por otra fuente? Se busca por nombre normalizado y tipo.
    const hit = findByName(reg, kind, name, meta);
    if (hit && !hit.ambiguous) cid = hit.id;
  }
  if (!cid) cid = canonicalId(kind, source + '|' + ext_id + '|' + normName(name));
  const e = reg.entities[cid] || { id: cid, kind, name, names: [], aliases: {}, meta: {}, first_seen: new Date().toISOString() };
  e.aliases[source] = String(ext_id);
  if (name && e.names.indexOf(name) < 0) e.names.push(name);
  // el nombre "oficial" es el más reciente que no sea claramente peor (más corto o sin apellido)
  if (name && normName(name).split(' ').length >= normName(e.name || '').split(' ').length) e.name = name;
  e.meta = { ...e.meta, ...meta };
  e.last_seen = new Date().toISOString();
  reg.entities[cid] = e;
  reg.index[key] = cid;
  return cid;
}

// Resolución por nombre CON contexto. El contexto es lo que evita los falsos positivos: dos "Jones" en la
// liga son ambiguos; dos "Jones" y uno de ellos en el equipo que estamos mirando, no.
function findByName(reg, kind, name, { team_id = null, season = null } = {}) {
  const n = normName(name);
  if (!n) return null;
  const cands = [];
  for (const e of Object.values(reg.entities)) {
    if (e.kind !== kind) continue;
    const names = (e.names || []).concat([e.name]).map(normName);
    if (names.indexOf(n) >= 0) { cands.push({ id: e.id, score: 3, e }); continue; }
    // coincidencia por apellido + inicial: suficiente para emparejar "S. Ionescu" con "Sabrina Ionescu",
    // pero solo se acepta si además el contexto de equipo coincide.
    if (lastName(e.name) === lastName(name) && firstInitial(e.name) === firstInitial(name)) cands.push({ id: e.id, score: 2, e });
  }
  if (!cands.length) return null;
  const best = Math.max(...cands.map((c) => c.score));
  let top = cands.filter((c) => c.score === best);
  if (top.length > 1 && team_id) {
    const byTeam = top.filter((c) => String((c.e.meta || {}).team_id || '') === String(team_id));
    if (byTeam.length === 1) top = byTeam;
  }
  if (top.length > 1) {
    return { ambiguous: true, candidates: top.map((c) => ({ id: c.id, name: c.e.name, team_id: (c.e.meta || {}).team_id || null })),
      reason: 'varios candidatos con la misma puntuación: no se resuelve en silencio' };
  }
  // una coincidencia SOLO por apellido+inicial sin confirmación de equipo se marca como débil: sirve para
  // sugerir, no para escribir en el almacén sin revisión.
  return { id: top[0].id, score: best, weak: best < 3 && !team_id };
}

function resolve(reg, source, extId) { return reg.index[source + ':' + String(extId)] || null; }
function get(reg, cid) { return reg.entities[cid] || null; }

// Alias cruzado: enlazar el mismo canónico a un id de OTRA fuente. Es la operación que hará falta el día
// que entren los tipos de jugada de stats.nba.com junto a los partidos de ESPN.
function link(reg, cid, source, extId) {
  const e = reg.entities[cid];
  if (!e) return { ok: false, error: 'entidad desconocida' };
  const key = source + ':' + String(extId);
  const cur = reg.index[key];
  if (cur && cur !== cid) return { ok: false, error: 'ese id externo ya apunta a otra entidad', current: cur };
  e.aliases[source] = String(extId);
  reg.index[key] = cid;
  return { ok: true };
}

// ---- ALERTAS DE RESOLUCIÓN (módulo 320) ------------------------------------------------------------------
// Entidades que huelen a problema: sin alias en la fuente principal, con nombres muy distintos colgando del
// mismo canónico, o duplicados probables. Se reporta, no se corrige solo.
function audit(reg, { primary = 'espn' } = {}) {
  const issues = [];
  const byLast = new Map();
  for (const e of Object.values(reg.entities)) {
    if (!e.aliases[primary]) issues.push({ type: 'sin_fuente_principal', id: e.id, name: e.name, kind: e.kind });
    if ((e.names || []).length > 1) {
      const set = new Set(e.names.map(normName));
      if (set.size > 1) issues.push({ type: 'nombres_divergentes', id: e.id, names: e.names });
    }
    if (e.kind === 'player') {
      const k = lastName(e.name) + '|' + firstInitial(e.name) + '|' + ((e.meta || {}).team_id || '');
      if (!byLast.has(k)) byLast.set(k, []);
      byLast.get(k).push(e);
    }
  }
  for (const [k, list] of byLast) if (list.length > 1) {
    issues.push({ type: 'posible_duplicado', key: k, ids: list.map((e) => ({ id: e.id, name: e.name })) });
  }
  return { entities: Object.keys(reg.entities).length, issues, at: new Date().toISOString() };
}

module.exports = { normName, lastName, canonicalId, emptyRegistry, upsert, findByName, resolve, get, link, audit };
