#!/usr/bin/env node
// hoops-bt.js — reproduce el bucle de scripts/hoops-strategy-backtest.js pero VUELCA cada candidato (una fila
// por partido × familia × lado) para poder analizar por banda, por residuo de línea, por ventana temporal,
// sin re-simular. Carga los módulos desde el repo que se le indique (--repo=) para comparar histograma
// nuevo (1 punto) vs viejo (cubos de 5).
//
// uso: node hoops-bt.js --repo=/ruta/al/repo --league=wnba [--sims=8000] [--refit=10] [--out=fichero.json]
'use strict';
const path = require('path');
const fs = require('fs');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const REPO = path.resolve(args.repo || '.');
const LEAGUE = String(args.league || 'wnba');
const SIMS = +args.sims || 8000;
const REFIT = +args.refit || 10;
const MIN_TRAIN = +args.minTrain || 60;
const OUT = args.out || null;

const R = require(path.join(REPO, 'basketball-engine/ratings'));
const S = require(path.join(REPO, 'basketball-engine/simulate'));
const PRC = require(path.join(REPO, 'basketball-engine/pricing'));
const ST = require(path.join(REPO, 'basketball-engine/store'));
const ESPN = require(path.join(REPO, 'data-providers/basketball/espn'));

const imp = (x) => (x < 0 ? -x / (-x + 100) : 100 / (x + 100));
const STD = 1.909;

const C = ST.load(LEAGUE, { force: true });
const L = ESPN.LEAGUES[LEAGUE] || {};
const validTeams = Object.keys(C.teams || {});
const all = C.games.filter((g) => g.home.pts != null && (g.odds || []).length && g.odds[0].hml != null)
  .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
const rows = [];
let fit = null, fitAt = -1;
for (let i = MIN_TRAIN; i < all.length; i++) {
  const g = all[i];
  if (fitAt < 0 || i - fitAt >= REFIT) { fit = R.fitRatings(all.slice(0, i), { validTeams: validTeams.length ? validTeams : null }); fitAt = i; }
  if (!fit || !fit.off[g.home.id] || !fit.off[g.away.id]) continue;
  const o = g.odds[0];
  const ih = imp(o.hml), ia = imp(o.aml);
  const pMH = ih / (ih + ia);
  const sim = S.simulate(fit, String(g.home.id), String(g.away.id), { n: SIMS, seed: 13, neutral: !!g.neutral, regMin: L.minutes || 48, otMin: L.otMin || 5 });
  if (!sim) continue;
  const margin = g.home.pts - g.away.pts, tot = g.home.pts + g.away.pts;
  const base = { i, date: g.date, gid: g.id, home: g.home.abbr, away: g.away.abbr, ot: g.ot || 0,
    sim_margin: sim.margin, sim_total: sim.total, sim_poss: sim.poss, mkt_sp: o.sp, mkt_ou: o.ou, p_mkt_home: +pMH.toFixed(4),
    act_margin: margin, act_total: tot, n_home: fit.n[g.home.id], n_away: fit.n[g.away.id], fit_games: fit.games, sd_poss: fit.sd.poss, sd_env: fit.sd.ppp_env, sd_ind: fit.sd.ppp_ind };
  const push = (fam, side, p, pMarket, odds, won, pushP) => {
    const price = PRC.priceRow({ p, pushProb: pushP || 0, odds, targetEv: 0.02 });
    if (!price) return;
    rows.push({ ...base, family: fam, side, p: +p.toFixed(4), p_market: +pMarket.toFixed(4), odds, won, push: pushP || 0, edge_pp: price.edge_pp, ev_pct: price.ev_pct });
  };
  push('moneyline', 'home', sim.win.home, pMH, 1 / ih, margin > 0 ? 1 : 0, 0);
  push('moneyline', 'away', 1 - sim.win.home, 1 - pMH, 1 / ia, margin < 0 ? 1 : 0, 0);
  if (o.sp != null) {
    const pa = PRC.pushAware(sim.margin_hist || [], o.sp, 'home', { kind: 'spread' });
    if (pa) {
      const cover = margin + o.sp;
      const res = Math.abs(cover) < 1e-9 ? 'push' : cover > 0 ? 'home' : 'away';
      for (const side of ['home', 'away']) push('spread', side, side === 'home' ? pa.effective : 1 - pa.effective, 0.5, STD, res === 'push' ? null : (res === side ? 1 : 0), pa.push);
    }
  }
  if (o.ou != null) {
    const pa = PRC.pushAware(sim.total_hist || [], o.ou, 'over', { kind: 'total' });
    if (pa) {
      const res = Math.abs(tot - o.ou) < 1e-9 ? 'push' : tot > o.ou ? 'over' : 'under';
      for (const side of ['over', 'under']) push('total', side, side === 'over' ? pa.effective : 1 - pa.effective, 0.5, STD, res === 'push' ? null : (res === side ? 1 : 0), pa.push);
    }
  }
  if ((i - MIN_TRAIN) % 100 === 0) process.stderr.write(`  ${i - MIN_TRAIN}/${all.length - MIN_TRAIN}\r`);
}
const out = { repo: REPO, league: LEAGUE, sims: SIMS, refit: REFIT, dataset_games: all.length, games_evaluated: all.length - MIN_TRAIN, first_date: all[MIN_TRAIN] && all[MIN_TRAIN].date, last_date: all[all.length - 1].date, rows };
if (OUT) { fs.writeFileSync(OUT, JSON.stringify(out)); process.stderr.write(`\n${rows.length} filas → ${OUT}\n`); }
else console.log(JSON.stringify(out));
