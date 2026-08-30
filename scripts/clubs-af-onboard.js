// scripts/clubs-af-onboard.js — ONBOARDING DE LIGA vía API-FOOTBALL (13-ago, cobertura total).
// Para ligas donde TSA no tiene data (o está en límite): baja el historial de fixtures de API-Football,
// lo convierte al MISMO formato de data/history, corre fit/backtest/goalsBacktest de la casa
// (clubs-engine/ratings — mismo Elo→matchProbs del resto de ligas) y MERGEA la liga nueva en
// data/clubs/ratings.json sin tocar las existentes. También baja los escudos a public/logos/tm_af<id>.png.
// El gate (status shadow/approved) sale del MISMO backtest walk-forward que las demás ligas: la disciplina
// de picks no se relaja por venir de otra fuente.
//
// Uso:  API_FOOTBALL_KEY=xxx node scripts/clubs-af-onboard.js
// Agregar ligas: extender el registro AF_LEAGUES (key estable + id de AF + temporadas + odds_key).
'use strict';
const fs = require('fs');
const path = require('path');
const { fit, backtest, goalsBacktest } = require('../clubs-engine/ratings');
const { matchProbs } = require('../engine');

const AFK = process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY || '';
if (!AFK) { console.error('Falta API_FOOTBALL_KEY'); process.exit(1); }
const AF_HOST = process.env.API_FOOTBALL_HOST || 'v3.football.api-sports.io';
const OUT = path.join(__dirname, '..', 'data', 'clubs', 'ratings.json');
const LOGOS = path.join(__dirname, '..', 'public', 'logos');

// Registro de ligas AF. `seasons` en orden cronológico (la última con ≥10 partidos alimenta standings).
const AF_LEAGUES = [
  { key: 'saudi', af: 307, name: 'Saudi Pro League', country: 'Arabia Saudita', seasons: [2024, 2025, 2026], odds_key: 'soccer_saudi_arabia_pro_league' },
  { key: 'aleague', af: 188, name: 'A-League', country: 'Australia', seasons: [2024, 2025], odds_key: 'soccer_australia_aleague' },
  // 30-ago (discovery del 29-ago): Frauen-Bundesliga con cuotas activas en Odds API. TSA no la tiene
  // (verificado: catálogo y search sin resultado) y ESPN tampoco (hay eng.w.1/esp.w.1, Alemania no) →
  // entra por AF como saudi/aleague. Sin ESPN, sus resultados llegan por la rama AF del sync de marcadores.
  { key: 'frauen', af: 82, name: 'Frauen-Bundesliga', country: 'Alemania', seasons: [2024, 2025, 2026], odds_key: 'soccer_germany_bundesliga_women' },
];

async function af(pathq) {
  const r = await fetch(`https://${AF_HOST}/${pathq}`, { headers: { 'x-apisports-key': AFK }, signal: AbortSignal.timeout(25000) });
  const j = await r.json().catch(() => null);
  if (!j || (j.errors && Object.keys(j.errors).length)) throw new Error(`AF ${pathq}: ${JSON.stringify(j && j.errors)}`);
  return j;
}

// fixtures de una temporada → formato history de la casa: {utc, home:{id,name,goals}, away:{...}}
async function seasonMatches(afId, season, logos) {
  // /fixtures de AF devuelve la temporada completa en una sola respuesta (sin paginación)
  const out = [];
  const j = await af(`fixtures?league=${afId}&season=${season}`);
  for (const fx of j.response || []) {
    const st = fx.fixture && fx.fixture.status && fx.fixture.status.short;
    const th = fx.teams && fx.teams.home, ta = fx.teams && fx.teams.away;
    if (!th || !ta) continue;
    if (th.logo) logos[`tm_af${th.id}`] = th.logo;
    if (ta.logo) logos[`tm_af${ta.id}`] = ta.logo;
    if (!['FT', 'AET', 'PEN'].includes(st)) continue;
    const hg = fx.goals && fx.goals.home, ag = fx.goals && fx.goals.away;
    if (hg == null || ag == null) continue;
    out.push({ utc: fx.fixture.date, home: { id: `tm_af${th.id}`, name: th.name, goals: hg }, away: { id: `tm_af${ta.id}`, name: ta.name, goals: ag } });
  }
  return out;
}

async function downloadLogo(id, url) {
  const f = path.join(LOGOS, `${id}.png`);
  if (fs.existsSync(f)) return false;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return false;
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    return true;
  } catch { return false; }
}

(async () => {
  // filtro opcional por argv (como los demás scripts de la casa): sin args = todas
  const only = process.argv.slice(2);
  const cur = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  for (const L of AF_LEAGUES.filter(l => !only.length || only.includes(l.key))) {
    const logos = {};
    let matches = [];
    const bySeason = {};
    for (const sn of L.seasons) {
      const ms = await seasonMatches(L.af, sn, logos);
      bySeason[sn] = ms;
      matches = matches.concat(ms);
      console.log(`${L.key} ${sn}: ${ms.length} partidos finalizados`);
    }
    if (matches.length < 60) { console.log(`${L.key}: historial insuficiente (${matches.length}) — se salta`); continue; }
    const r = fit(matches);
    let bt = null, gbt = null;
    try { bt = backtest(matches, { probs: matchProbs }); } catch (e) { console.log(`  (backtest: ${e.message})`); }
    try { gbt = goalsBacktest(matches); } catch (e) { console.log(`  (goals-backtest: ${e.message})`); }
    // standings de la última temporada con ≥10 partidos (misma lógica del script TSA)
    const snStand = [...L.seasons].reverse().find(sn => (bySeason[sn] || []).length >= 10);
    const st = {};
    for (const m of (bySeason[snStand] || [])) {
      const hg = Number(m.home.goals), ag = Number(m.away.goals);
      const H = st[m.home.id] = st[m.home.id] || { id: m.home.id, name: m.home.name, pts: 0, pj: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
      const A = st[m.away.id] = st[m.away.id] || { id: m.away.id, name: m.away.name, pts: 0, pj: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
      H.pj++; A.pj++; H.gf += hg; H.ga += ag; A.gf += ag; A.ga += hg;
      if (hg > ag) { H.w++; A.l++; H.pts += 3; } else if (hg < ag) { A.w++; H.l++; A.pts += 3; } else { H.d++; A.d++; H.pts++; A.pts++; }
    }
    const standings = Object.values(st).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
    cur.leagues[L.key] = {
      key: L.key, name: L.name, country: L.country, comp: null, season: `af_${L.af}_${L.seasons[L.seasons.length - 1]}`,
      ratings_from: L.seasons.map(sn => `af_${L.key}-${sn}`), fit_src: 'api-football', af_league: L.af,
      odds_key: L.odds_key, ...r, backtest: bt, goals_backtest: gbt, standings,
    };
    let dl = 0;
    for (const [id, url] of Object.entries(logos)) { if (await downloadLogo(id, url)) dl++; await new Promise(r2 => setTimeout(r2, 120)); }
    const top = Object.values(r.ratings).sort((a, b) => b.elo - a.elo).slice(0, 3).map(t => `${t.name} ${Math.round(t.elo)}`).join(' · ');
    console.log(`${L.key}: fit ${r.n_matches} partidos | hfa ${r.hfa} | equipos ${Object.keys(r.ratings).length} | escudos nuevos ${dl}`);
    console.log(`  1X2 ${bt ? bt.status.toUpperCase() + ` (Brier ${bt.brier}, calErr ${bt.cal_err}, n=${bt.n})` : 'sin bt'} | GOLES ${gbt ? gbt.status.toUpperCase() : 'sin gbt'}`);
    console.log(`  top: ${top}`);
  }
  cur._meta = { ...(cur._meta || {}), af_onboard_at: new Date().toISOString() };
  fs.writeFileSync(OUT, JSON.stringify(cur));
  console.log(`\n→ ${OUT} actualizado (${Object.keys(cur.leagues).length} ligas)`);
})();
