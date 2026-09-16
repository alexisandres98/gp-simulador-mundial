// ¿La incoherencia entre el HT/FT y los 1X2 de la MISMA casa se puede cobrar?
// Estructura: las tres celdas de la FILA i del HT/FT cubren exactamente "va ganando i al descanso".
// Los otros dos resultados del 1X2 de 1a parte cubren "NO va ganando i". Juntos: exhaustivos y
// mutuamente excluyentes. Si la suma de las implicitas CRUDAS (con margen dentro) es < 1, es beneficio
// garantizado pase lo que pase. Lo mismo con las COLUMNAS y el 1X2 del partido.
const fs=require('fs'), path=require('path');
const dir=process.argv[2];
const L3={home:'HOME',draw:'DRAW',away:'AWAY'};
const sub=(m)=>(m&&m.submarkets?Object.values(m.submarkets)[0]:null);
const sels=(m)=>((sub(m)||{}).selections||[]).filter(s=>s.status==='SELECTION_ENABLED'&&s.side!=='LAY'&&Number(s.price)>1);
function odds1x2(m){const o={};for(const s of sels(m)){const k=L3[String(s.outcome).toLowerCase()];if(k)o[k]=Math.max(o[k]||0,Number(s.price));}return (o.HOME&&o.DRAW&&o.AWAY)?o:null;}
function oddsHtft(m){const o={};for(const s of sels(m)){const x=/^(home|draw|away)_(home|draw|away)$/.exec(String(s.outcome).toLowerCase());if(x)o[`${x[1].toUpperCase()}_${x[2].toUpperCase()}`]=Math.max(o[`${x[1].toUpperCase()}_${x[2].toUpperCase()}`]||0,Number(s.price));}return Object.keys(o).length===9?o:null;}
const EST=['HOME','DRAW','AWAY'];
const filas=[]; let n=0, sinDatos=0;
for(const f of fs.readdirSync(dir)){
  if(!f.endsWith('.json'))continue;
  let ev;try{ev=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))}catch{continue}
  const M=ev.markets||{};
  const h1=odds1x2(M['soccer.match_odds_period_first_half']);
  const ft=odds1x2(M['soccer.match_odds']);
  const jt=oddsHtft(M['soccer.halftime_fulltime_result']);
  if(!jt||(!h1&&!ft)){sinDatos++;continue}
  n++;
  const nombre=`${(ev.home||{}).name} vs ${(ev.away||{}).name}`;
  // (a) FILA i del HT/FT + los otros dos del 1X2 de 1a parte
  if(h1) for(const i of EST){
    const cost=EST.reduce((s,j)=>s+1/jt[`${i}_${j}`],0) + EST.filter(x=>x!==i).reduce((s,x)=>s+1/h1[x],0);
    filas.push({partido:nombre,tipo:'fila HT/FT + 1X2 de 1a parte',estado:i,coste:+cost.toFixed(5),margen_pct:+(100*(cost-1)).toFixed(3)});
  }
  // (b) las otras dos FILAS + el resultado i del 1X2 de 1a parte
  if(h1) for(const i of EST){
    const cost=EST.filter(x=>x!==i).reduce((s,x)=>s+EST.reduce((a,j)=>a+1/jt[`${x}_${j}`],0),0) + 1/h1[i];
    filas.push({partido:nombre,tipo:'las otras dos filas + 1X2 de 1a parte',estado:i,coste:+cost.toFixed(5),margen_pct:+(100*(cost-1)).toFixed(3)});
  }
  // (c) COLUMNA j del HT/FT + los otros dos del 1X2 del partido
  if(ft) for(const j of EST){
    const cost=EST.reduce((s,i)=>s+1/jt[`${i}_${j}`],0) + EST.filter(x=>x!==j).reduce((s,x)=>s+1/ft[x],0);
    filas.push({partido:nombre,tipo:'columna HT/FT + 1X2 del partido',estado:j,coste:+cost.toFixed(5),margen_pct:+(100*(cost-1)).toFixed(3)});
  }
  if(ft) for(const j of EST){
    const cost=EST.filter(x=>x!==j).reduce((s,x)=>s+EST.reduce((a,i)=>a+1/jt[`${i}_${x}`],0),0) + 1/ft[j];
    filas.push({partido:nombre,tipo:'las otras dos columnas + 1X2 del partido',estado:j,coste:+cost.toFixed(5),margen_pct:+(100*(cost-1)).toFixed(3)});
  }
}
filas.sort((a,b)=>a.coste-b.coste);
const arbs=filas.filter(x=>x.coste<1);
console.log(`partidos con datos: ${n} (descartados ${sinDatos}) · combinaciones probadas: ${filas.length}`);
console.log(`ARBITRAJES (coste < 1): ${arbs.length}`);
console.log('\nlas 8 combinaciones MAS BARATAS:');
for(const x of filas.slice(0,8)) console.log(`  ${String(x.margen_pct).padStart(8)} %  ${x.tipo.padEnd(38)} ${x.estado.padEnd(5)} ${x.partido.slice(0,34)}`);
const porTipo={};
for(const x of filas)(porTipo[x.tipo]=porTipo[x.tipo]||[]).push(x.margen_pct);
console.log('\npor tipo de combinacion (lo que cuesta cruzar las dos patas):');
for(const [k,v] of Object.entries(porTipo)){v.sort((a,b)=>a-b);console.log(`  ${k.padEnd(40)} n ${String(v.length).padStart(4)}  mejor ${String(v[0]).padStart(8)} %  mediana ${String(v[v.length>>1]).padStart(8)} %`);}
