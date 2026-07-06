// scripts/xg-audit.js — AUDITORÍA modelo GP vs xG OBSERVADO (TheStatsAPI) sobre el Mundial 2026.
// OFFLINE y READ-ONLY (Postgres solo SELECT). Dos capas:
//   A) LIGA (92 partidos, sin modelo): goles vs xG observado (medias/correlación/finishing), xG-justice
//      (¿ganó el que generó más?), over/btts implícitos por Poisson(xG observado) vs reales.
//   B) MODELO (eventos con goal_model_snapshots pre-kickoff): λ final del engine vs xG observado y goles
//      por lado — sesgo, MAE, correlación; over2.5/btts del snapshot vs realidad.
// Uso: DATABASE_URL=postgres://... node scripts/xg-audit.js   (sin DATABASE_URL corre solo la capa A)
'use strict';
const fs = require('fs');
const path = require('path');

const hist = require('../data/player-props-history.json');
const propsHist = require('../data/props-history.json');

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const corr = (xs, ys) => {
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return num / Math.sqrt(dx * dy);
};
const poisP0 = mu => Math.exp(-mu);
const overFromXg = (xh, xa) => { // P(goles>2.5) con Poisson(xh)+Poisson(xa)
  const pmf = (mu, k) => Math.exp(-mu) * Math.pow(mu, k) / [1, 1, 2, 6, 24, 120, 720][k];
  let under = 0;
  for (let h = 0; h <= 2; h++) for (let a = 0; a <= 2 - h; a++) under += pmf(xh, h) * pmf(xa, a);
  return 1 - under;
};

// xG observado por equipo-partido: suma de los xG de sus jugadores (TheStatsAPI).
const obs = {}; // 'HOME~AWAY|date' → { hxg, axg, hg, ag }
const teamPair = m => m.home + '~' + m.away;
for (const m of hist.matches) {
  const hxg = m.players.filter(p => p.team === m.home).reduce((s, p) => s + (p.xg || 0), 0);
  const axg = m.players.filter(p => p.team === m.away).reduce((s, p) => s + (p.xg || 0), 0);
  obs[teamPair(m)] = { hxg, axg, date: m.date };
}
// goles reales desde el dataset de props (API-Football, mismo orden home/away)
for (const m of propsHist.matches) {
  const k = teamPair({ home: m.home.code, away: m.away.code });
  if (obs[k]) { obs[k].hg = m.home.goals; obs[k].ag = m.away.goals; obs[k].et = m.et; }
}
const rows = Object.entries(obs).filter(([, v]) => v.hg != null).map(([k, v]) => ({ pair: k, ...v }));

const L = [];
const out = s => { L.push(s); console.log(s); };

out('# Auditoría modelo GP vs xG observado — Mundial 2026 (corte 6-jul)');
out('');
out('## A. Liga completa (' + rows.length + ' partidos, xG = TheStatsAPI, goles = API-Football)');
const gsum = rows.map(r => r.hg + r.ag), xsum = rows.map(r => r.hxg + r.axg);
out(`- Goles/partido: **${mean(gsum).toFixed(2)}** · xG/partido: **${mean(xsum).toFixed(2)}** → finishing del torneo ${(mean(gsum) / mean(xsum) * 100 - 100).toFixed(1)}% vs lo esperado`);
out(`- Correlación goles~xG por partido: **${corr(gsum, xsum).toFixed(3)}** (equipo-partido: ${corr(rows.flatMap(r => [r.hg, r.ag]), rows.flatMap(r => [r.hxg, r.axg])).toFixed(3)})`);
const overReal = mean(rows.map(r => (r.hg + r.ag > 2.5 ? 1 : 0)));
const overXg = mean(rows.map(r => overFromXg(r.hxg, r.axg)));
out(`- Over 2.5 REAL: **${(100 * overReal).toFixed(1)}%** · implícito por Poisson(xG observado): **${(100 * overXg).toFixed(1)}%**`);
const bttsReal = mean(rows.map(r => (r.hg > 0 && r.ag > 0 ? 1 : 0)));
const bttsXg = mean(rows.map(r => (1 - poisP0(r.hxg)) * (1 - poisP0(r.axg))));
out(`- BTTS REAL: **${(100 * bttsReal).toFixed(1)}%** · implícito por xG observado: **${(100 * bttsXg).toFixed(1)}%**`);
// xG justice: partidos con ganador donde el que más generó NO ganó
const decided = rows.filter(r => r.hg !== r.ag);
const unjust = decided.filter(r => (r.hxg > r.axg && r.hg < r.ag) || (r.axg > r.hxg && r.ag < r.hg));
out(`- xG-justice: en **${(100 * (1 - unjust.length / decided.length)).toFixed(1)}%** de los partidos con ganador, ganó el que más xG generó (${unjust.length}/${decided.length} "robos": el dominado ganó)`);
out('');

(async () => {
  if (!process.env.DATABASE_URL) { out('_(sin DATABASE_URL: capa B omitida)_'); finish(); return; }
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  // último snapshot PRE-KICKOFF por evento
  const snaps = (await c.query(`
    SELECT DISTINCT ON (s.canonical_event_id)
      s.canonical_event_id, s.final_lambda_home::float lh, s.final_lambda_away::float la,
      s.over_under, s.btts, s.factor_lineage, s.created_at
    FROM goal_model_snapshots s
    ORDER BY s.canonical_event_id, s.created_at DESC`)).rows;
  await c.end();
  const audited = [];
  for (const s of snaps) {
    const lin = (Array.isArray(s.factor_lineage) ? s.factor_lineage[0] : null) || {};
    const h = lin.home_team_id, a = lin.away_team_id, ko = lin.kickoff_at;
    if (!h || !a || !ko) continue;
    if (new Date(s.created_at) > new Date(ko)) continue;      // solo pre-partido
    const o = obs[h + '~' + a];
    if (!o || o.hg == null || o.et) continue;                  // jugado, 90' limpios
    let over25 = null, bttsP = null;
    try { const ou = s.over_under || {}; over25 = ou['2.5'] != null ? Number(ou['2.5'].over != null ? ou['2.5'].over : ou['2.5']) : null; } catch { }
    try { const bt = s.btts || {}; bttsP = bt.yes != null ? Number(bt.yes) : null; } catch { }
    audited.push({ pair: h + '-' + a, at: s.created_at, lh: s.lh, la: s.la, hxg: o.hxg, axg: o.axg, hg: o.hg, ag: o.ag, over25, btts: bttsP });
  }
  // el mismo partido puede existir bajo id canónico Y sintético → un solo registro por par (el snapshot más fresco)
  const byPair = {};
  for (const r of audited) if (!byPair[r.pair] || new Date(r.at) > new Date(byPair[r.pair].at)) byPair[r.pair] = r;
  audited.length = 0; audited.push(...Object.values(byPair));
  out(`## B. Modelo GP vs realidad (${audited.length} partidos con snapshot pre-kickoff del goal engine)`);
  if (audited.length >= 5) {
    const lam = audited.flatMap(r => [r.lh, r.la]), xg = audited.flatMap(r => [r.hxg, r.axg]), gl = audited.flatMap(r => [r.hg, r.ag]);
    out(`- λ media del modelo: **${mean(lam).toFixed(2)}** · xG observado medio: **${mean(xg).toFixed(2)}** · goles medios: **${mean(gl).toFixed(2)}** → sesgo λ−xG = **${(mean(lam) - mean(xg)).toFixed(2)}** por equipo`);
    out(`- MAE λ vs xG observado: **${mean(lam.map((l, i) => Math.abs(l - xg[i]))).toFixed(2)}** · correlación λ~xG: **${corr(lam, xg).toFixed(3)}** · correlación λ~goles: ${corr(lam, gl).toFixed(3)}`);
    const withOver = audited.filter(r => r.over25 != null);
    if (withOver.length >= 5) {
      out(`- Over 2.5: modelo medio **${(100 * mean(withOver.map(r => r.over25))).toFixed(1)}%** vs real ${(100 * mean(withOver.map(r => (r.hg + r.ag > 2.5 ? 1 : 0)))).toFixed(1)}% (n=${withOver.length})`);
    }
    const withBtts = audited.filter(r => r.btts != null);
    if (withBtts.length >= 5) {
      out(`- BTTS: modelo medio **${(100 * mean(withBtts.map(r => r.btts))).toFixed(1)}%** vs real ${(100 * mean(withBtts.map(r => (r.hg > 0 && r.ag > 0 ? 1 : 0)))).toFixed(1)}% (n=${withBtts.length})`);
    }
    out('');
    out('| Partido | λ modelo | xG observado | Goles |');
    out('|---|---|---|---|');
    for (const r of audited) out(`| ${r.pair} | ${r.lh.toFixed(2)}-${r.la.toFixed(2)} | ${r.hxg.toFixed(2)}-${r.axg.toFixed(2)} | ${r.hg}-${r.ag} |`);
  } else out('_(muestra insuficiente)_');
  finish();
})().catch(e => { console.error(e); process.exit(1); });

function finish() {
  const dest = path.join(__dirname, '..', 'docs');
  if (!fs.existsSync(dest)) fs.mkdirSync(dest);
  const f = path.join(dest, 'xg-audit-2026-07-06.md');
  fs.writeFileSync(f, L.join('\n') + '\n');
  console.log('\nreporte → ' + f);
}
