// implied-engine/sombra.js — LA SOMBRA DE LAS FAMILIAS DE PRECIO (9-sep)
//
// Un almacén aparte, con la misma forma que `futbol-derivadas.js`: un archivo por deporte en el disco
// persistente, regla congelada y fechada, tesis que nacen una sola vez, cierres por cubo contra la MISMA casa
// (la tesis es sobre el precio de UNA casa, así que su cierre natural es el de esa casa), liquidación con el
// resultado oficial y un track por familia y casa. No toca ninguna pick pública ni ninguna sombra existente.
//
// Qué mide. Tres familias que salen SOLO de precios (implied-engine/football.js y hoops.js):
//   IMPLIED_TOTAL / IMPLIED_1X2 / IMPLIED_ML / IMPLIED_SPREAD — la incoherencia interna de una casa entre dos
//     de sus mercados, con la línea de base del tablero descontada (para que un sesgo de forma no se lea
//     como señal en todos los partidos a la vez).
//   BOOK_DEV_* — la desviación de una casa frente a la mediana de ≥ 3 casas (la corrección 2 del 23-ago).
// La vara es el CLV contra la misma casa por cubo. El ROI se anota pero no decide.
'use strict';

const fs = require('fs');
const path = require('path');
const CL = require('./closes');

const RULE = {
  version: 'implicito_v2',
  frozen_at: '2026-09-09',   // v1 vivió una hora: base GLOBAL del tablero; v2 = base por PARTIDO (≥ 3 casas)
  edge_min_pp: 3,          // ventaja mínima entre el precio coherente y el cotizado
  edge_cap_pp: 15,         // por encima es un error nuestro o una casa rota, no una señal
  odds_min: 1.25, odds_max: 6.0,
  dev_min_books: 3,        // BOOK_DEV exige mediana de ≥ 3 casas
  baseline_min_obs: 8,     // la línea de base del tablero se estima con ≥ 8 observaciones de la pasada
  baseline_ema: 0.7,       // memoria de la línea de base entre pasadas (0,7 de lo guardado + 0,3 de lo nuevo)
  max_new_per_pass: 60,
  note: 'sombra pura de precio: ninguna probabilidad del modelo entra; la incoherencia se mide con la línea de base del tablero descontada; cierre = la MISMA casa por cubo T−60/−30/−10/−5/−1.',
};

const DISK = () => {
  const base = path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json'));
  const d = path.join(base, 'implicito');
  try { fs.mkdirSync(d, { recursive: true }); } catch { }
  return d;
};
const FILE = (sport) => path.join(DISK(), `${sport}.json`);
const rd = (sport) => { try { return JSON.parse(fs.readFileSync(FILE(sport), 'utf8')); } catch { return { sport, picks: {}, baseline: null, at: null, rule: RULE.version }; } };
const wr = (sport, o) => { try { const f = FILE(sport); fs.writeFileSync(f + '.tmp', JSON.stringify(o)); fs.renameSync(f + '.tmp', f); } catch { } };

const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

// ── LÍNEA DE BASE ───────────────────────────────────────────────────────────────────────────────────────
// `obs` son las incoherencias crudas de la pasada (goles en fútbol, σ implícita en baloncesto). La mediana se
// mezcla con la guardada. Devuelve el valor a usar y si es fiable (sin ≥ 8 obs y sin memoria → null).
function updateBaseline(st, key, obs) {
  st.baseline = st.baseline || {};
  const prev = st.baseline[key] || null;
  const m = obs.length >= RULE.baseline_min_obs ? median(obs) : null;
  let value = null;
  if (m != null && prev && prev.value != null) value = RULE.baseline_ema * prev.value + (1 - RULE.baseline_ema) * m;
  else if (m != null) value = m;
  else if (prev && prev.value != null) value = prev.value;
  if (value == null) return { value: null, n_obs: obs.length, fresh: false };
  st.baseline[key] = { value: r4(value), n_obs: obs.length, last_median: r4(m), at: new Date().toISOString(), passes: ((prev && prev.passes) || 0) + (m != null ? 1 : 0) };
  return { value, n_obs: obs.length, fresh: m != null };
}

// ── REGISTRO ────────────────────────────────────────────────────────────────────────────────────────────
// theses: [{ key, ceid, league, match, home, away, kickoff_at, book, family, side, line, odds, p_coherent,
//            p_market, edge_pp, basis, n_books, meta }]
function record(sport, theses, { baseline = null, ahora = Date.now() } = {}) {
  const st = rd(sport);
  st.picks = st.picks || {};
  const out = { evaluadas: theses.length, nuevas: 0, bajo_liston: 0, vetadas: 0, fuera_de_cuota: 0, ya_existian: 0, anuladas_regla: 0, por_familia: {} };
  // una tesis viva nacida con OTRA versión de la regla no se mezcla con las nuevas: se anula con motivo
  for (const p of Object.values(st.picks)) if (p.status === 'ACTIVE' && p.rule_version !== RULE.version) { p.status = 'VOID'; p.result = 'VOID'; p.void_why = `regla ${p.rule_version} sustituida por ${RULE.version}`; p.settled_at = new Date(ahora).toISOString(); out.anuladas_regla++; }
  let nuevas = 0;
  // con tope por pasada, primero las de más ventaja (la primera pasada en prod evaluó 6.070 y el tope se llenó
  // por orden de evento y casa, que es arbitrario); las que se quedan fuera vuelven a evaluarse en 20 min
  const ordered = theses.slice().sort((a, b) => (Number(b.edge_pp) || 0) - (Number(a.edge_pp) || 0));
  for (const t of ordered) {
    const fam = t.family; out.por_familia[fam] = out.por_familia[fam] || { evaluadas: 0, nuevas: 0 };
    out.por_familia[fam].evaluadas++;
    if (!(t.odds >= RULE.odds_min && t.odds <= RULE.odds_max)) { out.fuera_de_cuota++; continue; }
    if (!(t.edge_pp >= RULE.edge_min_pp)) { out.bajo_liston++; continue; }
    if (t.edge_pp > RULE.edge_cap_pp) { out.vetadas++; continue; }
    if (/^BOOK_DEV/.test(fam) && !(t.n_books >= RULE.dev_min_books)) { out.bajo_liston++; continue; }
    if (st.picks[t.key]) { out.ya_existian++; continue; }
    if (nuevas >= RULE.max_new_per_pass) break;
    st.picks[t.key] = {
      key: t.key, sport, ceid: t.ceid, league: t.league || null, match: t.match || null, home: t.home || null, away: t.away || null,
      kickoff_at: t.kickoff_at || null,
      family: fam, side: t.side, line: t.line != null ? t.line : null, odds: r4(t.odds), book: t.book,
      p_coherent: r4(t.p_coherent), p_market: r4(t.p_market), edge_pp: r2(t.edge_pp), n_books: t.n_books || null,
      basis: t.basis || null, baseline: baseline != null ? r4(baseline) : null, meta: t.meta || null,
      rule_version: RULE.version, born_at: new Date(ahora).toISOString(), status: 'ACTIVE',
      closes: { buckets: {}, last: null }, close_own: null, close_best: null, clv_own_pct: null, clv_best_pct: null,
      result: null, units: null, settled_at: null,
    };
    nuevas++; out.por_familia[fam].nuevas++;
  }
  out.nuevas = nuevas;
  if (nuevas || out.anuladas_regla) { st.at = new Date(ahora).toISOString(); wr(sport, st); }
  return out;
}

// ── CIERRES ─────────────────────────────────────────────────────────────────────────────────────────────
// quoteFor(pick) → { own, best, pinnacle, age_min } con las cuotas actuales de esa selección; async.
async function closes(sport, quoteFor, { ahora = Date.now(), windowMin = 95 } = {}) {
  const st = rd(sport);
  const vivas = Object.values(st.picks || {}).filter((p) => p.status === 'ACTIVE' && p.kickoff_at);
  const cerca = vivas.filter((p) => { const m = CL.minutesToStart(p.kickoff_at, ahora); return m != null && m <= windowMin && m > -3; });
  let buckets = 0, refreshed = 0;
  for (const p of cerca) {
    let snap = null;
    try { snap = await quoteFor(p); } catch { snap = null; }
    if (!snap) continue;
    p.closes = p.closes || { buckets: {}, last: null };
    const b = CL.record(p.closes, p.kickoff_at, snap, ahora);
    if (b) buckets++;
    if (p.closes.last) refreshed++;
  }
  if (buckets || refreshed) { st.at = new Date(ahora).toISOString(); wr(sport, st); }
  return { candidatas: cerca.length, cubos_nuevos: buckets, refrescadas: refreshed };
}

// ── LIQUIDACIÓN ─────────────────────────────────────────────────────────────────────────────────────────
// verdictFor(pick) → 'WIN' | 'LOSS' | 'PUSH' | null (sin resultado todavía). VOID a las 72 h sin resultado.
function settle(sport, verdictFor, { ahora = Date.now(), minAfterMin = 150 } = {}) {
  const st = rd(sport);
  let liquidadas = 0, anuladas = 0;
  for (const p of Object.values(st.picks || {})) {
    if (p.status !== 'ACTIVE') continue;
    const ko = Date.parse(p.kickoff_at || 0);
    if (!ko || ahora - ko < minAfterMin * 60e3) continue;
    let v = null;
    try { v = verdictFor(p); } catch { v = null; }
    if (!v) {
      if (ahora - ko > 72 * 3600e3) { p.status = 'VOID'; p.result = 'VOID'; p.void_why = 'sin resultado a las 72 h'; p.settled_at = new Date(ahora).toISOString(); anuladas++; }
      continue;
    }
    p.result = v;
    p.units = v === 'WIN' ? r2(p.odds - 1) : v === 'LOSS' ? -1 : 0;
    const last = p.closes && p.closes.last;
    if (last) {
      if (last.own > 1) { p.close_own = last.own; p.clv_own_pct = CL.clvPct(p.odds, last.own); }
      if (last.best > 1) { p.close_best = last.best; p.clv_best_pct = CL.clvPct(p.odds, last.best); }
      if (last.pinnacle > 1) { p.close_pin = last.pinnacle; p.clv_pin_pct = CL.clvPct(p.odds, last.pinnacle); }
    }
    p.status = 'SETTLED'; p.settled_at = new Date(ahora).toISOString();
    liquidadas++;
  }
  if (liquidadas || anuladas) { st.at = new Date(ahora).toISOString(); wr(sport, st); }
  return { liquidadas, anuladas };
}

// ── SEGUIMIENTO ─────────────────────────────────────────────────────────────────────────────────────────
const sd = (a) => { if (a.length < 2) return null; const m = a.reduce((x, y) => x + y, 0) / a.length; return r2(Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1))); };
const mean = (a) => (a.length ? r2(a.reduce((x, y) => x + y, 0) / a.length) : null);
function agrega(list) {
  const done = list.filter((p) => p.status === 'SETTLED');
  const u = done.reduce((s, p) => s + (p.units || 0), 0);
  const own = done.map((p) => p.clv_own_pct).filter(Number.isFinite), best = done.map((p) => p.clv_best_pct).filter(Number.isFinite);
  return {
    n: done.length, w: done.filter((p) => p.result === 'WIN').length, l: done.filter((p) => p.result === 'LOSS').length, push: done.filter((p) => p.result === 'PUSH').length,
    units: r2(u), roi_pct: done.length ? r2(100 * u / done.length) : null,
    clv_own_avg_pct: mean(own), clv_own_n: own.length, clv_own_sd: sd(own), clv_own_beat_pct: own.length ? r2(100 * own.filter((x) => x > 0).length / own.length) : null,
    clv_best_avg_pct: mean(best), clv_best_n: best.length,
    curve: CL.summarize(done.map((p) => ({ odds: p.odds, closes: p.closes }))),
  };
}
function track(sport) {
  const st = rd(sport);
  const all = Object.values(st.picks || {});
  const byFam = {}, byFB = {};
  for (const p of all) { (byFam[p.family] = byFam[p.family] || []).push(p); const k = p.family + ' · ' + p.book; (byFB[k] = byFB[k] || []).push(p); }
  return {
    sport, rule: RULE, baseline: st.baseline || null, at: st.at || null,
    total: all.length, active: all.filter((p) => p.status === 'ACTIVE').length, voided: all.filter((p) => p.status === 'VOID').length,
    overall: agrega(all),
    by_family: Object.fromEntries(Object.entries(byFam).map(([k, v]) => [k, agrega(v)])),
    by_family_book: Object.fromEntries(Object.entries(byFB).map(([k, v]) => [k, { family: v[0].family, book: v[0].book, ...agrega(v) }])),
    open: all.filter((p) => p.status === 'ACTIVE').sort((a, b) => String(a.kickoff_at).localeCompare(String(b.kickoff_at))).slice(0, 40),
    recent: all.filter((p) => p.status === 'SETTLED').sort((a, b) => String(b.settled_at).localeCompare(String(a.settled_at))).slice(0, 40),
    doctrina: 'Familias de PRECIO en sombra: la incoherencia interna de una casa (dos mercados, un solo proceso) y su desviación frente al tablero. Ninguna probabilidad del modelo entra. La vara es el CLV contra la MISMA casa por cubo; el ROI se anota y no decide. Con < 150 liquidadas por familia todo es ruido.',
  };
}

module.exports = { RULE, rd, wr, updateBaseline, record, closes, settle, track, median };
