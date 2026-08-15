// data-fabric/store.js — BRONZE Y SILVER: EL ALMACÉN CON TIEMPO EFECTIVO (16-ago).
// Módulos 1, 4, 5, 6 y 12 del blueprint.
//
// LA PREGUNTA QUE ESTE ARCHIVO EXISTE PARA CONTESTAR: no "¿qué sabemos?", sino "¿qué sabíamos EL MARTES A
// LAS 19:04?". Cualquier validación que use datos llegados después del momento de la predicción está
// midiendo un modelo que en producción nunca existió, y ese backtest siempre sale mejor que la realidad.
//
// EL CASO CONCRETO QUE NOS PUEDE MORDER. El parte de lesiones de ESPN se SOBRESCRIBE. Si a las 18:00 una
// jugadora figuraba "en duda" y a las 19:30 pasó a "fuera", nuestro archivo actual solo conserva "fuera".
// Un backtest de aquella noche creerá que a las 18:00 ya sabíamos lo que supimos a las 19:30. Las picks
// saldrán mejor de lo que salieron, y nadie lo notará hasta que el dinero real no reproduzca el papel.
//
// LA SOLUCIÓN: NO SE GUARDAN ESTADOS, SE GUARDAN EVENTOS. "Fuera" no sustituye a "en duda": se añade
// detrás. El estado a cualquier momento se RECONSTRUYE filtrando por tiempo, y por eso se puede reconstruir
// cualquier momento del pasado, no solo el presente.
//
// LOS TRES TIEMPOS, Y CUÁL SE USA PARA QUÉ:
//   effective_at — desde cuándo es cierto en el mundo   (la jugadora quedó descartada a las 19:30)
//   observed_at  — cuándo lo publicó la fuente          (ESPN lo sacó a las 19:34)
//   ingested_at  — cuándo lo guardamos nosotros         (nuestro sweep lo capturó a las 19:36)
// Para reconstruir "qué sabíamos a las 19:00" se filtra por INGESTED_AT. Filtrar por effective_at es el
// error de fuga más común y el más difícil de ver: incluiría hechos que aún no habían llegado a nosotros.
//
// FORMATO: JSONL por dominio y mes (`silver/injuries-2026-08.jsonl`). Append puro, sin reescrituras. Es el
// formato correcto para un log de eventos: barato de escribir, imposible de corromper a medias, y se puede
// leer con streaming cuando crezca.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = () => process.env.GP_FABRIC_DIR || path.join(__dirname, '..', 'data', 'fabric');
const dir = (...p) => path.join(ROOT(), ...p);
const ensure = (d) => { try { fs.mkdirSync(d, { recursive: true }); } catch { /* ya existe */ } };
const monthOf = (iso) => String(iso || new Date().toISOString()).slice(0, 7);
const sha = (s) => crypto.createHash('sha1').update(typeof s === 'string' ? s : JSON.stringify(s)).digest('hex');

// ---- BRONZE: LA RESPUESTA CRUDA, TAL CUAL LLEGÓ ---------------------------------------------------------
// Se guarda comprimida y con el hash del contenido en el nombre. El hash hace dos cosas: deduplica (si la
// fuente devuelve exactamente lo mismo no se escribe otra vez) y permite demostrar que un archivo no se
// tocó. Bronze NUNCA se edita: si la fuente corrige algo, entra un archivo nuevo y una revisión en silver.
function putRaw({ source, domain, key, payload, observed_at = null }) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const h = sha(body).slice(0, 16);
  const d = dir('bronze', source, domain, monthOf(observed_at));
  ensure(d);
  const file = path.join(d, `${String(key).replace(/[^a-zA-Z0-9_.-]/g, '_')}.${h}.json.gz`);
  if (fs.existsSync(file)) return { file, hash: h, deduped: true };
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(body)));
  return { file, hash: h, deduped: false, bytes: fs.statSync(file).size };
}
function getRaw(file) { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); } catch { return null; } }
function listRaw({ source, domain, month = null }) {
  const base = dir('bronze', source, domain);
  const out = [];
  try {
    for (const m of fs.readdirSync(base)) {
      if (month && m !== month) continue;
      for (const f of fs.readdirSync(path.join(base, m))) out.push(path.join(base, m, f));
    }
  } catch { /* nada guardado todavía */ }
  return out;
}

// ---- SILVER: EVENTOS ------------------------------------------------------------------------------------
// Un evento es inmutable. `entity` identifica de qué habla (un jugador, un mercado, un partido) y `fields`
// es lo que cambió. Nada de "actualizar": solo añadir.
function append(domain, ev) {
  const now = new Date().toISOString();
  const row = {
    id: sha(domain + '|' + (ev.entity || '') + '|' + (ev.effective_at || '') + '|' + JSON.stringify(ev.fields || {})).slice(0, 16),
    domain,
    entity: String(ev.entity || ''),
    kind: ev.kind || 'state',
    source: ev.source || 'gp',
    effective_at: ev.effective_at || ev.observed_at || now,
    observed_at: ev.observed_at || now,
    // `ingested_at` es SIEMPRE ahora salvo que se esté reproduciendo una captura cuyo momento real se
    // conoce (una importación desde logs, por ejemplo). Permitirlo es necesario —sin ello, todo lo
    // backfilleado nace con fecha de hoy y `asOf` no puede reconstruir nada anterior— pero es también la
    // única puerta por la que se puede colar una fuga. Por eso queda marcado: un evento con
    // `backfilled: true` no es una observación en vivo y cualquier auditoría debe poder distinguirlo.
    ingested_at: ev.ingested_at || now,
    backfilled: ev.ingested_at ? true : undefined,
    fields: ev.fields || {},
    revision_of: ev.revision_of || null,          // si corrige un evento anterior, su id
    reason: ev.reason || null,                    // por qué se corrigió
    raw_ref: ev.raw_ref || null,                  // ruta al bronze del que salió
  };
  const d = dir('silver'); ensure(d);
  fs.appendFileSync(path.join(d, `${domain}-${monthOf(row.observed_at)}.jsonl`), JSON.stringify(row) + '\n');
  return row;
}

// Escritura idempotente: si el último evento de esa entidad dice exactamente lo mismo, no se escribe otro.
// Sin esto, un sweep cada 10 minutos generaría 144 eventos idénticos al día por jugador y el log dejaría de
// ser legible en una semana.
function appendIfChanged(domain, ev, { window = 400 } = {}) {
  const last = lastFor(domain, ev.entity, { window });
  if (last && JSON.stringify(last.fields) === JSON.stringify(ev.fields || {})) return { skipped: true, last };
  return { skipped: false, row: append(domain, ev) };
}

function readAll(domain, { months = null } = {}) {
  const d = dir('silver');
  const out = [];
  try {
    for (const f of fs.readdirSync(d)) {
      const m = f.match(new RegExp('^' + domain + '-(\\d{4}-\\d{2})\\.jsonl$'));
      if (!m) continue;
      if (months && months.indexOf(m[1]) < 0) continue;
      for (const line of fs.readFileSync(path.join(d, f), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line)); } catch { /* línea corrupta: se salta, no se rompe la lectura */ }
      }
    }
  } catch { /* aún no hay silver */ }
  return out.sort((a, b) => String(a.ingested_at).localeCompare(String(b.ingested_at)));
}
function lastFor(domain, entity, { window = 400 } = {}) {
  const rows = readAll(domain).filter((r) => r.entity === String(entity));
  return rows.length ? rows[rows.length - 1] : null;
}

// ---- LA FUNCIÓN CENTRAL: EL ESTADO A UNA FECHA ----------------------------------------------------------
// `asOf(domain, cuando)` devuelve el último evento por entidad ENTRE LOS QUE YA HABÍAMOS INGERIDO en ese
// momento. Es literalmente la reconstrucción de nuestro conocimiento pasado.
//
// `by` decide el corte: 'ingested' (lo que sabíamos) o 'effective' (lo que era cierto). El primero es el
// correcto para backtests; el segundo, para análisis histórico donde sí queremos la verdad final.
function asOf(domain, when, { by = 'ingested', entities = null } = {}) {
  const t = typeof when === 'number' ? when : Date.parse(when);
  const field = by === 'effective' ? 'effective_at' : 'ingested_at';
  const state = new Map();
  for (const r of readAll(domain)) {
    if (Date.parse(r[field]) > t) continue;
    if (entities && entities.indexOf(r.entity) < 0) continue;
    const cur = state.get(r.entity);
    if (!cur || Date.parse(r[field]) >= Date.parse(cur[field])) state.set(r.entity, r);
  }
  return state;
}

// Historia completa de una entidad: para el cajón de procedencia y para auditar una corrección.
function history(domain, entity) {
  return readAll(domain).filter((r) => r.entity === String(entity))
    .map((r) => ({ at: r.observed_at, observed_at: r.observed_at, ingested_at: r.ingested_at, effective_at: r.effective_at,
      source: r.source, fields: r.fields, revision_of: r.revision_of, reason: r.reason, backfilled: !!r.backfilled }));
}

// ---- REVISIONES (módulo 6) ------------------------------------------------------------------------------
// Cuando una fuente CORRIGE un dato ya publicado (un box score reprocesado, una jugada reclasificada), no
// se pisa el valor viejo: se añade un evento que apunta al anterior y explica el cambio. Así se puede
// contestar "¿el modelo entrenó con el dato correcto o con el corregido?", que es la clase de pregunta que
// aparece justo cuando un resultado no cuadra.
function revise(domain, { entity, previous_id, fields, source, reason, observed_at = null }) {
  return append(domain, { entity, fields, source, reason, observed_at, revision_of: previous_id, kind: 'revision' });
}
function revisions(domain) { return readAll(domain).filter((r) => r.revision_of); }

// ---- CONGELADO HISTÓRICO DIARIO (módulo 12) -------------------------------------------------------------
// Al cerrar el día se escribe un resumen inmutable: cuántos eventos por dominio, hashes y conteos. No es un
// backup — es la prueba de que el estado de ese día fue el que fue. Si mañana alguien reescribe silver, el
// congelado lo delata.
function freeze(day = null) {
  const d = day || new Date().toISOString().slice(0, 10);
  const domains = new Set();
  try { for (const f of fs.readdirSync(dir('silver'))) { const m = f.match(/^(.+)-\d{4}-\d{2}\.jsonl$/); if (m) domains.add(m[1]); } } catch { /* sin silver */ }
  const summary = { day: d, at: new Date().toISOString(), domains: {} };
  for (const dom of domains) {
    const rows = readAll(dom).filter((r) => String(r.ingested_at).slice(0, 10) === d);
    summary.domains[dom] = { events: rows.length, entities: new Set(rows.map((r) => r.entity)).size,
      revisions: rows.filter((r) => r.revision_of).length, hash: sha(rows.map((r) => r.id).join(',')).slice(0, 16) };
  }
  const out = dir('freeze'); ensure(out);
  fs.writeFileSync(path.join(out, `${d}.json`), JSON.stringify(summary));
  return summary;
}
function freezes({ limit = 30 } = {}) {
  try {
    return fs.readdirSync(dir('freeze')).sort().reverse().slice(0, limit)
      .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir('freeze'), f), 'utf8')); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// ---- SALUD DEL ALMACÉN (módulo 319) ---------------------------------------------------------------------
function health() {
  const out = { root: ROOT(), domains: {}, bronze: {}, at: new Date().toISOString() };
  try {
    for (const f of fs.readdirSync(dir('silver'))) {
      const m = f.match(/^(.+)-(\d{4}-\d{2})\.jsonl$/); if (!m) continue;
      const st = fs.statSync(path.join(dir('silver'), f));
      const d = out.domains[m[1]] = out.domains[m[1]] || { months: 0, bytes: 0, last_write: null };
      d.months++; d.bytes += st.size;
      if (!d.last_write || st.mtime.toISOString() > d.last_write) d.last_write = st.mtime.toISOString();
    }
  } catch { out.silver_missing = true; }
  try {
    for (const src of fs.readdirSync(dir('bronze'))) {
      let n = 0, bytes = 0;
      for (const dom of fs.readdirSync(dir('bronze', src))) for (const mth of fs.readdirSync(dir('bronze', src, dom))) {
        for (const f of fs.readdirSync(dir('bronze', src, dom, mth))) { n++; bytes += fs.statSync(dir('bronze', src, dom, mth, f)).size; }
      }
      out.bronze[src] = { files: n, bytes };
    }
  } catch { out.bronze_missing = true; }
  return out;
}

module.exports = { ROOT, putRaw, getRaw, listRaw, append, appendIfChanged, readAll, lastFor, asOf, history, revise, revisions, freeze, freezes, health, sha };
