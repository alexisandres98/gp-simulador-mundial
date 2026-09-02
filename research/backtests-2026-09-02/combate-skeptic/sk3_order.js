#!/usr/bin/env node
// ESCÉPTICO H2f: verificar la afirmación "ESPN reordena f1/f2 tras la pelea". Comparo el orden al PUBLICAR
// (event.home_id/away_id de cada pick, cualquier estado) con el orden ACTUAL en fights-*.json (completado).
'use strict';
const fs = require('fs');
const REPO = '/home/user/gp-simulador-mundial';
const all = JSON.parse(fs.readFileSync('/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research/combat_picks_full.json', 'utf8')).picks;
const idx = {};
for (const org of ['ufc', 'mma', 'boxing']) { try { for (const f of JSON.parse(fs.readFileSync(`${REPO}/data/combat/fights-${org}.json`, 'utf8')).fights) idx[f.comp_id] = Object.assign({ org }, f); } catch { } }
const seen = new Set(); const rows = [];
for (const p of all.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
  const cid = String(p.event.canonical_event_id || '').replace(/^cb-/, '');
  if (seen.has(cid)) continue; seen.add(cid);
  const f = idx[cid]; if (!f || !f.completed) continue;
  const same = f.f1.id === p.event.home_id && f.f2.id === p.event.away_id;
  const inv = f.f1.id === p.event.away_id && f.f2.id === p.event.home_id;
  if (!same && !inv) continue;
  rows.push({ cid, org: f.org, inv, f1wins: !!f.f1.winner, pubHomeWins: same ? !!f.f1.winner : !!f.f2.winner, ev: f.event, d: f.date.slice(0, 10) });
}
const n = rows.length, invd = rows.filter(r => r.inv), same = rows.filter(r => !r.inv);
const out = {
  peleas_casadas: n, invertidas: invd.length, iguales: same.length,
  f1_actual_gana: { invertidas: invd.filter(r => r.f1wins).length + '/' + invd.length, iguales: same.filter(r => r.f1wins).length + '/' + same.length, total: rows.filter(r => r.f1wins).length + '/' + n },
  home_al_publicar_gana: rows.filter(r => r.pubHomeWins).length + '/' + n,
  por_org: {},
};
for (const org of ['ufc', 'mma', 'boxing']) { const s = rows.filter(r => r.org === org); out.por_org[org] = { n: s.length, inv: s.filter(r => r.inv).length, f1_actual_gana: s.filter(r => r.f1wins).length, home_pub_gana: s.filter(r => r.pubHomeWins).length }; }
// binomial: si el orden fuera independiente del resultado, P(f1 gana | invertida) ≈ P(f1 gana | igual)
console.log(JSON.stringify(out, null, 1));
console.log(invd.map(r => `${r.d} ${r.org} ${r.ev} f1wins=${r.f1wins}`).join('\n'));
fs.writeFileSync(__dirname + '/sk3_order.json', JSON.stringify(out, null, 1));
