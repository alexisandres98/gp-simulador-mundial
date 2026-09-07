// data-providers/darts/flashscore.js — EL MARCADOR EN VIVO (legs) del feed público de Flashscore
//
// La PDC publica el resultado cuando el partido termina; mientras se juega, su fixture queda 0-0. El feed
// de Flashscore (global.flashscore.ninja, deporte 14 = dardos) sí trae legs en vivo y estado, sin clave, con
// una cabecera fija. Formato propio: registros separados por "¬", pares "clave÷valor", un "~" abre registro.
// Claves observadas (6-sep-2026): ZA torneo · AA id evento · AD inicio (epoch s) · AC estado (1 previsto,
// 2 en juego, 3 terminado) · AE/AF nombres (apellido + inicial) · AG/AH legs · AS ganador (1|2) · WD best-of.
// DISPLAY: se casa por apellidos con la fila del tablero y nunca entra a una probabilidad.
'use strict';

const FEED = (dayOffset = 0) => `https://global.flashscore.ninja/2/x/feed/f_14_${dayOffset}_3_en_1`;
const HEAD = { 'x-fsign': process.env.FLASHSCORE_FSIGN || 'SW9D1eZo', 'user-agent': 'Mozilla/5.0', accept: '*/*' };
let memo = { at: 0, rows: [] };

function parse(txt) {
  const out = [];
  let tour = null, cur = null;
  for (const rec of String(txt || '').split('~')) {
    const kv = {};
    for (const part of rec.split('¬')) { const i = part.indexOf('÷'); if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1); }
    if (kv.ZA) { tour = kv.ZA; continue; }
    if (kv.AA) {
      cur = { id: kv.AA, tournament: tour, start_at: kv.AD ? new Date(+kv.AD * 1000).toISOString() : null, status: +kv.AC || null,
        a: kv.AE || null, b: kv.AF || null, legs_a: kv.AG != null ? +kv.AG : null, legs_b: kv.AH != null ? +kv.AH : null,
        winner: kv.AS === '1' ? 'a' : kv.AS === '2' ? 'b' : null, best_of: kv.WD != null ? +kv.WD : null,
        a_slug: kv.WU || null, b_slug: kv.WV || null, a_country: kv.FU || kv.CC || null, b_country: kv.FV || null };
      // 1 previsto · 3 terminado · cualquier otro código con legs a la vista (2, 4x…) = en juego
      cur.state = cur.status === 3 ? 'final' : cur.status === 1 ? 'scheduled' : (cur.legs_a != null || cur.legs_b != null) ? 'live' : 'other';
      out.push(cur);
    }
  }
  return out;
}

async function feed({ ttlMs = 45000, dayOffset = 0 } = {}) {
  if (dayOffset === 0 && memo.rows.length && Date.now() - memo.at < ttlMs) return memo.rows;
  try {
    const r = await fetch(FEED(dayOffset), { headers: HEAD, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rows = parse(await r.text());
    if (dayOffset === 0) memo = { at: Date.now(), rows };
    return rows;
  } catch { return dayOffset === 0 ? memo.rows : []; }
}
// solo lo que está en juego ahora
async function live() { return (await feed()).filter((r) => r.state === 'live'); }

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const lastOf = (s) => { const p = norm(s).replace(/\b[a-z]\.?$/, '').trim().split(' '); return p[p.length - 1] || ''; };
// casa una fila del tablero (nombres completos) con el feed (apellido + inicial); devuelve la fila con la orientación
function matchByNames(rows, nameA, nameB) {
  const la = lastOf(nameA), lb = lastOf(nameB);
  if (!la || !lb) return null;
  for (const r of rows) {
    const ra = lastOf(r.a), rb = lastOf(r.b);
    if (ra === la && rb === lb) return { ...r, swapped: false };
    if (ra === lb && rb === la) return { ...r, swapped: true };
  }
  return null;
}

module.exports = { feed, live, parse, matchByNames };
