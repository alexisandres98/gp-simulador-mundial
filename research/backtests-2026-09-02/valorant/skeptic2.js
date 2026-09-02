'use strict';
const fs=require('fs'),path=require('path');const REPO='/home/user/gp-simulador-mundial';
const C=require(path.join(REPO,'esports-engine/core.js')),V=require(path.join(REPO,'esports-engine/valorant.js'));
const MS=JSON.parse(fs.readFileSync(path.join(REPO,'data/esports/valorant/map-stats.json')));
const H5=JSON.parse(fs.readFileSync('h5_result.json'));const RESEARCH='/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research';
const book=JSON.parse(fs.readFileSync(path.join(RESEARCH,'es_full_valorant.json'))).recent.filter(p=>p.result_code==='WIN'||p.result_code==='LOSS');
const byPick=Object.fromEntries(book.map(p=>[p.pick_id,p]));const mean=a=>a.reduce((x,y)=>x+y,0)/(a.length||1);const r4=x=>+x.toFixed(4),r2=x=>+x.toFixed(2);
// 1) consistencia de la |p-0,5| recuperada: RONDAS vs RONDAS_HANDICAP en el mismo event-map
const em={};for(const r of H5.picks){const p=byPick[r.pick_id];const k=p.event_id+'|'+p.map;em[k]=em[k]||{ro:[],rh:[]};if(r.family==='RONDAS')em[k].ro.push(r.abs_dev_prod);else if(r.p_map_prod!=null)em[k].rh.push(Math.abs(r.p_map_prod-0.5));}
const both=Object.entries(em).filter(([k,v])=>v.ro.length&&v.rh.length);
console.log('event-maps con RONDAS y HANDICAP/EQUIPO:',both.length,'| |p-0,5| medio recuperado de RONDAS',r4(mean(both.map(([k,v])=>mean(v.ro)))),'vs de HANDICAP/EQUIPO',r4(mean(both.map(([k,v])=>mean(v.rh)))));
console.log('rows in_rotation n>=40 mean_rounds:',MS.rows.filter(r=>r.in_rotation&&r.n>=40).map(r=>`${r.map} ${r.mean_rounds.toFixed(2)} ot ${r.overtime_p.toFixed(3)} def ${(1-r.atk_round_share).toFixed(3)} n${r.n}`).join(' | '));
console.log('map-stats at:',MS.at||MS.generated_at||JSON.stringify(Object.keys(MS)));
// 2) under con bisección + perfil del mapa REAL + extremidad de producción
const rows=MS.rows.filter(r=>r.in_rotation&&r.n>=40);const wN=rows.reduce((s,r)=>s+r.n,0);
const circuit={name:null,bias:1-rows.reduce((s,r)=>s+r.n*r.atk_round_share,0)/wN,ot:rows.reduce((s,r)=>s+r.n*r.overtime_p,0)/wN};
function fitEco(bias,t){let lo=0,hi=0.18;for(let i=0;i<12;i++){const mid=(lo+hi)/2;const ot=V.mapRounds(0.5,bias,{eco:mid,sims:6000,seed:4127}).overtime_p;if(ot>t)lo=mid;else hi=mid;}return +((lo+hi)/2).toFixed(3);}
const ecoC=new Map();const ecoFor=pr=>{const k=pr.name||'c';if(!ecoC.has(k))ecoC.set(k,fitEco(pr.bias,pr.ot));return ecoC.get(k);};
const profileOf=m=>{const r=MS.rows.find(x=>x.map.toLowerCase()===String(m).toLowerCase());return r&&r.n>=40?{name:r.map,bias:1-r.atk_round_share,ot:r.overtime_p}:null;};
const pWin=R=>Object.entries(R.dist.margin.h).reduce((s,[k,p])=>s+(+k>0?p:0),0);const inv=new Map();
function pRoundFor(p,prof){const k=p.toFixed(3)+'|'+prof.name;if(inv.has(k))return inv.get(k);let lo=0.2,hi=0.8;for(let i=0;i<14;i++){const mid=(lo+hi)/2;if(pWin(V.mapRounds(mid,prof.bias,{eco:ecoFor(prof),sims:6000,seed:911}))<p)lo=mid;else hi=mid;}const v=(lo+hi)/2;inv.set(k,v);return v;}
const gate=(p,e)=>{const single=!p.books_quoting||p.books_quoting<2;return e>=3+(single?2.5:0)&&e>=0.75*p.uncertainty_pp&&!(p.calibration_pp>0&&e<=p.calibration_pp);};
const realMap=p=>{if(!p.final||!p.final.detail)return null;const s=p.final.detail.split('·').map(x=>x.trim())[p.map-1];if(!s)return null;const m=s.match(/^([A-Za-z ]+?)\s+(\d+)-(\d+)/);return m?m[1].trim():null;};
const h5=Object.fromEntries(H5.picks.map(r=>[r.pick_id,r]));const out=[];
for(const p of book.filter(q=>q.family==='RONDAS'&&q.side==='under')){const rm=realMap(p);const prof=rm&&profileOf(rm);if(!prof)continue;const pp=Math.min(0.97,0.5+h5[p.pick_id].abs_dev_prod);
 const R=V.mapRounds(pRoundFor(pp,prof),prof.bias,{eco:ecoFor(prof),sims:20000,seed:29});const pu=C.pUnder(R.dist.total,p.line);const e=(pu-p.p_market)*100;
 out.push({y:p.result_code==='WIN'?1:0,odds:p.odds,pu,e,nace:gate(p,e),mean:R.mean_rounds});}
const born=out.filter(r=>r.nace);
console.log('under con perfil del mapa REAL + bisección + extremidad de producción: n',out.length,'nacen',born.length,'win',born.filter(r=>r.y).length,'roi',born.length?r2(100*mean(born.map(r=>r.y?r.odds-1:-1))):null,'p_under medio',r4(mean(out.map(r=>r.pu))),'edge medio',r2(mean(out.map(r=>r.e))),'brier',r4(mean(out.map(r=>(r.pu-r.y)**2))));
console.log('born detail',JSON.stringify(born.map(r=>({y:r.y,odds:r.odds,pu:r4(r.pu),e:r2(r.e),mean:r.mean}))));
