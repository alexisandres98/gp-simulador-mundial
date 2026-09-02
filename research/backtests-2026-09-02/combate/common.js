'use strict';
// utilidades compartidas de los backtests de combate (copias del join del server / backtest-v2)
const fs = require('fs');
const path = require('path');
const REPO = '/home/user/gp-simulador-mundial';
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const cm = (c) => { const m = String(c || '').match(/(\d+):(\d+)/); return m ? (+m[1] + +m[2] / 60) : 0; };

function loadFights(org) {
  const F = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'combat', `fights-${org}.json`), 'utf8'));
  let fighters = {}; try { fighters = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'combat', `fighters-${org}.json`), 'utf8')); } catch { }
  const fights = (F.fights || []).filter(f => f.completed && f.f1.id && f.f2.id && (f.f1.winner || f.f2.winner)).sort((a, b) => new Date(a.date) - new Date(b.date));
  return { fights, fighters };
}

function fineJoin(fights) {
  let raw; try { raw = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'combat', 'afstats-mma.json'), 'utf8')); } catch { return { perFight: {}, joined: 0 }; }
  const full = {}, last = {}, dupLast = {};
  for (const f of fights) for (const side of ['f1', 'f2']) {
    const n = norm(f[side].name); if (!n) continue;
    if (!full[n]) full[n] = f[side].id;
    const ln = n.split(' ').pop();
    if (ln && ln.length >= 3) { if (last[ln] && last[ln] !== f[side].id) { dupLast[ln] = 1; delete last[ln]; } else if (!dupLast[ln]) last[ln] = f[side].id; }
  }
  const byName = (nm) => { const n = norm(nm); return full[n] || last[n.split(' ').pop()] || null; };
  const byDay = {};
  for (const f of fights) {
    const d0 = String(f.date).slice(0, 10);
    for (const dd of [-1, 0, 1]) { const k = new Date(Date.parse(d0) + dd * 864e5).toISOString().slice(0, 10); (byDay[k] = byDay[k] || []).push(f); }
  }
  const perFight = {}; let joined = 0;
  for (const af of (raw.fights || [])) {
    const rows = raw.stats[af.id]; if (!rows || !rows.length) continue;
    const h = byName((af.f1 || {}).name), a = byName((af.f2 || {}).name);
    if (!h || !a) continue;
    const ours = (byDay[af.date] || []).find(f => (f.f1.id === h && f.f2.id === a) || (f.f1.id === a && f.f2.id === h));
    if (!ours) continue;
    joined++;
    const minutes = ((ours.end_round || 3) - 1) * 5 + cm(ours.end_clock);
    const afToOur = {}; afToOur[(af.f1 || {}).id] = h; afToOur[(af.f2 || {}).id] = a;
    const pf = perFight[ours.comp_id] = {};
    for (const row of rows) {
      const ourId = afToOur[(row.fighter || {}).id]; if (!ourId) continue;
      const st = row.strikes || {}; const tot = st.total || {};
      pf[ourId] = { min: minutes, str: (tot.head || 0) + (tot.body || 0) + (tot.legs || 0), td_att: (st.takedowns || {}).attempt || 0, td: (st.takedowns || {}).landed || 0, ctrl: cm(st.control_time), kd: st.knockdowns || 0 };
    }
  }
  return { perFight, joined };
}

function weighIndex(org, fights) {
  let W; try { W = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'combat', `weighins-${org}.json`), 'utf8')); } catch { return { idx: {}, known: new Set() }; }
  const nm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const byEvent = {};
  for (const f of fights) if (f.event) (byEvent[f.event] = byEvent[f.event] || []).push(f);
  const out = {}; const known = new Set();
  for (const [ev, rec] of Object.entries(W.events || {})) {
    if (rec.status === 'miss' || rec.status === 'clean') known.add(ev);
    if (rec.status !== 'miss' || !rec.rows) continue;
    const cands = [];
    for (const f of (byEvent[ev] || [])) for (const side of ['f1', 'f2']) cands.push({ c: f.comp_id, s: side, n: f[side].name });
    for (const row of rec.rows) {
      const q = new Set(nm(row.name).split(' ').filter(Boolean)); if (!q.size) continue;
      let best = null, bs = 0, tie = false;
      for (const c of cands) {
        const t = new Set(nm(c.n).split(' ')); let ov = 0; for (const x of q) if (t.has(x)) ov++;
        if (!ov) continue;
        const sc = ov * 10 + ov / Math.max(1, t.size + q.size - ov);
        if (sc > bs) { best = c; bs = sc; tie = false; } else if (sc === bs && best && best.c + best.s !== c.c + c.s) tie = true;
      }
      if (!best || tie) continue;
      const sl = out[best.c] = out[best.c] || {}; const pv = sl[best.s];
      sl[best.s] = { over: row.over != null ? row.over : (pv ? pv.over : null) };
    }
  }
  return { idx: out, known };
}

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function pairedStats(d, seed = 1, NBOOT = 2000) {
  const N = d.length; if (!N) return null;
  const mean = d.reduce((s, x) => s + x, 0) / N;
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, N - 1));
  const se = sd / Math.sqrt(N);
  const R = rng(seed); let better = 0;
  for (let b = 0; b < NBOOT; b++) { let s = 0; for (let j = 0; j < N; j++) s += d[(R() * N) | 0]; if (s < 0) better++; }
  return { n: N, dBrier: +mean.toFixed(6), se: +se.toFixed(6), t: se > 0 ? +(mean / se).toFixed(3) : null, pBoot: +(better / NBOOT).toFixed(3) };
}
const sigm = (z) => 1 / (1 + Math.exp(-z));
const logit = (p) => Math.log(Math.min(0.999, Math.max(0.001, p)) / (1 - Math.min(0.999, Math.max(0.001, p))));
const divGroup = (w) => { const s = String(w || ''); if (/^W /.test(s)) return 'women'; if (/Heavyweight/.test(s) && !/Light/.test(s)) return 'hw'; if (/Light Heavyweight|Middleweight/.test(s)) return 'lhw_mw'; if (/Welterweight|Lightweight/.test(s)) return 'ww_lw'; if (/Featherweight|Bantamweight|Flyweight/.test(s)) return 'fw_bw_flw'; return 'other'; };

module.exports = { REPO, loadFights, fineJoin, weighIndex, rng, pairedStats, sigm, logit, divGroup };
