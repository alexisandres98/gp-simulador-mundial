// tennis-engine/data.js — LA MEMORIA DEL TENIS: base propia, ratings y catálogo (blueprint 6.0 F2-F5)
//
// Carga matches.json (61k partidos ATP+WTA 2015→) y reproduce TODO el historial con las constantes
// congeladas de model-priors.json → Elo general + Elo por superficie + saque/resto opponent-adjusted
// por jugador, exactamente el mismo estado que validó el walk-forward. El catálogo (fichas, forma,
// cortes por superficie) sale de la misma pasada. Atribución: base derivada del proyecto de Jeff
// Sackmann (CC BY-NC-SA 4.0) — admin-only, sin uso comercial (data/tennis/RIGHTS.md).
'use strict';

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', 'data', 'tennis');
const logit = (p) => Math.log(p / (1 - p));
const sig = (x) => 1 / (1 + Math.exp(-x));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SURFACES = ['dura', 'arcilla', 'hierba', 'moqueta'];

let D = null; // estado construido una vez por proceso

function build() {
  if (D) return D;
  const { schema, tourneys, rows } = JSON.parse(fs.readFileSync(path.join(BASE, 'matches.json'), 'utf8'));
  const players = JSON.parse(fs.readFileSync(path.join(BASE, 'players.json'), 'utf8'));
  const priors = JSON.parse(fs.readFileSync(path.join(BASE, 'model-priors.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(BASE, 'meta.json'), 'utf8'));
  const F = {}; schema.forEach((k, i) => { F[k] = i; });

  const T = [{}, {}]; // por tour: estado del modelo + catálogo
  for (const tn of [0, 1]) {
    const lbl = tn === 0 ? 'atp' : 'wta';
    const cst = (priors.tours[lbl] || {}).constants || { kScale: 0.8, surfW: 0.3, halfLife: 30, shrinkK: 15, ensembleU: 0.3, shock: 0.07, tourSpwStart: tn === 0 ? 0.63 : 0.57, gamesCal: { bo3: [0, 1], bo5: [0, 1] } };
    T[tn] = {
      cst, elo: new Map(), eloSurf: [new Map(), new Map(), new Map(), new Map()], nMatch: new Map(),
      srv: new Map(), ret: new Map(), tourSpw: cst.tourSpwStart || (tn === 0 ? 0.63 : 0.57), tourN: 50,
      prof: new Map(), // id → perfil de catálogo
    };
  }

  const K = (cst, n) => cst.kScale * 250 / Math.pow(n + 5, 0.4);
  const g = (m, k, d) => (m.has(k) ? m.get(k) : d);
  const devOf = (t, m, id) => { const o = m.get(id); return o && o.w >= 3 ? (o.v / o.w) * (o.w / (o.w + t.cst.shrinkK)) : 0; };

  for (const r of rows) {
    const t = T[r[F.tour]]; const cst = t.cst;
    const date = r[F.date], surf = r[F.surface];
    const A = r[F.wid], B = r[F.lid];
    const eA = g(t.elo, A, 1500), eB = g(t.elo, B, 1500);
    const sT = surf >= 0 ? t.eloSurf[surf] : null;
    const sA = sT ? g(sT, A, 1500) : 1500, sB = sT ? g(sT, B, 1500) : 1500;
    const pGen = 1 / (1 + Math.pow(10, -(eA - eB) / 400));
    const pSurf = 1 / (1 + Math.pow(10, -(sA - sB) / 400));
    const nA = g(t.nMatch, A, 0), nB = g(t.nMatch, B, 0);
    t.elo.set(A, eA + K(cst, nA) * (1 - pGen)); t.elo.set(B, eB - K(cst, nB) * (1 - pGen));
    if (sT) { sT.set(A, sA + K(cst, nA) * (1 - pSurf)); sT.set(B, sB - K(cst, nB) * (1 - pSurf)); }
    t.nMatch.set(A, nA + 1); t.nMatch.set(B, nB + 1);

    const alpha = Math.log(2) / cst.halfLife;
    const upd = (m, id, val) => { const o = m.get(id) || { v: 0, w: 0 }; o.v = o.v * (1 - alpha) + val; o.w = o.w * (1 - alpha) + 1; m.set(id, o); };
    const wsv = r[F.w_svpt], lsv = r[F.l_svpt];
    let wSpw = null, lSpw = null;
    if (wsv > 30 && lsv > 30) {
      wSpw = (r[F.w_1stWon] + r[F.w_2ndWon]) / wsv;
      lSpw = (r[F.l_1stWon] + r[F.l_2ndWon]) / lsv;
      t.tourSpw = (t.tourSpw * t.tourN + wSpw + lSpw) / (t.tourN + 2); t.tourN = Math.min(t.tourN + 2, 4000);
      upd(t.srv, A, wSpw - t.tourSpw + devOf(t, t.ret, B)); upd(t.srv, B, lSpw - t.tourSpw + devOf(t, t.ret, A));
      upd(t.ret, A, t.tourSpw + devOf(t, t.srv, B) - lSpw); upd(t.ret, B, t.tourSpw + devOf(t, t.srv, A) - wSpw);
    }

    // catálogo (misma pasada): forma, superficie, saque de carrera, últimos partidos
    for (const [id, opp, won] of [[A, B, true], [B, A, false]]) {
      let p = t.prof.get(id);
      if (!p) { p = { w: 0, l: 0, surf: [[0, 0], [0, 0], [0, 0], [0, 0]], recent: [], lastDate: 0, rank: null, ace: 0, df: 0, sv: 0, in1: 0, spwS: 0, spwN: 0, bpS: 0, bpF: 0 }; t.prof.set(id, p); }
      if (won) p.w++; else p.l++;
      if (surf >= 0) p.surf[surf][won ? 0 : 1]++;
      p.lastDate = Math.max(p.lastDate, date);
      const rk = won ? r[F.w_rank] : r[F.l_rank];
      if (rk > 0) p.rank = rk;
      const pre = won ? 'w_' : 'l_';
      if (r[F[pre + 'svpt']] > 30) {
        p.ace += r[F[pre + 'ace']]; p.df += r[F[pre + 'df']]; p.sv += r[F[pre + 'svpt']]; p.in1 += r[F[pre + '1stIn']];
        p.bpS += Math.max(0, r[F[pre + 'bpSaved']]); p.bpF += Math.max(0, r[F[pre + 'bpFaced']]);
        p.spwS += won ? wSpw : lSpw; p.spwN++;
      }
      p.recent.push({ d: date, opp, won, score: r[F.score], surf, t: tourneys[r[F.tid]] ? tourneys[r[F.tid]].name : '', round: r[F.round], ret: r[F.ret] });
      if (p.recent.length > 14) p.recent.shift();
    }
  }

  D = { F, schema, tourneys, rows, players, priors, meta, T };
  return D;
}

// probabilidad del ensamble (misma fórmula congelada que validó el holdout)
function matchProb(tn, idA, idB, surf) {
  const d = build(); const t = d.T[tn]; const cst = t.cst;
  const g2 = (m, k) => (m.has(k) ? m.get(k) : 1500);
  const pGen = 1 / (1 + Math.pow(10, -(g2(t.elo, idA) - g2(t.elo, idB)) / 400));
  const sT = surf >= 0 && surf <= 3 ? t.eloSurf[surf] : null;
  const pSurf = sT ? 1 / (1 + Math.pow(10, -(g2(sT, idA) - g2(sT, idB)) / 400)) : pGen;
  const pMix = sig((1 - cst.surfW) * logit(clamp(pGen, 0.01, 0.99)) + cst.surfW * logit(clamp(pSurf, 0.01, 0.99)));
  const dev = (m, id) => { const o = m.get(id); return o && o.w >= 3 ? (o.v / o.w) * (o.w / (o.w + cst.shrinkK)) : 0; };
  const paSrv = clamp(t.tourSpw + dev(t.srv, idA) - dev(t.ret, idB), 0.45, 0.8);
  const pbSrv = clamp(t.tourSpw + dev(t.srv, idB) - dev(t.ret, idA), 0.45, 0.8);
  return { pMix, paSrv, pbSrv, pGen, pSurf };
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// resuelve "Andrey Rublev" / "rublev" → id del tour (los nombres de cuotas y ESPN vienen completos)
function resolvePlayer(tn, name) {
  const d = build();
  const q = norm(name);
  if (!q) return null;
  let best = null;
  for (const [key, p] of Object.entries(d.players)) {
    const [ktn, id] = key.split(':');
    if (+ktn !== tn) continue;
    const n = norm(p.name);
    if (n === q) return { id: +id, ...p };
    if (!best && (n.endsWith(' ' + q) || n.startsWith(q + ' ') || n.includes(q))) {
      const prof = d.T[tn].prof.get(+id);
      best = { id: +id, ...p, _hist: prof ? prof.w + prof.l : 0 };
    } else if (best && (n.endsWith(' ' + q) || n.includes(q))) {
      const prof = d.T[tn].prof.get(+id);
      const h = prof ? prof.w + prof.l : 0;
      if (h > (best._hist || 0)) best = { id: +id, ...p, _hist: h };
    }
  }
  return best;
}

function playerOf(tn, id) { const d = build(); return d.players[tn + ':' + id] || null; }

module.exports = { build, matchProb, resolvePlayer, playerOf, norm, BASE, SURFACES };
