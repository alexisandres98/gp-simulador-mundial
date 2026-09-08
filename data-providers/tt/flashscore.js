// data-providers/tt/flashscore.js — EL MARCADOR EN VIVO (games y puntos por game) del feed de Flashscore
//
// Deporte 25 = tenis de mesa. Mismo formato propio que en dardos: registros separados por "¬", pares
// "clave÷valor", "~" abre registro. Claves observadas (8-sep-2026): ZA torneo · AA id · AD inicio (epoch s) ·
// AC estado (1 previsto · 2 en juego · 3 terminado) · AE/AF nombres (apellido + inicial) · WU/WV slugs ·
// FU/FV país · AG/AH games · AS ganador (1|2) · BA/BB … BM/BN puntos de los games 1–7 (A, B) · OA/OB foto.
// Profundidad del feed: solo ±7 días. Cubre los eventos WTT (no las ligas privadas).
// DISPLAY, NUNCA MODELO: se casa por apellidos con la fila del tablero y jamás toca una probabilidad.
'use strict';

const FEED = (dayOffset = 0) => `https://global.flashscore.ninja/2/x/feed/f_25_${dayOffset}_3_en_1`;
const HEAD = { 'x-fsign': process.env.FLASHSCORE_FSIGN || 'SW9D1eZo', 'user-agent': 'Mozilla/5.0', accept: '*/*' };
const GAME_KEYS = [['BA', 'BB'], ['BC', 'BD'], ['BE', 'BF'], ['BG', 'BH'], ['BI', 'BJ'], ['BK', 'BL'], ['BM', 'BN']];
const memo = new Map(); // dayOffset → { at, rows }

function parse(txt) {
  const out = [];
  let tour = null, cur = null;
  for (const rec of String(txt || '').split('~')) {
    const kv = {};
    for (const part of rec.split('¬')) { const i = part.indexOf('÷'); if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1); }
    if (kv.ZA) { tour = { name: kv.ZA, slug: kv.ZL || null, country: kv.ZAF || null }; continue; }
    if (kv.AA) {
      const games = [];
      for (const [ka, kb] of GAME_KEYS) { if (kv[ka] != null || kv[kb] != null) games.push([kv[ka] != null ? +kv[ka] : null, kv[kb] != null ? +kv[kb] : null]); }
      cur = { id: kv.AA, tournament: tour ? tour.name : null, tournament_slug: tour ? tour.slug : null, start_at: kv.AD ? new Date(+kv.AD * 1000).toISOString() : null, status: +kv.AC || null,
        a: kv.AE || null, b: kv.AF || null, a_slug: kv.WU || null, b_slug: kv.WV || null, a_country: kv.FU || null, b_country: kv.FV || null, a_img: kv.OA || null, b_img: kv.OB || null,
        games_a: kv.AG != null ? +kv.AG : null, games_b: kv.AH != null ? +kv.AH : null, winner: kv.AS === '1' ? 'a' : kv.AS === '2' ? 'b' : null, games };
      cur.state = cur.status === 3 ? 'final' : cur.status === 1 ? 'scheduled' : (cur.games_a != null || cur.games_b != null) ? 'live' : 'other';
      // el game en curso: el último par con puntos que aún no cierra
      const last = games.length ? games[games.length - 1] : null;
      cur.current = cur.state === 'live' && last ? { game: games.length, a: last[0], b: last[1] } : null;
      out.push(cur);
    }
  }
  return out;
}

async function feed({ ttlMs = 45000, dayOffset = 0 } = {}) {
  const m = memo.get(dayOffset);
  if (m && Date.now() - m.at < (dayOffset === 0 ? ttlMs : 10 * 60e3)) return m.rows;
  try {
    const r = await fetch(FEED(dayOffset), { headers: HEAD, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rows = parse(await r.text());
    memo.set(dayOffset, { at: Date.now(), rows });
    return rows;
  } catch { return m ? m.rows : []; }
}
async function live() { return (await feed()).filter((r) => r.state === 'live'); }

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// "Geraldo J." → "geraldo"; "Antoine-Michard M." → "antoine michard"; "Ursut H. S." → "ursut"
const famOf = (s) => norm(String(s || '').replace(/(\s[A-Z]\.)+\s*$/, '')).trim();
// casa una fila (apellidos oficiales) con el feed; devuelve la fila con la orientación
function matchByFamilies(rows, famA, famB, { startAt = null, windowH = 12 } = {}) {
  const la = norm(famA), lb = norm(famB);
  if (!la || !lb) return null;
  const t0 = startAt ? Date.parse(startAt) : null;
  const near = (r) => t0 == null || !r.start_at || Math.abs(Date.parse(r.start_at) - t0) < windowH * 3600e3;
  for (const r of rows) {
    if (!near(r)) continue;
    const ra = famOf(r.a), rb = famOf(r.b);
    if (ra === la && rb === lb) return { ...r, swapped: false };
    if (ra === lb && rb === la) return { ...r, swapped: true };
  }
  return null;
}

module.exports = { feed, live, parse, matchByFamilies, famOf, GAME_KEYS };
